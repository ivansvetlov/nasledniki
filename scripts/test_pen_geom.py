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


def main() -> None:
    test_inside_tails_are_dropped()
    test_substrate_tails_are_dropped()
    test_start_on_border_no_inside_tail()
    test_two_exits_are_noop()
    test_mid_graze_is_noop()
    test_all_inside_is_noop()
    test_never_returns_is_noop()
    print("OK pen_geom excursion")


if __name__ == "__main__":
    main()
