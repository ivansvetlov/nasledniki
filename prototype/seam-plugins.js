/* Каталог плагинов стыка. Каждый шаг — узел: вкл / порядок / дубль / свои ручки.
   Вход world = стилизованные районы компрессора. Выход — live с зазором. */
(function () {
  var S, C, Cn;
  var TYPES = {
    correspond: { title: 'Соответствие', help: 'tol', params: ['tol', 'minRun'] },
    maskCoast: { title: 'Маска берега', help: 'tol', params: [] },
    maskAnchors: { title: 'Якоря шва', help: 'endPad', params: ['endPad'] },
    turnGate: { title: 'Затвор поворота', help: 'turnDeg', params: ['turnDeg', 'turnPow'] },
    neighborTurn: { title: 'Поворот соседа', help: 'turnDeg', params: ['turnDeg', 'turnPow'] },
    lockBand: { title: 'Замок ленты', help: 'lock', params: ['target', 'lock'] },
    hysteresis: { title: 'Гистерезис замка', help: 'lock', params: ['lock'] },
    maxStep: { title: 'Потолок шага', help: 'maxStep', params: ['maxStep'] },
    gapSpring: { title: 'Пружина зазора', help: 'target', params: ['target', 'lock', 'springK', 'share', 'springIters', 'maxStep'] },
    overlapCut: { title: 'Резка перекрытия', help: 'overlapBoost', params: ['overlapBoost', 'springK'] },
    inflateFar: { title: 'Добор дали', help: 'springK', params: ['target', 'springK'] },
    slideNormal: { title: 'Только нормаль', help: 'share', params: [] },
    gapEqualize: { title: 'Выровнять зазор', help: 'eqAmt', params: ['eqAmt'] },
    seamSmooth: { title: 'Сгладить шов', help: 'smoothAmt', params: ['smoothAmt'] },
    seamFillet: { title: 'Фаска шва', help: 'cAngle', params: ['cAngle', 'splT', 'cSpeed'] },
    seamRound: { title: 'Лаплас шва', help: 'smoothAmt', params: ['smoothAmt'] },
    seamSpline: { title: 'Сплайн шва', help: 'splineTen', params: ['splineTen', 'splineStep'] },
    tripleDetect: { title: 'Найти тройники', help: 'tol', params: ['tol'] },
    tripleSocket: { title: 'Карман тройника', help: 'pocket', params: ['target', 'pocket'] },
    preserve: { title: 'Верность стилю', help: 'preserve', params: ['preserve'] },
    areaKeep: { title: 'Площадь', help: 'areaMix', params: ['areaMix'] },
    unpinch: { title: 'Антизащемление', help: 'antiPinch', params: ['antiPinch'] },
    untangle: { title: 'Петли', help: 'loopMode', params: [] },
    clampAngle: { title: 'Мин. угол', help: 'minAngle', params: ['minAngle'] }
  };
  var FALLBACK = {
    tol: 22, minRun: 3, endPad: 2, turnDeg: 28, turnPow: 1,
    target: 5, lock: 0.35, springK: 0.35, share: 0.5, springIters: 6, maxStep: 2.2,
    overlapBoost: 1.6, eqAmt: 0.3, smoothAmt: 0.22, pocket: 0.45,
    preserve: 0.12, areaMix: 0.25, antiPinch: 8, minAngle: 12,
    cAngle: 50, splT: 1, cSpeed: 4, splineTen: 0.7, splineStep: 2
  };
  var DEFAULT_STACK = [
    { type: 'correspond', on: true },
    { type: 'maskCoast', on: true },
    { type: 'turnGate', on: true },
    { type: 'neighborTurn', on: true },
    { type: 'lockBand', on: true },
    { type: 'gapSpring', on: true },
    { type: 'overlapCut', on: true },
    { type: 'hysteresis', on: true },
    { type: 'gapEqualize', on: true },
    { type: 'tripleDetect', on: true },
    { type: 'tripleSocket', on: true },
    { type: 'seamSmooth', on: true },
    { type: 'seamFillet', on: false },
    { type: 'preserve', on: true },
    { type: 'untangle', on: true },
    { type: 'maskAnchors', on: false },
    { type: 'maxStep', on: false },
    { type: 'inflateFar', on: false },
    { type: 'slideNormal', on: false },
    { type: 'seamRound', on: false },
    { type: 'seamSpline', on: false },
    { type: 'areaKeep', on: false },
    { type: 'unpinch', on: false },
    { type: 'clampAngle', on: false }
  ];
  var KEY = 'seam_stack_v1';
  var STACK = [];
  var selected = 0;

  function uid() { return 's' + Math.random().toString(36).slice(2, 8); }
  function val(id, fb) {
    var el = document.getElementById(id);
    if (!el) return fb;
    if (el.tagName === 'SELECT') return el.value;
    return +el.value;
  }
  function pval(step, key, fb) {
    if (step && step.params && step.params[key] != null && step.params[key] !== '') return step.params[key];
    return val(key, fb != null ? fb : FALLBACK[key]);
  }
  function snapshot(type, src) {
    var meta = TYPES[type] || { params: [] };
    var o = {};
    (meta.params || []).forEach(function (id) {
      o[id] = src && src[id] != null ? src[id] : FALLBACK[id];
    });
    return o;
  }
  function normalize(s) {
    return {
      id: s.id || uid(), type: s.type, on: s.on !== false,
      params: s.params && typeof s.params === 'object' ? Object.assign(snapshot(s.type), s.params) : snapshot(s.type)
    };
  }
  function load() {
    STACK.length = 0;
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) {
        var arr = JSON.parse(raw);
        if (Array.isArray(arr) && arr.length) arr.forEach(function (s) { if (TYPES[s.type]) STACK.push(normalize(s)); });
      }
    } catch (e) {}
    if (!STACK.length) DEFAULT_STACK.forEach(function (s) { STACK.push(normalize(s)); });
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(STACK)); } catch (e) {} }

  function boot() {
    S = window.Seams; C = window.Compressor; Cn = window.Corners;
  }

  function applyTurnWeights(world, minDeg, pow, neighbor) {
    S.ensureWeights(world);
    S.markFacing(world, 28);
    world.districts.forEach(function (d) {
      var i, mag, w;
      for (i = 0; i < d.live.length; i++) {
        if (d.facing && !d.facing[i]) continue;
        mag = S.turnMag(d.live, i);
        w = mag < minDeg ? 0.15 : Math.pow(Math.min(1, (mag - minDeg) / 60), pow);
        if (neighbor) {
          /* вес уже стоит — умножим ещё, если сосед тоже крутой: проверяется в spring через facing */
          d.w[i] *= (0.4 + 0.6 * w);
        } else d.w[i] *= w;
      }
    });
  }

  function runStep(step, world) {
    if (!step.on || !world) return world;
    boot();
    var p = function (k, fb) { return pval(step, k, fb); };
    switch (step.type) {
      case 'correspond':
        S.markFacing(world, p('tol', 22));
        break;
      case 'maskCoast':
        S.ensureWeights(world);
        S.markFacing(world, 28);
        world.districts.forEach(function (d) {
          var i;
          for (i = 0; i < d.live.length; i++) if (!d.facing[i]) d.w[i] = 0;
        });
        break;
      case 'maskAnchors': {
        S.markFacing(world, 28);
        var pad = p('endPad', 2) | 0;
        world.pairs.forEach(function (pr) {
          (pr.runsA || []).forEach(function (run) {
            run.idx.slice(0, pad).concat(run.idx.slice(-pad)).forEach(function (i) {
              world.districts[pr.a].w[i] = 0;
              world.districts[pr.a].locked[i] = true;
            });
          });
        });
        break;
      }
      case 'turnGate':
        applyTurnWeights(world, p('turnDeg', 28), p('turnPow', 1), false);
        break;
      case 'neighborTurn':
        applyTurnWeights(world, p('turnDeg', 28), p('turnPow', 1), true);
        break;
      case 'lockBand': {
        S.ensureWeights(world);
        var tgt = p('target', 5), lock = p('lock', 0.35);
        world.pairs.forEach(function (pr) {
          var A = world.districts[pr.a], B = world.districts[pr.b], i, g;
          for (i = 0; i < A.live.length; i++) {
            if (!pr.faceA[i]) continue;
            g = S.signedGap(A.live[i], B.live);
            if (Math.abs(g - tgt) <= lock) { A.w[i] = 0; A.locked[i] = true; }
          }
          for (i = 0; i < B.live.length; i++) {
            if (!pr.faceB[i]) continue;
            g = S.signedGap(B.live[i], A.live);
            if (Math.abs(g - tgt) <= lock) { B.w[i] = 0; B.locked[i] = true; }
          }
        });
        break;
      }
      case 'hysteresis':
        /* spring сам ставит locked при hysteresis:true; здесь только держим нули */
        S.ensureWeights(world);
        world.districts.forEach(function (d) {
          var i; for (i = 0; i < d.live.length; i++) if (d.locked[i]) d.w[i] = 0;
        });
        break;
      case 'maxStep':
        world._maxStep = p('maxStep', 2.2);
        break;
      case 'gapSpring':
        world.target = p('target', 5);
        S.gapSpring(world, {
          target: p('target', 5), lock: p('lock', 0.35), k: p('springK', 0.35),
          share: p('share', 0.5), iters: p('springIters', 6) | 0,
          maxStep: world._maxStep || p('maxStep', 2.2),
          overlapBoost: p('overlapBoost', 1.6),
          hysteresis: true, slideNormal: false, tol: 28
        });
        break;
      case 'overlapCut':
        S.gapSpring(world, {
          target: p('target', 5), lock: 0, k: p('springK', 0.5),
          share: 0.5, iters: 3, maxStep: 3, overlapBoost: p('overlapBoost', 2.4),
          hysteresis: false, slideNormal: false, tol: 16
        });
        break;
      case 'inflateFar':
        S.gapSpring(world, {
          target: p('target', 5), lock: 0.5, k: p('springK', 0.25),
          share: 0.5, iters: 3, maxStep: 2, overlapBoost: 1,
          hysteresis: false, slideNormal: false, tol: 40
        });
        break;
      case 'slideNormal':
        world._slideNormal = true;
        break;
      case 'gapEqualize':
        S.gapEqualize(world, p('eqAmt', 0.3));
        break;
      case 'seamSmooth':
        S.seamSmooth(world, p('smoothAmt', 0.22));
        break;
      case 'seamFillet':
        world.districts.forEach(function (d) {
          d.live = Cn.smoothCorners(d.live, {
            speed: p('cSpeed', 4), tension: p('splT', 1), skew: 0, pulse: 0.5, bias: 0,
            angle: p('cAngle', 50), innerAngle: 0
          });
          d.w = null;
        });
        S.markFacing(world, 28);
        break;
      case 'seamRound':
        world.districts.forEach(function (d) {
          d.live = C.roundCorners(d.live, 1, p('smoothAmt', 0.22));
          d.w = null;
        });
        break;
      case 'seamSpline':
        world.districts.forEach(function (d) {
          d.live = C.catmullRomRing(d.live, p('splineTen', 0.7), p('splineStep', 2));
          d.w = null;
        });
        break;
      case 'tripleDetect':
        S.rebuildTriples(world);
        break;
      case 'tripleSocket':
        S.tripleSocket(world, { side: p('target', 5), k: p('pocket', 0.45) });
        break;
      case 'preserve':
        S.preserveStyled(world, p('preserve', 0.12));
        break;
      case 'areaKeep':
        S.areaKeep(world, p('areaMix', 0.25));
        break;
      case 'unpinch':
        world.districts.forEach(function (d) {
          var g = p('antiPinch', 8);
          if (g > 0) d.live = Cn.unpinch(d.live, g, { iters: 4, strength: 0.45, reach: 1, minArc: g * 1.5 });
        });
        break;
      case 'untangle':
        world.districts.forEach(function (d) {
          var xs = C.selfIntersections(d.live);
          if (xs.length) {
            var u = C.untangleRing(d.live, 'auto', { relaxIters: 8, relaxAmt: 0.45, win: 6, smoothWin: 8 });
            d.live = u.ring;
          }
        });
        break;
      case 'clampAngle':
        world.districts.forEach(function (d) {
          d.live = Cn.clampMinAngle(d.live, p('minAngle', 12), 16, { inner: true });
        });
        break;
    }
    return world;
  }

  function run(world) {
    boot();
    world.districts.forEach(function (d) {
      d.live = S.cloneRing(d.styled);
      d.w = null; d.locked = null; d.facing = null;
    });
    world._maxStep = null;
    for (var i = 0; i < STACK.length; i++) runStep(STACK[i], world);
    world.metrics = S.gapStats(world);
    return world;
  }

  function showInspector(type) {
    var meta = TYPES[type]; if (!meta) return;
    document.querySelectorAll('#pluginKnobs .knob, .param-box .knob').forEach(function (el) {
      el.style.display = 'none';
    });
    var shown = 0;
    (meta.params || []).forEach(function (id) {
      var el = document.getElementById(id);
      var kn = el && el.closest('.knob');
      if (kn) { kn.style.display = 'grid'; shown++; }
    });
    var empty = document.getElementById('inspEmpty');
    if (empty) {
      empty.style.display = shown ? 'none' : '';
      empty.textContent = shown ? '' : 'У шага «' + meta.title + '» нет своих ручек — только вкл/выкл и место в стеке.';
    }
    if (window.SeamHelp) window.SeamHelp.select(type);
  }
  function loadIntoSliders() {
    var s = STACK[selected]; if (!s) return;
    Object.keys(s.params || {}).forEach(function (id) {
      var el = document.getElementById(id);
      if (el && s.params[id] != null) el.value = s.params[id];
    });
    if (window.syncSeamLabels) window.syncSeamLabels();
  }
  function writeSelected(id, value) {
    var s = STACK[selected]; if (!s) return;
    var meta = TYPES[s.type]; if (!meta) return;
    if ((meta.params || []).indexOf(id) < 0) return;
    s.params[id] = value; save();
  }
  function render() {
    var host = document.getElementById('stackList');
    if (!host) return;
    host.innerHTML = '';
    STACK.forEach(function (s, i) {
      var meta = TYPES[s.type] || { title: s.type };
      var row = document.createElement('div');
      row.className = 'stack-row' + (s.on ? '' : ' off') + (i === selected ? ' is-active' : '');
      row.innerHTML =
        '<button type="button" class="st-on">' + (s.on ? '●' : '○') + '</button>' +
        '<span class="st-name">' + (i + 1) + '. ' + meta.title + '</span>' +
        '<button type="button" class="st-up">↑</button>' +
        '<button type="button" class="st-dn">↓</button>' +
        '<button type="button" class="st-dup">+</button>' +
        '<button type="button" class="st-del">×</button>';
      row.addEventListener('click', function (e) {
        if (e.target.closest('button')) return;
        selected = i; loadIntoSliders(); showInspector(s.type); render();
      });
      row.querySelector('.st-on').addEventListener('click', function (e) {
        e.stopPropagation(); s.on = !s.on; save(); render(); if (window.renderSeams) window.renderSeams();
      });
      row.querySelector('.st-up').addEventListener('click', function (e) {
        e.stopPropagation(); if (i === 0) return;
        STACK.splice(i - 1, 0, STACK.splice(i, 1)[0]); selected = i - 1; save(); render(); if (window.renderSeams) window.renderSeams();
      });
      row.querySelector('.st-dn').addEventListener('click', function (e) {
        e.stopPropagation(); if (i >= STACK.length - 1) return;
        STACK.splice(i + 1, 0, STACK.splice(i, 1)[0]); selected = i + 1; save(); render(); if (window.renderSeams) window.renderSeams();
      });
      row.querySelector('.st-dup').addEventListener('click', function (e) {
        e.stopPropagation();
        STACK.splice(i + 1, 0, { id: uid(), type: s.type, on: s.on, params: JSON.parse(JSON.stringify(s.params || {})) });
        selected = i + 1; save(); render(); if (window.renderSeams) window.renderSeams();
      });
      row.querySelector('.st-del').addEventListener('click', function (e) {
        e.stopPropagation();
        if (STACK.length < 2) return;
        STACK.splice(i, 1); if (selected >= STACK.length) selected = STACK.length - 1;
        save(); render(); showInspector(STACK[selected].type); if (window.renderSeams) window.renderSeams();
      });
      host.appendChild(row);
    });
    if (STACK[selected]) showInspector(STACK[selected].type);
  }
  function addStep(type) {
    if (!TYPES[type]) return;
    STACK.push(normalize({ type: type, on: true }));
    selected = STACK.length - 1; save(); loadIntoSliders(); render();
    if (window.renderSeams) window.renderSeams();
  }
  function resetParams() {
    STACK.length = 0;
    DEFAULT_STACK.forEach(function (s) { STACK.push(normalize(s)); });
    selected = 0; save(); loadIntoSliders(); render();
  }
  function liveLine() {
    return STACK.filter(function (s) { return s.on; }).map(function (s, i) {
      return (i + 1) + ' ' + ((TYPES[s.type] || {}).title || s.type);
    }).join(' → ');
  }
  function init() {
    load();
    Object.keys(FALLBACK).forEach(function (id) {
      var el = document.getElementById(id);
      if (!el || el._seamBound) return;
      el._seamBound = true;
      el.addEventListener('input', function () {
        writeSelected(id, el.tagName === 'SELECT' ? el.value : +el.value);
        if (window.syncSeamLabels) window.syncSeamLabels();
        if (window.SeamHelp) window.SeamHelp.refresh();
        if (window.renderSeams) window.renderSeams();
      });
    });
    var addSel = document.getElementById('stackAddType');
    var addBtn = document.getElementById('stackAdd');
    if (addSel && !addSel.options.length) {
      Object.keys(TYPES).forEach(function (k) {
        var o = document.createElement('option'); o.value = k; o.textContent = TYPES[k].title; addSel.appendChild(o);
      });
    }
    if (addBtn && !addBtn._seamBound) {
      addBtn._seamBound = true;
      addBtn.addEventListener('click', function () { addStep((addSel && addSel.value) || 'gapSpring'); });
    }
    render();
    loadIntoSliders();
    window.SeamStack = {
      run: run, render: render, STACK: STACK, TYPES: TYPES, FALLBACK: FALLBACK,
      resetParams: resetParams, liveLine: liveLine, addStep: addStep, loadIntoSliders: loadIntoSliders
    };
  }
  init();
})();
