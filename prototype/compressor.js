/* compressor.js — чистый геометрический движок сплайн-компрессора.
   Не зависит от DOM/редактора. Подключается <script src="compressor.js"> до debug_overlay.js.
   В браузере доступен как window.Compressor; в node — через module.exports (для тестов). */
(function (root) {
  "use strict";

  function parsePts(d) {
    var out = [], m, re = /([+-]?\d+\.?\d*),([+-]?\d+\.?\d*)/g;
    while ((m = re.exec(d))) out.push([parseFloat(m[1]), parseFloat(m[2])]);
    return out;
  }
  function dist2seg(p, a, b) {
    var vx = b[0] - a[0], vy = b[1] - a[1], wx = p[0] - a[0], wy = p[1] - a[1];
    var c1 = vx * wx + vy * wy, c2 = vx * vx + vy * vy, t = c2 === 0 ? 0 : Math.max(0, Math.min(1, c1 / c2));
    var dx = p[0] - (a[0] + t * vx), dy = p[1] - (a[1] + t * vy);
    return Math.sqrt(dx * dx + dy * dy);
  }
  function resampleRing(ring, spacing) {
    if (!ring || ring.length < 2) return ring ? ring.slice() : [];
    var pts = ring.slice();
    if (pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts.pop();
    var n = pts.length; if (n < 2) return pts;
    var cum = [0], total = 0, i;
    for (i = 0; i < n; i++) { var a = pts[i], b = pts[(i + 1) % n]; total += Math.hypot(b[0] - a[0], b[1] - a[1]); cum.push(total); }
    if (total === 0) return pts;
    var out = [];
    for (var d = 0; d < total; d += spacing) {
      var lo = 0, hi = n; while (lo < hi) { var mid = (lo + hi) >> 1; if (cum[mid] <= d) lo = mid + 1; else hi = mid; }
      var k = Math.max(1, lo) - 1, p0 = pts[k], p1 = pts[(k + 1) % n], segL = (cum[k + 1] - cum[k]) || 1, t = (d - cum[k]) / segL;
      out.push([p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t]);
    }
    return out;
  }
  function catmullSpline(p0, p1, p2, p3, t) {
    var t2 = t * t, t3 = t2 * t;
    return [0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
            0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)];
  }
  function simplifyPts(pts, eps) {
    if (pts.length < 3) return pts;
    function rec(s, e) {
      var maxd = 0, idx = 0;
      for (var i = s + 1; i < e; i++) { var d = dist2seg(pts[i], pts[s], pts[e]); if (d > maxd) { maxd = d; idx = i; } }
      if (maxd > eps) return rec(s, idx).slice(0, -1).concat(rec(idx, e));
      return [pts[s], pts[e]];
    }
    return rec(0, pts.length - 1);
  }
  function catmullRomRing(ring, tension, step) {
    if (!ring || ring.length < 3) return ring || [];
    tension = tension == null ? 0.6 : tension; step = step == null ? 2 : step;
    if (tension <= 0) return ring.slice();
    var pts = resampleRing(ring, step), n = pts.length;
    pts = simplifyPts(pts, step * 0.75); n = pts.length;
    if (n < 4) return pts; var out = [];
    for (var i = 0; i < n; i++) {
      var p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
      var len = 0, prev = p1;
      for (var kk = 1; kk <= 4; kk++) { var q = catmullSpline(p0, p1, p2, p3, kk / 4); len += Math.sqrt((q[0] - prev[0]) * (q[0] - prev[0]) + (q[1] - prev[1]) * (q[1] - prev[1])); prev = q; }
      var count = Math.max(1, Math.round(len / step));
      for (var j = 0; j < count; j++) {
        var t = j / count, sp = catmullSpline(p0, p1, p2, p3, t);
        var chx = p1[0] + (p2[0] - p1[0]) * t, chy = p1[1] + (p2[1] - p1[1]) * t;
        out.push([chx + (sp[0] - chx) * tension, chy + (sp[1] - chy) * tension]);
      }
    }
    return out;
  }
  function rdpSimplify(points, epsilon) {
    if (!points || points.length <= 2) return points ? points.slice() : [];
    var n = points.length;
    var keep = new Array(n);
    keep[0] = true; keep[n - 1] = true;
    var stack = [[0, n - 1]];
    while (stack.length) {
      var r = stack.pop(), s = r[0], e = r[1], maxD = 0, idx = -1;
      for (var i = s + 1; i < e; i++) {
        var d = dist2seg(points[i], points[s], points[e]);
        if (d > maxD) { maxD = d; idx = i; }
      }
      if (maxD > epsilon && idx >= 0) { keep[idx] = true; stack.push([s, idx]); stack.push([idx, e]); }
    }
    var out = [];
    for (var i = 0; i < n; i++) if (keep[i]) out.push(points[i]);
    return out;
  }
  function distToRing(p, ring) {
    var best = Infinity;
    for (var i = 0; i + 1 < ring.length; i++) { var d = dist2seg(p, ring[i], ring[i + 1]); if (d < best) best = d; }
    return best;
  }

  // Угол поворота в вершине i замкнутого кольца (0 = прямо, 180 = разворот)
  function turnAt(ring, i) {
    var n = ring.length;
    var a = ring[(i - 1 + n) % n], b = ring[i], c = ring[(i + 1) % n];
    var v1 = [a[0] - b[0], a[1] - b[1]], v2 = [c[0] - b[0], c[1] - b[1]];
    var m1 = Math.hypot(v1[0], v1[1]) || 1e-9, m2 = Math.hypot(v2[0], v2[1]) || 1e-9;
    var cs = (v1[0] * v2[0] + v1[1] * v2[1]) / (m1 * m2);
    cs = Math.max(-1, Math.min(1, cs));
    return 180 - Math.acos(cs) * 180 / Math.PI;
  }

  // «Берегущее фичи» упрощение: обычный RDP по отклонению eps, НО вершины с
  // поворотом |turn| >= keepAngle никогда не выбрасываются (держим и выпуклые
  // мысы, и ВОГНУТЫЕ выемки, как Приволжский SW — у них turn отрицательный).
  // Это решает «сжатие стороны в острый угол» при больших eps.
  function rdpKeepCorners(pts, eps, keepAngle) {
    var n = pts.length;
    if (n < 3) return pts.slice();
    if (keepAngle == null) keepAngle = 45;
    var forced = new Array(n).fill(false);
    for (var i = 1; i < n - 1; i++) if (Math.abs(turnAt(pts, i)) >= keepAngle) forced[i] = true;
    function rec(s, e) {
      var maxd = 0, idx = -1, i;
      for (i = s + 1; i < e; i++) { var d = dist2seg(pts[i], pts[s], pts[e]); if (d > maxd) { maxd = d; idx = i; } }
      if (maxd > eps) return rec(s, idx).slice(0, -1).concat(rec(idx, e));
      // внутри eps: всё же держим самый острый обязательный угол (выемку/мыс)
      var bestTA = -1, bestI = -1;
      for (i = s + 1; i < e; i++) {
        if (!forced[i]) continue;
        var ata = Math.abs(turnAt(pts, i));
        if (ata > bestTA) { bestTA = ata; bestI = i; }
      }
      if (bestI >= 0) return rec(s, bestI).slice(0, -1).concat(rec(bestI, e));
      return [pts[s], pts[e]];
    }
    return rec(0, n - 1);
  }

  function segIntersect(p1, p2, p3, p4) {
    var d1x = p2[0] - p1[0], d1y = p2[1] - p1[1], d2x = p4[0] - p3[0], d2y = p4[1] - p3[1];
    var den = d1x * d2y - d1y * d2x;
    if (Math.abs(den) < 1e-12) return null;
    var t = ((p3[0] - p1[0]) * d2y - (p3[1] - p1[1]) * d2x) / den;
    var u = ((p3[0] - p1[0]) * d1y - (p3[1] - p1[1]) * d1x) / den;
    if (t > 1e-9 && t < 1 - 1e-9 && u > 1e-9 && u < 1 - 1e-9) return [p1[0] + t * d1x, p1[1] + t * d1y];
    return null;
  }

  // Детектор самопересечения границы (grid-ускоренный). Возвращает список
  // {i, j, x} — пересечение сегмента i (P[i]→P[i+1], сегмент n-1 замыкает кольцо)
  // с сегментом j, x — точка пересечения.
  function selfIntersections(ring) {
    var n = ring.length;
    if (n < 4) return [];
    var P = ring, minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity, i;
    for (i = 0; i < n; i++) { var p = P[i]; if (p[0] < minx) minx = p[0]; if (p[0] > maxx) maxx = p[0]; if (p[1] < miny) miny = p[1]; if (p[1] > maxy) maxy = p[1]; }
    var cell = Math.max(8, Math.hypot(maxx - minx, maxy - miny) / 64);
    var cols = Math.max(1, Math.ceil((maxx - minx) / cell) + 1), rows = Math.max(1, Math.ceil((maxy - miny) / cell) + 1);
    // целочисленный индекс ячейки (cx + cy*cols) вместо строки → намного быстрее Map
    function cellOf(x, y) { var cx = ((x - minx) / cell) | 0, cy = ((y - miny) / cell) | 0; if (cx < 0) cx = 0; else if (cx > cols - 1) cx = cols - 1; if (cy < 0) cy = 0; else if (cy > rows - 1) cy = rows - 1; return cx + cy * cols; }
    function segEnd(k) { return k < n - 1 ? P[k + 1] : P[0]; }
    var grid = new Map();
    for (i = 0; i < n; i++) {
      var a = P[i], b = segEnd(i);
      var ca = cellOf(a[0], a[1]), cb = cellOf(b[0], b[1]);
      var cx0 = ca % cols, cy0 = (ca / cols) | 0, cx1 = cb % cols, cy1 = (cb / cols) | 0, cx, cy, t;
      if (cx0 > cx1) { t = cx0; cx0 = cx1; cx1 = t; }
      if (cy0 > cy1) { t = cy0; cy0 = cy1; cy1 = t; }
      for (cx = cx0; cx <= cx1; cx++) for (cy = cy0; cy <= cy1; cy++) {
        var kk = cx + cy * cols, arr = grid.get(kk); if (!arr) { arr = []; grid.set(kk, arr); } arr.push(i);
      }
    }
    var out = [], seen = new Set(), stamp = new Int32Array(n), qid = 0;
    for (i = 0; i < n; i++) {
      var a2 = P[i], b2 = segEnd(i);
      var ca2 = cellOf(a2[0], a2[1]), cb2 = cellOf(b2[0], b2[1]);
      var x0 = ca2 % cols, y0 = (ca2 / cols) | 0, x1 = cb2 % cols, y1 = (cb2 / cols) | 0, cxx, cyy, q;
      if (x0 > x1) { t = x0; x0 = x1; x1 = t; }
      if (y0 > y1) { t = y0; y0 = y1; y1 = t; }
      qid++;   // штамп вместо new Set() на каждый сегмент
      for (cxx = x0; cxx <= x1; cxx++) for (cyy = y0; cyy <= y1; cyy++) {
        var ar2 = grid.get(cxx + cyy * cols); if (!ar2) continue;
        for (q = 0; q < ar2.length; q++) {
          var j = ar2[q];
          if (stamp[j] === qid) continue; stamp[j] = qid;
          if (j <= i + 1) continue;            // смежные (общая вершина) — не считаем
          var k2 = i < j ? i + '_' + j : j + '_' + i;
          if (seen.has(k2)) continue;
          var xi = segIntersect(P[i], segEnd(i), P[j], segEnd(j));
          if (xi) { out.push({ i: i, j: j, x: xi }); seen.add(k2); }
        }
      }
    }
    return out;
  }

  // Локальное Лаплас-расправление окрестности пересечений (режим relax)
  function relaxCrossings(ring, xs, iters, amt, win) {
    var r = ring.slice(), n = r.length, set = new Set(), i;
    for (i = 0; i < xs.length; i++) {
      var I = ((xs[i].i % n) + n) % n, J = ((xs[i].j % n) + n) % n, d;
      for (d = -win; d <= win; d++) { set.add(((I + d) % n + n) % n); set.add(((J + d) % n + n) % n); }
    }
    for (var it = 0; it < iters; it++) {
      var out = [];
      for (i = 0; i < n; i++) {
        if (!set.has(i)) { out.push(r[i]); continue; }
        var a = r[(i - 1 + n) % n], b = r[(i + 1 + n) % n];
        out.push([r[i][0] + ((a[0] + b[0]) / 2 - r[i][0]) * amt, r[i][1] + ((a[1] + b[1]) / 2 - r[i][1]) * amt]);
      }
      r = out;
      if (!selfIntersections(r).length) break;
    }
    return r;
  }

  // Отсечь меньшую петлю по точке пересечения (режим cut). Возвращает новое кольцо
  // без короткой доли hourglass; место стыка слегка сглаживается.
  function cutSmallestLobe(r, xs, smoothWin) {
    var x = xs[0], n = r.length;
    var i = ((x.i % n) + n) % n, j = ((x.j % n) + n) % n;
    if (i > j) { var t = i; i = j; j = t; }
    var X = x.x, fwd = (j - i + n) % n, bwd = (i - j + n) % n, out;
    if (fwd <= bwd) {                       // короче прямая дуга i..j → выкидываем её, стыкуем через X
      out = r.slice(0, i + 1).concat([X], r.slice(j));
    } else {                                // короче обратная дуга → выкидываем её
      out = r.slice(0, j + 1).concat([X], r.slice(i));
    }
    // лёгкое сглаживание шва вокруг X (он теперь на позиции i+1)
    var m = out.length, seam = i + 1;
    if (smoothWin > 0 && m > smoothWin * 2) {
      for (var s = 0; s < 2; s++) {
        var tmp = out.slice();
        for (var d = 0; d < smoothWin; d++) {
          var a1 = (seam - d + m) % m, b1 = (seam + d) % m;
          for (var e = 0; e < 2; e++) {
            var idx = e === 0 ? a1 : b1, pr = out[(idx - 1 + m) % m], nx = out[(idx + 1) % m];
            tmp[idx] = [out[idx][0] + ((pr[0] + nx[0]) / 2 - out[idx][0]) * 0.4, out[idx][1] + ((pr[1] + nx[1]) / 2 - out[idx][1]) * 0.4];
          }
        }
        out = tmp;
      }
    }
    return out;
  }

  // Матрица режимов обработки самопересечения границы (ТАБУ):
  //   off   — только детекция/счётчик, ничего не правим
  //   relax — расправить петлю на месте (Лаплас в окрестности)
  //   cut   — отсечь меньшую долю + сгладить шов
  //   auto  — на каждой итерации пробуем разрезать по КАЖДОМУ пересечению и
  //           берём тот, что больше всего убавляет число; если ни один разрез
  //           не убавляет — один relax как запасной. Никогда не ухудшаем.
  function untangleRing(ring, mode, opts) {
    opts = opts || {};
    if (mode === 'off') return { ring: ring.slice(), fixed: 0, crossings: selfIntersections(ring).length };
    var relaxIters = opts.relaxIters || 12, relaxAmt = opts.relaxAmt == null ? 0.5 : opts.relaxAmt, win = opts.win || 6, smoothWin = opts.smoothWin == null ? 10 : opts.smoothWin;
    var r = ring.slice(), fixed = 0, passes = 0;
    var allowCut = (mode === 'auto' || mode === 'cut');
    var allowRelax = (mode === 'auto' || mode === 'relax');
    while (passes++ < 40) {
      var xs = selfIntersections(r);
      if (!xs.length) break;
      var bestR = r, bestC = xs.length, didCut = false, k;
      if (allowCut) {
        for (k = 0; k < xs.length; k++) {
          var cand = cutSmallestLobe(r, [xs[k]], smoothWin);
          var c = selfIntersections(cand).length;
          if (c < bestC) { bestC = c; bestR = cand; didCut = true; }   // только если реально убавляет
        }
      }
      if (didCut) { r = bestR; fixed++; if (bestC === 0) break; continue; }
      // cut не убавил (или запрещён) — один relax, затем стоп (не ухудшаем)
      if (allowRelax) { r = relaxCrossings(r, xs, relaxIters, relaxAmt, win); fixed++; if (!selfIntersections(r).length) break; }
      break;
    }
    return { ring: r, fixed: fixed, crossings: selfIntersections(r).length };
  }

  function macroSmooth(ring, eps, tension, step, keepAngle) {
    if (!ring || ring.length < 3) return ring || [];
    eps = eps == null ? 8 : eps;
    tension = tension == null ? 0.6 : tension;
    step = step == null ? 2 : step;
    var r = resampleRing(ring, 3);
    r = rdpKeepCorners(r, eps, keepAngle);
    return catmullRomRing(r, tension, step);
  }

  // Лёгкое лапласово сглаживание замкнутого кольца: каждая точка сдвигается к
  // середине соседей. Скругляет острые углы (пики лопастей/бухт), не меняя топологию.
  function roundCorners(ring, iter, amt) {
    if (!ring || ring.length < 3) return ring || [];
    iter = iter == null ? 1 : iter; amt = amt == null ? 0.25 : amt;
    var r = ring;
    for (var it = 0; it < iter; it++) {
      var n = r.length, out = [];
      for (var i = 0; i < n; i++) {
        var p = r[i], a = r[(i - 1 + n) % n], b = r[(i + 1) % n];
        out.push([p[0] + ((a[0] + b[0]) / 2 - p[0]) * amt, p[1] + ((a[1] + b[1]) / 2 - p[1]) * amt]);
      }
      r = out;
    }
    return r;
  }

  function shortenInlet(ring, a, b, smooth, tension, step) {
    if (!ring || ring.length < 4) return ring || [];
    var n = ring.length;
    a = ((a % n) + n) % n;
    b = ((b % n) + n) % n;
    if (a === b) return ring.slice();
    // Удаляем ДУГУ a->b в прямом (с обмоткой) направлении — это и есть буxта.
    // Ошибка была в min/max: при a>b (обмотка) удалялась наоборот тело.
    var removed = {}, k = (a + 1) % n;
    while (k !== b) { removed[k] = true; k = (k + 1) % n; }
    var kept = [];
    for (var idx = 0; idx < n; idx++) if (!removed[idx]) kept.push(ring[idx]);
    if (smooth) {
      // Криволинейный срез: прямая хорда A-B заменяется дугой, которая
      // НАЧИНАЕТСЯ И КОНЧАЕТСЯ ТОЧНО в A и B (сохраняем углы/выравнивание),
      // с лёгким изгибом внутрь бывшей буxты.
      var A = ring[a], B = ring[b];
      var prev = ring[(a - 1 + n) % n], next = ring[(b + 1) % n];
      var M = 14, arc = [];
      for (var s = 0; s <= M; s++) {
        var t = s / M;
        var p = catmullSpline(prev, A, B, next, t);
        arc.push([p[0], p[1]]);
      }
      arc[0] = [A[0], A[1]]; arc[M] = [B[0], B[1]];
      // центр удалённой буxты — куда изгибаем срез
      var ccx = 0, ccy = 0, cc = 0;
      for (var ri = 0; ri < n; ri++) if (removed[ri]) { ccx += ring[ri][0]; ccy += ring[ri][1]; cc++; }
      if (cc > 0) {
        ccx /= cc; ccy /= cc;
        for (var s2 = 1; s2 < M; s2++) {
          arc[s2][0] += (ccx - arc[s2][0]) * 0.3;
          arc[s2][1] += (ccy - arc[s2][1]) * 0.3;
        }
      }
      // собрать результат: заменить ребро A->B (в обоих порядках обхода) на arc
      var out = [], done = false;
      for (var q = 0; q < kept.length; q++) {
        var cur = kept[q], nxt = kept[(q + 1) % kept.length];
        if (!done && cur === A && nxt === B) { for (var sa = 0; sa < arc.length; sa++) out.push(arc[sa]); done = true; }
        else if (!done && cur === B && nxt === A) { for (var sb = arc.length - 1; sb >= 0; sb--) out.push(arc[sb]); done = true; }
        else out.push(cur);
      }
      return done ? out : kept;
    }
    return kept;
  }

  function polyArea(ring) {
    var s = 0, i, j;
    for (i = 0; i < ring.length; i++) {
      j = (i + 1) % ring.length;
      s += ring[i][0] * ring[j][1] - ring[j][0] * ring[i][1];
    }
    return s / 2;
  }
  // Сжатие внутрь без Clipper: сдвиг по внешней нормали. На вогнутых может
  // слегка самопересечься — Clipper (jtRound) предпочтительнее, это запасной путь.
  function insetFallback(ring, r) {
    var n = ring.length;
    if (n < 4 || !(r > 0)) return ring.slice();
    var area = polyArea(ring), ccw = area > 0;
    var out = [], i, a, b, c, n1x, n1y, n2x, n2y, nx, ny, m;
    for (i = 0; i < n; i++) {
      a = ring[(i - 1 + n) % n]; b = ring[i]; c = ring[(i + 1) % n];
      n1x = b[1] - a[1]; n1y = -(b[0] - a[0]);
      n2x = c[1] - b[1]; n2y = -(c[0] - b[0]);
      if (!ccw) { n1x = -n1x; n1y = -n1y; n2x = -n2x; n2y = -n2y; }
      nx = n1x + n2x; ny = n1y + n2y;
      m = Math.hypot(nx, ny) || 1;
      out.push([b[0] - (nx / m) * r, b[1] - (ny / m) * r]);
    }
    if (Math.abs(polyArea(out)) >= Math.abs(area) * 0.98) {
      for (i = 0; i < n; i++) {
        out[i][0] = 2 * ring[i][0] - out[i][0];
        out[i][1] = 2 * ring[i][1] - out[i][1];
      }
    }
    return out;
  }
  function seamOffset(ring, r) {
    if (!(r > 0) || !ring || ring.length < 4) return ring ? ring.slice() : [];
    var method = "fallback";
    var out = null;
    if (typeof ClipperLib !== "undefined") {
      var scale = 100;
      var path = ring.map(function (p) { return { X: Math.round(p[0] * scale), Y: Math.round(p[1] * scale) }; });
      var radii = [r, r * 0.5, r * 0.25];
      var ri, rr, co, solution, best, si;
      for (ri = 0; ri < radii.length; ri++) {
        rr = radii[ri];
        if (rr <= 0.1) continue;
        co = new ClipperLib.ClipperOffset();
        co.ArcTolerance = 0.25 * scale;
        co.AddPath(path, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
        solution = [];
        co.Execute(solution, -Math.round(rr * scale));
        if (solution.length) {
          best = solution[0];
          for (si = 0; si < solution.length; si++) if (solution[si].length > best.length) best = solution[si];
          out = best.map(function (pt) { return [pt.X / scale, pt.Y / scale]; });
          method = "clipper";
          break;
        }
      }
    }
    if (!out || out.length < 4) { out = insetFallback(ring, r); method = "fallback"; }
    if (typeof window !== "undefined") {
      window.__shrink = {
        r: r, method: method,
        area0: Math.abs(polyArea(ring)),
        area1: Math.abs(polyArea(out))
      };
    }
    return out;
  }

  // Указатель места на районе: сетка 6×6 в bbox кольца.
  // A1 = северо-запад (minx, miny) — как на карточке сверху-слева.
  // F6 = юго-восток. Клик в UI копирует «#19 C3 (x, y)».
  var GRID_N = 6;
  function ringBBox(ring) {
    var minx = 1e9, miny = 1e9, maxx = -1e9, maxy = -1e9, i, p;
    for (i = 0; i < ring.length; i++) {
      p = ring[i];
      if (p[0] < minx) minx = p[0]; if (p[1] < miny) miny = p[1];
      if (p[0] > maxx) maxx = p[0]; if (p[1] > maxy) maxy = p[1];
    }
    return { minx: minx, miny: miny, maxx: maxx, maxy: maxy, w: Math.max(1e-6, maxx - minx), h: Math.max(1e-6, maxy - miny) };
  }
  function cellId(col, row) { return String.fromCharCode(65 + col) + (row + 1); }
  function parseCell(id) {
    var m = String(id || '').trim().toUpperCase().match(/^([A-Z])(\d+)$/);
    if (!m) return null;
    return { col: m[1].charCodeAt(0) - 65, row: parseInt(m[2], 10) - 1 };
  }
  function pointToCell(ring, x, y, n) {
    n = n || GRID_N;
    var b = ringBBox(ring);
    var col = Math.floor((x - b.minx) / b.w * n);
    var row = Math.floor((y - b.miny) / b.h * n);
    if (col < 0) col = 0; else if (col > n - 1) col = n - 1;
    if (row < 0) row = 0; else if (row > n - 1) row = n - 1;
    return { col: col, row: row, id: cellId(col, row), n: n };
  }
  function cellRect(ring, col, row, n) {
    n = n || GRID_N;
    var b = ringBBox(ring);
    return {
      x0: b.minx + col / n * b.w,
      y0: b.miny + row / n * b.h,
      x1: b.minx + (col + 1) / n * b.w,
      y1: b.miny + (row + 1) / n * b.h
    };
  }

  var Compressor = {
    version: "0.4.1",
    GRID_N: GRID_N,
    ringBBox: ringBBox,
    cellId: cellId,
    parseCell: parseCell,
    pointToCell: pointToCell,
    cellRect: cellRect,
    parsePts: parsePts,
    dist2seg: dist2seg,
    resampleRing: resampleRing,
    catmullSpline: catmullSpline,
    catmullRomRing: catmullRomRing,
    simplifyPts: simplifyPts,
    rdpSimplify: rdpSimplify,
    turnAt: turnAt,
    rdpKeepCorners: rdpKeepCorners,
    selfIntersections: selfIntersections,
    untangleRing: untangleRing,
    distToRing: distToRing,
    macroSmooth: macroSmooth,
    roundCorners: roundCorners,
    shortenInlet: shortenInlet,
    seamOffset: seamOffset
  };

  root.Compressor = Compressor;
  if (typeof module !== "undefined" && module.exports !== root) module.exports = Compressor;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
