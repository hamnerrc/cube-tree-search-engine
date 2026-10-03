def mirror_algorithm(algorithm: str) -> str:
    """
    Mirror a Rubik's cube algorithm over the R/L axis.

    Args:
        algorithm: A string containing cube moves separated by spaces

    Returns:
        The mirrored algorithm as a string

    Example:
        >>> mirror_algorithm("R U R' U'")
        "L' U' L U"
    """
    # Define the mapping for each base move
    move_mapping = {
        "R": "L'",
        "R'": "L",
        "R2": "L2",
        "L": "R'",
        "L'": "R",
        "L2": "R2",
        "U": "U'",
        "U'": "U",
        "U2": "U2",
        "D": "D'",
        "D'": "D",
        "D2": "D2",
        "F": "F'",
        "F'": "F",
        "F2": "F2",
        "B": "B'",
        "B'": "B",
        "B2": "B2",
        "r": "l'",
        "r'": "l",
        "r2": "l2",
        "l": "r'",
        "l'": "r",
        "l2": "r2",
        "u": "u'",
        "u'": "u",
        "u2": "u2",
        "d": "d'",
        "d'": "d",
        "d2": "d2",
        "f": "f'",
        "f'": "f",
        "f2": "f2",
        "b": "b'",
        "b'": "b",
        "b2": "b2",
        "M": "M",
        "M'": "M'",
        "M2": "M2",
        "E": "E'",
        "E'": "E",
        "E2": "E2",
        "S": "S'",
        "S'": "S",
        "S2": "S2",
        "x": "x",
        "x'": "x'",
        "x2": "x2",
        "y": "y'",
        "y'": "y",
        "y2": "y2",
        "z": "z'",
        "z'": "z",
        "z2": "z2",
    }

    # Split the algorithm into individual moves
    moves = algorithm.split()

    # Mirror each move
    mirrored_moves = [move_mapping[move] for move in moves]

    # Join back into a string
    return " ".join(mirrored_moves)