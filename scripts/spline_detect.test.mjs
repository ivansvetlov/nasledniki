import { detectThin, resampleRing } from "./spline_core.mjs";
import { test } from "node:test";
import assert from "node:assert";

// Квадрат 200 с тонкой "сосиской" шириной 6, торчащей вверх
function squareWithSausage() {
  return [
    [300, 300], [300, 100],
    [397, 100], [397, 40], [403, 40], [403, 100],
    [500, 100], [500, 300],
  ];
}

test("detectThin помечает узкую сосиску, но не тело квадрата", () => {
  const raw = squareWithSausage();
  const ring = resampleRing(raw, 3); // для проверок по y
  const thin = detectThin(raw, 3);   // r0=3, порог 1.5*r0=4.5 (resample внутри один раз)
  const flagged = thin.filter(Boolean).length;
  assert.ok(flagged > 0, "ни одна точка не помечена как тонкая");
  assert.ok(flagged < ring.length, "помечено слишком много — нет различия с телом");
  // все точки в районе сосиски (y<50) — тонкие
  for (let i = 0; i < ring.length; i++)
    if (ring[i][1] < 50) assert.ok(thin[i], `сосиска y=${ring[i][1]} не помечена`);
  // все точки тела (y>150) — НЕ тонкие
  for (let i = 0; i < ring.length; i++)
    if (ring[i][1] > 150) assert.ok(!thin[i], `тело y=${ring[i][1]} ошибочно помечено`);
});
