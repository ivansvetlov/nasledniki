#!/usr/bin/env python3
from pathlib import Path

import map_publish as pub
import map_themes as th


MINI = """<svg viewBox="0 0 100 80">
<rect width="100" height="80" fill="#F2E8D5"/>
<path d="M10,10 L40,10 L40,40 L10,40 Z" fill="#EAD9BC" data-name="Сызранский район"/>
<path d="M50,10 L90,10 L90,70 L50,70 Z" fill="#DDE3C8" data-name="Волжский район"/>
</svg>
"""


def test_parse_and_ids() -> None:
    g = pub.parse_svg(MINI)
    assert len(g["zones"]) == 2
    ids = {z["id"] for z in g["zones"]}
    assert ids == {"syzran", "volzhsky"}


def test_filter() -> None:
    snap = pub.snapshot_from_svg("samara", MINI, {"name": "Самарская область"})
    f = pub.filter_zones(snap, ["syzran"])
    assert len(f["zones"]) == 1
    assert f["zones"][0]["id"] == "syzran"


def test_flow_smooths() -> None:
    g = pub.parse_svg(MINI)
    raw = g["zones"][0]["d"]
    sm = th.smooth_d(raw, 3)
    assert sm != raw
    assert sm.count("M") >= 1


def test_render_svg() -> None:
    snap = pub.snapshot_from_svg("t", MINI)
    svg = th.render_svg(snap, "nasedniki-flow")
    assert "viewBox" in svg
    assert "syzran" in svg


def test_samara_file() -> None:
    p = Path(__file__).resolve().parents[1] / "maps" / "samara" / "map.svg"
    if not p.is_file():
        return
    g = pub.parse_svg(p.read_text(encoding="utf-8"))
    assert len(g["zones"]) >= 20
    ids = {z["id"] for z in g["zones"]}
    assert "syzran" in ids
    assert "elkhovsky" in ids


if __name__ == "__main__":
    test_parse_and_ids()
    test_filter()
    test_flow_smooths()
    test_render_svg()
    test_samara_file()
    print("OK map_publish")
