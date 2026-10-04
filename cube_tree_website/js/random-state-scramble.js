// Random-state scramble generator (README "Results table": "The eventual
// goal is proper random-state WCA-legal scrambles").
//
// Picks a uniformly random reachable cube state at the cubie level, solves
// it with a two-phase (Kociemba) search, and returns the inverse of that
// solution as the scramble -- the same approach WCA scramble programs use.
//
// Nothing about the face turns is hand-typed: each basic move's cubie
// definition is read off facelet-cube.js (itself cross-verified against
// magiccube) by applying the move to a solved facelet string and decoding
// the result with the standard Kociemba corner/edge facelet tables below.
// Coordinate move tables are then built by BFS over real cubie states, so
// no coordinate "set" inverses are needed either. See
// test/random-state-scramble.test.js for the verification (facelet replay
// of every scramble against the cubie state it was generated from, plus an
// independent check with the Python `kociemba` package).
//
// Wrapped in a function scope: plain <script> tags share one global scope
// in the browser (PROJECT_STATUS.md §4.14, test/browser-globals.test.js).
const RandomStateScramble = (() => {
    const faceletLib = (typeof module !== 'undefined' && module.exports)
        ? require('./facelet-cube.js')
        : { applyAlgorithm, SOLVED_FACELETS };

    // Kociemba facelet tables, URFDLB layout (U1..U9 = 0..8, R = 9.., F = 18..,
    // D = 27.., L = 36.., B = 45..). Corners URF UFL ULB UBR DFR DLF DBL DRB,
    // edges UR UF UL UB DR DF DL DB FR FL BL BR. Decoding a solved cube through
    // these and finding the identity is part of the test suite.
    const CORNER_FACELETS = [
        [8, 9, 20], [6, 18, 38], [0, 36, 47], [2, 45, 11],
        [29, 26, 15], [27, 44, 24], [33, 53, 42], [35, 17, 51],
    ];
    const EDGE_FACELETS = [
        [5, 10], [7, 19], [3, 37], [1, 46], [32, 16], [28, 25],
        [30, 43], [34, 52], [23, 12], [21, 41], [50, 39], [48, 14],
    ];

    const centerColors = (f) => [4, 13, 22, 31, 40, 49].map(i => f[i]);

    function faceletsToCubie(f) {
        const solved = faceletLib.SOLVED_FACELETS;
        const cp = [], co = [], ep = [], eo = [];
        for (let pos = 0; pos < 8; pos++) {
            const cols = CORNER_FACELETS[pos].map(i => f[i]);
            const uIdx = cols.findIndex(c => c === f[4] || c === f[31]);
            for (let piece = 0; piece < 8; piece++) {
                const home = CORNER_FACELETS[piece].map(i => solved[i]);
                if (home[0] === cols[uIdx] && home[1] === cols[(uIdx + 1) % 3] && home[2] === cols[(uIdx + 2) % 3]) {
                    cp.push(piece); co.push(uIdx);
                    break;
                }
            }
        }
        for (let pos = 0; pos < 12; pos++) {
            const cols = EDGE_FACELETS[pos].map(i => f[i]);
            for (let piece = 0; piece < 12; piece++) {
                const home = EDGE_FACELETS[piece].map(i => solved[i]);
                if (home[0] === cols[0] && home[1] === cols[1]) { ep.push(piece); eo.push(0); break; }
                if (home[0] === cols[1] && home[1] === cols[0]) { ep.push(piece); eo.push(1); break; }
            }
        }
        if (cp.length !== 8 || ep.length !== 12) throw new Error('faceletsToCubie: not a valid cube state');
        return { cp, co, ep, eo };
    }

    function cubieToFacelets(c) {
        const solved = faceletLib.SOLVED_FACELETS;
        const out = solved.split('');
        for (let pos = 0; pos < 8; pos++) {
            const home = CORNER_FACELETS[c.cp[pos]].map(i => solved[i]);
            for (let k = 0; k < 3; k++) out[CORNER_FACELETS[pos][(k + c.co[pos]) % 3]] = home[k];
        }
        for (let pos = 0; pos < 12; pos++) {
            const home = EDGE_FACELETS[c.ep[pos]].map(i => solved[i]);
            for (let k = 0; k < 2; k++) out[EDGE_FACELETS[pos][(k + c.eo[pos]) % 2]] = home[k];
        }
        return out.join('');
    }

    // a then b (replacement model: position i takes what a had at b.cp[i]).
    function multiply(a, b) {
        const r = { cp: new Array(8), co: new Array(8), ep: new Array(12), eo: new Array(12) };
        for (let i = 0; i < 8; i++) {
            r.cp[i] = a.cp[b.cp[i]];
            r.co[i] = (a.co[b.cp[i]] + b.co[i]) % 3;
        }
        for (let i = 0; i < 12; i++) {
            r.ep[i] = a.ep[b.ep[i]];
            r.eo[i] = (a.eo[b.ep[i]] + b.eo[i]) % 2;
        }
        return r;
    }

    const SOLVED_CUBIE = { cp: [0, 1, 2, 3, 4, 5, 6, 7], co: Array(8).fill(0), ep: [...Array(12).keys()], eo: Array(12).fill(0) };

    // 18 moves, index = face*3 + power-1; faces in URFDLB order.
    const FACES = 'URFDLB';
    const MOVE_NAMES = [];
    for (const face of FACES) MOVE_NAMES.push(face, face + '2', face + "'");
    let MOVE_CUBIES = null;
    function moveCubies() {
        if (!MOVE_CUBIES) {
            MOVE_CUBIES = MOVE_NAMES.map(m =>
                faceletsToCubie(faceletLib.applyAlgorithm(faceletLib.SOLVED_FACELETS, m)));
        }
        return MOVE_CUBIES;
    }
    // Phase-2 move set <U, D, R2, L2, F2, B2>.
    const PHASE2_MOVES = [...Array(18).keys()].filter(m => {
        const face = FACES[Math.floor(m / 3)];
        return face === 'U' || face === 'D' || m % 3 === 1;
    });

    // --- coordinates ---
    const twistOf = c => { let t = 0; for (let i = 0; i < 7; i++) t = t * 3 + c.co[i]; return t; };
    const flipOf = c => { let t = 0; for (let i = 0; i < 11; i++) t = t * 2 + c.eo[i]; return t; };
    const SLICE_MASKS = [];
    const SLICE_INDEX = new Int16Array(4096).fill(-1);
    for (let m = 0; m < 4096; m++) {
        let bits = 0; for (let k = m; k; k &= k - 1) bits++;
        if (bits === 4) { SLICE_INDEX[m] = SLICE_MASKS.length; SLICE_MASKS.push(m); }
    }
    const sliceOf = c => { let m = 0; for (let i = 0; i < 12; i++) if (c.ep[i] >= 8) m |= 1 << i; return SLICE_INDEX[m]; };
    function permIndex(arr) {
        // Lehmer code
        let idx = 0;
        for (let i = 0; i < arr.length; i++) {
            let smaller = 0;
            for (let j = i + 1; j < arr.length; j++) if (arr[j] < arr[i]) smaller++;
            idx = idx * (arr.length - i) + smaller;
        }
        return idx;
    }
    const cpermOf = c => permIndex(c.cp);
    const edge8Of = c => permIndex(c.ep.slice(0, 8));
    const slicePermOf = c => permIndex(c.ep.slice(8).map(e => e - 8));

    // Build a coordinate move table by BFS over real cubie states, keeping one
    // representative cubie per coordinate value.
    function buildMoveTable(size, coordOf, moves) {
        const table = new Int32Array(size * 18).fill(-1);
        const reps = new Array(size);
        const start = coordOf(SOLVED_CUBIE);
        reps[start] = SOLVED_CUBIE;
        const queue = [start];
        const mc = moveCubies();
        for (let qi = 0; qi < queue.length; qi++) {
            const x = queue[qi];
            for (const m of moves) {
                const nxt = multiply(reps[x], mc[m]);
                const y = coordOf(nxt);
                table[x * 18 + m] = y;
                if (reps[y] === undefined) { reps[y] = nxt; queue.push(y); }
            }
        }
        if (queue.length !== size) throw new Error(`move table: reached ${queue.length} of ${size} coordinates`);
        return table;
    }

    function buildPrune(sizeA, tableA, sizeB, tableB, moves, startA, startB) {
        const prune = new Int8Array(sizeA * sizeB).fill(-1);
        prune[startA * sizeB + startB] = 0;
        let done = 1, depth = 0;
        while (done < sizeA * sizeB) {
            let progressed = false;
            for (let i = 0; i < prune.length; i++) {
                if (prune[i] !== depth) continue;
                const a = Math.floor(i / sizeB), b = i % sizeB;
                for (const m of moves) {
                    const j = tableA[a * 18 + m] * sizeB + tableB[b * 18 + m];
                    if (prune[j] === -1) { prune[j] = depth + 1; done++; progressed = true; }
                }
            }
            if (!progressed) break;
            depth++;
        }
        return prune;
    }

    let T = null;
    function tables() {
        if (T) return T;
        const ALL = [...Array(18).keys()];
        const s = SOLVED_CUBIE;
        T = {
            twist: buildMoveTable(2187, twistOf, ALL),
            flip: buildMoveTable(2048, flipOf, ALL),
            slice: buildMoveTable(495, sliceOf, ALL),
            cperm: buildMoveTable(40320, cpermOf, PHASE2_MOVES),
            edge8: buildMoveTable(40320, edge8Of, PHASE2_MOVES),
            sliceperm: buildMoveTable(24, slicePermOf, PHASE2_MOVES),
            goal: { twist: twistOf(s), flip: flipOf(s), slice: sliceOf(s), cperm: cpermOf(s), edge8: edge8Of(s), sliceperm: slicePermOf(s) },
        };
        const g = T.goal;
        T.pruneSliceTwist = buildPrune(495, T.slice, 2187, T.twist, ALL, g.slice, g.twist);
        T.pruneSliceFlip = buildPrune(495, T.slice, 2048, T.flip, ALL, g.slice, g.flip);
        T.pruneSliceCperm = buildPrune(24, T.sliceperm, 40320, T.cperm, PHASE2_MOVES, g.sliceperm, g.cperm);
        T.pruneSliceEdge8 = buildPrune(24, T.sliceperm, 40320, T.edge8, PHASE2_MOVES, g.sliceperm, g.edge8);
        return T;
    }

    // Same face twice in a row is never useful; for opposite faces only allow
    // one order (U before D, R before L, F before B).
    function allowedAfter(prev, m) {
        if (prev < 0) return true;
        const pf = Math.floor(prev / 3), f = Math.floor(m / 3);
        if (pf === f) return false;
        if (pf % 3 === f % 3 && pf > f) return false;
        return true;
    }

    // Two-phase search; returns an array of move indices solving `cube`.
    function solve(cube, maxLength = 22) {
        const t = tables();
        const g = t.goal;
        const mc = moveCubies();
        const p1 = [], p2 = [];
        let result = null;

        function phase2(cp, e8, sp, depth, prev) {
            if (depth === 0) return cp === g.cperm && e8 === g.edge8 && sp === g.sliceperm;
            const h = Math.max(t.pruneSliceCperm[sp * 40320 + cp], t.pruneSliceEdge8[sp * 40320 + e8]);
            if (h > depth) return false;
            for (const m of PHASE2_MOVES) {
                if (!allowedAfter(prev, m)) continue;
                p2.push(m);
                if (phase2(t.cperm[cp * 18 + m], t.edge8[e8 * 18 + m], t.sliceperm[sp * 18 + m], depth - 1, m)) return true;
                p2.pop();
            }
            return false;
        }

        function startPhase2(budget) {
            let c = cube;
            for (const m of p1) c = multiply(c, mc[m]);
            const cp = cpermOf(c), e8 = edge8Of(c), sp = slicePermOf(c);
            const prev = p1.length ? p1[p1.length - 1] : -1;
            for (let d = 0; d <= budget; d++) {
                p2.length = 0;
                if (phase2(cp, e8, sp, d, prev)) return true;
            }
            return false;
        }

        function phase1(tw, fl, sl, depth, prev) {
            if (depth === 0) {
                if (tw !== g.twist || fl !== g.flip || sl !== g.slice) return false;
                // A phase-1 solution ending in a phase-2 move is a shorter
                // phase-1 solution in disguise; skip it (standard pruning).
                if (prev >= 0 && PHASE2_MOVES.includes(prev)) return false;
                return startPhase2(maxLength - p1.length);
            }
            const h = Math.max(t.pruneSliceTwist[sl * 2187 + tw], t.pruneSliceFlip[sl * 2048 + fl]);
            if (h > depth) return false;
            for (let m = 0; m < 18; m++) {
                if (!allowedAfter(prev, m)) continue;
                p1.push(m);
                if (phase1(t.twist[tw * 18 + m], t.flip[fl * 18 + m], t.slice[sl * 18 + m], depth - 1, m)) return true;
                p1.pop();
            }
            return false;
        }

        const tw = twistOf(cube), fl = flipOf(cube), sl = sliceOf(cube);
        for (let d = 0; d <= maxLength; d++) {
            p1.length = 0;
            if (phase1(tw, fl, sl, d, -1)) { result = p1.concat(p2); break; }
        }
        return result;
    }

    function parity(perm) {
        let p = 0;
        for (let i = 0; i < perm.length; i++) for (let j = i + 1; j < perm.length; j++) if (perm[j] < perm[i]) p ^= 1;
        return p;
    }

    function shuffle(arr, rand) {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(rand() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    }

    // Uniformly random reachable state: random permutations with matching
    // parity, random orientations with a fixed-up last piece.
    function randomCubie(rand = Math.random) {
        const cp = shuffle([...Array(8).keys()], rand);
        const ep = shuffle([...Array(12).keys()], rand);
        if (parity(cp) !== parity(ep)) [ep[0], ep[1]] = [ep[1], ep[0]];
        const co = [], eo = [];
        let cs = 0, es = 0;
        for (let i = 0; i < 7; i++) { co.push(Math.floor(rand() * 3)); cs += co[i]; }
        co.push((3 - cs % 3) % 3);
        for (let i = 0; i < 11; i++) { eo.push(Math.floor(rand() * 2)); es += eo[i]; }
        eo.push(es % 2);
        return { cp, co, ep, eo };
    }

    const invertMoveName = name => name.endsWith('2') ? name : name.endsWith("'") ? name[0] : name + "'";

    // Returns { scramble, state } where `state` is the cubie state the
    // scramble produces from solved (white top, green front).
    function generate(rand = Math.random) {
        for (;;) {
            const state = randomCubie(rand);
            const sol = solve(state);
            // WCA regulation 4b3: a scramble must not be solvable in fewer
            // than 2 moves; also covers the (astronomically unlikely) solved state.
            if (!sol || sol.length < 2) continue;
            const scramble = sol.slice().reverse().map(m => invertMoveName(MOVE_NAMES[m])).join(' ');
            return { scramble, state };
        }
    }

    return {
        generate,
        solve: (cube, maxLength) => (solve(cube, maxLength) || []).map(m => MOVE_NAMES[m]).join(' '),
        randomCubie,
        faceletsToCubie,
        cubieToFacelets,
        multiply,
        SOLVED_CUBIE,
        MOVE_NAMES,
        PHASE2_MOVES,
        tables,
    };
})();

function generateRandomStateScramble(rand) {
    return RandomStateScramble.generate(rand).scramble;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { RandomStateScramble, generateRandomStateScramble };
}
