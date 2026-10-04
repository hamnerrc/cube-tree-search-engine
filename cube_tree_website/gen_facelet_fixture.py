"""Regenerates test/facelet-fixture.json from the real `magiccube` package.

This is the ground-truth source for test/facelet-cube.test.js's
cross-verification of facelet-cube.js. Re-run this (from this directory) only
if facelet-cube.js's move semantics are deliberately changing (e.g. adding a
new move token) - the fixture is otherwise static, checked-in data.
"""

import json
import random
from pathlib import Path

from magiccube.cube import Cube

ALL_MOVES = []
for face in ["U", "D", "R", "L", "F", "B"]:
    for suf in ["", "'", "2"]:
        ALL_MOVES.append(face + suf)
for ax in ["x", "y", "z"]:
    for suf in ["", "'", "2"]:
        ALL_MOVES.append(ax + suf)
# Wide (WCA lowercase == magiccube "Rw") and slice moves, added 2026-10-04.
WIDE = {"r": "Rw", "l": "Lw", "u": "Uw", "d": "Dw", "f": "Fw", "b": "Bw", "M": "M", "E": "E", "S": "S"}
for ours in WIDE:
    for suf in ["", "'", "2"]:
        ALL_MOVES.append(ours + suf)


def to_magiccube(move):
    base = move.rstrip("'2")
    return WIDE.get(base, base) + move[len(base):]


def main():
    random.seed(20261003)

    cases = []
    for _ in range(500):
        length = random.randint(1, 30)
        moves = [random.choice(ALL_MOVES) for _ in range(length)]
        c = Cube(3)
        c.rotate(" ".join(to_magiccube(m) for m in moves))
        cases.append({"moves": moves, "facelets": c.get_kociemba_facelet_colors()})

    cases.append({"moves": [], "facelets": Cube(3).get_kociemba_facelet_colors()})
    for tok in ALL_MOVES:
        c = Cube(3)
        c.rotate(to_magiccube(tok))
        cases.append({"moves": [tok], "facelets": c.get_kociemba_facelet_colors()})

    out_path = Path(__file__).resolve().parent / "test" / "facelet-fixture.json"
    with open(out_path, "w") as f:
        json.dump(cases, f)
    print(f"Wrote {len(cases)} cases to {out_path}")


if __name__ == "__main__":
    main()
