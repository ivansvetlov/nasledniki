#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Publish workshop geometry as versioned snapshots (no product style)."""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PUB = ROOT / "published"

_RU = str.maketrans(
    {
        "а": "a",
        "б": "b",
        "в": "v",
        "г": "g",
        "д": "d",
        "е": "e",
        "ё": "e",
        "ж": "zh",
        "з": "z",
        "и": "i",
        "й": "y",
        "к": "k",
        "л": "l",
        "м": "m",
        "н": "n",
        "о": "o",
        "п": "p",
        "р": "r",
        "с": "s",
        "т": "t",
        "у": "u",
        "ф": "f",
        "х": "h",
        "ц": "ts",
        "ч": "ch",
        "ш": "sh",
        "щ": "sch",
        "ъ": "",
        "ы": "y",
        "ь": "",
        "э": "e",
        "ю": "yu",
        "я": "ya",
    }
)

# Product-friendly ids for Samara expeditions (ТЗ: карта путешествий).
ZONE_ALIASES = {
    "сызранский": "syzran",
    "ставропольский": "stavropol",
    "волжский": "volzhsky",
    "кинельский": "kinel",
    "кинель-черкасский": "kinel-cherkassky",
    "безенчукский": "bezenchuk",
    "приволжский": "privolzhsky",
    "шигонский": "shigonsky",
    "елховский": "elkhovsky",
    "кошкинский": "koshkinsky",
    "сергиевский": "sergievsky",
    "красноярский": "krasnoyarsk",
    "нефтегорский": "neftegorsk",
    "похвистневский": "pohvistnevo",
    "алексеевский": "alexeevsky",
    "богатовский": "bogatovsky",
    "борский": "borsky",
    "большеглушицкий": "bolsheglushitsky",
    "большечерниговский": "bolshechernigovsky",
    "исаклинский": "isaklinsky",
    "камышлинский": "kamyshlinsky",
    "клявлинский": "klyavlinsky",
    "красноармейский": "krasnoarmeysky",
    "пестравский": "pestravsky",
    "хворостянский": "khvorostyansky",
    "челно-вершинский": "chelno-vershinsky",
    "шенталинский": "shentalinsky",
}

PATH_TAG = re.compile(r"<path\b([^>]*)/?>", re.I)
ATTR = re.compile(r'([:\w-]+)\s*=\s*"([^"]*)"')
VB = re.compile(r'viewBox="([^"]+)"', re.I)
NUM = re.compile(r"-?\d+(?:\.\d+)?")


def short_name(name: str) -> str:
    n = str(name or "")
    n = re.sub(r"\s*муниципальный район$", "", n, flags=re.I)
    n = re.sub(r"\s*муниципальный округ$", "", n, flags=re.I)
    n = re.sub(r"\s*городской округ$", "", n, flags=re.I)
    n = re.sub(r"^городской округ\s+", "", n, flags=re.I)
    n = re.sub(r"\s*район$", "", n, flags=re.I)
    return n.strip()


def zone_id(name: str) -> str:
    short = short_name(name).lower().replace("ё", "е")
    if short in ZONE_ALIASES:
        return ZONE_ALIASES[short]
    slug = short.translate(_RU)
    slug = re.sub(r"[^a-z0-9]+", "-", slug).strip("-") or "zone"
    return slug[:48]


def _attrs(blob: str) -> dict:
    return {m.group(1): m.group(2) for m in ATTR.finditer(blob)}


def rings_from_d(d: str) -> list[list[tuple[float, float]]]:
    rings = []
    for part in re.split(r"[Zz]", d or ""):
        nums = NUM.findall(part)
        if len(nums) < 6:
            continue
        pts = [
            (float(nums[i]), float(nums[i + 1]))
            for i in range(0, len(nums) - 1, 2)
        ]
        if pts[0] != pts[-1]:
            pts.append(pts[0])
        rings.append(pts)
    return rings


def d_from_rings(rings: list[list[tuple[float, float]]]) -> str:
    chunks = []
    for pts in rings:
        if len(pts) < 3:
            continue
        bits = [f"M{pts[0][0]:.2f},{pts[0][1]:.2f}"]
        for x, y in pts[1:]:
            bits.append(f"L{x:.2f},{y:.2f}")
        bits.append("Z")
        chunks.append(" ".join(bits))
    return " ".join(chunks)


def parse_svg(svg: str) -> dict:
    vb = "0 0 720 720"
    m = VB.search(svg or "")
    if m:
        vb = m.group(1)
    zones = []
    seen = {}
    for tag in PATH_TAG.finditer(svg or ""):
        a = _attrs(tag.group(1))
        name = a.get("data-name")
        d = a.get("d")
        if not name or not d:
            continue
        zid = zone_id(name)
        if zid in seen:
            seen[zid] += 1
            zid = f"{zid}-{seen[zid]}"
        else:
            seen[zid] = 1
        zones.append(
            {
                "id": zid,
                "name": name,
                "short": short_name(name),
                "kind": "district",
                "d": d,
                "fill": a.get("fill") or "",
            }
        )
    parts = vb.split()
    w = float(parts[2]) if len(parts) > 2 else 720
    h = float(parts[3]) if len(parts) > 3 else 720
    return {"viewBox": vb, "width": w, "height": h, "zones": zones}


def snapshot_from_svg(map_id: str, svg: str, meta: dict | None = None) -> dict:
    geom = parse_svg(svg)
    meta = meta or {}
    return {
        "id": map_id,
        "title": meta.get("name") or map_id,
        "kind": meta.get("kind") or "region",
        "version": 1,
        "viewBox": geom["viewBox"],
        "width": geom["width"],
        "height": geom["height"],
        "crs": "svg-local",
        "zones": geom["zones"],
        "source": {
            "slug": meta.get("slug") or map_id,
            "osm_relation": meta.get("osm_relation"),
        },
        "published_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }


def _index_path() -> Path:
    return PUB / "index.json"


def load_index() -> dict:
    p = _index_path()
    if p.is_file():
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            pass
    return {"maps": []}


def save_index(idx: dict) -> None:
    PUB.mkdir(parents=True, exist_ok=True)
    _index_path().write_text(
        json.dumps(idx, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def map_dir(map_id: str) -> Path:
    return PUB / map_id


def latest_version(map_id: str) -> int:
    d = map_dir(map_id)
    if not d.is_dir():
        return 0
    vers = []
    for p in d.iterdir():
        if p.is_dir() and p.name.startswith("v"):
            try:
                vers.append(int(p.name[1:]))
            except ValueError:
                continue
    return max(vers) if vers else 0


def publish(map_id: str, svg: str, meta: dict | None = None) -> dict:
    map_id = re.sub(r"[^a-zA-Z0-9_\u0400-\u04ff-]+", "-", map_id).strip("-") or "map"
    snap = snapshot_from_svg(map_id, svg, meta)
    n = latest_version(map_id) + 1
    snap["version"] = n
    dest = map_dir(map_id) / f"v{n}"
    dest.mkdir(parents=True, exist_ok=True)
    (dest / "geometry.json").write_text(
        json.dumps(snap, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    latest = map_dir(map_id) / "latest.json"
    latest.write_text(
        json.dumps({"id": map_id, "version": n}, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    idx = load_index()
    maps = [m for m in idx.get("maps") or [] if m.get("id") != map_id]
    maps.append(
        {
            "id": map_id,
            "title": snap["title"],
            "version": n,
            "zones": len(snap["zones"]),
            "published_at": snap["published_at"],
        }
    )
    idx["maps"] = maps
    save_index(idx)
    return snap


def load_geometry(map_id: str, version: int | None = None) -> dict:
    if version is None:
        lp = map_dir(map_id) / "latest.json"
        if lp.is_file():
            version = int(json.loads(lp.read_text(encoding="utf-8"))["version"])
        else:
            version = latest_version(map_id)
    if not version:
        raise FileNotFoundError("нет публикации")
    path = map_dir(map_id) / f"v{version}" / "geometry.json"
    if not path.is_file():
        raise FileNotFoundError("нет версии")
    return json.loads(path.read_text(encoding="utf-8"))


def filter_zones(geom: dict, ids: list[str] | None) -> dict:
    if not ids:
        return geom
    want = {i.strip() for i in ids if i.strip()}
    out = dict(geom)
    out["zones"] = [
        z
        for z in geom.get("zones") or []
        if z.get("id") in want or z.get("name") in want
    ]
    return out


def list_maps() -> list[dict]:
    return load_index().get("maps") or []
