import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { shrinkRing, polygonArea } from "./spline_core.mjs";

const SVG = new URL("../accounts/01601a7495be1aed/maps/samara/map.svg", import.meta.url);
const svg = readFileSync(SVG, "utf-8");

function parsePts(d) {
  const out = [], re = /([+-]?\d+\.?\d*),([+-]?\d+\.?\d*)/g;
  let m; while ((m = re.exec(d))) out.push([parseFloat(m[1]), parseFloat(m[2])]);
  return out;
}
let cur = null;
const districts = [];
const gRe = /<g\b[^>]*data-layer-id="(\d+)"[^>]*>|<path\b[^>]*?>/g;
let mt;
while ((mt = gRe.exec(svg))) {
  const t = mt[0];
  if (t.startsWith("<g")) { cur = mt[1]; continue; }
  if (cur !== "1") continue;
  const d = t.match(/\bd="([^"]*)"/); const nm = t.match(/data-name="([^"]*)"/);
  if (!d || !nm) continue;
  const pts = parsePts(d[1]);
  if (pts.length > 3) districts.push({ name: nm[1], pts });
}

function poly(pts, color, w) {
  const a = pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  return `<polyline points="${a}" fill="none" stroke="${color}" stroke-width="${w}"/>`;
}

const R = [2, 4, 8];
let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
for (const d of districts) for (const p of d.pts) {
  if (p[0] < minX) minX = p[0]; if (p[1] < minY) minY = p[1];
  if (p[0] > maxX) maxX = p[0]; if (p[1] > maxY) maxY = p[1];
}
const colors = ["#e22", "#f90", "#09f"];
let out = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX - 20} ${minY - 20} ${maxX - minX + 40} ${maxY - minY + 40}">`;
out += `<polyline points="" />`; // noop
const stats = R.map(() => ({ area: 0, n: 0 }));
for (const d of districts) {
  out += poly(d.pts, "#999", 0.8);
  R.forEach((r, i) => {
    const s = shrinkRing(d.pts, r, { finalSmooth: 0.6 });
    out += poly(s, colors[i], 1.1);
    stats[i].area += polygonArea(s);
    stats[i].n++;
  });
}
out += `</svg>`;
const OUT = new URL("../accounts/01601a7495be1aed/maps/samara/_preview_shrink.svg", import.meta.url);
writeFileSync(OUT, out);

let origArea = 0;
for (const d of districts) origArea += polygonArea(d.pts);
console.log(`districts: ${districts.length}`);
R.forEach((r, i) => {
  const red = 100 * (1 - stats[i].area / origArea);
  console.log(`  r=${r}: суммарная площадь уменьшилась на ${red.toFixed(1)}% (без наложений; щели позже закроет фаза "наращивание")`);
});
console.log(`preview: ${OUT.pathname}`);
