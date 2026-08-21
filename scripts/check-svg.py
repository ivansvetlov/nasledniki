#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""check-svg.py — красный цикл для map-final.svg.

Симптом (после 41ab386): чёрные полоски внутри заливок + заливки-кляксы,
не совпадающие с границами. Корень: два независимых слоя (упрощённый
контур области vs полилинии скелета).

Проверки:
  1. Нет orphan-обводок (path fill=none) — граница = stroke той же области.
  2. Каждая область — замкнутый path с fill и stroke.
  3. IoU растра заливок с ячейками скелета >= MIN_IOU.
  4. Внутри заливки (erode 4px) нет тёмных пикселей.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
SVG = ROOT / "prototype" / "map-final.svg"
BORDERS = ROOT / "reference" / "paint-editable" / "1-borders.png"
MIN_IOU = 0.92
MAX_INTERIOR_DARK = 20  # антиалиас / стык stroke

# импорт пайплайна (скелет + ячейки) — один источник правды
sys.path.insert(0, str(Path(__file__).resolve().parent))
from make_svg_lib import extract_region_masks  # noqa: E402


def parse_paths(svg: str) -> tuple[list[tuple[str, str, str | None]], list[str]]:
    """Возвращает (filled_paths, orphan_strokes).

    filled: (d, fill, stroke|None)
    orphan: d of fill=none strokes
    """
    filled: list[tuple[str, str, str | None]] = []
    orphans: list[str] = []
    for m in re.finditer(r"<path\b([^>]*)/?>", svg):
        attrs = m.group(1)
        d_m = re.search(r'\bd="([^"]+)"', attrs)
        fill_m = re.search(r'\bfill="([^"]+)"', attrs)
        stroke_m = re.search(r'\bstroke="([^"]+)"', attrs)
        if not d_m:
            continue
        d = d_m.group(1)
        fill = fill_m.group(1) if fill_m else None
        stroke = stroke_m.group(1) if stroke_m else None
        if fill is None or fill == "none":
            orphans.append(d)
        else:
            filled.append((d, fill, stroke))
    return filled, orphans


def d_to_pts(d: str) -> list[tuple[int, int]]:
    nums = [int(float(x)) for x in re.findall(r"-?\d+(?:\.\d+)?", d)]
    return [(nums[i], nums[i + 1]) for i in range(0, len(nums) - 1, 2)]


def rasterize(filled, orphans, w: int, h: int) -> np.ndarray:
    img = Image.new("RGB", (w, h), "#F2E8D5")
    draw = ImageDraw.Draw(img)
    for d, fill, stroke in filled:
        pts = d_to_pts(d)
        if len(pts) < 3:
            continue
        draw.polygon(pts, fill=fill, outline=stroke if stroke else None)
        if stroke:
            draw.line(pts + [pts[0]], fill=stroke, width=2, joint="curve")
    for d in orphans:
        pts = d_to_pts(d)
        if len(pts) >= 2:
            draw.line(pts, fill="#2B2317", width=2, joint="curve")
    return np.array(img)


def main() -> int:
    if not SVG.exists():
        print(f"FAIL: нет {SVG}")
        return 1
    svg = SVG.read_text(encoding="utf-8")
    filled, orphans = parse_paths(svg)
    print(f"paths: filled={len(filled)} orphan_strokes={len(orphans)}")

    fails: list[str] = []
    if orphans:
        fails.append(f"orphan stroke paths: {len(orphans)} (должно быть 0)")
    if len(filled) < 20:
        fails.append(f"region fills: {len(filled)} (ожидаем >= 20 районов)")
    unstroked = sum(1 for _, _, s in filled if not s)
    if unstroked:
        fails.append(f"fills without stroke: {unstroked}")

    src = cv2.imread(str(BORDERS), cv2.IMREAD_GRAYSCALE)
    h, w = src.shape
    labels, regions, _stats, _cents = extract_region_masks(src)
    true = np.zeros((h, w), np.uint8)
    for ri in regions:
        true[labels == ri] = 255
    # ячейки чуть расширяем — скелет 1–2px между ними не считается «дыркой»
    true_d = cv2.dilate(true, np.ones((3, 3), np.uint8), iterations=2)

    arr = rasterize(filled, orphans, w, h)
    # заливка = не фон и не почти-чёрное
    bg = np.array([0xF2, 0xE8, 0xD5], dtype=np.int16)
    diff = np.abs(arr.astype(np.int16) - bg).sum(axis=2)
    dark = (arr[:, :, 0] < 80) & (arr[:, :, 1] < 80) & (arr[:, :, 2] < 80)
    fill_m = (diff > 30) & (~dark)

    inter = int((fill_m & (true_d > 0)).sum())
    union = int((fill_m | (true > 0)).sum())
    iou = inter / union if union else 0.0
    spill = int((fill_m & (true_d == 0)).sum())
    miss = int(((true > 0) & (~fill_m)).sum())
    print(f"IoU={iou:.3f} spill={spill} missing={miss} true_px={int((true>0).sum())} fill_px={int(fill_m.sum())}")

    if iou < MIN_IOU:
        fails.append(f"IoU {iou:.3f} < {MIN_IOU} (заливки не совпадают с ячейками)")

    fill_only = Image.new("L", (w, h), 0)
    fd = ImageDraw.Draw(fill_only)
    for d, _f, _s in filled:
        pts = d_to_pts(d)
        if len(pts) >= 3:
            fd.polygon(pts, fill=255)
    interior = cv2.erode(np.array(fill_only), np.ones((9, 9), np.uint8))
    interior_dark = int((dark & (interior > 0)).sum())
    print(f"interior_dark={interior_dark}")
    if interior_dark > MAX_INTERIOR_DARK:
        fails.append(f"interior dark px {interior_dark} > {MAX_INTERIOR_DARK}")

    if fails:
        print("FAIL:")
        for f in fails:
            print(f"  - {f}")
        return 1
    print("OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
