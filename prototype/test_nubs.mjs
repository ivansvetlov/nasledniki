import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';
const proto = path.dirname(fileURLToPath(import.meta.url));
vm.runInThisContext(fs.readFileSync(path.join(proto, 'corners.js'), 'utf8'));
const Cn = globalThis.Corners;
let failed = 0;
function check(n, ok, extra) {
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + n + (extra ? ' | ' + extra : ''));
  if (!ok) failed++;
}
function depthAt(ring, i) {
  const n = ring.length;
  return Cn.distToSeg(ring[i], ring[(i - 1 + n) % n], ring[(i + 1) % n]);
}
const square = [[0, 0], [40, 0], [50, -8], [60, 0], [100, 0], [100, 80], [0, 80]];
const d0 = depthAt(square, 2);
const out = Cn.clipNubs(square, { maxSpan: 30, minDepth: 0.2, minTurn: 10, iters: 10, maxWin: 3 });
const d1 = depthAt(out, 2);
check('nub on a side shallows', d1 < d0 * 0.5, d0.toFixed(2) + ' → ' + d1.toFixed(2));
const cape = [[0, 0], [40, 0], [50, -40], [60, 0], [100, 0], [100, 80], [0, 80]];
const cap0 = depthAt(cape, 2);
const cap1 = depthAt(Cn.clipNubs(cape, { maxSpan: 10, minDepth: 0.15, minTurn: 16 }), 2);
check('long cape span>10 is kept', cap1 > cap0 * 0.8, cap0.toFixed(1) + ' → ' + cap1.toFixed(1));
if (failed) process.exit(1);
console.log('all passed');
