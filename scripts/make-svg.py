#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""make-svg.py — собирает финальный SVG карты из доработанных в Paint границ.

Вход: reference/paint-editable/1-borders.png  (белые линии границ, жирные)
      reference/paint-editable/3-fill-zones.png (заливки областей, ориентир)
Выход: prototype/map-final.svg

Алгоритм:
  1. Границы (белые) → тонкий скелет (erode до ~2px), сглаживание.
  2. Чёрные ячейки между границами = области (connectedComponents, без края).
  3. Каждая область = отдельная сущность: свой цвет-заливка + id.
  4. Собираем SVG: <path> областей (заливки) + слой границ (толщина 2) + опционально точки.
"""
from __future__ import annotations

import cv2
import numpy as np
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BORDERS = ROOT / "reference" / "paint-editable" / "1-borders.png"
OUT = ROOT / "prototype" / "map-final.svg"

PALETTE = ["#EAD9BC", "#DDE3C8", "#F0DFB8", "#D7E0CF", "#EFDCC9", "#E3E0CC",
           "#EDD8C0", "#DBE2C9", "#F2E0C0", "#D9E1CE"]


def contour_to_path(contour, eps=0.003) -> str:
    peri = cv2.arcLength(contour, True)
    poly = cv2.approxPolyDP(contour, eps * peri, True)
    pts = poly.reshape(-1, 2)
    if len(pts) < 3:
        return ""
    d = f"M{pts[0][0]},{pts[0][1]} "
    for x, y in pts[1:]:
        d += f"L{x},{y} "
    d += "Z"
    return d


def zhang_suen(bin_img: np.ndarray) -> np.ndarray:
    """Zhang-Suen thinning: 1 = граница, 0 = фон. Возвращает скелет (1px)."""
    img = bin_img.copy()
    h, w = img.shape
    changed = True
    while changed:
        changed = False
        # подэтап 1
        t = img.copy()
        for y in range(1, h - 1):
            for x in range(1, w - 1):
                if img[y, x] == 0:
                    continue
                p2, p3, p4, p5, p6, p7, p8, p9 = (
                    img[y-1,x], img[y-1,x+1], img[y,x+1], img[y+1,x+1],
                    img[y+1,x], img[y+1,x-1], img[y,x-1], img[y-1,x-1])
                b = p2+p3+p4+p5+p6+p7+p8+p9
                seq = [p2,p3,p4,p5,p6,p7,p8,p9,p2]
                a = sum(1 for i in range(8) if seq[i] == 0 and seq[i+1] == 1)
                if 2 <= b <= 6 and a == 1 and p2*p4*p6 == 0 and p4*p6*p8 == 0:
                    t[y, x] = 0
                    changed = True
        img = t
        # подэтап 2
        t = img.copy()
        for y in range(1, h - 1):
            for x in range(1, w - 1):
                if img[y, x] == 0:
                    continue
                p2, p3, p4, p5, p6, p7, p8, p9 = (
                    img[y-1,x], img[y-1,x+1], img[y,x+1], img[y+1,x+1],
                    img[y+1,x], img[y+1,x-1], img[y,x-1], img[y-1,x-1])
                b = p2+p3+p4+p5+p6+p7+p8+p9
                seq = [p2,p3,p4,p5,p6,p7,p8,p9,p2]
                a = sum(1 for i in range(8) if seq[i] == 0 and seq[i+1] == 1)
                if 2 <= b <= 6 and a == 1 and p2*p4*p8 == 0 and p2*p6*p8 == 0:
                    t[y, x] = 0
                    changed = True
        img = t
    return img


def smooth_path(contour, k=3):
    """сглаживание полигона скользящим средним"""
    pts = contour.reshape(-1, 2).astype(np.float64)
    if len(pts) < 4:
        return contour
    n = len(pts)
    out = np.zeros_like(pts)
    for i in range(n):
        idx = [(i - k + j) % n for j in range(2 * k + 1)]
        out[i] = pts[idx].mean(axis=0)
    return out.astype(np.int32).reshape(-1, 1, 2)


def trace_skeleton(skel: np.ndarray, min_len: int = 6) -> list[str]:
    """Трассирует 1px-скелет в длинные полилинии (центральные линии).
    Проходит ЧЕРЕЗ узлы-ветвления, не обрываясь: в узле продолжает по соседу,
    максимально близкому к текущему направлению. Возвращает список SVG-путей."""
    h, w = skel.shape
    pts = set()
    for y in range(h):
        for x in range(w):
            if skel[y, x]:
                pts.add((x, y))

    def neighbors(x, y):
        return [(x + dx, y + dy) for dx in (-1, 0, 1) for dy in (-1, 0, 1)
                if (dx, dy) != (0, 0) and (x + dx, y + dy) in pts]

    paths: list[list[tuple[int, int]]] = []
    # строим все линии
    while pts:
        start = pts.pop()
        path = [start]

        def extend_toward(current, prev, banned):
            # идём, пока есть ровно один "не-откатывающийся" сосед; в узле выбираем по направлению
            while True:
                ns = [p for p in neighbors(*current) if p != prev]
                if not ns:
                    break
                if len(ns) == 1:
                    nxt = ns[0]
                else:
                    # ветвление: выбираем соседа, наиболее близкого к направлению движения
                    if len(path) >= 2:
                        dx = current[0] - path[-2][0]
                        dy = current[1] - path[-2][1]
                    else:
                        dx, dy = 1, 0
                    nxt = min(ns, key=lambda p: abs((p[0]-current[0]) - dx) + abs((p[1]-current[1]) - dy))
                if nxt in banned:
                    break
                path.append(nxt)
                banned.add(nxt)
                pts.discard(nxt)
                prev, current = current, nxt
        # растекаемся в обе стороны от start
        banned = set(path)
        extend_toward(start, None, banned)
        path = path[::-1]
        banned = set(path)
        extend_toward(start, None, banned)

        if len(path) >= min_len:
            sm = smooth_polyline(path, k=2)
            d = " ".join(f"L{x},{y}" for x, y in sm[1:])
            paths.append(f"M{sm[0][0]},{sm[0][1]} {d}")
    return paths


def smooth_polyline(path: list, k: int = 2) -> list:
    """сглаживание ломаной (не замкнутой) скользящим средним"""
    if len(path) < 4:
        return path
    arr = np.array(path, dtype=np.float64)
    n = len(arr)
    out = np.zeros_like(arr)
    for i in range(n):
        lo = max(0, i - k)
        hi = min(n - 1, i + k)
        out[i] = arr[lo:hi + 1].mean(axis=0)
    return [(int(round(a)), int(round(b))) for a, b in out]


def main() -> int:
    if not BORDERS.exists():
        print(f"нет входа: {BORDERS}")
        return 1
    img = cv2.imread(str(BORDERS), cv2.IMREAD_GRAYSCALE)
    h, w = img.shape
    print(f"границы: {w}x{h}")

    # 1. скелетонизация линий до 1px (Zhang-Suen)
    bw = (img > 127).astype(np.uint8)  # 1 = белая линия
    skel = zhang_suen(bw)
    print(f"скелет px: {skel.sum()} (было {bw.sum()})")
    # 2. утолстим до ~2px
    thin = cv2.dilate(skel, np.ones((3, 3), np.uint8), iterations=1)
    print(f"границ после dilate: {thin.sum()} px")

    # 2. области = чёрные ячейки между границами
    black = (thin == 0).astype(np.uint8)
    n, labels, stats, cent = cv2.connectedComponentsWithStats(black, connectivity=8)
    edge = set()
    for i in range(1, n):
        x, y, bw, bh, a = stats[i]
        if x == 0 or y == 0 or x + bw == w or y + bh == h:
            edge.add(i)
    regions = [i for i in range(1, n) if i not in edge and stats[i][4] > 300]
    regions.sort(key=lambda i: -stats[i][4])
    print(f"областей: {len(regions)}")

    # 3. границы: трассировка скелета (1px) в ПОЛИЛИНИИ по центральной линии.
    #    findContours даёт «трубку» вокруг линии (2 стороны) — не подходит.
    skel_u8 = (skel > 0).astype(np.uint8)

    # области = чёрные ячейки между линиями (метки для фильтра полосок)
    # используем labels, уже посчитанные выше (из thin)
    # 4. фильтр: оставляем линии, вдоль которых есть >=2 РАЗНЫЕ области (границы).
    #    Полоски (вокруг одна область) выкидываем.
    lines = trace_skeleton(skel_u8, min_len=10)

    def line_has_multi_region(pts: list[tuple[int, int]]) -> bool:
        """идём по линии, проверяем соседние области по обе стороны от каждой точки"""
        seen = set()
        for (x, y) in pts:
            # пробуем точки перпендикулярно линии (по 8 направлениям)
            for dx in (-2, -1, 1, 2):
                for dy in (-2, -1, 1, 2):
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < w and 0 <= ny < h:
                        lb = int(labels[ny, nx])
                        if lb > 0 and lb not in edge:
                            seen.add(lb)
            if len(seen) >= 2:
                return True
        return False

    border_paths = []
    removed_strips = 0
    for d in lines:
        # извлекаем точки из пути
        d2 = d.replace("M", " ").replace("L", " ").strip()
        pts = [(int(float(a.split(",")[0])), int(float(a.split(",")[1]))) for a in d2.split()]
        if len(pts) < 15:  # слишком короткие — точно полоски/мусор
            removed_strips += 1
            continue
        if line_has_multi_region(pts):
            border_paths.append(d)
        else:
            removed_strips += 1
    print(f"линий-границ: {len(border_paths)} (убрано полосок: {removed_strips})")

    # 4. SVG
    region_paths = []
    for idx, ri in enumerate(regions):
        mask = (labels == ri).astype(np.uint8)
        conts, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not conts:
            continue
        sm = smooth_path(max(conts, key=cv2.contourArea))
        d = contour_to_path(sm)
        if d:
            color = PALETTE[idx % len(PALETTE)]
            region_paths.append(f'<path d="{d}" fill="{color}" data-region="r{idx}"/>')

    borders_svg = "\n".join(
        f'<path d="{d}" fill="none" stroke="#2B2317" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>'
        for d in border_paths
    )

    svg = f"""<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">
  <rect width="{w}" height="{h}" fill="#F2E8D5"/>
  <!-- СЛОЙ 1: области-регионы (каждая сущность своим цветом) -->
  <g id="regions">
{"\n".join(region_paths)}
  </g>
  <!-- СЛОЙ 2: границы (2px) -->
  <g id="borders">
{borders_svg}
  </g>
</svg>
"""
    OUT.write_text(svg, encoding="utf-8")
    print(f"OK: {OUT} · {len(region_paths)} областей, {len(border_paths)} линий, {len(svg)} bytes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
