#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Tests for shorter-end normal, gap strip, no extra area, Chaikin clamp."""
from __future__ import annotations

import math
import sys
from pathlib import Path

from shapely.geometry import Point, Polygon

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import pair_geom as pg  # noqa: E402


def fail(msg: str) -> None:
    print("FAIL", msg)
    raise SystemExit(1)


def test_project_shorter_onto_longer() -> None:
    # A short top edge, B long bottom edge — like Privolzhsky vs Syzransky
    short = [(0.0, 10.0), (10.0, 10.0)]
    long_ = [(-5.0, 6.0), (0.0, 6.0), (10.0, 6.0), (20.0, 6.0)]
    a, b = pg.project_shorter_ends(short, long_)
    # feet of normals from (0,10) and (10,10) onto y=6
    if abs(b[0][0] - 0.0) > 0.2 or abs(b[0][1] - 6.0) > 0.2:
        fail("left foot %s" % (b[0],))
    if abs(b[-1][0] - 10.0) > 0.2 or abs(b[-1][1] - 6.0) > 0.2:
        fail("right foot %s" % (b[-1],))
    if len(a) != 2:
        fail("short chain mutated")


def test_strip_is_only_the_gap() -> None:
    a = Polygon([(0, 8), (20, 8), (20, 20), (0, 20)])
    b = Polygon([(0, 0), (20, 0), (20, 4), (0, 4)])
    strip = pg.strip_from_polys(a, b)
    if strip.is_empty:
        fail("empty strip")
    # gap is y=4..8
    if not strip.contains(Point(10, 6)):
        fail("strip missed the gap")
    if strip.contains(Point(10, 12)):
        fail("strip ate district A")
    if strip.contains(Point(10, 2)):
        fail("strip ate district B")
    if strip.contains(Point(30, 6)):
        fail("strip grew extra to the side")


def test_user_privolzhsky_syzransky_points() -> None:
    """Real SVG: (206,399) on Privolzhsky, foot ~ Syzransky; (112,468) reverse."""
    svg = (ROOT / "prototype" / "map-osm-fills.svg").read_text(encoding="utf-8")
    import re

    def poly(name: str) -> Polygon:
        m = re.search(
            rf'data-name="{re.escape(name)}"[^>]*d="([^"]+)"|'
            rf'd="([^"]+)"[^>]*data-name="{re.escape(name)}"',
            svg,
        )
        if not m:
            fail("missing " + name)
        d = m.group(1) or m.group(2)
        return pg.rings_to_polygon(pg.parse_d(d))

    # attr order in file is d= fill= data-region= data-name=
    def poly2(name: str) -> Polygon:
        m = re.search(
            rf'<path d="([^"]+)" fill="[^"]+" data-region="[^"]+" data-name="{re.escape(name)}"',
            svg,
        )
        if not m:
            fail("missing " + name)
        return pg.rings_to_polygon(pg.parse_d(m.group(1)))

    a = poly2("Приволжский район")
    b = poly2("Сызранский район")
    if Point(206, 399).distance(a) > 2:
        fail("206,399 should sit on Privolzhsky, d=%s" % Point(206, 399).distance(a))
    if Point(112, 468).distance(b) > 2:
        fail("112,468 should sit on Syzransky, d=%s" % Point(112, 468).distance(b))
    fa = pg.facing_run(list(a.exterior.coords), b)
    fb = pg.facing_run(list(b.exterior.coords), a)
    if len(fa) < 10 or len(fb) < 10:
        fail("facing runs too short %s %s" % (len(fa), len(fb)))
    seams = pg.pair_end_seams(fa, fb)
    if len(seams) != 2:
        fail("need two end seams")
    # one seam near (206,399)→(207,396), one near (112,468)→(116,467)
    def near(p, q, lim=8.0) -> bool:
        return math.hypot(p[0] - q[0], p[1] - q[1]) <= lim

    hits_ne = hits_sw = False
    for pa, pb in seams:
        if near(pa, (206, 399)) or near(pb, (207, 396)):
            hits_ne = True
        if near(pa, (116, 467)) or near(pb, (112, 468)):
            hits_sw = True
    if not hits_ne:
        fail("NE seam missing, got %s" % (seams,))
    if not hits_sw:
        fail("SW seam missing, got %s" % (seams,))
    strip = pg.gap_strip(fa, fb)
    if strip.is_empty:
        fail("empty real strip")
    p = Point(206.5, 397.5)
    if p.distance(strip) > 4:
        fail("north end of user stitch not in strip, d=%s" % p.distance(strip))
    q = Point(114, 467.5)
    if q.distance(strip) > 4:
        fail("south-west end not in strip, d=%s" % q.distance(strip))
    extra_a = pg.gained_outside(
        a, a.union(strip.intersection(a.buffer(0))), pg.allowed_gap(a, b)
    )
    if extra_a > 1:
        fail("union with strip grew outside gap: %s" % extra_a)


def test_chaikin_no_extra_outside_gap() -> None:
    a = Polygon([(0, 8), (4, 9), (8, 8), (12, 9), (16, 8), (16, 18), (0, 18)])
    b = Polygon([(0, 0), (16, 0), (16, 4), (12, 3), (8, 4), (4, 3), (0, 4)])
    na, nb, info = pg.smooth_facing_pair(a, b, iters=1)
    if not info["ok"]:
        fail("facing not found")
    if info["extra_a"] > 0.5:
        fail("A grew outside gap %s" % info["extra_a"])
    if info["extra_b"] > 0.5:
        fail("B grew outside gap %s" % info["extra_b"])
    if na.intersects(nb) and na.intersection(nb).area > 0.2:
        fail("smoothed pair overlaps")


def test_stitch_keeps_far_vertices() -> None:
    """Union sews at the seam; the far coast of A is not resampled."""
    a = Polygon([(0, 8), (20, 8), (20, 30), (0, 30)])
    b = Polygon([(0, 0), (20, 0), (20, 4), (0, 4)])
    u, info = pg.stitch_polygons(a, b)
    if not info["ok"]:
        fail("stitch failed")
    # top-left of A must survive
    ext = list(u.exterior.coords)
    if min(_d2(p, (0, 30)) for p in ext) > 0.01:
        fail("far vertex of A was rewritten")
    if not u.contains(Point(10, 6)):
        fail("gap not inside union")
    if info["extra"] > 0.5:
        fail("stitch extra area %s" % info["extra"])


def _d2(p, q):
    return (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2


def test_real_syzran_privolzhsky_stitch() -> None:
    svg = (ROOT / "prototype" / "map-osm-fills.svg").read_text(encoding="utf-8")
    import re

    def poly2(name: str) -> Polygon:
        m = re.search(
            rf'<path d="([^"]+)" fill="[^"]+" data-region="[^"]+" data-name="{re.escape(name)}"',
            svg,
        )
        if not m:
            fail("missing " + name)
        return pg.rings_to_polygon(pg.parse_d(m.group(1)))

    a = poly2("Приволжский район")
    b = poly2("Сызранский район")
    west = min(b.exterior.coords, key=lambda p: p[0])
    u, info = pg.stitch_polygons(a, b)
    if not info["ok"]:
        fail("real stitch failed %s" % info)
    ext = list(u.exterior.coords)
    if min(_d2(p, west) for p in ext) > 0.25:
        fail("Syzransky west coast vertex lost: %s" % (west,))
    if info["extra"] > 25:
        fail("real stitch extra %s" % info["extra"])
    if not u.contains(a.representative_point()) or not u.contains(b.representative_point()):
        fail("union missed a body")


def test_krasnoyarsky_sergievsky_reaches_498() -> None:
    """Local 5.1px wobble must not cut the seam at 465,295; end is 498,303."""
    svg = (ROOT / "prototype" / "map-osm-fills.svg").read_text(encoding="utf-8")
    import re

    def poly2(name: str) -> Polygon:
        m = re.search(
            rf'<path d="([^"]+)" fill="[^"]+" data-region="[^"]+" data-name="{re.escape(name)}"',
            svg,
        )
        if not m:
            fail("missing " + name)
        return pg.rings_to_polygon(pg.parse_d(m.group(1)))

    a = poly2("Красноярский район")
    b = poly2("Сергиевский район")
    fa = pg.facing_run(list(a.exterior.coords), b)
    if not fa:
        fail("no facing run")
    d498 = min(math.hypot(p[0] - 498, p[1] - 303) for p in (fa[0], fa[-1]))
    if d498 > 6:
        fail("seam ended far from 498,303: ends %s %s d=%s" % (fa[0], fa[-1], d498))
    seams = pg.pair_end_seams(
        fa, pg.facing_run(list(b.exterior.coords), a)
    )
    d_seam = min(
        min(math.hypot(pa[0] - 498, pa[1] - 303), math.hypot(pb[0] - 498, pb[1] - 303))
        for pa, pb in seams
    )
    if d_seam > 6:
        fail("end-normal far from 498,303: %s" % (seams,))


def test_close_flag_gaps_bridges_wobble() -> None:
    flags = [True] * 10 + [False] * 4 + [True] * 8 + [False] * 20
    out = pg.close_flag_gaps(flags, max_gap=8)
    if not all(out[:22]):
        fail("4-false wobble should be filled")
    if any(out[22:]):
        fail("long false tail should stay empty")


def test_kinel_cherkassky_full_seam() -> None:
    """Kinel side has a 24-pt 5.05px wobble; seam must reach the south-east end."""
    svg = (ROOT / "prototype" / "map-osm-fills.svg").read_text(encoding="utf-8")
    import re

    def poly2(name: str) -> Polygon:
        m = re.search(
            rf'<path d="([^"]+)" fill="[^"]+" data-region="[^"]+" data-name="{re.escape(name)}"',
            svg,
        )
        if not m:
            fail("missing " + name)
        return pg.rings_to_polygon(pg.parse_d(m.group(1)))

    a = poly2("Кинель-Черкасский район")
    b = poly2("Кинельский район")
    fa = pg.facing_run(list(a.exterior.coords), b)
    fb = pg.facing_run(list(b.exterior.coords), a)
    if not fa or not fb:
        fail("no facing")
    # south-east land end ~ 549,414 / 548,418 — must not stop at 530,392
    def end_near(run, x, y, lim=12.0) -> bool:
        return min(math.hypot(p[0] - x, p[1] - y) for p in (run[0], run[-1])) <= lim

    if not end_near(fa, 549, 414):
        fail("Cherkassky seam short: %s %s" % (fa[0], fa[-1]))
    if not end_near(fb, 548, 418):
        fail("Kinel seam short (cut at 5.05px wobble): %s %s" % (fb[0], fb[-1]))
    seams = pg.pair_end_seams(fa, fb)
    se = min(
        min(math.hypot(pa[0] - 549, pa[1] - 414), math.hypot(pb[0] - 548, pb[1] - 418))
        for pa, pb in seams
    )
    if se > 12:
        fail("end-normal missed SE: %s" % (seams,))


def test_all_neighbor_strips_cover_gap() -> None:
    """Every land-neighbour pair gets at least one strip; extra stays in the gutter."""
    svg = (ROOT / "prototype" / "map-osm-fills.svg").read_text(encoding="utf-8")
    import re

    rows = []
    for m in re.finditer(
        r'<path d="([^"]+)" fill="[^"]+" data-region="[^"]+" data-name="([^"]+)"',
        svg,
    ):
        rows.append((m.group(2), pg.rings_to_polygon(pg.parse_d(m.group(1)))))
    missing = []
    extra_bad = []
    for i, (na, a) in enumerate(rows):
        for nb, b in rows[i + 1 :]:
            if a.distance(b) > 6:
                continue
            strips = pg.all_strips(a, b)
            if not strips:
                missing.append(na + " × " + nb)
                continue
            u, info = pg.stitch_polygons(a, b)
            if info.get("extra", 0) > 40:
                extra_bad.append("%s extra=%.1f" % (na + " × " + nb, info["extra"]))
    if missing:
        fail("no strip: " + "; ".join(missing[:8]))
    if extra_bad:
        fail("extra land: " + "; ".join(extra_bad[:8]))


def test_wide_water_not_a_face() -> None:
    a = Polygon([(0, 0), (10, 0), (10, 10), (0, 10)])
    b = Polygon([(30, 0), (40, 0), (40, 10), (30, 10)])  # 20px water
    fa = pg.facing_run(list(a.exterior.coords), b, max_d=pg.FACE_MAX)
    if fa:
        fail("water face captured: %s" % fa)


def main() -> int:
    tests = [
        test_project_shorter_onto_longer,
        test_strip_is_only_the_gap,
        test_user_privolzhsky_syzransky_points,
        test_chaikin_no_extra_outside_gap,
        test_stitch_keeps_far_vertices,
        test_real_syzran_privolzhsky_stitch,
        test_krasnoyarsky_sergievsky_reaches_498,
        test_close_flag_gaps_bridges_wobble,
        test_kinel_cherkassky_full_seam,
        test_all_neighbor_strips_cover_gap,
        test_wide_water_not_a_face,
    ]
    for fn in tests:
        fn()
        print("ok", fn.__name__)
    print("OK", len(tests))
    return 0


if __name__ == "__main__":
    sys.exit(main())
