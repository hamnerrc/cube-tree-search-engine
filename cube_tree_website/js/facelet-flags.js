// Which Cross+F2L pieces are solved in a facelet string, whatever a step
// claims to solve (used to filter out lucky results).

// Kept as a local copy rather than requiring facelet-cube.js: that file is
// loaded via a plain <script> tag in the browser (no module system there),
// so this avoids a require() that would throw outside Node.
const FLAGS_FACE_ORDER = 'URFDLB';

// Center facelet index of each face, in facelet string order.
const CENTERS = { U: 4, R: 13, F: 22, D: 31, L: 40, B: 49 };

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
// computed once per mask string.
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

function pseudoSolvedFlags(facelets) {
    const cornerAt = {};
    const edgeAt = {};
    for (const slot of ['BL', 'BR', 'FL', 'FR']) {
        cornerAt[slot] = isSlotSolved(facelets, slot, CORNER_MASKS);
        edgeAt[slot] = isSlotSolved(facelets, slot, EDGE_MASKS);
    }
    return { cornerAt, edgeAt };
}

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

const LOOK_BITC = new Uint8Array(128);
for (const [ch, bit] of Object.entries(LOOK_BIT)) LOOK_BITC[ch.charCodeAt(0)] = bit;
const LOOK_SLOT_LIST = ['FR', 'FL', 'BL', 'BR'];
const LOOK_SLOT_GEO = LOOK_SLOT_LIST.map((slot) => {
    const [hc, he] = LOOK_SLOTS[slot];
    const cs = LOOK_CORNERS[hc];
    const es = LOOK_EDGES[he];
    const centre = i => i - (i % 9) + 4;
    return { hc, he, cs, es, cc: cs.map(centre), ec: es.map(centre) };
});
// LOOK_SHARED[c * 4 + e] (U-layer corner c, edge e < 4): sticker pairs on a
// common face, flattened (corner sticker, edge sticker, ...)
const LOOK_SHARED = [];
for (let c = 0; c < 4; c++) {
    for (let e = 0; e < 4; e++) {
        const pairs = [];
        for (const ci of LOOK_CORNERS[c]) {
            for (const ei of LOOK_EDGES[e]) if (ci - (ci % 9) === ei - (ei % 9)) pairs.push(ci, ei);
        }
        LOOK_SHARED.push(pairs);
    }
}
const LOOK_CK = new Uint8Array(8);
const LOOK_EK = new Uint8Array(12);
function lookKeys(f) {
    const B = LOOK_BITC;
    for (let p = 0; p < 8; p++) {
        const idx = LOOK_CORNERS[p];
        LOOK_CK[p] = B[f.charCodeAt(idx[0])] | B[f.charCodeAt(idx[1])] | B[f.charCodeAt(idx[2])];
    }
    for (let p = 0; p < 12; p++) {
        const idx = LOOK_EDGES[p];
        LOOK_EK[p] = B[f.charCodeAt(idx[0])] | B[f.charCodeAt(idx[1])];
    }
}

function pairLookFeatures(facelets, out = [0, 0, 0, 0, 0], solved = null) {
    out.fill(0);
    const f = facelets;
    const B = LOOK_BITC;
    lookKeys(f);
    const flags = solved || solvedFlags(f);
    for (let s = 0; s < 4; s++) {
        if (flags[LOOK_SLOT_LIST[s]]) continue;
        const { hc, he, cs, es, cc, ec } = LOOK_SLOT_GEO[s];
        const wantC = B[f.charCodeAt(cc[0])] | B[f.charCodeAt(cc[1])] | B[f.charCodeAt(cc[2])];
        const wantE = B[f.charCodeAt(ec[0])] | B[f.charCodeAt(ec[1])];
        const c = LOOK_CK.indexOf(wantC);
        const e = LOOK_EK.indexOf(wantE);
        const cHome = c === hc && f.charCodeAt(cs[0]) === f.charCodeAt(cc[0]) && f.charCodeAt(cs[1]) === f.charCodeAt(cc[1]) && f.charCodeAt(cs[2]) === f.charCodeAt(cc[2]);
        const eHome = e === he && f.charCodeAt(es[0]) === f.charCodeAt(ec[0]) && f.charCodeAt(es[1]) === f.charCodeAt(ec[1]);
        if (cHome) out[2]++; else if (c >= 4) out[0]++;
        if (eHome) out[2]++; else if (e >= 8) out[1]++;
        if (c < 4 && e < 4) {
            out[3]++;
            const sh = LOOK_SHARED[c * 4 + e];
            if (sh.length === 4 && f.charCodeAt(sh[0]) === f.charCodeAt(sh[1]) && f.charCodeAt(sh[2]) === f.charCodeAt(sh[3])) out[4]++;
        }
    }
    return out;
}

const PLAN_FEATURES = ['badEdgesU', 'goodEdgesU', 'badEdgesMiddle', 'openBackSlots'];
function planFeatures(facelets, out = [0, 0, 0, 0], solved = null) {
    out.fill(0);
    const f = facelets;
    const B = LOOK_BITC;
    const front = f.charCodeAt(22);
    const back = f.charCodeAt(49);
    for (let p = 0; p < 12; p++) {
        const idx = LOOK_EDGES[p];
        LOOK_EK[p] = B[f.charCodeAt(idx[0])] | B[f.charCodeAt(idx[1])];
    }
    const flags = solved || solvedFlags(f);
    for (let s = 0; s < 4; s++) {
        const slot = LOOK_SLOT_LIST[s];
        if (flags[slot]) continue;
        if (slot === 'BL' || slot === 'BR') out[3]++;
        const { he, es, ec } = LOOK_SLOT_GEO[s];
        const e = LOOK_EK.indexOf(B[f.charCodeAt(ec[0])] | B[f.charCodeAt(ec[1])]);
        // LOOK_EDGES lists the U (or F/B) sticker first
        const sticker = f.charCodeAt(LOOK_EDGES[e][0]);
        const good = sticker === front || sticker === back;
        if (e < 4) out[good ? 1 : 0]++;
        else if (e >= 8 && !(e === he && f.charCodeAt(es[0]) === f.charCodeAt(ec[0]) && f.charCodeAt(es[1]) === f.charCodeAt(ec[1]))) {
            if (!good) out[2]++;
        }
    }
    return out;
}

const PLAN_BACK_BY_Y = [['BL', 'BR'], ['FL', 'BL'], ['FL', 'FR'], ['FR', 'BR']];
// (solved: solvedFlags(facelets), when the caller has it)
function planFeaturesY(facelets, out = new Array(16).fill(0), solved = null) {
    const flags = solved || solvedFlags(facelets);
    const f = planFeatures(facelets, PLAN_Y_FLAGS, flags);
    for (let r = 0; r < 4; r++) {
        const swap = r === 1 || r === 3;
        out[4 * r] = swap ? f[1] : f[0];
        out[4 * r + 1] = swap ? f[0] : f[1];
        out[4 * r + 2] = f[2];
        out[4 * r + 3] = (flags[PLAN_BACK_BY_Y[r][0]] ? 0 : 1) + (flags[PLAN_BACK_BY_Y[r][1]] ? 0 : 1);
    }
    return out;
}
const PLAN_Y_FLAGS = [0, 0, 0, 0];

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { solvedFlags, pseudoSolvedFlags, MASKS, CORNER_MASKS, EDGE_MASKS, pairLookFeatures, LOOK_FEATURES, planFeatures, planFeaturesY, PLAN_FEATURES };
}
