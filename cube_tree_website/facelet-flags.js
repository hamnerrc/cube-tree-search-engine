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
const FACE_ORDER = 'URFDLB';

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
    return FACE_ORDER[Math.floor(position / 9)];
}

function isSlotSolved(facelets, maskName) {
    const mask = MASKS[maskName];
    for (let pos = 0; pos < 54; pos++) {
        if (mask[pos] === mask[pos].toUpperCase()) continue; // ignored position
        const center = facelets[CENTERS[faceOf(pos)]];
        if (facelets[pos] !== center) return false;
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

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { solvedFlags, MASKS };
}
