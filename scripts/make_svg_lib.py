#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Общие куски пайплайна карты: скелет + ячейки-районы.

extract_region_masks должен давать те же 25 ячеек, что и make-svg.py
(скелет → dilate 1px → CC, площадь > 300, не край кадра).
"""
from __future__ import annotations

import cv2
import numpy as np


def zhang_suen(bin_img: np.ndarray) -> np.ndarray:
    """Zhang-Suen thinning, векторизованный. 1 = линия, 0 = фон."""
    img = bin_img.copy().astype(np.uint8)
    changed = True
    while changed:
        changed = False
        for step in (1, 2):
            p2 = img[:-2, 1:-1]
            p3 = img[:-2, 2:]
            p4 = img[1:-1, 2:]
            p5 = img[2:, 2:]
            p6 = img[2:, 1:-1]
            p7 = img[2:, :-2]
            p8 = img[1:-1, :-2]
            p9 = img[:-2, :-2]
            core = img[1:-1, 1:-1]
            b = (
                p2.astype(np.uint16) + p3 + p4 + p5 + p6 + p7 + p8 + p9
            )
            a = (
                ((p2 == 0) & (p3 == 1)).astype(np.uint8)
                + ((p3 == 0) & (p4 == 1)).astype(np.uint8)
                + ((p4 == 0) & (p5 == 1)).astype(np.uint8)
                + ((p5 == 0) & (p6 == 1)).astype(np.uint8)
                + ((p6 == 0) & (p7 == 1)).astype(np.uint8)
                + ((p7 == 0) & (p8 == 1)).astype(np.uint8)
                + ((p8 == 0) & (p9 == 1)).astype(np.uint8)
                + ((p9 == 0) & (p2 == 1)).astype(np.uint8)
            )
            if step == 1:
                mark = (
                    (core == 1)
                    & (b >= 2)
                    & (b <= 6)
                    & (a == 1)
                    & (p2 * p4 * p6 == 0)
                    & (p4 * p6 * p8 == 0)
                )
            else:
                mark = (
                    (core == 1)
                    & (b >= 2)
                    & (b <= 6)
                    & (a == 1)
                    & (p2 * p4 * p8 == 0)
                    & (p2 * p6 * p8 == 0)
                )
            if mark.any():
                core[mark] = 0
                changed = True
    return img


def extract_region_masks(
    borders_gray: np.ndarray,
    min_area: int = 300,
) -> tuple[np.ndarray, list[int], np.ndarray, np.ndarray]:
    """Белые линии → скелет → ячейки.

    Возвращает (labels, region_ids_desc_area, stats, centroids).
    """
    h, w = borders_gray.shape
    bw = (borders_gray > 127).astype(np.uint8)
    skel = zhang_suen(bw)
    thin = cv2.dilate(skel, np.ones((3, 3), np.uint8), iterations=1)
    black = (thin == 0).astype(np.uint8)
    n, labels, stats, cents = cv2.connectedComponentsWithStats(black, connectivity=8)
    edge: set[int] = set()
    for i in range(1, n):
        x, y, bw_, bh, _a = stats[i]
        if x == 0 or y == 0 or x + bw_ == w or y + bh == h:
            edge.add(i)
    regions = [i for i in range(1, n) if i not in edge and stats[i][4] > min_area]
    regions.sort(key=lambda i: -stats[i][4])
    return labels, regions, stats, cents
