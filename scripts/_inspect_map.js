const fs = require("fs");
const s = fs.readFileSync("accounts/01601a7495be1aed/maps/samara/map.svg", "utf8");
const layers = [...s.matchAll(/<g\s+([^>]*data-layer-id[^>]*)>/g)].map(m => {
  const id = (m[1].match(/data-layer-id="([^"]*)"/) || [])[1];
  const name = (m[1].match(/data-layer-name="([^"]*)"/) || [])[1];
  const type = (m[1].match(/data-layer-type="([^"]*)"/) || [])[1];
  return { id, name, type };
});
console.log("LAYERS:", JSON.stringify(layers));
const paths = [...s.matchAll(/<path\s+([^>]*data-name="([^"]*)"[^>]*?)\/?>/g)].map(m => ({ name: m[2], attrs: m[1].slice(0, 300) }));
console.log("PATHS with data-name:", paths.length);
paths.filter(p => p.name && p.name.indexOf("Кинел") >= 0).forEach(p => console.log("KIN:", p.attrs));
const body = s.replace(/^[\s\S]*?<svg[^>]*>/, "");
const beforeFirstLayer = body.split(/<g\s+[^>]*data-layer-id/)[0];
const floating = (beforeFirstLayer.match(/<path/g) || []).length;
console.log("FLOATING paths before any layer group:", floating);
const black = [...s.matchAll(/<path\s+[^>]*data-name="([^"]*)"[^>]*fill="(black|#000(?:000)?|rgb\(0,\s*0,\s*0\))"[^>]*>/gi)].map(m => m[1]);
console.log("BLACK-filled districts:", JSON.stringify(black));
