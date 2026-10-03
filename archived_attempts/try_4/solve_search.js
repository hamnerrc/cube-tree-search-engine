const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

// ============================================================================
// CONFIGURATIONS & GROUND RULES
// ============================================================================

const CONFIG = {
    sampleScramble: process.argv[2] || "U B2 D2 L2 D2 F U2 L2 B' R2 B R2 F L U2 R U' B R' D2 F",

    // Absolute paths based on project root: /Users/rc/RubiksSolverDemo
    solverJsPath: '/Users/rc/RubiksSolverDemo/dist/src/crossSolver/solver.js',
    solverWasmPath: '/Users/rc/RubiksSolverDemo/dist/src/crossSolver/solver.wasm',
    nodeHelperPath: '/Users/rc/RubiksSolverDemo/dist/src/crossSolver/solver-helper-node.js',
    pythonAlgSpeedPath: '/Users/rc/ML projects/CF2L_AI/alg_speed.py',
    // Toggle cross color preferences
    enabledCrossColors: {
        white: true,
        yellow: true,
        green: true,
        blue: true,
        red: true,
        orange: true
    },

    // Toggle which step complexities you want to scan.
    // Disabling a step completely skips its heavy WASM generation phase.
    enabledSteps: {
        CROSS: true,
        XCROSS: true,
        XXCROSS: false
    }
};

const CUBE_ORIENTATIONS = [
    "none", "x", "x2", "x'", "y", "y2", "y'", "z", "z2", "z'",
    "x y", "x y2", "x y'", "x' y", "x' y2", "x' y'", "x2 y", "x2 y2", "x2 y'",
    "z y", "z y2", "z y'", "z' y", "z' y2"
];

// Color mapping translation dictionary
const COLOR_MAP = {
    "none": "yellow",
    "x'": "green",
    "x": "blue",
    "z2": "white",
    "x2": "white",
    "z": "red",
    "z'": "orange"
};

// Fixed static mapping based on layout configuration
const SLOT_NAMES = { 0: "BL", 1: "BR", 2: "FR", 3: "FL" };

const STEP_CONFIGS = [
    { name: "CROSS", methodName: "solveCross", maxSolutions: 50, maxLength: 8, slotMode: "none", pieces: 4 },
    { name: "XCROSS", methodName: "solveXcross", maxSolutions: 25, maxLength: 9, slotMode: "single", pieces: 6 },
    { name: "XXCROSS", methodName: "solveXxcross", maxSolutions: 15, maxLength: 10, slotMode: "double", pieces: 8 }
];

// Search Exclusions
const FILTERED_XCROSS = ["FR"];
const FILTERED_XXCROSS = ["FR+FL"];

// Situational Warnings
const WARNINGS = {
    "FL": "hard BL pair lookahead",
    "BR+FR": "beware for pure lefty finish",
    "BR+FL": "hard diag-pair lookahead",
    "BL+FR": "hard diag-pair lookahead"
};

// ============================================================================
// END CONFIGURATIONS
// ============================================================================

const CrossSolverHelperNode = require(CONFIG.nodeHelperPath);

console.log("=== MULTISTEP CUBE SOLVER & AI SPEED RANKER ===");
console.log(`Scramble: ${CONFIG.sampleScramble}\n`);

function generateSlotTasks(mode) {
    if (mode === "none") return [{ args: [], label: "N/A", warning: "" }];

    if (mode === "single") {
        return [0, 1, 2, 3]
            .map(id => ({ args: [id], label: SLOT_NAMES[id] }))
            .filter(task => !FILTERED_XCROSS.includes(task.label))
            .map(task => ({ ...task, warning: WARNINGS[task.label] || "" }));
    }

    if (mode === "double") {
        const tasks = [];
        for (let i = 0; i < 4; i++) {
            for (let j = i + 1; j < 4; j++) {
                const label = `${SLOT_NAMES[i]}+${SLOT_NAMES[j]}`;
                if (!FILTERED_XXCROSS.includes(label)) {
                    tasks.push({ args: [i, j], label, warning: WARNINGS[label] || "" });
                }
            }
        }
        return tasks;
    }
    return [];
}

function getColorGroup(rotation) {
    if (rotation === "none" || rotation.startsWith("y")) return "yellow";
    const primaryAxis = rotation.split(/\s+/)[0];
    return COLOR_MAP[primaryAxis] || primaryAxis;
}

// ── Batch scorer: ONE Python process for ALL algorithms ───────────────────────
// Instead of spawning python3 once per algorithm (huge overhead), we pipe all
// algorithms through stdin and get back one score per line.  This turns O(n)
// process spawns into a single O(1) call.
function scoreAllAlgorithms(algorithms) {
    if (algorithms.length === 0) return [];

    try {
        const input = algorithms.join('\n');
        const output = execSync(
            `python3 "${CONFIG.pythonAlgSpeedPath}"`,
            { encoding: 'utf8', input }
        );
        const lines = output.trim().split('\n');
        return lines.map(line => {
            const score = parseFloat(line.trim());
            return isNaN(score) ? 99.0 : score;
        });
    } catch (err) {
        console.error("Batch scoring error:", err.message || err);
        return algorithms.map(() => 99.0);
    }
}

async function runExperiment() {
    const helper = new CrossSolverHelperNode();
    helper.Module = { wasmBinary: fs.readFileSync(CONFIG.solverWasmPath) };

    console.log("Initializing persistent pruning tables...");
    const createModule = require(CONFIG.solverJsPath);
    helper.init(createModule);

    while (!helper.ready && typeof helper.isReady === 'function' && !helper.isReady()) {
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    console.log("Engine loaded successfully.\n");

    const colorBuckets = {};
    const globalSeenSolutions = new Set();

    for (const config of STEP_CONFIGS) {
        if (!CONFIG.enabledSteps[config.name]) {
            console.log(`Skipping step evaluation: ${config.name} (Disabled)`);
            continue;
        }

        console.log(`Searching solutions for step: ${config.name}...`);
        const tasks = generateSlotTasks(config.slotMode);

        for (const rot of CUBE_ORIENTATIONS) {
            const colorKey = getColorGroup(rot);

            if (!CONFIG.enabledCrossColors[colorKey]) continue;
            if (!colorBuckets[colorKey]) colorBuckets[colorKey] = [];

            for (const task of tasks) {
                try {
                    const options = {
                        rotation: rot,
                        maxSolutions: config.maxSolutions,
                        maxLength: config.maxLength
                    };

                    const finalArgs = [CONFIG.sampleScramble, ...task.args, options];
                    const solutions = await helper[config.methodName](...finalArgs);

                    if (solutions && Array.isArray(solutions)) {
                        solutions.forEach(rawMoves => {
                            let cleanMoves = rawMoves.trim();
                            if (cleanMoves.startsWith(rot)) {
                                cleanMoves = cleanMoves.substring(rot.length).trim();
                            }

                            const uniqueKey = `${config.name}_${cleanMoves}`;
                            if (cleanMoves && !globalSeenSolutions.has(uniqueKey)) {
                                globalSeenSolutions.add(uniqueKey);
                                colorBuckets[colorKey].push({
                                    solutionType: config.name,
                                    piecesSolved: config.pieces,
                                    colorGroup: colorKey,
                                    orientation: rot,
                                    slot: task.label,
                                    warning: task.warning,
                                    moves: cleanMoves
                                });
                            }
                        });
                    }
                } catch (error) {
                    console.error(`WASM Error [${config.name} - Rot: ${rot}]:`, error.message || error);
                }
            }
        }
    }

    // ── Collect all unsorted items, then batch-score in ONE Python call ────────
    console.log("\nBatch-scoring all algorithms (single Python process)...");

    const allItems = Object.values(colorBuckets).flat();

    if (allItems.length === 0) {
        console.log("No solutions found for the combined parameters enabled.");
        process.exit(0);
    }

    const scores = scoreAllAlgorithms(allItems.map(item => item.moves));

    let masterMixedPool = allItems.map((item, i) => ({
        ...item,
        score: scores[i],
        spp: parseFloat((scores[i] / item.piecesSolved).toFixed(4))
    }));

    // Unbiased Global Sort by SPP
    masterMixedPool.sort((a, b) => a.spp - b.spp);

    const top10Pool = masterMixedPool.slice(0, 10);

    console.log(`\n${'='.repeat(114)}`);
    console.log(`GLOBAL MASTER RANKING: TOP 10 UNBIASED SOLUTIONS (Sorted by Efficiency Score - SPP)`);
    console.log(`${'='.repeat(114)}`);

    console.table(top10Pool.map((item, index) => ({
        "Rank": index + 1,
        "Solution Type": item.solutionType,
        "Pieces Solved": item.piecesSolved,
        "Cross Color": item.colorGroup,
        "Full Rot": item.orientation,
        "Target Slot": item.slot,
        "Warning": item.warning || "-",
        "Speed Score": item.score.toFixed(4),
        "SPP": item.spp.toFixed(4),
        "Clean Algorithm": item.moves
    })));

    console.log(`Total Solutions Rendered: ${top10Pool.length}\n`);
    process.exit(0);
}

runExperiment().catch(err => {
    console.error("Fatal Experimentation Error:", err);
    process.exit(1);
});