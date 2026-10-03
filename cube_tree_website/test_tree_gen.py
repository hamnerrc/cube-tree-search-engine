#!/usr/bin/env python3
"""
Regression tests for tree_gen.py's DAG generation.

Runs the real build_f2l_dag() -> prune_graph() pipeline in-memory (no file
I/O) and checks structural + semantic invariants the DAG must hold for the
rest of the pipeline (script.js's pruneGraph, the WASM solver dispatch) to
work correctly:

  - every edge references real node ids (no dangling refs, no self-loops)
  - the graph is acyclic and the unsolved root is never a transition target
    (progress is monotonic -- you can't un-solve a piece)
  - every node's "corners"/"edges" labels are real F2L slot names
    (FR/FL/BL/BR), not an identifier-slicing artifact -- this is a direct
    regression guard for a bug where extract_solved_slots() sliced the
    piece's dict *key* ("C_FR"[0] -> "C") instead of looking up its current
    slot (state["pieces"][c][0] -> "FR"), silently corrupting every node's
    label to the literal strings "C"/"E" and disabling the mismatch-based
    pair-validity filtering during generation (see git history).
  - no node has a real slot-mismatch count greater than 1 (is_valid_pair_state
    is supposed to guarantee this at generation time)
  - fully-solved terminal nodes exist and have no outgoing edges

Run: python3 test_tree_gen.py
"""
import sys

import tree_gen


def build_graph():
    start_key = tree_gen.build_f2l_dag()
    tree_gen.prune_graph(start_key)
    return start_key


def check(condition, message, failures):
    if not condition:
        failures.append(message)
        print(f"FAIL: {message}")
    else:
        print(f"PASS: {message}")


def main():
    failures = []
    start_key = build_graph()

    cube_states = tree_gen.cube_states
    adjacency_list = tree_gen.adjacency_list
    VALID_SLOTS = set(tree_gen.SLOTS)  # {"FR", "FL", "BL", "BR"}

    check(len(cube_states) > 1, f"graph has more than 1 node (got {len(cube_states)})", failures)
    check(len(adjacency_list) > 0, "graph has at least one edge", failures)

    # --- label correctness (direct regression guard for the C_/E_-slicing bug) ---
    bad_labels = []
    for key, state in cube_states.items():
        solved = tree_gen.extract_solved_slots(state)
        for corner in solved["corners"]:
            if corner not in VALID_SLOTS:
                bad_labels.append(("corner", key, corner))
        for edge in solved["edges"]:
            if edge not in VALID_SLOTS:
                bad_labels.append(("edge", key, edge))
    check(
        len(bad_labels) == 0,
        f"every solved corner/edge label is a real slot name {sorted(VALID_SLOTS)} (found {len(bad_labels)} bad labels, e.g. {bad_labels[:3]})",
        failures,
    )

    # --- structural invariants ---
    dangling = [
        (src, tgt)
        for src, edges in adjacency_list.items()
        for (_, _, _, tgt) in edges
        if src not in cube_states or tgt not in cube_states
    ]
    check(len(dangling) == 0, f"no dangling edge references (found {len(dangling)})", failures)

    self_loops = [
        (src, tgt)
        for src, edges in adjacency_list.items()
        for (_, _, _, tgt) in edges
        if src == tgt
    ]
    check(len(self_loops) == 0, f"no self-loops (found {len(self_loops)})", failures)

    into_root = [
        src
        for src, edges in adjacency_list.items()
        for (_, _, _, tgt) in edges
        if tgt == start_key
    ]
    check(len(into_root) == 0, f"the unsolved root is never a transition target (found {len(into_root)})", failures)

    # acyclic check (DFS)
    WHITE, GRAY, BLACK = 0, 1, 2
    color = {k: WHITE for k in cube_states}
    cycle_found = [False]

    def dfs(u):
        color[u] = GRAY
        for (_, _, _, v) in adjacency_list.get(u, ()):
            if color[v] == GRAY:
                cycle_found[0] = True
                return
            if color[v] == WHITE:
                dfs(v)
                if cycle_found[0]:
                    return
        color[u] = BLACK

    sys.setrecursionlimit(10000)
    for k in cube_states:
        if color[k] == WHITE:
            dfs(k)
            if cycle_found[0]:
                break
    check(not cycle_found[0], "graph is acyclic", failures)

    # --- semantic invariants ---
    def solved_count(state):
        solved = tree_gen.extract_solved_slots(state)
        return len(solved["corners"]) + len(solved["edges"]) + (1 if solved["cross_solved"] else 0)

    non_monotonic = [
        (src, tgt)
        for src, edges in adjacency_list.items()
        for (_, _, _, tgt) in edges
        if solved_count(cube_states[tgt]) <= solved_count(cube_states[src])
    ]
    check(len(non_monotonic) == 0, f"every transition strictly increases solved-piece count (found {len(non_monotonic)} violations)", failures)

    mismatch_violations = [
        key for key, state in cube_states.items() if tree_gen.slot_mismatch_count(state) > 1
    ]
    check(len(mismatch_violations) == 0, f"no node has slot-mismatch count > 1 (found {len(mismatch_violations)})", failures)

    terminal_keys = [
        key
        for key, state in cube_states.items()
        if state["cross_solved"] and len(tree_gen.unsolved_pieces(state, tree_gen.CORNERS)) == 0
        and len(tree_gen.unsolved_pieces(state, tree_gen.EDGES)) == 0
    ]
    check(len(terminal_keys) > 0, f"at least one fully-solved terminal state exists (found {len(terminal_keys)})", failures)

    terminal_with_outgoing = [k for k in terminal_keys if k in adjacency_list and adjacency_list[k]]
    check(len(terminal_with_outgoing) == 0, f"terminal states have no outgoing edges (found {len(terminal_with_outgoing)})", failures)

    print(f"\n{len(cube_states)} nodes, {sum(len(v) for v in adjacency_list.values())} edges.")

    if failures:
        print(f"\n{len(failures)} check(s) failed.")
        sys.exit(1)

    print("\nAll checks passed.")
    sys.exit(0)


if __name__ == "__main__":
    main()
