#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Red/green loop for editor merge topology.

Thin A–B seam becomes body. Wide water/exterior does not. Third-neighbor
gaps stay. 0-only holes absorb. Mirrors scripts/map_editor.js.
"""
from __future__ import annotations

import sys


def idx(W: int, x: int, y: int) -> int:
    return y * W + x


def dilate_sep(src: list[int], W: int, H: int, r: int) -> list[int]:
    tmp = [0] * (W * H)
    out = [0] * (W * H)
    for y in range(H):
        row = y * W
        for x in range(W):
            a, b = max(0, x - r), min(W - 1, x + r)
            on = 0
            for xx in range(a, b + 1):
                if src[row + xx]:
                    on = 1
                    break
            tmp[row + x] = on
    for x in range(W):
        for y in range(H):
            a, b = max(0, y - r), min(H - 1, y + r)
            on = 0
            for yy in range(a, b + 1):
                if tmp[yy * W + x]:
                    on = 1
                    break
            out[y * W + x] = on
    return out


def invert(src: list[int]) -> list[int]:
    return [0 if v else 1 for v in src]


def close_mask(src: list[int], W: int, H: int, r: int) -> list[int]:
    return invert(dilate_sep(invert(dilate_sep(src, W, H, r)), W, H, r))


def mask_of(labels: list[int], keep: int) -> list[int]:
    return [1 if v == keep else 0 for v in labels]


def touches_foreign(labels: list[int], W: int, H: int, i: int, keep: int) -> bool:
    x, y = i % W, i // W
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            if dx == 0 and dy == 0:
                continue
            nx, ny = x + dx, y + dy
            if nx < 0 or ny < 0 or nx >= W or ny >= H:
                continue
            lab = labels[ny * W + nx]
            if lab and lab != keep:
                return True
    return False


def close_keep_gaps(labels: list[int], W: int, H: int, keep: int, r: int) -> None:
    closed = close_mask(mask_of(labels, keep), W, H, r)
    for i, v in enumerate(closed):
        if v and labels[i] == 0 and not touches_foreign(labels, W, H, i, keep):
            labels[i] = keep


def fill_enclosed_zero_voids(labels: list[int], W: int, H: int, keep: int) -> None:
    vis = [0] * (W * H)
    dirs = ((1, 0), (-1, 0), (0, 1), (0, -1))
    for y in range(H):
        for x in range(W):
            i0 = idx(W, x, y)
            if labels[i0] != 0 or vis[i0]:
                continue
            stack = [(x, y)]
            cells: list[tuple[int, int]] = []
            vis[i0] = 1
            touch_border = False
            touch_foreign = False
            while stack:
                cx, cy = stack.pop()
                cells.append((cx, cy))
                if cx == 0 or cy == 0 or cx == W - 1 or cy == H - 1:
                    touch_border = True
                for dx, dy in dirs:
                    nx, ny = cx + dx, cy + dy
                    if nx < 0 or ny < 0 or nx >= W or ny >= H:
                        touch_border = True
                        continue
                    ni = idx(W, nx, ny)
                    lab = labels[ni]
                    if lab == 0:
                        if not vis[ni]:
                            vis[ni] = 1
                            stack.append((nx, ny))
                    elif lab != keep:
                        touch_foreign = True
            if not touch_border and not touch_foreign:
                for cx, cy in cells:
                    labels[idx(W, cx, cy)] = keep


INF = 9999
DIRS8 = (
    (1, 0),
    (1, 1),
    (0, 1),
    (-1, 1),
    (-1, 0),
    (-1, -1),
    (0, -1),
    (1, -1),
)


def chebyshev_dt(mask: list[int], W: int, H: int) -> list[int]:
    d = [0 if v else INF for v in mask]
    for y in range(H):
        for x in range(W):
            i = y * W + x
            if x > 0:
                d[i] = min(d[i], d[i - 1] + 1)
            if y > 0:
                d[i] = min(d[i], d[i - W] + 1)
            if x > 0 and y > 0:
                d[i] = min(d[i], d[i - W - 1] + 1)
            if x + 1 < W and y > 0:
                d[i] = min(d[i], d[i - W + 1] + 1)
    for y in range(H - 1, -1, -1):
        for x in range(W - 1, -1, -1):
            i = y * W + x
            if x + 1 < W:
                d[i] = min(d[i], d[i + 1] + 1)
            if y + 1 < H:
                d[i] = min(d[i], d[i + W] + 1)
            if x + 1 < W and y + 1 < H:
                d[i] = min(d[i], d[i + W + 1] + 1)
            if x > 0 and y + 1 < H:
                d[i] = min(d[i], d[i + W - 1] + 1)
    return d


def ray_first(
    labels: list[int], W: int, H: int, x: int, y: int, dx: int, dy: int, seam: int
) -> tuple[int, int]:
    for s in range(1, seam + 1):
        nx, ny = x + dx * s, y + dy * s
        if nx < 0 or ny < 0 or nx >= W or ny >= H:
            return (0, s)
        lab = labels[ny * W + nx]
        if lab:
            return (lab, s)
    return (0, seam + 1)


def ray_hits_foreign(
    labels: list[int],
    W: int,
    H: int,
    x: int,
    y: int,
    merge_set: set[int],
    seam: int,
) -> bool:
    for dx, dy in DIRS8:
        lab, _ = ray_first(labels, W, H, x, y, dx, dy, seam)
        if lab and lab not in merge_set:
            return True
    return False


def opposite_pair(
    labels: list[int],
    W: int,
    H: int,
    x: int,
    y: int,
    id_a: int,
    id_b: int,
    seam: int,
) -> bool:
    best_a = None
    best_b = None
    for dx, dy in DIRS8:
        lab, d = ray_first(labels, W, H, x, y, dx, dy, seam)
        if lab == id_a and (best_a is None or d < best_a[2]):
            best_a = (dx, dy, d)
        if lab == id_b and (best_b is None or d < best_b[2]):
            best_b = (dx, dy, d)
    if best_a is None or best_b is None:
        return False
    return best_a[0] * best_b[0] + best_a[1] * best_b[1] < 0


NATURAL_MAX = 6


def min_chebyshev(
    labels: list[int], W: int, H: int, id_a: int, id_b: int
) -> int:
    d_b = chebyshev_dt(mask_of(labels, id_b), W, H)
    best = INF
    for i, v in enumerate(labels):
        if v == id_a and d_b[i] < best:
            best = d_b[i]
    return best


def seam_limit(md: int, knife: bool = False) -> int:
    if md >= INF or md <= 0:
        return -1
    if knife:
        return md + 1
    if md > NATURAL_MAX:
        return -1
    return min(md + 2, NATURAL_MAX)


def pair_seam(
    labels: list[int],
    W: int,
    H: int,
    id_a: int,
    id_b: int,
    merge_set: set[int],
    seam: int | None = None,
    knife: bool = False,
) -> list[int]:
    d_a = chebyshev_dt(mask_of(labels, id_a), W, H)
    d_b = chebyshev_dt(mask_of(labels, id_b), W, H)
    if seam is None:
        seam = seam_limit(min_chebyshev(labels, W, H, id_a, id_b), knife)
    if seam < 0:
        return []
    out = []
    for i, v in enumerate(labels):
        if v != 0:
            continue
        if d_a[i] + d_b[i] > seam:
            continue
        x, y = i % W, i // W
        if ray_hits_foreign(labels, W, H, x, y, merge_set, seam):
            continue
        if not opposite_pair(labels, W, H, x, y, id_a, id_b, seam):
            continue
        out.append(i)
    return out


def merge_ids(
    labels: list[int],
    W: int,
    H: int,
    drop: list[int],
    keep: int,
    r: int = 8,
    gutter: int | None = None,
    knife: bool = False,
) -> None:
    del gutter, r
    merge_set = {keep, *drop}
    gap: list[int] = []
    for d in drop:
        gap.extend(
            pair_seam(labels, W, H, keep, d, merge_set, knife=knife)
        )
    for i in gap:
        labels[i] = keep
    for i, v in enumerate(labels):
        if v in drop:
            labels[i] = keep
    if knife:
        fill_enclosed_zero_voids(labels, W, H, keep)


def min_gap(labels: list[int], W: int, H: int, a: int, b: int) -> int:
    cells_a = [(i % W, i // W) for i, v in enumerate(labels) if v == a]
    cells_b = [(i % W, i // W) for i, v in enumerate(labels) if v == b]
    best = 10**9
    for x, y in cells_a:
        for u, v in cells_b:
            d = max(abs(x - u), abs(y - v))
            if d < best:
                best = d
    return best


def components(labels: list[int], W: int, H: int, keep: int) -> int:
    vis = [0] * (W * H)
    n = 0
    dirs = ((1, 0), (-1, 0), (0, 1), (0, -1))
    for y in range(H):
        for x in range(W):
            i0 = idx(W, x, y)
            if labels[i0] != keep or vis[i0]:
                continue
            n += 1
            stack = [(x, y)]
            vis[i0] = 1
            while stack:
                cx, cy = stack.pop()
                for dx, dy in dirs:
                    nx, ny = cx + dx, cy + dy
                    if nx < 0 or ny < 0 or nx >= W or ny >= H:
                        continue
                    ni = idx(W, nx, ny)
                    if vis[ni] or labels[ni] != keep:
                        continue
                    vis[ni] = 1
                    stack.append((nx, ny))
    return n


def old_zero_only_holes(labels: list[int], W: int, H: int, keep: int) -> int:
    """Current editor rebuildIds: any enclosed !keep pixel is a hole."""
    keep_m = mask_of(labels, keep)
    ext = [0] * (W * H)
    st: list[int] = []
    for x in range(W):
        st.append(x)
        st.append((H - 1) * W + x)
    for y in range(H):
        st.append(y * W)
        st.append(y * W + (W - 1))
    while st:
        i = st.pop()
        if i < 0 or i >= W * H or ext[i] or keep_m[i]:
            continue
        ext[i] = 1
        x, y = i % W, i // W
        if x > 0:
            st.append(i - 1)
        if x < W - 1:
            st.append(i + 1)
        if y > 0:
            st.append(i - W)
        if y < H - 1:
            st.append(i + W)
    holes = 0
    for i, v in enumerate(labels):
        if not keep_m[i] and not ext[i] and v == 0:
            holes += 1
    return holes


def paint_rect(labels: list[int], W: int, x0: int, y0: int, x1: int, y1: int, v: int) -> None:
    for y in range(y0, y1):
        for x in range(x0, x1):
            labels[idx(W, x, y)] = v


def fail(msg: str) -> None:
    print("FAIL", msg)
    raise SystemExit(1)


def test_corridor_becomes_one_body() -> None:
    W, H = 40, 20
    labels = [0] * (W * H)
    paint_rect(labels, W, 2, 4, 16, 16, 1)
    paint_rect(labels, W, 22, 4, 36, 16, 2)
    # 6px corridor = нож, не природная щель карты
    merge_ids(labels, W, H, drop=[2], keep=1, knife=True)
    if components(labels, W, H, 1) != 1:
        fail("corridor: expected 1 body, got %d" % components(labels, W, H, 1))
    for x in range(16, 22):
        if labels[idx(W, x, 10)] != 1:
            fail("corridor pixel (%d,10) still %s" % (x, labels[idx(W, x, 10)]))
    if any(v == 2 for v in labels):
        fail("corridor: dropped id still present")


def test_zero_only_hole_absorbed() -> None:
    W, H = 24, 24
    labels = [0] * (W * H)
    paint_rect(labels, W, 3, 3, 21, 21, 1)
    paint_rect(labels, W, 9, 9, 15, 15, 0)
    before = old_zero_only_holes(labels, W, H, 1)
    if before == 0:
        fail("setup: old detector should see the 0-hole")
    fill_enclosed_zero_voids(labels, W, H, 1)
    if labels[idx(W, 12, 12)] != 1:
        fail("0-only hole was not absorbed into body")
    if old_zero_only_holes(labels, W, H, 1) != 0:
        fail("0-only hole still punched after absorb")


def test_foreign_enclave_kept() -> None:
    W, H = 24, 24
    labels = [0] * (W * H)
    paint_rect(labels, W, 3, 3, 21, 21, 1)
    paint_rect(labels, W, 8, 8, 16, 16, 0)
    paint_rect(labels, W, 10, 10, 14, 14, 3)
    fill_enclosed_zero_voids(labels, W, H, 1)
    if labels[idx(W, 12, 12)] != 3:
        fail("foreign enclave was eaten")
    # beige ring around the enclave touches foreign → stays 0
    if labels[idx(W, 9, 12)] != 0:
        fail("gap around enclave should stay underlay, got %s" % labels[idx(W, 9, 12)])


def test_exterior_not_flooded() -> None:
    W, H = 20, 20
    labels = [0] * (W * H)
    paint_rect(labels, W, 6, 6, 14, 14, 1)
    fill_enclosed_zero_voids(labels, W, H, 1)
    if labels[idx(W, 1, 1)] != 0:
        fail("exterior underlay was flooded")
    if labels[idx(W, 10, 10)] != 1:
        fail("body disappeared")


def test_third_neighbor_gap_preserved() -> None:
    """Krasnoarmeysky+Pestravsky must not creep toward Khvorostyansky."""
    W, H = 36, 24
    labels = [0] * (W * H)
    paint_rect(labels, W, 2, 2, 14, 12, 1)  # A
    paint_rect(labels, W, 2, 16, 28, 22, 2)  # B below A, 4px seam
    paint_rect(labels, W, 18, 2, 30, 12, 3)  # C right of A, 4px gutter
    before = min_gap(labels, W, H, 1, 3)
    if before != 5:
        fail("setup: A–C chebyshev should be 5, got %s" % before)

    eaten = labels[:]
    d_a = dilate_sep(mask_of(eaten, 1), W, H, 12)
    d_b = dilate_sep(mask_of(eaten, 2), W, H, 12)
    for i, v in enumerate(eaten):
        if d_a[i] and d_b[i] and v == 0:
            eaten[i] = 1
        elif v == 2:
            eaten[i] = 1
    if min_gap(eaten, W, H, 1, 3) >= before:
        fail("setup: unguarded dilate should nibble the A–C gutter")

    merge_ids(labels, W, H, drop=[2], keep=1)
    if components(labels, W, H, 1) != 1:
        fail("T-junction: A+B should fuse")
    after = min_gap(labels, W, H, 1, 3)
    if after < before:
        fail("A–C gap shrank %s → %s (third neighbor eaten)" % (before, after))
    if labels[idx(W, 20, 6)] != 3:
        fail("C body was overwritten")
    # A–B seam (y=12..15, x=2..13) must be body, not leftover beige
    if labels[idx(W, 7, 14)] != 1:
        fail("A–B seam not fully filled")


def test_wide_close_eats_neighbor_bay() -> None:
    """Whole-body close(r=8) fills bays and walks toward a neighbor."""
    W, H = 28, 20
    labels = [0] * (W * H)
    paint_rect(labels, W, 2, 2, 26, 12, 1)
    paint_rect(labels, W, 8, 6, 20, 12, 0)  # south-facing bay
    paint_rect(labels, W, 2, 14, 26, 18, 3)
    before = min_gap(labels, W, H, 1, 3)
    close_keep_gaps(labels, W, H, 1, 8)
    after = min_gap(labels, W, H, 1, 3)
    if after >= before:
        fail("setup: close(r=8) should shrink the bay toward C (%s → %s)" % (before, after))


def test_wide_water_not_filled() -> None:
    """Stavropolsky×Shigonsky across a reservoir must not grow a new blob."""
    W, H = 36, 20
    labels = [0] * (W * H)
    paint_rect(labels, W, 2, 2, 14, 18, 1)
    paint_rect(labels, W, 26, 2, 34, 18, 2)  # 12px water
    before_zeros = sum(1 for v in labels if v == 0)
    merge_ids(labels, W, H, drop=[2], keep=1)
    if labels[idx(W, 20, 10)] != 0:
        fail("wide water was filled (extra volume)")
    if components(labels, W, H, 1) != 2:
        fail("wide water: should stay two islands, not a bridge")
    after_zeros = sum(1 for v in labels if v == 0)
    if after_zeros != before_zeros:
        fail("wide water: zero count %s → %s" % (before_zeros, after_zeros))


def test_land_bridge_not_water() -> None:
    """Shared 3px land seam fills; facing water beyond the contact stays empty."""
    W, H = 40, 28
    labels = [0] * (W * H)
    paint_rect(labels, W, 2, 2, 16, 10, 1)  # A top-left
    paint_rect(labels, W, 2, 13, 16, 22, 2)  # B below A, 3px seam y=10..13
    paint_rect(labels, W, 22, 2, 34, 10, 1)  # A also faces B across water? 
    # water column x=16..22 between left block and nothing on B's right
    # B does not extend to the right — water to the right of the pair
    paint_rect(labels, W, 22, 13, 34, 22, 0)
    merge_ids(labels, W, H, drop=[2], keep=1)
    if labels[idx(W, 8, 11)] != 1:
        fail("3px land seam was not filled")
    # water to the right of the contact (x=24, y=11) must stay empty
    if labels[idx(W, 24, 11)] != 0:
        fail("water beside the contact became extra land")
    if labels[idx(W, 8, 9)] != 1 or labels[idx(W, 8, 13)] != 1:
        fail("land pair not remapped")


def test_osm_gap_no_extra_into_water() -> None:
    """3px natural gutter fills; water face at the side stays empty."""
    W, H = 32, 20
    labels = [0] * (W * H)
    paint_rect(labels, W, 2, 2, 14, 16, 1)
    paint_rect(labels, W, 17, 2, 28, 16, 2)  # 3px gutter x=14..17
    before_a = sum(1 for v in labels if v == 1)
    before_b = sum(1 for v in labels if v == 2)
    merge_ids(labels, W, H, drop=[2], keep=1)
    extra_right = sum(
        1
        for x in range(20, W)
        for y in range(H)
        if labels[idx(W, x, y)] == 1 and x >= 28
    )
    if extra_right:
        fail("grew past original B into empty space")
    if labels[idx(W, 15, 8)] != 1:
        fail("3px gutter not filled")
    after = sum(1 for v in labels if v == 1)
    gap = 3 * 14  # x=14,15,16 * y=2..16
    if after > before_a + before_b + gap + 8:
        fail("too much new land: %s vs cap %s" % (after - before_a - before_b, gap + 8))


def test_old_rebuild_punches_merge_pocket() -> None:
    """Documents the editor bug: leftover interior zeros become evenodd holes."""
    W, H = 30, 18
    labels = [0] * (W * H)
    paint_rect(labels, W, 2, 2, 14, 16, 1)
    paint_rect(labels, W, 16, 2, 28, 16, 2)
    # remap only, no close — leftover 2px gutter, then a sealed 0-pocket inside 1
    for i, v in enumerate(labels):
        if v == 2:
            labels[i] = 1
    paint_rect(labels, W, 6, 6, 10, 10, 0)
    n = old_zero_only_holes(labels, W, H, 1)
    if n == 0:
        fail("old rebuild should punch the leftover 0-pocket (got 0)")


def main() -> int:
    tests = [
        test_corridor_becomes_one_body,
        test_zero_only_hole_absorbed,
        test_foreign_enclave_kept,
        test_exterior_not_flooded,
        test_third_neighbor_gap_preserved,
        test_wide_water_not_filled,
        test_land_bridge_not_water,
        test_osm_gap_no_extra_into_water,
        test_wide_close_eats_neighbor_bay,
        test_old_rebuild_punches_merge_pocket,
    ]
    for fn in tests:
        fn()
        print("ok", fn.__name__)
    print("OK", len(tests))
    return 0


if __name__ == "__main__":
    sys.exit(main())
