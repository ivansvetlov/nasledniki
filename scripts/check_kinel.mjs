import { readFileSync } from "node:fs";
const svg = readFileSync(new URL("../accounts/01601a7495be1aed/maps/samara/map.svg", import.meta.url), "utf-8");
function parsePts(d){const out=[],re=/([+-]?\d+\.?\d*),([+-]?\d+\.?\d*)/g;let m;while((m=re.exec(d)))out.push([parseFloat(m[1]),parseFloat(m[2])]);return out;}
let cur=null,kin=null;
const g=svg.match(/<g\b[^>]*data-layer-id="(\d+)"[^>]*>|<path\b[^>]*?>/g);
for(const t of g){if(t.startsWith("<g")){cur=t.match(/data-layer-id="(\d+)"/)[1];continue;}
  const d=t.match(/\bd="([^"]*)"/);if(!d)continue;const p=parsePts(d[1]);if(p.length<3)continue;
  if(cur==="1"&&(t.match(/data-name="([^"]*)"/)||[])[1]==="Кинельский район"){kin=p;}}
if(!kin){console.log("Кинельский не найден");process.exit(0);}
console.log("points:",kin.length);
let xs=kin.map(p=>p[0]),ys=kin.map(p=>p[1]);
console.log("x:[",Math.min(...xs),",",Math.max(...xs),"] y:[",Math.min(...ys),",",Math.max(...ys),"]");
// centroid
const cx=xs.reduce((a,b)=>a+b)/xs.length, cy=ys.reduce((a,b)=>a+b)/ys.length;
let maxd=0,mi=0;
kin.forEach((p,i)=>{const dd=Math.hypot(p[0]-cx,p[1]-cy);if(dd>maxd){maxd=dd;mi=i;}});
console.log("centroid",cx.toFixed(1),cy.toFixed(1),"maxDist",maxd.toFixed(1),"at idx",mi,"pt",kin[mi]);
// дубликаты подряд
let dup=0;for(let i=0;i<kin.length;i++){const a=kin[i],b=kin[(i+1)%kin.length];if(a[0]===b[0]&&a[1]===b[1])dup++;}
console.log("dup-consecutive:",dup);
