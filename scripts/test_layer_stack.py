#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import layer_stack as ls  # noqa: E402


def fail(msg: str) -> None:
    print("FAIL", msg)
    raise SystemExit(1)


def test_default_has_body_layer() -> None:
    st = ls.make_stack()
    if len(st["layers"]) != 1 or st["layers"][0]["type"] != "body":
        fail("default")


def test_assign_and_move_body() -> None:
    st = ls.make_stack()
    b = ls.add_layer(st, "layer", "Север")
    ls.assign_body(st, "Елховский район", 1)
    ls.assign_body(st, "Елховский район", b)
    if ls.layer_of(st, "Елховский район") != b:
        fail("move body")


def test_cannot_drop_last_body_layer_with_bodies() -> None:
    st = ls.make_stack()
    ls.assign_body(st, "Елховский район", 1)
    if ls.delete_layer(st, 1):
        fail("deleted last body layer")


def test_delete_empty_draw() -> None:
    st = ls.make_stack()
    d = ls.add_layer(st, "draw")
    if not ls.delete_layer(st, d):
        fail("draw")
    if len(st["layers"]) != 1:
        fail("left extra")


def test_raise_layer_is_front() -> None:
    st = ls.make_stack()
    d = ls.add_layer(st, "draw")
    if st["layers"][-1]["id"] != d:
        fail("new on top")
    if not ls.move_layer(st, d, -1):
        fail("lower")
    if st["layers"][0]["id"] != d:
        fail("now back")


def test_delete_body_moves_zones() -> None:
    st = ls.make_stack()
    b = ls.add_layer(st, "body")
    ls.assign_body(st, "А", b)
    if not ls.delete_layer(st, b):
        fail("delete extra body")
    if ls.layer_of(st, "А") != 1:
        fail("orphaned body")


if __name__ == "__main__":
    test_default_has_body_layer()
    test_assign_and_move_body()
    test_cannot_drop_last_body_layer_with_bodies()
    test_delete_empty_draw()
    test_raise_layer_is_front()
    test_delete_body_moves_zones()
    print("OK layer_stack")
