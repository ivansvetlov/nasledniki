import { readFileSync, writeFileSync } from "node:fs";
import { shrinkRing } from "./spline_core.mjs";

const SVG = new URL("../accounts/01601a7495be1aed/maps/samara/map.svg", import.meta.url);
let svg = readFileSync(SVG, "utf-8");

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

function fmt(pts) {
  return "M" + pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" L") + " Z";
}
let layer = `<g data-layer-id="6" data-layer-type="layer" data-layer-name="Превью сжатия r=4" style="">`;
for (const dstr of districts) {
  const s = shrinkRing(dstr.pts, 4, { finalSmooth: 0.6 });
  layer += `<path data-kind="preview" data-label="${dstr.name}" style="fill:none;stroke:#f90;stroke-width:1.4" d="${fmt(s)}" />`;
}
layer += "</g>";

const idx = svg.lastIndexOf("</svg>");
svg = svg.slice(0, idx) + layer + "\n" + svg.slice(idx);
writeFileSync(SVG, svg);
console.log("injected", districts.length, "districts into layer 6 (Превью сжатия r=4)");
