/**
 * Post-hoc, first-step-only transform applied to an ordinary (face-turn
 * only) Cross solution: explores rewriting some subset of its L/L'/L2/
 * R/R'/R2/D/D' moves into their wide-move equivalent, tracking the
 * cumulative whole-cube rotation that substitution implies, and keeps
 * only the rewrites that still leave cross on the D (bottom) face.
 */
'use strict';

// Each entry: converting this literal (already-relabeled) move emits `wide` and
// accumulates `rotation` into the running cumulative rotation.
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

function keepsCrossOnBottom(rhoPerm) {
    return findFaceTurnName(relabelMovePerm(MOVE_TABLE.D, rhoPerm)) === 'D';
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

const WIDE_TOKEN_TO_FACE_MOVE = {};
for (const [face, rule] of Object.entries(WIDE_MOVE_RULES)) {
    WIDE_TOKEN_TO_FACE_MOVE[rule.wide] = [face, rule.rotation];
}

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
