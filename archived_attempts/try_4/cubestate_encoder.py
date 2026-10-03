import re
from collections import defaultdict
from pathlib import Path

from magiccube.cube import Cube

# Dynamically finds the /Users/rc/ML projects/CF2L_AI root directory
CURRENT_FILE_DIR = Path(__file__).resolve().parent  # /scripts
BASE_DIR = CURRENT_FILE_DIR.parent  # /CF2L_AI

# Points perfectly to your current data folder
GRAPHML_PATH = BASE_DIR / "data" / "cube.graphml"

COLOR_TO_ONEHOT = {
    "W": [1, 0, 0, 0, 0, 0],
    "R": [0, 1, 0, 0, 0, 0],
    "G": [0, 0, 1, 0, 0, 0],
    "Y": [0, 0, 0, 1, 0, 0],
    "O": [0, 0, 0, 0, 1, 0],
    "B": [0, 0, 0, 0, 0, 1],
}


# ====================== HELPERS ======================
def to_magiccube(move: str) -> str:
    """Converts standard notation to magiccube compatible notation."""
    if move in {"x", "x'", "x2", "y", "y'", "y2", "z", "z'", "z2"}:
        return move
    if move and move[0].islower() and move[0] in "rludfb":
        return move[0].upper() + "w" + move[1:]
    return move


def _load_adjacency():
    """Internal helper to load and format the graphml adjacency list exactly once."""
    with open(GRAPHML_PATH, "r", encoding="utf-8") as f:
        content = f.read()

    # Remap old IDs to 0-53 Kociemba index
    node_pattern = r'<node .*?id="(\d+)" .*?mainText="(\d+)"'
    old_to_new = {
        int(nid): int(fnum) - 1 for nid, fnum in re.findall(node_pattern, content)
    }

    # Build adjacency
    edge_pattern = r'<edge source="(\d+)" target="(\d+)" .*?weight="(\d+)"'
    adj = defaultdict(list)
    for src, tgt, w in re.findall(edge_pattern, content):
        s, t, weight = old_to_new[int(src)], old_to_new[int(tgt)], int(w)
        norm_weight = round(weight / 6.0, 3)
        adj[s].append((t, norm_weight))
        adj[t].append((s, norm_weight))

    for node in adj:
        adj[node] = sorted(set(adj[node]))

    return adj


# ====================== 1. GENERATE BASE/SOLVED GRAPH ======================
def generate_solved_cube_graph() -> dict:
    """
    Call this ONCE at the start of your script.
    It loads the geometry and returns the solved state graph.
    """
    adj = _load_adjacency()
    cube = Cube(3)
    colors = cube.get_kociemba_facelet_colors()

    graph = {}
    for node_id in range(54):
        color_char = colors[node_id]
        graph[node_id] = {
            "value": COLOR_TO_ONEHOT[color_char],
            "color": color_char,
            "neighbors": adj.get(node_id, []),
        }
    return graph


# ====================== 2. APPLY MOVES (FAST GNN GEN) ======================
def apply_scramble_to_graph(base_graph: dict, scramble: str) -> dict:
    """
    Call this in your loop. It takes the base geometry, applies moves,
    and returns a brand new graph state.
    """
    cube = Cube(3)
    if scramble.strip():
        magic_moves = [to_magiccube(m) for m in scramble.strip().split()]
        cube.rotate(" ".join(magic_moves))

    colors = cube.get_kociemba_facelet_colors()

    new_graph = {}
    for node_id in range(54):
        color_char = colors[node_id]
        new_graph[node_id] = {
            "value": COLOR_TO_ONEHOT[color_char],
            "color": color_char,
            # We re-use the exact neighbor geometry from the base graph!
            "neighbors": base_graph[node_id]["neighbors"],
        }

    return new_graph


# ====================== 3. VERBOSE READABLE OUTPUT ======================
def print_verbose_graph(graph_data: dict, scramble: str = ""):
    """
    Call this when you want to visually verify the connections and state.
    """
    print("\n" + "=" * 90)
    print("CUBE GRAPH DETAILED SUMMARY (0-53 indexing)")
    print("=" * 90)
    print(f"State after scramble: {scramble or 'None (solved state)'}\n")

    for node_id in range(54):
        node = graph_data[node_id]
        neigh_str = ", ".join([f"{n[0]}({n[1]})" for n in node["neighbors"][:8]])
        if len(node["neighbors"]) > 8:
            neigh_str += f", ... (+{len(node['neighbors'])-8})"

        print(
            f"Node {node_id:2d} | {node['color']} {node['value']} | "
            f"Neighbors ({len(node['neighbors'])}): {neigh_str}"
        )

        if (node_id + 1) % 9 == 0:
            print("-" * 70)

    print("=" * 90)


# ====================== USAGE EXAMPLE ======================
if __name__ == "__main__":
    # 1. Start of your script: Generate the template graph ONCE
    print("Initializing base geometry...")
    base_graph = generate_solved_cube_graph()

    # 2. Inside your data generation loop:
    test_scramble = "R R'"

    # We pass the base_graph in, so it doesn't need to load the graphml again
    scrambled_graph_data = apply_scramble_to_graph(base_graph, test_scramble)

    # (Here is where you would convert scrambled_graph_data to a PyTorch Data object)

    # 3. If you want to check if it worked:
    print_verbose_graph(scrambled_graph_data, test_scramble)
