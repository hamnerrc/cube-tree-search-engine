const fs = require('fs');
const { PATHS, COLOR_ORIENTATIONS, SEARCH_TYPE_KEYS, dispatchSolverChildProcess } = require('./harness.js');

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

const { altAlgs, cleanScramble, isPseudoState, calculateSolvedPieces, scoreAlgorithms } = require(PATHS.script);

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
            const solutions = await dispatchSolverChildProcess(SCRAMBLE, targetNode, {
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
