PROJECT GOAL:

cube⑂tree (also referenced as part of CF2L_AI / cube_tree_website) is a Rubik’s Cube solver tool focused on the first step of CFOP-style solves: finding good Cross + F2L pair(s) solutions (including XCross, XXCross, XXXCross, and pseudo variants).

It works by:

1. Pre-computing a DAG of abstract F2L solved-states (which corners/edges are solved, whether the cross is solved, and mismatches between them).
2. Using that DAG to guide which combinations of pieces are legal to solve in one step.
3. Running actual scramble searches with WASM-based solvers (one for matched pairs, one for independent/pseudo edge+corner slots).
4. Scoring the resulting algorithms by a speed model and ranking them (e.g. by SPP – speed per piece).

UPDATE LOG (recent is at the bottom of the update log):

note: this is the IDEAL PLAN, not necessarily what the codebase is already doing. In reality, the code does not work currently

- previous attempts failed
- abandoned ML/ AI, opting for heuristic/algorithmic approach
- got overwhelmed, gave up for a while
- got claude pro, new motivation and possibility to finish project