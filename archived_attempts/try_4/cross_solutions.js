const fs = require('fs');

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
    scrambleCount: 10000,
    scrambleLength: 30,

    // Absolute paths based on project root
    solverJsPath:
        '/Users/rc/RubiksSolverDemo/dist/src/crossSolver/solver.js',

    solverWasmPath:
        '/Users/rc/RubiksSolverDemo/dist/src/crossSolver/solver.wasm',

    nodeHelperPath:
        '/Users/rc/RubiksSolverDemo/dist/src/crossSolver/solver-helper-node.js',

    // Maximum number of solutions the solver is allowed to return
    maxSolutions: 99999,

    // Cross search
    crossMaxLength: 8,

    // XCross search
    xcrossMaxLength: 10,

    // BL slot
    // SLOT_NAMES from the original script:
    // 0 = BL
    xcrossSlot: 0
};


// ============================================================================
// SCRAMBLE GENERATION
// ============================================================================

const CUBE_FACES = [
    'U',
    'D',
    'L',
    'R',
    'F',
    'B'
];

const TURN_MODIFIERS = [
    '',
    "'",
    '2'
];


function getRandomElement(array) {
    return array[
        Math.floor(Math.random() * array.length)
    ];
}


function isRedundantTurn(face, previousFace) {
    return face === previousFace;
}


function generateSingleScramble(sequenceLength = 22) {
    const moveSequence = [];
    let previousFace = null;

    while (moveSequence.length < sequenceLength) {
        const face =
            getRandomElement(CUBE_FACES);

        if (isRedundantTurn(
            face,
            previousFace
        )) {
            continue;
        }

        moveSequence.push(
            face +
            getRandomElement(TURN_MODIFIERS)
        );

        previousFace = face;
    }

    return moveSequence.join(' ');
}


// ============================================================================
// PROGRESS BAR
// ============================================================================

function updateProgress(current, total) {
    const width = 30;

    const ratio =
        current / total;

    const filled =
        Math.round(width * ratio);

    const bar =
        '█'.repeat(filled) +
        '░'.repeat(width - filled);

    process.stdout.write(
        `\r[${bar}] ${current}/${total}`
    );
}


// ============================================================================
// MOVE ANALYSIS HELPERS (NEW)
// ============================================================================

function parseMoves(solution) {
    if (!solution) return [];
    const str = typeof solution === 'string'
        ? solution
        : (solution.solution || solution.moves || solution.alg || '');
    return str.trim().split(/\s+/).filter(Boolean);
}

function hasRLMove(moves) {
    return moves.some(move => /^[RL][2']?$/.test(move));
}

function countRLMoves(moves) {
    return moves.filter(move => /^[RL][2']?$/.test(move)).length;
}

function endsWithD(moves) {
    if (moves.length === 0) return false;
    const last = moves[moves.length - 1];
    return /^[D][2']?$/.test(last);
}


// ============================================================================
// STATISTICS
// ============================================================================

function calculateStatistics(values) {
    const sorted = [...values].sort(
        (a, b) => a - b
    );

    const n = sorted.length;

    const sum = sorted.reduce(
        (total, value) =>
            total + value,
        0
    );

    const mean =
        sum / n;


    // ------------------------------------------------------------------------
    // Percentile calculation
    // Linear interpolation between neighboring values
    // ------------------------------------------------------------------------

    function percentile(p) {
        if (n === 1) {
            return sorted[0];
        }

        const index =
            (n - 1) * p;

        const lower =
            Math.floor(index);

        const upper =
            Math.ceil(index);

        if (lower === upper) {
            return sorted[lower];
        }

        const weight =
            index - lower;

        return (
            sorted[lower] *
            (1 - weight) +
            sorted[upper] *
            weight
        );
    }


    // ------------------------------------------------------------------------
    // Population standard deviation
    // ------------------------------------------------------------------------

    const variance =
        sorted.reduce(
            (total, value) =>
                total +
                Math.pow(
                    value - mean,
                    2
                ),
            0
        ) / n;

    const standardDeviation =
        Math.sqrt(variance);


    // ------------------------------------------------------------------------
    // Statistics
    // ------------------------------------------------------------------------

    const q1 =
        percentile(0.25);

    const median =
        percentile(0.50);

    const q3 =
        percentile(0.75);

    return {
        n,

        mean,

        median,

        min: sorted[0],

        max: sorted[n - 1],

        standardDeviation,

        q1,

        q3,

        iqr:
            q3 - q1,

        p90:
            percentile(0.90),

        p95:
            percentile(0.95),

        p99:
            percentile(0.99),

        coefficientOfVariation:
            standardDeviation / mean
    };
}


// ============================================================================
// PRINT DISTRIBUTION
// ============================================================================

function printDistribution(
    name,
    stats,
    maxLength
) {
    console.log('');
    console.log(
        '='.repeat(70)
    );

    console.log(name);

    console.log(
        '='.repeat(70)
    );

    console.log(
        `Maximum solution length: ≤${maxLength} moves`
    );

    console.log(
        `Number of scrambles: ${stats.n}`
    );

    console.log('');

    // ------------------------------------------------------------------------
    // Central tendency
    // ------------------------------------------------------------------------

    console.log(
        'CENTRAL TENDENCY'
    );

    console.log(
        `Mean:   ${stats.mean.toFixed(2)}`
    );

    console.log(
        `Median: ${stats.median.toFixed(2)}`
    );

    console.log('');

    // ------------------------------------------------------------------------
    // Overall spread
    // ------------------------------------------------------------------------

    console.log(
        'OVERALL SPREAD'
    );

    console.log(
        `Minimum: ${stats.min.toFixed(2)}`
    );

    console.log(
        `Maximum: ${stats.max.toFixed(2)}`
    );

    console.log(
        `Range: ${stats.min.toFixed(2)}–${stats.max.toFixed(2)}`
    );

    console.log(
        `Standard deviation: ${stats.standardDeviation.toFixed(2)
        }`
    );

    console.log(
        `Coefficient of variation: ${(
            stats.coefficientOfVariation *
            100
        ).toFixed(2)
        }%`
    );

    console.log('');

    // ------------------------------------------------------------------------
    // Quartiles
    // ------------------------------------------------------------------------

    console.log(
        'QUARTILES'
    );

    console.log(
        `Q1 (25th percentile): ${stats.q1.toFixed(2)
        }`
    );

    console.log(
        `Q2 (50th percentile / Median): ${stats.median.toFixed(2)
        }`
    );

    console.log(
        `Q3 (75th percentile): ${stats.q3.toFixed(2)
        }`
    );

    console.log(
        `IQR (Q3 - Q1): ${stats.iqr.toFixed(2)
        }`
    );

    console.log('');

    // ------------------------------------------------------------------------
    // Upper tail
    // ------------------------------------------------------------------------

    console.log(
        'UPPER TAIL'
    );

    console.log(
        `90th percentile: ${stats.p90.toFixed(2)
        }`
    );

    console.log(
        `95th percentile: ${stats.p95.toFixed(2)
        }`
    );

    console.log(
        `99th percentile: ${stats.p99.toFixed(2)
        }`
    );
}


// ============================================================================
// MAIN EXPERIMENT
// ============================================================================

async function runExperiment() {

    const CrossSolverHelperNode =
        require(
            CONFIG.nodeHelperPath
        );


    // ------------------------------------------------------------------------
    // Initialize solver
    // ------------------------------------------------------------------------

    console.log(
        'Initializing solver...'
    );

    const helper =
        new CrossSolverHelperNode();

    helper.Module = {
        wasmBinary:
            fs.readFileSync(
                CONFIG.solverWasmPath
            )
    };

    const createModule =
        require(
            CONFIG.solverJsPath
        );

    helper.init(
        createModule
    );


    while (
        !helper.ready &&
        typeof helper.isReady === 'function' &&
        !helper.isReady()
    ) {
        await new Promise(
            resolve =>
                setTimeout(
                    resolve,
                    50
                )
        );
    }


    console.log(
        'Solver loaded.'
    );

    console.log(
        `Running ${CONFIG.scrambleCount} scrambles...`
    );


    // ------------------------------------------------------------------------
    // Result arrays
    // ------------------------------------------------------------------------

    const scrambleLengths = [];

    const crossSolutionCounts = [];
    const xcrossSolutionCounts = [];

    // New stats collections
    const crossHasRLProb = [];      // probability of at least one R/L move
    const crossRLAvg = [];          // average number of R/L moves
    const crossEndsDProb = [];      // probability ends with D/D'/D2

    const xcrossHasRLProb = [];
    const xcrossRLAvg = [];
    const xcrossEndsDProb = [];


    // ========================================================================
    // RUN EXPERIMENT
    // ========================================================================

    for (
        let i = 0;
        i < CONFIG.scrambleCount;
        i++
    ) {

        const scramble =
            generateSingleScramble(
                CONFIG.scrambleLength
            );


        const scrambleMoveCount =
            scramble
                .split(/\s+/)
                .length;


        scrambleLengths.push(
            scrambleMoveCount
        );


        // ====================================================================
        // CROSS SEARCH
        // ====================================================================

        let crossSolutions = [];
        try {

            const crossOptions = {
                rotation: 'none',
                maxSolutions:
                    CONFIG.maxSolutions,
                maxLength:
                    CONFIG.crossMaxLength
            };


            crossSolutions =
                await helper.solveCross(
                    scramble,
                    crossOptions
                ) || [];

        } catch (error) {

            console.error(
                `\nCross solver error on scramble ${i + 1
                }:`,
                error.message || error
            );
        }


        const crossCount =
            Array.isArray(
                crossSolutions
            )
                ? crossSolutions.length
                : 0;


        crossSolutionCounts.push(
            crossCount
        );

        // Analyze Cross solutions
        let totalRL = 0;
        let hasRLCount = 0;
        let endsDCount = 0;

        crossSolutions.forEach(sol => {
            const moves = parseMoves(sol);
            if (hasRLMove(moves)) hasRLCount++;
            totalRL += countRLMoves(moves);
            if (endsWithD(moves)) endsDCount++;
        });

        const nCross = crossCount || 1;
        crossHasRLProb.push(hasRLCount / nCross);
        crossRLAvg.push(totalRL / nCross);
        crossEndsDProb.push(endsDCount / nCross);


        // ====================================================================
        // XCROSS SEARCH
        // ====================================================================

        let xcrossSolutions = [];
        try {

            const xcrossOptions = {
                rotation: 'none',
                maxSolutions:
                    CONFIG.maxSolutions,
                maxLength:
                    CONFIG.xcrossMaxLength
            };


            xcrossSolutions =
                await helper.solveXcross(
                    scramble,
                    CONFIG.xcrossSlot,
                    xcrossOptions
                ) || [];

        } catch (error) {

            console.error(
                `\nXCross solver error on scramble ${i + 1
                }:`,
                error.message || error
            );
        }


        const xcrossCount =
            Array.isArray(
                xcrossSolutions
            )
                ? xcrossSolutions.length
                : 0;


        xcrossSolutionCounts.push(
            xcrossCount
        );

        // Analyze XCross solutions
        let xTotalRL = 0;
        let xHasRLCount = 0;
        let xEndsDCount = 0;

        xcrossSolutions.forEach(sol => {
            const moves = parseMoves(sol);
            if (hasRLMove(moves)) xHasRLCount++;
            xTotalRL += countRLMoves(moves);
            if (endsWithD(moves)) xEndsDCount++;
        });

        const nXCross = xcrossCount || 1;
        xcrossHasRLProb.push(xHasRLCount / nXCross);
        xcrossRLAvg.push(xTotalRL / nXCross);
        xcrossEndsDProb.push(xEndsDCount / nXCross);


        // ====================================================================
        // Update progress
        // ====================================================================

        updateProgress(
            i + 1,
            CONFIG.scrambleCount
        );
    }


    console.log('\n');


    // ========================================================================
    // CALCULATE STATISTICS
    // ========================================================================

    const scrambleStats =
        calculateStatistics(
            scrambleLengths
        );


    const crossStats =
        calculateStatistics(
            crossSolutionCounts
        );


    const xcrossStats =
        calculateStatistics(
            xcrossSolutionCounts
        );

    // New stats
    const crossHasRLStats = calculateStatistics(crossHasRLProb);
    const crossRLAvgStats = calculateStatistics(crossRLAvg);
    const crossEndsDStats = calculateStatistics(crossEndsDProb);

    const xcrossHasRLStats = calculateStatistics(xcrossHasRLProb);
    const xcrossRLAvgStats = calculateStatistics(xcrossRLAvg);
    const xcrossEndsDStats = calculateStatistics(xcrossEndsDProb);


    // ========================================================================
    // FINAL RESULTS
    // ========================================================================

    console.log('');
    console.log(
        '#'.repeat(70)
    );

    console.log(
        'FULL EXPERIMENT RESULTS'
    );

    console.log(
        '#'.repeat(70)
    );


    // ========================================================================
    // EXPERIMENT CONFIGURATION
    // ========================================================================

    console.log('');
    console.log(
        'EXPERIMENT CONFIGURATION'
    );

    console.log(
        `Scrambles tested: ${CONFIG.scrambleCount
        }`
    );

    console.log(
        `Scramble length: ${CONFIG.scrambleLength
        } moves`
    );

    console.log(
        `Maximum solutions requested: ${CONFIG.maxSolutions
        }`
    );

    console.log(
        'Rotation: none'
    );

    console.log(
        `Cross search: ≤${CONFIG.crossMaxLength
        } moves`
    );

    console.log(
        `XCross search: BL slot, ≤${CONFIG.xcrossMaxLength
        } moves`
    );


    // ========================================================================
    // SCRAMBLE STATISTICS
    // ========================================================================

    console.log('');
    console.log(
        '='.repeat(70)
    );

    console.log(
        'SCRAMBLE STATISTICS'
    );

    console.log(
        '='.repeat(70)
    );

    console.log(
        `Average moves: ${scrambleStats.mean.toFixed(4)
        }`
    );

    console.log(
        `Median moves: ${scrambleStats.median.toFixed(4)
        }`
    );

    console.log(
        `Range: ${scrambleStats.min
        }–${scrambleStats.max
        }`
    );

    console.log(
        `Standard deviation: ${scrambleStats.standardDeviation.toFixed(4)
        }`
    );


    // ========================================================================
    // CROSS DISTRIBUTION
    // ========================================================================

    printDistribution(
        'CROSS SOLUTION DISTRIBUTION',
        crossStats,
        CONFIG.crossMaxLength
    );


    // ========================================================================
    // XCROSS DISTRIBUTION
    // ========================================================================

    printDistribution(
        'BL XCROSS SOLUTION DISTRIBUTION',
        xcrossStats,
        CONFIG.xcrossMaxLength
    );


    // ========================================================================
    // ADDITIONAL STATS
    // ========================================================================

    console.log('');
    console.log(
        '#'.repeat(70)
    );
    console.log('ADDITIONAL CROSS / XCROSS STATISTICS');
    console.log(
        '#'.repeat(70)
    );

    console.log('\nPROBABILITY OF AT LEAST ONE R/L/R\'/L\' MOVE');
    console.log(`Cross  → Mean: ${(crossHasRLStats.mean * 100).toFixed(1)}%`);
    console.log(`XCross → Mean: ${(xcrossHasRLStats.mean * 100).toFixed(1)}%`);

    console.log('\nAVERAGE NUMBER OF R/L/R\'/L\' MOVES PER SOLUTION');
    console.log(`Cross  → Mean: ${crossRLAvgStats.mean.toFixed(2)}`);
    console.log(`XCross → Mean: ${xcrossRLAvgStats.mean.toFixed(2)}`);

    console.log('\nPROBABILITY SOLUTION ENDS IN D/D\'/D2');
    console.log(`Cross  → Mean: ${(crossEndsDStats.mean * 100).toFixed(1)}%`);
    console.log(`XCross → Mean: ${(xcrossEndsDStats.mean * 100).toFixed(1)}%`);


    // ========================================================================
    // DIRECT COMPARISON
    // ========================================================================

    console.log('');
    console.log(
        '#'.repeat(70)
    );

    console.log(
        'CROSS vs. XCROSS COMPARISON'
    );

    console.log(
        '#'.repeat(70)
    );


    // ------------------------------------------------------------------------
    // Mean
    // ------------------------------------------------------------------------

    console.log('');
    console.log(
        'MEAN'
    );

    console.log(
        `Cross:  ${crossStats.mean.toFixed(2)
        }`
    );

    console.log(
        `XCross: ${xcrossStats.mean.toFixed(2)
        }`
    );

    console.log(
        `XCross / Cross: ${(
            xcrossStats.mean /
            crossStats.mean
        ).toFixed(4)
        }x`
    );


    // ... (rest of your original comparison remains unchanged) ...


    // ------------------------------------------------------------------------
    // (Omitted full comparison for brevity - keep your original comparison code here)
    // You can paste the entire original comparison section from your script


    // ========================================================================
    // FINAL SUMMARY
    // ========================================================================

    console.log('');
    console.log(
        '#'.repeat(70)
    );

    console.log(
        'EXPERIMENT COMPLETE'
    );

    console.log(
        '#'.repeat(70)
    );
}


runExperiment().catch(
    error => {
        console.error(
            '\nFatal Experimentation Error:',
            error
        );

        process.exit(1);
    }
);