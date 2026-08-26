import { readFileSync } from "node:fs";
import { resampleRing, shrinkRing, detectThin, polygonArea } from "./spline_core.mjs";
const svg = readFileSync(new URL("../accounts/01601a7495be1aed/maps/samara/map.svg", import.meta.url), "utf-8");
function parsePts(d){const out=[],re=/([+-]?\d+\.?\d*),([+-]?\d+\.?\d*)/g;let m;while((m=re.exec(d)))out.push([parseFloat(m[1]),parseFloat(m[2])]);return out;}
let cur=null;const ds=[];
const g=svg.match(/<g\b[^>]*data-layer-id="(\d+)"[^>]*>|<path\b[^>]*?>/g);
for(const t of g){if(t.startsWith("<g")){cur=t.match(/data-layer-id="(\d+)"/)[1];continue;}
  const d=t.match(/\bd="([^"]*)"/);if(!d)continue;const p=parsePts(d[1]);if(p.length<3)continue;
  if(cur==="1")ds.push({n:(t.match(/data-name="([^"]*)"/)||[])[1]||"?",p});}
for(const d of ds){
  const subpaths=(d.p.map(()=>0), (d.p.join("|").match(/M/g)||[]).length || 1);
  const area=Math.abs(polygonArea(d.p));
  const ring=resampleRing(d.p,3);
  const thin=detectThin(d.p,6);
  const frac=(thin.filter(Boolean).length/ring.length*100).toFixed(0);
  const sh=shrinkRing(d.p,4,{finalSmooth:0.8});
  const empties=sh.length===0;
  console.log(d.n.padEnd(22), "area="+area.toFixed(0).padStart(8), "thin%="+frac.padStart(3), empties?"SHRINK_EMPTY":"shrinkOK", "subpaths="+subpaths);
}
