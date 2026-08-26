import { universalSmooth } from "./spline_core.mjs";
import { test } from "node:test";
import assert from "node:assert";

// Синтетический квадрат 200x200 с НЕБОЛЬШИМ выступом (10px) на верхней грани —
// модель «тонкого выступа» из реальной карты (амплитуда ~10px, основание ~14px).
function squareWithBump() {
  const s = 200, base = 300;
  const pts = [];
  pts.push([base, base + s]);          // низ-лево
  pts.push([base, base - s]);          // верх-лево
  // верхняя грань с бугром посередине (y=100 — база грани)
  pts.push([393, 100]);
  pts.push([396, 92]);
  pts.push([400, 90]);                  // пик бугра (на 10px выше грани)
  pts.push([404, 92]);
  pts.push([407, 100]);
  pts.push([base + s, base - s]);       // верх-право
  pts.push([base + s, base + s]);       // низ-право
  return pts;
}

function topDeviation(ring) {
  return Math.max(...ring.map((p) => 100 - p[1]));
}

test("universalSmooth сглаживает тонкий выступ (амплитуда падает >60%)", () => {
  const ring = squareWithBump();
  const before = topDeviation(ring);
  const smoothed = universalSmooth(ring, { spacing: 3, window: 9 });
  const after = topDeviation(smoothed);
  assert.ok(before > 8, `bad fixture: bump=${before}`);
  assert.ok(after < before * 0.6, `bump not flattened: ${before} -> ${after}`);
  // основной размер квадрата сохраняется
  const xs = smoothed.map((p) => p[0]), ys = smoothed.map((p) => p[1]);
  const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
  assert.ok(w > 150 && h > 150, `shape collapsed: ${w}x${h}`);
});

test("universalSmooth детерминирован и сохраняет замкнутость кольца", () => {
  const ring = squareWithBump();
  const a = universalSmooth(ring);
  const b = universalSmooth(ring);
  assert.deepStrictEqual(a, b);
  // кольцо замкнуто: последняя точка рядом с первой (ресемпл не замыкает, но окрестность)
  const d = Math.hypot(a[0][0] - a[a.length - 1][0], a[0][1] - a[a.length - 1][1]);
  assert.ok(d < 6, `ring not closed, gap ${d}`);
});
