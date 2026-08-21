#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""make-svg-osm.py — районы Самарской области из OSM → SVG заливок.

Вход:  reference/samara-districts.geojson
Выход: prototype/map-osm-fills.svg

Только муниципальные районы (как зоны на 0-original.jpg).
Городские округа вливаются в родительский район — не отдельные пятна.
Без подписей и точек городов. Без stroke: щель = подложка.
"""
from __future__ import annotations

import json
import sys
import urllib.request
from pathlib import Path

from pyproj import Transformer
from shapely.geometry import MultiPolygon, Polygon, shape
from shapely.ops import transform as shp_transform
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "reference" / "samara-districts.overpass.json"
GEOJSON = ROOT / "reference" / "samara-districts.geojson"
OUT = ROOT / "prototype" / "map-osm-fills.svg"

# 37 relation id admin_level=6 внутри RU-SAM (проверено Overpass tags)
OSM_RELS = [
    1244855, 1345137, 1338384, 1338382, 1338342, 1337718, 1340132, 1340131,
    1338392, 1337713, 309111, 1338383, 1337712, 1338521, 1253410, 1270388,
    1337717, 1338341, 1332843, 1245501, 1338531, 1340540, 1340153, 1252015,
    1338522, 1338520, 1340154, 1345138, 1345144, 1263373, 1345146, 1345145,
    1345142, 287507, 1345143, 1345135, 1345136,
]
NOMINATIM = "https://nominatim.openstreetmap.org/lookup"

# UTM zone 39N — Самара ~50°E 53°N
TO_M = Transformer.from_crs("EPSG:4326", "EPSG:32639", always_xy=True)
TO_LL = Transformer.from_crs("EPSG:32639", "EPSG:4326", always_xy=True)

PALETTE = [
    "#EAD9BC", "#DDE3C8", "#F0DFB8", "#D7E0CF", "#EFDCC9",
    "#E3E0CC", "#EDD8C0", "#DBE2C9", "#F2E0C0", "#D9E1CE",
]
BG = "#F2E8D5"
PAD = 28
# щель как у эталона: каждый полигон чуть сжать внутрь
GAP_M = 700
SIMPLIFY_M = 400
# осколки меньше этого (м²) после слияния выкидываем
MIN_PART_M2 = 20_000_000
SVG_W = 720


def fetch_geojson() -> dict:
    if GEOJSON.exists() and GEOJSON.stat().st_size > 1000:
        print(f"кэш: {GEOJSON} ({GEOJSON.stat().st_size} bytes)")
        return json.loads(GEOJSON.read_text(encoding="utf-8"))
    ids = ",".join(f"R{i}" for i in OSM_RELS)
    url = f"{NOMINATIM}?osm_ids={ids}&format=geojson&polygon_geojson=1"
    print("Nominatim lookup…")
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "nasedniki-expeditions/1.0 (map prototype)"},
    )
    with urllib.request.urlopen(req, timeout=120) as r:
        raw = r.read()
    GEOJSON.write_bytes(raw)
    print(f"скачано {len(raw)} bytes → {GEOJSON}")
    return json.loads(raw)


def feature_name(props: dict) -> str:
    if props.get("name"):
        return str(props["name"])
    tags = props.get("tags") or {}
    if tags.get("name:ru") or tags.get("name"):
        return tags.get("name:ru") or tags["name"]
    display = props.get("display_name") or ""
    return display.split(",")[0].strip() or "без имени"


def to_meters(geom):
    return shp_transform(lambda x, y, z=None: TO_M.transform(x, y), geom)


def load_features(gj: dict) -> list[dict]:
    feats = []
    for f in gj.get("features", []):
        props = f.get("properties") or {}
        name = feature_name(props)
        geom = shape(f["geometry"])
        if geom.is_empty:
            continue
        if not geom.is_valid:
            geom = geom.buffer(0)
        feats.append({"name": name, "geom": geom})
    print(f"features: {len(feats)}")
    return feats


def is_okrug(name: str) -> bool:
    n = name.lower()
    return "городск" in n or n.startswith("го ")


def is_district(name: str) -> bool:
    return "район" in name.lower() and not is_okrug(name)


def keep_large_parts(geom, min_area: float):
    """Убрать мелкие острова; дырки городов закрыть (только внешний контур)."""
    if geom.is_empty:
        return geom
    polys = list(geom.geoms) if isinstance(geom, MultiPolygon) else [geom]
    kept = []
    for p in polys:
        if p.geom_type != "Polygon" or p.is_empty:
            continue
        if p.area < min_area:
            continue
        kept.append(Polygon(p.exterior))
    if not kept:
        return geom
    return unary_union(kept)


def merge_okrugs_into_districts(feats: list[dict]) -> list[dict]:
    """Городские округа в атласе — точки внутри района, не отдельные зоны."""
    districts = [f for f in feats if is_district(f["name"])]
    okrugs = [f for f in feats if is_okrug(f["name"])]
    other = [f for f in feats if f not in districts and f not in okrugs]
    print(f"районов={len(districts)} округов={len(okrugs)} прочих={len(other)}")
    if other:
        for o in other:
            print(f"  прочее: {o['name']}")

    assigned = {id(d): [d["geom"]] for d in districts}
    for o in okrugs:
        best = None
        best_key = None
        for d in districts:
            inter = d["geom"].buffer(80).intersection(o["geom"].buffer(80)).area
            dist = d["geom"].distance(o["geom"])
            key = (dist, -inter)
            if best_key is None or key < best_key:
                best_key, best = key, d
        if best is None:
            print(f"  некуда деть: {o['name']}")
            continue
        assigned[id(best)].append(o["geom"])
        print(f"  {o['name']} → {best['name']}")

    merged = []
    for d in districts:
        g = unary_union(assigned[id(d)])
        if not g.is_valid:
            g = g.buffer(0)
        merged.append({"name": d["name"], "geom": g})
    return merged


def ring_to_d(coords, sx, sy, minx, maxy) -> str:
    pts = []
    for x, y in coords:
        px = (x - minx) * sx + PAD
        py = (maxy - y) * sy + PAD
        pts.append((round(px, 1), round(py, 1)))
    if len(pts) < 3:
        return ""
    d = [f"M{pts[0][0]},{pts[0][1]}"]
    d += [f"L{x},{y}" for x, y in pts[1:]]
    d.append("Z")
    return " ".join(d)


def geom_to_d(geom, sx, sy, minx, maxy) -> str:
    parts = []
    geoms = list(geom.geoms) if geom.geom_type == "MultiPolygon" else [geom]
    for g in geoms:
        if g.is_empty or g.geom_type != "Polygon":
            continue
        ext = ring_to_d(g.exterior.coords, sx, sy, minx, maxy)
        if ext:
            parts.append(ext)
        for hole in g.interiors:
            hd = ring_to_d(hole.coords, sx, sy, minx, maxy)
            if hd:
                parts.append(hd)
    return " ".join(parts)


def main() -> int:
    data = fetch_geojson()
    feats = load_features(data)
    if not feats:
        print("нет полигонов")
        return 1

    projected = []
    for f in feats:
        g = to_meters(f["geom"])
        if not g.is_valid:
            g = g.buffer(0)
        projected.append({"name": f["name"], "geom": g})

    feats = merge_okrugs_into_districts(projected)

    prepared = []
    for f in feats:
        g = keep_large_parts(f["geom"], MIN_PART_M2)
        if SIMPLIFY_M > 0:
            g = g.simplify(SIMPLIFY_M, preserve_topology=True)
        if GAP_M > 0:
            shrunk = g.buffer(-GAP_M)
            if not shrunk.is_empty:
                g = shrunk
        g = keep_large_parts(g, MIN_PART_M2)
        if g.is_empty:
            print(f"  skip empty after buffer: {f['name']}")
            continue
        prepared.append({"name": f["name"], "geom": g, "area": g.area})
    prepared.sort(key=lambda x: -x["area"])
    print(f"районов в SVG: {len(prepared)}")

    minx = min(p["geom"].bounds[0] for p in prepared)
    miny = min(p["geom"].bounds[1] for p in prepared)
    maxx = max(p["geom"].bounds[2] for p in prepared)
    maxy = max(p["geom"].bounds[3] for p in prepared)
    width_m = maxx - minx
    height_m = maxy - miny
    sx = SVG_W / width_m
    svg_h = SVG_W * (height_m / width_m)
    sy = svg_h / height_m
    W = int(SVG_W + 2 * PAD)
    H = int(svg_h + 2 * PAD)

    paths = []
    for i, p in enumerate(prepared):
        d = geom_to_d(p["geom"], sx, sy, minx, maxy)
        if not d:
            continue
        color = PALETTE[i % len(PALETTE)]
        name = (
            p["name"]
            .replace("&", "&amp;")
            .replace('"', "&quot;")
            .replace("<", "&lt;")
        )
        paths.append(
            f'<path d="{d}" fill="{color}" data-region="r{i}" data-name="{name}"/>'
        )
        print(f"  r{i:02d} {p['name']}")

    svg = (
        f'<?xml version="1.0" encoding="UTF-8"?>\n'
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" '
        f'viewBox="0 0 {W} {H}">\n'
        f'  <rect width="{W}" height="{H}" fill="{BG}"/>\n'
        f'  <g id="regions">\n'
        + "\n".join(paths)
        + "\n  </g>\n</svg>\n"
    )
    OUT.write_text(svg, encoding="utf-8")
    print(f"OK: {OUT} · {len(paths)} path · stroke=False")
    return 0


if __name__ == "__main__":
    sys.exit(main())
