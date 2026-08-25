#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""check-map.py — проверка слоёв + сборка редактора карты.

Пишет prototype/map-bench.html — редактор (слои, холст, пан/зум).
"""
from __future__ import annotations

import html as html_mod
import importlib.util
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

from shapely.geometry import MultiPolygon, Polygon
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[1]
SVG = ROOT / "prototype" / "map-osm-fills.svg"
BENCH = ROOT / "prototype" / "map-bench.html"
HISTORY = ROOT / "prototype" / "check-history.jsonl"
_PIPE = ROOT / "scripts" / "make-svg-osm.py"
_spec = importlib.util.spec_from_file_location("make_svg_osm", _PIPE)
osm = importlib.util.module_from_spec(_spec)
assert _spec.loader is not None
_spec.loader.exec_module(osm)

MIN_PART_M2 = osm.MIN_PART_M2
fetch_geojson = osm.fetch_geojson
keep_large_parts = osm.keep_large_parts
load_features = osm.load_features
merge_okrugs_into_districts = osm.merge_okrugs_into_districts
to_meters = osm.to_meters
is_district = osm.is_district
is_okrug = osm.is_okrug

EXPECTED_DISTRICTS = [
    "Алексеевский район",
    "Безенчукский район",
    "Богатовский район",
    "Большеглушицкий район",
    "Большечерниговский район",
    "Борский район",
    "Волжский район",
    "Елховский район",
    "Исаклинский район",
    "Камышлинский район",
    "Кинель-Черкасский район",
    "Кинельский район",
    "Клявлинский район",
    "Кошкинский район",
    "Красноармейский район",
    "Красноярский район",
    "Нефтегорский район",
    "Пестравский район",
    "Похвистневский район",
    "Приволжский район",
    "Сергиевский район",
    "Ставропольский район",
    "Сызранский район",
    "Хворостянский район",
    "Челно-Вершинский район",
    "Шенталинский район",
    "Шигонский район",
]

# округа → район на схеме-атласе (города — точки, не зоны)
EXPECTED_MERGE = {
    "городской округ Жигулёвск": "Ставропольский район",
    "городской округ Кинель": "Кинельский район",
    "городской округ Новокуйбышевск": "Волжский район",
    "городской округ Октябрьск": "Сызранский район",
    "городской округ Отрадный": "Кинель-Черкасский район",
    "городской округ Похвистнево": "Похвистневский район",
    "городской округ Самара": "Волжский район",
    "городской округ Сызрань": "Сызранский район",
    "городской округ Тольятти": "Ставропольский район",
    # Чапаевск на схеме без своего пятна; сосед — Безенчук / Волга
    "городской округ Чапаевск": "Безенчукский район",
}

OVERLAP_MAX = 0.015  # доля площади объединения
ISOLATED_OK = 0


def parse_svg(text: str) -> list[dict]:
    rows = []
    for m in re.finditer(r"<path\b([^>]*)/?>", text):
        attrs = m.group(1)
        name_m = re.search(r'data-name="([^"]*)"', attrs)
        fill_m = re.search(r'fill="([^"]*)"', attrs)
        stroke_m = re.search(r'stroke="([^"]*)"', attrs)
        d_m = re.search(r'd="([^"]*)"', attrs)
        rows.append(
            {
                "name": name_m.group(1) if name_m else "",
                "fill": fill_m.group(1) if fill_m else None,
                "stroke": stroke_m.group(1) if stroke_m else None,
                "d": d_m.group(1) if d_m else "",
            }
        )
    return rows


def actual_merge(projected: list[dict]) -> dict[str, str]:
    """Повторяет правило make-svg-osm: округ → ближайший район."""
    districts = [f for f in projected if is_district(f["name"])]
    okrugs = [f for f in projected if is_okrug(f["name"])]
    out = {}
    for o in okrugs:
        best = None
        best_key = None
        for d in districts:
            inter = d["geom"].buffer(80).intersection(o["geom"].buffer(80)).area
            dist = d["geom"].distance(o["geom"])
            key = (dist, -inter)
            if best_key is None or key < best_key:
                best_key, best = key, d
        if best:
            out[o["name"]] = best["name"]
    return out


def part_count(geom) -> int:
    if geom.is_empty:
        return 0
    if isinstance(geom, MultiPolygon):
        return sum(1 for g in geom.geoms if g.area >= MIN_PART_M2)
    return 1 if geom.area >= MIN_PART_M2 else 0


def hole_count(geom) -> int:
    if isinstance(geom, Polygon):
        return len(geom.interiors)
    if isinstance(geom, MultiPolygon):
        return sum(len(g.interiors) for g in geom.geoms)
    return 0


def main() -> int:
    fails: list[str] = []
    warns: list[str] = []
    notes: list[str] = []

    if not SVG.exists():
        print(f"FAIL: нет {SVG}")
        return 1
    svg = SVG.read_text(encoding="utf-8")
    paths = parse_svg(svg)
    names = [p["name"] for p in paths if p["fill"] and p["fill"] != "none"]

    if "id=\"borders\"" in svg or "id='borders'" in svg:
        fails.append("в SVG есть слой #borders")
    stroked = [p for p in paths if p["stroke"] and p["stroke"] != "none"]
    if stroked:
        fails.append(f"path со stroke: {len(stroked)} (должно быть 0)")
    orphans = [p for p in paths if not p["fill"] or p["fill"] == "none"]
    if orphans:
        fails.append(f"orphan stroke/empty fill: {len(orphans)}")

    if len(names) != 27:
        fails.append(f"районов в SVG: {len(names)} (нужно 27)")
    okrug_names = [n for n in names if "городск" in n.lower()]
    if okrug_names:
        fails.append("в SVG остались округа: " + ", ".join(okrug_names))

    missing = [n for n in EXPECTED_DISTRICTS if n not in names]
    extra = [n for n in names if n not in EXPECTED_DISTRICTS]
    if missing:
        fails.append("нет районов: " + ", ".join(missing))
    if extra:
        fails.append("лишние имена: " + ", ".join(extra))

    gj = fetch_geojson()
    feats = load_features(gj)
    projected = []
    for f in feats:
        g = to_meters(f["geom"])
        if not g.is_valid:
            g = g.buffer(0)
        projected.append({"name": f["name"], "geom": g})

    merges = actual_merge(projected)
    for okrug, want in EXPECTED_MERGE.items():
        got = merges.get(okrug)
        if got is None:
            warns.append(f"округ не найден в geojson: {okrug}")
        elif got != want:
            fails.append(f"слияние {okrug} → {got} (ждали {want})")
        else:
            notes.append(f"ok merge {okrug} → {got}")

    merged = merge_okrugs_into_districts(projected)
    prepared = []
    for f in merged:
        g = keep_large_parts(f["geom"], MIN_PART_M2)
        if g.is_empty:
            fails.append(f"пустой после очистки: {f['name']}")
            continue
        prepared.append({"name": f["name"], "geom": g})

    # перекрытие (до gap — иначе щели прячут нахлёст)
    overlap_m2 = 0.0
    for i, a in enumerate(prepared):
        for b in prepared[i + 1 :]:
            inter = a["geom"].intersection(b["geom"])
            if not inter.is_empty:
                overlap_m2 += inter.area
    union = unary_union([p["geom"] for p in prepared])
    union_m2 = union.area if not union.is_empty else 1.0
    overlap_ratio = overlap_m2 / union_m2
    notes.append(f"overlap_ratio={overlap_ratio:.4f}")
    if overlap_ratio > OVERLAP_MAX:
        fails.append(f"нахлёст районов {overlap_ratio:.3f} > {OVERLAP_MAX}")

    isolated = []
    multi = []
    holes = []
    crumbs = []
    for p in prepared:
        others = unary_union([q["geom"] for q in prepared if q is not p])
        if p["geom"].distance(others) > 1:
            isolated.append(p["name"])
        pc = part_count(p["geom"])
        if pc > 1:
            multi.append(f"{p['name']}×{pc}")
        hc = hole_count(p["geom"])
        if hc:
            holes.append(f"{p['name']} дырок={hc}")
        # мелкие части внутри multipolygon
        if isinstance(p["geom"], MultiPolygon):
            for g in p["geom"].geoms:
                if 0 < g.area < MIN_PART_M2:
                    crumbs.append(f"{p['name']} {g.area/1e6:.1f} км²")

    if isolated:
        fails.append("изолированы (нет соседей): " + ", ".join(isolated))
    if multi:
        fails.append("район из нескольких кусков: " + "; ".join(multi))
    if holes:
        warns.append("дыры в полигоне: " + "; ".join(holes))
    if crumbs:
        fails.append("осколки: " + "; ".join(crumbs))

    report = {
        "ts": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        "ok": len(fails) == 0,
        "path_count": len(names),
        "names": names,
        "merges": merges,
        "overlap_ratio": round(overlap_ratio, 5),
        "fail": fails,
        "warn": warns,
        "note": notes,
        "multi": multi,
    }
    hist = append_history(report)
    write_bench(svg, report, hist, paths)

    print(f"SVG paths={len(names)} overlap={overlap_ratio:.4f}")
    print(f"bench: {BENCH}")
    if warns:
        print("WARN:")
        for w in warns:
            print(f"  - {w}")
    if fails:
        print("FAIL:")
        for f in fails:
            print(f"  - {f}")
        return 1
    print("OK")
    return 0


def short_label(name: str) -> str:
    return (
        name.replace("район", "")
        .replace("городской округ", "го")
        .strip()
    )


def path_centroid(d: str) -> tuple[float, float] | None:
    """Центр самой большой кольцевой части path."""
    best = None
    best_n = 0
    for ring in re.findall(r"M[^M]+", d):
        nums = [float(x) for x in re.findall(r"-?\d+(?:\.\d+)?", ring)]
        pts = [(nums[i], nums[i + 1]) for i in range(0, len(nums) - 1, 2)]
        if len(pts) < 3:
            continue
        if len(pts) > best_n:
            best_n = len(pts)
            xs = [p[0] for p in pts]
            ys = [p[1] for p in pts]
            best = (sum(xs) / len(xs), sum(ys) / len(ys))
    return best


def labeled_svg(raw: str, paths: list[dict], multi: list[str]) -> str:
    flagged = set()
    for item in multi:
        flagged.add(item.split("×")[0])
    inner = raw
    if "</svg>" not in inner:
        return inner
    labels = ['  <g id="labels" pointer-events="none">']
    for p in paths:
        if not p.get("d") or not p.get("name"):
            continue
        c = path_centroid(p["d"])
        if not c:
            continue
        lab = html_mod.escape(short_label(p["name"]))
        cls = "lab bad" if p["name"] in flagged else "lab"
        labels.append(
            f'<text class="{cls}" x="{c[0]:.1f}" y="{c[1]:.1f}" '
            f'text-anchor="middle" dominant-baseline="middle">{lab}</text>'
        )
    labels.append("  </g>")
    style = (
        "<style>"
        ".lab{font:600 11px 'Segoe UI',system-ui,sans-serif;fill:#2B2317;"
        "paint-order:stroke fill;stroke:#F2E8D5;stroke-width:3px}"
        ".lab.bad{fill:#8B1E1E;stroke:#F8E0DC}"
        "path[data-name]:hover{filter:brightness(.93)}"
        "</style>\n"
    )
    return inner.replace("<svg", "<svg" + " ", 1).replace(
        "</svg>", style + "\n".join(labels) + "\n</svg>"
    )


def append_history(report: dict) -> list[dict]:
    prev: list[dict] = []
    if HISTORY.exists():
        for line in HISTORY.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line:
                prev.append(json.loads(line))
    last_fails = set(prev[-1]["fail"]) if prev else set()
    now_fails = set(report["fail"])
    report["fixed"] = sorted(last_fails - now_fails)
    report["new_fails"] = sorted(now_fails - last_fails)
    if prev and not report["fixed"] and not report["new_fails"]:
        report["delta"] = "same"
    elif not prev:
        report["delta"] = "first"
    elif report["ok"] and last_fails:
        report["delta"] = "progress"
    elif report["new_fails"] and not report["fixed"]:
        report["delta"] = "regress"
    elif report["fixed"] and not report["new_fails"]:
        report["delta"] = "progress"
    else:
        report["delta"] = "mixed"
    slim = {
        "ts": report["ts"],
        "ok": report["ok"],
        "delta": report["delta"],
        "path_count": report["path_count"],
        "overlap_ratio": report["overlap_ratio"],
        "fail": report["fail"],
        "fixed": report["fixed"],
        "new_fails": report["new_fails"],
    }
    with HISTORY.open("a", encoding="utf-8") as f:
        f.write(json.dumps(slim, ensure_ascii=False) + "\n")
    return prev + [slim]


def write_bench(raw_svg: str, report: dict, hist: list[dict], paths: list[dict]) -> None:
    svg_html = raw_svg
    svg_html = re.sub(r'\swidth="[^"]*"', "", svg_html, count=1)
    svg_html = re.sub(r'\sheight="[^"]*"', "", svg_html, count=1)
    # встроенный svg — только фолбэк до remountSvg, скрыт чтобы не мигал при F5
    svg_html = re.sub(r"<svg", '<svg style="display:none"', svg_html, count=1)
    js = (ROOT / "scripts" / "map_editor.js").read_text(encoding="utf-8")
    page = f"""<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Карта</title>
<style>
  :root {{
    --page:#F5F5F5; --panel:#fff; --line:#E6E6E6; --ink:#1a1a1a;
    --mute:#6f6f6f; --acc:#0D99FF; --rail:48px;
    --font:'Inter',system-ui,-apple-system,sans-serif;
  }}
  * {{ box-sizing:border-box; margin:0; padding:0; }}
  html,body {{ height:100%; overflow:hidden; background:var(--page); color:var(--ink);
    font-family:var(--font); font-size:13px; }}
  .app {{ display:grid; grid-template-columns:var(--rail) 268px 1fr; height:100%; }}
  .rail {{ background:#fff; border-right:1px solid var(--line); display:flex; flex-direction:column; align-items:center; padding:10px 0; gap:4px; }}
  .rail .logo {{ width:28px; height:28px; border-radius:8px; background:conic-gradient(from 210deg,#f24e1e,#ff7262,#a259ff,#1abcfe,#0acf83,#f24e1e); margin-bottom:10px; }}
  .rail button {{ width:40px; height:40px; border:0; background:transparent; border-radius:10px; cursor:pointer; color:#555; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:2px; font-size:8px; letter-spacing:.02em; }}
  .rail button svg {{ width:18px; height:18px; stroke:currentColor; fill:none; stroke-width:1.7; }}
  .rail button:hover {{ background:#f2f2f2; }}
  .rail button.on {{ background:#E5F3FF; color:var(--acc); }}
  .left {{ background:#fff; display:flex; flex-direction:column; min-height:0;
    border-right:1px solid var(--line); }}
  .ph {{ padding:14px 16px 8px; display:flex; align-items:center; justify-content:space-between; }}
  .ph h1 {{ font-size:14px; font-weight:650; }}
  .ph .sub {{ font-size:11px; color:var(--mute); }}
  #layers {{ overflow:auto; padding:2px 4px 8px; max-height:240px; min-height:0; }}
  #layers-fold {{ border-top:1px solid var(--line); flex-shrink:0; background:#fff; }}
  #layers-fold .fold-hd {{ display:flex; align-items:center; gap:4px; }}
  #layers-toggle {{ flex:1; display:flex; align-items:center; gap:8px; text-align:left;
    border:0; background:transparent; padding:8px 10px; cursor:pointer; font:inherit; color:var(--ink); }}
  #layers-toggle:hover {{ background:#f7f7f7; }}
  #layers-fold .jttl {{ font-weight:600; font-size:13px; flex:1; }}
  #layers-count {{ font-size:11px; color:var(--mute); }}
  #layers-count:empty {{ display:none; }}
  #layers-fold .jchev {{ color:#888; font-size:11px; }}
  #layers-fold .jchev::before {{ content:"▸"; }}
  #layers-fold.open .jchev::before {{ content:"▾"; }}
  #layers-fold #layers {{ display:none; }}
  #layers-fold.open #layers {{ display:block; }}
  #layers-fold .ltools {{ padding-right:8px; }}
  #journal-box {{ border-top:1px solid var(--line); flex-shrink:0; background:#fff; }}
  #journal-toggle {{ width:100%; display:flex; align-items:center; gap:8px; text-align:left;
    border:0; background:transparent; padding:10px 14px; cursor:pointer; font:inherit; color:var(--ink); }}
  #journal-toggle:hover {{ background:#f7f7f7; }}
  #journal-toggle .jttl {{ font-weight:600; font-size:13px; flex:1; }}
  #journal-count {{ font-size:11px; color:var(--mute); min-width:1em; }}
  #journal-count:empty {{ display:none; }}
  #journal-toggle .jchev {{ color:#888; font-size:11px; }}
  #journal-toggle .jchev::before {{ content:"▸"; }}
  #journal-box.open .jchev::before {{ content:"▾"; }}
  #journal {{ display:none; max-height:220px; overflow:auto; padding:0 8px 10px; }}
  #journal-box.open #journal {{ display:block; }}
  .jitem {{ width:100%; display:flex; align-items:center; justify-content:space-between; gap:8px;
    text-align:left; border:0; background:transparent; padding:6px 8px; border-radius:8px;
    cursor:pointer; font:inherit; color:var(--ink); }}
  .jitem:hover {{ background:#f7f7f7; }}
  .jitem.now {{ background:#E5F3FF; font-weight:600; }}
  .jitem.future {{ color:#aaa; }}
  .jitem.future:hover {{ background:#f7f7f7; color:#666; }}
  #copies {{ border-top:1px solid var(--line); flex-shrink:0; background:#fff; }}
  #copies .fold-hd {{ display:flex; align-items:center; gap:4px; }}
  #copies-toggle {{ flex:1; display:flex; align-items:center; gap:8px; text-align:left;
    border:0; background:transparent; padding:8px 10px; cursor:pointer; font:inherit; color:var(--ink); }}
  #copies-toggle:hover {{ background:#f7f7f7; }}
  #copies-toggle .jttl {{ font-weight:600; font-size:13px; flex:1; }}
  #copies .jchev {{ color:#888; font-size:11px; }}
  #copies .jchev::before {{ content:"▸"; }}
  #copies.open .jchev::before {{ content:"▾"; }}
  #copies-list {{ display:none; max-height:220px; overflow:auto; padding:0 8px 10px; }}
  #copies.open #copies-list {{ display:block; }}
  .cpy {{ display:flex; align-items:center; gap:6px; padding:6px 8px; border-radius:8px; }}
  .cpy:hover {{ background:#f7f7f7; }}
  .cpy .cname {{ flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:600; }}
  .cpy .cmeta {{ font-size:11px; color:var(--mute); flex-shrink:0; }}
  .cpy a {{ text-decoration:none; color:var(--acc); font-size:12px; flex-shrink:0; padding:2px 5px; border-radius:6px; }}
  .cpy a:hover {{ background:#E5F3FF; }}
  #copy-now {{ width:26px; height:26px; border:0; background:transparent; cursor:pointer; border-radius:6px; }}
  #copy-now:hover {{ background:#e8f2ff; }}
  #copies-empty {{ font-size:12px; color:var(--mute); padding:4px 8px; }}
  .jitem .jnow {{ font-size:10px; font-weight:500; color:var(--acc); }}
  .ltools {{ display:flex; gap:4px; }}
  .ltools button {{ width:28px; height:28px; border:1px solid var(--line); border-radius:8px; background:#fff; cursor:pointer; font:600 12px var(--font); }}
  .ltools button:hover {{ background:#f7f7f7; }}
  .layer {{ width:100%; display:flex; align-items:center; gap:6px; text-align:left;
    border:1px solid transparent; background:#fff; color:var(--ink); padding:7px 8px; border-radius:10px; cursor:pointer; }}
  .layer:hover {{ background:#f7f7f7; }}
  .layer.on {{ border-color:#cfe8ff; background:#E5F3FF; }}
  .layer.head {{ font-weight:600; }}
  .layer.child {{ padding-left:22px; }}
  .layer.off {{ opacity:.38; }}
  .layer .eye, .layer .lk, .layer .tw {{ width:18px; height:18px; border:0; background:transparent; cursor:pointer; color:#888; font-size:11px; flex-shrink:0; }}
  .layer .tw {{ color:#555; }}
  .sw {{ width:12px; height:12px; border-radius:3px; flex-shrink:0; box-shadow:inset 0 0 0 1px #0002; }}
  .ln {{ overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1; }}
  .ln-edit {{ flex:1; min-width:0; height:22px; border:1px solid #cfe8ff; border-radius:6px; padding:0 6px; font:inherit; }}
  #ctx-menu {{ position:fixed; z-index:40; min-width:200px; padding:6px; background:#fff;
    border:1px solid var(--line); border-radius:10px; box-shadow:0 10px 28px #00000022; }}
  #ctx-menu button {{ display:block; width:100%; text-align:left; border:0; background:transparent;
    padding:7px 10px; border-radius:8px; cursor:pointer; font:inherit; color:var(--ink); }}
  #ctx-menu button:hover {{ background:#E5F3FF; }}
  #ctx-menu button:disabled {{ color:#aaa; cursor:default; }}
  #ctx-menu button:disabled:hover {{ background:transparent; }}
  #ctx-menu .sep {{ height:1px; background:var(--line); margin:4px 8px; }}
  #viewport {{ position:relative; overflow:hidden; background:var(--page); cursor:none; touch-action:none; }}
  #viewport #stage, #viewport svg, #viewport canvas {{ touch-action:none; }}
  #viewport.hand, #viewport.panning {{ cursor:grab; }}
  #viewport.hand #cross, #viewport.panning #cross {{ display:none !important; }}
  #viewport.panning {{ cursor:grabbing; }}
  #viewport.draw {{ cursor:none; }}
  #viewport.ruler {{ cursor:crosshair; }}
  #viewport.ruler #cross {{ display:none !important; }}
  #cross {{ position:absolute; inset:0; pointer-events:none; z-index:4; display:none; }}
  #cross.on {{ display:block; }}
  #cross .h {{ position:absolute; left:0; right:0; height:0; border-top:1px solid #1119; }}
  #cross .v {{ position:absolute; top:0; bottom:0; width:0; border-left:1px solid #1119; }}
  #xy {{ position:absolute; z-index:6; pointer-events:none; display:none;
    font:11px ui-monospace,Consolas,monospace; background:#fff; color:#1a1a1a;
    border:1px solid #E6E6E6; border-radius:6px; padding:4px 8px; white-space:nowrap;
    box-shadow:0 4px 14px #00000014; }}
  #xy b {{ font-weight:650; }}
  #xy .mute {{ color:#6f6f6f; }}
  #stage {{ position:absolute; left:0; top:0; transform-origin:0 0; }}
  #stage svg {{ display:block; width:100%; height:auto; overflow:visible; }}
  #ruler {{ position:absolute; left:0; top:0; width:100%; height:100%; pointer-events:none; z-index:5; overflow:visible; }}
  #doodle {{ position:absolute; left:0; top:0; width:100%; height:100%; pointer-events:none; z-index:4; overflow:visible; }}
  #doodle path {{ fill:none; stroke:#111; vector-effect:non-scaling-stroke; stroke-linecap:round; stroke-linejoin:round; }}
  #pins {{ position:absolute; left:0; top:0; width:100%; height:100%; pointer-events:none; z-index:6; overflow:visible; }}
  #pins .pin {{ fill:#e03131; stroke:#fff; stroke-width:1.5; }}
  #pins .pin.yellow {{ fill:#f5c400; }}
  #pins .pin.ghost {{ fill:#e03131; opacity:.4; }}
  #pins .mouth {{ stroke:#e03131; stroke-width:1; stroke-dasharray:4 3; opacity:.45; }}
  #ruler line {{ stroke:#0D99FF; stroke-width:1; stroke-linecap:butt;
    vector-effect:non-scaling-stroke; }}
  #ruler .mark {{ fill:#fff; stroke:#0D99FF; stroke-width:1.5; }}
  #ruler .mark.snap {{ fill:#0D99FF; }}
  #ruler text {{ font:600 12px ui-monospace,Consolas,monospace; fill:#0D99FF;
    paint-order:stroke fill; stroke:#fff; stroke-width:3px; }}
  #stage path.sel {{ stroke:var(--acc); stroke-width:0.67; }}
  #stage text[data-kind] {{ cursor:move; user-select:none; }}
  #stage text[data-kind].sel {{ stroke:#0D99FF; stroke-width:3px; paint-order:stroke fill; }}
  .txt-edit {{ position:fixed; z-index:41; min-width:120px; height:28px; border:1px solid #cfe8ff;
    border-radius:8px; padding:0 8px; font:16px system-ui,sans-serif; box-shadow:0 8px 20px #0002; }}
  #draw {{ position:absolute; left:0; top:0; width:100%; height:100%; pointer-events:none; }}
  .dock {{ position:absolute; left:50%; bottom:20px; transform:translateX(-50%);
    z-index:10; display:flex; align-items:center; gap:2px; padding:6px; background:#fff;
    border-radius:14px; box-shadow:0 8px 28px #0000001a, 0 0 0 1px #0000000d;
    cursor:default; }}
  .dock button {{ width:36px; height:36px; border:0; background:transparent; border-radius:10px; cursor:pointer; color:#222; }}
  .dock button:hover {{ background:#f3f3f3; }}
  .dock button.on {{ background:#E5F3FF; color:var(--acc); }}
  .dock .vr {{ width:1px; height:22px; background:var(--line); margin:0 4px; }}
  .dock .thick {{ display:flex; align-items:center; gap:6px; padding:0 8px; color:var(--mute); font-size:11px; min-width:92px; }}
  .dock .thick input {{ width:72px; }}
  .dock .thick.locked input {{ opacity:.35; pointer-events:none; }}
  .dock .thick.locked span {{ color:var(--ink); font-weight:600; }}
  #hint {{ position:absolute; left:12px; bottom:64px; z-index:8; pointer-events:none;
    color:var(--mute); font-size:12px; line-height:1.45; max-width:340px;
    text-shadow:0 1px 0 #fff, 0 0 8px #fff; }}
  #maps-box {{ display:flex; flex-direction:column; min-height:0; flex:1; }}
  #map-list {{ overflow:auto; padding:6px 8px 16px; flex:1; }}
  .map-item .nest {{ margin:0 6px 8px; background:#fff; border:1px solid var(--line); border-radius:10px; overflow:hidden; }}
  .map-item .nest #layers-fold, .map-item .nest #journal-box {{ border-top:0; }}
  .map-item .nest #journal-box {{ border-top:1px solid var(--line); }}
  .map-item {{ width:100%; display:flex; flex-direction:column; align-items:stretch;
    border:1px solid transparent; background:#fff; border-radius:10px; margin-bottom:4px; }}
  .map-item:hover {{ background:#f7f7f7; }}
  .map-item.on {{ border-color:#cfe8ff; background:#E5F3FF; }}
  .map-item-btn {{ width:100%; display:flex; align-items:flex-start; gap:8px; text-align:left;
    border:0; background:transparent; padding:8px 10px; cursor:pointer; font:inherit; color:inherit; }}
  .map-item .dot {{ width:8px; height:8px; border-radius:50%; background:#ddd; flex-shrink:0; margin-top:5px; }}
  .map-item.on .dot {{ background:var(--acc); }}
  .map-item .meta {{ font-size:11px; color:var(--mute); }}
  .map-item .pname {{ font-weight:600; }}
  .app.sb-collapsed {{ grid-template-columns:var(--rail) 1fr; }}
  .app.sb-collapsed .left {{ display:none; }}
  .map-item {{ position:relative; }}
  .map-item.min .map-item-btn .dot, .map-item.min .meta {{ display:none; }}
  .map-item.min .map-item-btn {{ padding:4px 10px; }}
  .map-item.min .nest {{ display:none; }}
  .map-item.dragging {{ opacity:.45; }}
  .map-item.drag-over {{ border-color:var(--acc); }}
  #new-project {{ position:fixed; inset:0; z-index:60; display:none; align-items:center; justify-content:center;
    background:rgba(20,26,36,.45); }}
  #new-project.show {{ display:flex; }}
  #np-card {{ width:440px; max-width:92vw; background:#fff; border-radius:14px; box-shadow:0 18px 50px rgba(0,0,0,.25); overflow:hidden; }}
  #np-head {{ padding:14px 16px; border-bottom:1px solid var(--line); display:flex; align-items:center; justify-content:space-between; }}
  #np-head h2 {{ font-size:15px; }}
  #np-close {{ border:0; background:transparent; font-size:18px; cursor:pointer; color:var(--mute); }}
  #np-body {{ padding:14px 16px; }}
  #np-body label {{ display:block; font-size:12px; color:var(--mute); margin:10px 0 4px; }}
  #np-body input[type=text], #np-body input[type=search] {{ width:100%; height:34px; border:1px solid var(--line);
    border-radius:8px; padding:0 10px; font:inherit; }}
  #np-body .row {{ display:flex; gap:8px; }}
  #np-hits {{ margin-top:8px; max-height:180px; overflow:auto; }}
  #np-hits .hit {{ display:block; width:100%; text-align:left; padding:7px 10px; border:1px solid var(--line);
    border-radius:8px; background:#fff; margin-bottom:4px; cursor:pointer; font:inherit; }}
  #np-hits .hit:hover {{ background:#E5F3FF; }}
  #np-foot {{ padding:12px 16px; border-top:1px solid var(--line); display:flex; justify-content:flex-end; gap:8px; }}
  #np-foot button {{ height:32px; padding:0 14px; border-radius:8px; border:1px solid var(--line); background:#fff; cursor:pointer; font:inherit; }}
  #np-foot .primary {{ background:var(--acc); color:#fff; border-color:var(--acc); }}
  #np-foot button:disabled {{ opacity:.5; cursor:default; }}
  #np-err {{ color:#c0392b; font-size:12px; min-height:16px; margin-top:6px; }}
  #map-search {{ display:none; padding:10px 12px 14px; position:relative; flex-shrink:0;
    border-top:1px solid var(--line); background:#fff; }}
  #map-search.show {{ display:block; }}
  #map-search.busy .qrow, #map-search.busy #map-hits {{ opacity:.4; pointer-events:none; }}
  #map-search .msub {{ font-size:12px; font-weight:600; color:var(--ink); margin-bottom:2px; }}
  #map-search-target {{ font-size:11px; color:var(--mute); margin-bottom:8px; }}
  .spin {{ width:22px; height:22px; border:3px solid #cfe8ff; border-top-color:var(--acc);
    border-radius:50%; animation:spin .7s linear infinite; }}
  @keyframes spin {{ to {{ transform:rotate(360deg); }} }}
  #map-search .qrow {{ display:flex; gap:6px; }}
  #map-search input {{ flex:1; min-width:0; height:32px; border:1px solid var(--line); border-radius:8px; padding:0 10px; font:inherit; }}
  #map-go {{ height:32px; padding:0 10px; border:1px solid var(--line); border-radius:8px; background:#fff; cursor:pointer; white-space:nowrap; }}
  #map-go:hover {{ background:#f7f7f7; }}
  #map-hits {{ margin-top:8px; }}
  .hit {{ width:100%; text-align:left; border:1px solid var(--line); background:#fff; border-radius:8px; padding:8px 10px; margin-bottom:6px; cursor:pointer; }}
  .hit:hover {{ border-color:#cfe8ff; background:#E5F3FF; }}
  .hit small {{ display:block; color:var(--mute); font-size:11px; margin-top:2px; }}
  .map-load {{ display:none; align-items:center; gap:8px; margin-top:10px; color:var(--ink); font-size:12px; }}
  #map-search.busy .map-load {{ display:flex; }}
  #btn-new-map, #btn-logout {{ width:28px; height:28px; border:1px solid var(--line); border-radius:8px; background:#fff; cursor:pointer; font-size:16px; line-height:1; }}
  #auth-gate {{ position:fixed; inset:0; z-index:50; display:flex; align-items:center; justify-content:center;
    background:#F5F5F5; }}
  #auth-gate.hidden {{ display:none; }}
  #auth-card {{ width:320px; background:#fff; border:1px solid var(--line); border-radius:14px;
    padding:22px 20px; box-shadow:0 12px 40px #00000014; }}
  #auth-card h1 {{ font-size:16px; margin-bottom:4px; }}
  #auth-card .sub {{ color:var(--mute); font-size:12px; margin-bottom:14px; }}
  #auth-card input {{ width:100%; height:34px; border:1px solid var(--line); border-radius:8px;
    padding:0 10px; font:inherit; margin-bottom:8px; }}
  #auth-card .arow {{ display:flex; gap:8px; }}
  #auth-card button {{ flex:1; height:34px; border:1px solid var(--line); border-radius:8px;
    background:#fff; cursor:pointer; font:inherit; }}
  #auth-card button.pri {{ background:#E5F3FF; border-color:#cfe8ff; color:var(--acc); font-weight:600; }}
  #auth-err {{ color:#c0392b; font-size:12px; min-height:16px; margin-top:8px; }}
</style>
</head>
<body>
<div id="auth-gate" class="hidden">
  <div id="auth-card">
    <h1>Аккаунт</h1>
    <div class="sub">проекты сохраняются и остаются после перезагрузки</div>
    <input id="auth-name" type="text" placeholder="имя" autocomplete="username">
    <input id="auth-pass" type="password" placeholder="пароль" autocomplete="current-password">
    <div class="arow">
      <button type="button" id="auth-login" class="pri">войти</button>
      <button type="button" id="auth-register">создать</button>
    </div>
    <p id="auth-err"></p>
  </div>
</div>
<div class="app">
  <div id="new-project">
    <div id="np-card">
      <div id="np-head"><h2>Новый проект</h2><button type="button" id="np-close" title="закрыть">✕</button></div>
      <div id="np-body">
        <label>Название проекта (необязательно)</label>
        <input type="text" id="np-name" placeholder="напр. «Самарская область — весна 2026»">
        <label>Или создай из объекта OpenStreetMap</label>
        <div class="row">
          <input type="search" id="np-q" placeholder="район, город, область" autocomplete="off">
        </div>
        <div id="np-hits"></div>
        <div id="np-err"></div>
      </div>
      <div id="np-foot">
        <button type="button" id="np-empty">Создать пустой</button>
        <button type="button" id="np-create" class="primary" disabled>Создать из объекта</button>
        <button type="button" id="np-cancel">Отмена</button>
      </div>
    </div>
  </div>
  <nav class="rail">
    <div class="logo" title="Карта"></div>
    <button type="button" id="rail-maps" class="on"><svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="14" rx="2"/><path d="M8 9h8M8 13h5"/></svg>Проекты</button>
    <button type="button" id="rail-collapse" title="свернуть/развернуть сайдбар"><svg viewBox="0 0 24 24"><path d="M14 6l-6 6 6 6"/></svg></button>
  </nav>
  <aside class="left">
    <div id="maps-box">
      <div class="ph"><div><h1>Проекты</h1><div class="sub" id="auth-who">аккаунт</div></div>
        <div class="ltools">
          <button type="button" id="btn-logout" title="выйти">⎋</button>
          <button type="button" id="btn-new-map" title="новый проект">+</button>
        </div></div>
      <div id="map-list"></div>
      <div id="layers-fold" class="open">
        <div class="fold-hd">
          <button type="button" id="layers-toggle" title="слои текущего проекта">
            <span class="jttl">Слои</span>
            <span id="layers-count"></span>
            <span class="jchev"></span>
          </button>
          <div class="ltools">
            <button type="button" id="btn-add-draw" title="новый слой">+</button>
          </div>
        </div>
        <div id="layers"></div>
      </div>
      <div id="journal-box">
        <button type="button" id="journal-toggle" title="журнал действий · клик по записи — откатить сюда">
          <span class="jttl">Журнал</span>
          <span id="journal-count"></span>
          <span class="jchev"></span>
        </button>
        <div id="journal"></div>
      </div>
      <div id="map-search">
        <div class="msub">Добавить из OSM</div>
        <div id="map-search-target">загрузка в текущий проект</div>
        <div class="qrow">
          <input id="map-q" type="search" placeholder="район, город, область" autocomplete="off">
          <button type="button" id="map-go">загрузить</button>
        </div>
        <div id="map-hits"></div>
        <p id="map-status" class="sub" style="margin-top:8px;padding:0 4px;color:#6f6f6f"></p>
        <div id="map-load" class="map-load">
          <div class="spin"></div>
          <span id="map-load-txt">загружаю…</span>
        </div>
      </div>
      <div id="copies">
        <div class="fold-hd">
          <button type="button" id="copies-toggle" title="копии карт (снимки)">
            <span class="jttl">Копии</span>
            <span class="jchev"></span>
          </button>
          <div class="ltools">
            <button type="button" id="copy-now" title="сохранить копию текущего проекта">💾</button>
          </div>
        </div>
        <div id="copies-list"></div>
      </div>
    </div>
  </aside>
  <div id="viewport">
    <div id="stage">
      {svg_html}
      <canvas id="draw"></canvas>
      <svg id="ruler" xmlns="http://www.w3.org/2000/svg"></svg>
      <svg id="doodle" xmlns="http://www.w3.org/2000/svg"></svg>
      <svg id="pins" xmlns="http://www.w3.org/2000/svg"></svg>
    </div>
    <div id="cross"><div class="h"></div><div class="v"></div></div>
    <div id="xy"></div>
    <div id="hint">ПКМ — красная на границе; ЛКМ между двумя соседними — жёлтая; ПКМ по точке — удалить</div>
    <div class="dock">
      <button type="button" id="btn-pick" class="on" title="выбор · клавиша V (любая раскладка)">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M4 3l8 18 2-7 7-2z"/></svg>
      </button>
      <button type="button" id="btn-pen" title="карандаш · клавиша P (любая раскладка)">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 20l4-1 11-11-3-3L5 16l-1 4z"/></svg>
      </button>
      <button type="button" id="btn-ruler" title="линейка: расстояние в px R">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 20L20 4M8 16l2 2M12 12l2 2M16 8l2 2"/></svg>
      </button>
      <button type="button" id="btn-smooth" title="сгладить сплайном (Catmull-Rom) · весь проект">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 17c3-4 6 4 9 0s6-4 9 0"/></svg>
      </button>
      <button type="button" id="btn-spline" title="сделать сплайн: перевести все границы швов из L в нативные C-Безье (мидлайн ±2.5px)">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 15c2-6 5 2 8-3s6-5 10-1"/><circle cx="3" cy="15" r="1.6" fill="currentColor" stroke="none"/><circle cx="21" cy="11" r="1.6" fill="currentColor" stroke="none"/></svg>
      </button>
      <button type="button" id="btn-marker" title="маркер: нарисовать подсказку поверх карты (клавиша B)">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 20l3-1 9-9-2-2-9 9-1 3z"/><path d="M13 5l2-2 4 4-2 2"/></svg>
      </button>
      <label class="thick" title="натяжение сплайна: 0 — вернуть контуры, больше — сильнее срезает углы">
        <input type="range" id="smooth" min="0" max="100" step="1" value="60">
        <span id="smooth-val">60</span>
      </label>
      <label class="thick" title="плотность ресемплинга: шаг между точками сплайна в px (как у маркера, ~2)">
        <input type="range" id="smooth-step" min="1" max="10" step="0.5" value="2">
        <span id="smooth-step-val">2</span>
      </label>
      <button type="button" id="btn-magnet" class="on" title="магнит к кромке тела">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M7 20v-8a5 5 0 0110 0v8M7 20h3v-7a2 2 0 014 0v7h3"/></svg>
      </button>
      <button type="button" id="btn-hand" title="рука: два тапа, на втором держи и тащи · H — режим">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M8 11V7a1 1 0 012 0v5M12 10V6a1 1 0 012 0v6M16 11V8a1 1 0 012 0v8a5 5 0 01-5 5h-1a6 6 0 01-6-6v-3"/></svg>
      </button>
      <div class="vr"></div>
      <label class="thick"> <input type="range" id="thick" min="0.25" max="40" step="0.25" value="0.25"> <span id="thick-val">0.25</span></label>
      <div class="vr"></div>
      <button type="button" id="btn-undo" title="отмена · Ctrl+Z (любая раскладка)">↩</button>
      <button type="button" id="btn-redo" title="повтор · Ctrl+Y / Ctrl+Shift+Z">↪</button>
      <button type="button" id="btn-fit" title="по экрану">⊡</button>
    </div>
  </div>
</div>
<script>
{js}
</script>
</body>
</html>
"""
    BENCH.write_text(page, encoding="utf-8")


if __name__ == "__main__":
    sys.exit(main())


