import { shrinkRing, polygonArea, resampleRing } from "./spline_core.mjs";
import { test } from "node:test";
import assert from "node:assert";

function pin(p, ring) {
  let inside = false, n = ring.length;
  for (let i = 0; i < n; i++) {
    const ax = ring[i][0], ay = ring[i][1];
    const bx = ring[(i + 1) % n][0], by = ring[(i + 1) % n][1];
    if ((ay > p[1]) !== (by > p[1]) && p[0] < ((bx - ax) * (p[1] - ay)) / (by - ay) + ax)
      inside = !inside;
  }
  return inside;
}

function square() {
  return [[300, 300], [300, 100], [500, 100], [500, 300]];
}
function squareWithSpike() {
  return [[300, 300], [300, 100], [395, 100], [400, 40], [405, 100], [500, 100], [500, 300]];
}

test("shrinkRing уменьшает площадь и остаётся ВНУТРИ оригинала", () => {
  const orig = square();
  const out = shrinkRing(orig, 10, { finalSmooth: false });
  assert.ok(polygonArea(out) < polygonArea(orig) * 0.95, "area did not shrink");
  for (const p of out) assert.ok(pin(p, orig), `point ${p} outside original`);
});

test("shrinkRing стирает тонкий выступ уже 2r (эрозия)", () => {
  const orig = squareWithSpike();
  const tipY = Math.min(...orig.map((p) => p[1]));
  const out = shrinkRing(orig, 8, { finalSmooth: false });
  const outMinY = Math.min(...out.map((p) => p[1]));
  assert.ok(outMinY > tipY + 40, `spike not eroded: tip ${tipY}, got ${outMinY}`);
  for (const p of out) assert.ok(pin(p, orig), `point ${p} outside original`);
});

test("shrinkRing детерминирован", () => {
  const a = shrinkRing(square(), 6, { finalSmooth: 0.6 });
  const b = shrinkRing(square(), 6, { finalSmooth: 0.6 });
  assert.deepStrictEqual(a, b);
});
