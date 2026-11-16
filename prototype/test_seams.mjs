import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';
const proto = path.dirname(fileURLToPath(import.meta.url));
function load(f) { vm.runInThisContext(fs.readFileSync(path.join(proto, f), 'utf8'), { filename: f }); }
load('corners.js'); load('compressor.js'); load('seams.js');
const S = globalThis.Seams;
let failed = 0;
function check(name, ok, extra) {
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + (extra ? ' | ' + extra : ''));
  if (!ok) failed++;
}

function capsule(x0, x1, y, w) {
  const r = [];
  for (let i = 0; i <= 12; i++) r.push([x0 + (x1 - x0) * i / 12, y]);
  for (let i = 1; i <= 6; i++) {
    const a = Math.PI * i / 6;
    r.push([x1, y + Math.sin(a) * w]);
  }
  for (let i = 12; i >= 0; i--) r.push([x0 + (x1 - x0) * i / 12, y + w]);
  for (let i = 1; i <= 6; i++) {
    const a = Math.PI * i / 6;
    r.push([x0, y + w - Math.sin(a) * w]);
  }
  return r;
}

const farA = capsule(0, 80, 0, 20);
const farB = capsule(0, 80, 32, 20); // gap ~12 between y=20 and y=32
check('minDist far ~12', Math.abs(S.minRingDist(farA, farB) - 12) < 1.5, S.minRingDist(farA, farB).toFixed(2));

let world = S.worldFromDistricts([
  { name: 'A', src: farA, styled: farA },
  { name: 'B', src: farB, styled: farB }
]);
S.markFacing(world, 20);
S.gapSpring(world, { target: 5, lock: 0.4, k: 0.45, share: 0.5, iters: 10, maxStep: 2, hysteresis: true, slideNormal: false, tol: 20 });
const st = S.gapStats(world);
check('spring pulls 12 → closer to 5', st.mean < 10 && st.mean > 2, 'mean ' + st.mean.toFixed(2));
check('no overlap after pull', st.min > -0.5, 'min ' + st.min.toFixed(2));

const nearA = capsule(0, 80, 0, 20);
const nearB = capsule(0, 80, 22, 20); // gap ~2
world = S.worldFromDistricts([
  { name: 'A', src: nearA, styled: nearA },
  { name: 'B', src: nearB, styled: nearB }
]);
S.markFacing(world, 16);
S.gapSpring(world, { target: 5, lock: 0.4, k: 0.5, share: 0.5, iters: 10, maxStep: 2, overlapBoost: 1.8, hysteresis: true, slideNormal: false, tol: 16 });
const st2 = S.gapStats(world);
check('spring pushes 2 → toward 5', st2.mean > 3, 'mean ' + st2.mean.toFixed(2));

function rect(x0, y0, x1, y1) {
  const r = [], nx = 16, ny = 4;
  let i;
  for (i = 0; i <= nx; i++) r.push([x0 + (x1 - x0) * i / nx, y0]);
  for (i = 1; i <= ny; i++) r.push([x1, y0 + (y1 - y0) * i / ny]);
  for (i = nx - 1; i >= 0; i--) r.push([x0 + (x1 - x0) * i / nx, y1]);
  for (i = ny - 1; i >= 1; i--) r.push([x0, y0 + (y1 - y0) * i / ny]);
  return r;
}
const lockA = rect(0, 0, 80, 20);
const lockB = rect(0, 25, 80, 45);
world = S.worldFromDistricts([
  { name: 'A', src: lockA, styled: lockA },
  { name: 'B', src: lockB, styled: lockB }
]);
S.markFacing(world, 12);
S.gapSpring(world, { target: 5, lock: 0.5, k: 0.5, share: 0.5, iters: 4, maxStep: 2, hysteresis: true, slideNormal: false, tol: 12 });
const stLock = S.gapStats(world);
check('already ~5 locks facing verts', stLock.locked >= 8, 'lock ' + stLock.locked + '/' + stLock.n + ' mean ' + stLock.mean.toFixed(2));

function disk(cx, cy, r, n) {
  const o = [];
  for (let i = 0; i < n; i++) {
    const a = i / n * Math.PI * 2;
    o.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return o;
}
const tA = disk(0, 0, 20, 24), tB = disk(36, 0, 20, 24), tC = disk(18, 31, 20, 24);
world = S.worldFromDistricts([
  { name: 'A', src: tA, styled: tA },
  { name: 'B', src: tB, styled: tB },
  { name: 'C', src: tC, styled: tC }
]);
S.rebuildPairs(world, 8);
S.rebuildTriples(world);
check('three touching disks make a triple', world.triples.length >= 1, 'triples ' + world.triples.length + ' pairs ' + world.pairs.length);

const ovA = capsule(0, 80, 0, 20);
const ovB = capsule(0, 80, 10, 20); // overlap
world = S.worldFromDistricts([
  { name: 'A', src: ovA, styled: ovA },
  { name: 'B', src: ovB, styled: ovB }
]);
S.markFacing(world, 20);
S.gapSpring(world, { target: 5, lock: 0.4, k: 0.5, share: 0.5, iters: 12, maxStep: 3, overlapBoost: 2, hysteresis: false, slideNormal: false, tol: 20 });
const st3 = S.gapStats(world);
check('overlap is reduced (min not deeply negative)', st3.min > -4, 'min ' + st3.min.toFixed(2) + ' mean ' + st3.mean.toFixed(2));

if (failed) { console.error(failed + ' failed'); process.exit(1); }
console.log('all passed');
