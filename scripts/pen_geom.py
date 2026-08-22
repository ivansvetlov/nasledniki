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
