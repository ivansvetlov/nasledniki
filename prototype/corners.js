// corners.js — локальное скругление острых углов через квадратичный Bézier-фаску (fillet).
// Чистый обрезанный порт: только то, что нужно для границ районов. Контрольная точка фаски —
// сама вершина угла, поэтому на стыке со смежными отрезками получается C1-непрерывность (без переломов).
// Экспонируется как window.Corners / globalThis.Corners / module.exports.
//
// Ручки (маппинг на метафору LFO/ADSR):
//   speed  — число семплов вдоль фаски (плотность вых. кривой)   ~ Speed
//   tension (T, 0..1) — радиус фаски: больше = круглее угол          ~ Tension (округляет в обе стороны)
//   skew  (B, -1..1)  — сдвиг контр. точки перпендикулярно (асимметрия) ~ Skew
//   pulse (0..1)      — асимметрия радиуса ДО/ПОСЛЕ вершины         ~ Pulse Width
//   bias  (px, -8..8) — НАРУЖНЫЙ offset всей фаски: компенсирует
//                        естественное срезание выпуклых углов сплайном,
//                        держит кривую в ориентирах исходной границы ±
//   angle (deg)       — порог «остроты»: вершины с углом поворота >= angle считаются острыми
(function (root) {
  'use strict';

  function turnAngle(a, b, c) {
    const v1 = [a[0] - b[0], a[1] - b[1]];
    const v2 = [c[0] - b[0], c[1] - b[1]];
    const dot = v1[0] * v2[0] + v1[1] * v2[1];
    const m1 = Math.hypot(v1[0], v1[1]) || 1e-9;
    const m2 = Math.hypot(v2[0], v2[1]) || 1e-9;
    const cs = Math.max(-1, Math.min(1, dot / (m1 * m2)));
    // возвращаем УГОЛ ПОВОРОТА: 0 = прямо, 180 = разворот. Острый угол = большой поворот.
    return 180 - Math.acos(cs) * 180 / Math.PI;
  }

  function ringCcw(ring) {
    let a = 0;
    for (let i = 0; i < ring.length; i++) {
      const j = (i + 1) % ring.length;
      a += ring[i][0] * ring[j][1] - ring[j][0] * ring[i][1];
    }
    return a > 0;
  }

  // +mag = выпуклый (суша с внутренней стороны), −mag = вогнутый (бухта).
  function turnSigned(a, b, c, ccw) {
    const mag = turnAngle(a, b, c);
    const inx = b[0] - a[0], iny = b[1] - a[1];
    const outx = c[0] - b[0], outy = c[1] - b[1];
    const left = (inx * outy - iny * outx) > 0;
    const convex = ccw ? left : !left;
    return convex ? mag : -mag;
  }

  function detectCorners(ring, angle, innerAngle) {
    const n = ring.length, out = [];
    const ccw = ringCcw(ring);
    const innerOn = innerAngle != null;
    for (let i = 0; i < n; i++) {
      const a = ring[(i - 1 + n) % n], b = ring[i], c = ring[(i + 1) % n];
      const mag = turnAngle(a, b, c);
      if (!innerOn) {
        if (mag >= angle) out.push(i);
        continue;
      }
      const s = turnSigned(a, b, c, ccw);
      if (s >= 0 && mag >= angle) out.push(i);
      else if (s < 0 && innerAngle > 0 && mag >= innerAngle) out.push(i);
    }
    return out;
  }

  function centroid(ring) {
    let x = 0, y = 0;
    for (const p of ring) { x += p[0]; y += p[1]; }
    return [x / ring.length, y / ring.length];
  }

  function offsetOutward(pts, cen, bias) {
    const n = pts.length, out = [];
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[i], c = pts[Math.min(n - 1, i + 1)];
      let tx = c[0] - a[0], ty = c[1] - a[1];
      let nx = -ty, ny = tx;
      const m = Math.hypot(nx, ny) || 1; nx /= m; ny /= m;
      if (nx * (b[0] - cen[0]) + ny * (b[1] - cen[1]) < 0) { nx = -nx; ny = -ny; }
      out.push([b[0] + nx * bias, b[1] + ny * bias]);
    }
    return out;
  }

  function quadBezier(P0, P1, P2, s) {
    const u = 1 - s;
    return [
      u * u * P0[0] + 2 * u * s * P1[0] + s * s * P2[0],
      u * u * P0[1] + 2 * u * s * P1[1] + s * s * P2[1],
    ];
  }

  // Catmull-Rom точка между p1 и p2 при t∈[0,1]
  function catmull(P0, P1, P2, P3, t) {
    const t2 = t * t, t3 = t2 * t;
    return [
      0.5 * ((2 * P1[0]) + (-P0[0] + P2[0]) * t + (2 * P0[0] - 5 * P1[0] + 4 * P2[0] - P3[0]) * t2 + (-P0[0] + 3 * P1[0] - 3 * P2[0] + P3[0]) * t3),
      0.5 * ((2 * P1[1]) + (-P0[1] + P2[1]) * t + (2 * P0[1] - 5 * P1[1] + 4 * P2[1] - P3[1]) * t2 + (-P0[1] + 3 * P1[1] - 3 * P2[1] + P3[1]) * t3),
    ];
  }

  // Плотная гладкая кривая через опорные точки (Catmull-Rom).
  // tension (0..1): 0 = исходные фасетки (прямые сегменты), 1 = полностью округлая сплайн-кривая.
  // perSeg — число семплов на сегмент (плотность / Speed).
  function splineRing(ring, tension, perSeg) {
    const n = ring.length;
    if (n < 3) return ring.slice();
    const T = (tension === undefined ? 0.5 : tension);
    const S = Math.max(1, perSeg | 0);
    const out = [];
    for (let i = 0; i < n; i++) {
      const p0 = ring[(i - 1 + n) % n], p1 = ring[i], p2 = ring[(i + 1) % n], p3 = ring[(i + 2) % n];
      const cr = catmull(p0, p1, p2, p3, 0); // базовая точка сплайна в p1
      for (let s = 0; s < S; s++) {
        const c = catmull(p0, p1, p2, p3, s / S);
        // смешиваем фасетку (p1) и сплайн (c) по натяжению
        out.push([p1[0] + (c[0] - p1[0]) * T, p1[1] + (c[1] - p1[1]) * T]);
      }
    }
    return out;
  }

  function smoothCorners(ring, opts) {
    const o = Object.assign({
      speed: 8, tension: 0.5, skew: 0, pulse: 0.5, bias: 0, angle: 50,
      innerAngle: undefined,
    }, opts || {});
    const n = ring.length;
    const idx = (k) => ((k % n) + n) % n;
    if (n < 4) return ring.slice();

    const cen = centroid(ring);
    const ccw = ringCcw(ring);
    const corners = detectCorners(ring, o.angle, o.innerAngle);
    if (!corners.length) return ring.slice();

    const used = new Array(n).fill(false);
    const arcs = [];
    for (let ci = corners.length - 1; ci >= 0; ci--) {
      const i = corners[ci];
      if (used[i] || used[idx(i - 1)] || used[idx(i + 1)]) continue;
      const a = ring[idx(i - 1)], b = ring[i], c = ring[idx(i + 1)];
      const la = Math.hypot(a[0] - b[0], a[1] - b[1]);
      const lc = Math.hypot(c[0] - b[0], c[1] - b[1]);
      const baseR = Math.min(la, lc) * 0.45;
      if (baseR < 0.18) continue;

      // Pulse Width: асимметрия радиуса по двум сторонам угла
      const t = o.tension;
      let r1 = Math.min(baseR * t * Math.max(0.2, o.pulse * 2), la / 2);
      let r2 = Math.min(baseR * t * Math.max(0.2, (1 - o.pulse) * 2), lc / 2);
      const p1 = [b[0] + (a[0] - b[0]) * (r1 / la), b[1] + (a[1] - b[1]) * (r1 / la)];
      const p2 = [b[0] + (c[0] - b[0]) * (r2 / lc), b[1] + (c[1] - b[1]) * (r2 / lc)];

      // нормаль в вершине (для skew и bias) — ориентируем наружу по центроиду
      let nx = -(c[1] - a[1]), ny = (c[0] - a[0]);
      const nm = Math.hypot(nx, ny) || 1; nx /= nm; ny /= nm;
      if (nx * (b[0] - cen[0]) + ny * (b[1] - cen[1]) < 0) { nx = -nx; ny = -ny; }
      // у вогнутого угла «наружу от центроида» углубляет бухту — для bias
      // переворачиваем: плюс bias слегка заполняет выемку, а не рвёт её.
      if (turnSigned(a, b, c, ccw) < 0) { nx = -nx; ny = -ny; }
      const ctrl = [
        b[0] + o.skew * baseR * nx + o.bias * nx,
        b[1] + o.skew * baseR * ny + o.bias * ny,
      ];

      const S = Math.max(2, o.speed | 0);
      const arc = [];
      for (let s = 0; s <= S; s++) arc.push(quadBezier(p1, ctrl, p2, s / S));
      const pts = o.bias ? offsetOutward(arc, cen, o.bias) : arc;

      used[i] = used[idx(i - 1)] = used[idx(i + 1)] = true;
      arcs.push({ at: i, pts });
    }

    const arcAt = {};
    arcs.forEach(a => { arcAt[a.at] = a.pts; });
    const res = [];
    for (let k = 0; k < n; k++) {
      if (arcAt[k]) { for (const p of arcAt[k]) res.push(p); }
      else res.push(ring[k]);
    }
    return res;
  }

  function distToSeg(p, a, b) {
    const vx = b[0] - a[0], vy = b[1] - a[1];
    const wx = p[0] - a[0], wy = p[1] - a[1];
    const c1 = vx * wx + vy * wy, c2 = vx * vx + vy * vy;
    const t = c2 === 0 ? 0 : Math.max(0, Math.min(1, c1 / c2));
    const dx = p[0] - (a[0] + t * vx), dy = p[1] - (a[1] + t * vy);
    return Math.hypot(dx, dy);
  }

  // ФИНАЛЬНЫЙ контур-без-острых-углов: гарантированно открывает любой ВЫПУКЛЫЙ
  // острый угол (turn > 180-minDeg) до minDeg, подтягивая вершину К ХОРДЕ
  // соседей (середина a–c). Это надёжно раскрывает даже вырожденные шипы
  // (ребро ~1px), в отличие от сдвига вдоль биссектрисы. Не трогает вогнутые
  // (turn<0) — их правит fillConcavities. Порядок: после spline/фасок, ДО
  // untangle. Не использует skew/pulse/bias — не плодит узких артефактов.
  function clampMinAngle(ring, minDeg, maxIters, opts) {
    minDeg = minDeg == null ? 30 : minDeg;
    opts = opts || {};
    const inner = !!opts.inner;
    const maxTurn = 180 - minDeg;
    let r = ring.slice();
    const n = r.length, idx = (k) => ((k % n) + n) % n;
    const ccw = ringCcw(r);
    for (let it = 0; it < (maxIters || 8); it++) {
      let changed = false;
      for (let i = 0; i < n; i++) {
        const a = r[idx(i - 1)], b = r[i], c = r[idx(i + 1)];
        const s = turnSigned(a, b, c, ccw);
        const mag = Math.abs(s);
        if (s < 0 && !inner) continue;
        if (mag <= maxTurn) continue;
        const f = 0.5;   // подтяжка к середине хорды a–c (раскрывает угол)
        r[i] = [b[0] + ((a[0] + c[0]) / 2 - b[0]) * f, b[1] + ((a[1] + c[1]) / 2 - b[1]) * f];
        changed = true;
      }
      if (!changed) break;
    }
    return r;
  }

  // Выпрямление ГЛУБОКИХ УЗКИХ вогнутостей (провалы вовнутрь, как Нефтегорский):
  // вогнутые вершины (turn<0), ушедшие от хорды соседей глубже depth, притягиваем
  // к хорде — провал выполаживается/убирается. Плавно, за несколько итераций.
  function fillConcavities(ring, opts) {
    opts = opts || {};
    const depth = opts.depth == null ? 8 : opts.depth;
    const sharpDeg = opts.sharpDeg == null ? 0 : opts.sharpDeg;
    const sharpDepth = opts.sharpDepth == null ? 0.8 : opts.sharpDepth;
    const maxIters = opts.iters || 8;
    let r = ring.slice();
    const n = r.length, idx = (k) => ((k % n) + n) % n;
    const ccw = ringCcw(r);
    for (let it = 0; it < maxIters; it++) {
      let changed = false;
      for (let i = 0; i < n; i++) {
        const a = r[idx(i - 1)], b = r[i], c = r[idx(i + 1)];
        const t = turnSigned(a, b, c, ccw);
        if (t >= 0) continue;                 // только вогнутые
        const d = distToSeg(b, a, c);
        const sharp = sharpDeg > 0 && Math.abs(t) >= sharpDeg && d > sharpDepth;
        if (d <= depth && !sharp) continue;
        const f = 0.5;
        r[i] = [b[0] + ((a[0] + c[0]) / 2 - b[0]) * f, b[1] + ((a[1] + c[1]) / 2 - b[1]) * f];
        changed = true;
      }
      if (!changed) break;
    }
    return r;
  }

  // ЛОКАЛЬНОЕ анти-защемление: расталкивает ТОЛЬКО перешеек СУШИ
  // (сосед через внутренность, дуга ≥ minArc). Выемки не трогаем.
  // reach 0..1: 0 — только шея (сиды), 1 — вся короткая дуга до кончика
  // («голова»), чтобы язык толстел целиком, а не одной шеей.
  // Сдвиг по внешней нормали. ПОСЛЕ clampMinAngle, ДО untangle.
  function unpinch(ring, maxGap, opts) {
    opts = opts || {};
    if (maxGap == null || maxGap <= 0) return ring;
    const iters = opts.iters || 5;
    const strength = opts.strength == null ? 0.5 : opts.strength;
    const minArc = opts.minArc == null ? maxGap * 2 : opts.minArc;
    const reach = Math.max(0, Math.min(1, opts.reach == null ? 1 : opts.reach));
    let r = ring.map(function (p) { return [p[0], p[1]]; });
    const n = r.length;
    let area = 0; for (let i = 0; i < n; i++) { const j = (i + 1) % n; area += r[i][0] * r[j][1] - r[j][0] * r[i][1]; }
    const ccw = area > 0;
    const cell = Math.max(2, maxGap);
    const idx = function (k) { return ((k % n) + n) % n; };
    const normalAt = function (i) {
      const p = r[i], aa = r[idx(i - 1)], cc = r[idx(i + 1)];
      let n1 = [p[1] - aa[1], -(p[0] - aa[0])];
      let n2 = [cc[1] - p[1], -(cc[0] - p[0])];
      if (!ccw) { n1 = [-n1[0], -n1[1]]; n2 = [-n2[0], -n2[1]]; }
      let nx = n1[0] + n2[0], ny = n1[1] + n2[1];
      const nm = Math.hypot(nx, ny) || 1;
      return [nx / nm, ny / nm];
    };
    for (let it = 0; it < iters; it++) {
      const pref = [0];
      for (let i = 0; i < n; i++) {
        const a = r[i], b = r[(i + 1) % n];
        pref.push(pref[i] + Math.hypot(b[0] - a[0], b[1] - a[1]));
      }
      const peri = pref[n];
      const arcFwd = function (i, j) {
        if (i === j) return 0;
        if (j >= i) return pref[j] - pref[i];
        return peri - (pref[i] - pref[j]);
      };
      const arc = function (i, j) { return Math.min(arcFwd(i, j), peri - arcFwd(i, j)); };
      const grid = new Map();
      const key = function (x, y) { return ((x / cell) | 0) + ',' + ((y / cell) | 0); };
      for (let i = 0; i < n; i++) { const k = key(r[i][0], r[i][1]); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i); }
      const seedNd = [];
      for (let i = 0; i < n; i++) seedNd[i] = Infinity;
      for (let i = 0; i < n; i++) {
        const p = r[i];
        const nn = normalAt(i), nx = nn[0], ny = nn[1];
        const gx = (p[0] / cell) | 0, gy = (p[1] / cell) | 0;
        let nj = -1, nd = 1e9;
        for (let a = gx - 1; a <= gx + 1; a++) for (let b = gy - 1; b <= gy + 1; b++) {
          const arr = grid.get(a + ',' + b); if (!arr) continue;
          for (let q = 0; q < arr.length; q++) {
            const j = arr[q];
            if (j === i) continue;
            if (arc(i, j) < minArc) continue;
            const dx = r[j][0] - p[0], dy = r[j][1] - p[1], d = Math.hypot(dx, dy);
            if (d < 1e-6 || d >= maxGap || d >= nd) continue;
            if (nx * dx + ny * dy >= 0) continue;
            nd = d; nj = j;
          }
        }
        if (nj < 0) continue;
        const midX = (p[0] + r[nj][0]) / 2, midY = (p[1] + r[nj][1]) / 2;
        let inside = false;
        for (let a = 0, b = n - 1; a < n; b = a++) {
          const yi = r[a][1], yj = r[b][1];
          if ((yi > midY) !== (yj > midY) &&
              midX < (r[b][0] - r[a][0]) * (midY - yi) / ((yj - yi) || 1e-12) + r[a][0]) inside = !inside;
        }
        if (!inside) continue;
        const dFwd = arcFwd(i, nj);
        const short = Math.min(dFwd, peri - dFwd) || 1e-9;
        const dir = dFwd <= peri - dFwd ? 1 : -1;
        let k = i, walked = 0, guard = 0;
        while (guard++ <= n) {
          if (walked <= short + 1e-6) {
            const isEnd = k === i || k === nj;
            const u = walked / short;
            const dTip = 1 - 2 * Math.min(u, 1 - u);
            if (isEnd || (reach > 0 && dTip <= reach + 1e-6)) {
              if (nd < seedNd[k]) seedNd[k] = nd;
            }
          }
          if (k === nj) break;
          const nxt = idx(k + dir);
          walked += Math.hypot(r[nxt][0] - r[k][0], r[nxt][1] - r[k][1]);
          k = nxt;
          if (walked > short + maxGap) break;
        }
      }
      const disp = r.map(function () { return [0, 0]; });
      let moved = false;
      for (let i = 0; i < n; i++) {
        if (seedNd[i] >= maxGap) continue;
        const nn = normalAt(i);
        const push = Math.min(maxGap, (maxGap - seedNd[i]) * strength);
        disp[i][0] += nn[0] * push;
        disp[i][1] += nn[1] * push;
        moved = true;
      }
      if (!moved) break;
      for (let i = 0; i < n; i++) { r[i][0] += disp[i][0]; r[i][1] += disp[i][1]; }
    }
    return r;
  }

  // Короткие выпуклые «соски»: кластер 1–N вершин с малым пролётом вдоль края.
  // Не фаска (ей мешает baseR на рёбрах ~1px) и не minAngle (тот ловит иголки ≳170°).
  // Тянем середины к хорде концов окна. Крупные мысы (длинный span) не трогаем.
  function clipNubs(ring, opts) {
    opts = opts || {};
    const maxSpan = opts.maxSpan == null ? 10 : opts.maxSpan;
    const minDepth = opts.minDepth == null ? 0.15 : opts.minDepth;
    const minTurn = opts.minTurn == null ? 16 : opts.minTurn;
    const maxWin = opts.maxWin == null ? 6 : opts.maxWin;
    const maxIters = opts.iters == null ? 10 : opts.iters;
    const f = opts.pull == null ? 0.55 : opts.pull;
    if (!ring || ring.length < 5) return ring ? ring.slice() : [];
    let r = ring.map(function (p) { return [p[0], p[1]]; });
    const n = r.length, idx = function (k) { return ((k % n) + n) % n; };
    const ccw = ringCcw(r);
    for (let it = 0; it < maxIters; it++) {
      let changed = false;
      for (let i = 0; i < n; i++) {
        for (let w = 1; w <= maxWin; w++) {
          const ia = idx(i - 1), ic = idx(i + w);
          const a = r[ia], c = r[ic];
          let span = 0, ok = true, deep = 0;
          let prev = a;
          for (let k = 0; k < w; k++) {
            const b = r[idx(i + k)];
            const pr = r[idx(i + k - 1)], nx = r[idx(i + k + 1)];
            const s = turnSigned(pr, b, nx, ccw);
            if (s <= 0 || Math.abs(s) < minTurn) { ok = false; break; }
            span += Math.hypot(b[0] - prev[0], b[1] - prev[1]);
            prev = b;
            const d = distToSeg(b, a, c);
            if (d > deep) deep = d;
          }
          span += Math.hypot(c[0] - prev[0], c[1] - prev[1]);
          if (!ok || span > maxSpan || deep < minDepth) continue;
          for (let k = 0; k < w; k++) {
            const j = idx(i + k), b = r[j];
            const hit = (function () {
              const vx = c[0] - a[0], vy = c[1] - a[1];
              const c2 = vx * vx + vy * vy || 1e-9;
              let t = ((b[0] - a[0]) * vx + (b[1] - a[1]) * vy) / c2;
              if (t < 0) t = 0; else if (t > 1) t = 1;
              return [a[0] + t * vx, a[1] + t * vy];
            })();
            r[j] = [b[0] + (hit[0] - b[0]) * f, b[1] + (hit[1] - b[1]) * f];
          }
          changed = true;
          break;
        }
      }
      if (!changed) break;
    }
    return r;
  }

  const Corners = { detectCorners, smoothCorners, turnAngle, turnSigned, ringCcw, quadBezier, catmull, splineRing, clampMinAngle, fillConcavities, unpinch, clipNubs, distToSeg };
  if (typeof module !== 'undefined' && module.exports) module.exports = Corners;
  root.Corners = Corners;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
