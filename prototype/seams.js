/* seams.js — зазор между стилизованными районами.
   Стилизованные кольца (выход компрессора) — вход. Плагины стыка двигают live.
   Цель пары: |dist − target| ≤ lock (по умолчанию 5px). Тройник — карман. */
(function (root) {
  'use strict';

  var TARGET = 5;

  function hypot(dx, dy) { return Math.sqrt(dx * dx + dy * dy); }
  function cloneRing(r) { return r.map(function (p) { return [p[0], p[1]]; }); }
  function ringCcw(ring) {
    var a = 0, i, j;
    for (i = 0; i < ring.length; i++) {
      j = (i + 1) % ring.length;
      a += ring[i][0] * ring[j][1] - ring[j][0] * ring[i][1];
    }
    return a > 0;
  }
  function pointInPoly(p, ring) {
    var n = ring.length, inside = false, i, j, xi, yi, xj, yj;
    for (i = 0, j = n - 1; i < n; j = i++) {
      xi = ring[i][0]; yi = ring[i][1]; xj = ring[j][0]; yj = ring[j][1];
      if ((yi > p[1]) !== (yj > p[1]) &&
          p[0] < (xj - xi) * (p[1] - yi) / ((yj - yi) || 1e-12) + xi) inside = !inside;
    }
    return inside;
  }
  function dist2seg(p, a, b) {
    var vx = b[0] - a[0], vy = b[1] - a[1];
    var wx = p[0] - a[0], wy = p[1] - a[1];
    var c2 = vx * vx + vy * vy;
    var t = c2 === 0 ? 0 : Math.max(0, Math.min(1, (vx * wx + vy * wy) / c2));
    var qx = a[0] + t * vx, qy = a[1] + t * vy;
    return { d: hypot(p[0] - qx, p[1] - qy), t: t, q: [qx, qy], i: 0 };
  }
  function closestOnRing(p, ring) {
    var n = ring.length, best = { d: 1e15, t: 0, q: ring[0], i: 0 }, i, h;
    for (i = 0; i < n; i++) {
      h = dist2seg(p, ring[i], ring[(i + 1) % n]);
      if (h.d < best.d) { best = h; best.i = i; }
    }
    return best;
  }
  function minRingDist(a, b) {
    var m = 1e15, i, h;
    for (i = 0; i < a.length; i++) {
      h = closestOnRing(a[i], b);
      if (h.d < m) m = h.d;
    }
    return m;
  }
  function signedGap(p, other) {
    var h = closestOnRing(p, other);
    return pointInPoly(p, other) ? -h.d : h.d;
  }
  function outwardNormal(ring, i, ccw) {
    var n = ring.length;
    var a = ring[(i - 1 + n) % n], b = ring[i], c = ring[(i + 1) % n];
    var n1 = [b[1] - a[1], -(b[0] - a[0])];
    var n2 = [c[1] - b[1], -(c[0] - b[0])];
    if (!ccw) { n1 = [-n1[0], -n1[1]]; n2 = [-n2[0], -n2[1]]; }
    var nx = n1[0] + n2[0], ny = n1[1] + n2[1];
    var m = hypot(nx, ny) || 1;
    return [nx / m, ny / m];
  }
  function turnMag(ring, i) {
    var n = ring.length;
    var a = ring[(i - 1 + n) % n], b = ring[i], c = ring[(i + 1) % n];
    var v1 = [a[0] - b[0], a[1] - b[1]], v2 = [c[0] - b[0], c[1] - b[1]];
    var m1 = hypot(v1[0], v1[1]) || 1e-9, m2 = hypot(v2[0], v2[1]) || 1e-9;
    var cs = Math.max(-1, Math.min(1, (v1[0] * v2[0] + v1[1] * v2[1]) / (m1 * m2)));
    return 180 - Math.acos(cs) * 180 / Math.PI;
  }
  function facingMask(a, b, tol) {
    var m = [];
    for (var i = 0; i < a.length; i++) m[i] = closestOnRing(a[i], b).d <= tol;
    return m;
  }
  function runsOf(mask) {
    var n = mask.length, i, runs = [], start = -1;
    if (!n) return runs;
    var all = true;
    for (i = 0; i < n; i++) if (!mask[i]) { all = false; break; }
    if (all) return [{ lo: 0, hi: n - 1, wrap: true, idx: idxRange(0, n - 1, n) }];
    for (i = 0; i < n; i++) {
      if (mask[i] && start < 0) start = i;
      if ((!mask[i] || i === n - 1) && start >= 0) {
        var hi = mask[i] && i === n - 1 ? i : i - 1;
        runs.push({ lo: start, hi: hi, wrap: false, idx: idxRange(start, hi, n) });
        start = -1;
      }
    }
    if (runs.length >= 2 && mask[0] && mask[n - 1]) {
      var last = runs.pop();
      var first = runs.shift();
      runs.push({ lo: last.lo, hi: first.hi, wrap: true, idx: last.idx.concat(first.idx) });
    }
    return runs.filter(function (r) { return r.idx.length >= 2; });
  }
  function idxRange(lo, hi, n) {
    var o = [], i = lo;
    o.push(i);
    while (i !== hi) { i = (i + 1) % n; o.push(i); }
    return o;
  }
  function midlineOf(a, b, idxA) {
    var mid = [];
    for (var k = 0; k < idxA.length; k++) {
      var p = a[idxA[k]];
      var h = closestOnRing(p, b);
      mid.push([(p[0] + h.q[0]) / 2, (p[1] + h.q[1]) / 2]);
    }
    return mid;
  }
  function areaOf(ring) {
    var s = 0, i, j;
    for (i = 0; i < ring.length; i++) {
      j = (i + 1) % ring.length;
      s += ring[i][0] * ring[j][1] - ring[j][0] * ring[i][1];
    }
    return s / 2;
  }
  function centroid(ring) {
    var x = 0, y = 0, i;
    for (i = 0; i < ring.length; i++) { x += ring[i][0]; y += ring[i][1]; }
    return [x / ring.length, y / ring.length];
  }

  function worldFromDistricts(list) {
    var world = { districts: [], pairs: [], triples: [], target: TARGET, metrics: {} };
    list.forEach(function (d, i) {
      world.districts.push({
        id: i,
        name: d.name,
        src: d.src,
        styled: cloneRing(d.styled || d.src),
        live: cloneRing(d.styled || d.src),
        w: null,
        locked: null,
        facing: null
      });
    });
    return world;
  }

  function rebuildPairs(world, tol) {
    tol = tol == null ? 22 : tol;
    world.pairs = [];
    var D = world.districts, i, j, da, db, md, fa, fb, runsA;
    for (i = 0; i < D.length; i++) {
      for (j = i + 1; j < D.length; j++) {
        da = D[i].live; db = D[j].live;
        md = minRingDist(da, db);
        if (md > tol) continue;
        fa = facingMask(da, db, Math.max(tol, md + 8));
        fb = facingMask(db, da, Math.max(tol, md + 8));
        runsA = runsOf(fa).filter(function (r) { return r.idx.length >= 3; });
        if (!runsA.length) continue;
        world.pairs.push({
          a: i, b: j, min: md,
          faceA: fa, faceB: fb,
          runsA: runsA, runsB: runsOf(fb),
          mid: midlineOf(da, db, runsA[0].idx)
        });
      }
    }
    rebuildTriples(world);
    return world.pairs;
  }

  function rebuildTriples(world) {
    world.triples = [];
    var adj = {}, k, p, ids, a, b, c, da, db, dc, pa, pb, pc, na, nb, nc, mx, my, i;
    for (k = 0; k < world.pairs.length; k++) {
      p = world.pairs[k];
      (adj[p.a] || (adj[p.a] = {}))[p.b] = 1;
      (adj[p.b] || (adj[p.b] = {}))[p.a] = 1;
    }
    ids = world.districts.map(function (d) { return d.id; });
    for (a = 0; a < ids.length; a++) {
      for (b = a + 1; b < ids.length; b++) {
        if (!(adj[a] && adj[a][b])) continue;
        for (c = b + 1; c < ids.length; c++) {
          if (!(adj[a][c] && adj[b][c])) continue;
          da = world.districts[a].live;
          db = world.districts[b].live;
          dc = world.districts[c].live;
          pa = closestOnRing(centroid(da), db);
          /* node ≈ точка, близкая ко всем трём */
          mx = 0; my = 0; na = 0;
          for (i = 0; i < da.length; i++) {
            if (closestOnRing(da[i], db).d < 18 && closestOnRing(da[i], dc).d < 18) {
              mx += da[i][0]; my += da[i][1]; na++;
            }
          }
          for (i = 0; i < db.length; i++) {
            if (closestOnRing(db[i], da).d < 18 && closestOnRing(db[i], dc).d < 18) {
              mx += db[i][0]; my += db[i][1]; na++;
            }
          }
          for (i = 0; i < dc.length; i++) {
            if (closestOnRing(dc[i], da).d < 18 && closestOnRing(dc[i], db).d < 18) {
              mx += dc[i][0]; my += dc[i][1]; na++;
            }
          }
          if (na < 3) continue;
          world.triples.push({ a: a, b: b, c: c, node: [mx / na, my / na], n: na });
        }
      }
    }
  }

  function ensureWeights(world) {
    world.districts.forEach(function (d) {
      if (!d.w || d.w.length !== d.live.length) {
        d.w = d.live.map(function () { return 1; });
        d.locked = d.live.map(function () { return false; });
      }
    });
  }

  function markFacing(world, tol) {
    rebuildPairs(world, tol);
    world.districts.forEach(function (d) {
      d.facing = d.live.map(function () { return false; });
    });
    world.pairs.forEach(function (p) {
      var i;
      for (i = 0; i < p.faceA.length; i++) if (p.faceA[i]) world.districts[p.a].facing[i] = true;
      for (i = 0; i < p.faceB.length; i++) if (p.faceB[i]) world.districts[p.b].facing[i] = true;
    });
  }

  /* err = signedGap − target. >0 слишком далеко, <0 слишком близко/перекрытие.
     Двигаем вдоль вектора к ближайшей точке соседа. share=1 — оба тела пополам. */
  function gapSpring(world, opts) {
    opts = opts || {};
    var target = opts.target == null ? world.target : opts.target;
    var lock = opts.lock == null ? 0.35 : opts.lock;
    var k = opts.k == null ? 0.35 : opts.k;
    var share = opts.share == null ? 0.5 : opts.share;
    var iters = opts.iters == null ? 6 : opts.iters;
    var maxStep = opts.maxStep == null ? 2.5 : opts.maxStep;
    var overlapBoost = opts.overlapBoost == null ? 1.6 : opts.overlapBoost;
    var slideN = !!opts.slideNormal;
    ensureWeights(world);
    var it, p, di, dj, A, B, i, hit, gap, err, vx, vy, m, nx, ny, step, wa, wb, sA, sB, ccwA, ccwB, on;
    for (it = 0; it < iters; it++) {
      rebuildPairs(world, opts.tol == null ? 28 : opts.tol);
      for (p = 0; p < world.pairs.length; p++) {
        di = world.pairs[p].a; dj = world.pairs[p].b;
        A = world.districts[di]; B = world.districts[dj];
        ccwA = ringCcw(A.live); ccwB = ringCcw(B.live);
        function shove(src, dst, face, shareSrc) {
          for (i = 0; i < src.live.length; i++) {
            if (src.locked && src.locked[i]) continue;
            if (face && !face[i]) continue;
            wa = (src.w && src.w[i] != null) ? src.w[i] : 1;
            if (wa <= 0) continue;
            hit = closestOnRing(src.live[i], dst.live);
            var inside = pointInPoly(src.live[i], dst.live);
            gap = inside ? -hit.d : hit.d;
            err = gap - target;
            if (Math.abs(err) <= lock) {
              if (opts.hysteresis) src.locked[i] = true;
              continue;
            }
            vx = hit.q[0] - src.live[i][0];
            vy = hit.q[1] - src.live[i][1];
            m = hypot(vx, vy) || 1e-9;
            /* (nx,ny) увеличивает signedGap: снаружи — от поверхности, внутри — к ней (выход). */
            nx = vx / m; ny = vy / m;
            if (!inside) { nx = -nx; ny = -ny; }
            if (slideN) {
              on = outwardNormal(src.live, i, src === A ? ccwA : ccwB);
              if (on[0] * nx + on[1] * ny < 0) { on = [-on[0], -on[1]]; }
              nx = on[0]; ny = on[1];
            }
            sA = k * wa * (-err) * shareSrc;
            if (gap < 0) sA *= overlapBoost;
            if (sA > maxStep) sA = maxStep;
            if (sA < -maxStep) sA = -maxStep;
            src.live[i][0] += nx * sA;
            src.live[i][1] += ny * sA;
          }
        }
        shove(A, B, world.pairs[p].faceA, 1 - share);
        shove(B, A, world.pairs[p].faceB, share);
      }
    }
  }

  function gapStats(world) {
    var gaps = [], p, i, A, B, g;
    rebuildPairs(world, 28);
    for (p = 0; p < world.pairs.length; p++) {
      A = world.districts[world.pairs[p].a];
      B = world.districts[world.pairs[p].b];
      for (i = 0; i < A.live.length; i++) {
        if (!world.pairs[p].faceA[i]) continue;
        g = signedGap(A.live[i], B.live);
        gaps.push(g);
      }
    }
    if (!gaps.length) return { n: 0, mean: 0, min: 0, max: 0, locked: 0, under: 0, over: 0 };
    var s = 0, mn = 1e9, mx = -1e9, lock = 0, under = 0, over = 0;
    for (i = 0; i < gaps.length; i++) {
      s += gaps[i];
      if (gaps[i] < mn) mn = gaps[i];
      if (gaps[i] > mx) mx = gaps[i];
      if (Math.abs(gaps[i] - world.target) <= 0.4) lock++;
      if (gaps[i] < world.target - 0.4) under++;
      if (gaps[i] > world.target + 0.4) over++;
    }
    return { n: gaps.length, mean: s / gaps.length, min: mn, max: mx, locked: lock, under: under, over: over };
  }

  function tripleSocket(world, opts) {
    opts = opts || {};
    var side = opts.side == null ? world.target : opts.side;
    var k = opts.k == null ? 0.4 : opts.k;
    var r = side / Math.sqrt(3);
    rebuildTriples(world);
    world.triples.forEach(function (t) {
      var ids = [t.a, t.b, t.c], n = t.node, u, d, i, ring, hit, vx, vy, m, push;
      for (u = 0; u < 3; u++) {
        d = world.districts[ids[u]];
        ring = d.live;
        for (i = 0; i < ring.length; i++) {
          vx = ring[i][0] - n[0]; vy = ring[i][1] - n[1];
          m = hypot(vx, vy);
          if (m > 18 || m < 1e-6) continue;
          /* вогнутый карман: точка ближе узла, чем r, отталкивается до ~r */
          push = k * (r - m);
          ring[i][0] += (vx / m) * push;
          ring[i][1] += (vy / m) * push;
        }
      }
    });
  }

  function preserveStyled(world, pull) {
    pull = pull == null ? 0.15 : pull;
    world.districts.forEach(function (d) {
      var i, w;
      for (i = 0; i < d.live.length && i < d.styled.length; i++) {
        w = (d.w && d.w[i] != null) ? d.w[i] : 1;
        d.live[i][0] += (d.styled[i][0] - d.live[i][0]) * pull * (1 - Math.min(1, w));
        d.live[i][1] += (d.styled[i][1] - d.live[i][1]) * pull * (1 - Math.min(1, w));
      }
    });
  }

  function areaKeep(world, mix) {
    mix = mix == null ? 0.5 : mix;
    world.districts.forEach(function (d) {
      var a0 = Math.abs(areaOf(d.styled)) || 1;
      var a1 = Math.abs(areaOf(d.live)) || 1;
      var s = Math.sqrt(a0 / a1);
      s = 1 + (s - 1) * mix;
      var c = centroid(d.live), i;
      for (i = 0; i < d.live.length; i++) {
        d.live[i][0] = c[0] + (d.live[i][0] - c[0]) * s;
        d.live[i][1] = c[1] + (d.live[i][1] - c[1]) * s;
      }
    });
  }

  function seamSmooth(world, amt) {
    amt = amt == null ? 0.25 : amt;
    world.districts.forEach(function (d) {
      if (!d.facing) return;
      var n = d.live.length, out = cloneRing(d.live), i, a, b, c;
      for (i = 0; i < n; i++) {
        if (!d.facing[i] || (d.locked && d.locked[i])) continue;
        a = d.live[(i - 1 + n) % n]; b = d.live[i]; c = d.live[(i + 1) % n];
        out[i] = [b[0] + ((a[0] + c[0]) / 2 - b[0]) * amt, b[1] + ((a[1] + c[1]) / 2 - b[1]) * amt];
      }
      d.live = out;
    });
  }

  function gapEqualize(world, amt) {
    amt = amt == null ? 0.3 : amt;
    rebuildPairs(world, 28);
    world.pairs.forEach(function (p) {
      var A = world.districts[p.a], B = world.districts[p.b];
      var idx = p.runsA[0] && p.runsA[0].idx;
      if (!idx || idx.length < 3) return;
      var gaps = idx.map(function (i) { return signedGap(A.live[i], B.live); });
      var i, prev, next, g;
      for (i = 1; i + 1 < idx.length; i++) {
        prev = gaps[i - 1]; next = gaps[i + 1]; g = gaps[i];
        var tgt = (prev + next) / 2;
        var hit = closestOnRing(A.live[idx[i]], B.live);
        var vx = hit.q[0] - A.live[idx[i]][0], vy = hit.q[1] - A.live[idx[i]][1];
        var m = hypot(vx, vy) || 1;
        A.live[idx[i]][0] += (vx / m) * (tgt - g) * amt;
        A.live[idx[i]][1] += (vy / m) * (tgt - g) * amt;
      }
    });
  }

  var Seams = {
    TARGET: TARGET,
    cloneRing: cloneRing,
    closestOnRing: closestOnRing,
    minRingDist: minRingDist,
    signedGap: signedGap,
    facingMask: facingMask,
    runsOf: runsOf,
    turnMag: turnMag,
    outwardNormal: outwardNormal,
    pointInPoly: pointInPoly,
    worldFromDistricts: worldFromDistricts,
    rebuildPairs: rebuildPairs,
    rebuildTriples: rebuildTriples,
    markFacing: markFacing,
    ensureWeights: ensureWeights,
    gapSpring: gapSpring,
    gapStats: gapStats,
    tripleSocket: tripleSocket,
    preserveStyled: preserveStyled,
    areaKeep: areaKeep,
    seamSmooth: seamSmooth,
    gapEqualize: gapEqualize,
    areaOf: areaOf
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Seams;
  root.Seams = Seams;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
