import re as _re

# ngram weights found using regression on LL data (differential evolution)
_DEFAULT_BIGRAM_WEIGHTS = {
    "U R'": -0.0477,
    "U' L": 0.0065,
    "R U": -0.0501,
    "L' U'": 0.1075,
    "U' R'": -0.0354,
    "U L": 0.0199,
    "R U'": 0.0721,
    "L' U": -0.0271,
    "R' U'": 0.1323,
    "L U": -0.0755,
    "U R": 0.0582,
    "U' L'": -0.0570,
    "R' U": -0.0499,
    "L U'": 0.0881,
    "U' R": -0.0370,
    "U L'": -0.0131,
    "F R": 0.0217,
    "F' L'": -0.0497,
    "R' F": 0.0933,
    "L F'": -0.0702,
}

_DEFAULT_TRIGRAM_WEIGHTS = {
    "R U R'": 0.0749,
    "L' U' L": -0.1154,
    "R U' R'": -0.0214,
    "L' U L": -0.0462,
    "U R' U'": -0.0491,
    "U' L U": 0.0348,
    "U R U'": 0.1113,
    "U' L' U": -0.0958,
    "R' U R": 0.0548,
    "L U' L'": -0.0764,
}

# Inline mirror mapping (subset needed; avoids external import dependency)
_MIRROR_MAP = {
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


def _normalize(alg_str):
    """Normalise U2'/R2' etc. notation and collapse whitespace."""
    s = _re.sub(r"([A-Za-z])2'", r"\g<1>2", str(alg_str).strip())
    return " ".join(s.split())


def _mirror(alg_str):
    return " ".join(_MIRROR_MAP.get(m, m) for m in alg_str.split())


def _count_ngrams(moves, weights):
    """Sum weights for every ngram occurrence in a move list."""
    total = 0.0
    for n, wdict in weights.items():
        for i in range(len(moves) - n + 1):
            gram = " ".join(moves[i : i + n])
            if gram in wdict:
                total += wdict[gram]
    return total


def alg_speed(
    sequence,
    ignore_errors=True,
    ignore_auf=False,
    # ── Base physics params (DE-optimised defaults) ───────────────────────────
    wrist_mult=0.9245,
    push_mult=1.1996,
    ring_mult=1.2111,
    destabilize=0.4017,
    add_regrip=0.9839,
    double=1.7696,
    seslice_mult=0.7118,
    overwork_mult=1.8446,
    moveblock=0.1130,
    rotation=1.6296,
    # ── Scale: converts raw score → seconds ──────────────────────────────────
    scale=0.0261,
    # ── Ngram enhancement (off by default) ───────────────────────────────────
    use_ngrams=False,
    move_count_weight=0.0200,
    bigram_weights=None,  # dict {"U R'": float, ...} or None → use defaults
    trigram_weights=None,  # dict {"R U R'": float, ...} or None → use defaults
):
    """
    Calculate the time (seconds) to execute a Rubik's cube algorithm.

    Args:
        sequence:           Space-separated move string, e.g. "R U R' U'"
        ignore_errors:      Skip unrecognised moves instead of raising
        ignore_auf:         Strip leading/trailing U-face moves before scoring
        wrist_mult .. rotation:
                            Physics model parameters (DE-optimised defaults)
        scale:              Multiplier converting raw score → seconds
        use_ngrams:         If True, add bigram/trigram and move-count
                            adjustments on top of the scaled base score
        move_count_weight:  Seconds-per-move additive correction (only when
                            use_ngrams=True)
        bigram_weights:     Dict mapping bigram strings to second adjustments.
                            None → use built-in DE-optimised defaults.
        trigram_weights:    Dict mapping trigram strings to second adjustments.
                            None → use built-in DE-optimised defaults.

    Returns:
        Float: estimated execution time in seconds (if scale != 1) or raw
        difficulty score (scale=1).
    """

    def test(split_seq, l_grip, r_grip, speed):
        """Test a specific grip configuration and calculate execution speed."""
        # Initialize finger positions: [time, location]
        l_thumb = [-1, "home"]
        l_index = [-1, "home"]
        l_middle = [-1, "home"]
        l_ring = [-1, "home"]
        r_thumb = [-1, "home"]
        r_index = [-1, "home"]
        r_middle = [-1, "home"]
        r_ring = [-1, "home"]
        l_oh_cool = -1  # One-handed cooldown timers
        r_oh_cool = -1
        l_wrist = l_grip
        r_wrist = r_grip
        grip = 1
        ud_grip = -1
        prev_speed = None
        first_move_speed = None

        def overwork(finger, location_prefer, penalty=overwork_mult):
            """Calculate penalty if finger isn't in preferred location."""
            if finger[1] != location_prefer:
                if speed - finger[0] < penalty:
                    return penalty - speed + finger[0]
            return 0

        for j in range(len(split_seq)):
            move = split_seq[j]
            normal_move = move.upper()
            prev_move = (" " if j == 0 else split_seq[j - 1]).upper()

            # Handle U/D double move speed optimization
            if prev_speed is not None:
                first_move_speed = speed
                speed = prev_speed

            if j < len(split_seq) - 1:
                if (move[0] == "U" and split_seq[j + 1][0] == "D") or (
                    move[0] == "D" and split_seq[j + 1][0] == "U"
                ):
                    prev_speed = speed

            # Handle each move type
            if normal_move == "R'":
                if r_wrist == 2:
                    r_wrist = 0
                elif r_wrist > -1 and not (l_wrist >= 1 and r_wrist <= 0):
                    r_wrist -= 1
                else:
                    return [
                        j,
                        speed,
                        l_wrist,
                        r_wrist - 1,
                        max(l_thumb[0], l_index[0], l_middle[0], l_ring[0]),
                        max(r_thumb[0], r_index[0], r_middle[0], r_ring[0]),
                    ]
                speed += wrist_mult

            elif normal_move == "R":
                if r_wrist < 2 and not (l_wrist <= -1 and r_wrist >= 0):
                    r_wrist += 1
                else:
                    return [
                        j,
                        speed,
                        l_wrist,
                        r_wrist + 1,
                        max(l_thumb[0], l_index[0], l_middle[0], l_ring[0]),
                        max(r_thumb[0], r_index[0], r_middle[0], r_ring[0]),
                    ]
                speed += wrist_mult

            elif normal_move == "R2":
                if r_wrist >= 1 and l_wrist < 1:
                    r_wrist = -1
                elif l_wrist > -1:
                    r_wrist += 2
                else:
                    return [
                        j,
                        speed,
                        l_wrist,
                        (r_wrist - 2 if r_wrist > 0 else r_wrist + 2),
                        max(l_thumb[0], l_index[0], l_middle[0], l_ring[0]),
                        max(r_thumb[0], r_index[0], r_middle[0], r_ring[0]),
                    ]
                speed += double * wrist_mult

            elif normal_move == "U":
                if (
                    r_wrist == 0
                    and (r_thumb[0] + overwork_mult <= speed or r_thumb[1] != "top")
                    and r_index[1] != "m"
                ):
                    if overwork(r_index, "home") <= overwork(r_middle, "home"):
                        speed += overwork(r_index, "home")
                        speed += 1
                        r_index = [speed, "uflick"]
                    else:
                        speed += overwork(r_middle, "home")
                        speed += 1
                        r_index = [speed, "uflick"]
                        r_middle = [speed, "uflick"]
                elif r_wrist == 1 and l_wrist == 0:
                    speed += overwork(l_index, "uflick")
                    if prev_move == "B'":
                        speed += moveblock + push_mult
                    elif prev_move and prev_move[0] == "B":
                        speed += moveblock * 0.5 + push_mult
                    else:
                        speed += push_mult
                    l_index = [speed, "home"]
                elif l_wrist == 0 and prev_move and prev_move[0] not in ["F", "B"]:
                    if l_index[1] == "uflick":
                        speed += overwork(l_index, "eido", 0.75 * overwork_mult)
                        speed = max(speed, l_oh_cool + 2.5)
                    else:
                        speed += overwork(l_index, "eido", 1.25 * overwork_mult)
                    speed += 1.15 * push_mult
                    l_index = [speed, "uflick"]
                    l_oh_cool = speed
                else:
                    return [
                        j,
                        speed,
                        l_wrist,
                        r_wrist,
                        max(l_thumb[0], l_index[0], l_middle[0], l_ring[0]),
                        max(r_thumb[0], r_index[0], r_middle[0], r_ring[0]),
                    ]

            elif normal_move == "U'":
                if (
                    l_wrist == 0
                    and (l_thumb[0] + overwork_mult <= speed or l_thumb[1] != "top")
                    and l_index[1] != "m"
                ):
                    if overwork(l_index, "home") <= overwork(l_middle, "home"):
                        speed += overwork(l_index, "home")
                        speed += 1
                        l_index = [speed, "uflick"]
                    else:
                        speed += overwork(l_middle, "home")
                        speed += 1
                        l_index = [speed, "uflick"]
                        l_middle = [speed, "uflick"]
                elif l_wrist == 1 and r_wrist == 0:
                    speed += overwork(r_index, "uflick")
                    if prev_move == "B":
                        speed += moveblock + push_mult
                    elif prev_move and prev_move[0] == "B":
                        speed += moveblock * 0.5 + push_mult
                    else:
                        speed += push_mult
                    r_index = [speed, "home"]
                elif r_wrist == 0 and prev_move and prev_move[0] not in ["F", "B"]:
                    if r_index[1] == "uflick":
                        speed += overwork(r_index, "eido", 0.75 * overwork_mult)
                        speed = max(speed, r_oh_cool + 2.5)
                    else:
                        speed += overwork(r_index, "eido", 1.25 * overwork_mult)
                    speed += 1.15 * push_mult
                    r_index = [speed, "uflick"]
                    r_oh_cool = speed
                else:
                    return [
                        j,
                        speed,
                        l_wrist,
                        r_wrist,
                        max(l_thumb[0], l_index[0], l_middle[0], l_ring[0]),
                        max(r_thumb[0], r_index[0], r_middle[0], r_ring[0]),
                    ]

            elif normal_move == "U2":
                if r_wrist == 0 and (
                    l_index[1] == "m"
                    or l_wrist != 0
                    or max(
                        overwork(r_index, "home"),
                        overwork(r_middle, "home"),
                        overwork(r_ring, "u2grip"),
                    )
                    <= max(
                        overwork(l_index, "home"),
                        overwork(l_middle, "home"),
                        overwork(l_ring, "u2grip"),
                    )
                ):
                    speed += overwork(r_index, "home")
                    speed += overwork(r_middle, "home")
                    speed += overwork(r_ring, "u2grip", moveblock * overwork_mult)
                    speed += double
                    r_index = [speed, "uflick"]
                    r_middle = [speed, "uflick"]
                elif l_wrist == 0:
                    speed += overwork(l_index, "home")
                    speed += overwork(l_middle, "home")
                    speed += overwork(l_ring, "u2grip", moveblock * overwork_mult)
                    speed += double
                    l_index = [speed, "uflick"]
                    l_middle = [speed, "uflick"]
                else:
                    return [
                        j,
                        speed,
                        l_wrist,
                        r_wrist,
                        max(l_thumb[0], l_index[0], l_middle[0], l_ring[0]),
                        max(r_thumb[0], r_index[0], r_middle[0], r_ring[0]),
                    ]

            elif normal_move == "D":
                if l_wrist == 0 and (
                    r_wrist != 0
                    or max(overwork(l_ring, "home"), overwork(l_middle, "home"))
                    <= max(overwork(r_ring, "dflick"), overwork(r_middle, "home"))
                ):
                    speed += overwork(l_ring, "home")
                    speed += overwork(l_middle, "home")
                    if prev_move and prev_move[0] == "B":
                        speed += moveblock * 0.5 + ring_mult
                    else:
                        speed += ring_mult
                    l_ring = [speed, "dflick"]
                elif r_wrist == 0 and prev_move and prev_move[0] != "B":
                    speed += overwork(r_ring, "dflick")
                    speed += overwork(r_middle, "home")
                    speed += ring_mult * push_mult
                    r_ring = [speed, "home"]
                else:
                    return [
                        j,
                        speed,
                        l_wrist,
                        r_wrist,
                        max(l_thumb[0], l_index[0], l_middle[0], l_ring[0]),
                        max(r_thumb[0], r_index[0], r_middle[0], r_ring[0]),
                    ]

            elif normal_move == "D'":
                if r_wrist == 0 and (
                    l_wrist != 0
                    or max(overwork(r_ring, "home"), overwork(r_middle, "home"))
                    <= max(overwork(l_ring, "dflick"), overwork(l_middle, "home"))
                ):
                    speed += overwork(r_ring, "home")
                    speed += overwork(r_middle, "home")
                    if prev_move and prev_move[0] == "B":
                        speed += moveblock * 0.5 + ring_mult
                    else:
                        speed += ring_mult
                    r_ring = [speed, "dflick"]
                elif l_wrist == 0 and prev_move and prev_move[0] != "B":
                    speed += overwork(l_ring, "dflick")
                    speed += overwork(l_middle, "home")
                    speed += ring_mult * push_mult
                    l_ring = [speed, "home"]
                else:
                    return [
                        j,
                        speed,
                        l_wrist,
                        r_wrist,
                        max(l_thumb[0], l_index[0], l_middle[0], l_ring[0]),
                        max(r_thumb[0], r_index[0], r_middle[0], r_ring[0]),
                    ]

            elif normal_move == "D2":
                if r_wrist == 0 and (
                    l_wrist != 0
                    or max(overwork(r_middle, "home"), overwork(r_ring, "home"))
                    <= max(overwork(l_middle, "home"), overwork(l_ring, "home"))
                ):
                    speed += overwork(r_middle, "home")
                    speed += overwork(r_ring, "home")
                    if prev_move and prev_move[0] == "B":
                        speed += moveblock * 0.5 + double * ring_mult
                    else:
                        speed += double * ring_mult
                    r_ring = [speed, "dflick"]
                elif l_wrist == 0:
                    speed += overwork(l_middle, "home")
                    speed += overwork(l_ring, "home")
                    if prev_move and prev_move[0] == "B":
                        speed += moveblock * 0.5 + double * ring_mult
                    else:
                        speed += double * ring_mult
                    l_ring = [speed, "dflick"]
                else:
                    return [
                        j,
                        speed,
                        l_wrist,
                        r_wrist,
                        max(l_thumb[0], l_index[0], l_middle[0], l_ring[0]),
                        max(r_thumb[0], r_index[0], r_middle[0], r_ring[0]),
                    ]

            elif normal_move == "F":
                if r_wrist == -1:
                    speed += overwork(r_index, "home")
                    speed += 1
                    r_index = [speed, "uflick"]
                elif l_wrist == 1 and move != "f":
                    speed += overwork(l_ring, "home")
                    if prev_move and prev_move[0] == "D":
                        speed += moveblock * 0.5 + ring_mult
                    else:
                        speed += 1
                    l_ring = [speed, "dflick"]
                elif r_wrist == 1 and prev_move and prev_move[0] != "D" and move != "f":
                    speed += overwork(r_ring, "dflick")
                    speed += ring_mult * push_mult
                    r_ring = [speed, "home"]
                elif (
                    l_wrist == -1 and r_wrist == 0 and overwork(r_index, "uflick") == 0
                ):
                    speed += 1
                    r_index = [speed, "fflick"]
                elif (
                    l_wrist == -1
                    and overwork(l_index, "uflick") == 0
                    and prev_move
                    and prev_move[0] != "U"
                ):
                    speed += push_mult
                    l_index = [speed, "home"]
                elif l_wrist == -1 and grip == -1:
                    speed += overwork(l_thumb, "top", 0.9 * overwork_mult)
                    speed += overwork(l_index, "top")
                    if prev_move and prev_move[0] == "D":
                        speed += 1.8
                    else:
                        speed += 1
                    l_wrist += 1
                    l_thumb = [speed, "leftu"]
                    l_index = [speed, "top"]
                elif l_wrist == 0 and grip == -1:
                    speed += overwork(l_thumb, "bottom")
                    speed += overwork(l_index, "top")
                    if prev_move and prev_move[0] == "D":
                        speed += 2.05
                    else:
                        speed += 1.25
                    l_thumb = [speed, "top"]
                    l_index = [speed, "top"]
                elif r_wrist == 0 and l_wrist == 0 and move == "f":
                    speed += overwork(r_index, "uflick")
                    speed += overwork(r_middle, "home")
                    speed += 1
                    r_index = [speed, "fflick"]
                elif j == 0 and r_wrist == 0 and l_wrist == 0:
                    speed += overwork(r_thumb, "top")
                    speed += 1
                    r_thumb = [speed, "rdown"]
                    r_middle = [speed, "uflick"]
                else:
                    return [
                        j,
                        speed,
                        l_wrist,
                        r_wrist,
                        max(l_thumb[0], l_index[0], l_middle[0], l_ring[0]),
                        max(r_thumb[0], r_index[0], r_middle[0], r_ring[0]),
                    ]

            elif normal_move == "F'":
                if l_wrist == -1:
                    speed += overwork(l_index, "home")
                    speed += 1
                    l_index = [speed, "uflick"]
                elif r_wrist == 1 and move != "f":
                    speed += overwork(r_ring, "home")
                    if prev_move and prev_move[0] == "D":
                        speed += moveblock * 0.5 + ring_mult
                    else:
                        speed += 1
                    r_ring = [speed, "dflick"]
                elif l_wrist == 1 and prev_move and prev_move[0] != "D" and move != "f":
                    speed += overwork(l_ring, "dflick")
                    speed += ring_mult * push_mult
                    l_ring = [speed, "home"]
                elif (
                    r_wrist == -1 and l_wrist == 0 and overwork(l_index, "uflick") == 0
                ):
                    speed += 1
                    l_index = [speed, "fflick"]
                elif (
                    r_wrist == -1
                    and overwork(r_index, "uflick") == 0
                    and prev_move
                    and prev_move[0] != "U"
                ):
                    speed += push_mult
                    r_index = [speed, "home"]
                elif r_wrist == -1 and grip == 1:
                    speed += overwork(r_thumb, "top", 0.9 * overwork_mult)
                    speed += overwork(r_index, "top")
                    if prev_move and prev_move[0] == "D":
                        speed += 1.8
                    else:
                        speed += 1
                    r_wrist += 1
                    r_thumb = [speed, "rightu"]
                    r_index = [speed, "top"]
                elif r_wrist == 0 and grip == 1:
                    speed += overwork(r_thumb, "bottom")
                    speed += overwork(r_index, "top")
                    if prev_move and prev_move[0] == "D":
                        speed += 2.05
                    else:
                        speed += 1.25
                    r_thumb = [speed, "top"]
                    r_index = [speed, "top"]
                elif l_wrist == 0 and r_wrist == 0 and move == "f'":
                    speed += overwork(l_index, "uflick")
                    speed += overwork(l_middle, "home")
                    speed += 1
                    l_index = [speed, "fflick"]
                elif j == 0 and r_wrist == 0 and l_wrist == 0:
                    speed += overwork(l_thumb, "top")
                    speed += 1
                    l_thumb = [speed, "rdown"]
                    l_middle = [speed, "uflick"]
                else:
                    return [
                        j,
                        speed,
                        l_wrist,
                        r_wrist,
                        max(l_thumb[0], l_index[0], l_middle[0], l_ring[0]),
                        max(r_thumb[0], r_index[0], r_middle[0], r_ring[0]),
                    ]

            elif normal_move == "F2":
                if r_wrist == -1 and (
                    l_wrist != -1
                    or max(
                        overwork(r_index, "home"),
                        overwork(r_middle, "home"),
                        overwork(r_ring, "u2grip"),
                    )
                    <= max(
                        overwork(l_index, "home"),
                        overwork(l_middle, "home"),
                        overwork(l_ring, "u2grip"),
                    )
                ):
                    speed += overwork(r_index, "home")
                    speed += overwork(r_middle, "home")
                    speed += overwork(r_ring, "u2grip")
                    speed += double
                    r_index = [speed, "uflick"]
                    r_middle = [speed, "uflick"]
                elif l_wrist == -1:
                    speed += overwork(l_index, "home")
                    speed += overwork(l_middle, "home")
                    speed += overwork(l_ring, "u2grip")
                    speed += double
                    l_index = [speed, "uflick"]
                    l_middle = [speed, "uflick"]
                elif r_wrist == 1 and (
                    l_wrist != 1
                    or max(overwork(r_middle, "home"), overwork(r_ring, "home"))
                    <= max(overwork(l_middle, "home"), overwork(l_ring, "home"))
                ):
                    speed += overwork(r_middle, "home")
                    speed += overwork(r_ring, "home")
                    if prev_move and prev_move[0] == "D":
                        speed += double * ring_mult + moveblock * 0.5
                    else:
                        speed += double * ring_mult
                    r_ring = [speed, "dflick"]
                elif l_wrist == 1:
                    speed += overwork(l_middle, "home")
                    speed += overwork(l_ring, "home")
                    if prev_move and prev_move[0] == "D":
                        speed += double * ring_mult + moveblock * 0.5
                    else:
                        speed += double * ring_mult
                    l_ring = [speed, "dflick"]
                else:
                    return [
                        j,
                        speed,
                        l_wrist,
                        r_wrist,
                        max(l_thumb[0], l_index[0], l_middle[0], l_ring[0]),
                        max(r_thumb[0], r_index[0], r_middle[0], r_ring[0]),
                    ]

            elif normal_move == "L":
                if l_wrist == 2:
                    l_wrist = 0
                elif l_wrist > -1 and not (r_wrist >= 1 and l_wrist <= 0):
                    l_wrist -= 1
                else:
                    return [
                        j,
                        speed,
                        l_wrist - 1,
                        r_wrist,
                        max(l_thumb[0], l_index[0], l_middle[0], l_ring[0]),
                        max(r_thumb[0], r_index[0], r_middle[0], r_ring[0]),
                    ]
                speed += wrist_mult

            elif normal_move == "L'":
                if l_wrist < 2 and not (r_wrist <= -1 and l_wrist >= 0):
                    l_wrist += 1
                else:
                    return [
                        j,
                        speed,
                        l_wrist + 1,
                        r_wrist,
                        max(l_thumb[0], l_index[0], l_middle[0], l_ring[0]),
                        max(r_thumb[0], r_index[0], r_middle[0], r_ring[0]),
                    ]
                speed += wrist_mult

            elif normal_move == "L2":
                if l_wrist >= 1 and r_wrist < 1:
                    l_wrist = -1
                elif r_wrist > -1:
                    l_wrist += 2
                else:
                    return [
                        j,
                        speed,
                        (l_wrist - 2 if l_wrist > 0 else l_wrist + 2),
                        r_wrist,
                        max(l_thumb[0], l_index[0], l_middle[0], l_ring[0]),
                        max(r_thumb[0], r_index[0], r_middle[0], r_ring[0]),
                    ]
                speed += double * wrist_mult

            elif normal_move == "B":
                if r_wrist == 1:
                    speed += overwork(r_index, "home")
                    speed += 1
                    r_index = [speed, "uflick"]
                elif l_wrist == -1:
                    speed += overwork(l_ring, "home")
                    speed += overwork(l_middle, "home")
                    if prev_move and prev_move[0] == "U":
                        speed += moveblock * 0.5 + ring_mult
                    else:
                        speed += ring_mult
                    l_ring = [speed, "dflick"]
                elif l_wrist == 1 and prev_move and prev_move[0] not in ["U", "D"]:
                    if l_index[1] == "uflick":
                        speed += overwork(l_index, "eido", 0.75 * overwork_mult)
                        speed = max(speed, l_oh_cool + 2.5)
                    else:
                        speed += overwork(l_index, "eido", 1.25 * overwork_mult)
                    speed += 1.15 * push_mult
                    l_index = [speed, "uflick"]
                    l_oh_cool = speed
                elif l_wrist == 0 and (r_wrist == 1 or r_wrist == -1):
                    speed += overwork(l_index, "top", 0.9 * overwork_mult)
                    if prev_move and prev_move[0] == "U":
                        speed += 1.45
                    else:
                        speed += 1
                    l_index = [speed, "leftdb"]
                elif r_wrist == -1 and prev_move and prev_move[0] != "U":
                    speed += overwork(r_ring, "dflick")
                    speed += overwork(r_middle, "home")
                    speed += ring_mult * push_mult
                    r_ring = [speed, "home"]
                else:
                    return [
                        j,
                        speed,
                        l_wrist,
                        r_wrist,
                        max(l_thumb[0], l_index[0], l_middle[0], l_ring[0]),
                        max(r_thumb[0], r_index[0], r_middle[0], r_ring[0]),
                    ]

            elif normal_move == "B'":
                if l_wrist == 1:
                    speed += overwork(l_index, "home")
                    speed += 1
                    l_index = [speed, "uflick"]
                elif r_wrist == -1:
                    speed += overwork(r_ring, "home")
                    speed += overwork(r_middle, "home")
                    if prev_move and prev_move[0] == "U":
                        speed += moveblock * 0.5 + ring_mult
                    else:
                        speed += ring_mult
                    r_ring = [speed, "dflick"]
                elif r_wrist == 1 and prev_move and prev_move[0] not in ["U", "D"]:
                    if r_index[1] == "uflick":
                        speed += overwork(r_index, "eido", 0.75 * overwork_mult)
                        speed = max(speed, r_oh_cool + 2.5)
                    else:
                        speed += overwork(r_index, "eido", 1.25 * overwork_mult)
                    speed += 1.15 * push_mult
                    r_index = [speed, "uflick"]
                    r_oh_cool = speed
                elif r_wrist == 0 and (l_wrist == 1 or l_wrist == -1):
                    speed += overwork(r_index, "top", 0.9 * overwork_mult)
                    if prev_move and prev_move[0] == "U":
                        speed += 1.45
                    else:
                        speed += 1
                    r_index = [speed, "rightdb"]
                elif l_wrist == -1 and prev_move and prev_move[0] != "U":
                    speed += overwork(l_ring, "dflick")
                    speed += overwork(l_middle, "home")
                    speed += ring_mult * push_mult
                    l_ring = [speed, "home"]
                else:
                    return [
                        j,
                        speed,
                        l_wrist,
                        r_wrist,
                        max(l_thumb[0], l_index[0], l_middle[0], l_ring[0]),
                        max(r_thumb[0], r_index[0], r_middle[0], r_ring[0]),
                    ]

            elif normal_move == "B2":
                if r_wrist == 1 and (
                    l_wrist != 1
                    or max(
                        overwork(r_index, "home"),
                        overwork(r_middle, "home"),
                        overwork(r_ring, "u2grip"),
                    )
                    <= max(
                        overwork(l_index, "home"),
                        overwork(l_middle, "home"),
                        overwork(l_ring, "u2grip"),
                    )
                ):
                    speed += overwork(r_index, "home")
                    speed += overwork(r_middle, "home")
                    speed += overwork(r_ring, "u2grip")
                    speed += double
                    r_index = [speed, "uflick"]
                    r_middle = [speed, "uflick"]
                elif l_wrist == 1:
                    speed += overwork(l_index, "home")
                    speed += overwork(l_middle, "home")
                    speed += overwork(l_ring, "u2grip")
                    speed += double
                    l_index = [speed, "uflick"]
                    l_middle = [speed, "uflick"]
                elif l_wrist == -1 and (
                    r_wrist != -1
                    or max(overwork(r_middle, "home"), overwork(r_ring, "home"))
                    > max(overwork(l_middle, "home"), overwork(l_ring, "home"))
                ):
                    speed += overwork(l_middle, "home")
                    speed += overwork(l_ring, "home")
                    if prev_move and prev_move[0] == "U":
                        speed += moveblock * 0.5 + double * ring_mult
                    else:
                        speed += double * ring_mult
                    l_ring = [speed, "dflick"]
                elif r_wrist == -1:
                    speed += overwork(r_middle, "home")
                    speed += overwork(r_ring, "home")
                    if prev_move and prev_move[0] == "U":
                        speed += moveblock * 0.5 + double * ring_mult
                    else:
                        speed += double * ring_mult
                    r_ring = [speed, "dflick"]
                else:
                    return [
                        j,
                        speed,
                        l_wrist,
                        r_wrist,
                        max(l_thumb[0], l_index[0], l_middle[0], l_ring[0]),
                        max(r_thumb[0], r_index[0], r_middle[0], r_ring[0]),
                    ]

            elif normal_move == "S":
                if r_wrist == 0 and (
                    l_wrist != 0
                    or overwork(r_index, "top", 1.25 * overwork_mult)
                    <= (moveblock * 0.5 + push_mult - 1) * seslice_mult
                ):
                    speed += overwork(r_index, "top", 1.25 * overwork_mult)
                    speed += seslice_mult
                    r_index = [speed, "sflick"]
                elif l_wrist == 0 and r_wrist == -1:
                    speed += overwork(r_index, "home", 1.25 * overwork_mult)
                    speed += overwork(r_thumb, "top", 1.25 * overwork_mult)
                    speed += overwork(r_middle, "home", 1.25 * overwork_mult)
                    speed += seslice_mult
                    r_thumb = [speed, "top"]
                    r_middle = [speed, "eflick"]
                elif l_wrist == 0 and (
                    r_wrist == 0 or (r_wrist == 1 and prev_move in ["R", "L"])
                ):
                    speed += overwork(l_index, "uflick", 1.25 * overwork_mult)
                    if prev_move and prev_move[0] == "U":
                        speed += moveblock * 0.5 + push_mult * seslice_mult
                    else:
                        speed += push_mult * seslice_mult
                    l_index = [speed, "top"]
                else:
                    return [
                        j,
                        speed,
                        l_wrist,
                        r_wrist,
                        max(l_thumb[0], l_index[0], l_middle[0], l_ring[0]),
                        max(r_thumb[0], r_index[0], r_middle[0], r_ring[0]),
                    ]

            elif normal_move == "S'":
                if l_wrist == 0 and (
                    r_wrist != 0
                    or overwork(l_index, "top", 1.25 * overwork_mult)
                    <= (moveblock * 0.5 + push_mult - 1) * seslice_mult
                ):
                    speed += overwork(l_index, "top", 1.25 * overwork_mult)
                    speed += seslice_mult
                    l_index = [speed, "sflick"]
                elif r_wrist == 0 and l_wrist == -1:
                    speed += overwork(l_index, "home", 1.25 * overwork_mult)
                    speed += overwork(l_thumb, "bottom", 1.25 * overwork_mult)
                    speed += overwork(l_middle, "home", 1.25 * overwork_mult)
                    speed += seslice_mult
                    l_thumb = [speed, "top"]
                    l_middle = [speed, "eflick"]
                elif r_wrist == 0 and (
                    l_wrist == 0 or (l_wrist == 1 and prev_move in ["R", "L"])
                ):
                    speed += overwork(r_index, "uflick", 1.25 * overwork_mult)
                    if prev_move and prev_move[0] == "U":
                        speed += moveblock * 0.5 + push_mult * seslice_mult
                    else:
                        speed += push_mult * seslice_mult
                    r_index = [speed, "top"]
                else:
                    return [
                        j,
                        speed,
                        l_wrist,
                        r_wrist,
                        max(l_thumb[0], l_index[0], l_middle[0], l_ring[0]),
                        max(r_thumb[0], r_index[0], r_middle[0], r_ring[0]),
                    ]

            elif normal_move == "S2":
                if (r_wrist in [-1, 1]) and l_wrist == 0:
                    speed += overwork(r_thumb, "home")
                    speed += overwork(r_index, "home")
                    speed += overwork(r_middle, "home")
                    speed += overwork(r_ring, "u2grip")
                    speed += seslice_mult * double
                    r_middle = [speed, "e"]
                    r_index = [speed, "e"]
                elif (l_wrist in [-1, 1]) and r_wrist == 0:
                    speed += overwork(l_thumb, "home")
                    speed += overwork(l_index, "home")
                    speed += overwork(l_middle, "home")
                    speed += overwork(l_ring, "u2grip")
                    speed += seslice_mult * double
                    r_middle = [speed, "e"]
                    r_index = [speed, "e"]
                else:
                    return [
                        j,
                        speed,
                        l_wrist,
                        r_wrist,
                        max(l_thumb[0], l_index[0], l_middle[0], l_ring[0]),
                        max(r_thumb[0], r_index[0], r_middle[0], r_ring[0]),
                    ]

            elif normal_move == "E":
                if (r_wrist in [1, -1]) and l_wrist == 0:
                    speed += overwork(l_index, "home")
                    speed += seslice_mult
                    l_index = [speed, "e"]
                elif (
                    (l_wrist in [1, -1])
                    and r_wrist == 0
                    and prev_move
                    and prev_move[0] != "B"
                ):
                    speed += overwork(r_index, "e")
                    speed += seslice_mult * push_mult
                    r_index = [speed, "home"]
                else:
                    return [
                        j,
                        speed,
                        l_wrist,
                        r_wrist,
                        max(l_thumb[0], l_index[0], l_middle[0], l_ring[0]),
                        max(r_thumb[0], r_index[0], r_middle[0], r_ring[0]),
                    ]

            elif normal_move == "E'":
                if (l_wrist in [1, -1]) and r_wrist == 0:
                    speed += overwork(r_index, "home")
                    speed += seslice_mult
                    r_index = [speed, "e"]
                elif (
                    (r_wrist in [1, -1])
                    and l_wrist == 0
                    and prev_move
                    and prev_move[0] != "B"
                ):
                    speed += overwork(l_index, "e")
                    speed += seslice_mult * push_mult
                    l_index = [speed, "home"]
                else:
                    return [
                        j,
                        speed,
                        l_wrist,
                        r_wrist,
                        max(l_thumb[0], l_index[0], l_middle[0], l_ring[0]),
                        max(r_thumb[0], r_index[0], r_middle[0], r_ring[0]),
                    ]

            elif normal_move == "E2":
                if (l_wrist in [1, -1]) and r_wrist == 0:
                    speed += overwork(r_index, "home")
                    speed += overwork(r_middle, "home")
                    speed += overwork(r_ring, "u2grip")
                    speed += seslice_mult * double
                    r_index = [speed, "e"]
                    r_middle = [speed, "e"]
                elif (r_wrist in [1, -1]) and l_wrist == 0:
                    speed += overwork(l_index, "home")
                    speed += overwork(l_middle, "home")
                    speed += overwork(l_ring, "u2grip")
                    speed += seslice_mult * double
                    l_index = [speed, "e"]
                    l_middle = [speed, "e"]
                else:
                    return [
                        j,
                        speed,
                        l_wrist,
                        r_wrist,
                        max(l_thumb[0], l_index[0], l_middle[0], l_ring[0]),
                        max(r_thumb[0], r_index[0], r_middle[0], r_ring[0]),
                    ]

            elif normal_move == "M'":
                if l_wrist == 0:
                    speed += overwork(l_thumb, "home")
                    speed += overwork(l_index, "m")
                    speed += overwork(l_middle, "m")
                    speed += overwork(l_ring, "m")
                    if prev_move and prev_move[0] == "B":
                        speed += 1.8
                    else:
                        speed += 1
                    l_thumb = [speed, "home"]
                    l_index = [speed, "m"]
                    l_middle = [speed, "mflick"]
                    l_ring = [speed, "m"]
                else:
                    return [
                        j,
                        speed,
                        l_wrist,
                        r_wrist,
                        max(l_thumb[0], l_index[0], l_middle[0], l_ring[0]),
                        max(r_thumb[0], r_index[0], r_middle[0], r_ring[0]),
                    ]

            elif normal_move == "M":
                if l_wrist == 0 and prev_move and prev_move[0] != "B":
                    speed += overwork(l_thumb, "home")
                    speed += overwork(l_index, "m")
                    speed += overwork(l_middle, "mflick", 1.25 * overwork_mult)
                    speed += overwork(l_ring, "m")
                    speed += push_mult
                    l_thumb = [speed, "home"]
                    l_index = [speed, "m"]
                    l_middle = [speed, "m"]
                    l_ring = [speed, "m"]
                else:
                    return [
                        j,
                        speed,
                        l_wrist,
                        r_wrist,
                        max(l_thumb[0], l_index[0], l_middle[0], l_ring[0]),
                        max(r_thumb[0], r_index[0], r_middle[0], r_ring[0]),
                    ]

            elif normal_move == "M2":
                if l_wrist == 0:
                    speed += overwork(l_thumb, "home")
                    speed += overwork(l_index, "m")
                    speed += overwork(l_middle, "m")
                    speed += overwork(l_ring, "m")
                    if prev_move and prev_move[0] == "B":
                        speed += moveblock + double
                    else:
                        speed += double
                    l_thumb = [speed, "home"]
                    l_index = [speed, "m"]
                    l_middle = [speed, "mflick"]
                    l_ring = [speed, "m"]
                else:
                    return [
                        j,
                        speed,
                        l_wrist,
                        r_wrist,
                        max(l_thumb[0], l_index[0], l_middle[0], l_ring[0]),
                        max(r_thumb[0], r_index[0], r_middle[0], r_ring[0]),
                    ]

            elif normal_move == "X":
                l_wrist += 1
                r_wrist += 1
                if l_wrist > 1 or r_wrist > 1:
                    return [
                        j + 1,
                        speed,
                        l_wrist,
                        r_wrist,
                        max(l_thumb[0], l_index[0], l_middle[0], l_ring[0]),
                        max(r_thumb[0], r_index[0], r_middle[0], r_ring[0]),
                    ]

            elif normal_move == "X'":
                l_wrist -= 1
                r_wrist -= 1
                if l_wrist < -1 or r_wrist < -1:
                    return [
                        j + 1,
                        speed,
                        l_wrist,
                        r_wrist,
                        max(l_thumb[0], l_index[0], l_middle[0], l_ring[0]),
                        max(r_thumb[0], r_index[0], r_middle[0], r_ring[0]),
                    ]

            elif normal_move == "X2":
                if l_wrist >= 1 and r_wrist >= 1:
                    l_wrist -= 2
                    r_wrist -= 2
                elif l_wrist <= -1 and r_wrist <= -1:
                    l_wrist += 2
                    r_wrist += 2
                elif l_wrist + r_wrist > 0:
                    return [
                        j,
                        speed,
                        l_wrist - 2,
                        r_wrist - 2,
                        max(l_thumb[0], l_index[0], l_middle[0], l_ring[0]),
                        max(r_thumb[0], r_index[0], r_middle[0], r_ring[0]),
                    ]
                else:
                    return [
                        j,
                        speed,
                        l_wrist + 2,
                        r_wrist + 2,
                        max(l_thumb[0], l_index[0], l_middle[0], l_ring[0]),
                        max(r_thumb[0], r_index[0], r_middle[0], r_ring[0]),
                    ]

            elif normal_move in ["Y", "Y'", "Z", "Z'"]:
                speed += rotation
                return [
                    j + 1,
                    speed,
                    0,
                    0,
                    max(l_thumb[0], l_index[0], l_middle[0], l_ring[0]),
                    max(r_thumb[0], r_index[0], r_middle[0], r_ring[0]),
                ]

            elif normal_move in ["Y2", "Z2"]:
                speed += rotation * double
                return [
                    j + 1,
                    speed,
                    0,
                    0,
                    max(l_thumb[0], l_index[0], l_middle[0], l_ring[0]),
                    max(r_thumb[0], r_index[0], r_middle[0], r_ring[0]),
                ]

            else:
                return "Unknown move: " + move

            # Post-move processing
            if first_move_speed is not None:
                speed = max(first_move_speed, speed) + 0.5
                prev_speed = None
                first_move_speed = None

            # Grip changes
            if (move[0] in ["R", "l"]) and grip == -1:
                grip = 1
                speed += 0.65
            elif (move[0] in ["r", "L"]) and grip == 1:
                grip = -1
                speed += 0.65

            if move[0] == "d" and ud_grip == -1:
                ud_grip = 1
                speed += 2.25
            elif (move[0] in ["U", "u"]) and ud_grip == 1:
                ud_grip = -1
                speed += 2.25

            # Special move optimizations
            if j >= 2:
                if (
                    normal_move == "R"
                    and move == split_seq[j - 2]
                    and split_seq[j - 1].upper() == "U'"
                ) or (
                    normal_move == "R'"
                    and move == split_seq[j - 2]
                    and split_seq[j - 1].upper() == "U"
                ):
                    speed -= 0.5
                elif (
                    normal_move == "R"
                    and move == split_seq[j - 2]
                    and split_seq[j - 1].upper() == "D'"
                    and r_wrist == 1
                ) or (
                    normal_move == "R'"
                    and move == split_seq[j - 2]
                    and split_seq[j - 1].upper() == "D"
                ):
                    speed -= 0.3

            # Destabilization penalties
            if normal_move == "U" and (l_wrist == -1 or r_wrist == -1):
                speed += destabilize
            if normal_move == "B" and (l_wrist == 0 or r_wrist == 0):
                speed += destabilize
            if normal_move == "D" and (l_wrist == 1 or r_wrist == 1):
                speed += destabilize
            if normal_move == "S" and (l_wrist in [1, -1] or r_wrist in [1, -1]):
                speed += destabilize
            if normal_move == "E" and (l_wrist == 0 or r_wrist == 0):
                speed += destabilize

        return [-1, speed, l_grip, r_grip]

    # Parse sequence
    split_seq = sequence.split(" ")
    true_split_seq = []

    valid_moves = [
        "r",
        "r2",
        "r'",
        "u",
        "u'",
        "u2",
        "f",
        "f2",
        "f'",
        "d",
        "d2",
        "d'",
        "l",
        "l2",
        "l'",
        "b",
        "b2",
        "b'",
        "m",
        "m2",
        "m'",
        "s",
        "s2",
        "s'",
        "e",
        "e2",
        "e'",
        "x",
        "x'",
        "x2",
        "y",
        "y'",
        "y2",
        "z",
        "z'",
        "z2",
    ]

    for move in split_seq:
        if ignore_errors:
            if move.lower() in valid_moves:
                true_split_seq.append(move)
        else:
            if move != "":
                true_split_seq.append(move)

    split_seq = true_split_seq[:]

    # Remove AUF (Adjust U Face) moves if requested
    if ignore_auf:
        if len(split_seq) >= 1:
            if split_seq[0][0] == "U":
                split_seq.pop(0)
            elif len(split_seq) >= 2:
                if split_seq[0][0].lower() == "d" and split_seq[1][0] == "U":
                    split_seq[1] = split_seq[0]
                    split_seq.pop(0)

        if len(split_seq) >= 1:
            if split_seq[-1][0] == "U":
                split_seq.pop()
            elif len(split_seq) >= 2:
                if split_seq[-1][0].lower() == "d" and split_seq[-2][0] == "U":
                    split_seq[-2] = split_seq[-1]
                    split_seq.pop()

    # Test different starting grip configurations
    tests = [
        test(split_seq, 0, 0, 0),
        test(split_seq, 0, -1, 1 + add_regrip),
        test(split_seq, 0, 1, 1 + add_regrip),
        test(split_seq, -1, 0, 1 + add_regrip),
        test(split_seq, 1, 0, 1 + add_regrip),
    ]

    # Main optimization loop
    while True:
        # Check for unknown move errors
        for i in range(len(tests)):
            if tests[i][0] == "U":  # "U" prefix indicates error string
                return tests[i]

        # Find best test result
        best_test = tests[0]
        for i in range(1, len(tests)):
            comp_test = tests[i]
            # Prefer tests that got further, or if equally far, prefer lower speed
            if comp_test[0] == -1 and (
                best_test[0] != -1 or best_test[1] > comp_test[1]
            ):
                best_test = comp_test
            elif comp_test[0] > best_test[0] and best_test[0] != -1:
                best_test = comp_test
            elif (
                comp_test[0] == best_test[0]
                and comp_test[1] < best_test[1]
                and best_test[0] != -1
            ):
                best_test = comp_test

        # If completed sequence, return final speed
        if best_test[0] == -1:
            return round(best_test[1] * 10) / 10

        # Need to regrip - test new grip configurations
        tests = []
        prev_move_type = split_seq[best_test[0] - 1][0] if best_test[0] >= 1 else " "
        prev_2_type = split_seq[best_test[0] - 2][0] if best_test[0] >= 2 else " "
        double_regrip = False

        # Check if both wrists need regripping
        if (best_test[2] > 1 or best_test[2] < -1) and (
            best_test[3] > 1 or best_test[3] < -1
        ):
            double_regrip = True

        # Try all possible new grip configurations
        for left_wrist in range(-1, 2):
            for right_wrist in range(-1, 2):
                left_match = best_test[2] == left_wrist
                right_match = best_test[3] == right_wrist

                # Handle rotations - they reset grip
                if prev_move_type.upper() in ["X", "Y", "Z"]:
                    tests.append(
                        test(
                            split_seq[best_test[0] :],
                            left_wrist,
                            right_wrist,
                            best_test[1],
                        )
                    )
                else:
                    # Calculate regrip penalty based on hand latency
                    penalty = (rotation * double) if double_regrip else 2

                    # Check for recent R/L moves
                    r_move_latency = (
                        1
                        if prev_move_type.upper() in ["R"]
                        or prev_2_type.upper() in ["R"]
                        or prev_move_type in ["r"]
                        or prev_2_type in ["r"]
                        else 0
                    )
                    l_move_latency = (
                        1
                        if prev_move_type.upper() in ["L"]
                        or prev_2_type.upper() in ["L"]
                        or prev_move_type in ["l"]
                        or prev_2_type in ["l"]
                        else 0
                    )

                    if left_match or double_regrip:
                        # Right hand is regripping
                        r_hand_latency = max(0, 2 - (best_test[1] - best_test[5]))
                        penalty = max(
                            r_hand_latency, r_move_latency, l_move_latency * 2
                        )
                        tests.append(
                            test(
                                split_seq[best_test[0] :],
                                left_wrist,
                                right_wrist,
                                best_test[1] + penalty + add_regrip,
                            )
                        )
                    elif right_match or double_regrip:
                        # Left hand is regripping
                        l_hand_latency = max(0, 2 - (best_test[1] - best_test[4]))
                        penalty = max(
                            l_hand_latency, l_move_latency, r_move_latency * 2
                        )
                        tests.append(
                            test(
                                split_seq[best_test[0] :],
                                left_wrist,
                                right_wrist,
                                best_test[1] + penalty + add_regrip,
                            )
                        )

        # Continue from where we left off
        split_seq = split_seq[best_test[0] :]


# ── Rename the raw physics function and wrap it ───────────────────────────────
_alg_speed_core = alg_speed


def alg_speed(  # noqa: F811
    sequence,
    ignore_errors=True,
    ignore_auf=False,
    # Physics params
    wrist_mult=0.9245,
    push_mult=1.1996,
    ring_mult=1.2111,
    destabilize=0.4017,
    add_regrip=0.9839,
    double=1.7696,
    seslice_mult=0.7118,
    overwork_mult=1.8446,
    moveblock=0.1130,
    rotation=1.6296,
    # Scale
    scale=0.0261,
    # Ngram enhancement
    use_ngrams=False,
    move_count_weight=0.0200,
    bigram_weights=None,
    trigram_weights=None,
):
    raw = _alg_speed_core(
        sequence,
        ignore_errors,
        ignore_auf,
        wrist_mult,
        push_mult,
        ring_mult,
        destabilize,
        add_regrip,
        double,
        seslice_mult,
        overwork_mult,
        moveblock,
        rotation,
    )

    if not isinstance(raw, (int, float)):
        return raw  # propagate error strings / lists unchanged

    result = raw * scale

    if use_ngrams:
        bw = bigram_weights if bigram_weights is not None else _DEFAULT_BIGRAM_WEIGHTS
        tw = (
            trigram_weights if trigram_weights is not None else _DEFAULT_TRIGRAM_WEIGHTS
        )
        ngram_w = {2: bw, 3: tw}

        norm_seq = _normalize(sequence)
        moves_orig = norm_seq.split()
        moves_mirror = _mirror(norm_seq).split()

        result += len(moves_orig) * move_count_weight
        result += _count_ngrams(moves_orig, ngram_w)
        result += _count_ngrams(moves_mirror, ngram_w)

    return round(result, 4)


if __name__ == "__main__":
    import sys

    if len(sys.argv) > 1:
        # ── Single-algorithm mode ─────────────────────────────────────────────
        # Called as: python3 alg_speed.py "R U R' U'"
        # Backward-compatible with the Node.js solver's execSync single call.
        alg = " ".join(sys.argv[1:])
        score = alg_speed(alg, ignore_auf=True)
        print(f"{alg} | {score:.4f}")
    else:
        # ── Batch mode ────────────────────────────────────────────────────────
        # Read one algorithm per line from stdin, print one score per line.
        # Node.js calls: execSync(cmd, { encoding: 'utf8', input: algs.join('\n') })
        for line in sys.stdin:
            alg = line.strip()
            if alg:
                score = alg_speed(alg, ignore_auf=True)
                print(f"{score:.4f}", flush=True)
