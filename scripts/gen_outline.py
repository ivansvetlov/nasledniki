# -*- coding: utf-8 -*-
r"""Build the exact outer union boundary of all Samara districts in the 3D
terrain's world space (a single closed outline for the "plate").

Plan: project every district to UTM metres, unary_union them, keep the largest
exterior ring, then map metres -> world x,z in [-128,128] via the same affine
frame used by the heightmap/districts generators.

Output: prototype\demo3d\three\public\outline_world.json (r'' docstring avoided)
"""
from __future__ import annotations
import sys, json
import numpy as np

sys.path.insert(0, "scripts")
import map_catalog as cat
from shapely.ops import unary_union

cat.set_maps_root(r"accounts\01601a7495be1aed\maps")
gj = json.loads(
    open(
        r"accounts\01601a7495be1aed\maps\samara\districts.geojson",
        encoding="utf-8",
    ).read()
)
feats = cat.load_gj_features(gj)
frame = cat.land_svg_frame(feats, 50.2, 53.2)
epsg = frame["epsg"]
print("epsg", epsg)

proj = []
for f in feats:
    g = cat.to_meters(f["geom"], epsg)
    if not g.is_valid:
        g = g.buffer(0)
    proj.append(g)

union = unary_union(proj)
print("union type:", union.geom_type, "area_m2:", round(union.area))

if union.geom_type == "Polygon":
    big = union
elif union.geom_type == "MultiPolygon":
    big = max(union.geoms, key=lambda g: g.area)
else:
    raise RuntimeError("unexpected union type: %s" % union.geom_type)

ring = big.exterior
print("exterior ring points:", len(ring.coords))
if big.interiors:
    print("interior holes:", [len(r.coords) for r in big.interiors])

W, H = frame["W"], frame["H"]


def m_to_world(mx, my):
    px = (mx - frame["minx"]) * frame["sx"]
    py = (frame["maxy"] - my) * frame["sy"]
    u, v = px / W, py / H
    return (u - 0.5) * 256.0, (v - 0.5) * 256.0


pts = [m_to_world(x, y) for x, y in ring.coords]
xs = [p[0] for p in pts]
zs = [p[1] for p in pts]
print(
    "world bounds x[%.1f..%.1f] z[%.1f..%.1f]"
    % (min(xs), max(xs), min(zs), max(zs))
)

out = {"type": "outline", "rings": [{"ext": pts}]}
dest = r"prototype\demo3d\three\public\outline_world.json"
json.dump(out, open(dest, "w", encoding="utf-8"), ensure_ascii=False)
print("saved", dest)
