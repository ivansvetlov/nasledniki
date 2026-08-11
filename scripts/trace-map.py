#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""trace-map.py — извлекает границы и области из монохромной карты областей.

Описание карты (от пользователя):
  - Вся карта монохромная с оттенками.
  - Единый контур всей территории (все области вместе) — внешняя граница.
  - Каждая область залита своим оттенком (оттенки могут повторяться).
  - Внутри заливок — тёмные кружки = областные столицы (города).
  - Текст вокруг карты (названия соседних областей, масштаб) — игнорируем.

Алгоритм:
  1. Маска «территория» = пиксели темнее 250 → морфология (close/open) →
     внешний контур = единая граница карты.
  2. Внутри территории: оттенки-заливки (светлые: ~218..254) → связные
     компоненты = области. Тёмные линии границ (яркость < 200) разделяют их.
  3. Города: тёмные кружки (яркость < 80), площадь 8..300 px → точки.
  4. SVG: слой zones (области, разные заливки) + слой cities (отключаемый).

Выход: prototype/map-traced.svg
"""
from __future__ import annotations

import cv2
import numpy as np
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "reference" / "samara-oblast-map.jpg"
OUT = ROOT / "prototype" / "map-traced.svg"

# палитра заливок областей (чередование, чтобы соседи не совпадали)
FILL_PALETTE = ["#E8DCC0", "#DDE3C8", "#F0DFB8", "#E7E0D0", "#E2E6D2", "#EFE4C8",
                "#E5DAC4", "#D9E0CC", "#EBE2C0", "#DDE2CE"]


def contour_to_path(contour, eps_ratio=0.004) -> str:
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

    # ── 1. единый внешний контур территории ──
    mask_map = (img < 250).astype(np.uint8) * 255
    mask_map = cv2.morphologyEx(mask_map, cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8))
    mask_map = cv2.morphologyEx(mask_map, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    contours, _ = cv2.findContours(mask_map, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        print("контур территории не найден")
        return 1
    territory = max(contours, key=cv2.contourArea)
    terr_area = cv2.contourArea(territory)
    print(f"территория: {terr_area:.0f} px ({terr_area/(w*h)*100:.1f}%), точек={len(territory)}")

    # маска-заливка территории (для внутренних областей)
    m_terr = np.zeros_like(img)
    cv2.drawContours(m_terr, [territory], -1, 255, -1)

    # ── 2. области внутри: связные компоненты заливочных оттенков ──
    # оттенки-заливки: светлые (180..250), НЕ белый фон 255, НЕ тёмные границы (<200)
    fill_mask = np.zeros_like(img)
    for y in range(h):
        for x in range(w):
            v = int(img[y, x])
            if m_terr[y, x] == 255 and 180 <= v < 250:
                fill_mask[y, x] = 255

    # уберём мелкий шум, оставим крупные области
    fill_mask = cv2.morphologyEx(fill_mask, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    cc, _ = cv2.findContours(fill_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    zones = []
    for c in cc:
        a = cv2.contourArea(c)
        if a > w * h * 0.004:  # крупные области
            zones.append(c)
    print(f"областей-заливок: {len(zones)}")

    # ── 3. города: тёмные кружки ──
    dark = (img < 80).astype(np.uint8) * 255
    dark = cv2.morphologyEx(dark, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    ccc, _ = cv2.findContours(dark, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    cities = []
    for c in ccc:
        a = cv2.contourArea(c)
        if 8 < a < 300 and m_terr[c[0][0][1], c[0][0][0]] == 255:
            M = cv2.moments(c)
            if M["m00"] > 0:
                cx, cy = M["m10"] / M["m00"], M["m01"] / M["m00"]
                cities.append((int(cx), int(cy), int(a)))
    print(f"городов: {len(cities)}")

    # ── 4. SVG ──
    zone_paths = []
    for i, c in enumerate(sorted(zones, key=cv2.contourArea, reverse=True)):
        color = FILL_PALETTE[i % len(FILL_PALETTE)]
        zone_paths.append(f'<path d="{contour_to_path(c)}" fill="{color}" stroke="#5A4B33" stroke-width="1.4" stroke-linejoin="round"/>')

    territory_path = (
        f'<path d="{contour_to_path(territory)}" fill="none" stroke="#2B2317" '
        f'stroke-width="3" stroke-linejoin="round" opacity="0.9"/>'
    )
    cities_svg = "\n".join(
        f'<circle cx="{x}" cy="{y}" r="{max(3, 3 + a / 30):.1f}" fill="#2B2317"/>'
        for x, y, a in cities
    )

    svg = f"""<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">
  <rect width="{w}" height="{h}" fill="#F2E8D5"/>
  <!-- СЛОЙ 1: области (заливки) -->
  <g id="zones">
{"\n".join(zone_paths)}
{territory_path}
  </g>
  <!-- СЛОЙ 2: города (отключаемый) -->
  <g id="cities">
{cities_svg}
  </g>
</svg>
"""
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(svg, encoding="utf-8")
    print(f"OK: {OUT} · {len(zone_paths)} областей, {len(cities)} городов, {len(svg)} bytes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
