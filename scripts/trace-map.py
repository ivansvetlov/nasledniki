#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""trace-map.py — превращает карту областей (jpg, монохром, заливки по оттенкам)
в стилизованный двухслойный SVG: слой зон (заливки областей) + отключаемый
слой городов (точки с названиями).

Вход:  reference/samara-oblast-map.jpg
Выход: prototype/map-traced.svg  (SVG, 2 слоя)

Использование:
  python trace-map.py
"""
from __future__ import annotations

import cv2
import numpy as np
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "reference" / "samara-oblast-map.jpg"
OUT = ROOT / "prototype" / "map-traced.svg"

# оттенки-заливки областей: тон -> фирменный цвет (можно перекрасить позже)
ZONE_PALETTE = {
    221: "#F0DFB8",  # песочный
    238: "#DDE3C8",  # хаки-светлый
}


def contour_to_path(contour, eps_ratio=0.006) -> str:
    peri = cv2.arcLength(contour, True)
    poly = cv2.approxPolyDP(contour, eps_ratio * peri, True)
    pts = poly.reshape(-1, 2)
    d = f"M{pts[0][0]},{pts[0][1]} "
    for x, y in pts[1:]:
        d += f"L{x},{y} "
    d += "Z"
    return d


def main() -> int:
    if not SRC.exists():
        print(f"нет входа: {SRC}")
        return 1
    img = cv2.imread(str(SRC), cv2.IMREAD_GRAYSCALE)
    h, w = img.shape
    print(f"карта: {w}x{h}")

    # ── слой зон: оттенки → контуры областей ──
    zone_paths = []
    for tone, color in ZONE_PALETTE.items():
        mask = (img == tone).astype(np.uint8) * 255
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        for c in contours:
            if cv2.contourArea(c) > w * h * 0.01:
                zone_paths.append((color, contour_to_path(c)))
    print(f"зон-областей: {len(zone_paths)}")

    # ── слой городов: тёмные кружки → точки ──
    dark = (img < 80).astype(np.uint8) * 255
    dark = cv2.morphologyEx(dark, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    cc, _ = cv2.findContours(dark, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    cities = []
    for c in cc:
        area = cv2.contourArea(c)
        if 8 < area < 300:
            M = cv2.moments(c)
            if M["m00"] > 0:
                cx, cy = M["m10"] / M["m00"], M["m01"] / M["m00"]
                cities.append((int(cx), int(cy), int(area)))
    print(f"городов-точек: {len(cities)}")

    # ── сборка SVG ──
    zones_svg = "\n".join(
        f'<path d="{d}" fill="{color}" stroke="#5A4B33" stroke-width="1.6" stroke-linejoin="round"/>'
        for color, d in zone_paths
    )
    cities_svg = "\n".join(
        f'<circle cx="{x}" cy="{y}" r="{3 + area / 25:.1f}" fill="#2B2317"/>'
        for x, y, area in cities
    )

    svg = f"""<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">
  <rect width="{w}" height="{h}" fill="#F2E8D5"/>
  <!-- СЛОЙ 1: зоны областей -->
  <g id="zones">
{zones_svg}
  </g>
  <!-- СЛОЙ 2: города (отключаемый) -->
  <g id="cities">
{cities_svg}
  </g>
</svg>
"""
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(svg, encoding="utf-8")
    print(f"OK: {OUT} ({len(svg)} bytes, {len(zone_paths)} зон, {len(cities)} городов)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
