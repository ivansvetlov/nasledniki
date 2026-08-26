import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resampleRing, shrinkRing, detectThin } from "./spline_core.mjs";

const MAP = new URL("../accounts/01601a7495be1aed/maps/samara/", import.meta.url);
const svg = readFileSync(new URL("map.svg", MAP), "utf-8");

function parsePts(d) {
  const out = [], re = /([+-]?\d+\.?\d*),([+-]?\d+\.?\d*)/g;
  let m; while ((m = re.exec(d))) out.push([parseFloat(m[1]), parseFloat(m[2])]);
  return out;
}
let cur = null;
const districts = [], volga = [];
const gRe = /<g\b[^>]*data-layer-id="(\d+)"[^>]*>|<path\b[^>]*?>/g;
let mt;
while ((mt = gRe.exec(svg))) {
  const t = mt[0];
  if (t.startsWith("<g")) { cur = mt[1]; continue; }
  const d = t.match(/\bd="([^"]*)"/); if (!d) continue;
  const pts = parsePts(d[1]); if (pts.length < 3) continue;
  if (cur === "1") { const nm = t.match(/data-name="([^"]*)"/); districts.push({ name: nm ? nm[1] : "", pts }); }
  else if (cur === "3") volga.push(pts);
}
const markerM = svg.match(/<path\b[^>]*data-oid="m3"[^>]*\bd="([^"]*)"/);
const marker = markerM ? parsePts(markerM[1]) : null;
const DATA = { districts, volga, marker };

// Clipper lib — обязательно с защитой module.exports (иначе падает в браузере)
let clipper = "";
for (const p of ["node_modules/js-clipper/clipper.js"]) {
  const u = new URL("../" + p, import.meta.url);
  if (existsSync(u)) { clipper = readFileSync(u, "utf-8"); break; }
}
if (!clipper) { console.error("CLIPPER НЕ НАЙДЕН"); process.exit(1); }
clipper = clipper.replace(/module\.exports = ClipperLib;/g,
  'if (typeof module !== "undefined") module.exports = ClipperLib;');
if (!/typeof module !== "undefined"\) module\.exports/.test(clipper)) {
  console.error("ОШИБКА: защита module.exports не применилась"); process.exit(1);
}

let tpl = readFileSync(new URL("debug_template.html", import.meta.url), "utf-8");
tpl = tpl.replace("__CLIPPER__", clipper).replace("__DATA__", JSON.stringify(DATA));
if (tpl.includes("__CLIPPER__") || tpl.includes("__DATA__")) {
  console.error("ОШИБКА: остались плейсхолдеры"); process.exit(1);
}
writeFileSync(new URL("../debug_shrink.html", import.meta.url), tpl);
console.log("html: districts=" + districts.length + " volga=" + volga.length + " marker=" + (marker ? marker.length : 0));

// --- статический SVG-превью (открывается без сервера) с дефолтными параметрами ---
const R0 = 6, R = 4, TEN = 0.8;
function fmt(pts) { if (!pts || pts.length < 2) return ""; return "M" + pts.map(p => p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" L") + " Z"; }
function fmtC(pts) { if (!pts || pts.length < 3) return fmt(pts); const n = pts.length; let d = "M" + pts[0][0].toFixed(1) + "," + pts[0][1].toFixed(1); for (let i = 0; i < n; i++) { const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n]; const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6; const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6; d += " C" + c1x.toFixed(1) + "," + c1y.toFixed(1) + " " + c2x.toFixed(1) + "," + c2y.toFixed(1) + " " + p2[0].toFixed(1) + "," + p2[1].toFixed(1); } return d + " Z"; }
let a = [1e9, 1e9, -1e9, -1e9];
for (const d of districts) for (const p of d.pts) { a[0] = Math.min(a[0], p[0]); a[1] = Math.min(a[1], p[1]); a[2] = Math.max(a[2], p[0]); a[3] = Math.max(a[3], p[1]); }
for (const vl of volga) for (const p of vl) { a[0] = Math.min(a[0], p[0]); a[1] = Math.min(a[1], p[1]); a[2] = Math.max(a[2], p[0]); a[3] = Math.max(a[3], p[1]); }
let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${a[0] - 30} ${a[1] - 30} ${a[2] - a[0] + 60} ${a[3] - a[1] + 60}" style="background:#15151a">`;
for (const d of districts) s += `<path d="${fmt(d.pts)}" fill="#26262c" stroke="#888" stroke-width="0.8"/>`;
for (const vl of volga) s += `<path d="${fmt(vl)}" fill="#1d3a5a" stroke="#39f" stroke-width="1"/>`;
let flagged = 0, empties = 0;
for (const d of districts) {
  const ring = resampleRing(d.pts, 3), thin = detectThin(d.pts, R0);
  for (let i = 0; i < ring.length; i++) if (thin[i]) { flagged++; const b = ring[(i + 1) % ring.length]; s += `<line x1="${ring[i][0].toFixed(1)}" y1="${ring[i][1].toFixed(1)}" x2="${b[0].toFixed(1)}" y2="${b[1].toFixed(1)}" stroke="#f33" stroke-width="2.4"/>`; }
  const sh = shrinkRing(d.pts, R, { finalSmooth: TEN });
  if (sh.length) s += `<path d="${fmtC(sh)}" fill="none" stroke="#f90" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"/>`;
  else empties++;
}
if (marker) s += `<path d="${fmt(marker)}" fill="none" stroke="#f0f" stroke-width="1.6"/>`;
s += "</svg>";
if (/NaN/.test(s)) { console.error("ОШИБКА: NaN в превью"); process.exit(1); }
const previewDir = new URL("../previews/", import.meta.url);
try { mkdirSync(previewDir, { recursive: true }); } catch (_) {}
writeFileSync(new URL("debug_preview.svg", previewDir), s);
console.log("svg-preview: flagged=" + flagged + " emptyShrink=" + empties + " (NaN: нет)");
console.log("OK: debug_shrink.html + previews/debug_preview.svg");
