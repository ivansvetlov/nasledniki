#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""RED/GREEN for pencil excursion: one exit, one entry, tails dropped.

Run:
  C:\\Workspace\\_agent\\.venv\\Scripts\\python.exe scripts\\test_pen_geom.py
"""
from __future__ import annotations

import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import pen_geom as pg  # noqa: E402


def fail(msg: str) -> None:
    print("FAIL", msg)
    raise SystemExit(1)


def close(a, b, eps=0.15) -> bool:
    return math.hypot(a[0] - b[0], a[1] - b[1]) <= eps


def square() -> list[tuple[float, float]]:
    # 100x100 square, CCW, not closed-duplicate
    return [(0.0, 0.0), (100.0, 0.0), (100.0, 100.0), (0.0, 100.0)]


def test_inside_tails_are_dropped() -> None:
    ring = square()
    # start inside, exit through right side x=100, bulge to x=130, re-enter, end inside
    stroke = [
        (80.0, 40.0),
        (80.0, 50.0),
        (110.0, 50.0),
        (130.0, 55.0),
        (110.0, 70.0),
        (80.0, 70.0),
        (80.0, 80.0),
    ]
    got = pg.extract_excursion(stroke, ring)
    if got is None:
        fail("valid one-pass stroke returned None")
    if not close(got["S"], (100.0, 50.0)):
        fail("S should be exit on x=100, got %s" % (got["S"],))
    if not close(got["E"], (100.0, 70.0)):
        fail("E should be re-entry on x=100, got %s" % (got["E"],))
    mid = got["mid"]
    if close(mid[0], (80.0, 40.0)):
        fail("start tail still in mid")
    if close(mid[-1], (80.0, 80.0)):
        fail("end tail still in mid")
    xs = [p[0] for p in mid]
    if max(xs) < 125:
        fail("bulge peak missing from mid")


def test_substrate_tails_are_dropped() -> None:
    ring = square()
    # tails stay on the beige; bulge stays outside; S/E are the two border hits
    stroke = [
        (140.0, 40.0),
        (120.0, 50.0),
        (100.0, 50.0),
        (130.0, 60.0),
        (100.0, 80.0),
        (140.0, 90.0),
    ]
    got = pg.extract_excursion(stroke, ring)
    if got is None:
        fail("border-to-border with outside tails returned None")
    if not close(got["S"], (100.0, 50.0)):
        fail("S %s" % (got["S"],))
    if not close(got["E"], (100.0, 80.0)):
        fail("E %s" % (got["E"],))
    if not close(got["mid"][0], got["S"]) or not close(got["mid"][-1], got["E"]):
        fail("mid must start at S and end at E, got %s .. %s" % (got["mid"][0], got["mid"][-1]))
    if any(p[0] > 105 and p is got["mid"][0] for p in got["mid"][:1]):
        fail("start tail kept")
    if close(got["mid"][-1], (140.0, 90.0)):
        fail("end tail kept")


def test_start_on_border_no_inside_tail() -> None:
    ring = square()
    stroke = [
        (100.0, 40.0),
        (120.0, 50.0),
        (130.0, 60.0),
        (120.0, 70.0),
        (100.0, 80.0),
    ]
    got = pg.extract_excursion(stroke, ring)
    if got is None:
        fail("start/end on border returned None")
    if not close(got["S"], (100.0, 40.0)):
        fail("S %s" % (got["S"],))
    if not close(got["E"], (100.0, 80.0)):
        fail("E %s" % (got["E"],))


def test_two_exits_are_noop() -> None:
    ring = square()
    # out, in, out, in
    stroke = [
        (80.0, 20.0),
        (120.0, 20.0),
        (80.0, 20.0),
        (80.0, 50.0),
        (120.0, 50.0),
        (80.0, 50.0),
    ]
    if pg.extract_excursion(stroke, ring) is not None:
        fail("two excursions must be None")


def test_mid_graze_is_noop() -> None:
    ring = square()
    # out, barely nick the right edge, out again, then re-enter
    stroke = [
        (80.0, 40.0),
        (120.0, 40.0),
        (100.0, 50.0),
        (120.0, 60.0),
        (80.0, 60.0),
    ]
    if pg.extract_excursion(stroke, ring) is not None:
        fail("mid-border graze must be None")


def test_all_inside_is_noop() -> None:
    ring = square()
    stroke = [(20.0, 20.0), (40.0, 30.0), (50.0, 50.0)]
    if pg.extract_excursion(stroke, ring) is not None:
        fail("inside stroke must be None")


def test_never_returns_is_noop() -> None:
    ring = square()
    stroke = [(80.0, 50.0), (150.0, 50.0), (180.0, 50.0)]
    if pg.extract_excursion(stroke, ring) is not None:
        fail("open-ended exit must be None")


def u_ring() -> list[tuple[float, float]]:
    # C-shape opening to the right. Bay pocket around (40, 30) is beige.
    return [
        (0.0, 0.0),
        (60.0, 0.0),
        (60.0, 20.0),
        (20.0, 20.0),
        (20.0, 40.0),
        (60.0, 40.0),
        (60.0, 60.0),
        (0.0, 60.0),
    ]


def test_seam_clamp_adds_only_gap_minus_five() -> None:
    ring = square()
    # neighbour starts at x=108 → gap 8px → budget 3px
    neigh = [(108.0, 0.0), (200.0, 0.0), (200.0, 100.0), (108.0, 100.0)]
    stroke = [(100.0, 40.0), (120.0, 55.0), (100.0, 80.0)]
    ex = pg.extract_excursion(stroke, ring)
    if ex is None:
        fail("seam stroke should extract")
    grown = pg.grow_mid(ex["mid"], ring, [neigh], gap=5.0)
    peak = max(p[0] for p in grown)
    if peak > 103.2:
        fail("grew past 5px floor, peak x=%s" % peak)
    if peak < 102.5:
        fail("should use the 3px budget, peak x=%s" % peak)


def test_seam_at_five_adds_zero() -> None:
    ring = square()
    neigh = [(105.0, 0.0), (200.0, 0.0), (200.0, 100.0), (105.0, 100.0)]
    stroke = [(100.0, 40.0), (120.0, 55.0), (100.0, 80.0)]
    ex = pg.extract_excursion(stroke, ring)
    grown = pg.grow_mid(ex["mid"], ring, [neigh], gap=5.0)
    peak = max(p[0] for p in grown)
    if peak > 100.6:
        fail("gap already 5, must add 0, peak x=%s" % peak)


def test_void_outward_adds_zero() -> None:
    ring = square()
    stroke = [(100.0, 40.0), (130.0, 55.0), (100.0, 80.0)]
    ex = pg.extract_excursion(stroke, ring)
    grown = pg.grow_mid(ex["mid"], ring, [], gap=5.0)
    peak = max(p[0] for p in grown)
    if peak > 100.6:
        fail("void peninsula must not add land, peak x=%s" % peak)


def test_bay_keeps_drawn_fill() -> None:
    ring = u_ring()
    # close the C mouth with a slight chord in the pocket
    stroke = [(60.0, 20.0), (40.0, 30.0), (60.0, 40.0)]
    ex = pg.extract_excursion(stroke, ring)
    if ex is None:
        fail("bay stroke should extract")
    grown = pg.grow_mid(ex["mid"], ring, [], gap=5.0)
    xs = [p[0] for p in grown]
    if min(xs) > 45:
        fail("bay fill should keep the drawn pocket, xs=%s" % xs)


def test_assemble_keeps_the_large_body() -> None:
    ring = square()
    stroke = [(100.0, 40.0), (103.0, 55.0), (100.0, 80.0)]
    ex = pg.extract_excursion(stroke, ring)
    grown = pg.grow_mid(ex["mid"], ring, [], gap=5.0)
    new_ring = pg.assemble_ring(ring, ex["S"], ex["E"], grown)
    if new_ring is None:
        fail("assemble returned None")
    a0 = abs(pg.signed_area(ring))
    a1 = abs(pg.signed_area(new_ring))
    if a1 < a0 * 0.5:
        fail("assembled the ear instead of the body: %s vs %s" % (a1, a0))


def test_quadratic_hits_handle() -> None:
    s, y, e = (0.0, 0.0), (10.0, 20.0), (20.0, 0.0)
    pts = pg.quadratic(s, y, e, 20)
    if not close(pts[0], s) or not close(pts[-1], e):
        fail("quad ends")
    mid = pts[len(pts) // 2]
    if abs(mid[1] - 10.0) > 2:
        fail("quad mid height %s" % (mid,))


def test_deform_pair_transfers_area() -> None:
    a = square()
    b = [(108.0, 0.0), (200.0, 0.0), (200.0, 100.0), (108.0, 100.0)]
    s, e = (100.0, 30.0), (100.0, 70.0)
    yellow = (115.0, 50.0)
    a2, b2 = pg.deform_pair(a, b, s, e, yellow, gap=5.0)
    if a2 is None or b2 is None:
        fail("deform_pair None")
    da = abs(pg.signed_area(a2)) - abs(pg.signed_area(a))
    db = abs(pg.signed_area(b2)) - abs(pg.signed_area(b))
    if da <= 5:
        fail("A should grow, da=%s" % da)
    if db >= -5:
        fail("B should shrink, db=%s" % db)
    min_d = 1e9
    for p in a2:
        if math.hypot(p[0] - s[0], p[1] - s[1]) < 8:
            continue
        if math.hypot(p[0] - e[0], p[1] - e[1]) < 8:
            continue
        q, _, _, d = pg.closest_on_ring(p, b2)
        if d < min_d:
            min_d = d
    if min_d < 4.0:
        fail("gap collapsed to %s" % min_d)


def test_deform_pair_deep_handle_keeps_body() -> None:
    a = square()
    b = [(108.0, 0.0), (200.0, 0.0), (200.0, 100.0), (108.0, 100.0)]
    s, e = (100.0, 30.0), (100.0, 70.0)
    yellow = (170.0, 50.0)
    a2, b2 = pg.deform_pair(a, b, s, e, yellow, gap=5.0)
    if a2 is None or b2 is None:
        fail("deform_pair None")
    a0, b0 = abs(pg.signed_area(a)), abs(pg.signed_area(b))
    if abs(pg.signed_area(a2)) < a0 * 0.5:
        fail("A collapsed: %s vs %s" % (abs(pg.signed_area(a2)), a0))
    if not pg.point_in_ring((20.0, 50.0), a2):
        fail("A lost its body")
    if not pg.point_in_ring((190.0, 50.0), b2):
        fail("B lost its far side")


def test_deform_pair_keeps_gap_at_nose() -> None:
    a = [
        (180.0, 300.0),
        (198.0, 328.0),
        (200.2, 329.2),
        (201.0, 334.0),
        (220.0, 360.0),
        (180.0, 360.0),
    ]
    b = [
        (203.1, 328.3),
        (240.0, 330.0),
        (240.0, 380.0),
        (205.0, 380.0),
        (204.0, 340.0),
    ]
    s, e = (198.0, 328.0), (201.0, 334.0)
    yellow = (206.0, 328.0)
    walk = [s, (200.2, 329.2), e]
    a2, b2 = pg.deform_pair(a, b, s, e, yellow, gap=5.0, walk_a=walk)
    if a2 is None or b2 is None:
        fail("deform_pair None")
    min_d = 1e9
    for p in a2:
        _, _, _, d = pg.closest_on_ring(p, b2)
        if d < min_d:
            min_d = d
    # interior of the pulled span must hold 5px; the pinned ends may stay tight
    interior = [
        p
        for p in a2
        if math.hypot(p[0] - s[0], p[1] - s[1]) > 8
        and math.hypot(p[0] - e[0], p[1] - e[1]) > 8
    ]
    min_d = 1e9
    for p in interior or a2:
        _, _, _, d = pg.closest_on_ring(p, b2)
        if d < min_d:
            min_d = d
    if min_d < 4.5:
        fail("nose collapsed gap to %s" % min_d)


def test_midline_interior_gap_is_five() -> None:
    a = square()
    b = [(108.0, 0.0), (200.0, 0.0), (200.0, 100.0), (108.0, 100.0)]
    s, e = (100.0, 30.0), (100.0, 70.0)
    yellow = (115.0, 50.0)
    a2, b2 = pg.deform_pair(a, b, s, e, yellow, gap=5.0)
    if a2 is None or b2 is None:
        fail("deform_pair None")
    mid = None
    for p in a2:
        if abs(p[1] - 50.0) < 1.5:
            mid = p
            break
    if mid is None:
        fail("no A point at y~50")
    _, _, _, d = pg.closest_on_ring(mid, b2)
    if d < 4.5 or d > 6.5:
        fail("interior gap %s, want ~5" % d)


def _facing_len(ring: list, s: tuple, e: tuple) -> float:
    walk = pg.walk_short(ring, s, e)
    return sum(
        math.hypot(walk[i][0] - walk[i - 1][0], walk[i][1] - walk[i - 1][1])
        for i in range(1, len(walk))
    )


def test_yellow_on_chord_is_shortest() -> None:
    a = square()
    b = [(108.0, 0.0), (200.0, 0.0), (200.0, 100.0), (108.0, 100.0)]
    s, e = (100.0, 30.0), (100.0, 70.0)
    a_out, b_out = pg.deform_pair(a, b, s, e, (120.0, 50.0), gap=5.0)
    if a_out is None:
        fail("pull None")
    if _facing_len(a_out, s, e) < 45:
        fail("expected longer bulge, got %s" % _facing_len(a_out, s, e))
    a_flat, _ = pg.deform_pair(a_out, b_out, s, e, (100.0, 50.0), gap=5.0)
    if a_flat is None:
        fail("flatten None")
    flat_len = _facing_len(a_flat, s, e)
    if flat_len > 44:
        fail("yellow on chord should shorten, len=%s" % flat_len)


def main() -> None:
    test_inside_tails_are_dropped()
    test_substrate_tails_are_dropped()
    test_start_on_border_no_inside_tail()
    test_two_exits_are_noop()
    test_mid_graze_is_noop()
    test_all_inside_is_noop()
    test_never_returns_is_noop()
    test_seam_clamp_adds_only_gap_minus_five()
    test_seam_at_five_adds_zero()
    test_void_outward_adds_zero()
    test_bay_keeps_drawn_fill()
    test_assemble_keeps_the_large_body()
    test_quadratic_hits_handle()
    test_deform_pair_transfers_area()
    test_deform_pair_deep_handle_keeps_body()
    test_deform_pair_keeps_gap_at_nose()
    test_midline_interior_gap_is_five()
    test_yellow_on_chord_is_shortest()
    print("OK pen_geom excursion + grow + deform")


if __name__ == "__main__":
    main()
