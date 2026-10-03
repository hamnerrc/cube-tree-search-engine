"""
train_cross_color_gnn.py
────────────────────────────────────────────────────────────────────────────────
Edit the CONFIG block, then run:   python train_cross_color_gnn.py
"""

import time
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import DataLoader, Dataset

# ══════════════════════════════════════════════════════════════════════════════
#  CONFIG  —  the only section you need to touch
# ══════════════════════════════════════════════════════════════════════════════
CFG = SimpleNamespace(
    # ── paths ──────────────────────────────────────────────────────────────────
    npz=Path("/Users/rc/ML projects/CF2L_AI/try_2/data/cross_color_dataset.npz"),
    checkpoint_dir=Path("/Users/rc/ML projects/CF2L_AI/try_2/checkpoints"),
    # ── model ──────────────────────────────────────────────────────────────────
    n_message_passes=5,  # GCN rounds
    hidden_dim=16,  # node dim during message passing
    post_conv_dim=8,  # single linear "conv" applied to each node after
    # all passes; flatten gives 54*8 = 432 → MLP input
    mlp_dropout=0.10,
    # ── loss ───────────────────────────────────────────────────────────────────
    # 0.0 → hard one-hot   0.1 → 10 % mass spread over 6 colours
    label_smoothing=0.10,
    # ── optimiser ──────────────────────────────────────────────────────────────
    lr=3e-4,
    weight_decay=1e-5,
    epochs=50,
    batch_size=512,
    # ── data split ─────────────────────────────────────────────────────────────
    val_frac=0.10,  # fraction of *solve_ids* held out
    seed=42,
    # ── hardware ───────────────────────────────────────────────────────────────
    device="auto",  # 'auto' → cuda → mps → cpu
    num_workers=4,  # set 0 on Windows if mmap causes issues
)
# ══════════════════════════════════════════════════════════════════════════════


# ── Dataset ────────────────────────────────────────────────────────────────────
class CubeDataset(Dataset):
    """mmap-backed — only requested rows are paged into RAM."""

    def __init__(self, npz_path: Path, indices: np.ndarray):
        raw = np.load(npz_path, mmap_mode="r")
        self.node_features = raw["node_features"]  # (N, 54, 6)
        self.labels = raw["labels"]  # (N, 6)
        self.indices = indices

    def __len__(self):
        return len(self.indices)

    def __getitem__(self, i):
        idx = self.indices[i]
        x = torch.from_numpy(self.node_features[idx].copy())  # (54, 6)
        y = torch.from_numpy(self.labels[idx].copy())  # (6,)
        return x, y


# ── Normalised adjacency ───────────────────────────────────────────────────────
def build_adj_norm(edge_index, edge_weights, n_nodes=54, device=None):
    """Â = D^{-½}(A + I)D^{-½}  — built once, reused every batch."""
    A = torch.zeros(n_nodes, n_nodes)
    for k in range(edge_index.shape[1]):
        A[int(edge_index[0, k]), int(edge_index[1, k])] = float(edge_weights[k])
    A += torch.eye(n_nodes)
    d = A.sum(1).pow(-0.5)
    return (d.unsqueeze(1) * A * d.unsqueeze(0)).to(device)


# ── Model ─────────────────────────────────────────────────────────────────────
class CubeGNN(nn.Module):
    """
    5 × message-pass (Â H W → BN → ReLU)
    → 1 post-conv  (node-wise linear, BN, ReLU)
    → flatten (54 × post_conv_dim)
    → MLP: 256 → 64 → 6   (three decreasing layers)

    Typical param count: ~20-30 k
    """

    def __init__(
        self,
        in_dim=6,
        hidden_dim=16,
        n_passes=5,
        post_conv_dim=8,
        mlp_dropout=0.10,
        n_classes=6,
        n_nodes=54,
    ):
        super().__init__()
        self.n_passes = n_passes
        self.n_nodes = n_nodes
        self.hidden_dim = hidden_dim
        self.post_conv_dim = post_conv_dim

        # ── message-passing layers ─────────────────────────────────────────────
        dims = [in_dim] + [hidden_dim] * n_passes
        self.mp_linears = nn.ModuleList(
            [nn.Linear(dims[i], dims[i + 1]) for i in range(n_passes)]
        )
        self.mp_bns = nn.ModuleList(
            [nn.BatchNorm1d(hidden_dim) for _ in range(n_passes)]
        )

        # ── single post-conv ───────────────────────────────────────────────────
        self.post_conv = nn.Linear(hidden_dim, post_conv_dim)
        self.post_conv_bn = nn.BatchNorm1d(post_conv_dim)

        # ── MLP head: three decreasing layers ─────────────────────────────────
        flat = n_nodes * post_conv_dim  # 54 × 8 = 432
        self.mlp = nn.Sequential(
            nn.Linear(flat, 256),
            nn.ReLU(),
            nn.Dropout(mlp_dropout),
            nn.Linear(256, 64),
            nn.ReLU(),
            nn.Linear(64, n_classes),
        )

    def forward(self, x, adj_norm):
        # x: (B, 54, in_dim)
        B = x.shape[0]

        # message passing
        for lin, bn in zip(self.mp_linears, self.mp_bns):
            h = torch.einsum("ij,bjk->bik", adj_norm, x)  # aggregate
            h = lin(h)  # transform
            h = bn(h.reshape(B * self.n_nodes, self.hidden_dim))
            x = F.relu(h).reshape(B, self.n_nodes, self.hidden_dim)

        # post-conv (one node-wise linear across all 54 nodes)
        h = self.post_conv(x)  # (B, 54, post_conv_dim)
        h = self.post_conv_bn(h.reshape(B * self.n_nodes, self.post_conv_dim))
        x = F.relu(h).reshape(B, self.n_nodes, self.post_conv_dim)

        return self.mlp(x.reshape(B, -1))  # (B, 6)


# ── Soft-label cross-entropy ───────────────────────────────────────────────────
class SoftLabelCrossEntropy(nn.Module):
    def __init__(self, smoothing=0.10, n_classes=6):
        super().__init__()
        self.smoothing = smoothing
        self.n_classes = n_classes

    def forward(self, logits, targets):
        if self.smoothing > 0:
            targets = targets * (1 - self.smoothing) + self.smoothing / self.n_classes
        return -(targets * F.log_softmax(logits, -1)).sum(-1).mean()


# ── Split by solve_id ──────────────────────────────────────────────────────────
def make_splits(cfg):
    raw = np.load(cfg.npz, mmap_mode="r")
    solve_ids = raw["solve_ids"]

    rng = np.random.default_rng(cfg.seed)
    unique_ids = np.unique(solve_ids)
    rng.shuffle(unique_ids)

    n_val = max(1, int(len(unique_ids) * cfg.val_frac))
    val_set = set(unique_ids[:n_val].tolist())

    all_idx = np.arange(len(solve_ids))
    train_idx = all_idx[[s not in val_set for s in solve_ids]]
    val_idx = all_idx[[s in val_set for s in solve_ids]]

    n = len(solve_ids)
    print(
        f"[split] {len(unique_ids)} solves  →  "
        f"{len(unique_ids)-n_val} train / {n_val} val solve_ids"
    )
    print(f"        {len(train_idx)} train samples  |  {len(val_idx)} val samples")
    return train_idx, val_idx


# ── Train / eval loop ──────────────────────────────────────────────────────────
def run_epoch(model, loader, adj_norm, criterion, optimiser, device, train):
    model.train(train)
    total_loss = total_correct = total_n = 0

    ctx = torch.enable_grad if train else torch.no_grad
    with ctx():
        for x, y in loader:
            x, y = x.to(device, non_blocking=True), y.to(device, non_blocking=True)
            logits = model(x, adj_norm)
            loss = criterion(logits, y)

            if train:
                optimiser.zero_grad(set_to_none=True)
                loss.backward()
                optimiser.step()

            with torch.no_grad():
                total_correct += (logits.argmax(1) == y.argmax(1)).sum().item()
            total_loss += loss.item() * x.size(0)
            total_n += x.size(0)

    return total_loss / total_n, total_correct / total_n


# ── Main ───────────────────────────────────────────────────────────────────────
def main():
    cfg = CFG
    torch.manual_seed(cfg.seed)
    np.random.seed(cfg.seed)

    if cfg.device == "auto":
        device = (
            torch.device("cuda")
            if torch.cuda.is_available()
            else (
                torch.device("mps")
                if torch.backends.mps.is_available()
                else torch.device("cpu")
            )
        )
    else:
        device = torch.device(cfg.device)
    print(f"[device] {device}")

    raw = np.load(cfg.npz, mmap_mode="r")
    adj_norm = build_adj_norm(raw["edge_index"], raw["edge_weights"], device=device)

    train_idx, val_idx = make_splits(cfg)

    pin = device.type == "cuda"
    pw = cfg.num_workers > 0
    train_loader = DataLoader(
        CubeDataset(cfg.npz, train_idx),
        batch_size=cfg.batch_size,
        shuffle=True,
        num_workers=cfg.num_workers,
        pin_memory=pin,
        persistent_workers=pw,
    )
    val_loader = DataLoader(
        CubeDataset(cfg.npz, val_idx),
        batch_size=cfg.batch_size * 2,
        shuffle=False,
        num_workers=cfg.num_workers,
        pin_memory=pin,
        persistent_workers=pw,
    )

    model = CubeGNN(
        hidden_dim=cfg.hidden_dim,
        n_passes=cfg.n_message_passes,
        post_conv_dim=cfg.post_conv_dim,
        mlp_dropout=cfg.mlp_dropout,
    ).to(device)

    n_params = sum(p.numel() for p in model.parameters() if p.requires_grad)
    print(
        f"[model] {n_params:,} params  |  hidden={cfg.hidden_dim}  "
        f"post_conv={cfg.post_conv_dim}  passes={cfg.n_message_passes}"
    )
    print(f"        MLP: {54*cfg.post_conv_dim} → 256 → 64 → 6")

    criterion = SoftLabelCrossEntropy(smoothing=cfg.label_smoothing)
    optimiser = torch.optim.AdamW(
        model.parameters(), lr=cfg.lr, weight_decay=cfg.weight_decay
    )
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(
        optimiser, T_max=cfg.epochs, eta_min=cfg.lr / 10
    )

    print(
        f"\n[train] smoothing={cfg.label_smoothing}  lr={cfg.lr}  "
        f"epochs={cfg.epochs}  batch={cfg.batch_size}"
    )
    print(f"        chance baseline ≈ {100/6:.1f}%  |  target > 50%\n")

    cfg.checkpoint_dir.mkdir(parents=True, exist_ok=True)
    best_val_acc = 0.0
    best_path = cfg.checkpoint_dir / "best_model.pt"

    hdr = (
        f"{'Epoch':>6}  {'Train Loss':>10}  {'Train Acc':>9}  "
        f"{'Val Loss':>9}  {'Val Acc':>8}  {'LR':>8}  {'Time':>6}"
    )
    print(hdr)
    print("─" * len(hdr))

    for epoch in range(1, cfg.epochs + 1):
        t0 = time.perf_counter()
        tr_loss, tr_acc = run_epoch(
            model, train_loader, adj_norm, criterion, optimiser, device, train=True
        )
        va_loss, va_acc = run_epoch(
            model, val_loader, adj_norm, criterion, optimiser, device, train=False
        )
        scheduler.step()

        print(
            f"{epoch:6d}  {tr_loss:10.4f}  {100*tr_acc:8.2f}%  "
            f"{va_loss:9.4f}  {100*va_acc:7.2f}%  "
            f"{scheduler.get_last_lr()[0]:8.2e}  {time.perf_counter()-t0:5.1f}s"
        )

        if va_acc > best_val_acc:
            best_val_acc = va_acc
            torch.save(
                {
                    "epoch": epoch,
                    "model_state": model.state_dict(),
                    "val_acc": va_acc,
                    "cfg": vars(cfg),
                },
                best_path,
            )

    print(f"\n[done] best val acc = {100*best_val_acc:.2f}%  →  {best_path}")


if __name__ == "__main__":
    main()
