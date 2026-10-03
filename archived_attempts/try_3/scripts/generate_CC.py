"""
generate_data.py
=================
Reads cross_color.csv and produces cross_color_dataset.npz.

For each of the N scrambles, all 16 orientation augmentations are applied:
    scramble + x_rot (none | x | x2 | x') + y_rot (none | y | y2 | y')

Final dataset size: N * 16 samples.

NPZ contents
------------
  cube_states  : float32 (N*16, 54, 6)  — one-hot colour per facelet
  rankings     : float32 (N*16,  6, 6)  — ordered one-hots, best → worst cross
  edge_index   : int32   (2, E)          — fixed geometry, stored once
  edge_weights : float32 (E,)            — fixed geometry, stored once
"""

import ast
import sys
from itertools import product
from pathlib import Path

import numpy as np
import pandas as pd
from tqdm import tqdm

# ──────────────────────────────────────────────
# Paths
# ──────────────────────────────────────────────
BASE_DIR = Path("/Users/rc/ML projects/CF2L_AI")
SCRIPT_DIR = BASE_DIR / "scripts"
CSV_PATH = BASE_DIR / "data" / "cross_color.csv"
OUT_PATH = BASE_DIR / "data" / "cross_color_dataset.npz"

sys.path.insert(0, str(SCRIPT_DIR))
from old.cubestate_encoder import (
    generate_solved_cube_graph,
    apply_scramble_to_graph,
)  # noqa: E402

# ──────────────────────────────────────────────
# Augmentation grid  (4 x-rots × 4 y-rots = 16)
# ──────────────────────────────────────────────
X_ROTS = ["", "x", "x2", "x'"]
Y_ROTS = ["", "y", "y2", "y'"]

# All 16 suffix strings  (empty string → no rotation appended)
AUG_SUFFIXES = [
    " ".join(filter(None, [xr, yr]))  # e.g. "x y2", "x'", "", ...
    for xr, yr in product(X_ROTS, Y_ROTS)
]
N_AUG = len(AUG_SUFFIXES)  # 16

# ──────────────────────────────────────────────
# Constants
# ──────────────────────────────────────────────
COLOR_TO_ONEHOT = {
    0: [1, 0, 0, 0, 0, 0],  # W
    1: [0, 1, 0, 0, 0, 0],  # R
    2: [0, 0, 1, 0, 0, 0],  # G
    3: [0, 0, 0, 1, 0, 0],  # Y
    4: [0, 0, 0, 0, 1, 0],  # O
    5: [0, 0, 0, 0, 0, 1],  # B
}


# ──────────────────────────────────────────────
# Graph helpers
# ──────────────────────────────────────────────
def extract_edge_arrays(base_graph: dict):
    """
    Build edge_index (2, E) and edge_weights (E,) from the fixed base graph.
    Edges are already stored bidirectionally in the adjacency list.
    """
    src_list, tgt_list, w_list = [], [], []
    for node_id in range(54):
        for neighbor_id, weight in base_graph[node_id]["neighbors"]:
            src_list.append(node_id)
            tgt_list.append(neighbor_id)
            w_list.append(weight)

    edge_index = np.array([src_list, tgt_list], dtype=np.int32)
    edge_weights = np.array(w_list, dtype=np.float32)
    return edge_index, edge_weights


def graph_to_state_array(graph: dict) -> np.ndarray:
    """54-node graph → (54, 6) float32 node-feature matrix."""
    return np.array([graph[i]["value"] for i in range(54)], dtype=np.float32)


def parse_ranking(raw: str) -> np.ndarray:
    """
    '[(3, 0), (1, 1), ...]'  →  (6, 6) float32 ordered one-hots, best → worst.
    Second tuple element (move count) is ignored.
    """
    tuples = ast.literal_eval(raw)
    return np.array([COLOR_TO_ONEHOT[t[0]] for t in tuples], dtype=np.float32)


# ──────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────
def main():
    print("Loading cube geometry (one-time)…")
    base_graph = generate_solved_cube_graph()

    edge_index, edge_weights = extract_edge_arrays(base_graph)
    print(
        f"  edge_index   : {edge_index.shape}  ({edge_index.shape[1]} directed edges)"
    )
    print(f"  edge_weights : {edge_weights.shape}\n")

    print(f"Reading CSV from {CSV_PATH} …")
    df = pd.read_csv(CSV_PATH)
    n_rows = len(df)
    n_total = n_rows * N_AUG
    print(
        f"Found {n_rows:,} rows × {N_AUG} augmentations = {n_total:,} total samples\n"
    )

    cube_states = np.empty((n_total, 54, 6), dtype=np.float32)
    rankings = np.empty((n_total, 6, 6), dtype=np.float32)

    skipped = 0
    out_idx = 0

    for _, row in tqdm(df.iterrows(), total=n_rows, unit="scramble"):
        try:
            scramble = str(row["scramble"]).strip()
            ranking = parse_ranking(row["best_cross"])  # same for all 16 augmentations

            for suffix in AUG_SUFFIXES:
                augmented_scramble = (scramble + " " + suffix).strip()
                graph = apply_scramble_to_graph(base_graph, augmented_scramble)
                cube_states[out_idx] = graph_to_state_array(graph)
                rankings[out_idx] = ranking
                out_idx += 1

        except Exception as exc:
            # Zero-fill all 16 slots for this scramble so indices stay aligned
            print(f"\n[WARNING] Scramble '{row.get('scramble', '?')}' skipped — {exc}")
            for _ in AUG_SUFFIXES:
                cube_states[out_idx] = np.zeros((54, 6), dtype=np.float32)
                rankings[out_idx] = np.zeros((6, 6), dtype=np.float32)
                out_idx += 1
            skipped += 1

    print(f"\nSaving to {OUT_PATH} …")
    np.savez_compressed(
        OUT_PATH,
        cube_states=cube_states,  # (N*16, 54, 6)
        rankings=rankings,  # (N*16,  6, 6)
        edge_index=edge_index,  # (2, E)  — fixed, stored once
        edge_weights=edge_weights,  # (E,)    — fixed, stored once
    )

    print(f"\n✓ Done.")
    print(f"  cube_states  : {cube_states.shape}")
    print(f"  rankings     : {rankings.shape}")
    print(f"  edge_index   : {edge_index.shape}")
    print(f"  edge_weights : {edge_weights.shape}")
    if skipped:
        print(
            f"\n  ⚠  {skipped} base scrambles ({skipped * N_AUG} samples) were zeroed out."
        )


if __name__ == "__main__":
    main()
