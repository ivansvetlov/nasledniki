/* debug_overlay.js — рантайм-слой отладки для map_editor.js.
   НЕ модифицирует map.svg и не попадает в сохранение (отдельный <svg> в #viewport).
   Обрабатывает ТОЛЬКО слой 1 (районы) для детекции тонких мест.
   Маркеры карты (data-kind="marker") выделяются отдельным слоем отладки.
   Управление — через строки в списке слоёв (#layers), без галочек в панели.
   Использует ClipperLib для корректной эрозии при детекции. */
(function () {
  "use strict";
  function parsePts(d) {
    var out = [], m, re = /([+-]?\d+\.?\d*),([+-]?\d+\.?\d*)/g;
    while ((m = re.exec(d))) out.push([parseFloat(m[1]), parseFloat(m[2])]);
    return out;
  }
  function dist2seg(p, a, b) {
    var vx = b[0] - a[0], vy = b[1] - a[1], wx = p[0] - a[0], wy = p[1] - a[1];
    var c1 = vx * wx + vy * wy, c2 = vx * vx + vy * vy, t = c2 === 0 ? 0 : Math.max(0, Math.min(1, c1 / c2));
    var dx = p[0] - (a[0] + t * vx), dy = p[1] - (a[1] + t * vy); return Math.hypot(dx, dy);
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
      for (var kk = 1; kk <= 4; kk++) { var q = catmullSpline(p0, p1, p2, p3, kk / 4); len += Math.hypot(q[0] - prev[0], q[1] - prev[1]); prev = q; }
      var count = Math.max(1, Math.round(len / step));
      for (var j = 0; j < count; j++) {
        var t = j / count, sp = catmullSpline(p0, p1, p2, p3, t);
        var chx = p1[0] + (p2[0] - p1[0]) * t, chy = p1[1] + (p2[1] - p1[1]) * t;
        out.push([chx + (sp[0] - chx) * tension, chy + (sp[1] - chy) * tension]);
      }
    }
    return out;
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
  function plMinRing(p, ring) {
    var best = Infinity;
    for (var i = 0; i + 1 < ring.length; i++) { var d = dist2seg(p, ring[i], ring[i + 1]); if (d < best) best = d; }
    return best;
  }
  // детекция тонких мест: помечаем ВЕРШИНЫ-КОНЧИКИ выступов (локальные максимумы
  // "глубины" выступа за эродированный на r0 контур). Это понятные «сосиски/шейки»,
  // а не вся граница целиком. Если эрозия стирает полигон целиком (осколки),
  // используем локальную ширину (расстояние до противоположной стороны контура).
  function localThin(dense, r0) {
    var n = dense.length, thr = r0 * 1.8, far = Math.max(3, Math.floor(n / 3)), w = new Array(n);
    for (var i = 0; i < n; i++) {
      var best = Infinity;
      for (var j = 0; j < n; j++) {
        var dj = Math.abs(i - j);
        if (dj < far || dj > n - far) continue;
        var d = Math.hypot(dense[i][0] - dense[j][0], dense[i][1] - dense[j][1]);
        if (d < best) best = d;
      }
      w[i] = best;
    }
    var out = [];
    for (var i = 0; i < n; i++) {
      var prev = w[(i - 1 + n) % n], next = w[(i + 1) % n];
      out.push(w[i] < thr && w[i] <= prev && w[i] <= next);
    }
    return out;
  }
  function detectThin(ring, r0) {
    r0 = r0 == null ? 3 : r0;
    var dense = ring.length < 120 ? resampleRing(ring, 3) : ring;
    if (typeof ClipperLib === "undefined") return dense.map(function () { return false; });
    var shrunk = shrinkRing(dense, r0, {});
    if (shrunk.length) {
      var depth = dense.map(function (p) { return Math.max(0, plMinRing(p, shrunk) - r0); });
      var out = [], thresh = r0 * 0.8;
      for (var i = 0; i < dense.length; i++) {
        var prev = depth[(i - 1 + dense.length) % dense.length], next = depth[(i + 1) % dense.length];
        out.push(depth[i] > thresh && depth[i] >= prev && depth[i] >= next);
      }
      return out;
    }
    return localThin(dense, r0);
  }
  // INWARD OFFSET (эрозия) через ClipperOffset. Тонкие выступы уже 2r стираются.
  // Прогрессивно уменьшаем радиус, если эрозия целиком стирает полигон (осколки/шейки
  // тоньше 2r, напр. "Обломок *"): показываем хоть какой-то отступ, а не «чёрное пятно».
  function shrinkRing(ring, r, opts) {
    opts = opts || {};
    var scale = 100;
    var path = ring.map(function (p) { return { X: Math.round(p[0] * scale), Y: Math.round(p[1] * scale) }; });
    var radii = [r, r * 0.5, r * 0.25, 1, 0.5];
    for (var ri = 0; ri < radii.length; ri++) {
      var rr = radii[ri];
      if (rr <= 0.1) continue;
      var co = new ClipperLib.ClipperOffset();
      co.ArcTolerance = 0.25 * scale;
      co.AddPath(path, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
      var solution = [];
      co.Execute(solution, -Math.round(rr * scale));
      if (solution.length) {
        var best = solution[0];
        for (var si = 0; si < solution.length; si++) if (solution[si].length > best.length) best = solution[si];
        return best.map(function (pt) { return [pt.X / scale, pt.Y / scale]; });
      }
    }
    return [];
  }
  function fmt(pts) { if (!pts || pts.length < 2) return ""; return "M" + pts.map(function (p) { return p[0].toFixed(1) + "," + p[1].toFixed(1); }).join(" L") + " Z"; }
  function fmtC(pts) {
    if (!pts || pts.length < 3) return fmt(pts);
    var n = pts.length, d = "M" + pts[0][0].toFixed(1) + "," + pts[0][1].toFixed(1);
    for (var i = 0; i < n; i++) {
      var p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
      var c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
      var c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
      d += " C" + c1x.toFixed(1) + "," + c1y.toFixed(1) + " " + c2x.toFixed(1) + "," + c2y.toFixed(1) + " " + p2[0].toFixed(1) + "," + p2[1].toFixed(1);
    }
    return d + " Z";
  }
  function NS() { return "http://www.w3.org/2000/svg"; }
  function el(name, attrs) { var e = document.createElementNS(NS(), name); for (var k in attrs) e.setAttribute(k, attrs[k]); return e; }

  var state = { detect: true, marker: true, shrink: true, r0: 6, r: 4, ten: 0.8 };
  function anyOn() { return state.detect || state.marker || state.shrink; }
  function getMapSvg() { return document.querySelector("#stage svg:not(#ruler):not(#doodle):not(#pins)"); }
  function getStage() { return document.getElementById("stage"); }
  function getViewport() { return document.getElementById("viewport"); }

  function buildPanel() {
    var p = document.createElement("div");
    p.id = "dbg-panel";
    p.style.cssText = "position:fixed;right:12px;top:12px;z-index:30;background:#1e1e22;color:#ddd;padding:12px 14px;border-radius:10px;font:12px system-ui,sans-serif;box-shadow:0 8px 28px #0006;width:240px;";
    p.innerHTML =
      '<div style="font-weight:600;margin-bottom:4px">Дебаг</div>' +
      '<div style="color:#aaa;margin-bottom:6px">слой районов (вода не трогается). Включается глазами в списке слоёв.</div>' +
      '<label style="display:block;margin:6px 0 2px">чувствительность тонких мест r0 <span id="vR0"></span></label>' +
      '<input id="sR0" type="range" min="2" max="20" step="1" style="width:100%">' +
      '<label style="display:block;margin:6px 0 2px">сжатие r <span id="vR"></span></label>' +
      '<input id="sR" type="range" min="0" max="15" step="0.5" style="width:100%">' +
      '<label style="display:block;margin:6px 0 2px">плавность <span id="vT"></span></label>' +
      '<input id="sT" type="range" min="0" max="1" step="0.05" style="width:100%">' +
      '<div id="dbg-err" style="color:#f88;margin-top:6px;font-size:11px;display:none"></div>';
    document.body.appendChild(p);
    p.style.display = anyOn() ? "block" : "none";
    function bind(id, key, labId) {
      var inp = document.getElementById(id), lab = document.getElementById(labId);
      inp.value = state[key];
      if (lab) lab.textContent = state[key];
      inp.addEventListener("input", function () { state[key] = parseFloat(inp.value); if (lab) lab.textContent = state[key]; render(); });
    }
    bind("sR0", "r0", "vR0");
    bind("sR", "r", "vR");
    bind("sT", "ten", "vT");
  }

  // --- интеграция в список слоёв редактора (#layers): каждая фича — отдельный слой ---
  function ensureLayerRows() {
    var layers = document.getElementById("layers");
    if (!layers) return;
    if (!document.getElementById("dbg-det-row")) addLayerRow("dbg-det-row", "Дебаг · тонкие места", "detect", state.detect);
    if (!document.getElementById("dbg-shk-row")) addLayerRow("dbg-shk-row", "Дебаг · сжатие", "shrink", state.shrink);
    if (!document.getElementById("dbg-mk-row")) addLayerRow("dbg-mk-row", "Дебаг · маркер", "marker", state.marker);
  }
  function addLayerRow(id, label, key, on) {
    var layers = document.getElementById("layers");
    var row = document.createElement("div");
    row.id = id;
    row.className = "layer head" + (on ? "" : " off");
    row.setAttribute("data-layer-id", "debug-" + key);
    row.innerHTML =
      '<button type="button" class="tw" title="свернуть">▶</button>' +
      '<button type="button" class="eye" title="видимость">' + (on ? "◉" : "○") + '</button>' +
      '<button type="button" class="lk" title="блокировка">🔓</button>' +
      '<span class="ln" title="дебаг: ' + label + '">' + label + '</span>';
    var heads = layers.querySelectorAll(":scope > .layer.head");
    var last = heads[heads.length - 1];
    if (last) last.after(row); else layers.appendChild(row);
    row.addEventListener("click", function (e) {
      e.stopPropagation();
      if (e.target.classList.contains("lk") || e.target.classList.contains("tw")) return;
      toggleFeature(key);
    });
  }
  function toggleFeature(key) {
    state[key] = !state[key];
    var id = key === "detect" ? "dbg-det-row" : key === "shrink" ? "dbg-shk-row" : "dbg-mk-row";
    var row = document.getElementById(id);
    if (row) {
      row.classList.toggle("off", !state[key]);
      var eye = row.querySelector(".eye");
      if (eye) eye.textContent = state[key] ? "◉" : "○";
    }
    var panel = document.getElementById("dbg-panel");
    if (panel) panel.style.display = anyOn() ? "block" : "none";
    if (anyOn()) { startSync(); render(); }
    else clearOverlay();
  }
  var __layerObs = null;
  function setupLayerObserver() {
    var layers = document.getElementById("layers");
    if (!layers || __layerObs) return;
    __layerObs = new MutationObserver(function () { ensureLayerRows(); });
    __layerObs.observe(layers, { childList: true });
  }

  function clearOverlay() {
    if (overlay && overlay.parentNode) while (overlay.firstChild) overlay.removeChild(overlay.firstChild);
  }

  var overlay = null, rendered = false;
  function syncOverlayPos() {
    if (!overlay) return;
    var svg = getMapSvg(); if (!svg) return;
    var vp = getViewport();
    var r = svg.getBoundingClientRect();
    if (vp) {
      var vr = vp.getBoundingClientRect();
      overlay.style.left = (r.left - vr.left) + "px";
      overlay.style.top = (r.top - vr.top) + "px";
    } else {
      overlay.style.left = r.left + "px";
      overlay.style.top = r.top + "px";
    }
    overlay.style.width = r.width + "px";
    overlay.style.height = r.height + "px";
    var vb = svg.getAttribute("viewBox"); if (vb) overlay.setAttribute("viewBox", vb);
    var par = svg.getAttribute("preserveAspectRatio"); if (par) overlay.setAttribute("preserveAspectRatio", par);
  }
  var __raf = null;
  function startSync() {
    if (__raf) return;
    var tick = function () {
      if (!anyOn() || !overlay || !overlay.parentNode) { __raf = null; return; }
      syncOverlayPos();
      __raf = requestAnimationFrame(tick);
    };
    __raf = requestAnimationFrame(tick);
  }

  function ensureOverlay() {
    var svg = getMapSvg();
    if (!svg) return null;
    // помещаем внутрь #viewport (overflow:hidden) — оверлей клиппится областью карты
    // и не перекрывает сайдбар/тулбар при большом зуме.
    var parent = getViewport() || document.body;
    if (!overlay || overlay.parentNode !== parent) {
      if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
      overlay = el("svg", { id: "dbg-overlay" });
      overlay.style.cssText = "position:absolute;overflow:visible;pointer-events:none;z-index:7;";
      parent.appendChild(overlay);
    }
    syncOverlayPos();
    return overlay;
  }

  function render() {
    var errEl = document.getElementById("dbg-err");
    if (typeof ClipperLib === "undefined") { if (errEl) { errEl.style.display = "block"; errEl.textContent = "ClipperLib не загружен"; } return; }
    if (errEl) errEl.style.display = "none";
    if (!anyOn()) { clearOverlay(); return; }
    var svg = getMapSvg(); if (!svg) return;
    var ov = ensureOverlay(); if (!ov) return;
    while (ov.firstChild) ov.removeChild(ov.firstChild);
    if (state.detect) {
      // ТОЛЬКО слой 1 (районы). Вода (слой 3) не трогается.
      var paths = svg.querySelectorAll('[data-layer-id="1"] path[data-name]:not([data-kind])');
      for (var pi = 0; pi < paths.length; pi++) {
        var d = paths[pi].getAttribute("d"); if (!d) continue;
        var ring = resampleRing(parsePts(d), 3);
        var thin = detectThin(ring, state.r0);
        for (var i = 0; i < ring.length; i++) if (thin[i]) {
          var a = ring[i], b = ring[(i + 1) % ring.length];
          ov.appendChild(el("line", { x1: a[0].toFixed(1), y1: a[1].toFixed(1), x2: b[0].toFixed(1), y2: b[1].toFixed(1), stroke: "#f33", "stroke-width": "2.6" }));
        }
      }
    }
    if (state.shrink) {
      // оранжевый предпросмотр сжатия внутрь на r (слой 1, вода не трогается)
      var spaths = svg.querySelectorAll('[data-layer-id="1"] path[data-name]:not([data-kind])');
      for (var pj = 0; pj < spaths.length; pj++) {
        var sd = spaths[pj].getAttribute("d"); if (!sd) continue;
        var sring = resampleRing(parsePts(sd), 3);
        var shrunk = shrinkRing(sring, state.r, {});
        var draw = shrunk.length ? shrunk : sring;
        var sm = catmullRomRing(draw, state.ten, 2);
        if (sm.length) ov.appendChild(el("path", { d: fmtC(sm), fill: "rgba(255,153,0,0.18)", stroke: "#f90", "stroke-width": "1.6", "stroke-linejoin": "round", "stroke-linecap": "round" }));
      }
    }
    if (state.marker) {
      // все маркеры карты (data-kind="marker"), напр. «Маркер 1»
      var marks = svg.querySelectorAll('path[data-kind="marker"]');
      for (var mi = 0; mi < marks.length; mi++) {
        var md = marks[mi].getAttribute("d"); if (!md) continue;
        ov.appendChild(el("path", { d: fmt(parsePts(md)), fill: "none", stroke: "#f0f", "stroke-width": "1.8" }));
      }
    }
    syncOverlayPos();
    rendered = true;
  }

  function init() {
    if (!document.getElementById("dbg-panel")) buildPanel();
    ensureLayerRows();
    setupLayerObserver();
    if (getMapSvg() && anyOn()) render();
  }
  function boot() { if (typeof ClipperLib === "undefined") { loadClipper(); return; } init(); }
  function loadClipper() {
    if (window.__dbgClip) return; window.__dbgClip = true;
    // clipper.js в браузере падает на `module.exports` в конце — дадим ему заглушку.
    window.module = window.module || { exports: {} };
    var s = document.createElement("script");
    s.src = "/node_modules/js-clipper/clipper.js";
    s.onload = function () { delete window.module; init(); };
    s.onerror = function () { var e = document.getElementById("dbg-err"); if (e) { e.style.display = "block"; e.textContent = "не удалось загрузить ClipperLib"; } };
    document.head.appendChild(s);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { setTimeout(boot, 300); });
  else setTimeout(boot, 300);
  var tries = 0;
  var iv = setInterval(function () {
    ensureLayerRows();
    if (rendered || tries++ > 40) { clearInterval(iv); return; }
    if (getMapSvg()) { if (typeof ClipperLib === "undefined") loadClipper(); else render(); }
  }, 500);
  window.addEventListener("resize", function () { if (anyOn()) syncOverlayPos(); });
})();
