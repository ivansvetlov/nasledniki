# -*- coding: utf-8 -*-
"""
verify_map_good.py — жёсткая проверка "золотого" состояния карты samara.
Запуск:  python scripts/verify_map_good.py
Выход:   0 = всё OK, 1 = нарушен хотя бы один инвариант.

Инварианты базируются НА ЭТАЛОНЕ map.svg.good (самобазируемые), поэтому при
легальном изменении карты достаточно перебазировать эталон (см. docs/MAP_KNOWN_GOOD.md),
не правя этот скрипт.

Базовые (из эталона):
  B1. Слой id=1 "Районы" — набор имён районов == эталону (ничто не удалено/добавлено).
  B2. Слой id=3 "Волга" (water-overlay) — набор имён водных тел == эталону.
  B3. Путь "Волга" имеет ту же заливку fill, что в эталоне (не чёрный!),
      и НЕ содержит кривых 'C' (чистый полигон L/Z).
Абсолютные (защита от регресса):
  A1. Геометрия НЕ искажена сплайном: пути районов не содержат 'C';
      суммарно 'C' в файле < 50 (эталон = 7).
  A2. Подсистема сплайнизации ОТКЛЮЧЕНА в map_editor.js (оба guard-а на месте).
  A3. state.json (если есть) не противоречит SVG: водный слой id == 3.
"""
import re, sys, os, json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MAPDIR = ROOT / "accounts" / "01601a7495be1aed" / "maps" / "samara"
SVG = MAPDIR / "map.svg"
GOOD = MAPDIR / "map.svg.good"
STATE = MAPDIR / "state.json"
EDITOR = ROOT / "scripts" / "map_editor.js"

fails = []
def check(cond, msg):
    if cond:
        print("  PASS:", msg)
    else:
        print("  FAIL:", msg)
        fails.append(msg)

def parse_layers(text):
    out = {}
    for gm in re.finditer(r'<g\b(?=[^>]*\bdata-layer-id="(\d+)")[^>]*>', text):
        gid = gm.group(1)
        start = gm.end()
        end = text.find("</g>", start)
        body = text[start:end] if end != -1 else ""
        name_m = re.search(r'data-layer-name="([^"]*)"', gm.group(0))
        paths = []
        for pm in re.finditer(r'<path\b[^>]*>', body):
            tag = pm.group(0)
            nm = re.search(r'data-name="([^"]*)"', tag)
            fill = re.search(r'\bfill="([^"]*)"', tag)
            d = re.search(r'\bd="([^"]*)"', tag)
            paths.append({"name": nm.group(1) if nm else None,
                          "fill": fill.group(1) if fill else None,
                          "d": d.group(1) if d else ""})
        out[gid] = {"name": name_m.group(1) if name_m else None, "paths": paths}
    return out

# ----- эталон -----
good = parse_layers(GOOD.read_text(encoding="utf-8")) if GOOD.exists() else {}
gold1 = sorted(p["name"] for p in good.get("1", {}).get("paths", []) if p["name"])
gold3 = sorted(p["name"] for p in good.get("3", {}).get("paths", []) if p["name"])
gold_volga = next((p for p in good.get("3", {}).get("paths", []) if p["name"] == "Волга"), None)
gold_volga_fill = (gold_volga["fill"].upper() if gold_volga and gold_volga["fill"] else None)

print("== Проверка map.svg ==")
if not SVG.exists():
    print("FATAL: map.svg отсутствует"); sys.exit(1)
t = SVG.read_text(encoding="utf-8")
layers = parse_layers(t)

# B1
r = layers.get("1")
check(r is not None, "слой id=1 (Районы) присутствует")
if r:
    names1 = sorted(p["name"] for p in r["paths"] if p["name"])
    check(names1 == gold1,
          "набор имён районов == эталону map.svg.good (%d шт.)" % len(gold1))

# B2 + B3
w = layers.get("3")
check(w is not None and w["name"] == "Волга", "слой id=3 'Волга' (water-overlay) присутствует")
if w:
    wn = sorted(p["name"] for p in w["paths"] if p["name"])
    check(wn == gold3, "набор имён водных тел == эталону (%s)" % gold3)
    volga = next((p for p in w["paths"] if p["name"] == "Волга"), None)
    check(volga is not None, "путь 'Волга' присутствует в водном слое")
    if volga:
        check(gold_volga_fill is not None and (volga["fill"] or "").upper() == gold_volga_fill,
              "Волга имеет ту же заливку, что в эталоне (%r), а не чёрную" % gold_volga_fill)
        check("C" not in volga["d"], "Волга НЕ содержит кривых 'C' (чистый полигон)")
        check(len(volga["d"]) >= 1000, "Волга имеет полную геометрию (d=%d)" % len(volga["d"]))

# A1 — отсутствие искажения сплайном
c_total = len(re.findall(r"(?i)\bc", t))
check(c_total < 50, "суммарно 'C' в файле < 50 (эталон 7, сейчас %d)" % c_total)
if r:
    bad = [p["name"] for p in r["paths"] if p["name"] and "C" in p["d"]]
    check(not bad, "пути районов не содержат 'C' (сплайн не включался)" + ("" if not bad else ": %s" % bad))

# A2 — сплайн отключён
print("== Проверка map_editor.js ==")
ej = EDITOR.read_text(encoding="utf-8") if EDITOR.exists() else ""
check("сплайнизация отключена" in ej, "materializeSplines заблокирован (guard на месте)")
check("SPLINE DISABLED" in ej, "renderDistrictSide заблокирован (guard на месте)")

# A3 — state.json консистентен
print("== Проверка state.json ==")
if STATE.exists():
    try:
        st = json.load(open(STATE, encoding="utf-8"))
        found = None
        for l in (st.get("layers") or []):
            if l.get("id") == 3 or "Волга" in str(l.get("name")):
                found = l.get("id")
        check(found in (3, None) or found == 3, "state.json водный слой id == 3 (сейчас %r)" % found)
    except Exception as e:
        check(False, "state.json читается: %s" % e)
else:
    print("  INFO: state.json отсутствует (допустимо — кэш, SVG источник истины)")

print()
if fails:
    print("РЕЗУЛЬТАТ: FAIL (%d нарушений)" % len(fails))
    sys.exit(1)
print("РЕЗУЛЬТАТ: PASS — состояние карты эталонное")
sys.exit(0)
