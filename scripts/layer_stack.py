# -*- coding: utf-8 -*-
"""Layer stack for the map editor. Bodies live on body layers; draw/text can be empty."""
from __future__ import annotations


def make_stack() -> dict:
    return {
        "seq": 1,
        "active": 1,
        "layers": [
            {
                "id": 1,
                "name": "Районы",
                "type": "body",
                "visible": True,
                "locked": False,
                "collapsed": False,
            }
        ],
        "bodies": {},
    }


def by_id(st: dict, layer_id: int) -> dict | None:
    for L in st["layers"]:
        if L["id"] == layer_id:
            return L
    return None


def add_layer(st: dict, typ: str = "layer", name: str | None = None) -> int:
    if typ not in ("body", "draw", "text", "layer"):
        typ = "layer"
    st["seq"] += 1
    i = st["seq"]
    st["layers"].append(
        {
            "id": i,
            "name": name or f"Слой {i}",
            "type": "layer",
            "visible": True,
            "locked": False,
            "collapsed": False,
        }
    )
    st["active"] = i
    return i


def assign_body(st: dict, name: str, layer_id: int) -> None:
    if not by_id(st, layer_id):
        raise ValueError("no layer")
    st["bodies"][name] = layer_id


def layer_of(st: dict, name: str) -> int | None:
    return st["bodies"].get(name)


def move_layer(st: dict, layer_id: int, delta: int) -> bool:
    idx = next((i for i, L in enumerate(st["layers"]) if L["id"] == layer_id), -1)
    if idx < 0:
        return False
    j = idx + delta
    if j < 0 or j >= len(st["layers"]):
        return False
    layers = st["layers"]
    layers[idx], layers[j] = layers[j], layers[idx]
    return True


def delete_layer(st: dict, layer_id: int) -> bool:
    L = by_id(st, layer_id)
    if not L:
        return False
    held = [n for n, lid in st["bodies"].items() if lid == layer_id]
    others = [x for x in st["layers"] if x["id"] != layer_id]
    if held and not others:
        return False
    if held:
        dest = others[-1]["id"]
        for n in held:
            st["bodies"][n] = dest
    st["layers"] = [x for x in st["layers"] if x["id"] != layer_id]
    if st["active"] == layer_id:
        st["active"] = st["layers"][-1]["id"] if st["layers"] else None
    return True


def front_is_last(st: dict) -> bool:
    """Later in the list is drawn on top (canvas order)."""
    return True
