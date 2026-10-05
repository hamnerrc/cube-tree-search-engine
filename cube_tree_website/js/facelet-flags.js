// Determines which Cross+F2L pieces are *actually* solved in a facelet
// string, independent of what any DAG edge or solver call claims. This is
// the "real cube-state check" PROJECT_STATUS.md §4.3/§4.9 identified as the
// prerequisite for luck filtering, ported from
// archived_attempts/try_1/utils/CFOPflags.py to operate on facelet-cube.js's
// Kociemba-convention facelet strings instead of a bespoke Python one.
//
// Method (unchanged from CFOPflags.py): a slot is solved iff every facelet
// listed for it matches its own face's center color. This is
// orientation-agnostic (it never hardcodes which color means "cross color";
// it only compares each facelet to its own face's center), so it works
// regardless of which color the cube is solved on.
//
// Slot naming (BL/BR/FL/FR) matches this project's existing SLOT_INDICES
// convention (solver-bridge.js), not CFOPflags.py's own BL/BR/FL/FR order.

// Kept as a local copy rather than requiring facelet-cube.js: that file is
// loaded via a plain <script> tag in the browser (no module system there),
// so this avoids a require() that would throw outside Node.
const FLAGS_FACE_ORDER = 'URFDLB';

// Center facelet index of each face, in facelet string order.
const CENTERS = { U: 4, R: 13, F: 22, D: 31, L: 40, B: 49 };

// Mask strings: one character per facelet position (U R F D L B order, 9
// each). Lowercase = this position must match its own face's center for the
// slot to be considered solved; uppercase = ignored. Ported verbatim from
// CFOPflags.py (same URFDLB facelet convention, confirmed in
// facelet-cube.js's own cross-verification against magiccube).
const MASKS = {
    cross: 'WWWWWWWWWRRRRRRRrRGGGGGGGgGYyYyYyYyYOOOOOOOoOBBBBBBBbB',
    BL: 'WWWWWWWWWRRRRRRRRRGGGGGGGGGYYYYYYyYYOOOoOOoOOBBBBBbBBb',
    BR: 'WWWWWWWWWRRRRRrRRrGGGGGGGGGYYYYYYYYyOOOOOOOOOBBBbBBbBB',
    FL: 'WWWWWWWWWRRRRRRRRRGGGgGGgGGyYYYYYYYYOOOOOoOOoBBBBBBBBB',
    FR: 'WWWWWWWWWRRRrRRrRRGGGGGgGGgYYyYYYYYYOOOOOOOOOBBBBBBBBB',
};

for (const [name, mask] of Object.entries(MASKS)) {
    if (mask.length !== 54) {
        throw new Error(`facelet-flags: mask "${name}" has length ${mask.length}, expected 54`);
    }
}

function faceOf(position) {
    return FLAGS_FACE_ORDER[Math.floor(position / 9)];
}

// Each mask's checked positions, paired with the centre they must match,
// computed once per mask string (this check runs for every candidate of
// every search; PROJECT_STATUS.md §4.38).
const MASK_CHECKS = new Map();
function maskChecks(mask) {
    let checks = MASK_CHECKS.get(mask);
    if (!checks) {
        checks = [];
        for (let pos = 0; pos < 54; pos++) {
            if (mask[pos] === mask[pos].toUpperCase()) continue; // ignored position
            checks.push(pos, CENTERS[faceOf(pos)]);
        }
        MASK_CHECKS.set(mask, checks);
    }
    return checks;
}

function isSlotSolved(facelets, maskName, maskTable = MASKS) {
    const checks = maskChecks(maskTable[maskName]);
    for (let i = 0; i < checks.length; i += 2) {
        if (facelets[checks[i]] !== facelets[checks[i + 1]]) return false;
    }
    return true;
}

// Returns { cross, BL, BR, FL, FR } booleans for a 54-char facelet string.
function solvedFlags(facelets) {
    return {
        cross: isSlotSolved(facelets, 'cross'),
        BL: isSlotSolved(facelets, 'BL'),
        BR: isSlotSolved(facelets, 'BR'),
        FL: isSlotSolved(facelets, 'FL'),
        FR: isSlotSolved(facelets, 'FR'),
    };
}

// Corner-only / edge-only masks, for pseudo (mismatched) F2L checking: a
// genuine pseudo-pair result places a corner piece and an edge piece at
// *independent* home-slots (see PROJECT_STATUS.md's pseudo-dispatch
// writeup), so "is the pair at slot X solved" (the combined masks above)
// cannot validate it -- each half needs its own check.
//
// Derived from the combined BL/BR/FL/FR masks above by a geometric fact
// about the Kociemba facelet convention also already in use via `CENTERS`
// in this file: within each face's own 9-char block, positions {0,2,6,8}
// are that face's corner stickers and {1,3,5,7} are its edge stickers (4
// is the center, never part of a mask). A corner piece has 3 stickers
// (D-layer + 2 side faces, all at corner positions); an F2L edge piece has
// exactly 2 stickers (2 side faces only, both at edge positions, since F2L
// edges live in the middle layer and never touch U or D). Splitting each
// combined mask by this parity therefore exactly separates "is this slot's
// corner correctly placed" from "is this slot's edge correctly placed".
// Not hand-trusted, though: cross-verified against 500 random scrambles'
// worth of magiccube ground truth (get_piece_color-by-identity, not just
// "a slot looks right") in
// pseudoCrossSolver/investigation/verify_pseudo_masks.py (2000/2000
// (scramble, slot) combinations agreed, for both the corner-only and
// edge-only split AND the sanity check that corner-only AND edge-only
// reconstitutes the pre-existing combined mask's result).
const CORNER_MASKS = {
    BL: 'WWWWWWWWWRRRRRRRRRGGGGGGGGGYYYYYYyYYOOOOOOoOOBBBBBBBBb',
    BR: 'WWWWWWWWWRRRRRRRRrGGGGGGGGGYYYYYYYYyOOOOOOOOOBBBBBBbBB',
    FL: 'WWWWWWWWWRRRRRRRRRGGGGGGgGGyYYYYYYYYOOOOOOOOoBBBBBBBBB',
    FR: 'WWWWWWWWWRRRRRRrRRGGGGGGGGgYYyYYYYYYOOOOOOOOOBBBBBBBBB',
};
const EDGE_MASKS = {
    BL: 'WWWWWWWWWRRRRRRRRRGGGGGGGGGYYYYYYYYYOOOoOOOOOBBBBBbBBB',
    BR: 'WWWWWWWWWRRRRRrRRRGGGGGGGGGYYYYYYYYYOOOOOOOOOBBBbBBBBB',
    FL: 'WWWWWWWWWRRRRRRRRRGGGgGGGGGYYYYYYYYYOOOOOoOOOBBBBBBBBB',
    FR: 'WWWWWWWWWRRRrRRRRRGGGGGgGGGYYYYYYYYYOOOOOOOOOBBBBBBBBB',
};

for (const [prefix, table] of [['CORNER', CORNER_MASKS], ['EDGE', EDGE_MASKS]]) {
    for (const [name, mask] of Object.entries(table)) {
        if (mask.length !== 54) {
            throw new Error(`facelet-flags: ${prefix}_MASKS["${name}"] has length ${mask.length}, expected 54`);
        }
    }
}

/**
 * Independent per-piece placement check, for pseudo (mismatched) F2L
 * results. Returns { cornerAt: {BL,BR,FL,FR}, edgeAt: {BL,BR,FL,FR} }: each
 * boolean is true iff that slot's corner (or edge) piece specifically is
 * correctly placed and oriented, regardless of its partner piece's state.
 */
function pseudoSolvedFlags(facelets) {
    const cornerAt = {};
    const edgeAt = {};
    for (const slot of ['BL', 'BR', 'FL', 'FR']) {
        cornerAt[slot] = isSlotSolved(facelets, slot, CORNER_MASKS);
        edgeAt[slot] = isSlotSolved(facelets, slot, EDGE_MASKS);
    }
    return { cornerAt, edgeAt };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { solvedFlags, pseudoSolvedFlags, MASKS, CORNER_MASKS, EDGE_MASKS };
}
