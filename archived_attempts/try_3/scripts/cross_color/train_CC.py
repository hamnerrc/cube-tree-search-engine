"""
train_polish.py
===============
Polishing / Fine-tuning stage for CrossColorGNN
"""

import time
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import DataLoader, Dataset, random_split
from torch_geometric.nn import MessagePassing, global_mean_pool

# ── Paths ──────────────────────────────────────────────────────────────────
BASE_DIR = Path("/Users/rc/ML projects/CF2L_AI")
DATA_PATH = BASE_DIR / "data" / "CC_dataset.npz"
CKPT_DIR = BASE_DIR / "checkpoints"

# ── Hyperparameters (Polishing) ────────────────────────────────────────────
BATCH_SIZE = 2048
LR = 5e-5
EPOCHS = 160
VAL_SPLIT = 0.10
N_PROP = 4
HIDDEN = 256
MLP_HIDDEN = 512

PATIENCE = 25
MIN_DELTA = 1e-6

if torch.backends.mps.is_available():
    DEVICE = "mps"
elif torch.cuda.is_available():
    DEVICE = "cuda"
else:
    DEVICE = "cpu"


# ═══════════════════════════════════════════════════════════════════════════
# Dataset, Graph, Model
# ═══════════════════════════════════════════════════════════════════════════


class CubeDataset(Dataset):
    def __init__(self, cube_states: torch.Tensor, rankings: torch.Tensor):
        self.cube_states = cube_states
        self.rankings = rankings

    def __len__(self):
        return len(self.cube_states)

    def __getitem__(self, idx):
        return self.cube_states[idx], self.rankings[idx]


def batch_graph(cube_states, edge_index, edge_weights, device):
    B = cube_states.shape[0]
    E = edge_index.shape[1]
    x = cube_states.reshape(B * 54, 6).to(device)
    offset = torch.arange(B, device=device).repeat_interleave(E) * 54
    ei = edge_index.unsqueeze(0).expand(B, -1, -1).permute(1, 0, 2).reshape(
        2, B * E
    ) + offset.unsqueeze(0)
    ew = edge_weights.unsqueeze(0).expand(B, -1).reshape(B * E)
    batch_vec = torch.arange(B, device=device).repeat_interleave(54)
    return x, ei, ew, batch_vec


class WeightedPropagation(MessagePassing):
    def __init__(self, channels: int):
        super().__init__(aggr="add")
        self.norm = nn.LayerNorm(channels)

    def forward(self, x, edge_index, edge_weight):
        agg = self.propagate(edge_index, x=x, edge_weight=edge_weight)
        return self.norm(x + agg)

    def message(self, x_j, edge_weight):
        return edge_weight.unsqueeze(-1) * x_j


class GCNLayer(MessagePassing):
    def __init__(self, in_channels: int, out_channels: int):
        super().__init__(aggr="add")
        self.linear = nn.Linear(in_channels, out_channels, bias=False)
        self.bias = nn.Parameter(torch.zeros(out_channels))
        self.norm = nn.LayerNorm(out_channels)

    def forward(self, x, edge_index, edge_weight):
        agg = self.propagate(edge_index, x=x, edge_weight=edge_weight)
        return self.norm(F.relu(self.linear(agg) + self.bias))

    def message(self, x_j, edge_weight):
        return edge_weight.unsqueeze(-1) * x_j


class CrossColorGNN(nn.Module):
    def __init__(
        self, n_prop: int = N_PROP, hidden: int = HIDDEN, mlp_hidden: int = MLP_HIDDEN
    ):
        super().__init__()
        self.prop = nn.ModuleList([WeightedPropagation(6) for _ in range(n_prop)])
        self.conv = GCNLayer(6, hidden)
        self.mlp = nn.Sequential(
            nn.Linear(hidden, mlp_hidden),
            nn.ReLU(),
            nn.Dropout(0.01),
            nn.Linear(mlp_hidden, 256),
            nn.ReLU(),
            nn.Dropout(0.01),
            nn.Linear(256, 6),
        )

    def forward(self, x, edge_index, edge_weight, batch):
        for prop in self.prop:
            x = prop(x, edge_index, edge_weight)
        x = self.conv(x, edge_index, edge_weight)
        x = global_mean_pool(x, batch)
        return self.mlp(x)


# ═══════════════════════════════════════════════════════════════════════════
# Loss & Metrics
# ═══════════════════════════════════════════════════════════════════════════

_PAIR_MASK = torch.triu(torch.ones(6, 6, dtype=torch.bool), diagonal=1)


def pairwise_ranking_loss(scores, rankings):
    ranked = rankings.argmax(dim=-1)
    ranked_scores = scores.gather(1, ranked)
    diff = ranked_scores.unsqueeze(2) - ranked_scores.unsqueeze(1)
    mask = _PAIR_MASK.to(scores.device)
    return F.softplus(-diff[:, mask]).mean()


@torch.no_grad()
def topk_accuracy(scores: torch.Tensor, rankings: torch.Tensor, k: int = 1):
    true_best = rankings[:, 0, :].argmax(dim=-1)
    _, pred_topk = scores.topk(k, dim=1)
    correct = (pred_topk == true_best.unsqueeze(1)).any(dim=1)
    return correct.float().mean().item()


# ═══════════════════════════════════════════════════════════════════════════
# Run Epoch
# ═══════════════════════════════════════════════════════════════════════════


def run_epoch(
    model,
    loader,
    edge_index,
    edge_weights,
    optimizer,
    device,
    train=True,
    scheduler=None,
):
    model.train(train)
    total_loss = total_acc1 = total_acc2 = total_acc3 = n_samples = 0.0

    with torch.set_grad_enabled(train):
        for cube_states, rankings in loader:
            rankings = rankings.to(device)
            x, ei, ew, bv = batch_graph(cube_states, edge_index, edge_weights, device)
            scores = model(x, ei, ew, bv)
            loss = pairwise_ranking_loss(scores, rankings)

            if train:
                optimizer.zero_grad()
                loss.backward()
                nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)
                optimizer.step()
                if scheduler is not None:
                    scheduler.step()

            B = cube_states.shape[0]
            total_loss += loss.item() * B
            total_acc1 += topk_accuracy(scores.detach(), rankings, k=1) * B
            total_acc2 += topk_accuracy(scores.detach(), rankings, k=2) * B
            total_acc3 += topk_accuracy(scores.detach(), rankings, k=3) * B
            n_samples += B

    return (
        total_loss / n_samples,
        total_acc1 / n_samples,
        total_acc2 / n_samples,
        total_acc3 / n_samples,
    )


# ═══════════════════════════════════════════════════════════════════════════
# Main
# ═══════════════════════════════════════════════════════════════════════════


def main():
    print(f"Device : {DEVICE}\n")

    raw = np.load(DATA_PATH)
    cube_states = torch.from_numpy(raw["cube_states"])
    rankings = torch.from_numpy(raw["rankings"])
    edge_index = torch.from_numpy(raw["edge_index"]).long().to(DEVICE)
    edge_weights = torch.from_numpy(raw["edge_weights"]).to(DEVICE)

    full_dataset = CubeDataset(cube_states, rankings)
    n_val = int(len(full_dataset) * VAL_SPLIT)
    n_train = len(full_dataset) - n_val

    train_set, val_set = random_split(
        full_dataset, [n_train, n_val], generator=torch.Generator().manual_seed(42)
    )

    train_loader = DataLoader(
        train_set,
        batch_size=BATCH_SIZE,
        shuffle=True,
        num_workers=4,
        pin_memory=(DEVICE != "mps"),
    )
    val_loader = DataLoader(
        val_set,
        batch_size=BATCH_SIZE,
        shuffle=False,
        num_workers=4,
        pin_memory=(DEVICE != "mps"),
    )

    model = CrossColorGNN().to(DEVICE)
    optimizer = torch.optim.AdamW(model.parameters(), lr=LR, weight_decay=1e-4)

    total_steps = EPOCHS * len(train_loader)
    scheduler = torch.optim.lr_scheduler.OneCycleLR(
        optimizer,
        max_lr=LR,
        total_steps=total_steps,
        pct_start=0.08,
        anneal_strategy="cos",
        div_factor=10,
        final_div_factor=2000,
    )

    CKPT_DIR.mkdir(parents=True, exist_ok=True)
    ckpt_path = CKPT_DIR / "CC_gnn_250k.pt"  # ← Using your original name

    start_epoch = 1
    best_val_loss = float("inf")
    patience_counter = 0

    if ckpt_path.exists():
        print(f"✅ Resuming from checkpoint: {ckpt_path}")
        checkpoint = torch.load(ckpt_path, map_location=DEVICE, weights_only=True)
        model.load_state_dict(checkpoint["model_state"])
        optimizer.load_state_dict(checkpoint["optimizer_state"])
        start_epoch = checkpoint["epoch"] + 1
        best_val_loss = checkpoint.get("val_loss", float("inf"))
        print(
            f"   Resuming at epoch {start_epoch} | Best val loss: {best_val_loss:.6f}"
        )

    print(f"Train : {n_train:,}   Val : {n_val:,}   Batch : {BATCH_SIZE}\n")
    print(
        f"Parameters : {sum(p.numel() for p in model.parameters() if p.requires_grad):,}\n"
    )

    header = f"{'Epoch':>6}  {'Train Loss':>11}  {'T1':>6}  {'T2':>6}  {'T3':>6}  {'Val Loss':>10}  {'V1':>6}  {'V2':>6}  {'V3':>6}  {'LR':>8}  {'s/ep':>6}"
    print(header)
    print("─" * len(header))

    for epoch in range(start_epoch, EPOCHS + 1):
        t0 = time.time()

        tr_loss, tr1, tr2, tr3 = run_epoch(
            model,
            train_loader,
            edge_index,
            edge_weights,
            optimizer,
            DEVICE,
            train=True,
            scheduler=scheduler,
        )
        vl_loss, vl1, vl2, vl3 = run_epoch(
            model, val_loader, edge_index, edge_weights, None, DEVICE, train=False
        )

        elapsed = time.time() - t0
        current_lr = scheduler.get_last_lr()[0]

        improved = vl_loss < best_val_loss - MIN_DELTA
        if improved:
            best_val_loss = vl_loss
            patience_counter = 0
            torch.save(
                {
                    "epoch": epoch,
                    "model_state": model.state_dict(),
                    "optimizer_state": optimizer.state_dict(),
                    "val_loss": best_val_loss,
                },
                ckpt_path,
            )
            marker = " ✓"
        else:
            patience_counter += 1
            marker = ""

        print(
            f"{epoch:>6}  {tr_loss:>11.6f}  {tr1:>6.1%}  {tr2:>6.1%}  {tr3:>6.1%}  "
            f"{vl_loss:>10.6f}  {vl1:>6.1%}  {vl2:>6.1%}  {vl3:>6.1%}  "
            f"{current_lr:>8.2e}  {elapsed:>5.1f}s{marker}"
        )

        if patience_counter >= PATIENCE:
            print(
                f"\n🛑 Early stopping triggered after {patience_counter} epochs without improvement."
            )
            break

    print(f"\n✓ Polishing finished. Best val loss: {best_val_loss:.6f}")


if __name__ == "__main__":
    main()
