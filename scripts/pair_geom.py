#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Facing-edge geometry: shorter-end normal, gap strip, coordinated Chaikin.

A pixel / vertex may become land only inside the pair-gap strip.
Neither district may grow into water, a third neighbour, or the other body.
"""
from __future__ import annotations

import math
import re
from typing import Iterable

from shapely.geometry import LineString, Point, Polygon
from shapely.ops import nearest_points, unary_union

FACE_MAX = 7.0  # px — OSM gutter ~3.3, wiggles 5–8; Volga ~15
FACE_SLACK = 3.0  # close holes still ≤ FACE_MAX+SLACK (land, not water)
FACE_HOLE = 80  # verts at 2px step
NATURAL_MAX = 6.0
CHAIKIN_ITERS = 1


def parse_d(d: str) -> list[list[tuple[float, float]]]:
    rings: list[list[tuple[float, float]]] = []
    cur: list[tuple[float, float]] = []
    for cmd in re.findall(r"[MLZmlz][^MLZmlz]*", d):
        op = cmd[0]
        nums = [float(x) for x in re.findall(r"-?\d+(?:\.\d+)?", cmd)]
        pts = [(nums[i], nums[i + 1]) for i in range(0, len(nums) - 1, 2)]
        if op in "Mm":
            if cur:
                rings.append(cur)
            cur = pts[:1]
            cur.extend(pts[1:])
        elif op in "Ll":
            cur.extend(pts)
        elif op in "Zz":
            if cur:
                rings.append(cur)
            cur = []
    if cur:
        rings.append(cur)
    return rings


def rings_to_polygon(rings: list[list[tuple[float, float]]]) -> Polygon:
    if not rings:
        return Polygon()
    ext = rings[0]
    if len(ext) < 3:
        return Polygon()
    holes = [r for r in rings[1:] if len(r) >= 3]
    poly = Polygon(ext, holes)
    if not poly.is_valid:
        poly = poly.buffer(0)
    return poly if isinstance(poly, Polygon) else unary_union(poly)


def poly_to_d(poly: Polygon) -> str:
    parts: list[str] = []
    geoms = [poly] if poly.geom_type == "Polygon" else list(poly.geoms)
    for g in geoms:
        if g.is_empty or g.geom_type != "Polygon":
            continue
        parts.append(_ring_d(list(g.exterior.coords)))
        for h in g.interiors:
            parts.append(_ring_d(list(h.coords)))
    return " ".join(parts)


def _ring_d(coords: list[tuple[float, float]]) -> str:
    if len(coords) > 1 and coords[0] == coords[-1]:
        coords = coords[:-1]
    if len(coords) < 3:
        return ""
    bits = [f"M{coords[0][0]:.1f},{coords[0][1]:.1f}"]
    bits += [f"L{x:.1f},{y:.1f}" for x, y in coords[1:]]
    bits.append("Z")
    return " ".join(bits)


def drop_close_dupes(pts: list[tuple[float, float]], eps: float = 0.35) -> list[tuple[float, float]]:
    if not pts:
        return pts
    out = [pts[0]]
    for p in pts[1:]:
        q = out[-1]
        if (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 > eps * eps:
            out.append(p)
    return out


def close_flag_gaps(flags: list[bool], max_gap: int = 8) -> list[bool]:
    """Length-only bridge. facing_run uses close_near_holes (distance slack)."""
    n = len(flags)
    if n == 0:
        return flags
    out = list(flags)
    i = 0
    while i < n:
        if out[i]:
            i += 1
            continue
        j = i
        while j < n and not flags[j]:
            j += 1
        hole = j - i
        left = flags[i - 1] if i > 0 else False
        right = flags[j] if j < n else False
        if hole <= max_gap and left and right:
            for k in range(i, j):
                out[k] = True
        i = j
    if not flags[0] and not flags[-1] and any(flags):
        a = 0
        while a < n and not flags[a]:
            a += 1
        b = n - 1
        while b >= 0 and not flags[b]:
            b -= 1
        hole = a + (n - 1 - b)
        if 0 < hole <= max_gap and a < n and b >= 0:
            for k in range(0, a):
                out[k] = True
            for k in range(b + 1, n):
                out[k] = True
    return out


def close_near_holes(
    flags: list[bool],
    dists: list[float],
    max_d: float,
    slack: float = 2.0,
    max_gap: int = 40,
) -> list[bool]:
    """Bridge a False run if it is still a land gutter (d <= max_d+slack).

    Kinel wobble is 24 verts at 5.01–5.10px — too long for a point-count cap,
    but nowhere near water (~15px).
    """
    n = len(flags)
    if n == 0:
        return flags
    out = list(flags)

    def fill(i: int, j: int) -> None:
        for k in range(i, j):
            out[k % n] = True

    i = 0
    while i < n:
        if flags[i]:
            i += 1
            continue
        j = i
        while j < n and not flags[j]:
            j += 1
        left = i > 0 and flags[i - 1]
        right = j < n and flags[j]
        hole = j - i
        near = hole <= max_gap and all(dists[k] <= max_d + slack for k in range(i, j))
        if left and right and near:
            fill(i, j)
        i = j
    if not flags[0] and not flags[-1] and any(flags):
        a = 0
        while a < n and not flags[a]:
            a += 1
        b = n - 1
        while b >= 0 and not flags[b]:
            b -= 1
        hole = a + (n - 1 - b)
        near = hole <= max_gap and all(
            dists[k] <= max_d + slack for k in list(range(0, a)) + list(range(b + 1, n))
        )
        if 0 < hole and a < n and b >= 0 and near:
            fill(0, a)
            fill(b + 1, n)
    return out


def longest_true_run(flags: list[bool]) -> tuple[int, int] | None:
    """Circular run of True. Returns (start, length) or None."""
    n = len(flags)
    if n == 0 or not any(flags):
        return None
    if all(flags):
        return (0, n)
    ext = flags + flags
    best_s = best_l = 0
    i = 0
    while i < n:
        if not ext[i]:
            i += 1
            continue
        j = i
        while j < i + n and ext[j]:
            j += 1
        if j - i > best_l:
            best_l = j - i
            best_s = i % n
        i = j
    return (best_s, best_l) if best_l else None


def densify(ring: list[tuple[float, float]], step: float = 2.0) -> list[tuple[float, float]]:
    pts = ring[:-1] if len(ring) > 1 and ring[0] == ring[-1] else list(ring)
    if len(pts) < 2:
        return pts
    out: list[tuple[float, float]] = []
    n = len(pts)
    for i in range(n):
        ax, ay = pts[i]
        bx, by = pts[(i + 1) % n]
        out.append((ax, ay))
        dx, dy = bx - ax, by - ay
        dist = math.hypot(dx, dy)
        if dist <= step:
            continue
        k = int(dist / step)
        for j in range(1, k):
            t = j / k
            out.append((ax + t * dx, ay + t * dy))
    return out


def all_true_runs(
    flags: list[bool], pts: list[tuple[float, float]]
) -> list[list[tuple[float, float]]]:
    n = len(flags)
    vis = [False] * n
    runs: list[list[tuple[float, float]]] = []
    for i in range(n):
        if not flags[i] or vis[i]:
            continue
        s = i
        while flags[(s - 1) % n] and (s - 1) % n != i:
            s = (s - 1) % n
            if s == i:
                break
        run: list[tuple[float, float]] = []
        j = s
        while flags[j] and not vis[j]:
            vis[j] = True
            run.append(pts[j])
            j = (j + 1) % n
            if j == s:
                break
        if len(run) >= 2:
            runs.append(run)
    return runs


def facing_runs(
    ring: list[tuple[float, float]], other: Polygon, max_d: float = FACE_MAX
) -> list[list[tuple[float, float]]]:
    if len(ring) < 2 or other.is_empty:
        return []
    pts = densify(ring, step=2.0)
    dists = [Point(p).distance(other) for p in pts]
    flags = close_near_holes(
        [d <= max_d for d in dists],
        dists,
        max_d=max_d,
        slack=FACE_SLACK,
        max_gap=FACE_HOLE,
    )
    return all_true_runs(flags, pts)


def facing_run(
    ring: list[tuple[float, float]], other: Polygon, max_d: float = FACE_MAX
) -> list[tuple[float, float]]:
    """Primary seam: the run that contains the closest approach."""
    if len(ring) < 2 or other.is_empty:
        return []
    pts = densify(ring, step=2.0)
    dists = [Point(p).distance(other) for p in pts]
    flags = close_near_holes(
        [d <= max_d for d in dists],
        dists,
        max_d=max_d,
        slack=FACE_SLACK,
        max_gap=FACE_HOLE,
    )
    runs = all_true_runs(flags, pts)
    if not runs:
        return []
    seed = min(range(len(pts)), key=lambda i: dists[i])
    for run in runs:
        if pts[seed] in run or any(_d2(pts[seed], p) < 1e-6 for p in run):
            return run
    return max(runs, key=len)


def closest_on_chain(
    p: tuple[float, float], chain: list[tuple[float, float]]
) -> tuple[float, float]:
    if not chain:
        return p
    if len(chain) == 1:
        return chain[0]
    line = LineString(chain)
    # nearest_points(point, line)[1] is the foot of the perpendicular
    # (or an endpoint if the normal misses the segment).
    return nearest_points(Point(p), line)[1].coords[0]


def _dist_pt_chain(p: tuple[float, float], chain: list[tuple[float, float]]) -> float:
    if not chain:
        return 1e9
    if len(chain) == 1:
        return math.hypot(p[0] - chain[0][0], p[1] - chain[0][1])
    return Point(p).distance(LineString(chain))


def pair_end_seams(
    a: list[tuple[float, float]], b: list[tuple[float, float]]
) -> list[tuple[tuple[float, float], tuple[float, float]]]:
    """Two end-normals. At each end the *shorter* edge drops a perpendicular.

    Returns [(a_pt, b_pt), (a_pt, b_pt)] in chain order.
    """
    if len(a) < 2 or len(b) < 2:
        return []
    if _d2(a[0], b[0]) + _d2(a[-1], b[-1]) <= _d2(a[0], b[-1]) + _d2(a[-1], b[0]):
        pairs = [(a[0], b[0]), (a[-1], b[-1])]
    else:
        pairs = [(a[0], b[-1]), (a[-1], b[0])]
    seams: list[tuple[tuple[float, float], tuple[float, float]]] = []
    for pa, pb in pairs:
        da = _dist_pt_chain(pa, b)
        db = _dist_pt_chain(pb, a)
        if da <= db:
            seams.append((pa, closest_on_chain(pa, b)))
        else:
            seams.append((closest_on_chain(pb, a), pb))
    return seams


def project_shorter_ends(
    a: list[tuple[float, float]], b: list[tuple[float, float]]
) -> tuple[list[tuple[float, float]], list[tuple[float, float]]]:
    """Clip both facing chains to the two end-normals (shorter edge → foot)."""
    seams = pair_end_seams(a, b)
    if len(seams) != 2:
        return a, b
    (a0, b0), (a1, b1) = seams
    return clip_chain_between(a, a0, a1), clip_chain_between(b, b0, b1)


def clip_chain_between(
    chain: list[tuple[float, float]],
    p0: tuple[float, float],
    p1: tuple[float, float],
) -> list[tuple[float, float]]:
    """Walk chain, start at the vertex nearest p0, end nearest p1, include feet."""
    if len(chain) < 2:
        return [p0, p1]
    i0 = min(range(len(chain)), key=lambda i: _d2(chain[i], p0))
    i1 = min(range(len(chain)), key=lambda i: _d2(chain[i], p1))
    if i0 == i1:
        return drop_close_dupes([p0, chain[i0], p1])
    # pick the shorter walk i0 → i1
    if i0 < i1:
        mid = chain[i0 : i1 + 1]
        alt = chain[i1:] + chain[: i0 + 1]
    else:
        mid = chain[i0:] + chain[: i1 + 1]
        alt = chain[i1 : i0 + 1]
    walk = mid if len(mid) <= len(alt) else alt
    return drop_close_dupes([p0] + walk + [p1])


def _d2(a: tuple[float, float], b: tuple[float, float]) -> float:
    return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2


def walk_ring(
    ring: list[tuple[float, float]],
    p0: tuple[float, float],
    p1: tuple[float, float],
    long: bool = True,
) -> list[tuple[float, float]]:
    """Walk original vertices from p0 to p1. long=True = the body, not the facing run."""
    pts = ring[:-1] if ring and ring[0] == ring[-1] else list(ring)
    if len(pts) < 2:
        return [p0, p1]
    i0 = min(range(len(pts)), key=lambda i: _d2(pts[i], p0))
    i1 = min(range(len(pts)), key=lambda i: _d2(pts[i], p1))
    n = len(pts)

    def along(step: int) -> list[tuple[float, float]]:
        out = [pts[i0]]
        i = i0
        guard = 0
        while i != i1 and guard < n + 2:
            i = (i + step) % n
            out.append(pts[i])
            guard += 1
        return out

    if i0 == i1:
        return [p0, p1]
    fwd, bwd = along(1), along(-1)
    short, lng = (fwd, bwd) if len(fwd) <= len(bwd) else (bwd, fwd)
    walk = lng if long else short
    return drop_close_dupes([p0] + walk[1:-1] + [p1])


def all_strips(a: Polygon, b: Polygon) -> list[Polygon]:
    fa_list = facing_runs(list(a.exterior.coords), b)
    fb_list = facing_runs(list(b.exterior.coords), a)
    if not fa_list or not fb_list:
        return []
    out: list[Polygon] = []
    used = [False] * len(fb_list)
    for fa in fa_list:
        if len(fa) < 2:
            continue
        best_i = None
        best_d = 1e18
        for i, fb in enumerate(fb_list):
            if used[i] or len(fb) < 2:
                continue
            d = min(
                _d2(fa[0], fb[0]),
                _d2(fa[0], fb[-1]),
                _d2(fa[-1], fb[0]),
                _d2(fa[-1], fb[-1]),
            )
            if d < best_d:
                best_d = d
                best_i = i
        if best_i is None:
            continue
        used[best_i] = True
        strip = gap_strip(fa, fb_list[best_i])
        if not strip.is_empty:
            out.append(strip)
    return out


def stitch_polygons(a: Polygon, b: Polygon) -> tuple[Polygon, dict]:
    """Keep original outlines; fill every facing-gap strip."""
    strips = all_strips(a, b)
    info = {"ok": False, "strips": len(strips)}
    if not strips:
        return Polygon(), info
    poly = unary_union([a, b] + strips)
    if poly.is_empty:
        return Polygon(), info
    if poly.geom_type != "Polygon":
        poly = max(poly.geoms, key=lambda g: g.area)
    info["ok"] = True
    gap = allowed_gap(a, b, max_d=FACE_MAX + FACE_SLACK)
    gained = poly.difference(a).difference(b)
    info["extra"] = 0.0 if gained.is_empty else gained.difference(gap.buffer(1.5)).area
    return poly, info


def gap_strip(
    a_chain: list[tuple[float, float]], b_chain: list[tuple[float, float]]
) -> Polygon:
    a, b = project_shorter_ends(a_chain, b_chain)
    if len(a) < 2 or len(b) < 2:
        return Polygon()
    ring = drop_close_dupes(a + list(reversed(b)))
    if len(ring) < 3:
        return Polygon()
    poly = Polygon(ring)
    if not poly.is_valid:
        poly = poly.buffer(0)
    if poly.is_empty:
        return Polygon()
    if poly.geom_type != "Polygon":
        poly = max(poly.geoms, key=lambda g: g.area)
    return poly


def chaikin(
    pts: list[tuple[float, float]], closed: bool = False
) -> list[tuple[float, float]]:
    if len(pts) < 3:
        return pts
    out: list[tuple[float, float]] = []
    n = len(pts)
    last = n if closed else n - 1
    if not closed:
        out.append(pts[0])
    for i in range(last):
        ax, ay = pts[i]
        bx, by = pts[(i + 1) % n]
        out.append((0.75 * ax + 0.25 * bx, 0.75 * ay + 0.25 * by))
        out.append((0.25 * ax + 0.75 * bx, 0.25 * ay + 0.75 * by))
    if not closed:
        out.append(pts[-1])
    return drop_close_dupes(out)


def replace_run(
    ring: list[tuple[float, float]], run: list[tuple[float, float]], new_run: list[tuple[float, float]]
) -> list[tuple[float, float]]:
    """Replace the first/last-matched run inside ring with new_run."""
    pts = ring[:-1] if ring and ring[0] == ring[-1] else list(ring)
    if not run:
        return pts
    i0 = min(range(len(pts)), key=lambda i: _d2(pts[i], run[0]))
    i1 = min(range(len(pts)), key=lambda i: _d2(pts[i], run[-1]))
    if i0 <= i1:
        return pts[:i0] + new_run + pts[i1 + 1 :]
    return new_run + pts[i1 + 1 : i0]


def allowed_gap(a: Polygon, b: Polygon, max_d: float = FACE_MAX) -> Polygon:
    band = a.buffer(max_d).intersection(b.buffer(max_d))
    return band.difference(a).difference(b)


def gained_outside(old: Polygon, new: Polygon, gap: Polygon, tol: float = 0.8) -> float:
    gained = new.difference(old)
    if gained.is_empty:
        return 0.0
    bad = gained.difference(gap.buffer(tol))
    return 0.0 if bad.is_empty else bad.area


def smooth_facing_pair(
    a: Polygon, b: Polygon, iters: int = CHAIKIN_ITERS
) -> tuple[Polygon, Polygon, dict]:
    """Chaikin only the facing runs. Clip growth to the pair-gap strip."""
    ra = list(a.exterior.coords)
    rb = list(b.exterior.coords)
    fa = facing_run(ra, b)
    fb = facing_run(rb, a)
    info = {
        "a_run": len(fa),
        "b_run": len(fb),
        "ok": len(fa) >= 3 and len(fb) >= 3,
    }
    if not info["ok"]:
        return a, b, info
    fa2, fb2 = fa, fb
    for _ in range(iters):
        fa2 = chaikin(fa2, closed=False)
        fb2 = chaikin(fb2, closed=False)
    # keep endpoints (triple points / shorter-end feet)
    if fa2:
        fa2[0], fa2[-1] = fa[0], fa[-1]
    if fb2:
        fb2[0], fb2[-1] = fb[0], fb[-1]
    na = Polygon(replace_run(ra, fa, fa2))
    nb = Polygon(replace_run(rb, fb, fb2))
    if not na.is_valid:
        na = na.buffer(0)
    if not nb.is_valid:
        nb = nb.buffer(0)
    gap = allowed_gap(a, b)
    # may enter the pair gap, never anything else
    na = unary_union([a, na.intersection(a.union(gap))])
    nb = unary_union([b, nb.intersection(b.union(gap))])
    if na.intersects(nb):
        na = na.difference(b)
        nb = nb.difference(a)
    info["extra_a"] = gained_outside(a, na, gap)
    info["extra_b"] = gained_outside(b, nb, gap)
    return na, nb, info


def strip_from_polys(a: Polygon, b: Polygon) -> Polygon:
    fa = facing_run(list(a.exterior.coords), b)
    fb = facing_run(list(b.exterior.coords), a)
    if len(fa) < 2 or len(fb) < 2:
        return Polygon()
    return gap_strip(fa, fb)
