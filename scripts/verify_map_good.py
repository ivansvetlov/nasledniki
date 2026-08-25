# -*- coding: utf-8 -*-
"""
verify_map_good.py — жёсткая проверка "золотого" состояния карты samara.
Запуск:  python scripts/verify_map_good.py
Выход:   0 = всё OK, 1 = нарушен хотя бы один инвариант.

Инварианты (зафиксированы после сеанса отладки 2026-08-25):
  G1. Слой id=1 "Районы" содержит ровно 26 районов, и их НАБОРЫ имён
      совпадают с эталоном map.svg.good (ничего не удалено/добавлено).
  G2. Слой id=3 "Волга" (water-overlay) содержит ровно 3 водных тела:
      Волга + Куйбышевское + Саратовское водохранилища.
  G3. Путь "Волга" имеет fill="#B7C4BC" fill-opacity="0.5" (не чёрный!)
      и НЕ содержит кривых 'C' (чистый полигон L/Z).
  G4. Геометрия НЕ искажена сплайном: пути слоя Районы не содержат 'C';
      суммарно 'C' в файле < 50 (эталон = 7).
  G5. Подсистема сплайнизации ОТКЛЮЧЕНА в map_editor.js (оба guard-а на месте).
  G6. state.json (если есть) не противоречит SVG: водный слой id == 3.
"""
import re, sys, os
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
    """Возвращает {id: {'name':.., 'paths':[{'name','fill','d'}]}} для <g data-layer-id>."""
    out = {}
    for gm in re.finditer(r'<g\b(?=[^>]*\bdata-layer-id="(\d+)")[^>]*>', text):
        gid = gm.group(1)
        # захват тела до ближайшего </g>
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
            paths.append({
                "name": nm.group(1) if nm else None,
                "fill": fill.group(1) if fill else None,
                "d": d.group(1) if d else "",
            })
        out[gid] = {"name": name_m.group(1) if name_m else None, "paths": paths}
    return out

print("== Проверка map.svg ==")
if not SVG.exists():
    print("FATAL: map.svg отсутствует"); sys.exit(1)
t = SVG.read_text(encoding="utf-8")
layers = parse_layers(t)

# G1
r = layers.get("1")
check(r is not None, "слой id=1 (Районы) присутствует")
if r:
    names1 = sorted(p["name"] for p in r["paths"] if p["name"])
    check(len(names1) == 26, "в слое Районы ровно 26 районов (сейчас %d)" % len(names1))
    if GOOD.exists():
        good = parse_layers(GOOD.read_text(encoding="utf-8")).get("1")
        gn = sorted(p["name"] for p in good["paths"] if p["name"]) if good else []
        check(names1 == gn, "набор имён районов совпадает с эталоном map.svg.good")

# G2 + G3
w = layers.get("3")
check(w is not None and w["name"] == "Волга", "слой id=3 'Волга' (water-overlay) присутствует")
if w:
    wn = sorted(p["name"] for p in w["paths"] if p["name"])
    check(len(wn) == 3, "в водном слое ровно 3 тела (сейчас %d: %s)" % (len(wn), wn))
    volga = next((p for p in w["paths"] if p["name"] == "Волга"), None)
    check(volga is not None, "путь 'Волга' присутствует в водном слое")
    if volga:
        check(volga["fill"] and volga["fill"].upper() == "#B7C4BC",
              "Волга имеет fill=#B7C4BC (не чёрный), сейчас %r" % volga["fill"])
        check("C" not in volga["d"], "Волга НЕ содержит кривых 'C' (чистый полигон)")
        check(len(volga["d"]) >= 4000, "Волга имеет полную геометрию (d=%d)" % len(volga["d"]))

# G4 — отсутствие искажения сплайном
c_total = len(re.findall(r"(?i)\bc", t))
check(c_total < 50, "суммарно 'C' в файле < 50 (эталон 7, сейчас %d)" % c_total)
if r:
    bad = [p["name"] for p in r["paths"] if p["name"] and "C" in p["d"]]
    check(not bad, "пути районов не содержат 'C' (сплайн не включался)" + ("" if not bad else ": %s" % bad))

# G5 — сплайн отключён
print("== Проверка map_editor.js ==")
ej = EDITOR.read_text(encoding="utf-8") if EDITOR.exists() else ""
check("сплайнизация отключена" in ej, "materializeSplines заблокирован (guard на месте)")
check("SPLINE DISABLED" in ej, "renderDistrictSide заблокирован (guard на месте)")

# G6 — state.json консистентен
print("== Проверка state.json ==")
if STATE.exists():
    try:
        st = __import__("json").load(open(STATE, encoding="utf-8"))
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
