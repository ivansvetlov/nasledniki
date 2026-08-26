import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resampleRing, shrinkRing, detectThin, catmullRomRing } from "./spline_core.mjs";

const DIR = new URL("../accounts/01601a7495be1aed/maps/samara/", import.meta.url);
const svg = readFileSync(new URL("map.svg", DIR), "utf-8");
function parsePts(d){const out=[],re=/([+-]?\d+\.?\d*),([+-]?\d+\.?\d*)/g;let m;while((m=re.exec(d)))out.push([parseFloat(m[1]),parseFloat(m[2])]);return out;}
let cur=null;const districts=[],volga=[];const gRe=/<g\b[^>]*data-layer-id="(\d+)"[^>]*>|<path\b[^>]*?>/g;let mt;
while((mt=gRe.exec(svg))){const t=mt[0];if(t.startsWith("<g")){cur=mt[1];continue;}
  const d=t.match(/\bd="([^"]*)"/);if(!d)continue;const pts=parsePts(d[1]);if(pts.length<3)continue;
  if(cur==="1"){const nm=t.match(/data-name="([^"]*)"/);districts.push({name:nm?nm[1]:"",pts});}
  else if(cur==="3")volga.push(pts);}
const markerM=svg.match(/<path\b[^>]*data-oid="m3"[^>]*\bd="([^"]*)"/);const marker=markerM?parsePts(markerM[1]):null;
const DATA={districts,volga,marker};

function fmt(pts){return "M"+pts.map(p=>p[0].toFixed(1)+","+p[1].toFixed(1)).join(" L")+" Z";}
const r0=6,r=4,ten=0.8;
let s="",noFill=0,flood=[];
for(const d of DATA.districts){
  s+=`<path d="${fmt(d.pts)}" fill="none" stroke="#666" stroke-width="0.8"/>`;
  const ring=resampleRing(d.pts,3);const thin=detectThin(d.pts,r0);
  const tf=thin.filter(Boolean).length; if(tf===thin.length) flood.push(d.name+" (все "+tf+")");
  for(let i=0;i<ring.length;i++)if(thin[i]){const a=ring[i],b=ring[(i+1)%ring.length];s+=`<line x1="${a[0].toFixed(1)}" y1="${a[1].toFixed(1)}" x2="${b[0].toFixed(1)}" y2="${b[1].toFixed(1)}" stroke="#f33" stroke-width="2.4"/>`;}
  const sh=shrinkRing(d.pts,r,{finalSmooth:ten});
  s+=`<path d="${fmt(sh)}" fill="none" stroke="#f90" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"/>`;
}
if(marker)s+=`<path d="${fmt(marker)}" fill="none" stroke="#f0f" stroke-width="1.6"/>`;
for(const vl of volga)s+=`<path d="${fmt(vl)}" fill="none" stroke="#39f" stroke-width="1"/>`;

console.log("NaN in output:", /NaN/.test(s));
console.log("paths without fill='none':", (s.match(/<path(?![^>]*fill="none")/g)||[]).length, (s.match(/<line(?![^>]*fill="none")/g)||[]).length);
console.log("flooded districts (все точки тонкие):", flood.length?flood.join(", "):"нет");
console.log("sample shrink pt counts:", DATA.districts.slice(0,3).map(d=>shrinkRing(d.pts,r,{finalSmooth:ten}).length));
