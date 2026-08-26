import { readFileSync } from "node:fs";
import { shrinkRing } from "./spline_core.mjs";
const svg = readFileSync(new URL("../accounts/01601a7495be1aed/maps/samara/map.svg", import.meta.url), "utf-8");
function parsePts(d){const out=[],re=/([+-]?\d+\.?\d*),([+-]?\d+\.?\d*)/g;let m;while((m=re.exec(d)))out.push([parseFloat(m[1]),parseFloat(m[2])]);return out;}
let cur=null;const ds=[];
const g=svg.match(/<g\b[^>]*data-layer-id="(\d+)"[^>]*>|<path\b[^>]*?>/g);
for(const t of g){if(t.startsWith("<g")){cur=t.match(/data-layer-id="(\d+)"/)[1];continue;}
  const d=t.match(/\bd="([^"]*)"/);if(!d)continue;const p=parsePts(d[1]);if(p.length<3)continue;
  if(cur==="1")ds.push({n:(t.match(/data-name="([^"]*)"/)||[])[1]||"?",p});}
for(const r of [2,4,6,8]){
  const empty=ds.filter(d=>!shrinkRing(d.p,r,{}).length).map(d=>d.n);
  console.log("r="+r+" пустых сжатий:", empty.length?empty.join(", "):"нет");
}
