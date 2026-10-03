import csv
import numpy as np
from magiccube import Cube
from pathlib import Path
from collections import Counter

# =========================
# Move encoding (54 moves total: 0-53)
# =========================

MOVE_LIST = [
    "R",
    "R'",
    "R2",
    "L",
    "L'",
    "L2",
    "U",
    "U'",
    "U2",
    "D",
    "D'",
    "D2",
    "F",
    "F'",
    "F2",
    "B",
    "B'",
    "B2",
    "r",
    "r'",
    "r2",
    "l",
    "l'",
    "l2",
    "u",
    "u'",
    "u2",
    "d",
    "d'",
    "d2",
    "f",
    "f'",
    "f2",
    "b",
    "b'",
    "b2",
    "M",
    "M'",
    "M2",
    "E",
    "E'",
    "E2",
    "S",
    "S'",
    "S2",
    "x",
    "x'",
    "x2",
    "y",
    "y'",
    "y2",
    "z",
    "z'",
    "z2",
]

MOVE_TO_ID = {m: i for i, m in enumerate(MOVE_LIST)}
ROTATIONS = {"x", "x'", "x2", "y", "y'", "y2", "z", "z'", "z2"}

# =========================
# Cube state encoding
# =========================

COLOR_TO_INT = {"W": 0, "R": 1, "G": 2, "Y": 3, "O": 4, "B": 5}


def cube_to_array(cube):
    """Return 54-length array in Kociemba order"""
    colors = cube.get_kociemba_facelet_colors()
    return [COLOR_TO_INT[c] for c in colors]


# =========================
# Move canonicalization
# =========================


def canonical_move(raw_move):
    """
    Returns canonical move for label lookup:
    - Face/slice moves: R,L,U,D,F,B,M,S,E → keep uppercase
    - Wide moves: r,l,u,d,f,b → keep lowercase
    - Rotations: x,y,z → lowercase
    - Remove invalid double-prime 2'
    """
    move = raw_move.replace("2'", "2")

    face = move[0]

    # Wide moves stay lowercase
    if face in "rludfb":
        return move
    # Uppercase face/slice moves
    elif face in "RLUDFBMSE":
        return move
    # Rotations stay lowercase
    elif face in "xyz":
        return move.lower()
    else:
        raise ValueError(f"Unknown move: {raw_move}")


# =========================
# Move translation for magiccube
# =========================


def to_magiccube(move):
    """
    Converts a move to magiccube notation:
    - wide moves: r->Rw, l->Lw, etc.
    - rotations x/y/z unchanged
    """
    if move in ROTATIONS:
        return move
    if move[0].islower() and move[0] in "rludfb":
        return move[0].upper() + "w" + move[1:]
    return move


# =========================
# Validation
# =========================


def validate_csv(csv_path, num_samples=5):
    """
    Validates first few rows of CSV to catch issues early.
    Returns: (is_valid, error_message, move_stats)
    """
    print(f"\n{'='*60}")
    print(f"VALIDATING: {csv_path.name}")
    print(f"{'='*60}")

    with open(csv_path) as f:
        reader = csv.DictReader(f)
        rows = [
            next(reader)
            for _ in range(
                min(num_samples, sum(1 for _ in csv.DictReader(open(csv_path))))
            )
        ]

    # Check required columns
    required_cols = ["solve_id", "solver", "scramble", "cross_f2l_raw"]
    missing = [col for col in required_cols if col not in rows[0].keys()]
    if missing:
        return False, f"Missing columns: {missing}", None

    move_counter = Counter()
    unknown_moves = set()

    for i, row in enumerate(rows):
        print(f"\nSample {i+1}:")
        print(f"  solve_id: {row['solve_id']}")
        print(f"  solver: {row['solver']}")
        print(f"  scramble: {row['scramble'][:50]}...")
        print(f"  solution: {row['cross_f2l_raw'][:50]}...")

        # Check scramble moves
        for move in row["scramble"].split():
            try:
                canonical = canonical_move(move)
                move_counter[canonical] += 1
            except ValueError as e:
                unknown_moves.add(move)

        # Check solution moves
        for move in row["cross_f2l_raw"].split():
            try:
                canonical = canonical_move(move)
                if canonical not in MOVE_TO_ID:
                    unknown_moves.add(canonical)
                move_counter[canonical] += 1
            except ValueError as e:
                unknown_moves.add(move)

    if unknown_moves:
        return False, f"Unknown moves found: {unknown_moves}", None

    print(f"\n✓ All moves recognized")
    print(f"✓ Move distribution looks good")
    print(f"  Total unique moves seen: {len(move_counter)}")
    print(f"  Most common: {move_counter.most_common(5)}")

    return True, None, move_counter


# =========================
# Process single CSV to NPZ
# =========================


def process_csv_to_npz(csv_path, npz_path, validate_first=True):
    """
    Reads a CSV and generates training samples with early validation.
    """
    # Validate first
    if validate_first:
        is_valid, error, stats = validate_csv(csv_path)
        if not is_valid:
            raise ValueError(f"Validation failed: {error}")

        user_input = input(f"\nProceed with processing? (y/n): ").strip().lower()
        if user_input != "y":
            print("Skipping this file.")
            return

    print(f"\n{'='*60}")
    print(f"PROCESSING: {csv_path.name}")
    print(f"{'='*60}")

    states = []
    labels = []
    solve_ids = []
    cn_indices = []
    rl_mirrored = []
    solvers = []

    with open(csv_path) as f:
        rows = list(csv.DictReader(f))

    total_rows = len(rows)

    for i, row in enumerate(rows):
        cube = Cube(3)

        # Apply scramble
        scramble = row["scramble"].split()
        scramble_magic = [to_magiccube(m) for m in scramble]
        cube.rotate(" ".join(scramble_magic))

        # Solution moves
        solution = row["cross_f2l_raw"].split()

        for raw_move in solution:
            move = canonical_move(raw_move)

            if move not in MOVE_TO_ID:
                raise ValueError(
                    f"Unrecognized move after canonicalization: {raw_move} -> {move}\n"
                    f"At solve_id: {row['solve_id']}, row {i+1}/{total_rows}"
                )

            # Record state and label
            states.append(cube_to_array(cube))
            labels.append(MOVE_TO_ID[move])

            # Record metadata
            solve_ids.append(row["solve_id"])
            solvers.append(row["solver"])
            cn_indices.append(row.get("CN_index", "0"))
            rl_mirrored.append(row.get("RL_mirrored", "0"))

            # Apply move to cube
            cube.rotate(to_magiccube(raw_move))

        # Progress bar (every 10%)
        if (i + 1) % max(1, total_rows // 10) == 0:
            progress = (i + 1) / total_rows * 100
            print(
                f"  Progress: {progress:.0f}% ({i+1}/{total_rows} solves, {len(states)} samples)"
            )

    # Convert to numpy arrays
    states_array = np.asarray(states, dtype=np.uint8)
    labels_array = np.asarray(labels, dtype=np.uint8)
    solve_ids_array = np.asarray(solve_ids, dtype=str)
    solvers_array = np.asarray(solvers, dtype=str)
    cn_indices_array = np.asarray(cn_indices, dtype=str)
    rl_mirrored_array = np.asarray(rl_mirrored, dtype=str)

    # Final statistics
    print(f"\n{'='*60}")
    print(f"STATISTICS FOR: {csv_path.name}")
    print(f"{'='*60}")
    print(f"  Total solves: {total_rows}")
    print(f"  Total samples: {len(states)}")
    print(f"  Avg moves/solve: {len(states)/total_rows:.1f}")
    print(f"  Label distribution (top 10):")
    label_counts = Counter(labels_array)
    for move_id, count in label_counts.most_common(10):
        move_name = MOVE_LIST[move_id]
        print(f"    {move_name}: {count} ({count/len(states)*100:.1f}%)")

    # Save compressed NPZ
    np.savez_compressed(
        npz_path,
        states=states_array,
        labels=labels_array,
        solve_ids=solve_ids_array,
        solvers=solvers_array,
        CN_index=cn_indices_array,
        RL_mirrored=rl_mirrored_array,
    )

    print(f"\n✓ Saved: {npz_path}")


# =========================
# Process all datasets
# =========================


def main():
    base_path = Path("/Users/rc/ML projects/CF2L_AI/data")

    csv_sets = [
        ("csv/training/original_train.csv", "npz/training/original_train.npz"),
        ("csv/training/RL_train.csv", "npz/training/RL_train.npz"),
        ("csv/training/cn_train.csv", "npz/training/cn_train.npz"),
        ("csv/training/cn_RL_train.csv", "npz/training/cn_RL_train.npz"),
        ("csv/validation/original_val.csv", "npz/validation/original_val.npz"),
        ("csv/validation/RL_val.csv", "npz/validation/RL_val.npz"),
        ("csv/validation/cn_val.csv", "npz/validation/cn_val.npz"),
        ("csv/validation/cn_RL_val.csv", "npz/validation/cn_RL_val.npz"),
    ]

    # Create output directories
    (base_path / "npz" / "training").mkdir(parents=True, exist_ok=True)
    (base_path / "npz" / "validation").mkdir(parents=True, exist_ok=True)

    print(f"\n{'#'*60}")
    print(f"# STARTING BATCH PROCESSING: {len(csv_sets)} FILES")
    print(f"{'#'*60}")

    for csv_rel, npz_rel in csv_sets:
        csv_path = base_path / csv_rel
        npz_path = base_path / npz_rel

        try:
            process_csv_to_npz(csv_path, npz_path, validate_first=True)
        except Exception as e:
            print(f"\n❌ ERROR processing {csv_path.name}: {e}")
            user_input = input("Continue with next file? (y/n): ").strip().lower()
            if user_input != "y":
                print("Stopping batch processing.")
                return

    print(f"\n{'#'*60}")
    print(f"# ALL PROCESSING COMPLETE!")
    print(f"{'#'*60}")


if __name__ == "__main__":
    main()
