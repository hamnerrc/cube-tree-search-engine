"""Empirically verify corner-only / edge-only facelet masks for pseudo
(half-pair) F2L slot checking, derived from facelet-flags.js's existing
BL/BR/FL/FR masks by parity-splitting local face positions {0,2,6,8}=corner
vs {1,3,5,7}=edge. Cross-checked against magiccube's own piece-identity API
(not just re-deriving the split and trusting it), per this repo's
"never hand-derive rotation/slot facts" rule.
"""
import random
from magiccube.cube import Cube
from magiccube.cube_base import Face

FACE_ENUM = {'U': Face.U, 'R': Face.R, 'F': Face.F, 'D': Face.D, 'L': Face.L, 'B': Face.B}
FACE_ORDER = 'URFDLB'

# Existing combined masks (facelet-flags.js) -- ground truth for the split.
MASKS = {
    'BL': 'WWWWWWWWWRRRRRRRRRGGGGGGGGGYYYYYYyYYOOOoOOoOOBBBBBbBBb',
    'BR': 'WWWWWWWWWRRRRRrRRrGGGGGGGGGYYYYYYYYyOOOOOOOOOBBBbBBbBB',
    'FL': 'WWWWWWWWWRRRRRRRRRGGGgGGgGGyYYYYYYYYOOOOOoOOoBBBBBBBBB',
    'FR': 'WWWWWWWWWRRRrRRrRRGGGGGgGGgYYyYYYYYYOOOOOOOOOBBBBBBBBB',
}

CENTERS = {'U': 4, 'R': 13, 'F': 22, 'D': 31, 'L': 40, 'B': 49}

def split_mask(mask, kind):
    out = list(mask)
    for i, ch in enumerate(mask):
        if ch.islower():
            local = i % 9
            is_corner = local in (0, 2, 6, 8)
            keep = is_corner if kind == 'corner' else not is_corner
            if not keep:
                out[i] = ch.upper()
    return ''.join(out)

CORNER_MASKS = {k: split_mask(v, 'corner') for k, v in MASKS.items()}
EDGE_MASKS = {k: split_mask(v, 'edge') for k, v in MASKS.items()}

def mask_passes(facelets, mask):
    for pos in range(54):
        if mask[pos].islower():
            face = FACE_ORDER[pos // 9]
            if facelets[pos] != facelets[CENTERS[face]]:
                return False
    return True

# Slot -> (corner coord, edge coord, corner axis->face map, edge axis->face map)
SLOT_GEOM = {
    'FR': {'corner_coord': (2, 0, 2), 'edge_coord': (2, 1, 2), 'axes': {0: 'R', 1: 'D', 2: 'F'}},
    'FL': {'corner_coord': (0, 0, 2), 'edge_coord': (0, 1, 2), 'axes': {0: 'L', 1: 'D', 2: 'F'}},
    'BL': {'corner_coord': (0, 0, 0), 'edge_coord': (0, 1, 0), 'axes': {0: 'L', 1: 'D', 2: 'B'}},
    'BR': {'corner_coord': (2, 0, 0), 'edge_coord': (2, 1, 0), 'axes': {0: 'R', 1: 'D', 2: 'B'}},
}

def ground_truth(cube, slot):
    geom = SLOT_GEOM[slot]
    corner = cube.get_piece(geom['corner_coord'])
    edge = cube.get_piece(geom['edge_coord'])
    corner_ok = all(
        corner.get_piece_color(ax) == cube.get_face(FACE_ENUM[face])[1][1]
        for ax, face in geom['axes'].items()
    )
    edge_ok = all(
        edge.get_piece_color(ax) == cube.get_face(FACE_ENUM[face])[1][1]
        for ax, face in geom['axes'].items()
        if edge.get_piece_color(ax) is not None
    )
    return corner_ok, edge_ok

ALL_MOVES = []
for face in ["U", "D", "R", "L", "F", "B"]:
    for suf in ["", "'", "2"]:
        ALL_MOVES.append(face + suf)
for ax in ["x", "y", "z"]:
    for suf in ["", "'", "2"]:
        ALL_MOVES.append(ax + suf)

random.seed(20261004)
TRIALS = 500
mismatches = []
checked = 0
for _ in range(TRIALS):
    length = random.randint(0, 25)
    moves = [random.choice(ALL_MOVES) for _ in range(length)]
    c = Cube(3)
    if moves:
        c.rotate(" ".join(moves))
    facelets = c.get_kociemba_facelet_colors()
    for slot in ('FR', 'FL', 'BL', 'BR'):
        corner_truth, edge_truth = ground_truth(c, slot)
        corner_mask_result = mask_passes(facelets, CORNER_MASKS[slot])
        edge_mask_result = mask_passes(facelets, EDGE_MASKS[slot])
        full_mask_result = mask_passes(facelets, MASKS[slot])
        checked += 1
        if corner_mask_result != corner_truth:
            mismatches.append((slot, 'corner', moves, corner_truth, corner_mask_result))
        if edge_mask_result != edge_truth:
            mismatches.append((slot, 'edge', moves, edge_truth, edge_mask_result))
        # Sanity: full mask should equal corner_truth AND edge_truth
        if full_mask_result != (corner_truth and edge_truth):
            mismatches.append((slot, 'full-vs-ground-truth', moves, (corner_truth, edge_truth), full_mask_result))

print(f"Checked {checked} (scramble, slot) combinations across {TRIALS} random scrambles.")
if mismatches:
    print(f"FOUND {len(mismatches)} MISMATCHES (first 10):")
    for m in mismatches[:10]:
        print(m)
else:
    print("ALL MATCHED. Corner-only / edge-only mask split is verified correct.")

print()
print("CORNER_MASKS =", CORNER_MASKS)
print("EDGE_MASKS =", EDGE_MASKS)
