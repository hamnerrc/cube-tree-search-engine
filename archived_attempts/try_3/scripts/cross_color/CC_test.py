import sys
from pathlib import Path
import torch
import numpy as np
import time

# ==========================================
# AUTOMATIC PATH CONFIGURATION & IMPORTS
# ==========================================
CURRENT_DIR = Path(__file__).resolve().parent  # scripts/cross_color
SCRIPT_DIR = CURRENT_DIR.parent  # scripts
BASE_DIR = SCRIPT_DIR.parent  # CF2L_AI

CHECKPOINT_PATH = BASE_DIR / "checkpoints" / "CC_gnn_250k.pt"

for path in [str(SCRIPT_DIR), str(CURRENT_DIR)]:
    if path not in sys.path:
        sys.path.insert(0, path)

from old.cubestate_encoder import generate_solved_cube_graph, apply_scramble_to_graph
from old.try_3.scripts.generate_CC import extract_edge_arrays, graph_to_state_array
from train_CC import CrossColorGNN

# Aligned explicitly with your training script's target map sequence
INT_TO_COLOR = {0: "W", 1: "R", 2: "G", 3: "Y", 4: "O", 5: "B"}
COLOR_NAME = {
    "W": "White",
    "R": "Red",
    "G": "Green",
    "Y": "Yellow",
    "O": "Orange",
    "B": "Blue",
}


# ==========================================
# RUNTIME ENGINE
# ==========================================
class CubeInferenceEngine:
    def __init__(self, checkpoint_path=CHECKPOINT_PATH):
        print("🚀 Initializing Fixed GNN Inference Engine...")
        self.base_graph = generate_solved_cube_graph()
        edge_index, edge_weights = extract_edge_arrays(self.base_graph)

        self.edge_index_tensor = torch.tensor(edge_index, dtype=torch.long)
        self.edge_weights_tensor = torch.tensor(edge_weights, dtype=torch.float32)
        self.batch_tensor = torch.zeros(54, dtype=torch.long)

        print(f"📦 Loading weights from {checkpoint_path}...")
        checkpoint = torch.load(checkpoint_path, map_location="cpu")

        self.model = CrossColorGNN(n_prop=4, hidden=256, mlp_hidden=512)
        self.model.load_state_dict(checkpoint["model_state"])
        self.model.eval()
        self.model = torch.inference_mode()(self.model)
        print("✅ Engine Ready.")

    def predict(self, scramble_str: str):
        # Apply pure scramble with no trailing positional strings
        scrambled_graph = apply_scramble_to_graph(self.base_graph, scramble_str)
        x = graph_to_state_array(scrambled_graph)
        x_tensor = torch.tensor(x, dtype=torch.float32)

        with torch.inference_mode():
            try:
                logits = self.model(
                    x_tensor,
                    self.edge_index_tensor,
                    self.edge_weights_tensor,
                    self.batch_tensor,
                )
            except RuntimeError:
                x_batched = x_tensor.unsqueeze(0)
                logits = self.model(
                    x_batched,
                    self.edge_index_tensor,
                    self.edge_weights_tensor,
                    self.batch_tensor,
                )

            raw_scores = logits.squeeze(0).cpu().numpy()
        return raw_scores

    def print_rankings(self, raw_scores: np.ndarray, scramble_str: str):
        sorted_indices = np.argsort(raw_scores)[::-1]

        print("\n" + "=" * 60)
        print(f"🔮 ALIGNED RANKING PREDICTIONS FOR:")
        print(f"   {scramble_str}")
        print("=" * 60)

        for rank_idx, color_idx in enumerate(sorted_indices):
            color_char = INT_TO_COLOR[color_idx]
            full_name = COLOR_NAME[color_char]
            score_val = raw_scores[color_idx]

            marker = "🌟 [BEST]" if rank_idx == 0 else f"     Rank {rank_idx + 1}"
            print(
                f"{marker} -> {color_char} ({full_name:6s})  | Utility Score: {score_val:8.4f}"
            )
        print("=" * 60 + "\n")


if __name__ == "__main__":
    engine = CubeInferenceEngine()

    # Pass an actual un-augmented scramble from your evaluation set
    SCRAMBLE_TO_TEST = "D' F2 B' L B2 U' B R' D' R2 D2 L2 F U2 F D2 F U2 R2 D2"

    start_time = time.perf_counter()
    scores = engine.predict(SCRAMBLE_TO_TEST)
    end_time = time.perf_counter()

    engine.print_rankings(scores, SCRAMBLE_TO_TEST)
    print(f"⏱️ Model Inference Time: {(end_time - start_time) * 1000:.2f} ms")
