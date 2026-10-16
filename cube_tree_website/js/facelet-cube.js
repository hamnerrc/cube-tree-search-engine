// A pure-JS 54-facelet 3x3 cube simulator, used for luck filtering (verifying
// which pieces a candidate algorithm *actually* solves, independent of what
// its DAG edge claims).

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

// MOVE_TABLE is complete at this point; a Map lookup instead of
// hasOwnProperty on every token.
const MOVE_PERMS = new Map(Object.entries(MOVE_TABLE));
function isMoveToken(token) {
    return MOVE_PERMS.has(token);
}

const ALG_BUF_A = new Uint16Array(54);
const ALG_BUF_B = new Uint16Array(54);
function applyAlgorithm(facelets, algorithm) {
    let text = String(algorithm);
    if (/none/i.test(text)) text = text.replace(/\bnone\b/gi, '');
    const tokens = text.trim().split(/\s+/);
    let cur = null;
    let next = ALG_BUF_B;
    for (const token of tokens) {
        if (!token) continue;
        const perm = MOVE_PERMS.get(token);
        if (perm === undefined) {
            throw new Error(`facelet-cube: unrecognized move token "${token}"`);
        }
        if (cur === null) {
            cur = ALG_BUF_A;
            for (let i = 0; i < 54; i++) cur[i] = facelets.charCodeAt(i);
        }
        for (let i = 0; i < 54; i++) next[i] = cur[perm[i]];
        const t = cur; cur = next; next = t;
    }
    return cur === null ? facelets : String.fromCharCode.apply(null, cur);
}

const FACE_TURNS = [...'UDRLFB'].flatMap(f => [f, `${f}'`, `${f}2`]);
const ROTATION_TOKENS = [...'xyz'].flatMap(a => [a, `${a}'`, `${a}2`]);
const permKey = perm => perm.join(',');
const FACE_TURN_BY_PERM = new Map(FACE_TURNS.map(t => [permKey(MOVE_TABLE[t]), t]));
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

function primitiveTokens(token) {
    const t = token.replace(/2'$/, '2');
    const base = t.replace(/['2]$/, '');
    const parts = DERIVED_MOVES[base];
    if (!parts) return [t];
    if (t.endsWith("'")) return parts.slice().reverse().map(invertToken);
    if (t.endsWith('2')) return parts.concat(parts);
    return parts.slice();
}

// Every single token by permutation (face turns first, so they win ties).
const TOKEN_BY_PERM = new Map();
for (const t of [...FACE_TURNS, ...ROTATION_TOKENS, ...Object.keys(DERIVED_MOVES).flatMap(n => [n, `${n}'`, `${n}2`])]) {
    if (!TOKEN_BY_PERM.has(permKey(MOVE_TABLE[t]))) TOKEN_BY_PERM.set(permKey(MOVE_TABLE[t]), t);
}

const ROT_PERMS = [];
const ROT_INDEX_BY_KEY = new Map();
for (const [key] of ROTATION_BY_PERM) {
    ROT_INDEX_BY_KEY.set(key, ROT_PERMS.length);
    ROT_PERMS.push(key.split(',').map(Number));
}
const ROT_NAMES = [...ROTATION_BY_PERM.values()];
const ROT_IDENTITY = ROT_INDEX_BY_KEY.get(permKey(IDENTITY_PERM));
const rotIndexOf = perm => ROT_INDEX_BY_KEY.get(permKey(perm));
// ROT_MUL[i][j]: index of composePerm(ROT_PERMS[i], ROT_PERMS[j]).
const ROT_MUL = ROT_PERMS.map(a => ROT_PERMS.map(b => rotIndexOf(composePerm(a, b))));
const ROT_INV = ROT_PERMS.map(a => rotIndexOf(invertPerm(a)));
const ROT_OF_TOKEN = Object.fromEntries(ROTATION_TOKENS.map(t => [t, rotIndexOf(MOVE_TABLE[t])]));
// CONJ[i].get(token): the single token equal to inv(R_i) * token * R_i (perm
// composition order), i.e. `token` relabelled for rotation i; null if none.
const CONJ = ROT_PERMS.map(() => new Map());
function conjugateToken(rotIndex, token) {
    const cache = CONJ[rotIndex];
    let name = cache.get(token);
    if (name === undefined) {
        const r = ROT_PERMS[rotIndex];
        name = TOKEN_BY_PERM.get(permKey(composePerm(composePerm(invertPerm(r), MOVE_TABLE[token]), r))) || null;
        cache.set(token, name);
    }
    return name;
}
function rotationIndex(rotation) {
    let q = ROT_IDENTITY;
    for (const t of String(rotation || '').split(/\s+/)) {
        if (!t) continue;
        const r = ROT_OF_TOKEN[t];
        if (r === undefined) throw new Error(`facelet-cube: not a rotation token "${t}"`);
        q = ROT_MUL[q][r];
    }
    return q;
}
const FACE_TURN_SET = new Set(FACE_TURNS);
function composeRotationIndex(a, b) {
    return ROT_MUL[a][b];
}

function canonicalizeForEngine(prefixRotation, alg) {
    const tokens = [prefixRotation, alg].filter(Boolean).join(' ')
        .replace(/\bnone\b/gi, '').trim().split(/\s+/).filter(Boolean);
    // Pass 1: rewrite as "E then Q" with E in the starting frame; each early
    // move e_k = Q_k p Q_k^-1 is kept as (p, Q_k).
    let q = ROT_IDENTITY;
    const early = [];
    for (const tok of tokens) {
        if (!isMoveToken(tok)) throw new Error(`facelet-cube: unrecognized move token "${tok}"`);
        for (const p of primitiveTokens(tok)) {
            const r = ROT_OF_TOKEN[p];
            if (r !== undefined) { q = ROT_MUL[q][r]; continue; }
            early.push(p, q);
        }
    }
    // Pass 2: "E then Q" == "Q then (Q^-1 e_k Q for each k)", and
    // Q^-1 Q_k p Q_k^-1 Q is p relabelled for rotation Q_k^-1 Q.
    const moves = [];
    for (let k = 0; k < early.length; k += 2) {
        const name = conjugateToken(ROT_MUL[ROT_INV[early[k + 1]]][q], early[k]);
        if (!FACE_TURN_SET.has(name)) throw new Error('canonicalizeForEngine: conjugated move is not a face turn');
        moves.push(name);
    }
    return { rotation: ROT_NAMES[q], moves: moves.join(' ') };
}

function relabelAlgForRotation(alg, rotation) {
    const r = rotationIndex(rotation);
    return String(alg).split(/\s+/).filter(Boolean).map(t => {
        const name = isMoveToken(t) ? conjugateToken(r, t) : null;
        if (!name) throw new Error(`relabelAlgForRotation: no single token for ${t} under ${rotation}`);
        return name;
    }).join(' ');
}

const AXIS_RANK = {};
[['U', 'D', 'u', 'd', 'E', 'y'], ['R', 'L', 'r', 'l', 'M', 'x'], ['F', 'B', 'f', 'b', 'S', 'z']]
    .forEach((group, axis) => group.forEach((m, rank) => { AXIS_RANK[m] = { axis, rank }; }));
function commuteNormalize(alg) {
    const t = String(alg).split(/\s+/).filter(Boolean);
    for (let changed = true; changed;) {
        changed = false;
        for (let i = 0; i + 1 < t.length; i++) {
            const a = AXIS_RANK[t[i][0]], b = AXIS_RANK[t[i + 1][0]];
            if (a && b && a.axis === b.axis && (a.rank > b.rank || (a.rank === b.rank && t[i] > t[i + 1]))) {
                [t[i], t[i + 1]] = [t[i + 1], t[i]];
                changed = true;
            }
        }
    }
    return t.join(' ');
}

function rotationSpellings(alg, allowLeading = true) {
    return rotationSpellingParts(alg, allowLeading).map(s => s.alg);
}

function rotationSpellingParts(alg, allowLeading = true) {
    const t = String(alg).split(/\s+/).filter(Boolean);
    const start = allowLeading ? 0 : 1;
    // Relabelling is per token, so each token is relabelled once per rotation
    // and every suffix reuses it (was one relabelAlgForRotation per split).
    const rests = {};
    for (const r of ['y', "y'"]) {
        const ri = rotationIndex(r);
        const rel = t.map(tok => (isMoveToken(tok) ? conjugateToken(ri, tok) : null));
        for (let i = start; i < rel.length; i++) {
            if (rel[i] === null) throw new Error(`relabelAlgForRotation: no single token for ${t[i]} under ${r}`);
        }
        // rest[k] = rel[k..].join(' ')
        const rest = new Array(t.length);
        for (let k = t.length - 1; k >= start; k--) rest[k] = k === t.length - 1 ? rel[k] : `${rel[k]} ${rest[k + 1]}`;
        rests[r] = rest;
    }
    const out = [];
    let prefix = t.slice(0, start).join(' ');
    for (let k = start; k < t.length; k++) {
        for (const r of ['y', "y'"]) {
            out.push({ alg: prefix ? `${prefix} ${r} ${rests[r][k]}` : `${r} ${rests[r][k]}`, rotation: r });
        }
        prefix = prefix ? `${prefix} ${t[k]}` : t[k];
    }
    return out;
}

const WIDE_TOKEN_CACHE = new Map();
function wideTokenFor(token, rho) {
    const key = `${token} ${rho}`;
    if (!WIDE_TOKEN_CACHE.has(key)) {
        WIDE_TOKEN_CACHE.set(key, TOKEN_BY_PERM.get(permKey(composePerm(MOVE_TABLE[token], MOVE_TABLE[rho]))));
    }
    return WIDE_TOKEN_CACHE.get(key);
}

function inspectionWideVariants(alg, maxPos = 2) {
    const t = String(alg).split(/\s+/).filter(Boolean);
    const out = [];
    for (let k = 0; k < Math.min(maxPos, t.length); k++) {
        if (!/^[LR]/.test(t[k])) continue;
        for (const rho of ['x', "x'", 'x2']) {
            const w = wideTokenFor(t[k], rho);  // at most 2 per alg
            if (!w || !/^[rl]/.test(w)) continue;
            // t[:k] w relabel(t[k+1:], rho) == alg then rho
            const spelled = [...t.slice(0, k), w, relabelAlgForRotation(t.slice(k + 1).join(' '), rho)].join(' ').trim();
            const undo = inverseRotation(rho);
            out.push({ alg: relabelAlgForRotation(spelled, undo), inspection: undo });
        }
    }
    return out;
}

const WIDE_CONVERT_ROTATIONS = ['y', "y'", 'y2', 'z', "z'", 'z2'];
const WIDE_FACE_RE = /^[UDFB]/;
const WIDE_UDFB_RE = /^[udfb]/;
const Y_FAMILY = new Set(['', 'y', 'y2', "y'"].map(r => rotationIndex(r)));
// For a face turn: [{ wide, rho }] with wide == "turn, then rho".
const WIDE_CONVERSIONS = new Map();
function wideConversions(token) {
    let list = WIDE_CONVERSIONS.get(token);
    if (!list) {
        list = [];
        if (WIDE_FACE_RE.test(token) && FACE_TURN_SET.has(token)) {
            for (const rho of WIDE_CONVERT_ROTATIONS) {
                const w = wideTokenFor(token, rho);
                // Never a wide B.
                if (w && WIDE_UDFB_RE.test(w) && w[0] !== 'b') list.push({ wide: w, rho: ROT_OF_TOKEN[rho] });
            }
        }
        WIDE_CONVERSIONS.set(token, list);
    }
    return list;
}
const isRotationToken = t => ROT_OF_TOKEN[t] !== undefined;
const awkwardCount = tokens => tokens.reduce((n, x) => n + (/^[DFBxyz]/.test(x) ? 1 : 0), 0);
const fbCount = tokens => tokens.reduce((n, x) => n + (/^[FB]/.test(x) ? 1 : 0), 0);
// How many of u, d, f, b a spelling uses (mixing them never ranked well).
const wideFamilies = tokens => new Set(tokens.filter(x => WIDE_UDFB_RE.test(x)).map(x => x[0])).size;

function wideSpellingParts(alg, maxWide = 2) {
    const t = String(alg).split(/\s+/).filter(Boolean);
    const rotationsIn = t.filter(isRotationToken).length;
    const awkwardIn = awkwardCount(t);
    const fbIn = fbCount(t);
    const out = [];
    const seen = new Set();
    // written so far == (alg's first i tokens, then rotation `delta`)
    const walk = (i, delta, written, wide, rotations) => {
        if (i === t.length) {
            if (!wide || !Y_FAMILY.has(delta)) return;
            if (awkwardCount(written) >= awkwardIn || fbCount(written) > fbIn || wideFamilies(written) !== 1) return;
            if (written.some(x => x[0] === 'b')) return; // never a wide B (an r/l relabelled by y can become one)
            const spelled = written.join(' ');
            if (!seen.has(spelled)) { seen.add(spelled); out.push({ alg: spelled, rotation: ROT_NAMES[delta] }); }
            return;
        }
        const tok = t[i];
        const w = conjugateToken(delta, tok);
        if (!w) return;
        if (isRotationToken(tok)) {
            // Absorb it: the frame change already done replaces it.
            if (delta !== ROT_IDENTITY) walk(i + 1, ROT_MUL[ROT_INV[ROT_OF_TOKEN[tok]]][delta], written, wide, rotations);
            if (rotations < rotationsIn) walk(i + 1, delta, [...written, w], wide, rotations + 1);
            return;
        }
        walk(i + 1, delta, [...written, w], wide, rotations);
        if (wide < maxWide) {
            for (const { wide: wt, rho } of wideConversions(w)) {
                walk(i + 1, ROT_MUL[delta][rho], [...written, wt], wide + 1, rotations);
            }
        }
    };
    walk(0, ROT_IDENTITY, [], 0, 0);
    return out;
}

function rotationName(rotation) {
    return canonicalizeForEngine('', rotation).rotation;
}

function inverseRotation(rotation) {
    return ROT_NAMES[ROT_INV[rotationIndex(rotation)]];
}

// Per token: the product of its primitives' rotations (what
// canonicalizeForEngine accumulates), cached; this is called for every candidate.
const TOKEN_NET_ROT = new Map();
function netRotation(alg) {
    let q = ROT_IDENTITY;
    for (const tok of String(alg).split(' ')) {
        if (!tok) continue;
        let r = TOKEN_NET_ROT.get(tok);
        if (r === undefined) {
            if (!isMoveToken(tok)) throw new Error(`facelet-cube: unrecognized move token "${tok}"`);
            r = ROT_IDENTITY;
            for (const p of primitiveTokens(tok)) if (ROT_OF_TOKEN[p] !== undefined) r = ROT_MUL[r][ROT_OF_TOKEN[p]];
            TOKEN_NET_ROT.set(tok, r);
        }
        q = ROT_MUL[q][r];
    }
    return ROT_NAMES[q];
}

function rotationFirst(alg) {
    const t = String(alg).split(' ').filter(Boolean);
    let lead = 0;
    while (lead < t.length && /^[xyz]/.test(t[lead])) lead++;
    if (t.slice(0, lead).some(r => r[0] !== 'y')) return alg;
    const moved = [];
    const ud = [];
    let q = lead;
    for (; q < t.length; q++) {
        if (t[q][0] === 'y') moved.push(t[q]);
        else if ('UDud'.includes(t[q][0])) ud.push(t[q]);
        else break;
    }
    if (!moved.length || !ud.length) return alg;
    const r = rotationName([...t.slice(0, lead), ...moved].join(' '));
    return [r, ...ud, ...t.slice(q)].filter(Boolean).join(' ');
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
        commuteNormalize,
        rotationSpellings,
        rotationSpellingParts,
        rotationFirst,
        inspectionWideVariants,
        wideSpellingParts,
        rotationName,
        rotationIndex,
        composeRotationIndex,
        conjugateToken,
    };
}
