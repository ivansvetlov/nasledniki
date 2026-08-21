#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""НаСЛЕДНИКИ product face: pull published geometry + apply a shop style."""
from __future__ import annotations

from map_publish import filter_zones, load_geometry, rings_from_d
from map_themes import get_theme, list_themes, paint_zone, render_svg

# Overlay lives in the product, not in the workshop.
EXPEDITIONS = [
    {
        "id": "syzran",
        "title": "Сызрань",
        "subtitle": "Секреты купеческого города",
        "zone_ids": ["syzran"],
        "open": True,
    },
    {
        "id": "tolyatti",
        "title": "Тольятти",
        "subtitle": "лодка · техника",
        "zone_ids": ["stavropol"],
        "open": True,
    },
    {
        "id": "zhigulevsk",
        "title": "Жигулёвск",
        "subtitle": "горы · штольни",
        "zone_ids": ["stavropol"],
        "open": False,
    },
    {
        "id": "samara-city",
        "title": "Самара",
        "subtitle": "театр · музеи",
        "zone_ids": ["volzhsky"],
        "open": True,
    },
]


def _centroid(d: str) -> dict | None:
    rings = rings_from_d(d or "")
    if not rings:
        return None
    pts = rings[0]
    if len(pts) > 1 and pts[0] == pts[-1]:
        pts = pts[:-1]
    if not pts:
        return None
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    return {
        "x": round(sum(xs) / len(xs), 1),
        "y": round(sum(ys) / len(ys), 1),
    }


def _pin_for(zone: dict | None, exp_id: str) -> dict | None:
    if not zone:
        return None
    c = _centroid(zone.get("d") or "")
    if not c:
        return None
    if exp_id == "zhigulevsk":
        c["x"] -= 22
        c["y"] -= 18
    elif exp_id == "tolyatti":
        c["x"] += 18
        c["y"] += 8
    return c


def assemble(
    map_id: str = "samara",
    style: str = "nasedniki-journal",
    ids: list[str] | None = None,
    version: int | None = None,
) -> dict:
    geom = load_geometry(map_id, version)
    geom = filter_zones(geom, ids)
    theme = get_theme(style)
    zones = [paint_zone(z, i, theme) for i, z in enumerate(geom.get("zones") or [])]
    by_id = {z["id"]: z for z in zones}
    opened = {z for e in EXPEDITIONS if e.get("open") for z in e.get("zone_ids") or []}
    trips = []
    for e in EXPEDITIONS:
        zid = (e.get("zone_ids") or [None])[0]
        pin = _pin_for(by_id.get(zid), e["id"])
        item = dict(e)
        item["pin"] = pin
        trips.append(item)
    return {
        "product": "nasedniki",
        "map": {
            "id": geom.get("id"),
            "title": geom.get("title"),
            "version": geom.get("version"),
            "viewBox": geom.get("viewBox"),
            "width": geom.get("width"),
            "height": geom.get("height"),
        },
        "theme": {
            "id": theme["id"],
            "title": theme["title"],
            "desc": theme["desc"],
            "paper": theme["paper"],
            "smooth": theme["smooth"],
            "hatch": bool(theme.get("hatch")),
            "stroke": theme.get("stroke") or "rgba(43,35,23,.4)",
            "stroke_width": theme.get("stroke_width") or 1.2,
            "accent": theme.get("accent") or "#B4552D",
        },
        "themes": list_themes(),
        "zones": zones,
        "overlay": {
            "expeditions": trips,
            "opened_zone_ids": sorted(opened),
        },
    }


def assemble_svg(
    map_id: str = "samara",
    style: str = "nasedniki-journal",
    ids: list[str] | None = None,
    version: int | None = None,
) -> str:
    geom = filter_zones(load_geometry(map_id, version), ids)
    return render_svg(geom, style)
