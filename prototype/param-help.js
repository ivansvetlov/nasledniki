/* Справка к ползункам компрессора: «?» → карточка + петля GSAP. */
(function () {
  var NS = 'http://www.w3.org/2000/svg';
  var HELP = {
    eps: {
      title: 'Срез ряби',
      body: 'Убирает мелкие зубцы берега. Правее — спокойнее линия, но тонкие мысы тоже могут пропасть.',
      demo: 'eps'
    },
    ten: {
      title: 'Натяжение сплайна',
      body: 'Как сильно общая форма тянется к точкам. 0 — почти ломаная, 1 — мягкая дуга.',
      demo: 'ten'
    },
    step: {
      title: 'Шаг кривой',
      body: 'Расстояние между точками на выходе. Крупнее шаг — проще силуэт, меньше деталей.',
      demo: 'step'
    },
    keepAngle: {
      title: 'Защита выемок',
      body: 'Крутые бухты не сглаживать вместе с рябью. Выше угол — больше выемок остаётся как есть.',
      demo: 'keep'
    },
    minAngle: {
      title: 'Запрет острых',
      body: 'Район не может быть острее этого. Шип раскрывается — «иголки» на карте под запретом.',
      demo: 'minAngle'
    },
    antiPinch: {
      title: 'Перешеек суши',
      body: 'Раздвигает только узкое место, где суша с двух сторон. Выемка (вода между берегами) не трогается. 0 — выкл.',
      demo: 'pinch'
    },
    antiPinchReach: {
      title: 'Захват языка',
      body: '0 — только шея. 1 — до кончика головы: шея и голова толстеют вместе, без гриба.',
      demo: 'reach'
    },
    splT: {
      title: 'Скругление угла',
      body: 'Насколько закруглить найденный угол. 0 — оставить угол, правее — широкая дуга.',
      demo: 'fillet'
    },
    cSpeed: {
      title: 'Плотность дуги',
      body: 'Сколько точек на скруглении. Больше — дуга глаже, считать чуть дольше.',
      demo: 'speed'
    },
    cSkew: {
      title: 'Перекос фаски',
      body: 'Сдвиг скругления вбок. Угол как будто заваливается на одну сторону.',
      demo: 'skew'
    },
    cPulse: {
      title: 'Разный радиус',
      body: 'До угла и после — разный размер дуги. Крайности дают «каплю» на одном плече.',
      demo: 'pulse'
    },
    cBias: {
      title: 'Вытолкнуть дугу',
      body: 'Чуть отодвинуть скругление наружу, чтобы оно не срезало мыс.',
      demo: 'bias'
    },
    cAngle: {
      title: 'Какие углы',
      body: 'Порог «это острый». Ниже — скругляется почти всё, выше — только явные изломы.',
      demo: 'angle'
    },
    curveMode: {
      title: 'Вид кривой',
      body: 'Как соединять точки: ступеньки, гладкий сплайн или Catmull-Rom (сильнее волна).',
      demo: 'curve'
    },
    loopMode: {
      title: 'Петля границы',
      body: 'Если линия пересекла себя: расправить, отрезать маленькую петлю или только показать.',
      demo: 'loop'
    },
    nubSpan: {
      title: 'Соски — ширина',
      body: 'Срезает короткие выпуклые прыщики на гладком крае. Правее — съест более широкие мыски. Крупный мыс с длинным основанием не трогает.',
      demo: 'nub'
    },
    nubDepth: {
      title: 'Соски — высота',
      body: 'Минимальная высота прыщика над хордой. Ниже — ловит совсем плоские зубцы, выше — только явные соски.',
      demo: 'nub'
    },
    nubTurn: {
      title: 'Соски — поворот',
      body: 'Слабее угол — срезает и мягкие бугорки. Сильнее — только явный излом на коротком пролёте.',
      demo: 'nub'
    },
    innerAngle: {
      title: 'Внутренние углы',
      body: 'Тот же порог остроты, но для бухт и входящих углов. 0 — не трогать. ~50 ловит излом вроде #8 A1, не размазывая мысы.',
      demo: 'inner'
    },
    shrinkR: {
      title: 'Сжатие r',
      body: 'Отступает всю границу внутрь на r пикселей. Шаг должен быть включён в стеке (●). После сжатия обычно ставят сплайн. 0 — выкл.',
      demo: 'shrink'
    },
    splineTen: {
      title: 'Плавность сплайна',
      body: 'Финальная доводка после сжатия: 0 — ломаная, 1 — мягкая дуга. Обычно в самом конце стека.',
      demo: 'ten'
    },
    splineStep: {
      title: 'Шаг сплайна',
      body: 'Насколько плотно семплировать финальный сплайн. Крупнее — проще линия.',
      demo: 'step'
    }
  };

  var svg, titleEl, bodyEl, valEl, tl, currentId, target = { t: 0 };

  function el(name, attrs) {
    var n = document.createElementNS(NS, name);
    if (attrs) Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    return n;
  }
  function poly(parent, cls, pts, color, w) {
    var p = parent.querySelector('.' + cls);
    if (!p) {
      p = el('polyline', { 'class': cls, fill: 'none', 'stroke-linejoin': 'round', 'stroke-linecap': 'round' });
      parent.appendChild(p);
    }
    p.setAttribute('stroke', color);
    p.setAttribute('stroke-width', w || 2);
    p.setAttribute('points', pts.map(function (a) { return a[0] + ',' + a[1]; }).join(' '));
    return p;
  }
  function dots(parent, cls, pts, color, r) {
    var g = parent.querySelector('.' + cls);
    if (!g) { g = el('g', { 'class': cls }); parent.appendChild(g); }
    while (g.childNodes.length > pts.length) g.removeChild(g.lastChild);
    pts.forEach(function (pt, i) {
      var c = g.childNodes[i];
      if (!c) { c = el('circle'); g.appendChild(c); }
      c.setAttribute('cx', pt[0]); c.setAttribute('cy', pt[1]);
      c.setAttribute('r', r || 2.2); c.setAttribute('fill', color);
    });
  }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function lerpPts(a, b, t) {
    return a.map(function (p, i) { return [lerp(p[0], b[i][0], t), lerp(p[1], b[i][1], t)]; });
  }
  function sampleLine(a, b, n) {
    var o = [];
    for (let i = 0; i <= n; i++) o.push([lerp(a[0], b[0], i / n), lerp(a[1], b[1], i / n)]);
    return o;
  }
  function roundCorner(A, B, C, r) {
    var v1 = [A[0] - B[0], A[1] - B[1]], v2 = [C[0] - B[0], C[1] - B[1]];
    var m1 = Math.hypot(v1[0], v1[1]) || 1, m2 = Math.hypot(v2[0], v2[1]) || 1;
    var t = Math.max(0.05, Math.min(0.45, r));
    var P0 = [B[0] + v1[0] / m1 * (m1 * t), B[1] + v1[1] / m1 * (m1 * t)];
    var P2 = [B[0] + v2[0] / m2 * (m2 * t), B[1] + v2[1] / m2 * (m2 * t)];
    var out = [P0];
    for (let s = 1; s <= 8; s++) {
      var u = s / 8, w = 1 - u;
      out.push([
        w * w * P0[0] + 2 * w * u * B[0] + u * u * P2[0],
        w * w * P0[1] + 2 * w * u * B[1] + u * u * P2[1]
      ]);
    }
    return out;
  }

  var DEMOS = {
    eps: function (svg, t) {
      var noisy = [], clean = [];
      for (let x = 16; x <= 224; x += 6) {
        var k = (x - 16) / 208;
        noisy.push([x, 55 + 14 * Math.sin(k * 18) + 5 * Math.sin(k * 70)]);
        clean.push([x, 55 + 6 * Math.sin(k * 6)]);
      }
      poly(svg, 'g0', noisy, 'rgba(120,140,155,.45)', 1.5);
      poly(svg, 'g1', lerpPts(noisy, clean, t), '#4fb0e0', 2.4);
    },
    ten: function (svg, t) {
      var raw = [[20, 80], [70, 30], [120, 78], [170, 28], [220, 80]];
      var soft = raw.map(function (p, i) {
        if (i === 0 || i === raw.length - 1) return p;
        var a = raw[i - 1], c = raw[i + 1];
        return [p[0] * 0.35 + (a[0] + c[0]) * 0.325, p[1] * 0.35 + (a[1] + c[1]) * 0.325];
      });
      poly(svg, 'g0', raw, 'rgba(120,140,155,.4)', 1.5);
      poly(svg, 'g1', lerpPts(raw, soft, t), '#4fb0e0', 2.4);
    },
    step: function (svg, t) {
      var n = Math.round(lerp(16, 4, t));
      var pts = [];
      for (let i = 0; i <= n; i++) {
        var k = i / n;
        pts.push([20 + k * 200, 55 + 22 * Math.sin(k * Math.PI * 2)]);
      }
      poly(svg, 'g1', pts, '#4fb0e0', 2.4);
      dots(svg, 'gd', pts, '#4fb0e0', 2.4);
    },
    keep: function (svg, t) {
      var left = [];
      for (var x = 16; x <= 100; x += 5) {
        left.push([x, 40 + (1 - t) * 8 * ((Math.floor(x / 5) % 2) ? 1 : -1)]);
      }
      var bay = [[100, 40], [130, 40], [150, 90], [170, 40], [224, 40]];
      poly(svg, 'g0', left.concat(bay), 'rgba(120,140,155,.35)', 1.5);
      poly(svg, 'g1', left.concat(bay), '#4fb0e0', 2.4);
    },
    minAngle: function (svg, t) {
      var spike = [[30, 85], [120, 85], [120, 22], [130, 85], [210, 85]];
      var open = [[30, 85], [110, 85], [125, 48], [140, 85], [210, 85]];
      poly(svg, 'g0', spike, 'rgba(120,140,155,.4)', 1.5);
      poly(svg, 'g1', lerpPts(spike, open, t), '#4fb0e0', 2.4);
    },
    reach: function (svg, t) {
      var neck = 6 + 6 * t;
      var y1 = 52 - neck / 2, y2 = 52 + neck / 2;
      var tip = 22 - 12 * t;
      var gray = [[214, 18], [214, 92], [128, 92], [128, 55], [22, 55], [22, 49], [128, 49], [128, 18]];
      var fat = [[214, 18], [214, 92], [128, 92], [128, y2], [tip, y2], [tip, y1], [128, y1], [128, 18]];
      poly(svg, 'g0', gray, 'rgba(120,140,155,.35)', 1.4);
      poly(svg, 'g1', fat, '#4fb0e0', 2.3);
    },
    pinch: function (svg, t) {
      var neck = lerp(5, 16, t);
      var y1 = 36 - neck / 2, y2 = 36 + neck / 2;
      var hg0 = [[12, 12], [48, 33.5], [78, 33.5], [114, 12], [114, 60], [78, 38.5], [48, 38.5], [12, 60]];
      var hg1 = [[12, 12], [48, y1], [78, y1], [114, 12], [114, 60], [78, y2], [48, y2], [12, 60]];
      var bay = [[132, 14], [226, 14], [226, 90], [192, 90], [192, 42], [166, 42], [166, 90], [132, 90]];
      poly(svg, 'g0', hg0, 'rgba(120,140,155,.35)', 1.4);
      poly(svg, 'g1', hg1, '#4fb0e0', 2.3);
      poly(svg, 'g2', bay, '#4fb0e0', 2.3);
    },
    fillet: function (svg, t) {
      var A = [24, 88], B = [120, 22], C = [216, 88];
      var sharp = [A, B, C];
      var rnd = [A].concat(roundCorner(A, B, C, lerp(0.08, 0.42, t))).concat([C]);
      poly(svg, 'g0', sharp, 'rgba(120,140,155,.4)', 1.5);
      poly(svg, 'g1', rnd, '#4fb0e0', 2.4);
    },
    speed: function (svg, t) {
      var A = [24, 88], B = [120, 22], C = [216, 88];
      var n = Math.round(lerp(3, 12, t));
      var P0 = [72, 55], P2 = [168, 55];
      var pts = [A];
      for (let s = 0; s <= n; s++) {
        var u = s / n, w = 1 - u;
        pts.push([w * w * P0[0] + 2 * w * u * B[0] + u * u * P2[0], w * w * P0[1] + 2 * w * u * B[1] + u * u * P2[1]]);
      }
      pts.push(C);
      poly(svg, 'g1', pts, '#4fb0e0', 2.4);
      dots(svg, 'gd', pts.slice(1, -1), '#9ad0f0', 2.2);
    },
    skew: function (svg, t) {
      var A = [24, 88], B = [120, 22], C = [216, 88];
      var sk = lerp(-18, 18, t);
      var P0 = [80 - sk, 58], P2 = [160 - sk, 58];
      var pts = [A];
      for (let s = 0; s <= 8; s++) {
        var u = s / 8, w = 1 - u;
        pts.push([w * w * P0[0] + 2 * w * u * B[0] + u * u * P2[0], w * w * P0[1] + 2 * w * u * B[1] + u * u * P2[1]]);
      }
      pts.push(C);
      poly(svg, 'g0', [A, B, C], 'rgba(120,140,155,.4)', 1.5);
      poly(svg, 'g1', pts, '#4fb0e0', 2.4);
    },
    pulse: function (svg, t) {
      var A = [24, 88], B = [120, 22], C = [216, 88];
      var left = lerp(0.18, 0.5, t), right = lerp(0.5, 0.18, t);
      var P0 = [120 - 90 * left, 22 + 66 * left], P2 = [120 + 90 * right, 22 + 66 * right];
      var pts = [A];
      for (let s = 0; s <= 8; s++) {
        var u = s / 8, w = 1 - u;
        pts.push([w * w * P0[0] + 2 * w * u * B[0] + u * u * P2[0], w * w * P0[1] + 2 * w * u * B[1] + u * u * P2[1]]);
      }
      pts.push(C);
      poly(svg, 'g0', [A, B, C], 'rgba(120,140,155,.4)', 1.5);
      poly(svg, 'g1', pts, '#4fb0e0', 2.4);
    },
    bias: function (svg, t) {
      var A = [24, 88], B = [120, 22], C = [216, 88];
      var lift = lerp(0, 16, t);
      var mid = [120, 22 - lift];
      var pts = [A];
      for (let s = 0; s <= 8; s++) {
        var u = s / 8, w = 1 - u;
        var P0 = [70, 58], P2 = [170, 58];
        pts.push([w * w * P0[0] + 2 * w * u * mid[0] + u * u * P2[0], w * w * P0[1] + 2 * w * u * mid[1] + u * u * P2[1]]);
      }
      pts.push(C);
      poly(svg, 'g0', [A, B, C], 'rgba(120,140,155,.4)', 1.5);
      poly(svg, 'g1', pts, '#4fb0e0', 2.4);
    },
    angle: function (svg, t) {
      var mild = [[20, 70], [70, 50], [110, 70]];
      var sharp = [[130, 85], [180, 22], [230, 85]];
      var sharpR = [sharp[0]].concat(roundCorner(sharp[0], sharp[1], sharp[2], 0.35)).concat([sharp[2]]);
      poly(svg, 'g0', mild, '#4fb0e0', 2.2);
      poly(svg, 'g1', t > 0.45 ? sharpR : sharp, t > 0.45 ? '#4fb0e0' : '#e8a23a', 2.4);
    },
    curve: function (svg, t) {
      var raw = [[18, 80], [70, 30], [120, 80], [170, 30], [222, 80]];
      var soft = [];
      for (var i = 0; i < raw.length - 1; i++) {
        var a = raw[i], b = raw[i + 1];
        var mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2 - 18;
        for (var s = 0; s <= 6; s++) {
          if (s === 6 && i < raw.length - 2) continue;
          var u = s / 6, w = 1 - u;
          soft.push([w * w * a[0] + 2 * w * u * mx + u * u * b[0], w * w * a[1] + 2 * w * u * my + u * u * b[1]]);
        }
      }
      poly(svg, 'g0', raw, 'rgba(120,140,155,.4)', 1.5);
      poly(svg, 'g1', t < 0.5 ? raw : soft, '#4fb0e0', 2.4);
    },
    loop: function (svg, t) {
      var looped = [[30, 70], [80, 30], [140, 80], [90, 95], [70, 55], [160, 40], [210, 75]];
      var cut = [[30, 70], [80, 30], [160, 40], [210, 75]];
      poly(svg, 'g0', looped, 'rgba(120,140,155,.4)', 1.5);
      poly(svg, 'g1', t > 0.5 ? cut : looped, '#4fb0e0', 2.4);
    },
    inner: function (svg, t) {
      var cape = [[16, 88], [70, 28], [110, 88]];
      var bay = [[130, 28], [168, 88], [206, 28]];
      var bayR = [bay[0]].concat(roundCorner(bay[0], bay[1], bay[2], lerp(0.06, 0.4, t))).concat([bay[2]]);
      poly(svg, 'g0', cape, '#4fb0e0', 2.2);
      poly(svg, 'g1', t > 0.2 ? bayR : bay, t > 0.2 ? '#4fb0e0' : '#e8a23a', 2.4);
    },
    nub: function (svg, t) {
      var line = [[16, 70], [70, 70], [100, 70], [130, 70], [224, 70]];
      var bump = [[16, 70], [90, 70], [110, 38], [130, 70], [224, 70]];
      poly(svg, 'g0', bump, 'rgba(120,140,155,.4)', 1.5);
      poly(svg, 'g1', t > 0.45 ? line : bump, '#4fb0e0', 2.4);
    },
    shrink: function (svg, t) {
      var outer = [[40, 22], [200, 22], [210, 88], [30, 88]];
      var k = lerp(0, 14, t);
      var inner = [[40 + k, 22 + k], [200 - k, 22 + k], [210 - k, 88 - k], [30 + k, 88 - k]];
      poly(svg, 'g0', outer.concat([outer[0]]), 'rgba(120,140,155,.4)', 1.5);
      poly(svg, 'g1', inner.concat([inner[0]]), '#4fb0e0', 2.4);
    }
  };

  function drawDemo(kind, t) {
    if (!svg) return;
    var g = svg.querySelector('.origin');
    if (!g) {
      g = el('g', { 'class': 'origin', transform: 'translate(0,65)' });
      svg.appendChild(g);
    }
    var fn = DEMOS[kind];
    if (fn) fn(g, t);
  }

  function stop() {
    if (tl) { tl.kill(); tl = null; }
  }

  function sliderT(id) {
    if (id === 'curveMode') {
      var cv = document.getElementById('curveMode');
      return cv && cv.value === 'cr' ? 1 : 0.28;
    }
    if (id === 'loopMode') {
      var lv = document.getElementById('loopMode');
      return ({ off: 0, relax: 0.34, auto: 0.68, cut: 1 })[(lv && lv.value) || 'auto'] || 0.5;
    }
    var el = document.getElementById(id);
    if (!el || el.min === '' || el.max === '') return 0.5;
    var min = +el.min, max = +el.max, v = +el.value;
    if (!(max > min)) return 0;
    return (v - min) / (max - min);
  }

  function valueLabel(id) {
    if (id === 'curveMode' || id === 'loopMode') {
      var s = document.getElementById(id);
      return id + ' = ' + (s ? s.options[s.selectedIndex].text : '');
    }
    var el = document.getElementById(id);
    if (!el) return id;
    var unit = el.closest('.knob') && el.closest('.knob').querySelector('.kunit');
    return id + ' = ' + el.value + (unit ? ' ' + unit.textContent : '');
  }

  function helpIdFrom(node) {
    if (!node || !node.closest) return null;
    var q = node.closest('.qhelp');
    if (q) return q.getAttribute('data-help');
    var card = node.closest('.knob, .mode');
    if (!card) return null;
    var b = card.querySelector('.qhelp');
    return b ? b.getAttribute('data-help') : null;
  }

  function markActive(id) {
    document.querySelectorAll('.knob, .mode').forEach(function (card) {
      var b = card.querySelector('.qhelp');
      var on = b && b.getAttribute('data-help') === id;
      card.classList.toggle('is-active', !!on);
      if (b) b.setAttribute('aria-expanded', on ? 'true' : 'false');
    });
  }

  function replay() {
    if (!currentId || !HELP[currentId]) return;
    var h = HELP[currentId];
    var peak = Math.max(0.05, sliderT(currentId));
    stop();
    target.t = 0;
    if (svg) while (svg.firstChild) svg.removeChild(svg.firstChild);
    drawDemo(h.demo, 0);
    var g = window.gsap;
    if (g) {
      tl = g.timeline({ repeat: -1, yoyo: true });
      tl.fromTo(target, { t: 0 }, {
        t: peak,
        duration: 0.5 + peak * 1.15,
        ease: 'sine.inOut',
        onUpdate: function () { drawDemo(h.demo, target.t); }
      });
    } else {
      drawDemo(h.demo, peak);
    }
  }

  function select(id) {
    var h = HELP[id];
    if (!h) return;
    currentId = id;
    markActive(id);
    if (titleEl) titleEl.textContent = h.title;
    if (bodyEl) bodyEl.textContent = h.body;
    if (valEl) valEl.textContent = valueLabel(id);
    replay();
  }

  function refresh() {
    if (!currentId) return;
    if (valEl) valEl.textContent = valueLabel(currentId);
    replay();
  }

  function init() {
    svg = document.getElementById('helpSvg');
    titleEl = document.getElementById('helpTitle');
    bodyEl = document.getElementById('helpBody');
    valEl = document.getElementById('animVal');
    if (!svg) return;

    document.addEventListener('click', function (e) {
      var id = helpIdFrom(e.target);
      if (!id) return;
      if (e.target.closest && e.target.closest('.qhelp')) {
        e.preventDefault();
        e.stopPropagation();
      }
      select(id);
    });

    window.ParamHelp = { select: select, refresh: refresh };
    select('antiPinch');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
