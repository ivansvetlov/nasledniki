#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Style store: paint published geometry without mutating workshop SVG."""
from __future__ import annotations

from map_publish import d_from_rings, rings_from_d

PAPER = "#F2E8D5"
INK = "#2B2317"

ATLAS_PALETTE = [
    "#EAD9BC",
    "#DDE3C8",
    "#F0DFB8",
    "#D7E0CF",
    "#EFDCC9",
    "#E3E0CC",
    "#EDD8C0",
    "#DBE2C9",
    "#F2E0C0",
    "#D9E1CE",
]
JOURNAL_PALETTE = [
    "#DDE3C8",
    "#F0DFB8",
    "#E7EFDA",
    "#F3E6C8",
    "#F6E7D6",
    "#E9DCC2",
    "#D5C9A8",
    "#EAD9BC",
]


def chaikin(pts: list[tuple[float, float]], closed: bool = True) -> list[tuple[float, float]]:
    if len(pts) < 4:
        return pts
    ring = pts[:-1] if closed and pts[0] == pts[-1] else list(pts)
    n = len(ring)
    out: list[tuple[float, float]] = []
    last = n if closed else n - 1
    if not closed:
        out.append(ring[0])
    for i in range(last):
        ax, ay = ring[i]
        bx, by = ring[(i + 1) % n]
        out.append((0.75 * ax + 0.25 * bx, 0.75 * ay + 0.25 * by))
        out.append((0.25 * ax + 0.75 * bx, 0.25 * ay + 0.75 * by))
    if not closed:
        out.append(ring[-1])
    if closed and out and out[0] != out[-1]:
        out.append(out[0])
    return out


def smooth_d(d: str, iters: int) -> str:
    if iters <= 0 or not d:
        return d
    rings = rings_from_d(d)
    sm = []
    for r in rings:
        p = r
        for _ in range(iters):
            p = chaikin(p, closed=True)
        sm.append(p)
    return d_from_rings(sm) or d


THEMES = {
    "atlas-plain": {
        "id": "atlas-plain",
        "title": "Атлас",
        "shop": True,
        "desc": "как в мастерской: пастель, щель = подложка, без обводки",
        "paper": PAPER,
        "smooth": 0,
        "stroke": "none",
        "stroke_width": 0,
        "palette": ATLAS_PALETTE,
        "hatch": False,
        "font": "system-ui,sans-serif",
    },
    "nasedniki-journal": {
        "id": "nasedniki-journal",
        "title": "Журнал Наследника",
        "shop": True,
        "desc": "как prototype/map.html: бумага, штрих, sage/gold, пины",
        "paper": PAPER,
        "smooth": 2,
        "stroke": "rgba(43,35,23,.4)",
        "stroke_width": 1.5,
        "palette": JOURNAL_PALETTE,
        "hatch": True,
        "font": "Oswald,sans-serif",
        "accent": "#B4552D",
    },
    "nasedniki-flow": {
        "id": "nasedniki-flow",
        "title": "Обтекание",
        "shop": True,
        "desc": "сильное Chaikin-сглаживание контуров (будущий стиль витрины), геометрия цеха не меняется",
        "paper": "#EFE3C8",
        "smooth": 3,
        "stroke": "rgba(43,35,23,.18)",
        "stroke_width": 0.45,
        "palette": JOURNAL_PALETTE,
        "hatch": True,
        "font": "Oswald,sans-serif",
        "accent": "#B4552D",
    },
}


def get_theme(theme_id: str) -> dict:
    return dict(THEMES.get(theme_id) or THEMES["atlas-plain"])


def list_themes() -> list[dict]:
    return [
        {
            "id": t["id"],
            "title": t["title"],
            "desc": t["desc"],
            "shop": t.get("shop", False),
        }
        for t in THEMES.values()
    ]


def paint_zone(zone: dict, index: int, theme: dict) -> dict:
    pal = theme.get("palette") or ATLAS_PALETTE
    fill = pal[index % len(pal)]
    d = zone.get("d") or ""
    iters = int(theme.get("smooth") or 0)
    if iters:
        d = smooth_d(d, iters)
    out = dict(zone)
    out["d"] = d
    out["paint"] = fill
    return out


def render_svg(geom: dict, theme_id: str = "atlas-plain") -> str:
    theme = get_theme(theme_id)
    vb = geom.get("viewBox") or "0 0 720 720"
    paper = theme.get("paper") or PAPER
    sw = theme.get("stroke_width") or 0
    stroke = theme.get("stroke") or "none"
    hatch = bool(theme.get("hatch"))
    defs = ""
    if hatch:
        defs = (
            "<defs>"
            '<pattern id="hatch" width="8" height="8" patternUnits="userSpaceOnUse">'
            f'<path d="M0 8 L8 0" stroke="{INK}" stroke-width=".4" opacity=".18"/>'
            "</pattern>"
            "</defs>"
        )
    paths = []
    for i, z in enumerate(geom.get("zones") or []):
        pz = paint_zone(z, i, theme)
        extra = ""
        if hatch:
            extra = f'<path d="{pz["d"]}" fill="url(#hatch)" pointer-events="none"/>'
        paths.append(
            f'<g class="zone" data-id="{pz["id"]}" data-name="{_esc(pz.get("name") or "")}">'
            f'<path d="{pz["d"]}" fill="{pz["paint"]}" stroke="{stroke}" '
            f'stroke-width="{sw}" fill-rule="evenodd"/>'
            f"{extra}</g>"
        )
    return (
        f'<?xml version="1.0" encoding="UTF-8"?>\n'
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}" '
        f'width="{geom.get("width") or 720}" height="{geom.get("height") or 720}">\n'
        f"{defs}"
        f'<rect width="100%" height="100%" fill="{paper}"/>\n'
        + "\n".join(paths)
        + "\n</svg>\n"
    )


def _esc(s: str) -> str:
    return (
        str(s)
        .replace("&", "&amp;")
        .replace('"', "&quot;")
        .replace("<", "&lt;")
    )
