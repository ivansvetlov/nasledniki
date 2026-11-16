/* Стек компрессора: каждый шаг — плагин (вкл / порядок / дубль / свои ручки). */
(function () {
  var TYPES = {
    macro: { title: 'Макро', help: 'eps', params: ['eps', 'ten', 'step', 'keepAngle'] },
    fillet: { title: 'Фаска', help: 'splT', params: ['splT', 'cSpeed', 'cSkew', 'cPulse', 'cBias', 'cAngle', 'innerAngle'] },
    curve: { title: 'Кривая', help: 'curveMode', params: ['splT', 'cSpeed'], mode: 'curveMode' },
    round: { title: 'Скругление', help: 'splT', params: [] },
    fill: { title: 'Впадины', help: 'keepAngle', params: [] },
    clamp: { title: 'Мин. угол', help: 'minAngle', params: ['minAngle'] },
    unpinch: { title: 'Антизащемление', help: 'antiPinch', params: ['antiPinch', 'antiPinchReach'] },
    nubs: { title: 'Соски', help: 'nubSpan', params: ['nubSpan', 'nubDepth', 'nubTurn'] },
    untangle: { title: 'Петли', help: 'loopMode', params: ['minAngle'], mode: 'loopMode' },
    shrink: { title: 'Сжатие r', help: 'shrinkR', params: ['shrinkR'] },
    spline: { title: 'Сплайн', help: 'splineTen', params: ['splineTen', 'splineStep'] }
  };
  var FALLBACK = {
    eps: 10, ten: 1, step: 16, keepAngle: 80, minAngle: 10,
    antiPinch: 20, antiPinchReach: 0.55, splT: 1, cSpeed: 4, cSkew: 1,
    cPulse: 0, cBias: 0.5, cAngle: 50, innerAngle: 0,
    nubSpan: 10, nubDepth: 0.15, nubTurn: 16,
    shrinkR: 2.5, splineTen: 0.7, splineStep: 5,
    curveMode: 'step', loopMode: 'auto'
  };
  /* Эталон: стек, который устраивал до того, как сжатие стало реально отступать.
     shrink стоит в цепочке, но выкл. — тогда он был пустышкой; включи, когда нужен настоящий inset. */
  var DEFAULT_STACK = [
    { type: 'macro', on: true, params: { eps: 10, ten: 1, step: 16, keepAngle: 80 } },
    { type: 'fillet', on: true, params: { splT: 1, cSpeed: 4, cSkew: 1, cPulse: 0, cBias: 0.5, cAngle: 50, innerAngle: 0 } },
    { type: 'curve', on: true, params: { splT: 1, cSpeed: 2, curveMode: 'step' } },
    { type: 'round', on: true, params: {} },
    { type: 'fillet', on: true, params: { splT: 1, cSpeed: 4, cSkew: 1, cPulse: 0, cBias: -6, cAngle: 30, innerAngle: 0 } },
    { type: 'fill', on: true, params: {} },
    { type: 'unpinch', on: true, params: { antiPinch: 20, antiPinchReach: 0.55 } },
    { type: 'untangle', on: true, params: { minAngle: 10, loopMode: 'auto' } },
    { type: 'shrink', on: false, params: { shrinkR: 2.5 } },
    { type: 'spline', on: true, params: { splineTen: 0.7, splineStep: 5 } },
    { type: 'clamp', on: true, params: { minAngle: 10 } },
    { type: 'untangle', on: true, params: { minAngle: 10, loopMode: 'auto' } },
    { type: 'macro', on: true, params: { eps: 16, ten: 1, step: 13, keepAngle: 80 } },
    { type: 'round', on: true, params: {} }
  ];
  var KEY = 'compressor_stack_v5';
  var STACK = [];
  var selected = 0;
  var loading = false;

  function uid() { return 'p' + Math.random().toString(36).slice(2, 8); }
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
    if (meta.mode) o[meta.mode] = src && src[meta.mode] != null ? src[meta.mode] : FALLBACK[meta.mode];
    return o;
  }
  function normalize(s) {
    return {
      id: s.id || uid(),
      type: s.type,
      on: s.on !== false,
      params: s.params && typeof s.params === 'object' ? Object.assign(snapshot(s.type), s.params) : snapshot(s.type)
    };
  }
  function load() {
    STACK.length = 0;
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) {
        var arr = JSON.parse(raw);
        if (Array.isArray(arr) && arr.length) {
          arr.forEach(function (s) { if (TYPES[s.type]) STACK.push(normalize(s)); });
        }
      }
    } catch (e) {}
    if (!STACK.length) DEFAULT_STACK.forEach(function (s) { STACK.push(normalize(s)); });
    var have = {};
    STACK.forEach(function (s) { have[s.type] = true; });
    if (!have.shrink) STACK.push(normalize({ type: 'shrink', on: false, params: { shrinkR: 2.5 } }));
    if (!have.spline) STACK.push(normalize({ type: 'spline', on: true, params: { splineTen: 0.7, splineStep: 5 } }));
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(STACK)); } catch (e) {} }

  function runStep(step, ring) {
    var C = window.Compressor, Cn = window.Corners;
    if (!step.on || !ring) return ring;
    var o = {
      speed: pval(step, 'cSpeed', 2),
      tension: pval(step, 'splT', 1),
      skew: pval(step, 'cSkew', 0),
      pulse: pval(step, 'cPulse', 0),
      bias: pval(step, 'cBias', 0.5),
      angle: pval(step, 'cAngle', 150),
      innerAngle: pval(step, 'innerAngle', 50)
    };
    switch (step.type) {
      case 'macro':
        return C.macroSmooth(ring, pval(step, 'eps', 10), pval(step, 'ten', 1), pval(step, 'step', 16), pval(step, 'keepAngle', 80));
      case 'fillet':
        return Cn.smoothCorners(ring, o);
      case 'curve': {
        var mode = pval(step, 'curveMode', 'step');
        var s = Math.max(2, o.speed | 0);
        if (mode === 'cr') return C.catmullRomRing(ring, o.tension, s);
        if (mode === 'spline') return Cn.splineRing(ring, o.tension, s);
        return Cn.splineRing(ring, 0, s);
      }
      case 'round':
        return C.roundCorners(ring, 2, 0.3);
      case 'fill':
        return Cn.fillConcavities(ring, { depth: 8, iters: 8 });
      case 'clamp':
        return Cn.clampMinAngle(ring, pval(step, 'minAngle', 10), 20, { inner: true });
      case 'unpinch': {
        var gap = pval(step, 'antiPinch', 10);
        if (gap <= 0) return ring;
        return Cn.unpinch(ring, gap, { iters: 5, strength: 0.5, reach: pval(step, 'antiPinchReach', 1), minArc: gap * 1.5 });
      }
      case 'nubs':
        return Cn.clipNubs(ring, {
          maxSpan: pval(step, 'nubSpan', 10),
          minDepth: pval(step, 'nubDepth', 0.15),
          minTurn: pval(step, 'nubTurn', 16),
          iters: 10, maxWin: 6
        });
      case 'untangle': {
        var mode = pval(step, 'loopMode', 'auto');
        if (mode === 'off') return ring;
        var xs = C.selfIntersections(ring);
        window.__tangle = window.__tangle || {};
        window.__tangle.before = xs.length;
        if (!xs.length) { window.__tangle.after = 0; window.__tangle.fixed = 0; window.__tangle.mode = mode; return ring; }
        var u = C.untangleRing(ring, mode, { relaxIters: 12, relaxAmt: 0.5, win: 6, smoothWin: 10 });
        window.__tangle.after = u.crossings; window.__tangle.fixed = u.fixed; window.__tangle.mode = mode;
        return Cn.clampMinAngle(u.ring, pval(step, 'minAngle', 10), 20, { inner: true });
      }
      case 'shrink': {
        var r = pval(step, 'shrinkR', 4);
        if (r <= 0) return ring;
        if (typeof C.seamOffset === 'function') {
          var sh = C.seamOffset(ring, r);
          return (sh && sh.length > 3) ? sh : ring;
        }
        return ring;
      }
      case 'spline':
        return C.catmullRomRing(ring, pval(step, 'splineTen', 0.8), pval(step, 'splineStep', 2));
      default:
        return ring;
    }
  }

  function run(ring) {
    window.__tangle = { before: 0, after: 0, fixed: 0, mode: 'off' };
    window.__shrink = { r: 0, method: 'off', area0: 0, area1: 0 };
    var out = ring;
    for (var i = 0; i < STACK.length; i++) out = runStep(STACK[i], out);
    if (window.minClearance) {
      window.__tangle.clear = window.minClearance(out);
      var pinch = STACK.filter(function (s) { return s.type === 'unpinch' && s.on; })[0];
      window.__tangle.gap = pinch ? pval(pinch, 'antiPinch', 0) : 0;
    }
    return out;
  }

  function loadIntoSliders() {
    var s = STACK[selected];
    if (!s) return;
    loading = true;
    var p = s.params || {};
    Object.keys(p).forEach(function (id) {
      var el = document.getElementById(id);
      if (!el || p[id] == null) return;
      el.value = p[id];
    });
    loading = false;
    if (window.syncLabels) window.syncLabels();
  }

  function writeSelected(id, value) {
    if (loading) return;
    var s = STACK[selected];
    if (!s) return;
    var meta = TYPES[s.type];
    if (!meta) return;
    var mine = (meta.params || []).indexOf(id) >= 0 || meta.mode === id;
    if (!mine) return;
    s.params = s.params || {};
    s.params[id] = value;
    save();
  }

  function showInspector(type) {
    var meta = TYPES[type]; if (!meta) return;
    document.querySelectorAll('#pluginKnobs .knob, #pluginKnobs .mode, .param-box .knob, .param-box .mode').forEach(function (el) {
      el.style.display = 'none';
    });
    var shown = 0;
    (meta.params || []).forEach(function (id) {
      var el = document.getElementById(id);
      var kn = el && el.closest('.knob');
      if (kn) { kn.style.display = 'grid'; shown++; }
    });
    if (meta.mode) {
      var sel = document.getElementById(meta.mode);
      var md = sel && sel.closest('.mode');
      if (md) { md.style.display = 'block'; shown++; }
    }
    var empty = document.getElementById('inspEmpty');
    if (empty) {
      empty.style.display = shown ? 'none' : '';
      empty.textContent = shown ? '' : 'У шага «' + meta.title + '» нет своих ручек — только вкл/выкл и место в стеке.';
    }
    if (window.ParamHelp && meta.help) window.ParamHelp.select(meta.help);
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
        '<button type="button" class="st-on" title="вкл/выкл">' + (s.on ? '●' : '○') + '</button>' +
        '<span class="st-name">' + (i + 1) + '. ' + meta.title + '</span>' +
        '<button type="button" class="st-up" title="выше">↑</button>' +
        '<button type="button" class="st-dn" title="ниже">↓</button>' +
        '<button type="button" class="st-dup" title="дубль">+</button>' +
        '<button type="button" class="st-del" title="убрать">×</button>';
      row.addEventListener('click', function (e) {
        if (e.target.closest('button')) return;
        selected = i; loadIntoSliders(); showInspector(s.type); render();
      });
      row.querySelector('.st-on').addEventListener('click', function (e) {
        e.stopPropagation(); s.on = !s.on; save(); render(); if (window.renderAll) window.renderAll();
      });
      row.querySelector('.st-up').addEventListener('click', function (e) {
        e.stopPropagation(); if (i === 0) return;
        STACK.splice(i - 1, 0, STACK.splice(i, 1)[0]); selected = i - 1; save(); render(); if (window.renderAll) window.renderAll();
      });
      row.querySelector('.st-dn').addEventListener('click', function (e) {
        e.stopPropagation(); if (i >= STACK.length - 1) return;
        STACK.splice(i + 1, 0, STACK.splice(i, 1)[0]); selected = i + 1; save(); render(); if (window.renderAll) window.renderAll();
      });
      row.querySelector('.st-dup').addEventListener('click', function (e) {
        e.stopPropagation();
        STACK.splice(i + 1, 0, {
          id: uid(), type: s.type, on: s.on,
          params: JSON.parse(JSON.stringify(s.params || {}))
        });
        selected = i + 1; save(); loadIntoSliders(); render(); if (window.renderAll) window.renderAll();
      });
      row.querySelector('.st-del').addEventListener('click', function (e) {
        e.stopPropagation();
        if (STACK.length < 2) return;
        STACK.splice(i, 1); if (selected >= STACK.length) selected = STACK.length - 1;
        save(); loadIntoSliders(); render(); showInspector(STACK[selected].type); if (window.renderAll) window.renderAll();
      });
      host.appendChild(row);
    });
    if (STACK[selected]) showInspector(STACK[selected].type);
  }

  function addStep(type) {
    if (!TYPES[type]) return;
    STACK.push(normalize({ type: type, on: true }));
    selected = STACK.length - 1;
    save(); loadIntoSliders(); render();
    if (window.renderAll) window.renderAll();
  }

  function resetParams(start) {
    STACK.length = 0;
    DEFAULT_STACK.forEach(function (s) {
      var step = normalize(s);
      if (start) {
        (TYPES[s.type].params || []).forEach(function (id) {
          if (s.params && s.params[id] != null) return;
          if (start[id] != null) step.params[id] = start[id];
        });
      }
      STACK.push(step);
    });
    selected = 0;
    save();
    loadIntoSliders();
    render();
  }

  function liveLine() {
    return STACK.filter(function (s) { return s.on; }).map(function (s, i) {
      var meta = TYPES[s.type] || { title: s.type, params: [] };
      var bits = (meta.params || []).map(function (k) {
        return k + '=' + pval(s, k, FALLBACK[k]);
      });
      if (meta.mode) bits.push(meta.mode + '=' + pval(s, meta.mode, FALLBACK[meta.mode]));
      return (i + 1) + ' ' + meta.title + (bits.length ? '(' + bits.join(', ') + ')' : '');
    }).join(' → ');
  }

  function liveJSON() {
    return {
      stack: STACK.map(function (s) { return { type: s.type, on: s.on, params: s.params }; })
    };
  }

  function bindKnobs() {
    Object.keys(FALLBACK).forEach(function (id) {
      var el = document.getElementById(id);
      if (!el || el._stackBound) return;
      el._stackBound = true;
      el.addEventListener('input', function () {
        writeSelected(id, el.tagName === 'SELECT' ? el.value : +el.value);
      });
      el.addEventListener('change', function () {
        writeSelected(id, el.tagName === 'SELECT' ? el.value : +el.value);
      });
    });
    var addBtn = document.getElementById('stackAdd');
    var addSel = document.getElementById('stackAddType');
    if (addSel && !addSel.options.length) {
      Object.keys(TYPES).forEach(function (k) {
        var o = document.createElement('option');
        o.value = k; o.textContent = TYPES[k].title;
        addSel.appendChild(o);
      });
    }
    if (addBtn && !addBtn._stackBound) {
      addBtn._stackBound = true;
      addBtn.addEventListener('click', function () {
        addStep((addSel && addSel.value) || 'fillet');
      });
    }
  }

  var paramsOnly = false;
  function runFromParams(ring, stackArr) {
    paramsOnly = true;
    var prev = STACK.slice();
    if (stackArr && stackArr.length) {
      STACK.length = 0;
      stackArr.forEach(function (s) { STACK.push(normalize(s)); });
    }
    var out = run(ring);
    STACK.length = 0;
    prev.forEach(function (s) { STACK.push(s); });
    paramsOnly = false;
    return out;
  }
  var _val = val;
  val = function (id, fb) {
    if (paramsOnly) return fb;
    return _val(id, fb);
  };

  function init() {
    load();
    window.CompressorStack = {
      run: run, runFromParams: runFromParams, render: render, STACK: STACK, TYPES: TYPES,
      resetParams: resetParams, liveLine: liveLine, liveJSON: liveJSON,
      addStep: addStep, loadIntoSliders: loadIntoSliders
    };
    if (!document.getElementById('eps')) return;
    bindKnobs();
    render();
    loadIntoSliders();
  }
  init();
})();
