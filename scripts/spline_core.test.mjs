// spline_core.test.mjs — TDD: тесты на ЖЕЛАЕМОЕ поведение сплайн/топо ядра.
// Сейчас падают (RED), потому что spline_core.mjs содержит текущую баго-логику.
// После исправления spline_core.mjs должны стать GREEN.

import test from "node:test";
import assert from "node:assert/strict";
import { topoSnapshot, topoRestore, compactJournal } from "./spline_core.mjs";

function makeEdges() {
  return [
    { id: "e1", districtA: "Район1", districtB: "Район2",
      base: [[0, 0], [10, 0], [10, 10], [0, 10]], pins: [], bankA: null, bankB: null },
    { id: "e2", districtA: "Район2", districtB: "Район3",
      base: [[10, 0], [20, 0], [20, 10], [10, 10]], pins: [], bankA: null, bankB: null },
  ];
}

function makeDistrictDs() {
  return {
    "Район1": "M0,0 L10,0 L10,10 L0,10 Z",
    "Район2": "M10,0 L20,0 L20,10 L10,10 Z",
    "Район3": "M20,0 L30,0 L30,10 L20,10 Z",
  };
}

// ---- RED 1: snapshot должен захватывать исходную геометрию районов ----
test("topoSnapshot сохраняет исходный d районов в snap.districts", () => {
  const edges = makeEdges();
  const ds = makeDistrictDs();
  const snap = topoSnapshot(edges, ds);
  assert.ok(snap.districts, "snap должен содержать поле districts");
  assert.deepEqual(snap.districts, ds);
});

// ---- RED 2: undo должен возвращать точный исходный d районов ----
test("topoRestore возвращает исходный d районов (undo восстанавливает геометрию)", () => {
  const edges = makeEdges();
  const original = makeDistrictDs();
  const snap = topoSnapshot(edges, original);

  // имитируем «сплайнизацию»: мутируем рёбра (как делает materializeSplines)
  edges[0].base = [[1, 1], [2, 2], [3, 3]];
  edges[0].bankA = [[[1, 1], [2, 2], [3, 3], [4, 4]]];

  const restored = topoRestore(edges, snap);
  assert.deepEqual(restored, original, "topoRestore должен вернуть исходный d районов");
});

// ---- RED 3: журнал должен сохранять type:"topo" при сохранении ----
test("compactJournal сохраняет записи type:'topo' (undo переживает перезагрузку)", () => {
  const list = [
    { type: "topo", id: 1, label: "шов", topo: [] },
    { type: "apply", id: 2, label: "действие", snap: {} },
    { type: "topo", id: 3, label: "шов2", topo: [] },
  ];
  const out = compactJournal(list);
  const topoKept = out.filter((x) => x.type === "topo");
  assert.equal(topoKept.length, 2, "compactJournal не должен выбрасывать type:'topo'");
});
