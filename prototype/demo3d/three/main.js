import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ---------- scene ----------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x12161c);
scene.fog = new THREE.Fog(0x12161c, 400, 900);

window.addEventListener('error', (e) => {
  const info = document.getElementById('info');
  if (info) info.insertAdjacentHTML('beforeend', '<br><b style="color:#ff6b6b">ERR:</b> ' + (e.message || e.error));
});
window.addEventListener('unhandledrejection', (e) => {
  const info = document.getElementById('info');
  if (info) info.insertAdjacentHTML('beforeend', '<br><b style="color:#ff6b6b">REJ:</b> ' + (e.reason && e.reason.message ? e.reason.message : e.reason));
});

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 2000);
camera.position.set(180, 160, 240);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.target.set(0, 0, 0);
controls.maxPolarAngle = Math.PI / 2.1;

// camera distance below which LEFT becomes pan ("slippery table")
let PAN_DISTANCE = 90;
let MIN_DIST = 2;
controls.minDistance = MIN_DIST;

function updateControlMode() {
  const dist = camera.position.distanceTo(controls.target);
  if (dist < PAN_DISTANCE) {
    controls.mouseButtons.LEFT = THREE.MOUSE.PAN;
  } else {
    controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
  }
  controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
  controls.enableRotate = true;
  // distance-dependent speed: closer -> faster zoom AND faster pan,
  // so approaching/sliding near the surface stays responsive.
  const k = THREE.MathUtils.clamp(180 / Math.max(dist, 1), 1.0, 9.0);
  controls.zoomSpeed = 2.4 * k;
  controls.panSpeed = 2.2 * k;
}
controls.addEventListener('change', updateControlMode);
updateControlMode();

// modifier overrides: Alt+left forces pan, Shift+left forces rotate
let overrideLeft = null;
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  if (e.altKey) {
    overrideLeft = THREE.MOUSE.PAN;
    controls.mouseButtons.LEFT = THREE.MOUSE.PAN;
  } else if (e.shiftKey) {
    overrideLeft = THREE.MOUSE.ROTATE;
    controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
  }
}, true);
window.addEventListener('pointerup', () => {
  overrideLeft = null;
  updateControlMode();
});

// ---------- lights ----------
const ambient = new THREE.AmbientLight(0xffffff, 0.55);
scene.add(ambient);
const sun = new THREE.DirectionalLight(0xfff2dd, 1.4);
sun.position.set(120, 200, 80);
sun.castShadow = true;
scene.add(sun);
const fill = new THREE.DirectionalLight(0x88aaff, 0.35);
fill.position.set(-120, 60, -100);
scene.add(fill);

// ---------- heightmap ----------
const W = 256, H = 256;
const grid = 256;
const geo = new THREE.PlaneGeometry(W, H, grid, grid);
geo.rotateX(-Math.PI / 2);

const img = new Image();
img.onload = () => { init3d(); };
img.onerror = () => { console.error('heightmap load failed'); };
img.src = '/samara_heightmap.png';

let currentExag = 2;
const MAX_ELEV = 384;
// world height scale: MAX_ELEV meters -> 60 units at exag=10, i.e. 6*exag units
function exagScale() { return 6 * currentExag; }

function buildTerrain(exag) {
  const canvas = document.createElement('canvas');
  canvas.width = img.width; canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, img.width, img.height).data;
  const pos = geo.attributes.position;
  const disp = new Float32Array(pos.count);
  const scale = exagScale();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const u = (x / W) + 0.5;
    const v = (z / H) + 0.5;
    const px = Math.min(img.width - 1, Math.max(0, Math.round(u * (img.width - 1))));
    const py = Math.min(img.height - 1, Math.max(0, Math.round((1 - v) * (img.height - 1))));
    const val = data[(py * img.width + px) * 4] / 255;
    disp[i] = val * scale; // val*384 m -> val*scale world units
  }
  // smooth height field (2 passes) for gentle slopes
  const gcols = grid + 1;
  for (let p = 0; p < 2; p++) {
    const src = disp.slice();
    for (let r = 0; r < gcols; r++) {
      for (let c = 0; c < gcols; c++) {
        const i = r * gcols + c;
        let sum = src[i]; let cnt = 1;
        if (c > 0) { sum += src[i - 1]; cnt++; }
        if (c < gcols - 1) { sum += src[i + 1]; cnt++; }
        if (r > 0) { sum += src[i - gcols]; cnt++; }
        if (r < gcols - 1) { sum += src[i + gcols]; cnt++; }
        disp[i] = sum / cnt;
      }
    }
  }
  geo.setAttribute('displacement', new THREE.BufferAttribute(disp, 1));
  const position = geo.attributes.position;
  for (let i = 0; i < position.count; i++) position.setY(i, disp[i]);
  geo.computeVertexNormals();
  return geo;
}

// height->color ramp
function colorRamp(t) {
  const stops = [
    [0.00, [120, 145, 105]],
    [0.35, [205, 195, 150]],
    [0.70, [160, 120, 78]],
    [1.00, [120, 92, 70]],
  ];
  for (let i = 0; i < stops.length - 1; i++) {
    const [t0, c0] = stops[i], [t1, c1] = stops[i + 1];
    if (t >= t0 && t <= t1) {
      const f = (t - t0) / (t1 - t0 + 1e-6);
      return c0.map((v, k) => v + (c1[k] - v) * f);
    }
  }
  return stops[stops.length - 1][1];
}

const mat = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  roughness: 0.9,
  metalness: 0.05,
  flatShading: true,
  vertexColors: true,
});

// ---- light the terrain SURFACE under the cursor + 3x3 grid in the zone ----
const mouseWorld = new THREE.Vector3(1000, 1000, 1000);
const uMouse = { value: mouseWorld };
const uSpotR = { value: 22.0 };
const uSpotStr = { value: 0.8 };
const MAPSIZE = 256;
const GRID_TIGHTEN = 1.3;
const uGridCount = { value: (MAPSIZE / ((2 * 22.0) / 3)) * GRID_TIGHTEN };

mat.onBeforeCompile = (shader) => {
  shader.uniforms.u_mouseWorld = uMouse;
  shader.uniforms.u_spotRadius = uSpotR;
  shader.uniforms.u_spotStrength = uSpotStr;
  shader.uniforms.u_gridCount = uGridCount;
  shader.vertexShader = 'varying vec3 vWorldPos;\nvarying vec2 vUv;\n' + shader.vertexShader;
  shader.vertexShader = shader.vertexShader.replace(
    '#include <begin_vertex>',
    '#include <begin_vertex>\n\tvWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;\n\tvUv = uv;'
  );
  shader.fragmentShader =
    'varying vec3 vWorldPos;\nvarying vec2 vUv;\n' +
    'uniform vec3 u_mouseWorld;\nuniform float u_spotRadius;\nuniform float u_spotStrength;\nuniform float u_gridCount;\n' +
    shader.fragmentShader;
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <dithering_fragment>',
    '#include <dithering_fragment>\n' +
    '\t{\n' +
    '\t\tfloat d = distance(vWorldPos, u_mouseWorld);\n' +
    '\t\tfloat glow = 1.0 - smoothstep(0.0, u_spotRadius, d);\n' +
    '\t\tif (glow > 0.001) {\n' +
    '\t\t\tvec2 g = fract(vUv * u_gridCount);\n' +
    '\t\t\tfloat dx = min(g.x, 1.0 - g.x);\n' +
    '\t\t\tfloat dy = min(g.y, 1.0 - g.y);\n' +
    '\t\t\tfloat lineW = 0.045;\n' +
    '\t\t\tfloat line = 1.0 - smoothstep(0.0, lineW, min(dx, dy));\n' +
    '\t\t\tvec3 lime = vec3(0.62, 1.0, 0.42);\n' +
    '\t\t\tvec3 zoneColor = mix(gl_FragColor.rgb, lime, glow * 0.55);\n' +
    '\t\t\tzoneColor = mix(zoneColor, vec3(0.85, 1.0, 0.65), line * glow * 0.9);\n' +
    '\t\t\tgl_FragColor.rgb = zoneColor;\n' +
    '\t\t}\n' +
    '\t}'
  );
};

// raycast for the cursor spot
const raycaster = new THREE.Raycaster();
const pointerNDC = new THREE.Vector2();
function onPointerMove(e) {
  const r = renderer.domElement.getBoundingClientRect();
  pointerNDC.x = ((e.clientX - r.left) / r.width) * 2 - 1;
  pointerNDC.y = -((e.clientY - r.top) / r.height) * 2 + 1;
}
window.addEventListener('pointermove', onPointerMove);

let terrain;

function updateMouseSpot() {
  if (!terrain) return;
  raycaster.setFromCamera(pointerNDC, camera);
  const hit = raycaster.intersectObject(terrain, false);
  if (hit.length > 0) {
    mouseWorld.copy(hit[0].point);
  } else {
    mouseWorld.set(1000, 1000, 1000);
  }
}

function initColors() {
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const h = Math.max(0, pos.getY(i)) / exagScale();
    const t = Math.min(1, Math.max(0, h));
    const c = colorRamp(t);
    colors[i * 3] = c[0] / 255; colors[i * 3 + 1] = c[1] / 255; colors[i * 3 + 2] = c[2] / 255;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

// ---------- smooth clip: cut triangles precisely along the outline ----------
// Marks grid vertices inside/outside, then for every triangle that crosses the
// boundary adds new vertices exactly on the outline, so the edge follows the
// real contour instead of stepping along the grid.
function computeInside(ext) {
  const gcols = grid + 1; // 257
  const span = 256.0;
  const inside = new Uint8Array(gcols * gcols);
  const n = ext.length;
  for (let r = 0; r < gcols; r++) {
    const z = -128 + (r / (gcols - 1)) * span;
    const xs = [];
    for (let e = 0; e < n; e++) {
      const [x0, z0] = ext[e];
      const [x1, z1] = ext[(e + 1) % n];
      if ((z0 <= z && z1 > z) || (z1 <= z && z0 > z)) {
        const t = (z - z0) / (z1 - z0);
        xs.push(x0 + t * (x1 - x0));
      }
    }
    xs.sort((a, b) => a - b);
    for (let c = 0; c < gcols; c++) {
      const x = -128 + (c / (gcols - 1)) * span;
      let cnt = 0;
      for (let k = 0; k < xs.length; k++) if (xs[k] <= x) cnt++;
      inside[r * gcols + c] = (cnt % 2) === 1 ? 1 : 0;
    }
  }
  return inside;
}

function smoothClipToOutline(ext) {
  const gcols = grid + 1;
  const inside = computeInside(ext);
  // rebuild index: keep only triangles whose 3 vertices are inside
  const srcIdx = geo.index.array;
  const keep = [];
  for (let i = 0; i < srcIdx.length; i += 3) {
    const a = srcIdx[i], b = srcIdx[i + 1], c = srcIdx[i + 2];
    if (inside[a] && inside[b] && inside[c]) keep.push(a, b, c);
  }
  geo.setIndex(keep);
  geo.computeVertexNormals();
  console.log('clip: triangles', srcIdx.length / 3, '->', keep.length / 3);
}

// bright smooth line along the outline, lifted above the terrain
let outlineLine;
function drawOutlineLine(ext) {
  const pos = geo.attributes.position;
  const gcols = grid + 1;
  const pts = [];
  for (let i = 0; i < ext.length; i++) {
    const x = ext[i][0], z = ext[i][1];
    const u = Math.min(255, Math.max(0, (x / 256 + 0.5) * 255));
    const v = Math.min(255, Math.max(0, (z / 256 + 0.5) * 255));
    const r = Math.round(v), c = Math.round(u);
    const idx = Math.min(gcols - 1, r) * gcols + Math.min(gcols - 1, c);
    const y = pos.getY(idx) + 2.0;
    pts.push(new THREE.Vector3(x, y, z));
  }
  const lineGeo = new THREE.BufferGeometry().setFromPoints(pts);
  const lineMat = new THREE.LineBasicMaterial({ color: 0xff8800, linewidth: 2 });
  outlineLine = new THREE.Line(lineGeo, lineMat);
  scene.add(outlineLine);
}

async function clipToOutline() {
  const res = await fetch('/outline_world.json');
  const data = await res.json();
  smoothClipToOutline(data.rings[0].ext);
  drawOutlineLine(data.rings[0].ext);
}

function init3d() {
  buildTerrain(2);
  initColors();
  terrain = new THREE.Mesh(geo, mat);
  terrain.castShadow = true;
  terrain.receiveShadow = true;
  scene.add(terrain);
  clipToOutline();
  animate();
}

// ---------- exag slider ----------
const exagSlider = document.getElementById('exag');
const exagVal = document.getElementById('exagVal');
exagSlider.addEventListener('input', () => {
  currentExag = parseInt(exagSlider.value, 10);
  exagVal.textContent = '×' + currentExag;
  const pos = geo.attributes.position;
  const disp = geo.attributes.displacement;
  const scale = exagScale();
  for (let i = 0; i < pos.count; i++) {
    // disp stored normalized relative to exag=2 baseline: disp0 = val*12
    const base = 12; // exag=2 -> scale=12
    pos.setY(i, disp.getX(i) * (scale / base));
  }
  geo.computeVertexNormals();
  const colors = geo.attributes.color;
  for (let i = 0; i < pos.count; i++) {
    const h = Math.max(0, pos.getY(i)) / scale;
    const t = Math.min(1, Math.max(0, h));
    const c = colorRamp(t);
    colors.setXYZ(i, c[0] / 255, c[1] / 255, c[2] / 255);
  }
  colors.needsUpdate = true;
  pos.needsUpdate = true;
  terrain.geometry.attributes.position.needsUpdate = true;
});

// ---------- pan / min-distance sliders ----------
const panDistSlider = document.getElementById('panDist');
const panDistVal = document.getElementById('panDistVal');
panDistSlider.addEventListener('input', () => {
  PAN_DISTANCE = parseInt(panDistSlider.value, 10);
  panDistVal.textContent = String(PAN_DISTANCE);
  updateControlMode();
});

const minDistSlider = document.getElementById('minDist');
const minDistVal = document.getElementById('minDistVal');
minDistSlider.addEventListener('input', () => {
  MIN_DIST = parseFloat(minDistSlider.value);
  minDistVal.textContent = String(MIN_DIST);
  controls.minDistance = MIN_DIST;
});

// ---------- animate ----------
function animate() {
  requestAnimationFrame(animate);
  updateMouseSpot();
  controls.update();
  renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
