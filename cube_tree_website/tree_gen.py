from itertools import combinations, permutations
from collections import defaultdict
from pathlib import Path
import json

SCRIPT_DIR = Path(__file__).resolve().parent

SLOTS = ("FR", "FL", "BL", "BR")
CORNERS = ("C_FR", "C_FL", "C_BL", "C_BR")
EDGES = ("E_FR", "E_FL", "E_BL", "E_BR")
ROTATION_OFFSETS = {"-": 0, "y": 1, "y'": -1}

INITIAL_STATE = {
    "cross_solved": False,
    "pieces": {
        **{c: (c.replace("C_", ""), False) for c in CORNERS},
        **{e: (e.replace("E_", ""), False) for e in EDGES},
    },
}

adjacency_list = defaultdict(set)
cube_states = {}


def rotate_cube(state, rotation):
    offset = ROTATION_OFFSETS.get(rotation, 0)
    if not offset:
        return {"cross_solved": state["cross_solved"], "pieces": state["pieces"].copy()}

    rotated_pieces = {
        piece: (SLOTS[(SLOTS.index(slot) + offset) % 4], is_solved)
        for piece, (slot, is_solved) in state["pieces"].items()
    }
    return {"cross_solved": state["cross_solved"], "pieces": rotated_pieces}


def solve_pieces(state, solved_corners, solved_edges, solve_cross=False):
    updated_pieces = state["pieces"].copy()

    for corner in solved_corners:
        slot, _ = updated_pieces[corner]
        updated_pieces[corner] = (slot, True)

    for edge in solved_edges:
        slot, _ = updated_pieces[edge]
        updated_pieces[edge] = (slot, True)

    return {
        "cross_solved": state["cross_solved"] or solve_cross,
        "pieces": updated_pieces,
    }


def state_fingerprint(state):
    sorted_pieces = tuple(
        sorted((p, s, is_solved) for p, (s, is_solved) in state["pieces"].items())
    )
    return (state["cross_solved"], sorted_pieces)


def unsolved_pieces(state, category):
    return tuple(p for p in category if not state["pieces"][p][1])


def extract_solved_slots(state):
    return {
        "cross_solved": state["cross_solved"],
        "corners": sorted(state["pieces"][c][0] for c in CORNERS if state["pieces"][c][1]),
        "edges": sorted(state["pieces"][e][0] for e in EDGES if state["pieces"][e][1]),
    }


def extract_action_slots(corner_selection, edge_selection, state):
    return {
        "corners": sorted(state["pieces"][c][0] for c in corner_selection),
        "edges": sorted(state["pieces"][e][0] for e in edge_selection),
    }


def slot_mismatch_count(state):
    solved = extract_solved_slots(state)
    corner_slots, edge_slots = set(solved["corners"]), set(solved["edges"])
    return len(corner_slots ^ edge_slots) // 2


def is_valid_pair_state(state):
    return slot_mismatch_count(state) <= 1


def is_pure_mismatch_repair(current_rotated, next_state):
    cur_solved = extract_solved_slots(current_rotated)
    nxt_solved = extract_solved_slots(next_state)

    cur_c, cur_e = set(cur_solved["corners"]), set(cur_solved["edges"])
    nxt_c, nxt_e = set(nxt_solved["corners"]), set(nxt_solved["edges"])

    newly_solved = (nxt_c - cur_c) | (nxt_e - cur_e)
    mismatched = cur_c ^ cur_e

    if not newly_solved.issubset(mismatched):
        return False

    return slot_mismatch_count(next_state) < slot_mismatch_count(current_rotated)


def register_cube_state(state):
    key = state_fingerprint(state)
    cube_states.setdefault(key, state)
    return key


def generate_pair_transitions(current_state, rot, rotations_to_check, pair_sizes):
    rotated = rotate_cube(current_state, rot)
    unsolved_c = unsolved_pieces(rotated, CORNERS)
    unsolved_e = unsolved_pieces(rotated, EDGES)
    has_mismatch = slot_mismatch_count(current_state) > 0

    for pair_size in pair_sizes:
        if pair_size > len(unsolved_e):
            continue

        for corners in combinations(unsolved_c, pair_size):
            for edges in combinations(unsolved_e, pair_size):
                for edge_perm in permutations(edges):
                    next_state = solve_pieces(
                        rotated, corners, edge_perm, solve_cross=True
                    )

                    if has_mismatch and not is_pure_mismatch_repair(
                        rotated, next_state
                    ):
                        continue

                    if pair_size >= 2 and not is_valid_pair_state(next_state):
                        continue

                    next_key = register_cube_state(next_state)
                    yield (rot, corners, edge_perm, next_key)


def build_f2l_dag():
    start_key = register_cube_state(INITIAL_STATE)
    queue, visited = [start_key], {start_key}

    while queue:
        current_key = queue.pop(0)
        current_state = cube_states[current_key]

        unsolved_c = unsolved_pieces(current_state, CORNERS)
        unsolved_e = unsolved_pieces(current_state, EDGES)

        if current_state["cross_solved"] and not unsolved_c and not unsolved_e:
            continue

        is_cross_solved = current_state["cross_solved"]
        rotations = ("-",) if not is_cross_solved else ("-", "y", "y'")
        max_pairs = 4 if not is_cross_solved else min(len(unsolved_c), 2) + 1
        pair_range = range(0 if not is_cross_solved else 1, max_pairs)

        for rot in rotations:
            transitions = generate_pair_transitions(
                current_state, rot, rotations, pair_range
            )
            for transition in transitions:
                adjacency_list[current_key].add(transition)
                target_key = transition[3]

                if target_key not in visited:
                    visited.add(target_key)
                    queue.append(target_key)

    return start_key


def prune_graph(start_key):
    incoming = {tgt for edges in adjacency_list.values() for _, _, _, tgt in edges}
    outgoing = set(adjacency_list.keys())
    active_keys = (incoming | outgoing) | {start_key}

    for key in list(cube_states.keys()):
        if key not in active_keys:
            cube_states.pop(key, None)
            adjacency_list.pop(key, None)

    for src in list(adjacency_list.keys()):
        valid_edges = {t for t in adjacency_list[src] if t[3] in cube_states}
        if valid_edges:
            adjacency_list[src] = valid_edges
        else:
            adjacency_list.pop(src, None)


def export_graph(start_key):
    node_mapping = {key: f"N{i}" for i, key in enumerate(cube_states)}
    nodes, edges, html_node_map = [], [], {}

    for state_key, node_id in node_mapping.items():
        state = cube_states[state_key]
        solved = extract_solved_slots(state)
        nodes.append({"id": node_id, "state": solved})

        transitions_for_html = []
        for rot, corners, edges_perm, target_key in adjacency_list.get(state_key, []):
            target_id = node_mapping[target_key]
            rotated = rotate_cube(state, rot)
            action = extract_action_slots(corners, edges_perm, rotated)

            edges.append(
                {
                    "source": node_id,
                    "target": target_id,
                    "setup_rotation": rot,
                    "solved_step": action,
                }
            )

            transitions_for_html.append(
                {
                    "target_id": target_id,
                    "setup_rotation": rot,
                    "action_solved": action,
                    "target_state": extract_solved_slots(cube_states[target_key]),
                }
            )

        html_node_map[node_id] = {
            "id": node_id,
            "state": solved,
            "transitions": transitions_for_html,
        }

    with open(SCRIPT_DIR / "f2l_nodes_and_edges.json", "w", encoding="utf-8") as f:
        json.dump({"nodes": nodes, "edges": edges}, f, indent=2)

    build_html_inspector(node_mapping[start_key], html_node_map)


def build_html_inspector(start_id, node_map):
    html_content = f"""<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>F2L State Inspector</title>
    <style>
        body {{ font-family: system-ui, sans-serif; background: #0f172a; color: #f8fafc; padding: 20px; margin: 0; }}
        .container {{ max-width: 1100px; margin: 0 auto; }}
        .header {{ background: #1e293b; padding: 20px; border-radius: 8px; border: 1px solid #334155; margin-bottom: 20px; }}
        .current-node {{ color: #38bdf8; font-family: monospace; font-weight: bold; margin-top: 5px; }}
        .history {{ font-size: 12px; color: #94a3b8; margin-top: 10px; }}
        .history span {{ cursor: pointer; text-decoration: underline; font-family: monospace; }}
        table {{ width: 100%; border-collapse: collapse; background: #1e293b; border-radius: 8px; overflow: hidden; }}
        th, td {{ padding: 12px 16px; text-align: left; border-bottom: 1px solid #334155; font-family: monospace; }}
        th {{ background: #0f172a; color: #94a3b8; font-size: 12px; text-transform: uppercase; }}
        tr:hover {{ background: #334155; }}
        .rot-tag {{ padding: 2px 8px; border-radius: 4px; font-weight: bold; background: #334155; }}
        .rot-y {{ background: #0284c7; color: #fff; }}
        .btn {{ background: #0284c7; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; }}
        .btn:hover {{ background: #0369a1; }}
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div style="font-size: 12px; color: #94a3b8;">CURRENT STATE</div>
            <div class="current-node" id="currentNodeLabel"></div>
            <div class="history" id="pathHistory">Path: </div>
        </div>
        <h3>Transitions</h3>
        <table>
            <thead>
                <tr>
                    <th>Rotation</th>
                    <th>Action</th>
                    <th>Next State</th>
                    <th>Action</th>
                </tr>
            </thead>
            <tbody id="transitionsTable"></tbody>
        </table>
    </div>

    <script>
        const nodesData = {json.dumps(node_map)};
        let pathStack = ["{start_id}"];

        function render() {{
            const currentId = pathStack[pathStack.length - 1];
            const node = nodesData[currentId];

            document.getElementById("currentNodeLabel").innerText = JSON.stringify(node.state);
            const history = document.getElementById("pathHistory");
            history.innerHTML = "Path: ";

            pathStack.forEach((id, idx) => {{
                const span = document.createElement("span");
                span.innerText = JSON.stringify(nodesData[id].state) + (idx < pathStack.length - 1 ? " ➔ " : "");
                span.onclick = () => {{ pathStack = pathStack.slice(0, idx + 1); render(); }};
                history.appendChild(span);
            }});

            const tbody = document.getElementById("transitionsTable");
            tbody.innerHTML = node.transitions.length ? "" : 
                `<tr><td colspan="4" style="text-align:center; color:#38bdf8; padding:20px;">Terminal State Reached</td></tr>`;

            node.transitions.forEach(t => {{
                const tr = document.createElement("tr");
                const rotClass = t.setup_rotation !== "-" ? "rot-y" : "";
                tr.innerHTML = `
                    <td><span class="rot-tag ${{rotClass}}">${{t.setup_rotation}}</span></td>
                    <td style="color: #cbd5e1;">${{JSON.stringify(t.action_solved)}}</td>
                    <td style="color: #38bdf8;">${{JSON.stringify(t.target_state)}}</td>
                    <td><button class="btn" onclick="navigateTo('${{t.target_id}}')">Transition ➔</button></td>
                `;
                tbody.appendChild(tr);
            }});
        }}

        function navigateTo(targetId) {{
            pathStack.push(targetId);
            render();
        }}

        render();
    </script>
</body>
</html>"""
    with open(SCRIPT_DIR / "f2l_table_inspector.html", "w", encoding="utf-8") as f:
        f.write(html_content)


if __name__ == "__main__":
    start = build_f2l_dag()
    prune_graph(start)
    export_graph(start)
