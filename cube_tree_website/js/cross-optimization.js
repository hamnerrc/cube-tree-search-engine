/**
 * cross-optimization.js — README "Wide moves and Cross optimisation".
 *
 * Post-hoc, first-step-only transform applied to an ordinary (face-turn
 * only) Cross solution: explores rewriting some subset of its L/L'/L2/
 * R/R'/R2/D/D' moves into their wide-move equivalent, tracking the
 * cumulative whole-cube rotation that substitution implies, and keeps
 * only the rewrites that still leave cross on the D (bottom) face.
 *
 * Everything here is derived from, and verified against, facelet-cube.js's
 * already-`magiccube`-verified move permutations — never hand-derived (see
 * PROJECT_STATUS.md's standing rule on this). Two things were specifically
 * checked against `magiccube` before writing this file (not just assumed
 * from the README's prose):
 *
 * 1. The six equivalences themselves (README "Wide moves and Cross
 *    optimisation"): `Rw == L x`, `Rw' == L' x'`, `Rw2 == L2 x2`,
 *    `Lw == R x'`, `Lw' == R' x`, `Lw2 == R2 x2`, `Uw == D y`,
 *    `Uw' == D' y'`, `Uw2 == D2 y2` (magiccube's `Rw`/`Lw`/`Uw` notation
 *    for wide moves) — all confirmed to hold exactly, for 20 random
 *    pre-scrambles each, not just from a solved cube.
 * 2. The move-relabeling rule needed once a rotation has already happened:
 *    for a pending rotation `rho` and an originally-intended move `M`
 *    (meant for the ROTATED-not-yet-happened frame), the move to type
 *    literally RIGHT NOW is `M'` satisfying `compose(rho, M') ==
 *    compose(M, rho)` — i.e. doing `rho` then `M'` has the same effect as
 *    doing `M` then `rho` would have. Solving: `M' = composePerm(
 *    invertPerm(rho), composePerm(M, rho))`. Verified by brute-force
 *    search (trying all 18 face turns and checking which one satisfies the
 *    equation) for `rho=x`, confirming the closed form matches, and that
 *    it produces a valid face-turn permutation for every input — not just
 *    for the specific move being converted.
 *
 * Why this relabeling matters, and why conversions are not just free text
 * substitution: `Rw` is DEFINED as "L then x" — so swapping an `L` in the
 * original algorithm for `r` is not a like-for-like substitution, it
 * SECRETLY also performs the `x` rotation as part of that one wide turn.
 * Every move after that point in the original algorithm was written
 * assuming no such rotation ever happened, so it must be relabeled to
 * keep referring to the same PHYSICAL layer. A short inductive argument
 * (see PROJECT_STATUS.md §4.5 or the implementation history) shows this
 * relabeling scheme makes the whole rewritten sequence exactly equal to
 * "the original algorithm, followed by the final accumulated rotation" —
 * which is exactly why the orientation filter (reject unless the final
 * accumulated rotation leaves D mapped to D) is correct: cross was already
 * solved on D by the original algorithm, and a trailing pure y-rotation
 * can't move it off D, while a trailing rotation with any x/z component
 * can and does.
 *
 * `y2` is never used as a conversion's rotation increment (dropping `D2`
 * from the convertible set) per the README's explicit "y2 is forbidden as
 * a mid-algorithm move" rule.
 *
 * NOTATION (corrected 2026-10-04, PROJECT_STATUS.md §4.19): the D-layer
 * conversion emits "u"/"u'", exactly as the README says ("u = D + y"). Wide
 * U turns the top two layers, which is the same as turning D and rotating
 * the whole cube by y. An earlier version emitted "d"/"d'" on the mistaken
 * belief that the engine's "u" meant something else; the engine, magiccube
 * and facelet-cube.js all read "d" as U + y', so every such result was
 * physically wrong once committed (0 next-step candidates, cross broken).
 */
'use strict';

// Each entry: converting this literal (already-relabeled) move emits
// `wide` and accumulates `rotation` into the running cumulative rotation.
// D2 is deliberately absent -- its only wide form needs a y2 rotation,
// which the README forbids mid-algorithm.
const WIDE_MOVE_RULES = {
    L: { wide: 'r', rotation: 'x' },
    "L'": { wide: "r'", rotation: "x'" },
    L2: { wide: 'r2', rotation: 'x2' },
    R: { wide: 'l', rotation: "x'" },
    "R'": { wide: "l'", rotation: 'x' },
    R2: { wide: 'l2', rotation: 'x2' },
    D: { wide: 'u', rotation: 'y' },
    "D'": { wide: "u'", rotation: "y'" },
};

/** M' such that compose(rho, M') == compose(M, rho) -- see header comment. */
function relabelMovePerm(movePerm, rhoPerm) {
    return composePerm(invertPerm(rhoPerm), composePerm(movePerm, rhoPerm));
}

const FACE_TURN_NAMES = ['U', "U'", 'U2', 'D', "D'", 'D2', 'R', "R'", 'R2', 'L', "L'", 'L2', 'F', "F'", 'F2', 'B', "B'", 'B2'];

function findFaceTurnName(perm) {
    const s = perm.join(',');
    for (const name of FACE_TURN_NAMES) {
        if (MOVE_TABLE[name].join(',') === s) return name;
    }
    return null; // not a pure face turn (shouldn't happen for a valid rho)
}

/** Does rotation `rhoPerm` leave the D face mapped to D (cross stays on bottom)? */
function keepsCrossOnBottom(rhoPerm) {
    return findFaceTurnName(relabelMovePerm(MOVE_TABLE.D, rhoPerm)) === 'D';
}

/**
 * Explores every subset of convertible-move positions in `moves` (a
 * tokenized face-turn-only algorithm), relabeling every move by whichever
 * rotation has accumulated so far, and keeps only the combinations whose
 * final accumulated rotation leaves cross on the bottom face.
 *
 * Returns an array of { moves: string[], rotation: '' | 'y' | 'y2' | "y'" }
 * — `moves` is the rewritten algorithm (wide tokens where converted, plain
 * relabeled face turns otherwise), `rotation` is the final residual
 * whole-cube rotation (always a pure y-rotation, by construction of the
 * filter above). The all-identical-to-original (no conversions) case is
 * included, with `rotation: ''`.
 */
const ROTATION_NAME_BY_PERM = { '': IDENTITY_PERM, y: MOVE_TABLE.y, y2: MOVE_TABLE.y2, "y'": MOVE_TABLE["y'"] };

function rotationNameFor(rhoPerm) {
    const s = rhoPerm.join(',');
    for (const [name, perm] of Object.entries(ROTATION_NAME_BY_PERM)) {
        if (perm.join(',') === s) return name;
    }
    return null; // shouldn't happen once keepsCrossOnBottom has already passed
}

// Canonical face-turn name of any MOVE_TABLE token that is a face turn
// (findFaceTurnName's answer), built once on first use.
let faceNameOfToken = null;
function canonicalFaceName(token) {
    if (!faceNameOfToken) {
        faceNameOfToken = new Map();
        for (const t of Object.keys(MOVE_TABLE)) faceNameOfToken.set(t, findFaceTurnName(MOVE_TABLE[t]));
    }
    return token ? faceNameOfToken.get(token) || null : null;
}

/*
 * PROJECT_STATUS.md §4.36 (performance): the original enumerated all 2^n
 * masks over the n moves, composing 54-element permutations and comparing
 * against 18 joined permutation strings per move -- 41% of a root search's
 * time with every option on. A bit only matters at a position whose
 * (relabelled) move has a wide form, so this walks the choices depth-first
 * over those positions only, with the running rotation as an index into
 * facelet-cube.js's orientation tables. Same results, same order: the old
 * loop kept the first (smallest) mask of each distinct output, which is the
 * mask with only the effective bits set, so outputs are sorted by that mask.
 * test/cross-optimization.test.js checks it against the original.
 */
function optimizeCrossSolution(moves) {
    const n = moves.length;
    const identity = rotationIndex('');
    const found = [];
    const tokens = new Array(n);
    const walk = (i, rot, mask) => {
        if (i === n) {
            found.push({ mask, moves: tokens.slice(), rot });
            return;
        }
        const name = canonicalFaceName(conjugateToken(rot, moves[i]));
        if (!name) return; // not a pure face turn: the old loop dropped every such mask
        tokens[i] = name;
        walk(i + 1, rot, mask);
        const rule = WIDE_MOVE_RULES[name];
        if (rule) {
            tokens[i] = rule.wide;
            walk(i + 1, composeRotationIndex(rot, rotationIndex(rule.rotation)), mask + 2 ** i);
        }
    };
    walk(0, identity, 0);
    found.sort((a, b) => a.mask - b.mask);
    const yNames = ['', 'y', 'y2', "y'"].map(r => [rotationIndex(r), r]);
    const results = [];
    for (const f of found) {
        if (canonicalFaceName(conjugateToken(f.rot, 'D')) !== 'D') continue; // keepsCrossOnBottom
        const named = yNames.find(([idx]) => idx === f.rot);
        results.push({ moves: f.moves, rotation: named ? named[1] : null });
    }
    return results;
}

// Reverse of WIDE_MOVE_RULES: expands a wide-move token back to its literal
// "face-move rotation" definition. facelet-cube.js deliberately has no
// notion of wide moves (see this file's header comment) -- any code that
// needs to REPLAY an optimizeCrossSolution() result through it (e.g. a
// safety-net real-cube-state check) must expand wide tokens with this first.
const WIDE_TOKEN_TO_FACE_MOVE = {};
for (const [face, rule] of Object.entries(WIDE_MOVE_RULES)) {
    WIDE_TOKEN_TO_FACE_MOVE[rule.wide] = [face, rule.rotation];
}

/** Expands any wide-move tokens in `tokens` to their literal move+rotation pair. */
function expandWideMoves(tokens) {
    const out = [];
    for (const t of tokens) {
        const expansion = WIDE_TOKEN_TO_FACE_MOVE[t];
        if (expansion) out.push(...expansion);
        else out.push(t);
    }
    return out;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { WIDE_MOVE_RULES, relabelMovePerm, keepsCrossOnBottom, optimizeCrossSolution, expandWideMoves };
}
