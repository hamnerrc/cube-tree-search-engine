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

// What a solver sees of the unsolved pairs during look-ahead (README "Pair
// choice"). Kociemba facelet tables (as in random-state-scramble.js):
// corners URF UFL ULB UBR DFR DLF DBL DRB, edges UR UF UL UB DR DF DL DB FR
// FL BL BR. A slot's pieces are found by their colours, read off the centres,
// so any whole-cube rotation is fine.
const LOOK_CORNERS = [
    [8, 9, 20], [6, 18, 38], [0, 36, 47], [2, 45, 11],
    [29, 26, 15], [27, 44, 24], [33, 53, 42], [35, 17, 51],
];
const LOOK_EDGES = [
    [5, 10], [7, 19], [3, 37], [1, 46], [32, 16], [28, 25],
    [30, 43], [34, 52], [23, 12], [21, 41], [50, 39], [48, 14],
];
// Slot -> its home corner and edge position.
const LOOK_SLOTS = { FR: [4, 8], FL: [5, 9], BL: [6, 10], BR: [7, 11] };
const LOOK_FEATURES = ['trappedCorners', 'trappedEdges', 'piecesHome', 'bothInU', 'connected'];

// Colours as bits, so a piece's colour set is one number.
const LOOK_BIT = { W: 1, R: 2, G: 4, Y: 8, O: 16, B: 32 };
const LOOK_CORNER_KEYS = new Array(8);
const LOOK_EDGE_KEYS = new Array(12);

/**
 * Counts over the unsolved F2L pairs of a cube with the cross solved, in
 * LOOK_FEATURES order: corners stuck in a D-layer slot (not home and
 * oriented), edges stuck in a middle-layer slot (likewise), pieces already
 * home and oriented without their partner, pairs with both pieces in the U
 * layer, and of those, pairs already connected (adjacent, both shared
 * stickers matching). Unchanged by any y rotation of the cube.
 */
function pairLookFeatures(facelets, out = [0, 0, 0, 0, 0]) {
    out.fill(0);
    const f = facelets;
    const center = i => f[i - (i % 9) + 4];
    for (let p = 0; p < 8; p++) {
        const idx = LOOK_CORNERS[p];
        LOOK_CORNER_KEYS[p] = LOOK_BIT[f[idx[0]]] | LOOK_BIT[f[idx[1]]] | LOOK_BIT[f[idx[2]]];
    }
    for (let p = 0; p < 12; p++) {
        const idx = LOOK_EDGES[p];
        LOOK_EDGE_KEYS[p] = LOOK_BIT[f[idx[0]]] | LOOK_BIT[f[idx[1]]];
    }
    const flags = solvedFlags(f);
    for (const slot of ['FR', 'FL', 'BL', 'BR']) {
        if (flags[slot]) continue;
        const [hc, he] = LOOK_SLOTS[slot];
        const hcIdx = LOOK_CORNERS[hc];
        const heIdx = LOOK_EDGES[he];
        const wantC = LOOK_BIT[center(hcIdx[0])] | LOOK_BIT[center(hcIdx[1])] | LOOK_BIT[center(hcIdx[2])];
        const wantE = LOOK_BIT[center(heIdx[0])] | LOOK_BIT[center(heIdx[1])];
        const c = LOOK_CORNER_KEYS.indexOf(wantC);
        const e = LOOK_EDGE_KEYS.indexOf(wantE);
        const cHome = c === hc && f[hcIdx[0]] === center(hcIdx[0]) && f[hcIdx[1]] === center(hcIdx[1]) && f[hcIdx[2]] === center(hcIdx[2]);
        const eHome = e === he && f[heIdx[0]] === center(heIdx[0]) && f[heIdx[1]] === center(heIdx[1]);
        if (cHome) out[2]++; else if (c >= 4) out[0]++;
        if (eHome) out[2]++; else if (e >= 8) out[1]++;
        if (c < 4 && e < 4) {
            out[3]++;
            let shared = 0;
            let match = 0;
            for (const ci of LOOK_CORNERS[c]) {
                for (const ei of LOOK_EDGES[e]) {
                    if (ci - (ci % 9) !== ei - (ei % 9)) continue;
                    shared++;
                    if (f[ci] === f[ei]) match++;
                }
            }
            if (shared === 2 && match === 2) out[4]++;
        }
    }
    return out;
}

/**
 * Pair planning (README "Pair planning"): what a solver plans with, of the
 * unsolved pairs, in the orientation the cube is held in (so, unlike
 * pairLookFeatures, it changes with y rotations), in PLAN_FEATURES order:
 * - edge orientation (EO; docs/general_EO_knowledge.txt) of each unsolved
 *   pair's edge: one of its two colours belongs to the front/back centres.
 *   In the U layer it is good (insertable with R, U and L turns) when its
 *   top sticker has a front/back colour; in the middle layer when its
 *   sticker facing front or back does. A y rotation turns every U-layer
 *   edge from good to bad and back and leaves middle-layer edges alone: the
 *   counts of bad and good U-layer edges and of bad middle-layer edges;
 * - open back slots (BL, BR unsolved): with the back slots solved every
 *   remaining piece is in view (docs/slot_and_rotation_info.txt).
 */
const PLAN_FEATURES = ['badEdgesU', 'goodEdgesU', 'badEdgesMiddle', 'openBackSlots'];
function planFeatures(facelets, out = [0, 0, 0, 0]) {
    out.fill(0);
    const f = facelets;
    const center = i => f[i - (i % 9) + 4];
    const front = f[22];
    const back = f[49];
    for (let p = 0; p < 12; p++) {
        const idx = LOOK_EDGES[p];
        LOOK_EDGE_KEYS[p] = LOOK_BIT[f[idx[0]]] | LOOK_BIT[f[idx[1]]];
    }
    const flags = solvedFlags(f);
    for (const slot of ['FR', 'FL', 'BL', 'BR']) {
        if (flags[slot]) continue;
        if (slot === 'BL' || slot === 'BR') out[3]++;
        const he = LOOK_SLOTS[slot][1];
        const heIdx = LOOK_EDGES[he];
        const e = LOOK_EDGE_KEYS.indexOf(LOOK_BIT[center(heIdx[0])] | LOOK_BIT[center(heIdx[1])]);
        // LOOK_EDGES lists the U (or F/B) sticker first
        const sticker = f[LOOK_EDGES[e][0]];
        const good = sticker === front || sticker === back;
        if (e < 4) out[good ? 1 : 0]++;
        else if (e >= 8 && !(e === he && f[heIdx[0]] === center(heIdx[0]) && f[heIdx[1]] === center(heIdx[1]))) {
            if (!good) out[2]++;
        }
    }
    return out;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { solvedFlags, pseudoSolvedFlags, MASKS, CORNER_MASKS, EDGE_MASKS, pairLookFeatures, LOOK_FEATURES, planFeatures, PLAN_FEATURES };
}
