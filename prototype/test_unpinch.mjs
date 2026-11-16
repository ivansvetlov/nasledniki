// test_unpinch.mjs — unpinch: только наружу, затем wiring в processRing.
// Запуск: node prototype/test_unpinch.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const proto = __dirname;

function loadScript(file) {
  const code = fs.readFileSync(path.join(proto, file), 'utf8');
  vm.runInThisContext(code, { filename: file });
}
loadScript('corners.js');
loadScript('compressor.js');
const Corners = globalThis.Corners;
const C = globalThis.Compressor;

const html = fs.readFileSync(path.join(proto, 'compressor-demo.html'), 'utf8');
const stackSrc = fs.readFileSync(path.join(proto, 'stack-ui.js'), 'utf8');
const realSrc = fs.readFileSync(path.join(proto, 'districts_real.js'), 'utf8')
  .replace(/window\.REAL_DISTRICTS/, 'globalThis.REAL_DISTRICTS');
vm.runInThisContext(realSrc, { filename: 'districts_real.js' });
const D = globalThis.REAL_DISTRICTS;

function polyArea(ring) {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const j = (i + 1) % ring.length;
    a += ring[i][0] * ring[j][1] - ring[j][0] * ring[i][1];
  }
  return a / 2;
}
function minClear(ring, win) {
  win = win == null ? 4 : win;
  const n = ring.length;
  let m = Infinity;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const along = Math.min(j - i, n - (j - i));
      if (along <= win) continue;
      const d = Math.hypot(ring[j][0] - ring[i][0], ring[j][1] - ring[i][1]);
      if (d < m) m = d;
    }
  }
  return m;
}
function sharpCount(ring, deg) {
  return Corners.detectCorners(ring, deg).length;
}

// START из compressor-demo.html
const START = { eps: 10, ten: 1, step: 16, keepAngle: 80, minAngle: 10, splT: 1, cSpeed: 2, cSkew: 1, cPulse: 0, cBias: 0.5, cAngle: 150 };

function pipeline(src, gap) {
  const o = { speed: START.cSpeed, tension: START.splT, skew: START.cSkew, pulse: START.cPulse, bias: START.cBias, angle: START.cAngle };
  const s = Math.max(2, o.speed | 0);
  let out = C.macroSmooth(src, START.eps, START.ten, START.step, START.keepAngle);
  out = Corners.smoothCorners(out, o);
  out = Corners.splineRing(out, 0, s);
  out = Corners.smoothCorners(out, o);
  out = C.roundCorners(out, 2, 0.3);
  out = Corners.fillConcavities(out, { depth: 8, iters: 8 });
  out = Corners.clampMinAngle(out, START.minAngle, 20);
  if (gap > 0) out = Corners.unpinch(out, gap, { iters: 5, strength: 0.5 });
  const xs = C.selfIntersections(out);
  if (xs.length) {
    const u = C.untangleRing(out, 'auto', { relaxIters: 12, relaxAmt: 0.5, win: 6, smoothWin: 10 });
    out = u.ring;
    out = Corners.clampMinAngle(out, START.minAngle, 20);
  }
  return { ring: out, crossings: C.selfIntersections(out).length, clear: minClear(out), sharp: sharpCount(out, 25) };
}

let failed = 0;
function check(name, ok, extra) {
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + (extra ? ' | ' + extra : ''));
  if (!ok) failed++;
}

// ---- 1. синтетический перешеек 4px: unpinch только наружу, зазор растёт ----
const hourglass = [];
function pushLine(o, a, b, n) {
  for (let k = 1; k <= n; k++) {
    const t = k / n;
    o.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
}
pushLine(hourglass, [0, 0], [30, 18], 8);
pushLine(hourglass, [30, 18], [70, 18], 12);
pushLine(hourglass, [70, 18], [100, 0], 8);
pushLine(hourglass, [100, 0], [100, 40], 6);
pushLine(hourglass, [100, 40], [70, 22], 8);
pushLine(hourglass, [70, 22], [30, 22], 12);
pushLine(hourglass, [30, 22], [0, 40], 8);
pushLine(hourglass, [0, 40], [0, 0], 6);

const c0 = minClear(hourglass, 6);
const a0 = Math.abs(polyArea(hourglass));
const up = Corners.unpinch(hourglass, 10, { iters: 5, strength: 0.5 });
const c1 = minClear(up, 6);
const a1 = Math.abs(polyArea(up));
check('unpinch увеличивает зазор перешейка', c1 > c0 + 0.5, `clear ${c0.toFixed(2)} → ${c1.toFixed(2)}`);
check('unpinch не уменьшает площадь (только наружу)', a1 >= a0 - 1e-6, `area ${a0.toFixed(1)} → ${a1.toFixed(1)}`);
check('unpinch gap=0 — identity', Corners.unpinch(hourglass, 0) === hourglass || minClear(Corners.unpinch(hourglass, 0), 6) === c0, '');

// смещение только вдоль внешней нормали исходного кольца (не к центроиду —
// для «языков» центроид даёт неверный знак)
function exteriorNormal(ring, i) {
  const n = ring.length;
  let area = 0;
  for (let k = 0; k < n; k++) {
    const j = (k + 1) % n;
    area += ring[k][0] * ring[j][1] - ring[j][0] * ring[k][1];
  }
  const ccw = area > 0;
  const a = ring[(i - 1 + n) % n], b = ring[i], c = ring[(i + 1) % n];
  let n1 = [b[1] - a[1], -(b[0] - a[0])];
  let n2 = [c[1] - b[1], -(c[0] - b[0])];
  if (!ccw) { n1 = [-n1[0], -n1[1]]; n2 = [-n2[0], -n2[1]]; }
  let nx = n1[0] + n2[0], ny = n1[1] + n2[1];
  const m = Math.hypot(nx, ny) || 1;
  return [nx / m, ny / m];
}
let inward = 0;
for (let i = 0; i < hourglass.length; i++) {
  const [nx, ny] = exteriorNormal(hourglass, i);
  const dx = up[i][0] - hourglass[i][0];
  const dy = up[i][1] - hourglass[i][1];
  if (dx * nx + dy * ny < -1e-6) inward++;
}
check('unpinch только наружу (dot с внешней нормалью >= 0)', inward === 0, `inward=${inward}/${hourglass.length}`);

// ---- 1b. допустимая выемка (вода между берегами, ширина 6 < gap) НЕ должна
// расправляться / раздуваться: соседи через ВОДУ и вдоль контура — не перешеек
const bay = [];
pushLine(bay, [0, 0], [100, 0], 10);
pushLine(bay, [100, 0], [100, 50], 8);
pushLine(bay, [100, 50], [56, 50], 8);
pushLine(bay, [56, 50], [56, 10], 12);
pushLine(bay, [56, 10], [50, 10], 6);
pushLine(bay, [50, 10], [50, 50], 12);
pushLine(bay, [50, 50], [0, 50], 8);
pushLine(bay, [0, 50], [0, 0], 8);
function bayDepth(ring) {
  let minY = 1e9;
  for (const p of ring) {
    if (p[0] >= 49 && p[0] <= 57 && p[1] < 48) minY = Math.min(minY, p[1]);
  }
  return 50 - minY;
}
function bayWidth(ring) {
  let left = -1e9, right = 1e9;
  for (const p of ring) {
    if (p[1] > 18 && p[1] < 42) {
      if (p[0] < 53) left = Math.max(left, p[0]);
      if (p[0] > 53) right = Math.min(right, p[0]);
    }
  }
  return right - left;
}
const bayUp = Corners.unpinch(bay, 10, { iters: 5, strength: 0.5, reach: 1 });
const aBay0 = Math.abs(polyArea(bay)), aBay1 = Math.abs(polyArea(bayUp));
check('выемка: площадь не раздувается (ложный along-ring offset)', aBay1 < aBay0 * 1.12, `area ${aBay0.toFixed(0)} → ${aBay1.toFixed(0)}`);
check('выемка: глубина почти та же (не расправляется наружу)', Math.abs(bayDepth(bayUp) - bayDepth(bay)) < 4, `depth ${bayDepth(bay).toFixed(1)} → ${bayDepth(bayUp).toFixed(1)}`);
check('выемка: ширина не растёт как перешеек', bayWidth(bayUp) < bayWidth(bay) + 3, `width ${bayWidth(bay).toFixed(1)} → ${bayWidth(bayUp).toFixed(1)}`);

// ---- 1c. язык: шея + голова. reach=0 только шея; reach=1 до кончика, без гриба
const paddle = [];
pushLine(paddle, [90, 0], [90, 40], 6);
pushLine(paddle, [90, 40], [50, 40], 6);
pushLine(paddle, [50, 40], [50, 23], 4);
pushLine(paddle, [50, 23], [0, 23], 10);
pushLine(paddle, [0, 23], [0, 17], 4);
pushLine(paddle, [0, 17], [50, 17], 10);
pushLine(paddle, [50, 17], [50, 0], 4);
pushLine(paddle, [50, 0], [90, 0], 6);
function tipX(ring) {
  let m = 1e9;
  for (const p of ring) if (p[0] < 8) m = Math.min(m, p[0]);
  return m;
}
const pad0 = Corners.unpinch(paddle, 12, { iters: 5, strength: 0.5, reach: 0 });
const pad1 = Corners.unpinch(paddle, 12, { iters: 5, strength: 0.5, reach: 1 });
check('язык reach=0: кончик почти не едет', Math.abs(tipX(pad0) - tipX(paddle)) < 1.2, `tip ${tipX(paddle).toFixed(2)} → ${tipX(pad0).toFixed(2)}`);
check('язык reach=1: кончик надувается наружу', tipX(pad1) < tipX(paddle) - 1.5, `tip ${tipX(paddle).toFixed(2)} → ${tipX(pad1).toFixed(2)}`);
check('язык reach=1 надувает сильнее шеи-only', tipX(pad1) < tipX(pad0) - 0.8, `r0 ${tipX(pad0).toFixed(2)} vs r1 ${tipX(pad1).toFixed(2)}`);

// ---- 2. wiring: processRing обязан звать unpinch, antiPinch в старте/списках ----
check('html вызывает CompressorStack.run', /CompressorStack\.run/.test(html));
check('stack-ui.js вызывает unpinch', /Cn\.unpinch\s*\(/.test(stackSrc));
check('unpinch до untangle в стеке', (() => {
  const iU = stackSrc.indexOf("case 'unpinch'");
  const iX = stackSrc.indexOf("case 'untangle'");
  return iU >= 0 && iX >= 0 && iU < iX;
})());
check('START содержит antiPinch', /const START = \{[^}]*antiPinch\s*:/.test(html));
check('START содержит antiPinchReach', /const START = \{[^}]*antiPinchReach\s*:/.test(html));
check('PARAM_IDS содержит antiPinchReach', /PARAM_IDS = \[[^\]]*antiPinchReach/.test(html));
check('ALL_IDS содержит antiPinch', /ALL_IDS=\[[^\]]*antiPinch/.test(html));
check('ALL_IDS содержит antiPinchReach', /ALL_IDS=\[[^\]]*antiPinchReach/.test(html));
check('syncLabels синхронизирует vAntiPinch', /set\('antiPinch','vAntiPinch'\)/.test(html));
check('syncLabels синхронизирует vPinchReach', /set\('antiPinchReach','vPinchReach'\)/.test(html));
check('unpinch передаёт reach', /reach:\s*pval\(step,\s*'antiPinchReach'/.test(stackSrc) || /reach:\s*pval\(step, 'antiPinchReach'/.test(stackSrc));
check('keepAngle шаг 1', /id="keepAngle"[^>]*step="1"/.test(html));

// ---- 3. Приволжский: gap=10 чинит зазор, без самопересечений; 20+ не раздуваем ----
const priv = D.find((x) => x.name === 'Приволжский район');
check('Приволжский есть в REAL', !!priv);
const p0 = pipeline(priv.pts, 0);
const p10 = pipeline(priv.pts, 10);
const p20 = pipeline(priv.pts, 20);
check('Приволжский gap=10: зазор растёт', p10.clear > p0.clear + 0.4, `clear ${p0.clear.toFixed(2)} → ${p10.clear.toFixed(2)}`);
check('Приволжский gap=10: 0 самопересечений', p10.crossings === 0, `xs=${p10.crossings}`);
check('Приволжский gap=10: отклонение не взрывается', (() => {
  function maxDev(ring, orig) {
    let mx = 0;
    for (const pt of ring) {
      let d = Infinity;
      for (let i = 0; i < orig.length; i++) {
        const a = orig[i], b = orig[(i + 1) % orig.length];
        d = Math.min(d, Corners.distToSeg(pt, a, b));
      }
      if (d > mx) mx = d;
    }
    return mx;
  }
  const d0 = maxDev(p0.ring, priv.pts);
  const d10 = maxDev(p10.ring, priv.pts);
  check('Приволжский gap=10: maxDev не хуже +4px', d10 <= d0 + 4, `dev ${d0.toFixed(1)} → ${d10.toFixed(1)}`);
  return true;
})());

// ---- 4. все 25 районов, gap=10, без самопересечений ----
let xsFail = [];
for (const d of D) {
  const r = pipeline(d.pts, 10);
  if (r.crossings) xsFail.push(d.name + ':' + r.crossings);
}
check('все 25 районов gap=10 без самопересечений', xsFail.length === 0, xsFail.join(', ') || 'ok');

console.log('\n' + (failed ? failed + ' FAILED' : 'ALL PASS'));
process.exit(failed ? 1 : 0);
