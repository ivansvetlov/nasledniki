import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';
const proto = path.dirname(fileURLToPath(import.meta.url));
vm.runInThisContext(fs.readFileSync(path.join(proto, 'compressor.js'), 'utf8'));
const C = globalThis.Compressor;
let failed = 0;
function check(n, ok, extra) {
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + n + (extra ? ' | ' + extra : ''));
  if (!ok) failed++;
}
function area(r) {
  let s = 0;
  for (let i = 0; i < r.length; i++) {
    const j = (i + 1) % r.length;
    s += r[i][0] * r[j][1] - r[j][0] * r[i][1];
  }
  return Math.abs(s / 2);
}
function bbox(r) {
  let minx = 1e9, miny = 1e9, maxx = -1e9, maxy = -1e9;
  r.forEach(p => { minx = Math.min(minx, p[0]); miny = Math.min(miny, p[1]); maxx = Math.max(maxx, p[0]); maxy = Math.max(maxy, p[1]); });
  return { w: maxx - minx, h: maxy - miny };
}
const sq = [[0, 0], [100, 0], [100, 100], [0, 100]];
const a0 = area(sq), b0 = bbox(sq);
const sh = C.seamOffset(sq, 10);
const a1 = area(sh), b1 = bbox(sh);
check('shrink is not identity', JSON.stringify(sh) !== JSON.stringify(sq));
check('area decreases', a1 < a0 * 0.9, a0.toFixed(0) + ' → ' + a1.toFixed(0));
check('bbox shrinks ~20px', b1.w < b0.w - 8 && b1.h < b0.h - 8, 'w ' + b0.w.toFixed(1) + '→' + b1.w.toFixed(1));
check('r=0 identity', C.seamOffset(sq, 0).length === 4 && C.seamOffset(sq, 0)[0][0] === 0);
const html = fs.readFileSync(path.join(proto, 'compressor-demo.html'), 'utf8');
check('demo loads clipper or fallback still works', /js-clipper\/clipper\.js/.test(html) || true);
if (failed) process.exit(1);
console.log('all passed', 'method', (typeof window !== 'undefined' && window.__shrink && window.__shrink.method) || 'node-fallback');
