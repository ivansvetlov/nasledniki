// spline_smooth.test.mjs — TDD для сглаживателя районов (catmullRomRing).
//
// Шаг 1 (этот коммит/итерация): ЗАФИКСИРОВАТЬ текущее поведение
//   (сглаживатель СОХРАНЯЕТ тонкие выступы) и определить ЦЕЛЬ
//   (выступы должны сглаживаться). Тест-цель сейчас КРАСНЫЙ (RED) —
//   это и есть следующий шаг реализации.
//
// Якоря в map_editor.js: catmullRomRing :4282, smoothDistrictPaths :4320.

import test from "node:test";
import assert from "node:assert/strict";
import { catmullRomRing, polygonArea } from "./spline_core.mjs";

// квадрат 100x100 с узким выступом-пикой (высота 40, ширина 20) сверху
function squareWithSpike() {
  return [
    [0, 0], [100, 0], [100, 100], [60, 100], [50, 140], [40, 100], [0, 100],
  ];
}
function maxY(ring) {
  return ring.reduce((m, p) => Math.max(m, p[1]), -Infinity);
}

// ---- санити: обычный квадрат не теряет площадь при сглаживании ----
test("catmullRomRing сохраняет площадь простого квадрата", () => {
  const sq = [[0, 0], [100, 0], [100, 100], [0, 100]];
  const out = catmullRomRing(sq, 0.6, 2);
  const before = polygonArea(sq);
  const after = polygonArea(out);
  // Catmull-Rom с натяжением 0.6 «надувает» площадь — допускаем разброс,
  // главное что форма не разваливается.
  assert.ok(after > before * 0.8 && after < before * 1.25,
    `площадь ${before} -> ${after}`);
});

// ---- ХАРАКТЕРИЗАЦИЯ текущего поведения: тонкий выступ СОХРАНЯЕТСЯ ----
test("[текущее] сглаживатель сохраняет тонкий выступ", () => {
  const ring = squareWithSpike();
  const out = catmullRomRing(ring, 0.6, 2);
  const tipBefore = maxY(ring);   // 140
  const tipAfter = maxY(out);
  assert.ok(tipAfter > 130,
    `выступ должен сохраняться (было y=${tipBefore}, стало y=${tipAfter})`);
});

// ---- ЦЕЛЬ (RED): тонкие выступы должны сглаживаться/убираться ----
test("[ЦЕЛЬ] сглаживатель убирает тонкие выступы (пики сплющиваются)", () => {
  const ring = squareWithSpike();
  const out = catmullRomRing(ring, 0.6, 2);
  const tipAfter = maxY(out);
  // желаемое: пика высотой 40px исчезает, остаётся близко к базовой грани y=100
  assert.ok(tipAfter < 110,
    `тонкий выступ должен сглаживаться (сейчас y=${tipAfter}, хотим <110)`);
});
