#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""make-svg.py — JPG карты → SVG заливок районов. Без Paint, без обводки.

Вход:  reference/samara-oblast-map.jpg
Выход: prototype/map-fills-only.svg

Рабочая модель — растровая разметка (пиксель → id района).
В SVG уходит только контур каждой метки: список вершин (x, y) + fill.
Цвет не хранится в точках. Слоя границ нет: щель между районами = подложка.

См. docs/MAP-PIPELINE.md.
"""
from __future__ import annotations

import cv2
import numpy as np
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "reference" / "samara-oblast-map.jpg"
OUT = ROOT / "prototype" / "map-fills-only.svg"
DIAG = ROOT / "prototype" / "_iter1-labels.png"

PALETTE = [
    "#EAD9BC", "#DDE3C8", "#F0DFB8", "#D7E0CF", "#EFDCC9",
    "#E3E0CC", "#EDD8C0", "#DBE2C9", "#F2E0C0", "#D9E1CE",
]
BG = "#F2E8D5"
MIN_AREA = 700
LINE_T = 120          # темнее — кандидат в чернила (линии/текст/точки)
DILATE_ITERS = 2      # «пожирнее», вместо Paint
EPS_PX = 1.2          # упрощение контура в пикселях, не доля периметра


def territory_mask(gray: np.ndarray) -> np.ndarray:
    m = (gray < 250).astype(np.uint8) * 255
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8))
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    cnts, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not cnts:
        raise RuntimeError("территория не найдена")
    out = np.zeros_like(gray)
    cv2.drawContours(out, [max(cnts, key=cv2.contourArea)], -1, 255, -1)
    return out


def ink_components(gray: np.ndarray, terr: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    dark = ((gray < LINE_T) & (terr > 0)).astype(np.uint8)
    closed = cv2.morphologyEx(dark, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    n, labels, stats, _ = cv2.connectedComponentsWithStats(closed, connectivity=8)
    return labels, stats, closed


def inpaint_debris(gray: np.ndarray, labels: np.ndarray, stats: np.ndarray) -> np.ndarray:
    """Главная связная компонента чернил = сеть границ. Остальное (буквы, точки) затираем."""
    if stats.shape[0] < 2:
        return gray
    areas = stats[1:, 4]
    main = 1 + int(np.argmax(areas))
    debris = ((labels > 0) & (labels != main)).astype(np.uint8) * 255
    if int(debris.sum()) == 0:
        return gray
    return cv2.inpaint(gray, debris, 3, cv2.INPAINT_TELEA)


def line_mask(gray: np.ndarray, terr: np.ndarray) -> np.ndarray:
    labels, stats, closed = ink_components(gray, terr)
    if stats.shape[0] < 2:
        return closed
    areas = stats[1:, 4]
    main = 1 + int(np.argmax(areas))
    lines = (labels == main).astype(np.uint8)
    # обрывки линий, не прилипшие к сети
    for i in range(1, stats.shape[0]):
        if i == main:
            continue
        x, y, bw, bh, a = stats[i]
        long_thin = a > 80 and max(bw, bh) > 40 and min(bw, bh) < 14
        if long_thin:
            lines[labels == i] = 1
    return lines


def extract_regions(gray: np.ndarray) -> tuple[list[np.ndarray], np.ndarray]:
    terr = territory_mask(gray)
    labels0, stats0, _ = ink_components(gray, terr)
    cleaned = inpaint_debris(gray, labels0, stats0)
    lines = line_mask(cleaned, terr)
    thick = cv2.dilate(lines, np.ones((3, 3), np.uint8), iterations=DILATE_ITERS)
    cells = ((terr > 0) & (thick == 0)).astype(np.uint8)
    n, labels, stats, _ = cv2.connectedComponentsWithStats(cells, connectivity=4)
    regions = [i for i in range(1, n) if stats[i][4] >= MIN_AREA]
    regions.sort(key=lambda i: -stats[i][4])
    return regions, labels


def contour_to_d(contour: np.ndarray, eps_px: float = EPS_PX) -> str:
    poly = cv2.approxPolyDP(contour, eps_px, True)
    pts = poly.reshape(-1, 2)
    if len(pts) < 3:
        return ""
    parts = [f"M{int(pts[0][0])},{int(pts[0][1])}"]
    parts += [f"L{int(x)},{int(y)}" for x, y in pts[1:]]
    parts.append("Z")
    return " ".join(parts)


def write_svg(paths: list[tuple[str, str, int]], w: int, h: int, dest: Path) -> None:
    body = []
    for d, color, idx in paths:
        body.append(f'<path d="{d}" fill="{color}" data-region="r{idx}"/>')
    svg = (
        f'<?xml version="1.0" encoding="UTF-8"?>\n'
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" '
        f'viewBox="0 0 {w} {h}">\n'
        f'  <rect width="{w}" height="{h}" fill="{BG}"/>\n'
        f'  <g id="regions">\n'
        + "\n".join(body)
        + "\n  </g>\n</svg>\n"
    )
    dest.write_text(svg, encoding="utf-8")


def save_label_preview(labels: np.ndarray, regions: list[int], dest: Path) -> None:
    h, w = labels.shape
    vis = np.full((h, w, 3), 242, np.uint8)
    vis[:, :] = (0xF2, 0xE8, 0xD5)
    rng = np.array(
        [
            [234, 217, 188], [221, 227, 200], [240, 223, 184], [215, 224, 207],
            [239, 220, 201], [227, 224, 204], [237, 216, 192], [219, 226, 201],
            [242, 224, 192], [217, 225, 206],
        ],
        dtype=np.uint8,
    )
    for idx, ri in enumerate(regions):
        vis[labels == ri] = rng[idx % len(rng)]
    cv2.imwrite(str(dest), cv2.cvtColor(vis, cv2.COLOR_RGB2BGR))


def main() -> int:
    if not SRC.exists():
        print(f"нет входа: {SRC}")
        return 1
    gray = cv2.imread(str(SRC), cv2.IMREAD_GRAYSCALE)
    h, w = gray.shape
    print(f"вход: {SRC.name} {w}x{h}")

    regions, labels = extract_regions(gray)
    print(f"районов: {len(regions)}")

    paths: list[tuple[str, str, int]] = []
    for idx, ri in enumerate(regions):
        mask = (labels == ri).astype(np.uint8)
        cnts, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
        if not cnts:
            continue
        d = contour_to_d(max(cnts, key=cv2.contourArea))
        if d:
            paths.append((d, PALETTE[idx % len(PALETTE)], idx))

    write_svg(paths, w, h, OUT)
    save_label_preview(labels, regions, DIAG)
    has_stroke = "stroke" in OUT.read_text(encoding="utf-8")
    print(f"OK: {OUT} · {len(paths)} path · stroke={has_stroke} · diag={DIAG.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
