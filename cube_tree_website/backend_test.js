const path = require('path');
const fs = require('fs');
const v8 = require('v8');
const { fork } = require('child_process');

const BASE_DIR = '/Users/rc/ML_projects/CF2L_AI/cube_tree_website';
const SCRAMBLE = process.argv[2] ?? "L' B2 F2 U2 L' U2 R' F2 L' F2 L2 D' B R F' D F D2 L2 B";

const CONFIG = {
    enabledColors: { white: false, yellow: true, green: false, blue: false, red: false, orange: false },
    enabledSearchTypes: { 0: true, 1: true, 2: false, 3: false },
    phase1: {
        maxSolutions: 1000,
        depthLimits: { cross: 8, xcross: 10, xxcross: 11, xxxcross: 12 },
        moveRestrict: 'U_U2_U-_D_D2_D-_L_L2_L-_R_R2_R-_F_F2_F-_B_B2_B-'
    },
    phase2: {
        maxSolutions: 25,
        enabledTypes: { pair: true, multislot: true },
        depthLimits: { pair: 8, multislot: 10 },
        moveRestrict: 'U_U2_U-_D_D2_D-_L_L-_R_R-_F_F-'
    },
    enablePseudoSearch: true,
    topFirstStepsToExpand: 15
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
    white: ['none'], yellow: ['z2'], green: ["x'"], blue: ['x'], red: ['z'], orange: ["z'"]
};

const SLOT_INDICES = { BL: 0, BR: 1, FR: 2, FL: 3 };
const SOLVER_METHODS = { 0: 'solveCross', 1: 'solveXcross', 2: 'solveXxcross', 3: 'solveXxxcross' };
const SEARCH_TYPE_KEYS = { 0: 'cross', 1: 'xcross', 2: 'xxcross', 3: 'xxxcross' };

const { algSpeed, altAlgs, cleanScramble, isPseudoState, calculateSolvedPieces, scoreAlgorithms } = require(PATHS.script);

const diagnostics = {
    phase1Tasks: 0,
    phase2Tasks: 0,
    matchedEngineInits: 0,
    pseudoEngineInits: 0,
    totalSolveCalls: 0,
    successfulSolves: 0,
    emptySolves: 0,
    thrownErrors: 0,
    oomSignals: 0,
    activeTask: null,
    memorySnapshots: [],
    errorLog: []
};

const toMB = (bytes) => Math.round((bytes || 0) / 1024 / 1024);

const getMemoryStats = () => {
    const mu = process.memoryUsage();
    const heap = v8.getHeapStatistics();
    return {
        rss: toMB(mu.rss),
        heapUsed: toMB(mu.heapUsed),
        heapTotal: toMB(mu.heapTotal),
        external: toMB(mu.external),
        arrayBuffers: toMB(mu.arrayBuffers),
        heapLimit: toMB(heap.heap_size_limit),
        totalAvailable: toMB(heap.total_available_size)
    };
};

const recordMemorySnapshot = (label) => {
    const stats = getMemoryStats();
    diagnostics.memorySnapshots.push({ label, ...stats, timestamp: Date.now() });
    console.log(`  [MEM ${label}] rss=${stats.rss}MB heap=${stats.heapUsed}/${stats.heapTotal}MB ext=${stats.external}MB limit=${stats.heapLimit}MB`);
};

const isHardWasmCrash = (err) => /OOM|out of memory|Aborted|memory access out of bounds|RuntimeError/i.test(err?.message || String(err));

const triggerGC = () => {
    if (!global.gc) return console.log('  [GC] Unavailable. Run node with --expose-gc.');
    global.gc();
    recordMemorySnapshot('post-gc');
};

const logTaskFailure = (phase, idx, err, elapsed) => {
    diagnostics.thrownErrors++;
    if (isHardWasmCrash(err)) diagnostics.oomSignals++;

    const message = err.message || String(err);
    const stackHead = (err.stack || '').split('\n').slice(0, 6).join(' | ');

    diagnostics.errorLog.push({
        phase,
        idx,
        elapsed,
        error: message,
        stack: stackHead,
        failedTaskState: { ...diagnostics.activeTask }
    });

    console.log(`    !!! ERROR (${elapsed}ms): ${message}`);
};

class PseudoCrossSolverEngine {
    constructor() {
        this.isReady = false;
        this.wasmModule = null;
        this.initCycle = 0;
    }

    async init() {
        this.initCycle++;
        diagnostics.pseudoEngineInits++;
        recordMemorySnapshot(`pseudo-init-start-${this.initCycle}`);

        this.wasmModule = null;
        this.isReady = false;
        try { delete globalThis.Module; } catch { }

        globalThis.Module = {
            wasmBinary: fs.readFileSync(PATHS.pseudoWasm),
            locateFile: (filePath) => filePath.endsWith('.wasm') ? PATHS.pseudoWasm : filePath,
            print: () => { },
            printErr: (err) => console.error('[Pseudo WASM Error]', err),
        };

        delete require.cache[require.resolve(PATHS.pseudoJs)];
        this.wasmModule = require(PATHS.pseudoJs);

        const timeoutThreshold = Date.now() + 15000;
        while (typeof this.wasmModule.solve !== 'function') {
            if (Date.now() > timeoutThreshold) throw new Error('Pseudo WASM initialization timed out.');
            await new Promise(res => setTimeout(res, 30));
        }

        this.isReady = true;
        recordMemorySnapshot(`pseudo-init-done-${this.initCycle}`);
    }

    solve(scramble, edgeSlots, cornerSlots, options = {}) {
        if (!this.isReady) throw new Error('PseudoCrossSolverEngine offline.');
        diagnostics.totalSolveCalls++;

        const {
            rotation = '', maxSolutions = 100, maxLength = 10,
            moveRestrict = 'U_U2_U-_D_D2_D-_L_L2_L-_R_R2_R-_F_F2_F-_B_B2_B-',
            postAlg = '', centerOffset = 'EMPTY_EMPTY',
            maxRotCount = 0, ma2 = '', mcString = ''
        } = options;

        return new Promise((resolve, reject) => {
            const foundSolutions = [];
            const originalPostMessage = globalThis.postMessage;

            const cleanupAndSettle = (resolver, payload) => {
                globalThis.postMessage = originalPostMessage;
                resolver(payload);
            };

            globalThis.postMessage = (msg) => {
                if (['Search finished.', 'Already solved.', 'Search cancelled.'].includes(msg)) return cleanupAndSettle(resolve, foundSolutions);
                if (typeof msg === 'string' && msg.startsWith('Error')) return cleanupAndSettle(reject, new Error(msg));
                if (msg) foundSolutions.push(msg);
            };

            try {
                this.wasmModule.solve(
                    cleanScramble(scramble), rotation, edgeSlots, cornerSlots,
                    maxSolutions, maxLength, moveRestrict, postAlg,
                    centerOffset, maxRotCount, ma2, mcString
                );
            } catch (err) {
                cleanupAndSettle(reject, err);
            }
        });
    }
}

const initMatchedPairEngine = async () => {
    diagnostics.matchedEngineInits++;
    recordMemorySnapshot(`matched-init-start-${diagnostics.matchedEngineInits}`);

    if (!fs.existsSync(PATHS.solverWasm) || !fs.existsSync(PATHS.crossHelper)) {
        throw new Error('Matched-Pair Engine missing WASM or Helper dependencies.');
    }

    delete require.cache[require.resolve(PATHS.crossHelper)];
    delete require.cache[require.resolve(PATHS.solverJs)];

    const MatchedHelper = require(PATHS.crossHelper);
    const engine = new MatchedHelper();
    engine.Module = { wasmBinary: fs.readFileSync(PATHS.solverWasm) };
    engine.init(require(PATHS.solverJs));

    while (!engine.ready && typeof engine.isReady === 'function' && !engine.isReady()) {
        await new Promise(res => setTimeout(res, 50));
    }

    recordMemorySnapshot(`matched-init-done-${diagnostics.matchedEngineInits}`);
    return engine;
};

const resolveDepthLimit = (pairCount, phaseConfig, isPhase2 = false) => {
    if (isPhase2) return phaseConfig.depthLimits[pairCount <= 1 ? 'pair' : 'multislot'] ?? 10;
    const searchKey = SEARCH_TYPE_KEYS[pairCount];
    return phaseConfig.depthLimits[searchKey] ?? phaseConfig.depthLimits[pairCount] ?? 10;
};

const dispatchSolverChildProcess = (scrambleInput, targetNode, solverOptions, isPseudo) => {
    return new Promise((resolve, reject) => {
        const corners = solverOptions.corners ?? targetNode.state.corners ?? [];
        const edges = solverOptions.edges ?? targetNode.state.edges ?? [];
        const pairCount = corners.length;

        const workerSourceCode = `
            const fs = require('fs');
            const path = require('path');
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
        let stderrBuffer = '';
        child.stdout.on('data', (chunk) => stdoutBuffer += chunk.toString());
        child.stderr.on('data', (chunk) => stderrBuffer += chunk.toString());

        const watchdogTimer = setTimeout(() => {
            child.kill('SIGKILL');
            reject(new Error('WASM Child Process Timeout (60s)'));
        }, 60000);

        child.on('exit', (code, signal) => {
            clearTimeout(watchdogTimer);
            if (signal) return reject(new Error(`Child terminated by signal: ${signal}`));

            try {
                const result = JSON.parse(stdoutBuffer.trim().split('\n').pop());
                if (result.ok) resolve(result.solutions);
                else reject(new Error(result.error || `Child failed. stderr: ${stderrBuffer}`));
            } catch (err) {
                reject(new Error(`Child stdout parsing failed (code=${code}). Stderr: ${stderrBuffer.trim()}`));
            }
        });
    });
};

const executeTask = async (scrambleInput, targetNode, solverOptions) => {
    const isPseudo = isPseudoState(targetNode.state);
    if (isPseudo && !CONFIG.enablePseudoSearch) return [];

    console.log(`\n[DEBUG Task Payload]`);
    console.log(`  Target Node ID: ${targetNode.id}`);
    console.log(`  Is Pseudo: ${isPseudo}`);
    console.log(`  Corners:`, targetNode.state.corners);
    console.log(`  Edges:`, targetNode.state.edges);
    console.log(`  Scramble Input: "${scrambleInput}"`);
    console.log(`  Solver Options:`, JSON.stringify(solverOptions));

    return dispatchSolverChildProcess(scrambleInput, targetNode, solverOptions, isPseudo);
};

const bindGlobalErrorHandlers = () => {
    const handleCrash = (err, type) => {
        console.error(`\n[${type}]`, err.message);
        logTaskFailure(diagnostics.activeTask?.phase || 'SYS', diagnostics.activeTask?.idx ?? -1, err, -1);
        recordMemorySnapshot(`post-${type}`);
    };
    process.on('uncaughtException', (err) => handleCrash(err, 'uncaughtException'));
    process.on('unhandledRejection', (reason) => handleCrash(reason instanceof Error ? reason : new Error(String(reason)), 'unhandledRejection'));
};

const run = async () => {
    console.log(`=== CUBE⑂TREE SOLVER [Node ${process.version}] ===\nScramble: ${SCRAMBLE}`);
    recordMemorySnapshot('startup');
    bindGlobalErrorHandlers();

    if (!fs.existsSync(PATHS.tree)) throw new Error(`DAG missing at: ${PATHS.tree}`);

    const dagTree = JSON.parse(fs.readFileSync(PATHS.tree, 'utf8'));
    const nodeIndex = new Map(dagTree.nodes.map(n => [n.id, n]));
    const rootNode = dagTree.nodes.find(n => !n.state.cross_solved) ?? dagTree.nodes[0];

    console.log('\n--- PHASE 1: Step-One Search ---');

    const validPhase1Edges = dagTree.edges.filter(edge => {
        if (edge.source !== rootNode.id) return false;
        const target = nodeIndex.get(edge.target);
        if (!target || (!CONFIG.enablePseudoSearch && isPseudoState(target.state))) return false;
        return Boolean(CONFIG.enabledSearchTypes[(target.state.corners ?? []).length]);
    });

    const activeColors = Object.keys(COLOR_ORIENTATIONS).filter(color => CONFIG.enabledColors[color]);

    const phase1SearchTargets = activeColors.flatMap(color =>
        COLOR_ORIENTATIONS[color].flatMap(rotation =>
            validPhase1Edges.map(transition => ({
                color, rotation, transition, targetNode: nodeIndex.get(transition.target)
            }))
        )
    ).filter(t => t.targetNode);

    diagnostics.phase1Tasks = phase1SearchTargets.length;
    const initialFirstStepSolutions = [];

    for (let i = 0; i < phase1SearchTargets.length; i++) {
        const { color, rotation, transition, targetNode } = phase1SearchTargets[i];
        const corners = targetNode.state.corners ?? [];
        const edges = targetNode.state.edges ?? [];
        const pairCount = corners.length;
        const depthLimit = resolveDepthLimit(pairCount, CONFIG.phase1, false);
        const isPseudo = isPseudoState(targetNode.state);

        diagnostics.activeTask = { phase: 'P1', idx: i, startedAt: Date.now() };

        let solutions = [];
        try {
            solutions = await executeTask(SCRAMBLE, targetNode, {
                rotation: rotation === 'none' ? '' : rotation,
                maxSolutions: CONFIG.phase1.maxSolutions,
                maxLength: depthLimit,
                moveRestrict: CONFIG.phase1.moveRestrict
            });
        } catch (err) {
            logTaskFailure('P1', i, err, Date.now() - diagnostics.activeTask.startedAt);
            continue;
        }

        if (!solutions?.length) continue;

        const stepType = isPseudo ? `Pseudo ${pairCount}-Pair` : (pairCount === 0 ? 'Cross' : `${pairCount}-XCross`);

        for (let moves of solutions) {
            moves = String(moves).trim();
            if (rotation !== 'none' && moves.startsWith(rotation)) moves = moves.slice(rotation.length).trim();
            if (!moves) continue;

            initialFirstStepSolutions.push({
                color, orientation: rotation, sourceNodeId: transition.source, targetNodeId: transition.target,
                type: stepType, edges: edges.join('+') || '-', corners: corners.join('+') || '-',
                depthLimit, piecesSolved: calculateSolvedPieces(rootNode, targetNode), moves
            });
        }
    }

    const deduplicatedFirstSteps = Array.from(new Map(initialFirstStepSolutions.map(s => [`${s.color}_${s.moves}`, s])).values());

    const expandedFirstSteps = deduplicatedFirstSteps.flatMap(sol => altAlgs([sol.moves]).map(altMoves => {
        let finalSetup = sol.orientation === 'none' ? '' : sol.orientation;
        let finalAlg = altMoves.trim();
        const rotationMatch = finalAlg.match(/^(y2|y'|y|x2|x'|x|z2|z'|z)\s*/);

        if (rotationMatch) {
            finalSetup = finalSetup ? `${finalSetup} ${rotationMatch[1]}` : rotationMatch[1];
            finalAlg = finalAlg.slice(rotationMatch[0].length).trim();
        }

        return { ...sol, setup: finalSetup || 'none', moves: finalAlg };
    }));

    const uniqueExpandedFirstSteps = Array.from(new Map(expandedFirstSteps.map(s => [`${s.color}_${s.setup}_${s.moves}`, s])).values());
    const step1Scores = scoreAlgorithms(uniqueExpandedFirstSteps.map(s => s.moves));

    const rankedPhase1Targets = uniqueExpandedFirstSteps
        .map((sol, idx) => ({ ...sol, score: step1Scores[idx], spp: Number((step1Scores[idx] / sol.piecesSolved).toFixed(4)) }))
        .sort((a, b) => a.spp - b.spp)
        .slice(0, CONFIG.topFirstStepsToExpand);

    console.table(rankedPhase1Targets.slice(0, 10).map((item, idx) => ({
        Rank: idx + 1, Color: item.color, Type: item.type, Setup: item.setup,
        Edges: item.edges, Corners: item.corners, SPP: item.spp.toFixed(4), Alg: item.moves
    })));

    triggerGC();

    console.log('\n--- PHASE 2: Child Transition Expansion ---');

    const isValidRotation = (rot) => Boolean(rot && rot !== 'none' && rot !== '-');

    const phase2SearchTargets = rankedPhase1Targets.flatMap((parentSol, parentRank) => {
        return dagTree.edges
            .filter(edge => edge.source === parentSol.targetNodeId)
            .map(edge => {
                const childNode = nodeIndex.get(edge.target);
                if (!childNode) return null;

                const pairCount = (childNode.state.corners ?? []).length;
                if ((pairCount <= 1 && !CONFIG.phase2.enabledTypes.pair) || (pairCount > 1 && !CONFIG.phase2.enabledTypes.multislot)) return null;

                const edgeRot = isValidRotation(edge.setup_rotation) ? edge.setup_rotation : '';
                const parentSetup = isValidRotation(parentSol.setup) ? parentSol.setup : '';

                return {
                    parentRank: parentRank + 1,
                    parentSolution: parentSol,
                    edge,
                    childNode,
                    edgeRot,
                    netRotation: 'none',
                    compositeScramble: cleanScramble(`${SCRAMBLE} ${parentSetup ? parentSetup + ' ' : ''}${parentSol.moves}${edgeRot ? ' ' + edgeRot : ''}`)
                };
            }).filter(Boolean);
    });

    diagnostics.phase2Tasks = phase2SearchTargets.length;
    let matchedEngine = await initMatchedPairEngine();

    for (let i = 0; i < phase2SearchTargets.length; i++) {
        const task = phase2SearchTargets[i];
        const { corners = [], edges = [] } = task.childNode.state;
        const pairCount = corners.length;
        const isPseudo = isPseudoState(task.childNode.state);

        diagnostics.activeTask = { phase: 'P2', idx: i, startedAt: Date.now() };

        try {
            const solutions = await executeTask(task.compositeScramble, task.childNode, {
                rotation: task.netRotation,
                maxSolutions: CONFIG.phase2.maxSolutions,
                maxLength: resolveDepthLimit(pairCount, CONFIG.phase2, true),
                moveRestrict: CONFIG.phase2.moveRestrict,
                corners,
                edges
            });
        } catch (err) {
            logTaskFailure('P2', i, err, Date.now() - diagnostics.activeTask.startedAt);
            if (isHardWasmCrash(err)) {
                console.log(`  [Recovery] Engine fault detected on Task ${i}. Cycling engines...`);
                matchedEngine = await initMatchedPairEngine();
            }
        }
    }
};

run().catch(console.error);