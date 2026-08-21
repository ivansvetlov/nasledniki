#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Universal region → fill-only SVG. Query by name, not a hardcoded oblast."""
from __future__ import annotations

import json
import re
import shutil
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from pyproj import Transformer
from shapely.geometry import LineString, MultiPolygon, Polygon, box, shape
from shapely.ops import transform as shp_transform
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[1]
MAPS = ROOT / "maps"
CATALOG = MAPS / "catalog.json"
_tls = threading.local()


def set_maps_root(path) -> None:
    if not path:
        if hasattr(_tls, "maps"):
            delattr(_tls, "maps")
        return
    _tls.maps = Path(path)


def maps_dir() -> Path:
    return getattr(_tls, "maps", MAPS)


def catalog_file() -> Path:
    return maps_dir() / "catalog.json"


def shared_maps_dir() -> Path:
    return ROOT / "maps"


def iter_shared_maps():
    path = shared_maps_dir() / "catalog.json"
    if not path.is_file():
        return
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return
    root = shared_maps_dir()
    for m in data.get("maps") or []:
        slug = m.get("slug")
        if not slug:
            continue
        yield m, root / str(slug)


def find_shared_build(rel=None, query: str | None = None):
    q = str(query or "").lower().strip()
    for m, folder in iter_shared_maps():
        svg = folder / "map.svg"
        if not svg.is_file():
            continue
        if rel is not None and m.get("osm_relation") == rel:
            return m, folder
        name = str(m.get("name") or "").lower()
        qq = str(m.get("query") or "").lower()
        if q and (name == q or qq == q or q in name):
            return m, folder
    return None, None


def import_shared_projects() -> int:
    """Copy Samara / LO benches into the current user catalog if missing."""
    n = 0
    have_slug = {m.get("slug") for m in load_catalog().get("maps") or []}
    have_rel = {
        m.get("osm_relation")
        for m in load_catalog().get("maps") or []
        if m.get("osm_relation")
    }
    for m, folder in iter_shared_maps():
        slug = m.get("slug")
        if not slug or slug in have_slug:
            continue
        if m.get("osm_relation") in have_rel:
            continue
        if not (folder / "map.svg").is_file():
            continue
        dest = maps_dir() / slug
        dest.mkdir(parents=True, exist_ok=True)
        _copy_built(folder, dest)
        meta = dict(m)
        meta["svg"] = f"maps/{slug}/map.svg"
        write_meta(dest, meta)
        upsert_map(meta)
        have_slug.add(slug)
        n += 1
    return n


UA = "nasedniki-maps/1.0 (local editor; osm attribution)"
NOMINATIM = "https://nominatim.openstreetmap.org"
OVERPASS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.openstreetmap.ru/cgi/interpreter",
    "https://overpass.osm.ch/api/interpreter",
]

PALETTE = [
    "#EAD9BC", "#DDE3C8", "#F0DFB8", "#D7E0CF", "#EFDCC9",
    "#E3E0CC", "#EDD8C0", "#DBE2C9", "#F2E0C0", "#D9E1CE",
]
BG = "#F2E8D5"
PAD = 28
GAP_M = 700
SIMPLIFY_M = 400
TARGET_GAP_PX = 3.3
SIMPLIFY_PX = 0.95
GAP_M_MIN = 40
SIMPLIFY_M_MIN = 15
MIN_PART_M2 = 5_000_000
MIN_WATER_M2 = 400_000
SVG_W = 720
WATER_FILL = "#B7C4BC"
OVERLAY_WATER_OPACITY = 0.5
RIVER_HALF_W_M = 1500.0
OSM_API = "https://www.openstreetmap.org/api/0.6"
POLYGONS_FR = "https://polygons.openstreetmap.fr/get_geojson.py"
WATER_TILE_DEG = 0.35


def seam_meters(width_m: float) -> tuple[float, float]:
    """Gap and simplify in meters so the pixel seam stays ~TARGET_GAP_PX.

    Samara (~300 km) → ~700 м / ~3.3 px. A city (~60 km) with the same 700 м
    blows the seam to ~15 px; scale the buffer to the current extent instead.
    """
    w = max(float(width_m), 1.0)
    gap = TARGET_GAP_PX * w / (2.0 * (SVG_W + TARGET_GAP_PX))
    gap = min(GAP_M, max(GAP_M_MIN, gap))
    simp = SIMPLIFY_PX * w / SVG_W
    simp = min(SIMPLIFY_M, max(SIMPLIFY_M_MIN, simp))
    return gap, simp


def _http(url: str, data: bytes | None = None, timeout: int = 120) -> bytes:
    req = urllib.request.Request(
        url,
        data=data,
        headers={"User-Agent": UA, "Accept": "application/json"},
        method="POST" if data else "GET",
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def slugify(name: str, osm_id: int | None = None) -> str:
    s = name.lower().strip()
    s = re.sub(r"[^\w\u0400-\u04ff]+", "-", s, flags=re.UNICODE)
    s = re.sub(r"-{2,}", "-", s).strip("-") or "map"
    if osm_id:
        s = f"{s}-{osm_id}"
    return s[:80]


def load_catalog() -> dict:
    path = catalog_file()
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return {"maps": []}


def save_catalog(cat: dict) -> None:
    root = maps_dir()
    root.mkdir(parents=True, exist_ok=True)
    catalog_file().write_text(
        json.dumps(cat, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def search_regions(query: str, limit: int = 8) -> list[dict]:
    q = urllib.parse.urlencode(
        {
            "q": query,
            "format": "jsonv2",
            "addressdetails": 1,
            "limit": str(max(limit, 12)),
            "countrycodes": "ru",
            "accept-language": "ru",
        }
    )
    raw = json.loads(_http(f"{NOMINATIM}/search?{q}", timeout=40))
    hits = []
    for h in raw:
        if h.get("osm_type") != "relation":
            continue
        if h.get("category") not in (None, "boundary", "place"):
            continue
        rec = {
            "osm_id": int(h["osm_id"]),
            "name": h.get("display_name", "").split(",")[0].strip()
            or query,
            "display": h.get("display_name") or query,
            "lat": float(h["lat"]),
            "lon": float(h["lon"]),
            "type": h.get("type") or h.get("addresstype") or "",
        }
        rec["kind"] = place_kind(rec)
        hits.append(rec)
    return hits


def _overpass_json(ql: str, timeout: int = 12, endpoints=None) -> dict | None:
    body = urllib.parse.urlencode({"data": ql}).encode()
    for ep in endpoints or OVERPASS:
        try:
            raw = _http(ep, data=body, timeout=timeout)
            return json.loads(raw)
        except (
            urllib.error.HTTPError,
            urllib.error.URLError,
            TimeoutError,
            json.JSONDecodeError,
            OSError,
        ):
            continue
    return None


def overpass_member_ids(rel_id: int, level: str) -> list[int] | None:
    """Child relations listed as members. None = Overpass down, [] = no such members."""
    ql = f"[out:json][timeout:10];rel({rel_id});rel(r);out tags;"
    data = _overpass_json(ql, timeout=12)
    if data is None:
        return None
    ids = []
    for el in data.get("elements") or []:
        if el.get("type") != "relation" or not el.get("id"):
            continue
        tags = el.get("tags") or {}
        if tags.get("admin_level") != str(level):
            continue
        if tags.get("boundary") and tags.get("boundary") != "administrative":
            continue
        ids.append(int(el["id"]))
    return ids


def overpass_admin(rel_id: int, level: str) -> list[int] | None:
    ql = (
        f"[out:json][timeout:12];"
        f"rel({rel_id});map_to_area;"
        f'rel(area)["boundary"="administrative"]["admin_level"="{level}"];'
        f"out ids;"
    )
    data = _overpass_json(ql, timeout=14)
    if data is None:
        return None
    ids = []
    for el in data.get("elements") or []:
        if el.get("type") == "relation" and el.get("id"):
            ids.append(int(el["id"]))
    return ids


def overpass_admin6(rel_id: int) -> list[int]:
    return overpass_admin(rel_id, "6") or []


# Федеральные города (admin 4) в OSM не входят в admin 6 области.
FEDERAL_CITY_REL = {
    337422: "Санкт-Петербург",
    102269: "Москва",
    1574364: "Севастополь",
}
HOST_OBLAST_CITIES = {
    176095: [337422],  # Ленинградская область ← СПб
    51490: [102269],  # Московская область ← Москва
}
FEDERAL_CITIES = (
    "санкт-петербург",
    "москва",
    "севастополь",
)
MAX_CITY_PARTS = 36


def is_federal_city_name(name: str) -> bool:
    n = str(name or "").lower().replace("ё", "е")
    return any(n == c or n.startswith(c) for c in FEDERAL_CITIES)


def extra_city_ids(rel_id: int) -> list[int]:
    return list(HOST_OBLAST_CITIES.get(int(rel_id), []))


def _uniq_ids(ids: list[int]) -> list[int]:
    out, seen = [], set()
    for i in ids:
        if i in seen:
            continue
        seen.add(i)
        out.append(i)
    return out


def _parts_at(rel_id: int, levels: tuple[str, ...]) -> list[int] | None:
    """None = Overpass down. [] = no children at these levels."""
    down = True
    for lv in levels:
        ids = overpass_member_ids(rel_id, lv)
        if ids is not None:
            down = False
            if ids:
                return ids
        area = overpass_admin(rel_id, lv)
        if area is not None:
            down = False
            if area:
                return area
    if down:
        return None
    return []


def zone_rel_ids(rel_id: int, kind: str = "region") -> list[int]:
    """What to fetch from Nominatim.

    область     → admin 6 + федеральный город одним пятном (СПб в ЛО, Москва в МО)
    фед. город  → admin 5 (районы), иначе 8, если кусков не больше MAX_CITY_PARTS
    район       → одно тело
    """
    rel_id = int(rel_id)
    extras = extra_city_ids(rel_id)
    if kind == "district":
        return [rel_id]
    if kind == "city" or rel_id in FEDERAL_CITY_REL:
        parts = _parts_at(rel_id, ("5", "8"))
        if parts is None:
            print("overpass лёг · город одним телом")
            return [rel_id]
        if parts and len(parts) <= MAX_CITY_PARTS:
            print(f"город районы={len(parts)}")
            return parts
        if parts:
            print(f"{len(parts)} кусков > {MAX_CITY_PARTS} · город одним телом")
        return [rel_id]
    parts = _parts_at(rel_id, ("6",))
    if parts is None:
        print("overpass лёг · область + известные города")
        return _uniq_ids([rel_id] + extras)
    ids = list(parts or [])
    if not ids:
        ids = [rel_id]
        print("нет admin 6 · контур области")
    else:
        print(f"overpass children={len(ids)}")
    for e in extras:
        if e not in ids:
            ids.append(e)
            print(f"  + фед. город rel {e}")
    return ids


def child_or_self_ids(rel_id: int, kind: str = "region") -> list[int]:
    return zone_rel_ids(rel_id, kind)


def place_kind(hit: dict) -> str:
    t = str(hit.get("type") or "").lower()
    n = str(hit.get("name") or "").lower().replace("ё", "е")
    if n in FEDERAL_CITIES or t in ("city", "town", "village", "hamlet"):
        return "city"
    if "городск" in n or (t == "municipality" and "район" not in n):
        return "city"
    if t in ("district",) or "район" in n:
        return "district"
    if (
        t in ("state", "oblast")
        or "область" in n
        or "край" in n
        or "республика" in n
        or "автономный округ" in n
    ):
        return "region"
    if t == "administrative":
        if "район" in n:
            return "district"
        if any(x in n for x in ("область", "край", "республика", "округ")):
            return "region"
        return "city"
    return "place"


KIND_RU = {
    "empty": "пустой проект",
    "city": "город",
    "district": "район",
    "region": "регион",
    "place": "место",
}


def nominatim_geojson(rel_ids: list[int]) -> dict:
    feats = []
    for i in range(0, len(rel_ids), 25):
        chunk = rel_ids[i : i + 25]
        ids = ",".join(f"R{n}" for n in chunk)
        q = urllib.parse.urlencode(
            {"osm_ids": ids, "format": "geojson", "polygon_geojson": 1}
        )
        data = json.loads(_http(f"{NOMINATIM}/lookup?{q}", timeout=120))
        feats.extend(data.get("features") or [])
        if i + 25 < len(rel_ids):
            time.sleep(1.1)
    return {"type": "FeatureCollection", "features": feats}


def feature_name(props: dict) -> str:
    if props.get("name"):
        return str(props["name"])
    tags = props.get("tags") or {}
    return (
        tags.get("name:ru")
        or tags.get("name")
        or (props.get("display_name") or "").split(",")[0].strip()
        or "без имени"
    )


def is_city_okrug(name: str) -> bool:
    if is_federal_city_name(name):
        return False
    n = name.lower()
    if "муниципальн" in n and "городск" not in n:
        return False
    return "городск" in n or n.startswith("го ")


def is_zone(name: str) -> bool:
    n = name.lower()
    if is_city_okrug(name):
        return False
    return "район" in n or "муниципальн" in n or "округ" in n


def utm_epsg(lon: float, lat: float) -> str:
    zone = int((lon + 180) / 6) + 1
    hemi = 32600 if lat >= 0 else 32700
    return f"EPSG:{hemi + zone}"


def to_meters(geom, epsg: str):
    tr = Transformer.from_crs("EPSG:4326", epsg, always_xy=True)
    return shp_transform(lambda x, y, z=None: tr.transform(x, y), geom)


def keep_large_parts(geom, min_area: float):
    if geom.is_empty:
        return geom
    polys = list(geom.geoms) if isinstance(geom, MultiPolygon) else [geom]
    kept = []
    for p in polys:
        if p.geom_type != "Polygon" or p.is_empty or p.area < min_area:
            continue
        kept.append(Polygon(p.exterior))
    if not kept:
        return geom
    return unary_union(kept)


def merge_cities(feats: list[dict]) -> list[dict]:
    zones = [f for f in feats if is_zone(f["name"])]
    cities = [f for f in feats if is_city_okrug(f["name"])]
    other = [f for f in feats if f not in zones and f not in cities]
    if not zones:
        zones = [f for f in feats if not is_city_okrug(f["name"])]
        cities = [f for f in feats if is_city_okrug(f["name"])]
        other = []
    if not zones:
        print(f"зон=0 · тело как есть ({len(feats)})")
        return [{"name": f["name"], "geom": f["geom"]} for f in feats]
    print(f"зон={len(zones)} городских={len(cities)} прочих={len(other)}")
    assigned = {id(z): [z["geom"]] for z in zones}
    for o in cities:
        best, best_key = None, None
        for z in zones:
            inter = z["geom"].buffer(80).intersection(o["geom"].buffer(80)).area
            dist = z["geom"].distance(o["geom"])
            key = (dist, -inter)
            if best_key is None or key < best_key:
                best_key, best = key, z
        if best is None:
            continue
        assigned[id(best)].append(o["geom"])
        print(f"  {o['name']} → {best['name']}")
    out = []
    for z in zones:
        g = unary_union(assigned[id(z)])
        if not g.is_valid:
            g = g.buffer(0)
        out.append({"name": z["name"], "geom": g})
    for o in other:
        g = o["geom"]
        if not g.is_valid:
            g = g.buffer(0)
        print(f"  отдельным телом: {o['name']}")
        out.append({"name": o["name"], "geom": g})
    return out


def ring_to_d(coords, sx, sy, minx, maxy) -> str:
    pts = [
        ((x - minx) * sx + PAD, (maxy - y) * sy + PAD) for x, y in coords
    ]
    if len(pts) < 3:
        return ""
    d = [f"M{pts[0][0]:.1f},{pts[0][1]:.1f}"]
    d += [f"L{x:.1f},{y:.1f}" for x, y in pts[1:]]
    d.append("Z")
    return " ".join(d)


def _esc_name(name: str) -> str:
    return (
        str(name or "")
        .replace("&", "&amp;")
        .replace('"', "&quot;")
        .replace("<", "&lt;")
    )


def is_osm_water_area(tags: dict) -> bool:
    """OSM area feature that is water. Not a coastline, not a river centerline."""
    tags = tags or {}
    if tags.get("natural") in ("water", "bay"):
        return True
    if tags.get("waterway") == "riverbank":
        return True
    return False


def is_osm_water_relation(tags: dict) -> bool:
    """Named sea/bay may be a relation; place=sea is still water, not land."""
    tags = tags or {}
    if is_osm_water_area(tags):
        return True
    return tags.get("place") in ("sea", "ocean")


def is_osm_river_area(tags: dict) -> bool:
    tags = tags or {}
    w = str(tags.get("water") or "")
    return tags.get("waterway") == "riverbank" or w in (
        "river",
        "canal",
        "oxbow",
        "stream",
    )


def water_body_label(name: str, tags: dict | None = None) -> str | None:
    """Keep OSM name. Unnamed river areas → «река». Unnamed ponds → skip."""
    tags = tags or {}
    n = str(name or "").strip()
    if n:
        return n
    if is_osm_river_area(tags):
        return "река"
    return None


def osm_name(tags: dict | None) -> str:
    tags = tags or {}
    return str(tags.get("name:ru") or tags.get("name") or "").strip()


def water_rel_too_big(el: dict, bbox) -> bool:
    """Own OSM bbox dwarfs the map. Clip, do not drop — fetch may use a simpler poly."""
    b = el.get("bounds") or {}
    try:
        ew = float(b["maxlon"]) - float(b["minlon"])
        eh = float(b["maxlat"]) - float(b["minlat"])
    except (KeyError, TypeError, ValueError):
        return False
    mw = max(float(bbox[2]) - float(bbox[0]), 1e-6)
    mh = max(float(bbox[3]) - float(bbox[1]), 1e-6)
    return ew > 4 * mw or eh > 4 * mh


def feats_bbox_ll(feats: list[dict]) -> tuple[float, float, float, float]:
    minx = min(f["geom"].bounds[0] for f in feats)
    miny = min(f["geom"].bounds[1] for f in feats)
    maxx = max(f["geom"].bounds[2] for f in feats)
    maxy = max(f["geom"].bounds[3] for f in feats)
    return minx, miny, maxx, maxy


def _iter_bbox_tiles(swne, max_deg: float = WATER_TILE_DEG):
    s, w, n, e = swne
    lat = s
    while lat < n - 1e-12:
        nlat = min(lat + max_deg, n)
        lon = w
        while lon < e - 1e-12:
            nlon = min(lon + max_deg, e)
            yield lat, lon, nlat, nlon
            lon = nlon
        lat = nlat


def _coords_lonlat(geom_pts) -> list[tuple[float, float]]:
    out = []
    for p in geom_pts or []:
        if "lon" in p and "lat" in p:
            out.append((float(p["lon"]), float(p["lat"])))
    return out


def _poly_from_ring(coords: list[tuple[float, float]]):
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
    if g.is_empty:
        return None
    return g


def _shape_geojson(obj):
    if not obj:
        return None
    if isinstance(obj, list):
        geoms = [g for x in obj if (g := _shape_geojson(x)) is not None]
        return unary_union(geoms) if geoms else None
    t = obj.get("type")
    if t == "Feature":
        return _shape_geojson(obj.get("geometry"))
    if t == "FeatureCollection":
        return _shape_geojson(obj.get("features"))
    if t in ("Polygon", "MultiPolygon", "LineString", "MultiLineString"):
        try:
            g = shape(obj)
        except (ValueError, TypeError):
            return None
        if not g.is_valid:
            g = g.buffer(0)
        return None if g.is_empty else g
    return None


def _shape_geojson_bytes(raw: bytes):
    if not raw:
        return None
    text = raw.decode("utf-8", errors="replace").strip()
    if not text or text[0] not in "{[":
        return None
    return _shape_geojson(json.loads(text))


def _clip_ll(geom, bbox, pad: float = 0.02):
    if geom is None or geom.is_empty:
        return None
    frame = box(bbox[0] - pad, bbox[1] - pad, bbox[2] + pad, bbox[3] + pad)
    g = geom.intersection(frame)
    if not g.is_valid:
        g = g.buffer(0)
    return None if g.is_empty else g


def overpass_water_feats(data: dict, bbox=None) -> list[dict]:
    """Parse Overpass elements that already carry geometry. Clip, never drop by size."""
    del bbox
    feats = []
    for el in (data or {}).get("elements") or []:
        tags = el.get("tags") or {}
        if el.get("type") == "relation":
            if not is_osm_water_relation(tags):
                continue
        elif not is_osm_water_area(tags):
            continue
        label = water_body_label(osm_name(tags), tags)
        if not label:
            continue
        geoms = []
        if el.get("type") == "way" and el.get("geometry"):
            g = _poly_from_ring(_coords_lonlat(el.get("geometry")))
            if g is not None:
                geoms.append(g)
            else:
                coords = _coords_lonlat(el.get("geometry"))
                if len(coords) >= 2:
                    geoms.append(LineString(coords))
        elif el.get("type") == "relation":
            for mem in el.get("members") or []:
                if mem.get("type") != "way" or not mem.get("geometry"):
                    continue
                if mem.get("role") == "inner":
                    continue
                g = _poly_from_ring(_coords_lonlat(mem.get("geometry")))
                if g is not None:
                    geoms.append(g)
        if not geoms:
            continue
        g = unary_union(geoms)
        if not g.is_valid:
            g = g.buffer(0)
        if g.is_empty:
            continue
        feats.append({"name": label, "geom": g, "tags": tags})
    return feats


def _is_clutter_water(tags: dict, extra: str = "") -> bool:
    t = str(tags.get("water") or extra or "").lower()
    if t in (
        "pond",
        "fountain",
        "swimming_pool",
        "reflecting_pool",
        "ditch",
        "fishpond",
        "moat",
        "wastewater",
    ):
        return True
    name = osm_name(tags).lower()
    if any(w in name for w in ("пруд", "прудок", "фонтан", "pond", "fountain")):
        return True
    return False


def _tags_from_nominatim(hit: dict) -> dict:
    name = str(hit.get("name") or "").strip()
    cat = str(hit.get("category") or "")
    typ = str(hit.get("type") or "")
    tags = {}
    if name:
        tags["name"] = name
    if cat == "natural" and typ in ("water", "bay"):
        tags["natural"] = typ
    if cat == "natural" and typ:
        tags.setdefault("water", typ if typ != "water" else "")
        if not tags.get("water"):
            tags.pop("water", None)
    if cat == "waterway" and typ == "riverbank":
        tags["waterway"] = "riverbank"
    if typ in ("river", "canal", "oxbow", "lagoon", "lake"):
        tags.setdefault("water", typ)
        if cat == "natural":
            tags.setdefault("natural", "water")
    if cat == "place" and typ in ("sea", "ocean"):
        tags["place"] = typ
    return tags


def _discover_water_nominatim(bbox) -> tuple[dict, dict]:
    """Named OSM water already indexed in the frame. Tag search, not a city list."""
    minlon, minlat, maxlon, maxlat = bbox
    rels: dict[int, dict] = {}
    ways: dict[int, dict] = {}
    pad = 0.01
    outer = (minlat - pad, minlon - pad, maxlat + pad, maxlon + pad)
    queries = ("[water]", "bay", "water=river")
    for s, w, n, e in _iter_bbox_tiles(outer):
        viewbox = f"{w},{n},{e},{s}"
        for q in queries:
            qs = urllib.parse.urlencode(
                {
                    "format": "jsonv2",
                    "viewbox": viewbox,
                    "bounded": "1",
                    "limit": "40",
                    "q": q,
                    "accept-language": "ru",
                    "extratags": "1",
                }
            )
            try:
                hits = json.loads(
                    _http(f"{NOMINATIM}/search?{qs}", timeout=30)
                )
            except (
                urllib.error.HTTPError,
                urllib.error.URLError,
                TimeoutError,
                json.JSONDecodeError,
                OSError,
            ) as err:
                print(f"вода nominatim {q}: {type(err).__name__}", flush=True)
                continue
            time.sleep(1.05)
            if not isinstance(hits, list):
                continue
            for h in hits:
                osm_type = h.get("osm_type")
                osm_id = h.get("osm_id")
                if not osm_id or osm_type not in ("relation", "way"):
                    continue
                if h.get("category") == "waterway" and h.get("type") != "riverbank":
                    continue
                extra = h.get("extratags") or {}
                tags = _tags_from_nominatim(h)
                tags.update(
                    {k: v for k, v in extra.items() if k in ("water", "natural", "waterway", "name:ru")}
                )
                if _is_clutter_water(tags, str(h.get("type") or "")):
                    continue
                if osm_type == "relation":
                    if not is_osm_water_relation(tags) and tags.get("natural") != "bay":
                        if not water_body_label(osm_name(tags), tags):
                            continue
                    rels[int(osm_id)] = {
                        "type": "relation",
                        "id": int(osm_id),
                        "tags": tags,
                    }
                elif is_osm_water_area(tags) or tags.get("natural") == "water":
                    ways[int(osm_id)] = {
                        "type": "way",
                        "id": int(osm_id),
                        "tags": tags,
                    }
    return rels, ways


def _discover_water_osm(bbox) -> tuple[dict, dict]:
    """OSM water ids in the frame. Polygons come from the OSM relation, then clip."""
    rels, ways = _discover_water_nominatim(bbox)
    print(f"вода nominatim rels={len(rels)} ways={len(ways)}", flush=True)
    return rels, ways


def _rel_polygon(rel_id: int):
    """OSM relation as a polygon. Full sea dump via Overpass is not used."""
    rid = int(rel_id)
    try:
        raw = _http(f"{POLYGONS_FR}?id={rid}&params=0", timeout=50)
        g = _shape_geojson_bytes(raw)
        if g is not None:
            return g
    except (
        urllib.error.HTTPError,
        urllib.error.URLError,
        TimeoutError,
        json.JSONDecodeError,
        OSError,
        ValueError,
    ) as e:
        print(f"вода polygons.fr R{rid}: {type(e).__name__}")
    try:
        q = urllib.parse.urlencode(
            {
                "osm_ids": f"R{rid}",
                "format": "json",
                "polygon_geojson": "1",
                "accept-language": "ru",
            }
        )
        hits = json.loads(_http(f"{NOMINATIM}/lookup?{q}", timeout=40))
        time.sleep(1.05)
        for h in hits or []:
            g = _shape_geojson(h.get("geojson"))
            if g is not None:
                return g
    except (
        urllib.error.HTTPError,
        urllib.error.URLError,
        TimeoutError,
        json.JSONDecodeError,
        OSError,
        ValueError,
    ) as e:
        print(f"вода nominatim R{rid}: {type(e).__name__}")
    return None


def _osm_way_full(way_id: int):
    data = json.loads(
        _http(f"{OSM_API}/way/{int(way_id)}/full.json", timeout=25)
    )
    nodes = {}
    way = None
    for el in data.get("elements") or []:
        if el.get("type") == "node":
            nodes[el["id"]] = (float(el["lon"]), float(el["lat"]))
        elif el.get("type") == "way":
            way = el
    if not way:
        return None
    coords = [nodes[i] for i in (way.get("nodes") or []) if i in nodes]
    g = _poly_from_ring(coords)
    if g is not None:
        return g
    if len(coords) >= 2:
        return LineString(coords)
    return None


def _ways_geom(ids: list[int]) -> dict:
    """OSM API by id. Overpass way dumps time out."""
    out: dict[int, object] = {}
    for n in ids[:40]:
        try:
            g = _osm_way_full(n)
        except (
            urllib.error.HTTPError,
            urllib.error.URLError,
            TimeoutError,
            json.JSONDecodeError,
            OSError,
        ):
            continue
        if g is not None:
            out[n] = g
    return out


def fetch_water_feats(bbox) -> list[dict]:
    """OSM water areas that intersect the map frame. Clip to frame. Names from OSM."""
    rels, ways = _discover_water_osm(bbox)
    if not rels and not ways:
        print("вода: в кадре нет OSM-площадей water/bay/riverbank")
        return []
    member_ways = set()
    feats = []
    for rid, el in rels.items():
        tags = el.get("tags") or {}
        label = water_body_label(osm_name(tags), tags)
        if not label:
            continue
        for mem in el.get("members") or []:
            if mem.get("type") == "way" and mem.get("ref"):
                member_ways.add(int(mem["ref"]))
        g = _rel_polygon(rid)
        g = _clip_ll(g, bbox)
        if g is None:
            print(f"вода: нет полигона у R{rid} ({label})")
            continue
        feats.append({"name": label, "geom": g, "tags": tags, "osm": f"R{rid}"})
    have = {f["name"] for f in feats}
    leftover = []
    for wid, el in ways.items():
        if int(wid) in member_ways:
            continue
        tags = el.get("tags") or {}
        label = water_body_label(osm_name(tags), tags)
        if not label or label in have:
            continue
        b = el.get("bounds") or {}
        try:
            bw = float(b["maxlon"]) - float(b["minlon"])
            bh = float(b["maxlat"]) - float(b["minlat"])
        except (KeyError, TypeError, ValueError):
            bw, bh = 1.0, 1.0
        if bw < 0.002 and bh < 0.002 and not is_osm_river_area(tags):
            continue
        leftover.append((int(wid), label, tags))
    geoms = _ways_geom([w[0] for w in leftover])
    for wid, label, tags in leftover:
        g = _clip_ll(geoms.get(wid), bbox)
        if g is None:
            continue
        feats.append({"name": label, "geom": g, "tags": tags, "osm": f"W{wid}"})
    print(
        f"вода osm={len(feats)} rels={len(rels)} ways={len(ways)} "
        + ", ".join(sorted({f['name'] for f in feats})[:12]),
        flush=True,
    )
    return feats


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


def _prepare_water(
    water_feats: list[dict],
    epsg: str,
    clip,
    simplify_m: float,
    raw_land: list[dict] | None = None,
    close_m: float = 200.0,
) -> list[dict]:
    """Clip OSM water areas to the map. Same names as OSM. No invented holes."""
    del raw_land, close_m
    min_area = max(25_000.0, 0.000015 * max(clip.area, 1.0))
    river_w = max(80.0, 0.004 * max(clip.bounds[2] - clip.bounds[0], 1.0))
    grouped: dict[str, list] = {}
    for f in water_feats or []:
        label = water_body_label(f.get("name") or "", f.get("tags") or {})
        if not label:
            continue
        g = to_meters(f["geom"], epsg)
        if not g.is_valid:
            g = g.buffer(0)
        if g.is_empty:
            continue
        if g.geom_type in ("LineString", "MultiLineString"):
            g = g.buffer(river_w)
        g = g.intersection(clip)
        if g.is_empty:
            continue
        grouped.setdefault(label, []).append(g)
    out = []
    for name, geoms in grouped.items():
        g = unary_union(geoms)
        if not g.is_valid:
            g = g.buffer(0)
        water_simp = min(float(simplify_m), max(12.0, 0.12 * float(simplify_m)))
        if water_simp > 0:
            g = g.simplify(water_simp, preserve_topology=True)
        if g.is_empty or g.area < min_area:
            continue
        out.append({"name": name, "geom": g, "area": g.area})
    out.sort(key=lambda x: -x["area"])
    return out


def water_layer_state() -> dict:
    return {
        "layers": [
            {
                "id": 2,
                "name": "Вода",
                "type": "body",
                "visible": True,
                "locked": False,
                "collapsed": False,
            },
            {
                "id": 1,
                "name": "Районы",
                "type": "body",
                "visible": True,
                "locked": False,
                "collapsed": False,
            },
        ],
        "activeLayerId": 1,
        "layerSeq": 2,
    }


def svg_from_features(
    feats: list[dict],
    lon: float,
    lat: float,
    water_feats=None,
) -> str:
    epsg = utm_epsg(lon, lat)
    projected = []
    for f in feats:
        g = to_meters(f["geom"], epsg)
        if not g.is_valid:
            g = g.buffer(0)
        projected.append({"name": f["name"], "geom": g})
    zones = merge_cities(projected)
    raw = []
    for f in zones:
        g = keep_large_parts(f["geom"], MIN_PART_M2)
        if g.is_empty:
            continue
        raw.append({"name": f["name"], "geom": g})
    if not raw:
        raise RuntimeError("после упрощения не осталось зон")
    width_m = max(
        max(p["geom"].bounds[2] for p in raw) - min(p["geom"].bounds[0] for p in raw),
        1,
    )
    gap_m, simplify_m = seam_meters(width_m)
    print(f"extent {width_m/1000:.1f} km · щель {gap_m:.0f} м · simplify {simplify_m:.0f} м")
    prepared = []
    for f in raw:
        g = f["geom"]
        if simplify_m > 0:
            g = g.simplify(simplify_m, preserve_topology=True)
        if gap_m > 0:
            shrunk = g.buffer(-gap_m)
            if not shrunk.is_empty:
                g = shrunk
        g = keep_large_parts(g, MIN_PART_M2)
        if g.is_empty:
            continue
        prepared.append({"name": f["name"], "geom": g, "area": g.area})
    prepared.sort(key=lambda x: -x["area"])
    if not prepared:
        raise RuntimeError("после упрощения не осталось зон")
    minx = min(p["geom"].bounds[0] for p in prepared)
    miny = min(p["geom"].bounds[1] for p in prepared)
    maxx = max(p["geom"].bounds[2] for p in prepared)
    maxy = max(p["geom"].bounds[3] for p in prepared)
    width_m = max(maxx - minx, 1)
    height_m = max(maxy - miny, 1)
    sx = SVG_W / width_m
    svg_h = SVG_W * (height_m / width_m)
    sy = svg_h / height_m
    W = int(SVG_W + 2 * PAD)
    H = int(svg_h + 2 * PAD)
    if water_feats is None:
        try:
            water_feats = fetch_water_feats(feats_bbox_ll(feats))
        except Exception as e:
            print(f"вода не загрузилась: {e}")
            water_feats = []
    water = _prepare_water(
        water_feats,
        epsg,
        box(minx, miny, maxx, maxy),
        simplify_m,
        raw_land=raw,
        close_m=max(gap_m * 2, 120.0),
    )
    if water:
        print("вода: " + ", ".join(p["name"] for p in water))
        wu = unary_union([p["geom"] for p in water])
        if not wu.is_empty:
            for p in prepared:
                try:
                    ng = p["geom"].difference(wu)
                except Exception:
                    continue
                if not ng.is_empty:
                    p["geom"] = ng

    def path_tags(items, prefix, fills):
        out = []
        for i, p in enumerate(items):
            d = geom_to_d(p["geom"], sx, sy, minx, maxy)
            if not d:
                continue
            name = _esc_name(p["name"])
            color = fills[i % len(fills)]
            out.append(
                f'<path d="{d}" fill="{color}" data-region="{prefix}{i}" data-name="{name}"/>'
            )
        return out

    land_paths = path_tags(prepared, "r", PALETTE)
    water_paths = path_tags(water, "w", [WATER_FILL])
    water_g = ""
    if water_paths:
        water_g = (
            '    <g id="water" data-layer-id="2" data-layer-type="body" '
            'data-layer-name="Вода">\n'
            + "\n".join("      " + p for p in water_paths)
            + "\n    </g>\n"
        )
    return (
        f'<?xml version="1.0" encoding="UTF-8"?>\n'
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" '
        f'viewBox="0 0 {W} {H}">\n'
        f'  <rect width="{W}" height="{H}" fill="{BG}"/>\n'
        f'  <g id="layer-stack">\n'
        f"{water_g}"
        f'    <g id="regions" data-layer-id="1" data-layer-type="body" '
        f'data-layer-name="Районы">\n'
        + "\n".join("      " + p for p in land_paths)
        + "\n    </g>\n"
        f"  </g>\n</svg>\n"
    ), len(land_paths)


def rebuild_project_svg(slug: str) -> dict:
    dest = _safe_project_dir(slug)
    meta = find_map(slug)
    gj_path = dest / "districts.geojson"
    if not meta or not gj_path.is_file():
        raise RuntimeError("нет геометрии проекта")
    gj = json.loads(gj_path.read_text(encoding="utf-8"))
    feats = load_gj_features(gj)
    lon = float(meta.get("lon") or 0)
    lat = float(meta.get("lat") or 0)
    svg, npaths = svg_from_features(feats, lon, lat)
    (dest / "map.svg").write_text(svg, encoding="utf-8")
    meta["zones"] = npaths
    if 'id="water"' in svg:
        (dest / "state.json").write_text(
            json.dumps(water_layer_state(), ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    write_meta(dest, meta)
    upsert_map(meta)
    return meta


def _svg_wh(svg: str) -> tuple[int, int]:
    wm = re.search(r'\bwidth="(\d+)"', svg)
    hm = re.search(r'\bheight="(\d+)"', svg)
    if not wm or not hm:
        raise RuntimeError("в SVG нет width/height")
    return int(wm.group(1)), int(hm.group(1))


def region_path_ds(svg: str) -> list[str]:
    m = re.search(r'<g\b[^>]*id="regions"[^>]*>(.*?)</g>', svg, re.S | re.I)
    block = m.group(1) if m else ""
    return re.findall(r'\bd="([^"]*)"', block)


def land_svg_frame(feats: list[dict], lon: float, lat: float) -> dict:
    """Same projection as a full rebuild — used only to place an overlay. No write."""
    epsg = utm_epsg(lon, lat)
    projected = []
    for f in feats:
        g = to_meters(f["geom"], epsg)
        if not g.is_valid:
            g = g.buffer(0)
        projected.append({"name": f["name"], "geom": g})
    zones = merge_cities(projected)
    raw = []
    for f in zones:
        g = keep_large_parts(f["geom"], MIN_PART_M2)
        if g.is_empty:
            continue
        raw.append({"name": f["name"], "geom": g})
    if not raw:
        raise RuntimeError("после упрощения не осталось зон")
    width_m = max(
        max(p["geom"].bounds[2] for p in raw) - min(p["geom"].bounds[0] for p in raw),
        1,
    )
    gap_m, simplify_m = seam_meters(width_m)
    prepared = []
    for f in raw:
        g = f["geom"]
        if simplify_m > 0:
            g = g.simplify(simplify_m, preserve_topology=True)
        if gap_m > 0:
            shrunk = g.buffer(-gap_m)
            if not shrunk.is_empty:
                g = shrunk
        g = keep_large_parts(g, MIN_PART_M2)
        if g.is_empty:
            continue
        prepared.append({"name": f["name"], "geom": g, "area": g.area})
    prepared.sort(key=lambda x: -x["area"])
    minx = min(p["geom"].bounds[0] for p in prepared)
    miny = min(p["geom"].bounds[1] for p in prepared)
    maxx = max(p["geom"].bounds[2] for p in prepared)
    maxy = max(p["geom"].bounds[3] for p in prepared)
    width_m = max(maxx - minx, 1)
    height_m = max(maxy - miny, 1)
    sx = SVG_W / width_m
    svg_h = SVG_W * (height_m / width_m)
    sy = svg_h / height_m
    return {
        "epsg": epsg,
        "simplify_m": simplify_m,
        "minx": minx,
        "miny": miny,
        "maxx": maxx,
        "maxy": maxy,
        "sx": sx,
        "sy": sy,
        "W": int(SVG_W + 2 * PAD),
        "H": int(svg_h + 2 * PAD),
    }


def fetch_overlay_reservoir_feats(bbox) -> list[dict]:
    """River water *surface* in the frame: OSM reservoir / water=river areas.

    Nominatim «Волга» is a centerline and hotels. The fill is the reservoir.
    """
    minlon, minlat, maxlon, maxlat = bbox
    viewbox = f"{minlon},{maxlat},{maxlon},{minlat}"
    rels: dict[int, dict] = {}
    for q in ("водохранилище", "water=reservoir"):
        qs = urllib.parse.urlencode(
            {
                "format": "jsonv2",
                "viewbox": viewbox,
                "bounded": "1",
                "limit": "20",
                "q": q,
                "accept-language": "ru",
                "extratags": "1",
            }
        )
        try:
            hits = json.loads(_http(f"{NOMINATIM}/search?{qs}", timeout=30))
        except (
            urllib.error.HTTPError,
            urllib.error.URLError,
            TimeoutError,
            json.JSONDecodeError,
            OSError,
        ) as e:
            print(f"оверлей nominatim {q}: {type(e).__name__}", flush=True)
            continue
        time.sleep(1.05)
        if not isinstance(hits, list):
            continue
        for h in hits:
            if h.get("osm_type") != "relation" or not h.get("osm_id"):
                continue
            cat = str(h.get("category") or "")
            typ = str(h.get("type") or "")
            extra = h.get("extratags") or {}
            if cat in ("leisure", "tourism", "shop", "amenity", "waterway"):
                continue
            water = str(extra.get("water") or typ or "")
            if cat == "water" and typ == "reservoir":
                pass
            elif cat == "landuse" and water == "river":
                pass
            elif cat == "natural" and typ in ("water", "bay"):
                pass
            else:
                continue
            tags = _tags_from_nominatim(h)
            tags.update(
                {
                    k: v
                    for k, v in extra.items()
                    if k in ("water", "natural", "waterway", "landuse", "name:ru")
                }
            )
            if typ == "reservoir":
                tags.setdefault("natural", "water")
                tags.setdefault("water", "reservoir")
            name = osm_name(tags)
            if not name:
                continue
            rels[int(h["osm_id"])] = {
                "type": "relation",
                "id": int(h["osm_id"]),
                "tags": tags,
            }
    feats = []
    for rid, el in rels.items():
        tags = el.get("tags") or {}
        label = water_body_label(osm_name(tags), tags)
        if not label:
            continue
        g = _clip_ll(_rel_polygon(rid), bbox)
        if g is None:
            print(f"оверлей: нет полигона R{rid} ({label})", flush=True)
            continue
        feats.append({"name": label, "geom": g, "tags": tags, "osm": f"R{rid}"})
    print(
        "оверлей osm="
        + str(len(feats))
        + " "
        + ", ".join(sorted({f["name"] for f in feats})),
        flush=True,
    )
    return feats


RIVER_CENTERLINE_REL = 1730417  # waterway=river «Волга» (OSM relation, full river)


def fetch_volga_centerline(bbox) -> object | None:
    """Centerline of the Volga river (OSM relation R1730417) clipped to the frame.

    Nominatim lookup returns the river as MultiLineString, not a polygon.
    """
    q = urllib.parse.urlencode(
        {
            "osm_ids": f"R{RIVER_CENTERLINE_REL}",
            "format": "json",
            "polygon_geojson": "1",
            "accept-language": "ru",
        }
    )
    try:
        hits = json.loads(_http(f"{NOMINATIM}/lookup?{q}", timeout=40))
        time.sleep(1.05)
    except (
        urllib.error.HTTPError,
        urllib.error.URLError,
        TimeoutError,
        json.JSONDecodeError,
        OSError,
    ) as e:
        print(f"русло nominatim R{RIVER_CENTERLINE_REL}: {type(e).__name__}")
        return None
    for h in hits or []:
        g = _shape_geojson(h.get("geojson"))
        if g is None or g.is_empty:
            continue
        return _clip_ll(g, bbox)
    return None


def inject_overlay_group(svg: str, group_xml: str) -> str:
    """Insert overlay after #regions. Never rewrite existing path d."""
    before = region_path_ds(svg)
    if not before:
        raise RuntimeError("в SVG нет контуров районов")
    svg = re.sub(
        r"\s*<g\b[^>]*id=\"water-overlay\"[^>]*>.*?</g>",
        "",
        svg,
        count=1,
        flags=re.S,
    )
    m = re.search(r'<g\b[^>]*id="regions"[^>]*>.*?</g>', svg, re.S | re.I)
    if not m:
        raise RuntimeError("нет группы regions")
    start, end = m.start(), m.end()
    if 'id="layer-stack"' not in svg:
        wrap = '<g id="layer-stack">\n    '
        svg = svg[:start] + wrap + svg[start:]
        end += len(wrap)
        svg = re.sub(r"</svg>", "  </g>\n</svg>", svg, count=1)
    svg = svg[:end] + "\n" + group_xml + svg[end:]
    after = region_path_ds(svg)
    if after != before:
        raise RuntimeError("оверлей сдвинул контуры районов — не пишем")
    return svg


def _river_flow_joined(
    reservoirs: list[dict],
    epsg: str,
    clip,
    simplify_m: float,
    bbox_ll: tuple[float, float, float, float],
) -> list[dict]:
    """River channel that docks to the reservoir polygons (does not cover them).

    Takes the Volga centerline, buffers it into a band, then subtracts the
    already-drawn reservoirs so the flow only fills the narrow river stretches
    between/outside the reservoirs.
    """
    line = fetch_volga_centerline(bbox_ll)
    if line is None or line.is_empty:
        print("русло: центрлиния Волги не получена", flush=True)
        return []
    line = to_meters(line, epsg)
    half = RIVER_HALF_W_M
    band = line.buffer(half)
    if not band.is_valid:
        band = band.buffer(0)
    band = band.intersection(clip)
    if band.is_empty:
        return []
    reservoir_union = unary_union([p["geom"] for p in reservoirs])
    flow = band.difference(reservoir_union)
    if flow.is_empty:
        return []
    water_simp = min(float(simplify_m), max(12.0, 0.12 * float(simplify_m)))
    if water_simp > 0:
        flow = flow.simplify(water_simp, preserve_topology=True)
    return [{"name": "Волга", "geom": flow, "area": flow.area}]


def overlay_water_on_svg(
    svg: str,
    feats: list[dict],
    lon: float,
    lat: float,
    layer_name: str = "Волга",
) -> str:
    """Paint river surface on top of an existing map. Districts stay as they are."""
    w0, h0 = _svg_wh(svg)
    frame = land_svg_frame(feats, lon, lat)
    if frame["W"] != w0 or frame["H"] != h0:
        raise RuntimeError(
            f"кадр SVG {w0}×{h0} ≠ пересчёт {frame['W']}×{frame['H']} — районы не трогаем"
        )
    water_feats = fetch_overlay_reservoir_feats(feats_bbox_ll(feats))
    water = _prepare_water(
        water_feats,
        frame["epsg"],
        box(frame["minx"], frame["miny"], frame["maxx"], frame["maxy"]),
        frame["simplify_m"],
    )
    clip_a = (frame["maxx"] - frame["minx"]) * (frame["maxy"] - frame["miny"])
    water = [p for p in water if p["area"] >= 0.001 * max(clip_a, 1.0)]
    if not water:
        raise RuntimeError("оверлей: в кадре нет площади водохранилища/реки")
    ids = [int(x) for x in re.findall(r'data-layer-id="(\d+)"', svg)]
    lid = max(ids or [1]) + 1
    paths = []
    for i, p in enumerate(water):
        d = geom_to_d(p["geom"], frame["sx"], frame["sy"], frame["minx"], frame["maxy"])
        if not d:
            continue
        name = _esc_name(p["name"])
        paths.append(
            f'<path d="{d}" fill="{WATER_FILL}" fill-opacity="{OVERLAY_WATER_OPACITY}" '
            f'data-region="w{i}" data-name="{name}"/>'
        )
    river = _river_flow_joined(
        water,
        frame["epsg"],
        box(frame["minx"], frame["miny"], frame["maxx"], frame["maxy"]),
        frame["simplify_m"],
        feats_bbox_ll(feats),
    )
    for i, p in enumerate(river):
        d = geom_to_d(p["geom"], frame["sx"], frame["sy"], frame["minx"], frame["maxy"])
        if not d:
            continue
        paths.append(
            f'<path d="{d}" fill="{WATER_FILL}" fill-opacity="{OVERLAY_WATER_OPACITY}" '
            f'data-region="w{len(water)+i}" data-name="{_esc_name(p["name"])}"/>'
        )
    if not paths:
        raise RuntimeError("оверлей: пустой path")
    group = (
        f'    <g id="water-overlay" data-layer-id="{lid}" data-layer-type="overlay" '
        f'data-layer-name="{_esc_name(layer_name)}">\n'
        + "\n".join("      " + p for p in paths)
        + "\n    </g>\n"
    )
    print("оверлей слой: " + ", ".join(p["name"] for p in water), flush=True)
    return inject_overlay_group(svg, group)


def overlay_water_on_project(slug: str, layer_name: str = "Волга") -> dict:
    """Add an isolated transparent water overlay. Does not rebuild districts."""
    dest = _safe_project_dir(slug)
    meta = find_map(slug)
    gj_path = dest / "districts.geojson"
    svg_path = dest / "map.svg"
    if not meta or not gj_path.is_file() or not svg_path.is_file():
        raise RuntimeError("нет карты проекта")
    gj = json.loads(gj_path.read_text(encoding="utf-8"))
    feats = load_gj_features(gj)
    lon = float(meta.get("lon") or 0)
    lat = float(meta.get("lat") or 0)
    old = svg_path.read_text(encoding="utf-8")
    before = region_path_ds(old)
    new = overlay_water_on_svg(old, feats, lon, lat, layer_name=layer_name)
    if region_path_ds(new) != before:
        raise RuntimeError("контуры районов изменились — файл не записан")
    svg_path.write_text(new, encoding="utf-8")
    st_path = dest / "state.json"
    layers = []
    state = {}
    if st_path.is_file():
        try:
            state = json.loads(st_path.read_text(encoding="utf-8"))
            layers = list(state.get("layers") or [])
        except json.JSONDecodeError:
            layers = []
    layers = [L for L in layers if str(L.get("name") or "") != layer_name]
    ids = [int(x) for x in re.findall(r'data-layer-id="(\d+)"', new)]
    lid = max(ids or [2])
    layers.append(
        {
            "id": lid,
            "name": layer_name,
            "type": "overlay",
            "visible": True,
            "locked": False,
            "collapsed": False,
        }
    )
    state["layers"] = layers
    state["layerSeq"] = max(int(state.get("layerSeq") or 1), lid)
    st_path.write_text(
        json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return meta


def load_gj_features(gj: dict) -> list[dict]:
    out = []
    for f in gj.get("features", []):
        props = f.get("properties") or {}
        name = feature_name(props)
        geom = shape(f["geometry"])
        if geom.is_empty:
            continue
        if not geom.is_valid:
            geom = geom.buffer(0)
        out.append({"name": name, "geom": geom})
    return out


def upsert_map(meta: dict) -> dict:
    cat = load_catalog()
    maps = cat.setdefault("maps", [])
    for i, m in enumerate(maps):
        if m.get("slug") == meta.get("slug"):
            maps[i] = meta
            save_catalog(cat)
            return meta
    maps.append(meta)
    save_catalog(cat)
    return meta


def write_meta(dest: Path, meta: dict) -> None:
    dest.mkdir(parents=True, exist_ok=True)
    (dest / "meta.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def empty_svg() -> str:
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<svg xmlns="http://www.w3.org/2000/svg" width="720" height="720" '
        'viewBox="0 0 720 720">\n'
        '  <rect width="720" height="720" fill="#F2E8D5"/>\n'
        '  <g id="regions"></g>\n'
        "</svg>\n"
    )


def next_project_name(cat: dict | None = None) -> str:
    cat = cat or load_catalog()
    names = {str(m.get("name") or "") for m in cat.get("maps", [])}
    n = 1
    while f"Проект {n}" in names:
        n += 1
    return f"Проект {n}"


def unique_slug(name: str) -> str:
    base = slugify(name)
    slug = base
    i = 2
    while (maps_dir() / slug).exists():
        slug = f"{base}-{i}"
        i += 1
    return slug


def create_project(name: str | None = None) -> dict:
    cat = load_catalog()
    name = (name or "").strip() or next_project_name(cat)
    slug = unique_slug(name)
    dest = maps_dir() / slug
    dest.mkdir(parents=True, exist_ok=True)
    (dest / "map.svg").write_text(empty_svg(), encoding="utf-8")
    meta = {
        "slug": slug,
        "name": name,
        "kind": "empty",
        "query": "",
        "osm_relation": None,
        "display": name,
        "zones": 0,
        "svg": f"maps/{slug}/map.svg",
    }
    write_meta(dest, meta)
    upsert_map(meta)
    print(f"проект {slug}")
    return meta


def find_map(slug: str) -> dict | None:
    for m in load_catalog().get("maps", []):
        if m.get("slug") == slug:
            return m
    path = maps_dir() / slug / "meta.json"
    if path.is_file():
        return json.loads(path.read_text(encoding="utf-8"))
    return None


def _safe_project_dir(slug: str) -> Path:
    slug = (slug or "").strip()
    if not slug or "/" in slug or "\\" in slug or ".." in slug:
        raise RuntimeError("плохой slug")
    root = maps_dir().resolve()
    dest = (maps_dir() / slug).resolve()
    try:
        dest.relative_to(root)
    except ValueError:
        raise RuntimeError("плохой slug")
    if dest == root:
        raise RuntimeError("плохой slug")
    return dest


def rename_project(slug: str, name: str) -> dict:
    name = (name or "").strip()
    if not name:
        raise RuntimeError("пустое имя")
    dest = _safe_project_dir(slug)
    meta = find_map(slug)
    if not meta:
        raise RuntimeError("нет проекта")
    meta["name"] = name
    write_meta(dest, meta)
    upsert_map(meta)
    return meta


def delete_project(slug: str) -> None:
    dest = _safe_project_dir(slug)
    cat = load_catalog()
    cat["maps"] = [m for m in cat.get("maps", []) if m.get("slug") != slug]
    save_catalog(cat)
    if dest.is_dir():
        shutil.rmtree(dest)


def build_from_hit(hit: dict, query: str) -> tuple[str, int, dict]:
    rel = int(hit["osm_id"])
    kind = place_kind(hit)
    ids = zone_rel_ids(rel, kind)
    print(f"relations={len(ids)} kind={kind}")
    gj = nominatim_geojson(ids)
    feats = load_gj_features(gj)
    if not feats:
        raise RuntimeError("нет геометрии у «" + (hit.get("name") or query) + "»")
    svg, npaths = svg_from_features(feats, float(hit["lon"]), float(hit["lat"]))
    return svg, npaths, gj


def inject_federal_cities(dest: Path, oblast_rel: int, lat: float, lon: float) -> dict:
    """Add SPB/Moscow into a saved oblast folder that was built without them."""
    extras = extra_city_ids(oblast_rel)
    if not extras:
        return {"added": 0, "zones": 0}
    dest = Path(dest)
    gj_path = dest / "districts.geojson"
    if gj_path.is_file():
        gj = json.loads(gj_path.read_text(encoding="utf-8"))
    else:
        gj = {"type": "FeatureCollection", "features": []}
    have = {
        feature_name(f.get("properties") or {})
        for f in gj.get("features") or []
    }
    extra_gj = nominatim_geojson(extras)
    added = 0
    for f in extra_gj.get("features") or []:
        nm = feature_name(f.get("properties") or {})
        if nm in have:
            continue
        gj.setdefault("features", []).append(f)
        have.add(nm)
        added += 1
    if not added:
        return {"added": 0, "zones": 0}
    feats = load_gj_features(gj)
    svg, npaths = svg_from_features(feats, lon, lat)
    (dest / "map.svg").write_text(svg, encoding="utf-8")
    gj_path.write_text(json.dumps(gj, ensure_ascii=False), encoding="utf-8")
    meta_path = dest / "meta.json"
    meta = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.is_file() else {}
    meta["zones"] = npaths
    write_meta(dest, meta)
    return {"added": added, "zones": npaths}


def _copy_built(src: Path, dest: Path) -> None:
    dest.mkdir(parents=True, exist_ok=True)
    for fname in ("map.svg", "districts.geojson", "water.geojson", "state.json"):
        p = src / fname
        if p.is_file():
            shutil.copy2(p, dest / fname)


def load_into_project(slug: str, query: str, hit: dict | None = None) -> dict:
    if "/" in slug or "\\" in slug or ".." in slug or not slug:
        raise RuntimeError("плохой slug")
    dest = maps_dir() / slug
    if not dest.is_dir():
        raise RuntimeError("нет проекта")
    prev = find_map(slug) or {}
    if hit is None:
        hits = search_regions(query)
        if not hits:
            raise RuntimeError("не найдено: " + query)
        hit = hits[0]
    rel = int(hit["osm_id"])
    kind = place_kind(hit)
    existing = None
    existing_dir = None
    for m in load_catalog().get("maps", []):
        if m.get("osm_relation") == rel and m.get("slug") != slug and m.get("zones"):
            src = maps_dir() / str(m["slug"])
            if (src / "map.svg").is_file():
                existing, existing_dir = m, src
                break
    if existing is None:
        sm, sdir = find_shared_build(rel, query or hit.get("name"))
        if sm is not None and sdir is not None:
            existing, existing_dir = sm, sdir
    if existing:
        _copy_built(existing_dir, dest)
        npaths = int(existing.get("zones") or 0)
        print(f"копия {existing.get('slug')} → {slug}")
    else:
        try:
            svg, npaths, gj = build_from_hit(hit, query)
        except RuntimeError as e:
            sm, sdir = find_shared_build(rel, query or hit.get("name"))
            if sm is None or sdir is None:
                raise
            _copy_built(sdir, dest)
            npaths = int(sm.get("zones") or 0)
            existing = sm
            print(f"Overpass fail, shared {sm.get('slug')} → {slug} ({e})")
        dest.mkdir(parents=True, exist_ok=True)
        (dest / "map.svg").write_text(svg, encoding="utf-8")
        (dest / "districts.geojson").write_text(
            json.dumps(gj, ensure_ascii=False), encoding="utf-8"
        )
    svg_path = dest / "map.svg"
    if svg_path.is_file() and 'id="water"' in svg_path.read_text(encoding="utf-8"):
        st = dest / "state.json"
        if not st.is_file():
            st.write_text(
                json.dumps(water_layer_state(), ensure_ascii=False, indent=2)
                + "\n",
                encoding="utf-8",
            )
    keep_name = prev.get("kind") not in (None, "empty") and not str(
        prev.get("name") or ""
    ).startswith("Проект ")
    meta = {
        "slug": slug,
        "name": prev.get("name") if keep_name else hit["name"],
        "kind": kind,
        "query": query,
        "osm_relation": rel,
        "display": hit.get("display") or hit["name"],
        "lat": hit.get("lat"),
        "lon": hit.get("lon"),
        "zones": npaths,
        "svg": f"maps/{slug}/map.svg",
    }
    write_meta(dest, meta)
    upsert_map(meta)
    print(f"OK {slug} · {npaths} зон · {kind}")
    return meta


def create_map(query: str, hit: dict | None = None) -> dict:
    if hit is None:
        hits = search_regions(query)
        if not hits:
            raise RuntimeError("регион не найден: " + query)
        hit = hits[0]
    rel = int(hit["osm_id"])
    slug = slugify(hit["name"], rel)
    dest = maps_dir() / slug
    meta_path = dest / "meta.json"
    svg_path = dest / "map.svg"
    if meta_path.exists() and svg_path.exists():
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        upsert_map(meta)
        print(f"есть {slug} · {meta.get('zones')} зон")
        return meta
    dest.mkdir(parents=True, exist_ok=True)
    svg, npaths, gj = build_from_hit(hit, query)
    (dest / "map.svg").write_text(svg, encoding="utf-8")
    (dest / "districts.geojson").write_text(
        json.dumps(gj, ensure_ascii=False), encoding="utf-8"
    )
    meta = {
        "slug": slug,
        "name": hit["name"],
        "kind": place_kind(hit),
        "query": query,
        "osm_relation": rel,
        "display": hit.get("display") or hit["name"],
        "lat": hit["lat"],
        "lon": hit["lon"],
        "zones": npaths,
        "svg": f"maps/{slug}/map.svg",
    }
    write_meta(dest, meta)
    upsert_map(meta)
    print(f"OK {slug} · {npaths} зон")
    return meta


def save_project(slug: str, svg: str | None = None, state=None) -> dict:
    if not slug or "/" in slug or "\\" in slug or ".." in slug:
        raise RuntimeError("плохой slug")
    dest = maps_dir() / slug
    dest.mkdir(parents=True, exist_ok=True)
    meta = find_map(slug) or {
        "slug": slug,
        "name": slug,
        "kind": "empty",
        "zones": 0,
        "svg": f"maps/{slug}/map.svg",
    }
    if svg:
        text = str(svg)
        if "<svg" not in text:
            raise RuntimeError("не svg")
        (dest / "map.svg").write_text(text, encoding="utf-8")
        meta["zones"] = text.count("data-name=")
        meta["svg"] = f"maps/{slug}/map.svg"
    if state is not None:
        (dest / "state.json").write_text(
            json.dumps(state, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    write_meta(dest, meta)
    upsert_map(meta)
    return meta


def load_project_bundle(slug: str) -> dict:
    if not slug or "/" in slug or "\\" in slug or ".." in slug:
        raise RuntimeError("плохой slug")
    dest = maps_dir() / slug
    svg_path = dest / "map.svg"
    if not svg_path.is_file():
        raise FileNotFoundError("нет svg")
    state = None
    st = dest / "state.json"
    if st.is_file():
        try:
            state = json.loads(st.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            state = None
    return {
        "map": find_map(slug) or {"slug": slug, "name": slug},
        "svg": svg_path.read_text(encoding="utf-8"),
        "state": state,
    }


def seed_samara() -> dict:
    src = ROOT / "prototype" / "map-osm-fills.svg"
    dest = maps_dir() / "samara"
    dest.mkdir(parents=True, exist_ok=True)
    old: dict = {}
    meta_path = dest / "meta.json"
    if meta_path.is_file():
        try:
            old = json.loads(meta_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            old = {}
    locked = old.get("kind") == "empty" or (
        old.get("osm_relation") not in (None, 72193)
    )
    if src.exists() and not locked:
        (dest / "map.svg").write_text(src.read_text(encoding="utf-8"), encoding="utf-8")
    gj = ROOT / "reference" / "samara-districts.geojson"
    if gj.exists() and not locked:
        (dest / "districts.geojson").write_bytes(gj.read_bytes())
    if locked and old:
        upsert_map(old)
        return old
    meta = {
        "slug": "samara",
        "name": old.get("name") or "Самарская область",
        "kind": "region",
        "query": "Самарская область",
        "osm_relation": 72193,
        "display": old.get("display") or "Самарская область",
        "lat": 53.2,
        "lon": 50.2,
        "zones": 27,
        "svg": "maps/samara/map.svg",
    }
    write_meta(dest, meta)
    cat = load_catalog()
    if not any(m.get("slug") == "samara" for m in cat.get("maps", [])):
        cat.setdefault("maps", []).insert(0, meta)
        save_catalog(cat)
    else:
        upsert_map(meta)
    return meta


if __name__ == "__main__":
    import sys

    maps_dir().mkdir(parents=True, exist_ok=True)
    seed_samara()
    if len(sys.argv) > 1:
        create_map(" ".join(sys.argv[1:]))
    else:
        print("usage: map_catalog.py <название региона>")
