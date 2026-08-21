"""Fetch polygonal banks (riverbed) of the Volga for the Samara frame bbox from OSM.

Read-only probe: tiles the bbox, pulls natural=water+water=river ways per tile from
Overpass (falling over endpoints), unions and clips to the frame, writes GeoJSON.
"""
from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

from shapely.geometry import Polygon, box, mapping
from shapely.ops import unary_union

UA = "nasedniki-maps/1.0 (local editor; osm attribution)"
OVERPASS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.openstreetmap.ru/cgi/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]

BBOX = (51.77, 47.93, 54.68, 52.57)  # s, w, n, e (Samara frame)
TILE_DEG = 0.35
TILE_TIMEOUT = 55
OUT_PATH = r"C:\Users\MiBookPro\AppData\Local\Temp\opencode\volga_river_polygon.json"


def tiles(s, w, n, e, max_deg=TILE_DEG):
    lat = s
    while lat < n - 1e-12:
        nlat = min(lat + max_deg, n)
        lon = w
        while lon < e - 1e-12:
            nlon = min(lon + max_deg, e)
            yield lat, lon, nlat, nlon
            lon = nlon
        lat = nlat


def _http(url, data, timeout):
    req = urllib.request.Request(
        url,
        data=data,
        headers={"User-Agent": UA, "Accept": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def overpass_ways(s, w, n, e):
    ql = (
        f'[out:json][timeout:{TILE_TIMEOUT}];'
        f'way["natural"="water"]["water"="river"]({s},{w},{n},{e});'
        "out tags geom;"
    )
    body = urllib.parse.urlencode({"data": ql}).encode()
    last = None
    for ep in OVERPASS:
        try:
            raw = _http(ep, body, timeout=TILE_TIMEOUT)
            return json.loads(raw).get("elements") or []
        except (urllib.error.HTTPError, urllib.error.URLError,
                TimeoutError, json.JSONDecodeError, OSError) as exc:
            last = exc
            continue
    print(f"    tile ({s:.2f},{w:.2f})-({n:.2f},{e:.2f}) all endpoints failed: {last!r}",
          flush=True)
    return None


def poly_from_ring(coords):
    if len(coords) < 3:
        return None
    ring = list(coords)
    if ring[0] != ring[-1]:
        ring.append(ring[0])
    if len(ring) < 4:
        return None
    try:
        g = Polygon(ring)
    except (ValueError, TypeError):
        return None
    if not g.is_valid:
        g = g.buffer(0)
    return None if g.is_empty else g


def main():
    s, w, n, e = BBOX
    t_list = list(tiles(s, w, n, e))
    print(f"tiles: {len(t_list)}", flush=True)

    ways_by_id = {}
    failed = []
    for i, (ts, tw, tn, te) in enumerate(t_list, 1):
        print(f"tile {i}/{len(t_list)} ({ts:.2f},{tw:.2f})-({tn:.2f},{te:.2f})", flush=True)
        els = overpass_ways(ts, tw, tn, te)
        if els is None:
            failed.append((ts, tw, tn, te))
            continue
        for el in els:
            if el.get("type") != "way" or el.get("id") is None:
                continue
            tags = el.get("tags") or {}
            if tags.get("natural") != "water" or tags.get("water") != "river":
                continue
            coords = [(float(p["lon"]), float(p["lat"])) for p in el.get("geometry") or []]
            ways_by_id[el["id"]] = coords
        time.sleep(0.4)

    print(f"ways collected: {len(ways_by_id)}", flush=True)

    polys = [p for p in (poly_from_ring(c) for c in ways_by_id.values()) if p is not None]
    if not polys:
        print("ERROR: no river polygons collected, nothing to write", flush=True)
        sys.exit(1)

    union = unary_union(polys)
    if not union.is_valid:
        union = union.buffer(0)
    clip = union.intersection(box(w, s, e, n))
    if clip.is_empty:
        print("ERROR: clipped geometry is empty", flush=True)
        sys.exit(1)

    out = {
        "type": "FeatureCollection",
        "features": [{
            "type": "Feature",
            "properties": {"name": "Волга", "kind": "river_polygon"},
            "geometry": mapping(clip),
        }],
    }
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False)
    size = __import__("os").path.getsize(OUT_PATH)

    print(f"written: {OUT_PATH} ({size} bytes)", flush=True)
    print(f"clip area (deg^2): {clip.area:.4f}", flush=True)
    print(f"clip bounds: {clip.bounds}", flush=True)
    print(f"failed tiles: {len(failed)}", flush=True)
    if failed:
        print("failed tile list:", flush=True)
        for ft in failed:
            print(f"  {ft}", flush=True)


if __name__ == "__main__":
    main()