// Shared Node-side harness for the ad-hoc solver debug scripts
// (backend_test.js, cross_xcross.js): engine PATHS, DAG/slot constants, and
// the child-process dispatch that runs a single WASM solver call in an
// isolated fork. Extracted because both scripts had copy-pasted this
// verbatim since the first commits (including a hardcoded absolute-path
// BASE_DIR that only worked on one machine).
'use strict';

const path = require('path');
const { fork } = require('child_process');

const BASE_DIR = path.join(__dirname, '..');

const PATHS = {
    tree: path.join(BASE_DIR, 'data', 'F2L_tree.json'),
    solverJs: path.join(BASE_DIR, 'crossSolver', 'solver.js'),
    solverWasm: path.join(BASE_DIR, 'crossSolver', 'solver.wasm'),
    crossHelper: path.join(BASE_DIR, 'crossSolver', 'solver-helper-node.js'),
    script: path.join(BASE_DIR, 'js', 'script.js'),
    pseudoJs: path.join(BASE_DIR, 'pseudoCrossSolver', 'pseudo.js'),
    pseudoWasm: path.join(BASE_DIR, 'pseudoCrossSolver', 'pseudo.wasm'),
};

// Verified empirically against solver.wasm (see rotation_face_probe in
// PROJECT_STATUS.md): only white/yellow were swapped here -- green/blue/
// red/orange were already correct.
const COLOR_ORIENTATIONS = {
    white: ['z2'], yellow: ['none'], green: ["x'"], blue: ['x'], red: ['z'], orange: ["z'"]
};

const SLOT_INDICES = { BL: 0, BR: 1, FR: 2, FL: 3 };
const SOLVER_METHODS = { 0: 'solveCross', 1: 'solveXcross', 2: 'solveXxcross', 3: 'solveXxxcross' };
const SEARCH_TYPE_KEYS = { 0: 'cross', 1: 'xcross', 2: 'xxcross', 3: 'xxxcross' };

/** The isolated-fork worker source: dispatches one scramble+target to either
 * the pseudo or matched WASM engine, printing a single JSON line to stdout. */
function buildWorkerSourceCode() {
    return `
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
}

/** Runs one solver call in an isolated child process (fresh WASM module per
 * call -- avoids cross-call state leakage between pseudo/matched engines).
 * `timeoutMs`, if given, kills the child and rejects after that long. */
function dispatchSolverChildProcess(scrambleInput, targetNode, solverOptions, isPseudo, { timeoutMs } = {}) {
    return new Promise((resolve, reject) => {
        const corners = solverOptions.corners ?? targetNode.state.corners ?? [];
        const edges = solverOptions.edges ?? targetNode.state.edges ?? [];
        const pairCount = corners.length;
        const payload = JSON.stringify({ scramble: scrambleInput, corners, edges, pairCount, isPseudo, options: solverOptions });

        const child = fork(path.join(__dirname, 'dummy_worker'), [payload], {
            execArgv: ['-e', buildWorkerSourceCode()],
            stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
            env: process.env
        });

        let stdoutBuffer = '';
        let stderrBuffer = '';
        child.stdout.on('data', (chunk) => stdoutBuffer += chunk.toString());
        child.stderr.on('data', (chunk) => stderrBuffer += chunk.toString());

        const watchdogTimer = timeoutMs ? setTimeout(() => {
            child.kill('SIGKILL');
            reject(new Error(`WASM Child Process Timeout (${timeoutMs}ms)`));
        }, timeoutMs) : null;

        child.on('exit', (code, signal) => {
            if (watchdogTimer) clearTimeout(watchdogTimer);
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
}

module.exports = {
    BASE_DIR, PATHS, COLOR_ORIENTATIONS, SLOT_INDICES, SOLVER_METHODS, SEARCH_TYPE_KEYS,
    dispatchSolverChildProcess,
};
