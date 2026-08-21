#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""apply-border-edit.py — нарисованная в бенче земля → новый SVG районов.

Кладёте в prototype/:
  border-edit.png   чёрная закраска
  border-edit.json  {{"assign_to": "Волжский район"}}

Берёт текущий map-osm-fills.svg, отдаёт нарисованные пиксели выбранному
району, пересобирает контуры. Универсально: любой кусок любой границе.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
SVG = ROOT / "prototype" / "map-osm-fills.svg"
PNG = ROOT / "prototype" / "border-edit.png"
META = ROOT / "prototype" / "border-edit.json"

PALETTE = [
    "#EAD9BC", "#DDE3C8", "#F0DFB8", "#D7E0CF", "#EFDCC9",
    "#E3E0CC", "#EDD8C0", "#DBE2C9", "#F2E0C0", "#D9E1CE",
]
BG = "#F2E8D5"


def parse_paths(svg: str) -> list[tuple[str, str, str]]:
    rows = []
    for m in re.finditer(r"<path\b([^>]*)/?>", svg):
        a = m.group(1)
        d = re.search(r'd="([^"]*)"', a)
        fill = re.search(r'fill="([^"]*)"', a)
        name = re.search(r'data-name="([^"]*)"', a)
        if d and fill and name and fill.group(1) != "none":
            rows.append((d.group(1), fill.group(1), name.group(1)))
    return rows


def rings(d: str) -> list[list[tuple[float, float]]]:
    out = []
    for ring in re.findall(r"M[^M]+", d):
        nums = [float(x) for x in re.findall(r"-?\d+(?:\.\d+)?", ring)]
        pts = [(nums[i], nums[i + 1]) for i in range(0, len(nums) - 1, 2)]
        if len(pts) >= 3:
            out.append(pts)
    return out


def rasterize(paths, w: int, h: int) -> tuple[np.ndarray, list[str]]:
    names = [n for _d, _f, n in paths]
    lab = np.zeros((h, w), np.int32)
    img = Image.new("I", (w, h), 0)
    dr = ImageDraw.Draw(img)
    for i, (d, _f, _n) in enumerate(paths, start=1):
        for pts in rings(d):
            dr.polygon([(int(x), int(y)) for x, y in pts], fill=i)
    lab = np.array(img, dtype=np.int32)
    return lab, names


def contour_d(mask: np.ndarray) -> str:
    m = (mask > 0).astype(np.uint8)
    cnts, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    if not cnts:
        return ""
    parts = []
    for c in cnts:
        if cv2.contourArea(c) < 80:
            continue
        poly = cv2.approxPolyDP(c, 1.4, True)
        pts = poly.reshape(-1, 2)
        if len(pts) < 3:
            continue
        bits = [f"M{int(pts[0][0])},{int(pts[0][1])}"]
        bits += [f"L{int(x)},{int(y)}" for x, y in pts[1:]]
        bits.append("Z")
        parts.append(" ".join(bits))
    return " ".join(parts)


def main() -> int:
    if not SVG.exists() or not PNG.exists() or not META.exists():
        print("нужны prototype/map-osm-fills.svg + border-edit.png + border-edit.json")
        return 1
    meta = json.loads(META.read_text(encoding="utf-8"))
    target = meta.get("assign_to")
    if not target:
        print("в json нет assign_to")
        return 1
    svg = SVG.read_text(encoding="utf-8")
    wm = re.search(r'width="(\d+)"', svg)
    hm = re.search(r'height="(\d+)"', svg)
    if not wm or not hm:
        print("нет width/height у SVG")
        return 1
    w, h = int(wm.group(1)), int(hm.group(1))
    paths = parse_paths(svg)
    lab, names = rasterize(paths, w, h)
    if target not in names:
        print("район не найден:", target)
        print("есть:", ", ".join(names))
        return 1
    tid = names.index(target) + 1
    edit = Image.open(PNG).convert("RGBA").resize((w, h), Image.Resampling.NEAREST)
    arr = np.array(edit)
    ink = (arr[:, :, 3] > 40) & (arr[:, :, 0] < 80) & (arr[:, :, 1] < 80) & (arr[:, :, 2] < 80)
    n_ink = int(ink.sum())
    if n_ink < 20:
        print("в png почти нет закраски")
        return 1
    ink_u8 = ink.astype(np.uint8)
    ink_u8 = cv2.dilate(ink_u8, np.ones((3, 3), np.uint8), iterations=1)
    lab[ink_u8 > 0] = tid
    print(f"отдали {int(ink_u8.sum())} px → {target}")

    new_paths = []
    for i, name in enumerate(names, start=1):
        d = contour_d(lab == i)
        if not d:
            print("  пусто после правки:", name)
            continue
        color = PALETTE[(i - 1) % len(PALETTE)]
        esc = name.replace("&", "&amp;").replace('"', "&quot;")
        new_paths.append(
            f'<path d="{d}" fill="{color}" data-region="r{i-1}" data-name="{esc}"/>'
        )
    out = (
        f'<?xml version="1.0" encoding="UTF-8"?>\n'
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" '
        f'viewBox="0 0 {w} {h}">\n'
        f'  <rect width="{w}" height="{h}" fill="{BG}"/>\n'
        f'  <g id="regions">\n'
        + "\n".join(new_paths)
        + "\n  </g>\n</svg>\n"
    )
    SVG.write_text(out, encoding="utf-8")
    print(f"OK: {SVG} · {len(new_paths)} path")
    print("обновите бенч: python scripts/check-map.py")
    return 0


if __name__ == "__main__":
    sys.exit(main())
