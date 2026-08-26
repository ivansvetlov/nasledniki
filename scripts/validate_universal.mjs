import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { universalSmooth, catmullRomRing, polygonArea } from "./spline_core.mjs";

const SVG = new URL("../accounts/01601a7495be1aed/maps/samara/map.svg", import.meta.url);
const svg = readFileSync(SVG, "utf-8");

function parsePts(d) {
  const out = [];
  const re = /([+-]?\d+\.?\d*),([+-]?\d+\.?\d*)/g;
  let m;
  while ((m = re.exec(d))) out.push([parseFloat(m[1]), parseFloat(m[2])]);
  return out;
}
function plMin(p, pts) {
  let best = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1];
    const vx = b[0] - a[0], vy = b[1] - a[1];
    const wx = p[0] - a[0], wy = p[1] - a[1];
    const c2 = vx * vx + vy * vy;
    const t = c2 === 0 ? 0 : Math.max(0, Math.min(1, (vx * wx + vy * wy) / c2));
    const dx = p[0] - (a[0] + t * vx), dy = p[1] - (a[1] + t * vy);
    const dd = Math.hypot(dx, dy);
    if (dd < best) best = dd;
  }
  return best;
}
function pin(p, pts) {
  let inside = false, n = pts.length;
  for (let i = 0; i < n; i++) {
    const ax = pts[i][0], ay = pts[i][1];
    const bx = pts[(i + 1) % n][0], by = pts[(i + 1) % n][1];
    if ((ay > p[1]) !== (by > p[1]) && p[0] < ((bx - ax) * (p[1] - ay)) / (by - ay) + ax)
      inside = !inside;
  }
  return inside;
}

// parse layer-1 districts + marker
let cur = null;
const districts = [];
let marker = null;
const gRe = /<g\b[^>]*data-layer-id="(\d+)"[^>]*>|<path\b[^>]*?>/g;
let mt;
while ((mt = gRe.exec(svg))) {
  const t = mt[0];
  if (t.startsWith("<g")) { cur = mt[1]; continue; }
  if (cur !== "1") {
    if (/data-oid="m3"/.test(t)) {
      const d = t.match(/\bd="([^"]*)"/)[1];
      marker = parsePts(d);
    }
    continue;
  }
  const d = t.match(/\bd="([^"]*)"/); const nm = t.match(/data-name="([^"]*)"/);
  if (!d || !nm) continue;
  const pts = parsePts(d[1]);
  if (pts.length > 3) districts.push({ name: nm[1], pts });
}
const mClosed = marker.concat([marker[0]]);

function stats(ring) {
  let out = 0, sum = 0, mx = 0, rev = 0, rsum = 0;
  for (const p of ring) {
    const dm = plMin(p, mClosed);
    const outside = !pin(p, mClosed);
    if (outside) { out++; sum += dm; if (dm > mx) mx = dm; }
  }
  for (const p of mClosed) rsum += plMin(p, ring);
  return { pctOut: 100 * out / ring.length, maxOut: mx, meanOut: out ? sum / out : 0, rmsRev: rsum / mClosed.length };
}

const kinel = districts.find((d) => d.name.includes("Кинельский"));
console.log("districts:", districts.length, " marker pts:", marker.length, " Кинельский pts:", kinel.pts.length);

console.log("\n-- Кинельский: оригинал vs universalSmooth (разные window) --");
const orig = stats(kinel.pts);
console.log(`   оригинал:  %снаружи=${orig.pctOut.toFixed(1)} max=${orig.maxOut.toFixed(1)} rms(marker->тело)=${orig.rmsRev.toFixed(1)}`);
let best = null;
for (const w of [9, 13, 17, 21, 27]) {
  const sm = universalSmooth(kinel.pts, { spacing: 3, window: w });
  const s = stats(sm);
  console.log(`   w=${w}: %снаружи=${s.pctOut.toFixed(1)} max=${s.maxOut.toFixed(1)} rms=${s.rmsRev.toFixed(1)} area=${polygonArea(sm).toFixed(0)}`);
  if (!best || s.pctOut < best.s.pctOut) best = { w, sm, s };
}

// neighbor detection via shared border (точки Кинельского вблизи другого района)
const THR = 6;
function sharedCount(a, b) {
  let c = 0;
  for (const p of a) if (plMin(p, b) < THR) c++;
  return c;
}
let neigh = null, maxC = 0;
for (const d of districts) {
  if (d === kinel) continue;
  const c = sharedCount(kinel.pts, d.pts);
  if (c > maxC) { maxC = c; neigh = d; }
}
const kW = best.w;
const kSm = best.sm;
let nSm = null;
if (!neigh) {
  console.log("\n-- сосед с общей границей не найден (порог " + THR + "px) --");
} else {
  console.log(`\n-- Сосед с общей границей: ${neigh.name} (общих точек=${maxC}, порог ${THR}px) --`);
  nSm = universalSmooth(neigh.pts, { spacing: 3, window: kW });
  const sharedK = kinel.pts.filter((p) => plMin(p, neigh.pts) < THR);
  const sharedN = neigh.pts.filter((p) => plMin(p, kinel.pts) < THR);
  const base0 = sharedK.reduce((s, p) => s + plMin(p, neigh.pts), 0) / sharedK.length;
  let dKsum = 0, dKmax = 0, dNsum = 0, dNmax = 0;
  for (const p of sharedK) { const d = plMin(p, nSm); dKsum += d; if (d > dKmax) dKmax = d; }
  for (const p of sharedN) { const d = plMin(p, kSm); dNsum += d; if (d > dNmax) dNmax = d; }
  console.log(`   до сглаживания: исходная щель общей границы mean=${base0.toFixed(1)} px`);
  console.log(`   после НЕЗАВИСИМОГО сглаживания (w=${kW}):`);
  console.log(`     Кинельский->сосед mean=${(dKsum/sharedK.length).toFixed(1)} max=${dKmax.toFixed(1)} px`);
  console.log(`     сосед->Кинельский mean=${(dNsum/sharedN.length).toFixed(1)} max=${dNmax.toFixed(1)} px`);
  console.log(`   => границы разъезжаются (max ~${Math.max(dKmax,dNmax).toFixed(0)}px); сглаживать надо на уровне EDGE/TOPO`);
}

// preview SVG
function poly(pts, color, w) {
  const ptsAttr = pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  return `<polyline points="${ptsAttr}" fill="none" stroke="${color}" stroke-width="${w}"/>`;
}
const kFine = catmullRomRing(kSm, 0.6, 2);
let svgOut = `<svg xmlns="http://www.w3.org/2000/svg">`;
svgOut += `<g><text x="430" y="270" font-size="12" fill="#888">Кинельский: серый=оригинал, красный=universalSmooth(w=${kW})</text>`;
svgOut += poly(kinel.pts, "#999", 1) + poly(kFine, "#e22", 1.6) + `</g>`;
if (neigh && nSm) {
  const nFine = catmullRomRing(nSm, 0.6, 2);
  svgOut += `<g transform="translate(0,160)"><text x="430" y="270" font-size="12" fill="#888">Сосед ${neigh.name}: серый=оригинал, красный=universalSmooth</text>`;
  svgOut += poly(neigh.pts, "#999", 1) + poly(nFine, "#e22", 1.6) + `</g>`;
}
svgOut += `</svg>`;
const OUT = new URL("../accounts/01601a7495be1aed/maps/samara/_preview_universal.svg", import.meta.url);
writeFileSync(OUT, svgOut);
console.log(`\npreview: ${OUT.pathname}`);
