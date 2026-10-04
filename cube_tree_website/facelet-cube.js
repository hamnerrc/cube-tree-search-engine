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

function applyPerm(facelets, perm) {
    let out = '';
    for (let i = 0; i < perm.length; i++) out += facelets[perm[i]];
    return out;
}

function isMoveToken(token) {
    return Object.prototype.hasOwnProperty.call(MOVE_TABLE, token);
}

// Applies a space-separated algorithm string (standard face turns plus
// whole-cube x/y/z rotations) to a 54-char facelet string and returns the
// resulting facelet string. Throws on any unrecognized token so a typo or
// an unsupported move (slice/wide moves are not part of this project's
// search move set) fails loudly instead of silently no-opping.
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
    };
}
