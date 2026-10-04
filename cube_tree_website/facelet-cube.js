// A pure-JS 54-facelet 3x3 cube simulator, used for luck filtering (verifying
// which pieces a candidate algorithm *actually* solves, independent of what
// its DAG edge claims).
//
// Facelet layout matches the standard Kociemba convention: 54 facelets in
// face order U,R,F,D,L,B (9 each, row-major), e.g. "WWWWWWWWWRRRRRRRRR..."
// for a solved cube. This exact convention (including which color goes on
// which face) was cross-checked against the `magiccube` Python package
// (the same ground-truth tool this project's other rotation-algebra fixes
// used) rather than assumed - see test/facelet-cube.test.js.
//
// The 9 base-generator permutations below (one quarter turn CW of each of
// U/D/R/L/F/B, plus whole-cube x/y/z) were derived empirically against
// `magiccube`, not hand-derived: each one was solved for by running many
// random scrambles through both a "before" and "after" state and
// intersecting, per output position, the set of input positions whose color
// was consistent with that transformation across all trials - this project
// has a standing rule (see PROJECT_STATUS.md) against hand-deriving rotation
// algebra after past bugs from doing exactly that. Every base permutation
// was then independently re-verified (not just derived) against 30 more
// random trials. ', 2 and -axis-rotation combinations are all computed
// mechanically from these 9 tables (permutation composition/inversion), not
// typed by hand.

const FACE_ORDER = 'URFDLB';
const SOLVED_FACELETS = 'WWWWWWWWWRRRRRRRRRGGGGGGGGGYYYYYYYYYOOOOOOOOOBBBBBBBBB';

// perm[i] = index in the "before" state whose facelet ends up at position i
// in the "after" state, i.e. after[i] = before[perm[i]].
const BASE_PERMS = {
    U: [6, 3, 0, 7, 4, 1, 8, 5, 2, 45, 46, 47, 12, 13, 14, 15, 16, 17, 9, 10, 11, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 18, 19, 20, 39, 40, 41, 42, 43, 44, 36, 37, 38, 48, 49, 50, 51, 52, 53],
    D: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 24, 25, 26, 18, 19, 20, 21, 22, 23, 42, 43, 44, 33, 30, 27, 34, 31, 28, 35, 32, 29, 36, 37, 38, 39, 40, 41, 51, 52, 53, 45, 46, 47, 48, 49, 50, 15, 16, 17],
    R: [0, 1, 20, 3, 4, 23, 6, 7, 26, 15, 12, 9, 16, 13, 10, 17, 14, 11, 18, 19, 29, 21, 22, 32, 24, 25, 35, 27, 28, 51, 30, 31, 48, 33, 34, 45, 36, 37, 38, 39, 40, 41, 42, 43, 44, 8, 46, 47, 5, 49, 50, 2, 52, 53],
    L: [53, 1, 2, 50, 4, 5, 47, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 0, 19, 20, 3, 22, 23, 6, 25, 26, 18, 28, 29, 21, 31, 32, 24, 34, 35, 42, 39, 36, 43, 40, 37, 44, 41, 38, 45, 46, 33, 48, 49, 30, 51, 52, 27],
    F: [0, 1, 2, 3, 4, 5, 44, 41, 38, 6, 10, 11, 7, 13, 14, 8, 16, 17, 24, 21, 18, 25, 22, 19, 26, 23, 20, 15, 12, 9, 30, 31, 32, 33, 34, 35, 36, 37, 27, 39, 40, 28, 42, 43, 29, 45, 46, 47, 48, 49, 50, 51, 52, 53],
    B: [11, 14, 17, 3, 4, 5, 6, 7, 8, 9, 10, 35, 12, 13, 34, 15, 16, 33, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 36, 39, 42, 2, 37, 38, 1, 40, 41, 0, 43, 44, 51, 48, 45, 52, 49, 46, 53, 50, 47],
    x: [18, 19, 20, 21, 22, 23, 24, 25, 26, 15, 12, 9, 16, 13, 10, 17, 14, 11, 27, 28, 29, 30, 31, 32, 33, 34, 35, 53, 52, 51, 50, 49, 48, 47, 46, 45, 38, 41, 44, 37, 40, 43, 36, 39, 42, 8, 7, 6, 5, 4, 3, 2, 1, 0],
    y: [6, 3, 0, 7, 4, 1, 8, 5, 2, 45, 46, 47, 48, 49, 50, 51, 52, 53, 9, 10, 11, 12, 13, 14, 15, 16, 17, 29, 32, 35, 28, 31, 34, 27, 30, 33, 18, 19, 20, 21, 22, 23, 24, 25, 26, 36, 37, 38, 39, 40, 41, 42, 43, 44],
    z: [42, 39, 36, 43, 40, 37, 44, 41, 38, 6, 3, 0, 7, 4, 1, 8, 5, 2, 24, 21, 18, 25, 22, 19, 26, 23, 20, 15, 12, 9, 16, 13, 10, 17, 14, 11, 33, 30, 27, 34, 31, 28, 35, 32, 29, 47, 50, 53, 46, 49, 52, 45, 48, 51],
};

function composePerm(first, second) {
    // Apply `first` then `second`: result[i] = first[second[i]]
    return second.map((j) => first[j]);
}

function invertPerm(perm) {
    const inv = new Array(perm.length);
    perm.forEach((srcIdx, dstIdx) => { inv[srcIdx] = dstIdx; });
    return inv;
}

const IDENTITY_PERM = Array.from({ length: 54 }, (_, i) => i);

function buildMoveTable() {
    const table = {};
    for (const [gen, perm] of Object.entries(BASE_PERMS)) {
        table[gen] = perm;
        table[`${gen}'`] = invertPerm(perm);
        table[`${gen}2`] = composePerm(perm, perm);
    }
    return table;
}

const MOVE_TABLE = buildMoveTable();

// Wide and slice moves, as compositions of the verified tables above. Each
// decomposition was FOUND by exhaustive search over 1-3 token sequences of
// the 27 base tokens against magiccube's Rw/Lw/Uw/Dw/Fw/Bw/M/E/S on 60 random
// states each (the first, shortest hit is used), not written from memory;
// test/facelet-fixture.json re-verifies them against magiccube directly.
// Lowercase is WCA wide notation (r == Rw). Added 2026-10-04 so the
// professional reference solves (pro_references.txt) can be replayed.
const DERIVED_MOVES = {
    r: ['L', 'x'], l: ['R', "x'"], u: ['D', 'y'], d: ['U', "y'"], f: ['B', 'z'], b: ['F', "z'"],
    M: ['R', "L'", "x'"], E: ['U', "D'", "y'"], S: ["F'", 'B', 'z'],
};
for (const [name, parts] of Object.entries(DERIVED_MOVES)) {
    const perm = parts.reduce((acc, t) => composePerm(acc, MOVE_TABLE[t]), IDENTITY_PERM);
    MOVE_TABLE[name] = perm;
    MOVE_TABLE[`${name}'`] = invertPerm(perm);
    MOVE_TABLE[`${name}2`] = composePerm(perm, perm);
}
// "R2'" (common in human-written solves) is the same as "R2".
for (const name of Object.keys(MOVE_TABLE)) {
    if (name.endsWith('2')) MOVE_TABLE[`${name}'`] = MOVE_TABLE[name];
}

function applyPerm(facelets, perm) {
    let out = '';
    for (let i = 0; i < perm.length; i++) out += facelets[perm[i]];
    return out;
}

function isMoveToken(token) {
    return Object.prototype.hasOwnProperty.call(MOVE_TABLE, token);
}

// Applies a space-separated algorithm string (standard face turns plus
// whole-cube x/y/z rotations, plus lowercase wide and M/E/S slice moves) to a
// 54-char facelet string and returns the resulting facelet string. Throws on
// any unrecognized token so a typo fails loudly instead of silently no-opping.
function applyAlgorithm(facelets, algorithm) {
    const tokens = String(algorithm)
        .replace(/\bnone\b/gi, '')
        .trim()
        .split(/\s+/)
        .filter(Boolean);
    let state = facelets;
    for (const token of tokens) {
        if (!isMoveToken(token)) {
            throw new Error(`facelet-cube: unrecognized move token "${token}"`);
        }
        state = applyPerm(state, MOVE_TABLE[token]);
    }
    return state;
}

// ---------------------------------------------------------------------------
// Frame canonicalisation (2026-10-04, PROJECT_STATUS.md §4.19).
//
// The solver engines take a whole-cube `rotation` option plus a `postAlg`, and
// require the centres to end where the rotation put them -- so a committed
// path containing wide moves, slices or mid-solve rotations cannot be passed
// as postAlg verbatim. canonicalizeForEngine(prefix, alg) returns
// { rotation, moves } with
//     state(prefix, alg) == state(rotation, moves)
// where `moves` uses only the 18 face turns. Everything is done with the
// verified permutations above (rotations are pushed to the front by
// conjugation and each conjugated face move is identified by perm equality),
// so no relabelling table is written by hand; test/facelet-cube.test.js
// checks the identity on random mixed-notation sequences.
const FACE_TURNS = [...'UDRLFB'].flatMap(f => [f, `${f}'`, `${f}2`]);
const ROTATION_TOKENS = [...'xyz'].flatMap(a => [a, `${a}'`, `${a}2`]);
const permKey = perm => perm.join(',');
const FACE_TURN_BY_PERM = new Map(FACE_TURNS.map(t => [permKey(MOVE_TABLE[t]), t]));
// Shortest rotation string for each of the 24 orientations; y-only and
// x/z-then-y spellings are preferred so results read like this project's
// usual "z2 y" style.
const ROTATION_BY_PERM = new Map();
{
    const singles = ['', 'y', "y'", 'y2', 'z2', 'x', "x'", 'z', "z'", 'x2'];
    for (const a of singles) {
        for (const b of ['', 'y', "y'", 'y2']) {
            const seq = [a, b].filter(Boolean);
            const perm = seq.reduce((acc, t) => composePerm(acc, MOVE_TABLE[t]), IDENTITY_PERM);
            if (!ROTATION_BY_PERM.has(permKey(perm))) ROTATION_BY_PERM.set(permKey(perm), seq.join(' '));
        }
    }
    for (const a of ROTATION_TOKENS) {
        for (const b of ROTATION_TOKENS) {
            const perm = composePerm(MOVE_TABLE[a], MOVE_TABLE[b]);
            if (!ROTATION_BY_PERM.has(permKey(perm))) ROTATION_BY_PERM.set(permKey(perm), `${a} ${b}`);
        }
    }
}

const invertToken = t => t.endsWith('2') ? t : t.endsWith("'") ? t.slice(0, -1) : `${t}'`;

/** Expands a token into face turns and rotations only. */
function primitiveTokens(token) {
    const t = token.replace(/2'$/, '2');
    const base = t.replace(/['2]$/, '');
    const parts = DERIVED_MOVES[base];
    if (!parts) return [t];
    if (t.endsWith("'")) return parts.slice().reverse().map(invertToken);
    if (t.endsWith('2')) return parts.concat(parts);
    return parts.slice();
}

function canonicalizeForEngine(prefixRotation, alg) {
    const tokens = [prefixRotation, alg].filter(Boolean).join(' ')
        .replace(/\bnone\b/gi, '').trim().split(/\s+/).filter(Boolean);
    // Pass 1: rewrite as "E then Q" with E in the starting frame.
    let Q = IDENTITY_PERM;
    const early = [];
    for (const tok of tokens) {
        if (!isMoveToken(tok)) throw new Error(`facelet-cube: unrecognized move token "${tok}"`);
        for (const p of primitiveTokens(tok)) {
            if (ROTATION_TOKENS.includes(p)) { Q = composePerm(Q, MOVE_TABLE[p]); continue; }
            early.push(composePerm(composePerm(Q, MOVE_TABLE[p]), invertPerm(Q)));
        }
    }
    // Pass 2: "E then Q" == "Q then (Q^-1 e Q for each e)".
    const invQ = invertPerm(Q);
    const moves = early.map(e => {
        const name = FACE_TURN_BY_PERM.get(permKey(composePerm(composePerm(invQ, e), Q)));
        if (!name) throw new Error('canonicalizeForEngine: conjugated move is not a face turn');
        return name;
    });
    return { rotation: ROTATION_BY_PERM.get(permKey(Q)), moves: moves.join(' ') };
}

// Every single token by permutation (face turns first, so they win ties).
const TOKEN_BY_PERM = new Map();
for (const t of [...FACE_TURNS, ...ROTATION_TOKENS, ...Object.keys(DERIVED_MOVES).flatMap(n => [n, `${n}'`, `${n}2`])]) {
    if (!TOKEN_BY_PERM.has(permKey(MOVE_TABLE[t]))) TOKEN_BY_PERM.set(permKey(MOVE_TABLE[t]), t);
}

/**
 * Rewrites `alg` so that "rotation + result" has the same physical effect as
 * "alg + rotation" (each token conjugated by the rotation and identified by
 * permutation equality) -- the mechanical form of script.js's altAlgs
 * relabelling, valid for wide moves, slices and rotations too.
 */
function relabelAlgForRotation(alg, rotation) {
    const r = String(rotation || '').split(/\s+/).filter(Boolean)
        .reduce((acc, t) => composePerm(acc, MOVE_TABLE[t]), IDENTITY_PERM);
    const inv = invertPerm(r);
    return String(alg).split(/\s+/).filter(Boolean).map(t => {
        const name = TOKEN_BY_PERM.get(permKey(composePerm(composePerm(inv, MOVE_TABLE[t]), r)));
        if (!name) throw new Error(`relabelAlgForRotation: no single token for ${t} under ${rotation}`);
        return name;
    }).join(' ');
}

/** The rotation string that undoes `rotation` ('' for none). */
function inverseRotation(rotation) {
    const perm = String(rotation || '').split(/\s+/).filter(Boolean)
        .reduce((acc, t) => composePerm(acc, MOVE_TABLE[t]), IDENTITY_PERM);
    return ROTATION_BY_PERM.get(permKey(invertPerm(perm)));
}

/** Net whole-cube rotation of an alg (as a rotation string, '' for none). */
function netRotation(alg) {
    return canonicalizeForEngine('', alg).rotation;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        FACE_ORDER,
        SOLVED_FACELETS,
        BASE_PERMS,
        MOVE_TABLE,
        isMoveToken,
        applyAlgorithm,
        composePerm,
        invertPerm,
        IDENTITY_PERM,
        canonicalizeForEngine,
        netRotation,
        inverseRotation,
        relabelAlgForRotation,
    };
}
