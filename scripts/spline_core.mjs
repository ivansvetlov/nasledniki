// spline_core.mjs — чистое ядро сплайн/топо/сглаживания (БЕЗ DOM).
//
// Выделено из scripts/map_editor.js как есть (текущее поведение), чтобы под
// TDD писать тесты. Позже исправления подключаются в map_editor.js.
//
// Якоря в map_editor.js (для синхронизации при правке):
//   simplify        :2250   dist2seg       :2238   chainLen      :3027
//   densifyRing     :4240   catmullSpline  :4266   catmullRomRing :4282
//   topoSnapshot    :3602   topoRestore    :3618   compact       :5709

export function splineLens(c) {
  var out = [0];
  for (var i = 0; i + 1 < c.length; i++) {
    var dx = c[i + 1][0] - c[i][0];
    var dy = c[i + 1][1] - c[i][1];
    out.push(out[i] + Math.sqrt(dx * dx + dy * dy));
  }
  return out;
}

export function dist2seg(p, a, b) {
  var vx = b[0] - a[0], vy = b[1] - a[1];
  var wx = p[0] - a[0], wy = p[1] - a[1];
  var c1 = vx * wx + vy * wy, c2 = vx * vx + vy * vy;
  var t = c2 === 0 ? 0 : Math.max(0, Math.min(1, c1 / c2));
  var dx = p[0] - (a[0] + t * vx), dy = p[1] - (a[1] + t * vy);
  return Math.sqrt(dx * dx + dy * dy);
}

export function simplify(pts, eps) {
  if (pts.length < 3) return pts;
  function rec(s, e) {
    var maxd = 0, idx = 0;
    for (var i = s + 1; i < e; i++) {
      var d = dist2seg(pts[i], pts[s], pts[e]);
      if (d > maxd) { maxd = d; idx = i; }
    }
    if (maxd > eps) {
      var L = rec(s, idx), R = rec(idx, e);
      return L.slice(0, -1).concat(R);
    }
    return [pts[s], pts[e]];
  }
  return rec(0, pts.length - 1);
}

export function chainLen(pts) {
  var s = 0;
  for (var i = 0; i + 1 < pts.length; i++)
    s += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
  return s;
}

export function catmullSpline(p0, p1, p2, p3, t) {
  var t2 = t * t, t3 = t2 * t;
  return [
    0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
    0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
  ];
}

export function densifyRing(ring, step) {
  if (!ring || ring.length < 2) return ring || [];
  var pts = ring.slice();
  if (pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1])
    pts.pop();
  var out = [];
  for (var i = 0; i < pts.length; i++) {
    var a = pts[i], b = pts[(i + 1) % pts.length];
    out.push(a);
    var dx = b[0] - a[0], dy = b[1] - a[1];
    var dist = Math.sqrt(dx * dx + dy * dy);
    if (dist <= step) continue;
    var k = (dist / step) | 0;
    for (var j = 1; j < k; j++) {
      var t = j / k;
      out.push([a[0] + t * dx, a[1] + t * dy]);
    }
  }
  return out;
}

export function catmullRomRing(ring, tension, step) {
  if (!ring || ring.length < 3) return ring || [];
  tension = tension == null ? 0.6 : tension;
  step = step == null ? 2 : step;
  if (tension <= 0) return ring.slice();
  var pts = densifyRing(ring, step);
  pts = simplify(pts, step * 0.75);
  var n = pts.length;
  if (n < 4) return pts;
  var out = [];
  for (var i = 0; i < n; i++) {
    var p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    var len = 0, prev = p1;
    for (var k = 1; k <= 4; k++) {
      var q = catmullSpline(p0, p1, p2, p3, k / 4);
      len += Math.sqrt((q[0] - prev[0]) * (q[0] - prev[0]) + (q[1] - prev[1]) * (q[1] - prev[1]));
      prev = q;
    }
    var count = Math.max(1, Math.round(len / step));
    for (var j = 0; j < count; j++) {
      var t = j / count;
      var sp = catmullSpline(p0, p1, p2, p3, t);
      var chx = p1[0] + (p2[0] - p1[0]) * t;
      var chy = p1[1] + (p2[1] - p1[1]) * t;
      out.push([chx + (sp[0] - chx) * tension, chy + (sp[1] - chy) * tension]);
    }
  }
  return out;
}

export function polygonArea(ring) {
  var a = 0;
  for (var i = 0, n = ring.length; i < n; i++) {
    var p = ring[i], q = ring[(i + 1) % n];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a) / 2;
}

// ---- TOPO (исправленное ядро, см. spline_core.test.mjs) ----
export function topoSnapshot(edges, districtDs) {
  var edgeSnap = [];
  for (var i = 0; i < edges.length; i++) {
    var e = edges[i];
    edgeSnap.push({
      id: e.id,
      base: e.base.map(function (p) { return [p[0], p[1]]; }),
      pins: e.pins.map(function (p) {
        return { id: p.id, isLocked: p.isLocked, t: p.t, x: p.x, y: p.y };
      }),
    });
  }
  var snap = { edges: edgeSnap };
  if (districtDs) {
    var d = {};
    for (var k in districtDs) d[k] = districtDs[k];
    snap.districts = d;
  }
  return snap;
}

export function topoRestore(edges, snap) {
  if (!snap) return;
  var src = snap.edges || snap;
  for (var i = 0; i < src.length; i++) {
    var s = src[i];
    for (var j = 0; j < edges.length; j++) {
      if (edges[j].id === s.id) {
        var e = edges[j];
        e.base = s.base.map(function (p) { return [p[0], p[1]]; });
        e.lens = splineLens(e.base);
        e.pins = s.pins.map(function (p) {
          return { id: p.id, isLocked: p.isLocked, t: p.t, x: p.x, y: p.y };
        });
        e.bankA = null;
        e.bankB = null;
        break;
      }
    }
  }
  return snap.districts;
}

export function compactJournal(list) {
  var out = [];
  for (var i = 0; i < list.length; i++) {
    var it = list[i];
    if (it.type === "apply") {
      out.push({ type: "apply", id: it.id, label: it.label, snap: it.snap });
    } else if (it.type === "topo") {
      out.push({ type: "topo", id: it.id, label: it.label, topo: it.topo });
    }
  }
  return out;
}

// ---- УНИВЕРСАЛЬНОЕ СГЛАЖИВАНИЕ (кандидат на пайплайн) ----
// НЧ-фильтр границы: ресемпл по длине дуги + скользящее среднее.
// Убирает тонкие выступы (высокая частота) равномерно, без ручного маркера.
// Позже применяется к EDGE.base (TOPO), а не к d района — чтобы соседи совпадали.

export function resampleRing(ring, spacing) {
  if (!ring || ring.length < 2) return ring ? ring.slice() : [];
  var pts = ring.slice();
  if (pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1])
    pts.pop();
  var n = pts.length;
  if (n < 2) return pts;
  var cum = [0], total = 0, i;
  for (i = 0; i < n; i++) {
    var a = pts[i], b = pts[(i + 1) % n];
    total += Math.hypot(b[0] - a[0], b[1] - a[1]);
    cum.push(total);
  }
  if (total === 0) return pts;
  var out = [];
  for (var d = 0; d < total; d += spacing) {
    var lo = 0, hi = n;
    while (lo < hi) {
      var mid = (lo + hi) >> 1;
      if (cum[mid] <= d) lo = mid + 1; else hi = mid;
    }
    var k = Math.max(1, lo) - 1;
    var p0 = pts[k], p1 = pts[(k + 1) % n];
    var segL = (cum[k + 1] - cum[k]) || 1;
    var t = (d - cum[k]) / segL;
    out.push([p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t]);
  }
  return out;
}

export function universalSmooth(ring, opts) {
  opts = opts || {};
  var spacing = opts.spacing == null ? 3 : opts.spacing;
  var window = opts.window == null ? 9 : opts.window;
  var r = resampleRing(ring, spacing);
  var n = r.length;
  if (n < 3) return r;
  var half = Math.floor(window / 2);
  var w = Math.min(window, n);
  var out = [];
  for (var i = 0; i < n; i++) {
    var sx = 0, sy = 0, cnt = 0;
    for (var kk = -half; kk <= half; kk++) {
      var p = r[(i + kk + n) % n];
      sx += p[0]; sy += p[1]; cnt++;
    }
    out.push([sx / cnt, sy / cnt]);
  }
  return out;
}

// ---- ДЕТЕКЦИЯ ТОНКИХ МЕСТ (промежуточный слой) ----
// Локальная "ширина" границы в точке = расстояние до ближайшей ДРУГОЙ точки
// того же кольца, соединение с которой лежит ВНУТРИ полигона. Там, где ширина
// мала — тонкая "сосиска"/перешеек/выступ. Это и есть зоны, которые трогает
// сглаживание/упрощение. Чистая геометрия, без привязки к маркеру.

export function localWidth(ring, skip) {
  skip = skip || 8;
  var n = ring.length;
  var w = new Array(n);
  var cx = 0, cy = 0, i;
  for (i = 0; i < n; i++) { cx += ring[i][0]; cy += ring[i][1]; }
  cx /= n; cy /= n;
  for (i = 0; i < n; i++) {
    var best = Infinity;
    for (var j = 0; j < n; j++) {
      var d = Math.abs(i - j);
      if (d > n - d) d = n - d;
      if (d < skip) continue;
      var q = ring[j];
      var mx = (ring[i][0] + q[0]) / 2, my = (ring[i][1] + q[1]) / 2;
      // середина внутри? (иначе это внешняя хорда, не учитываем)
      if (!pinRing(mx, my, ring, cx, cy)) { /* тоже считаем — тонкость видна и снаружи */ }
      var dd = Math.hypot(ring[i][0] - q[0], ring[i][1] - q[1]);
      if (dd < best) best = dd;
    }
    w[i] = best;
  }
  return w;
}

export function detectThin(ring, r0, opts) {
  // Тонкость точки = насколько она выступает за полигон, сжатый (эродированный)
  // на r0. Тонкие выступы/сосиски торчат далеко -> помечаем. Устойчиво к индексам.
  r0 = r0 == null ? 3 : r0;
  var spacing = (opts && opts.spacing) || 3;
  var dense = ring.length < 120 ? resampleRing(ring, spacing) : ring;
  var shrunk = shrinkRing(dense, r0, {});
  if (!shrunk.length) return dense.map(function () { return false; });
  var out = [];
  for (var i = 0; i < dense.length; i++) {
    out.push(plMinRing(dense[i], shrunk) > r0 * 1.5);
  }
  return out;
}

export function plMinRing(p, ring) {
  var best = Infinity;
  for (var i = 0; i + 1 < ring.length; i++) {
    var d = dist2seg(p, ring[i], ring[i + 1]);
    if (d < best) best = d;
  }
  return best;
}

function pinRing(px, py, ring, cx, cy) {
  var inside = false, n = ring.length;
  for (var i = 0; i < n; i++) {
    var ax = ring[i][0], ay = ring[i][1];
    var bx = ring[(i + 1) % n][0], by = ring[(i + 1) % n][1];
    if ((ay > py) !== (by > py) && px < ((bx - ax) * (py - ay)) / (by - ay) + ax)
      inside = !inside;
  }
  return inside;
}

// ---- INWARD OFFSET (уменьшение "радиуса" кривой) ----
// Универсальная операция: копия границы, сдвинутая ВНУТРЬ на r (истинная эрозия,
// ClipperOffset). Тонкие выступы уже 2r стираются полностью; наложений с
// соседями не возникает. Позже фаза "наращивание" — симметричный outward-offset
// на тот же r (восстанавливает диаметр, убирая щели).

import { createRequire } from "module";
const require = createRequire(import.meta.url);
const ClipperLib = require("js-clipper");

export function shrinkRing(ring, r, opts) {
  opts = opts || {};
  const scale = 100;
  const path = ring.map((p) => ({ X: Math.round(p[0] * scale), Y: Math.round(p[1] * scale) }));
  const co = new ClipperLib.ClipperOffset();
  co.ArcTolerance = 0.25 * scale;
  co.AddPath(path, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
  const solution = [];
  co.Execute(solution, -Math.round(r * scale));
  if (!solution.length) return [];
  let best = solution[0];
  for (const p of solution) if (p.length > best.length) best = p;
  let out = best.map((pt) => [pt.X / scale, pt.Y / scale]);
  if (opts.finalSmooth) {
    const ten = opts.finalSmooth === true ? 0.6 : opts.finalSmooth;
    out = catmullRomRing(out, ten, 2);
  }
  return out;
}
