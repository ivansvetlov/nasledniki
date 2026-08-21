#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Mild coordinated Chaikin on Syzransky and the three land neighbours.

Writes prototype/map-osm-fills.svg. Growth only inside the pair-gap strip.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import pair_geom as pg

SVG = ROOT / "prototype" / "map-osm-fills.svg"
CENTER = "Сызранский район"
NEIGHBORS = [
    "Шигонский район",
    "Приволжский район",
    "Ставропольский район",
]


def load_paths(text: str) -> list[dict]:
    rows = []
    for m in re.finditer(r"<path\b([^>]*)/?>", text):
        attrs = m.group(1)
        name = re.search(r'data-name="([^"]*)"', attrs)
        d = re.search(r'd="([^"]*)"', attrs)
        fill = re.search(r'fill="([^"]*)"', attrs)
        region = re.search(r'data-region="([^"]*)"', attrs)
        rows.append(
            {
                "name": name.group(1) if name else "",
                "d": d.group(1) if d else "",
                "fill": fill.group(1) if fill else "#ccc",
                "region": region.group(1) if region else "",
                "span": m.span(),
            }
        )
    return rows


def main() -> int:
    text = SVG.read_text(encoding="utf-8")
    rows = load_paths(text)
    by = {r["name"]: r for r in rows}
    if CENTER not in by:
        print("no", CENTER)
        return 1
    polys = {
        r["name"]: pg.rings_to_polygon(pg.parse_d(r["d"]))
        for r in rows
        if r["name"] and r["d"]
    }
    old = {n: polys[n] for n in [CENTER, *NEIGHBORS] if n in polys}
    for nb in NEIGHBORS:
        if nb not in polys:
            print("skip missing", nb)
            continue
        a, b, info = pg.smooth_facing_pair(polys[CENTER], polys[nb], iters=1)
        print(
            f"{CENTER} × {nb}: run {info['a_run']}/{info['b_run']} "
            f"extra {info.get('extra_a', 0):.2f}/{info.get('extra_b', 0):.2f} px²"
        )
        if info.get("extra_a", 0) > 1 or info.get("extra_b", 0) > 1:
            print("  REJECT extra area")
            continue
        if not info["ok"]:
            print("  no facing run")
            continue
        polys[CENTER] = a
        polys[nb] = b

    for n, g in old.items():
        ng = polys[n]
        print(
            f"  area {n.replace(' район','')}: {g.area:.1f} → {ng.area:.1f} "
            f"Δ{ng.area - g.area:+.1f}"
        )

    # rewrite d= for updated names
    out = text
    for r in reversed(rows):
        n = r["name"]
        if n not in old:
            continue
        new_d = pg.poly_to_d(polys[n])
        if not new_d:
            continue
        s, e = r["span"]
        chunk = text[s:e]
        chunk2 = re.sub(r'd="[^"]*"', f'd="{new_d}"', chunk, count=1)
        out = out[:s] + chunk2 + out[e:]
    SVG.write_text(out, encoding="utf-8")
    print("wrote", SVG)
    return 0


if __name__ == "__main__":
    sys.exit(main())
