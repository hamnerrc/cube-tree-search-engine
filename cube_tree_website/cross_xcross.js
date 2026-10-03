const path = require('path');
const fs = require('fs');
const { fork } = require('child_process');

const BASE_DIR = '/Users/rc/ML_projects/CF2L_AI/cube_tree_website';
const SCRAMBLE = process.argv[2] ?? "R2 U2 L D' R' F' B' R F' R F2 D2 R F2 D2 B2 D2 L F2 D2";

const CONFIG = {
    // Only search White and Yellow
    enabledColors: { white: true, yellow: true, green: false, blue: false, red: false, orange: false },
    // 0: Cross, 1: 1-XCross
    enabledSearchTypes: { 0: true, 1: false, 2: false, 3: false },
    phase1: {
        maxSolutions: 10000,
        depthLimits: { cross: 9, xcross: 8 },
        moveRestrict: 'U_U2_U-_D_D2_D-_L_L2_L-_R_R2_R-_F_F2_F-_B_B2_B-'
    },
    enablePseudoSearch: false,
    topResultsToDisplay: 15
};

const PATHS = {
    tree: path.join(BASE_DIR, 'F2L_tree.json'),
    solverJs: path.join(BASE_DIR, 'crossSolver/solver.js'),
    solverWasm: path.join(BASE_DIR, 'crossSolver/solver.wasm'),
    crossHelper: path.join(BASE_DIR, 'crossSolver/solver-helper-node.js'),
    script: path.join(BASE_DIR, 'script.js'),
    pseudoJs: path.join(BASE_DIR, 'pseudoCrossSolver/pseudo.js'),
    pseudoWasm: path.join(BASE_DIR, 'pseudoCrossSolver/pseudo.wasm'),
};

const COLOR_ORIENTATIONS = {
    white: ['none'],
    yellow: ['z2']
};

const SLOT_INDICES = { BL: 0, BR: 1, FR: 2, FL: 3 };
const SOLVER_METHODS = { 0: 'solveCross', 1: 'solveXcross' };
const SEARCH_TYPE_KEYS = { 0: 'cross', 1: 'xcross' };

const { altAlgs, cleanScramble, isPseudoState, calculateSolvedPieces, scoreAlgorithms } = require(PATHS.script);

const dispatchSolver = (scrambleInput, targetNode, solverOptions, isPseudo) => {
    return new Promise((resolve, reject) => {
        const corners = targetNode.state.corners ?? [];
        const edges = targetNode.state.edges ?? [];
        const pairCount = corners.length;

        const workerSourceCode = `
            const fs = require('fs');
            const { cleanScramble } = require(${JSON.stringify(PATHS.script)});
            const SOLVER_METHODS = ${JSON.stringify(SOLVER_METHODS)};
            const SLOT_INDICES = ${JSON.stringify(SLOT_INDICES)};
            const PATHS = ${JSON.stringify(PATHS)};

            const executePseudoWasm = async (payload) => {
                globalThis.Module = {
                    wasmBinary: fs.readFileSync(PATHS.pseudoWasm),
                    locateFile: (p) => p.endsWith('.wasm') ? PATHS.pseudoWasm : p,
                    print: () => {}, printErr: () => {}
                };
                const wasm = require(PATHS.pseudoJs);
                while (typeof wasm.solve !== 'function') await new Promise(r => setTimeout(r, 20));
                
                return new Promise((resolve, reject) => {
                    const solutions = [];
                    const originalPostMessage = globalThis.postMessage;
                    globalThis.postMessage = (msg) => {
                        if (['Search finished.', 'Already solved.', 'Search cancelled.'].includes(msg)) {
                            globalThis.postMessage = originalPostMessage;
                            return resolve(solutions);
                        }
                        if (typeof msg === 'string' && msg.startsWith('Error')) {
                            globalThis.postMessage = originalPostMessage;
                            return reject(new Error(msg));
                        }
                        if (msg) solutions.push(msg);
                    };
                    try {
                        const { scramble, corners, edges, options } = payload;
                        wasm.solve(
                            cleanScramble(scramble), options.rotation || '', edges.join(' '), corners.join(' '),
                            options.maxSolutions, options.maxLength, options.moveRestrict, options.postAlg || '',
                            options.centerOffset || 'EMPTY_EMPTY', options.maxRotCount || 0, options.ma2 || '', options.mcString || ''
                        );
                    } catch (err) {
                        globalThis.postMessage = originalPostMessage;
                        reject(err);
                    }
                });
            };

            const executeMatchedWasm = async (payload) => {
                const MatchedHelper = require(PATHS.crossHelper);
                const engine = new MatchedHelper();
                engine.Module = { wasmBinary: fs.readFileSync(PATHS.solverWasm) };
                engine.init(require(PATHS.solverJs));
                
                while (!engine.ready && typeof engine.isReady === 'function' && !engine.isReady()) {
                    await new Promise(r => setTimeout(r, 20));
                }
                
                const methodName = SOLVER_METHODS[payload.pairCount];
                if (!methodName || typeof engine[methodName] !== 'function') return [];
                
                const safeScramble = cleanScramble(payload.scramble);
                if (payload.pairCount === 0) return await engine[methodName](safeScramble, payload.options);
                
                const slotIndices = payload.corners.map(c => SLOT_INDICES[c]);
                if (slotIndices.includes(undefined)) return [];
                
                return await engine[methodName](safeScramble, ...slotIndices, payload.options);
            };

            (async () => {
                try {
                    const payload = JSON.parse(process.argv[2]);
                    const solutions = payload.isPseudo ? await executePseudoWasm(payload) : await executeMatchedWasm(payload);
                    process.stdout.write(JSON.stringify({ ok: true, solutions: solutions || [] }) + '\\n');
                } catch (err) {
                    process.stdout.write(JSON.stringify({ ok: false, error: err.message || String(err) }) + '\\n');
                    process.exit(1);
                }
            })();
        `;

        const payload = JSON.stringify({ scramble: scrambleInput, corners, edges, pairCount, isPseudo, options: solverOptions });

        const child = fork(path.join(__dirname, 'dummy_worker'), [payload], {
            execArgv: ['-e', workerSourceCode],
            stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
            env: process.env
        });

        let stdoutBuffer = '';
        child.stdout.on('data', (chunk) => stdoutBuffer += chunk.toString());

        child.on('exit', (code) => {
            try {
                const result = JSON.parse(stdoutBuffer.trim().split('\n').pop());
                if (result.ok) resolve(result.solutions);
                else reject(new Error(result.error || 'Child execution failed'));
            } catch (err) {
                reject(err);
            }
        });
    });
};

const findBestCrossAndXcross = async () => {
    console.log(`=== BEST CROSS / 1-XCROSS SOLVER ===`);
    console.log(`Scramble: ${SCRAMBLE}\n`);

    const dagTree = JSON.parse(fs.readFileSync(PATHS.tree, 'utf8'));
    const nodeIndex = new Map(dagTree.nodes.map(n => [n.id, n]));
    const rootNode = dagTree.nodes.find(n => !n.state.cross_solved) ?? dagTree.nodes[0];

    const validEdges = dagTree.edges.filter(edge => {
        if (edge.source !== rootNode.id) return false;
        const target = nodeIndex.get(edge.target);
        if (!target) return false;
        const pairCount = (target.state.corners ?? []).length;
        return pairCount <= 1 && CONFIG.enabledSearchTypes[pairCount];
    });

    const activeColors = Object.keys(COLOR_ORIENTATIONS).filter(color => CONFIG.enabledColors[color]);

    const tasks = activeColors.flatMap(color =>
        COLOR_ORIENTATIONS[color].flatMap(rotation =>
            validEdges.map(transition => ({
                color,
                rotation,
                transition,
                targetNode: nodeIndex.get(transition.target)
            }))
        )
    );

    console.log(`Searching across ${tasks.length} configurations...`);
    const rawSolutions = [];

    for (const task of tasks) {
        const { color, rotation, transition, targetNode } = task;
        const corners = targetNode.state.corners ?? [];
        const edges = targetNode.state.edges ?? [];
        const pairCount = corners.length;
        const searchKey = SEARCH_TYPE_KEYS[pairCount];
        const depthLimit = CONFIG.phase1.depthLimits[searchKey] ?? 8;
        const isPseudo = isPseudoState(targetNode.state);

        try {
            const solutions = await dispatchSolver(SCRAMBLE, targetNode, {
                rotation: rotation === 'none' ? '' : rotation,
                maxSolutions: CONFIG.phase1.maxSolutions,
                maxLength: depthLimit,
                moveRestrict: CONFIG.phase1.moveRestrict
            }, isPseudo);

            if (!solutions?.length) continue;

            const stepType = isPseudo ? `Pseudo ${pairCount === 0 ? 'Cross' : '1-Pair'}` : (pairCount === 0 ? 'Cross' : '1-XCross');

            for (let moves of solutions) {
                moves = String(moves).trim();
                if (rotation !== 'none' && moves.startsWith(rotation)) {
                    moves = moves.slice(rotation.length).trim();
                }
                if (!moves) continue;

                rawSolutions.push({
                    color,
                    orientation: rotation,
                    sourceNodeId: transition.source,
                    targetNodeId: transition.target,
                    type: stepType,
                    edges: edges.join('+') || '-',
                    corners: corners.join('+') || '-',
                    piecesSolved: calculateSolvedPieces(rootNode, targetNode),
                    moves
                });
            }
        } catch (err) {
            console.error(`Task error (${color}, ${targetNode.id}):`, err.message);
        }
    }

    // Deduplicate
    const uniqueRaw = Array.from(new Map(rawSolutions.map(s => [`${s.color}_${s.moves}`, s])).values());

    // Alternative algorithm expansion
    const expandedSolutions = uniqueRaw.flatMap(sol => altAlgs([sol.moves]).map(altMoves => {
        let finalSetup = sol.orientation === 'none' ? '' : sol.orientation;
        let finalAlg = altMoves.trim();
        const rotationMatch = finalAlg.match(/^(y2|y'|y|x2|x'|x|z2|z'|z)\s*/);

        if (rotationMatch) {
            finalSetup = finalSetup ? `${finalSetup} ${rotationMatch[1]}` : rotationMatch[1];
            finalAlg = finalAlg.slice(rotationMatch[0].length).trim();
        }

        return { ...sol, setup: finalSetup || 'none', moves: finalAlg };
    }));

    // Final deduplication & scoring
    const uniqueExpanded = Array.from(new Map(expandedSolutions.map(s => [`${s.color}_${s.setup}_${s.moves}`, s])).values());
    const scores = scoreAlgorithms(uniqueExpanded.map(s => s.moves));

    const ranked = uniqueExpanded
        .map((sol, idx) => ({
            ...sol,
            score: scores[idx],
            tpp: Number((scores[idx] / sol.piecesSolved).toFixed(4))
        }))
        .sort((a, b) => a.tpp - b.tpp);

    console.log(`\nFound ${ranked.length} total expanded solutions. Top ${CONFIG.topResultsToDisplay}:\n`);

    console.table(ranked.slice(0, CONFIG.topResultsToDisplay).map((item, idx) => ({
        Rank: idx + 1,
        Color: item.color,
        Type: item.type,
        Setup: item.setup,
        Edges: item.edges,
        Corners: item.corners,
        TPP: item.tpp.toFixed(4),
        Alg: item.moves
    })));
};

findBestCrossAndXcross().catch(console.error);