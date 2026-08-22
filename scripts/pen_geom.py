#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Pencil geometry: one outside excursion between two border hits.

S/E are where the stroke meets the district border. Tails before S and
after E are ignored. More than one outside run, a mid-border graze, or
no return → None.

Water is not a neighbour here. Gap clamp lives in a later function.
"""
from __future__ import annotations

import math
from typing import Optional

Point = tuple[float, float]
Ring = list[Point]
Stroke = list[Point]

ON_EPS = 0.51


def _closed(ring: Ring) -> Ring:
    if not ring:
        return ring
    if ring[0] == ring[-1]:
        return ring[:-1]
    return ring


def closest_on_seg(p: Point, a: Point, b: Point) -> tuple[Point, float, float]:
    vx, vy = b[0] - a[0], b[1] - a[1]
    l2 = vx * vx + vy * vy
    t = 0.0 if l2 == 0 else ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / l2
    t = max(0.0, min(1.0, t))
    q = (a[0] + t * vx, a[1] + t * vy)
    d = math.hypot(p[0] - q[0], p[1] - q[1])
    return q, t, d


def dist_to_ring(p: Point, ring: Ring) -> float:
    r = _closed(ring)
    n = len(r)
    if n < 2:
        return 1e18
    best = 1e18
    for i in range(n):
        _, _, d = closest_on_seg(p, r[i], r[(i + 1) % n])
        if d < best:
            best = d
    return best


def point_in_ring(p: Point, ring: Ring) -> bool:
    r = _closed(ring)
    n = len(r)
    inside = False
    x, y = p
    for i in range(n):
        x1, y1 = r[i]
        x2, y2 = r[(i + 1) % n]
        if (y1 > y) != (y2 > y):
            xing = (x2 - x1) * (y - y1) / ((y2 - y1) or 1e-18) + x1
            if x < xing:
                inside = not inside
    return inside


def loc(p: Point, ring: Ring) -> str:
    if dist_to_ring(p, ring) <= ON_EPS:
        return "on"
    if point_in_ring(p, ring):
        return "in"
    return "out"


def seg_intersect(a: Point, b: Point, c: Point, d: Point) -> Optional[Point]:
    x1, y1 = b[0] - a[0], b[1] - a[1]
    x2, y2 = d[0] - c[0], d[1] - c[1]
    denom = x1 * y2 - y1 * x2
    if abs(denom) > 1e-18:
        t = ((c[0] - a[0]) * y2 - (c[1] - a[1]) * x2) / denom
        u = ((c[0] - a[0]) * y1 - (c[1] - a[1]) * x1) / denom
        if 0.0 <= t <= 1.0 and 0.0 <= u <= 1.0:
            return (a[0] + t * x1, a[1] + t * y1)
    for p, u0, v0 in ((a, c, d), (b, c, d), (c, a, b), (d, a, b)):
        _, _, dist = closest_on_seg(p, u0, v0)
        if dist <= 1e-6:
            return p
    return None


def _hits_on_segment(a: Point, b: Point, ring: Ring) -> list[tuple[float, Point]]:
    r = _closed(ring)
    n = len(r)
    hits: list[tuple[float, Point]] = []
    ab = math.hypot(b[0] - a[0], b[1] - a[1]) or 1.0
    for i in range(n):
        pt = seg_intersect(a, b, r[i], r[(i + 1) % n])
        if pt is None:
            continue
        t = ((pt[0] - a[0]) * (b[0] - a[0]) + (pt[1] - a[1]) * (b[1] - a[1])) / (
            ab * ab
        )
        t = max(0.0, min(1.0, t))
        hits.append((t, pt))
    hits.sort(key=lambda h: h[0])
    out: list[tuple[float, Point]] = []
    for t, pt in hits:
        if out and math.hypot(pt[0] - out[-1][1][0], pt[1] - out[-1][1][1]) < 0.2:
            continue
        out.append((t, pt))
    return out


def extract_excursion(stroke: Stroke, ring: Ring) -> Optional[dict]:
    """One outside run between two border contacts, or None."""
    if len(stroke) < 2 or len(_closed(ring)) < 3:
        return None

    contacts: list[tuple[float, Point]] = []
    for i in range(len(stroke) - 1):
        a, b = stroke[i], stroke[i + 1]
        for t, pt in _hits_on_segment(a, b, ring):
            s = i + t
            if contacts and abs(s - contacts[-1][0]) < 1e-4:
                continue
            if contacts and math.hypot(
                pt[0] - contacts[-1][1][0], pt[1] - contacts[-1][1][1]
            ) < 0.25:
                continue
            contacts.append((s, pt))
    # vertices that sit on the ring but were missed (t=0 duplicate)
    for i, p in enumerate(stroke):
        if loc(p, ring) != "on":
            continue
        if any(abs(i - s) < 1e-4 for s, _ in contacts):
            continue
        if any(math.hypot(p[0] - q[0], p[1] - q[1]) < 0.25 for _, q in contacts):
            continue
        contacts.append((float(i), p))
    contacts.sort(key=lambda c: c[0])

    if len(contacts) < 2:
        return None

    def sample(s: float) -> Point:
        if s <= 0:
            return stroke[0]
        if s >= len(stroke) - 1:
            return stroke[-1]
        i = int(math.floor(s))
        t = s - i
        a, b = stroke[i], stroke[min(i + 1, len(stroke) - 1)]
        return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)

    payload: list[tuple[tuple[float, Point], tuple[float, Point]]] = []
    for k in range(len(contacts) - 1):
        s0, p0 = contacts[k]
        s1, p1 = contacts[k + 1]
        mid_s = (s0 + s1) / 2.0
        kind = loc(sample(mid_s), ring)
        if kind == "on":
            continue
        if kind == "out":
            payload.append((contacts[k], contacts[k + 1]))
        # inside payload between contacts = chord through the body → ignore as volume
    if len(payload) != 1:
        return None

    (s0, S), (s1, E) = payload[0]
    if s1 - s0 < 1e-4:
        return None

    mid: list[Point] = [S]
    for i in range(len(stroke)):
        if s0 < i < s1:
            mid.append(stroke[i])
    mid.append(E)
    if len(mid) < 2:
        return None
    return {"S": S, "E": E, "mid": mid, "s0": s0, "s1": s1}


SEAM_GAP = 5.0
FACE_MAX = 10.0  # FACE_MAX+SLACK in pair_geom: corridor, not Volga


def signed_area(ring: Ring) -> float:
    r = _closed(ring)
    a = 0.0
    n = len(r)
    for i in range(n):
        j = (i + 1) % n
        a += r[i][0] * r[j][1] - r[j][0] * r[i][1]
    return a / 2.0


def closest_on_ring(p: Point, ring: Ring) -> tuple[Point, float, int, float]:
    r = _closed(ring)
    n = len(r)
    best = (r[0], 0.0, 0, 1e18)
    for i in range(n):
        q, t, d = closest_on_seg(p, r[i], r[(i + 1) % n])
        if d < best[3]:
            best = (q, t, i, d)
    return best


def closest_on_rings(p: Point, rings: list[Ring]) -> Optional[tuple[Point, float]]:
    best_q = None
    best_d = 1e18
    for ring in rings:
        q, _, _, d = closest_on_ring(p, ring)
        if d < best_d:
            best_d = d
            best_q = q
    if best_q is None:
        return None
    return best_q, best_d


def _cross(a: Point, b: Point, p: Point) -> float:
    return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])


def _centroid(ring: Ring) -> Point:
    r = _closed(ring)
    n = len(r) or 1
    return (sum(p[0] for p in r) / n, sum(p[1] for p in r) / n)


def _same_side_as_interior(p: Point, ring: Ring, S: Point, E: Point) -> bool:
    sp = _cross(S, E, p)
    si = _cross(S, E, _centroid(ring))
    if abs(sp) < 1e-8:
        return False
    return (sp > 0) == (si > 0)


def grow_mid(
    mid: list[Point],
    ring: Ring,
    neighbors: list[Ring],
    gap: float = SEAM_GAP,
    face: float = FACE_MAX,
) -> list[Point]:
    """Per-point grow: seam clamps to gap, bay keeps the stroke, void adds 0."""
    if len(mid) < 2:
        return mid
    S, E = mid[0], mid[-1]
    out = [S]
    for p in mid[1:-1]:
        Q, _, _, _ = closest_on_ring(p, ring)
        drawn = math.hypot(p[0] - Q[0], p[1] - Q[1])
        hit = closest_on_rings(Q, neighbors) if neighbors else None
        on_seam = False
        budget = drawn
        if hit is not None:
            N, _ = hit
            qn = math.hypot(Q[0] - N[0], Q[1] - N[1])
            pn = closest_on_rings(p, neighbors)
            pd = pn[1] if pn else 1e18
            if qn <= face or pd <= face:
                on_seam = True
                budget = max(0.0, qn - gap)
        if on_seam:
            if drawn < 1e-9:
                out.append(Q)
            else:
                t = min(1.0, budget / drawn)
                out.append((Q[0] + (p[0] - Q[0]) * t, Q[1] + (p[1] - Q[1]) * t))
        elif _same_side_as_interior(p, ring, S, E):
            out.append(p)
        else:
            out.append(Q)
    out.append(E)
    return out


def _walk_vertices(ring: Ring, i_from: int, i_to: int) -> list[Point]:
    r = _closed(ring)
    n = len(r)
    pts: list[Point] = []
    k = (i_from + 1) % n
    guard = 0
    while k != i_to and guard <= n:
        pts.append(r[k])
        k = (k + 1) % n
        guard += 1
    return pts


def assemble_ring(
    ring: Ring, S: Point, E: Point, new_mid: list[Point]
) -> Optional[list[Point]]:
    """Replace one border run with new_mid. Keep the large same-orientation body."""
    r = _closed(ring)
    if len(r) < 3 or len(new_mid) < 2:
        return None
    _, _, iS, _ = closest_on_ring(S, r)
    _, _, iE, _ = closest_on_ring(E, r)
    n = len(r)
    if iS == iE:
        around = r[iS + 1 :] + r[: iS + 1]
        cands = [new_mid + around, list(new_mid)]
    else:
        cands = [
            new_mid + _walk_vertices(r, iE, iS),
            list(reversed(new_mid)) + _walk_vertices(r, iS, iE),
        ]
    orig = signed_area(r)
    orig_sign = orig >= 0
    best = None
    best_a = -1.0
    for cand in cands:
        if len(cand) < 4:
            continue
        a = signed_area(cand)
        if (a >= 0) != orig_sign:
            continue
        if abs(a) > best_a:
            best_a = abs(a)
            best = cand
    if best is None or best_a < abs(orig) * 0.45:
        return None
    return best


def quadratic(s: Point, y: Point, e: Point, n: int = 24) -> list[Point]:
    pts: list[Point] = []
    if n < 2:
        n = 2
    for i in range(n + 1):
        t = i / n
        u = 1.0 - t
        pts.append(
            (
                u * u * s[0] + 2 * u * t * y[0] + t * t * e[0],
                u * u * s[1] + 2 * u * t * y[1] + t * t * e[1],
            )
        )
    return pts


def offset_open(pts: list[Point], dist: float, toward: Point) -> list[Point]:
    if len(pts) < 2:
        return list(pts)
    nrms: list[Point] = []
    for i in range(len(pts)):
        if i == 0:
            a, b = pts[0], pts[1]
        elif i == len(pts) - 1:
            a, b = pts[-2], pts[-1]
        else:
            a, b = pts[i - 1], pts[i + 1]
        vx, vy = b[0] - a[0], b[1] - a[1]
        ln = math.hypot(vx, vy) or 1.0
        nrms.append((-vy / ln, vx / ln))
    p0 = pts[len(pts) // 2]
    n0 = nrms[len(pts) // 2]
    dpos = math.hypot(p0[0] + n0[0] - toward[0], p0[1] + n0[1] - toward[1])
    dneg = math.hypot(p0[0] - n0[0] - toward[0], p0[1] - n0[1] - toward[1])
    sgn = 1.0 if dpos < dneg else -1.0
    out: list[Point] = []
    for p, nrm in zip(pts, nrms):
        out.append((p[0] + sgn * nrm[0] * dist, p[1] + sgn * nrm[1] * dist))
    return out


def _walk_back(ring: Ring, i_from: int, i_to: int) -> list[Point]:
    r = _closed(ring)
    n = len(r)
    pts: list[Point] = []
    k = (i_from - 1 + n) % n
    guard = 0
    while k != i_to and guard <= n:
        pts.append(r[k])
        k = (k - 1 + n) % n
        guard += 1
    return pts


def replace_facing_arc(
    ring: Ring, s: Point, e: Point, new_pts: list[Point], near: Point
) -> Optional[list[Point]]:
    r = _closed(ring)
    if len(r) < 3 or len(new_pts) < 2:
        return None
    _, _, iS, _ = closest_on_ring(s, r)
    _, _, iE, _ = closest_on_ring(e, r)
    if iS == iE:
        around = r[iS + 1 :] + r[: iS + 1]
        mx, my = (s[0] + e[0]) / 2, (s[1] + e[1]) / 2
        d_short = math.hypot(mx - near[0], my - near[1])
        cx, cy = _centroid(around if around else r)
        d_long = math.hypot(cx - near[0], cy - near[1])
        if d_short > d_long:
            cand = list(new_pts)
        elif _same_side_as_interior(near, r, s, e):
            cand = new_pts + list(reversed(around))
        else:
            cand = new_pts + around
    else:
        arc_f = [s] + _walk_vertices(r, iS, iE) + [e]
        arc_b = [s] + _walk_back(r, iS, iE) + [e]

        def amid(arc: list[Point]) -> Point:
            return arc[len(arc) // 2]

        df = math.hypot(amid(arc_f)[0] - near[0], amid(arc_f)[1] - near[1])
        db = math.hypot(amid(arc_b)[0] - near[0], amid(arc_b)[1] - near[1])
        other = arc_b if df <= db else arc_f
        cand = new_pts[:-1] + list(reversed(other))
    orig = signed_area(r)
    if (signed_area(cand) >= 0) != (orig >= 0):
        cand = list(reversed(cand))
    if len(cand) < 4:
        return None
    return cand



def _nudge(p: Point, toward: Point, dist: float = 2.0) -> Point:
    vx, vy = toward[0] - p[0], toward[1] - p[1]
    ln = math.hypot(vx, vy) or 1.0
    return (p[0] + vx / ln * dist, p[1] + vy / ln * dist)


def deform_pair(
    ring_a: Ring,
    ring_b: Ring,
    s: Point,
    e: Point,
    yellow: Point,
    gap: float = SEAM_GAP,
) -> tuple[Optional[list[Point]], Optional[list[Point]]]:
    arc_a = quadratic(s, yellow, e, 28)
    toward_b = _centroid(ring_b)
    arc_b = offset_open(arc_a, gap, toward_b)
    sb, _, _, _ = closest_on_ring(s, ring_b)
    eb, _, _, _ = closest_on_ring(e, ring_b)
    arc_b[0] = sb
    arc_b[-1] = eb
    mid_a = ((s[0] + e[0]) / 2.0, (s[1] + e[1]) / 2.0)
    mid_b = ((sb[0] + eb[0]) / 2.0, (sb[1] + eb[1]) / 2.0)
    a2 = replace_facing_arc(ring_a, s, e, arc_a, _nudge(mid_a, yellow, 2.0))
    b2 = replace_facing_arc(ring_b, sb, eb, arc_b, _nudge(mid_b, yellow, 2.0))
    return a2, b2




