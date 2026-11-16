import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

const proto = path.dirname(fileURLToPath(import.meta.url));
const ctx = {
  console, Math, JSON, Array, Object, parseInt, parseFloat, isNaN, Infinity,
  setTimeout, clearTimeout,
  window: {}, globalThis: {},
  document: {
    getElementById: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    readyState: 'complete'
  },
  localStorage: { getItem: () => null, setItem: () => {} }
};
ctx.window = ctx;
ctx.globalThis = ctx;
function load(f) {
  const src = fs.readFileSync(path.join(proto, f), 'utf8')
    .replace(/window\.REAL_DISTRICTS/, 'globalThis.REAL_DISTRICTS');
  vm.runInContext(src, vm.createContext(ctx), { filename: f });
}
['corners.js', 'compressor.js', 'stack-ui.js', 'seams.js', 'seam-plugins.js', 'districts_real.js'].forEach(load);

const C = ctx.CompressorStack;
const S = ctx.Seams;
const SS = ctx.SeamStack;
const D = ctx.REAL_DISTRICTS;
if (!C || !S || !SS || !D) {
  console.error('missing', { C: !!C, S: !!S, SS: !!SS, D: !!D, n: D && D.length });
  process.exit(1);
}

const styled = D.map(function (d) {
  return { name: d.name, src: d.pts, styled: C.runFromParams(d.pts) };
});
console.log('districts', styled.length, 'verts', styled.reduce((s, d) => s + d.styled.length, 0));

function fmt(m) {
  if (!m || !m.n) return 'n=0';
  return 'n=' + m.n +
    ' mean=' + m.mean.toFixed(2) +
    ' min=' + m.min.toFixed(2) +
    ' max=' + m.max.toFixed(2) +
    ' lock=' + m.locked +
    ' under=' + m.under +
    ' over=' + m.over +
    ' |g-5|<1=' + (m.close1 != null ? m.close1 : '?') +
    ' |g-5|<2=' + (m.close2 != null ? m.close2 : '?');
}
function extraStats(world) {
  const m = S.gapStats(world);
  const gaps = [];
  S.rebuildPairs(world, 28);
  world.pairs.forEach(function (p) {
    const A = world.districts[p.a], B = world.districts[p.b];
    for (let i = 0; i < A.live.length; i++) {
      if (!p.faceA[i]) continue;
      gaps.push(S.signedGap(A.live[i], B.live));
    }
  });
  m.close1 = gaps.filter(g => Math.abs(g - 5) < 1).length;
  m.close2 = gaps.filter(g => Math.abs(g - 5) < 2).length;
  m.neg = gaps.filter(g => g < 0).length;
  m.p50 = gaps.slice().sort((a, b) => a - b)[Math.floor(gaps.length / 2)] || 0;
  return m;
}

function runSpring(world, opts) {
  S.ensureWeights(world);
  S.markFacing(world, opts.tol || 28);
  S.gapSpring(world, Object.assign({
    target: 5, lock: 0.35, k: 0.35, share: 0.5, iters: 6, maxStep: 2.2,
    overlapBoost: 1.6, hysteresis: false, slideNormal: false, tol: 28
  }, opts));
  return extraStats(world);
}

function snapToGap(world, target, iters) {
  S.ensureWeights(world);
  for (let it = 0; it < iters; it++) {
    S.rebuildPairs(world, 28);
    world.pairs.forEach(function (p) {
      const A = world.districts[p.a], B = world.districts[p.b];
      function place(src, dst, face) {
        for (let i = 0; i < src.live.length; i++) {
          if (face && !face[i]) continue;
          const hit = S.closestOnRing(src.live[i], dst.live);
          const inside = S.pointInPoly(src.live[i], dst.live);
          const gap = inside ? -hit.d : hit.d;
          const err = gap - target;
          if (Math.abs(err) < 0.05) continue;
          let vx = hit.q[0] - src.live[i][0], vy = hit.q[1] - src.live[i][1];
          let m = Math.hypot(vx, vy) || 1e-9;
          let nx = vx / m, ny = vy / m;
          if (!inside) { nx = -nx; ny = -ny; }
          src.live[i][0] += nx * (-err) * 0.5;
          src.live[i][1] += ny * (-err) * 0.5;
        }
      }
      place(A, B, p.faceA);
      place(B, A, p.faceB);
    });
  }
  return extraStats(world);
}

function fresh() {
  return S.worldFromDistricts(styled.map(d => ({ name: d.name, src: d.src, styled: d.styled })));
}

const t0 = Date.now();
const w0 = fresh();
S.markFacing(w0, 28);
const before = extraStats(w0);
console.log('BEFORE (styled only) ', fmt(before), 'neg', before.neg, 'p50', before.p50.toFixed(2));

const wStack = fresh();
SS.run(wStack);
const afterStack = extraStats(wStack);
console.log('CURRENT STACK       ', fmt(afterStack), 'neg', afterStack.neg, 'p50', afterStack.p50.toFixed(2));

const wSpring = fresh();
const afterSpring = runSpring(wSpring, { iters: 6, k: 0.35, hysteresis: false });
console.log('SPRING 6it k0.35    ', fmt(afterSpring), 'neg', afterSpring.neg);

const wLong = fresh();
const afterLong = runSpring(wLong, { iters: 40, k: 0.5, maxStep: 8, hysteresis: false, lock: 0.2 });
console.log('SPRING 40it k0.5    ', fmt(afterLong), 'neg', afterLong.neg);

const wSnap = fresh();
S.markFacing(wSnap, 28);
const afterSnap = snapToGap(wSnap, 5, 12);
console.log('EXACT SNAP 12it     ', fmt(afterSnap), 'neg', afterSnap.neg);

const wNoGate = fresh();
S.markFacing(wNoGate, 28);
S.gapSpring(wNoGate, { target: 5, lock: 0.25, k: 0.6, share: 0.5, iters: 24, maxStep: 6, overlapBoost: 2, hysteresis: false, slideNormal: false, tol: 28 });
const afterNoGate = extraStats(wNoGate);
console.log('SPRING 24it no gates', fmt(afterNoGate), 'neg', afterNoGate.neg);

console.log('ms', Date.now() - t0);
