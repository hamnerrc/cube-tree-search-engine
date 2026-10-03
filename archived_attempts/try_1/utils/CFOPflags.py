def analyze_cube(cube):
    # Ensure cube is uppercase
    cube = cube.upper()

    # Center positions for each face: U, R, F, D, L, B
    centers = [4, 13, 22, 31, 40, 49]

    # Masks (uppercase means ignore, lowercase means check)
    cross_mask = "WWWWWWWWWRRRRRRRrRGGGGGGGgGYyYyYyYyYOOOOOOOoOBBBBBBBbB"
    bl_mask = "WWWWWWWWWRRRRRRRRRGGGGGGGGGYYYYYYyYYOOOoOOoOOBBBBBbBBb"
    br_mask = "WWWWWWWWWRRRRRrRRrGGGGGGGGGYYYYYYYYyOOOOOOOOOBBBbBBbBB"
    fl_mask = "WWWWWWWWWRRRRRRRRRGGGgGGgGGyYYYYYYYYOOOOOoOOoBBBBBBBBB"
    fr_mask = "WWWWWWWWWRRRrRRrRRGGGGGgGGgYYyYYYYYYOOOOOOOOOBBBBBBBBB"

    def is_solved(cube, mask):
        for pos in range(54):
            if mask[pos].islower():
                face = pos // 9
                if cube[pos] != cube[centers[face]]:
                    return False
        return True

    cross = int(is_solved(cube, cross_mask))
    bl = int(is_solved(cube, bl_mask))
    br = int(is_solved(cube, br_mask))
    fl = int(is_solved(cube, fl_mask))
    fr = int(is_solved(cube, fr_mask))

    return [cross, bl, br, fl, fr]


# Example usage:
scrambled = "GRBBWYYYOBORWRBRRYBGWGGBWGBROWYYBRWGOYOROWGRGYWWOBGOOY".upper()
print(analyze_cube(scrambled))  # [0, 0, 0, 0, 0] nothing is solved

blue_cross_example = "GGYYGROYGWGGORRBrrWGRyYGyyRbbYbbbbbbRRGooooooOWYwwwwww".upper()
print(analyze_cube(blue_cross_example))  # [1, 1, 1, 1, 0] cross, BL, BR, BL are solved, but not FR
