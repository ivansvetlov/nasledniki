import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';
const proto = path.dirname(fileURLToPath(import.meta.url));
function load(f) { vm.runInThisContext(fs.readFileSync(path.join(proto, f), 'utf8'), { filename: f }); }
load('corners.js');
load('compressor.js');
vm.runInThisContext(
  fs.readFileSync(path.join(proto, 'districts_real.js'), 'utf8').replace(/window\.REAL_DISTRICTS/, 'globalThis.REAL_DISTRICTS')
);
const Cn = globalThis.Corners;
const C = globalThis.Compressor;
const D = globalThis.REAL_DISTRICTS;
let failed = 0;
function assert(cond, msg) {
  if (!cond) { failed++; console.error('FAIL', msg); }
  else console.log('ok', msg);
}

const square = [[0, 0], [100, 0], [100, 100], [0, 100]];
assert(Cn.ringCcw(square) === true, 'square CCW');
assert(Math.abs(Cn.turnSigned([0, 0], [100, 0], [100, 100], true) - 90) < 0.1, 'convex +90 at bottom-right');

const notch = [[0, 0], [40, 0], [40, 30], [60, 30], [60, 0], [100, 0], [100, 80], [0, 80]];
const ccw = Cn.ringCcw(notch);
const sBay = Cn.turnSigned([40, 0], [40, 30], [60, 30], ccw);
assert(sBay < 0, 'notch vertex is concave, signed=' + sBay.toFixed(1));
assert(Cn.detectCorners(notch, 150, 50).length >= 2, 'innerAngle 50 catches the bay');
assert(Cn.detectCorners(notch, 150, 0).length === 0, 'innerAngle 0 skips the bay');
assert(Cn.detectCorners(notch, 80).length >= 2, 'unsigned detect still sees 90° corners');

const filOuter = Cn.smoothCorners(notch, { speed: 4, tension: 1, skew: 0, pulse: 0.5, bias: 0, angle: 150, innerAngle: 0 });
const filInner = Cn.smoothCorners(notch, { speed: 4, tension: 1, skew: 0, pulse: 0.5, bias: 0, angle: 150, innerAngle: 50 });
assert(filInner.length > filOuter.length, 'inner fillet adds arc samples ' + filOuter.length + ' → ' + filInner.length);

const deep = [[0, 0], [40, 0], [50, 40], [60, 0], [100, 0], [100, 80], [0, 80]];
const filled = Cn.fillConcavities(deep, { depth: 8, iters: 8 });
const d0 = Cn.distToSeg([50, 40], [40, 0], [60, 0]);
const i = filled.findIndex(p => Math.abs(p[0] - 50) < 8);
const d1 = i >= 0 ? Cn.distToSeg(filled[i], filled[(i - 1 + filled.length) % filled.length] || [40, 0], filled[(i + 1) % filled.length] || [60, 0]) : d0;
assert(d1 < d0, 'fillConcavities shallows a deep notch ' + d0.toFixed(1) + ' → ' + d1.toFixed(1));

const d8 = D[7];
assert(d8 && /Кошкин/.test(d8.name), 'district #8 is ' + (d8 && d8.name));
const START = { eps: 10, ten: 1, step: 16, keepAngle: 80, minAngle: 10, splT: 1, cSpeed: 2, cSkew: 1, cPulse: 0, cBias: 0.5, cAngle: 150 };
function pipe(inner) {
  let out = C.macroSmooth(d8.pts, START.eps, START.ten, START.step, START.keepAngle);
  const o = { speed: START.cSpeed, tension: START.splT, skew: START.cSkew, pulse: START.cPulse, bias: START.cBias, angle: START.cAngle, innerAngle: inner };
  out = Cn.smoothCorners(out, o);
  out = Cn.splineRing(out, 0, 2);
  out = Cn.smoothCorners(out, o);
  out = C.roundCorners(out, 2, 0.3);
  out = Cn.fillConcavities(out, { depth: 8, iters: 8 });
  out = Cn.clampMinAngle(out, START.minAngle, 20, { inner: true });
  return out;
}
function a1Hits(ring) {
  const a1 = C.cellRect(ring, 0, 0, 6);
  const n = ring.length, ccw = Cn.ringCcw(ring), hits = [];
  for (let i = 0; i < n; i++) {
    const p = ring[i];
    if (p[0] < a1.x0 || p[0] > a1.x1 || p[1] < a1.y0 || p[1] > a1.y1) continue;
    const a = ring[(i - 1 + n) % n], c = ring[(i + 1) % n];
    const mag = Cn.turnAngle(a, p, c);
    const signed = Cn.turnSigned(a, p, c, ccw);
    const la = Math.hypot(a[0] - p[0], a[1] - p[1]);
    const lc = Math.hypot(c[0] - p[0], c[1] - p[1]);
    hits.push({ mag, signed, baseR: Math.min(la, lc) * 0.45, p });
  }
  hits.sort((a, b) => b.mag - a.mag);
  return hits;
}
const h0 = a1Hits(pipe(0));
const h50 = a1Hits(pipe(50));
console.log('#8 A1 inner=0', h0.slice(0, 3));
console.log('#8 A1 inner=50', h50.slice(0, 3));
assert(h0[0] && h0[0].mag > 45, '#8 A1 has a ~55° unsmoothed corner without innerAngle');
const easedInner = h50[0] && h50[0].mag < h0[0].mag - 5;
let sm = C.macroSmooth(d8.pts, START.eps, START.ten, START.step, START.keepAngle);
const late = Cn.smoothCorners(pipe(0), { speed: 4, tension: 1, skew: 0, pulse: 0.5, bias: 0, angle: 50, innerAngle: 50 });
const hLate = a1Hits(late);
console.log('#8 A1 extra fillet angle=50', hLate.slice(0, 3));
assert(easedInner || (hLate[0] && hLate[0].mag < h0[0].mag - 5),
  'innerAngle or trailing fillet@50 eases #8 A1 (' + h0[0].mag.toFixed(1) + ' → inner ' + (h50[0] && h50[0].mag.toFixed(1)) + ' / late ' + (hLate[0] && hLate[0].mag.toFixed(1)) + ')');

if (failed) { console.error(failed + ' failed'); process.exit(1); }
console.log('all passed');
