// test_grid.mjs — указатель района: #N + клетка A1..F6 в bbox.
// Запуск: node prototype/test_grid.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const proto = __dirname;
vm.runInThisContext(fs.readFileSync(path.join(proto, 'compressor.js'), 'utf8'), { filename: 'compressor.js' });
const C = globalThis.Compressor;
const html = fs.readFileSync(path.join(proto, 'compressor-demo.html'), 'utf8');
const realSrc = fs.readFileSync(path.join(proto, 'districts_real.js'), 'utf8')
  .replace(/window\.REAL_DISTRICTS/, 'globalThis.REAL_DISTRICTS');
vm.runInThisContext(realSrc, { filename: 'districts_real.js' });
const D = globalThis.REAL_DISTRICTS;

let failed = 0;
function check(name, ok, extra) {
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + (extra ? ' | ' + extra : ''));
  if (!ok) failed++;
}

check('Compressor.pointToCell есть', typeof C.pointToCell === 'function');
check('Compressor.cellRect есть', typeof C.cellRect === 'function');
check('GRID_N = 6', C.GRID_N === 6, String(C.GRID_N));
if (typeof C.pointToCell !== 'function') {
  console.log('\n' + failed + ' FAILED (abort)');
  process.exit(1);
}

const box = [[0, 0], [60, 0], [60, 60], [0, 60]];
const a1 = C.pointToCell(box, 1, 1, 6);
const f6 = C.pointToCell(box, 59, 59, 6);
const c3 = C.pointToCell(box, 25, 25, 6); // 25/60*6 = 2.5 → col 2 = C, row 2 = 3
check('A1 = северо-запад bbox (minx,miny)', a1 && a1.id === 'A1', a1 && a1.id);
check('F6 = юго-восток bbox (maxx,maxy)', f6 && f6.id === 'F6', f6 && f6.id);
check('центр ~ C3', c3 && c3.id === 'C3', c3 && c3.id);
check('parseCell("c3") → col=2 row=2', (() => {
  const p = C.parseCell('c3');
  return p && p.col === 2 && p.row === 2;
})());
check('cellRect A1 лежит в NW четверти', (() => {
  const r = C.cellRect(box, 0, 0, 6);
  return r.x0 === 0 && r.y0 === 0 && r.x1 === 10 && r.y1 === 10;
})());

const priv = D.find((x) => x.name === 'Приволжский район');
check('Приволжский в данных', !!priv);
const privIdx = D.findIndex((x) => x.name === 'Приволжский район');
check('Приволжский — район #19 (1-based порядок REAL_DISTRICTS)', privIdx === 18, 'idx=' + privIdx);

check('html рисует номер #N на карточке', /#\s*'?\s*\+\s*r\.n|bn.*#/.test(html) || html.includes('r.n'));
check('html копирует указатель при клике', /pointToCell/.test(html) && /clipboard/.test(html));
check('html рисует сетку A–F', /drawGrid/.test(html) || /GRID_N/.test(html));

console.log('\n' + (failed ? failed + ' FAILED' : 'ALL PASS'));
process.exit(failed ? 1 : 0);
