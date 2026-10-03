# Quick NPZ inspector script
# Run this in the same directory as your CF2L_AI/ folder
# or adjust the relative path below

import numpy as np

# Pick one file to inspect (change as needed)
FILE = "data/npz/training/cn_RL_train.npz"  # ← most informative one
# Alternatives you can try:
# FILE = "data/npz/validation/cn_RL_val.npz"
# FILE = "data/npz/training/original_train.npz"

print(f"Inspecting file: {FILE}\n")

try:
    # Load the .npz
    data = np.load(FILE, allow_pickle=False)
    keys = list(data.keys())
    print("Keys present in the .npz file:", keys)
    print("-" * 60)

    for key in keys:
        arr = data[key]
        print(f"Array '{key}':")
        print(f"  Shape:       {arr.shape}")
        print(f"  Dtype:       {arr.dtype}")
        print(f"  Size:        {arr.size:,} elements")

        if arr.size > 0:
            print(f"  Min value:   {arr.min()}")
            print(f"  Max value:   {arr.max()}")

        # Small previews depending on shape
        if arr.ndim == 1:
            print(f"  First 10 values: {arr[:10]}")
            if len(arr) > 10:
                print(f"  Last 3 values:   {arr[-3:]}")
        elif arr.ndim == 2:
            print(f"  First row (10 elements): {arr[0][:10]} ...")
            print(f"  Unique values in first row: {np.unique(arr[0])}")
            print(f"  Unique values overall:      {np.unique(arr)}")
        print()

    # Special human-friendly summary if we see the expected keys
    if "states" in data and "moves" in data:
        states = data["states"]
        moves = data["moves"]

        print("SUMMARY - Expected cube training format:")
        print(f"  → {states.shape[0]:,} training examples")
        print(
            f"  → Each state is a flat array of {states.shape[1]} integers (stickers)"
        )
        print(
            f"  → Sticker values range: {states.min()} – {states.max()} (should be 0–5 for colors)"
        )
        print(
            f"  → Move labels: {moves.min()} – {moves.max()} (should be 0–53 according to your MOVE_LIST)"
        )

        unique_moves, counts = np.unique(moves, return_counts=True)
        print(f"  → Number of unique move ids: {len(unique_moves)}")
        print(f"  → Most common moves (id: count):")
        for mid, cnt in sorted(zip(unique_moves, counts), key=lambda x: -x[1])[:10]:
            print(f"      {mid:2d} → {cnt:,} times")

    print("\nDone! You can now adjust your model input/output shapes accordingly.")

except FileNotFoundError:
    print(f"ERROR: File not found: {FILE}")
    print("Make sure you're running this script from the CF2L_AI/ project root")
    print("Current directory contents (for reference):")
    import os

    print(os.listdir("."))
except Exception as e:
    print(f"Unexpected error: {type(e).__name__}: {str(e)}")
