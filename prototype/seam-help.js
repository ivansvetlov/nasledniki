/* Справка стека стыка: шаг или «?» → текст + петля GSAP по текущей ручке. */
(function () {
  var NS = 'http://www.w3.org/2000/svg';
  var HELP = {
    correspond: { title: 'Соответствие', body: 'Находит, где два района смотрят друг на друга, и связывает точки шва.', demo: 'link' },
    maskCoast: { title: 'Маска берега', body: 'Двигать только шов. Внешняя граница (берег) заморожена.', demo: 'coast' },
    maskAnchors: { title: 'Якоря шва', body: 'Концы шва не едут — иначе разъедется стык у тройника или берега.', demo: 'anchor' },
    turnGate: { title: 'Затвор поворота', body: 'Сильнее ход там, где шов поворачивает. Прямые участки почти стоят.', demo: 'turn' },
    neighborTurn: { title: 'Поворот соседа', body: 'Если сосед тоже ломает направление — оба угла получают ход.', demo: 'nbturn' },
    lockBand: { title: 'Замок ленты', body: 'Как только зазор попал в коридор около 5 px — точка стоп.', demo: 'lock' },
    hysteresis: { title: 'Гистерезис', body: 'Раз заперлось — больше не отпускаем, даже если пружина дёрнет.', demo: 'lock' },
    maxStep: { title: 'Потолок шага', body: 'За кадр точка не прыгает дальше этого. Меньше — спокойнее, дольше сходится.', demo: 'step' },
    gapSpring: { title: 'Пружина зазора', body: 'Дальше 5 px — тянет, ближе — толкает. В коридоре замка — стоп.', demo: 'spring' },
    overlapCut: { title: 'Резка перекрытия', body: 'Если районы залезли друг в друга — сильный толчок наружу.', demo: 'overlap' },
    inflateFar: { title: 'Добор дали', body: 'Слишком широкий зазор подтягивает берега, не ломая уже хорошие места.', demo: 'far' },
    slideNormal: { title: 'Только нормаль', body: 'Точка едет поперёк шва, не скользит вдоль.', demo: 'normal' },
    gapEqualize: { title: 'Выровнять зазор', body: 'Где уже 3 px, а рядом 8 — размазывает ошибку вдоль шва.', demo: 'eq' },
    seamSmooth: { title: 'Сгладить шов', body: 'Лаплас только на смотрящих вершинах. Шов ровнее, берег как был.', demo: 'smooth' },
    seamFillet: { title: 'Фаска шва', body: 'Скругляет изломы на уже подогнанном шве.', demo: 'fillet' },
    seamRound: { title: 'Лаплас шва', body: 'Все вершины шва чуть к соседям — мягче фаски, тупее детали.', demo: 'smooth' },
    seamSpline: { title: 'Сплайн шва', body: 'Финальная дуга по шву. Крупный шаг — проще линия.', demo: 'spline' },
    tripleDetect: { title: 'Найти тройники', body: 'Место, где три района смотрят друг на друга. Точка узла.', demo: 'triple' },
    tripleSocket: { title: 'Карман тройника', body: 'Не 5 px в точке, а маленький вогнутый треугольник.', demo: 'socket' },
    preserve: { title: 'Верность стилю', body: 'Тянет live назад к эталону компрессора, где вес хода маленький.', demo: 'preserve' },
    areaKeep: { title: 'Площадь', body: 'После сдвигов слегка масштабирует район к исходной площади.', demo: 'area' },
    unpinch: { title: 'Антизащемление', body: 'Раздвигает узкую шею суши, если пружина её сжала.', demo: 'pinch' },
    untangle: { title: 'Петли', body: 'Если шов завязался — расправить или отрезать.', demo: 'loop' },
    clampAngle: { title: 'Мин. угол', body: 'Иголка после стыка раскрывается.', demo: 'spike' },
    target: { title: 'Цель зазора', body: 'Сколько пикселей между берегами. Обычно 5.', demo: 'spring' },
    lock: { title: 'Коридор замка', body: '± вокруг цели: внутри точка считается готовой.', demo: 'lock' },
    springK: { title: 'Жёсткость', body: 'Сильнее пружина — быстрее сходится, легче промахнуться.', demo: 'spring' },
    share: { title: 'Доля соседа', body: '0 — едет только этот район, 1 — только сосед, 0.5 — оба.', demo: 'share' },
    springIters: { title: 'Итерации', body: 'Сколько раз пружина толкает за один прогон стека.', demo: 'step' },
    overlapBoost: { title: 'Буст перекрытия', body: 'Во сколько раз сильнее толкать, если уже залезли внутрь.', demo: 'overlap' },
    tol: { title: 'Порог соседства', body: 'Дальше этого районы не считаются соседями.', demo: 'link' },
    minRun: { title: 'Мин. длина шва', body: 'Короче этого кусок не считается швом — шум, не стык.', demo: 'link' },
    turnDeg: { title: 'Порог поворота', body: 'Ниже — прямая, ход слабый. Выше — угол, ход открыт.', demo: 'turn' },
    turnPow: { title: 'Крутизна затвора', body: 'Как резко ход растёт после порога. Больше — только острые углы едут.', demo: 'turn' },
    endPad: { title: 'Якоря концов', body: 'Сколько точек у края шва заморозить, чтобы не разъехался тройник.', demo: 'anchor' },
    pocket: { title: 'Карман', body: 'Насколько сильно раздвинуть три берега от узла.', demo: 'socket' },
    eqAmt: { title: 'Выравнивание', body: 'Сила размазывания ошибки вдоль шва.', demo: 'eq' },
    smoothAmt: { title: 'Сглаживание', body: 'Насколько шов тянется к середине соседей.', demo: 'smooth' },
    areaMix: { title: 'Держать площадь', body: 'Смесь: 0 — как сдвинули, 1 — вернуть исходную площадь.', demo: 'area' },
    antiPinch: { title: 'Антизащемление', body: 'Минимальная ширина шеи суши после пружины.', demo: 'pinch' },
    minAngle: { title: 'Мин. угол', body: 'Иголка после стыка раскрывается.', demo: 'spike' },
    cAngle: { title: 'Какие углы', body: 'Фаска шва берёт только углы острее этого.', demo: 'fillet' },
    splT: { title: 'Натяжение фаски', body: '0 — почти хорда, 1 — крутая дуга на изломе шва.', demo: 'fillet' },
    cSpeed: { title: 'Плотность фаски', body: 'Сколько точек на дуге. Больше — глаже, тяжелее.', demo: 'fillet' },
    splineTen: { title: 'Сплайн шва', body: 'Натяжение финальной дуги по шву.', demo: 'spline' },
    splineStep: { title: 'Шаг сплайна', body: 'Крупный шаг — проще линия, мелкий — ближе к исходной ломаной.', demo: 'spline' },
    loopMode: { title: 'Петли', body: 'Если шов завязался — расправить или отрезать.', demo: 'loop' }
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
  function fillPoly(parent, cls, pts, color, sw) {
    var p = parent.querySelector('.' + cls);
    if (!p) {
      p = el('polygon', { 'class': cls, 'stroke-linejoin': 'round' });
      parent.appendChild(p);
    }
    p.setAttribute('fill', color);
    p.setAttribute('stroke', sw || color);
    p.setAttribute('stroke-width', '1.4');
    p.setAttribute('points', pts.map(function (a) { return a[0] + ',' + a[1]; }).join(' '));
    return p;
  }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function lerpPts(a, b, t) {
    return a.map(function (p, i) { return [lerp(p[0], b[i][0], t), lerp(p[1], b[i][1], t)]; });
  }
  function blob(x, y, w, h, gap) {
    gap = gap || 0;
    return [
      [x, y], [x + w, y], [x + w, y + h], [x, y + h]
    ].map(function (p) { return [p[0], p[1] + gap]; });
  }

  var L = [[20, 18], [95, 18], [95, 92], [20, 92]];
  var R0 = [[145, 18], [220, 18], [220, 92], [145, 92]];
  var Rclose = [[108, 18], [183, 18], [183, 92], [108, 92]];
  var Rfar = [[170, 18], [245, 18], [245, 92], [170, 92]];
  var Rover = [[70, 18], [145, 18], [145, 92], [70, 92]];

  var DEMOS = {
    link: function (g, t) {
      fillPoly(g, 'a', L, 'rgba(79,176,224,.25)', '#4fb0e0');
      fillPoly(g, 'b', R0, 'rgba(232,162,58,.25)', '#e8a23a');
      var links = [];
      if (t > 0.2) {
        for (var y = 28; y <= 82; y += 18) links.push([[95, y], [145, y]]);
      }
      links.forEach(function (seg, i) {
        poly(g, 'l' + i, seg, t > 0.2 ? '#6ee7b7' : 'transparent', 1.4);
      });
    },
    coast: function (g, t) {
      var live = [[20, 18], [95, 18 + 10 * t], [95, 92 - 10 * t], [20, 92]];
      fillPoly(g, 'a', live, 'rgba(79,176,224,.25)', '#4fb0e0');
      fillPoly(g, 'b', R0, 'rgba(232,162,58,.25)', '#e8a23a');
      poly(g, 'fr', [[20, 18], [20, 92]], '#ff7ad9', 2.4);
    },
    anchor: function (g, t) {
      var mid = 18 + 14 * t;
      fillPoly(g, 'a', [[20, 18], [95, mid], [95, 92 - 14 * t], [20, 92]], 'rgba(79,176,224,.25)', '#4fb0e0');
      fillPoly(g, 'b', R0, 'rgba(232,162,58,.25)', '#e8a23a');
      var d = g.querySelector('.dots');
      if (!d) { d = el('g', { 'class': 'dots' }); g.appendChild(d); }
      while (d.childNodes.length < 2) d.appendChild(el('circle', { r: 3.2, fill: '#ff7ad9' }));
      d.childNodes[0].setAttribute('cx', 95); d.childNodes[0].setAttribute('cy', 18);
      d.childNodes[1].setAttribute('cx', 95); d.childNodes[1].setAttribute('cy', 92);
    },
    turn: function (g, t) {
      var k = 18 + 22 * t;
      var a = [[20, 20], [80, 20], [80, k], [80, 92], [20, 92]];
      var b = [[160, 20], [220, 20], [220, 92], [160, 92], [160, k]];
      fillPoly(g, 'a', a, 'rgba(79,176,224,.25)', '#4fb0e0');
      fillPoly(g, 'b', b, 'rgba(232,162,58,.25)', '#e8a23a');
    },
    nbturn: function (g, t) {
      var k = 18 + 22 * t;
      var a = [[20, 20], [80, 20], [80, k], [80, 92], [20, 92]];
      var b = [[160, 20], [220, 20], [220, 92], [160, 92], [160, 110 - k]];
      fillPoly(g, 'a', a, 'rgba(79,176,224,.25)', '#4fb0e0');
      fillPoly(g, 'b', b, 'rgba(232,162,58,.25)', '#e8a23a');
    },
    lock: function (g, t) {
      var gap = lerp(18, 5, Math.min(1, t / 0.7));
      if (t > 0.7) gap = 5;
      var b = [[100 + gap, 18], [175 + gap, 18], [175 + gap, 92], [100 + gap, 92]];
      fillPoly(g, 'a', L, 'rgba(79,176,224,.25)', '#4fb0e0');
      fillPoly(g, 'b', b, 'rgba(232,162,58,.25)', '#e8a23a');
      poly(g, 'band', [[95, 18], [95, 92], [100, 92], [100, 18]], t > 0.7 ? '#6ee7b7' : 'rgba(110,231,183,.35)', 2);
    },
    step: function (g, t) {
      var hops = Math.max(1, Math.round(lerp(6, 2, t)));
      var x = 95 + (50 * (Math.floor(t * hops) / hops));
      fillPoly(g, 'a', L, 'rgba(79,176,224,.25)', '#4fb0e0');
      fillPoly(g, 'b', R0, 'rgba(232,162,58,.25)', '#e8a23a');
      var c = g.querySelector('.dot');
      if (!c) { c = el('circle', { 'class': 'dot', r: 4, fill: '#4fb0e0' }); g.appendChild(c); }
      c.setAttribute('cx', x); c.setAttribute('cy', 55);
    },
    spring: function (g, t) {
      var gap = lerp(22, 5, t);
      var b = [[95 + gap, 18], [170 + gap, 18], [170 + gap, 92], [95 + gap, 92]];
      fillPoly(g, 'a', L, 'rgba(79,176,224,.25)', '#4fb0e0');
      fillPoly(g, 'b', b, 'rgba(232,162,58,.25)', '#e8a23a');
    },
    share: function (g, t) {
      var left = 20 - 8 * t, right = 145 - 16 * (1 - t);
      fillPoly(g, 'a', [[left, 18], [left + 75, 18], [left + 75, 92], [left, 92]], 'rgba(79,176,224,.25)', '#4fb0e0');
      fillPoly(g, 'b', [[right, 18], [right + 75, 18], [right + 75, 92], [right, 92]], 'rgba(232,162,58,.25)', '#e8a23a');
    },
    overlap: function (g, t) {
      var x = lerp(70, 145, t);
      fillPoly(g, 'a', L, 'rgba(79,176,224,.25)', '#4fb0e0');
      fillPoly(g, 'b', [[x, 18], [x + 75, 18], [x + 75, 92], [x, 92]], 'rgba(232,162,58,.25)', '#e8a23a');
    },
    far: function (g, t) {
      var x = lerp(175, 125, t);
      fillPoly(g, 'a', L, 'rgba(79,176,224,.25)', '#4fb0e0');
      fillPoly(g, 'b', [[x, 18], [x + 75, 18], [x + 75, 92], [x, 92]], 'rgba(232,162,58,.25)', '#e8a23a');
    },
    normal: function (g, t) {
      fillPoly(g, 'a', L, 'rgba(79,176,224,.25)', '#4fb0e0');
      fillPoly(g, 'b', R0, 'rgba(232,162,58,.25)', '#e8a23a');
      poly(g, 'n', [[95, 55], [95 + 40 * t, 55]], '#6ee7b7', 2.4);
    },
    eq: function (g, t) {
      var g1 = lerp(3, 5, t), g2 = lerp(12, 5, t), g3 = lerp(7, 5, t);
      var a = [[20, 18], [95, 18], [95, 40], [95, 62], [95, 92], [20, 92]];
      var b = [[95 + g1, 18], [220, 18], [220, 92], [95 + g3, 92], [95 + g2, 62], [95 + g1, 40]];
      fillPoly(g, 'a', a, 'rgba(79,176,224,.25)', '#4fb0e0');
      fillPoly(g, 'b', b, 'rgba(232,162,58,.25)', '#e8a23a');
    },
    smooth: function (g, t) {
      var jag = [[20, 18], [95, 18], [88, 40], [100, 55], [86, 72], [95, 92], [20, 92]];
      var sm = [[20, 18], [95, 18], [95, 40], [95, 55], [95, 72], [95, 92], [20, 92]];
      fillPoly(g, 'a', lerpPts(jag, sm, t), 'rgba(79,176,224,.25)', '#4fb0e0');
      fillPoly(g, 'b', R0, 'rgba(232,162,58,.25)', '#e8a23a');
    },
    fillet: function (g, t) {
      var sharp = [[20, 20], [80, 20], [80, 90], [20, 90]];
      var rnd = [[20, 20], [68, 20]];
      var r = lerp(0, 18, t);
      for (var s = 0; s <= 8; s++) {
        var u = s / 8, w = 1 - u;
        rnd.push([68 + r * (1 - w * w), 20 + r * (1 - (1 - u) * (1 - u))]);
      }
      rnd.push([80, 38], [80, 90], [20, 90]);
      fillPoly(g, 'a', t > 0.15 ? rnd : sharp, 'rgba(79,176,224,.25)', '#4fb0e0');
      fillPoly(g, 'b', [[150, 20], [220, 20], [220, 90], [150, 90]], 'rgba(232,162,58,.25)', '#e8a23a');
    },
    spline: function (g, t) {
      var raw = [[20, 70], [60, 30], [100, 70], [140, 30], [180, 70], [220, 40]];
      var soft = raw.map(function (p, i) {
        if (i === 0 || i === raw.length - 1) return p;
        var a = raw[i - 1], c = raw[i + 1];
        return [p[0] * 0.4 + (a[0] + c[0]) * 0.3, p[1] * 0.4 + (a[1] + c[1]) * 0.3];
      });
      poly(g, 'g0', raw, 'rgba(120,140,155,.4)', 1.4);
      poly(g, 'g1', lerpPts(raw, soft, t), '#4fb0e0', 2.4);
    },
    triple: function (g, t) {
      fillPoly(g, 'a', [[20, 70], [90, 20], [90, 90]], 'rgba(79,176,224,.3)', '#4fb0e0');
      fillPoly(g, 'b', [[150, 20], [220, 70], [150, 90]], 'rgba(232,162,58,.3)', '#e8a23a');
      fillPoly(g, 'c', [[90, 95], [150, 95], [120, 130]], 'rgba(110,231,183,.3)', '#6ee7b7');
      var d = g.querySelector('.node');
      if (!d) { d = el('circle', { 'class': 'node', r: 4, fill: '#fff' }); g.appendChild(d); }
      d.setAttribute('cx', 120); d.setAttribute('cy', 78);
      d.setAttribute('opacity', t > 0.35 ? 1 : 0);
    },
    socket: function (g, t) {
      var s = 8 + 14 * t;
      fillPoly(g, 'a', [[20, 70], [90, 20], [90, 78 - s / 3]], 'rgba(79,176,224,.3)', '#4fb0e0');
      fillPoly(g, 'b', [[150, 20], [220, 70], [150, 78 - s / 3]], 'rgba(232,162,58,.3)', '#e8a23a');
      fillPoly(g, 'c', [[90, 95 + s / 4], [150, 95 + s / 4], [120, 130]], 'rgba(110,231,183,.3)', '#6ee7b7');
    },
    preserve: function (g, t) {
      var gray = L;
      var drift = [[20, 18], [95 + 16 * t, 18], [95 + 16 * t, 92], [20, 92]];
      var back = lerpPts(drift, gray, t > 0.55 ? (t - 0.55) / 0.45 : 0);
      fillPoly(g, 'g0', gray, 'rgba(120,140,155,.2)', 'rgba(120,140,155,.5)');
      fillPoly(g, 'a', back, 'rgba(79,176,224,.3)', '#4fb0e0');
    },
    area: function (g, t) {
      var k = lerp(1, 0.72, Math.min(1, t * 1.4));
      if (t > 0.6) k = lerp(0.72, 0.92, (t - 0.6) / 0.4);
      var cx = 120, cy = 55, w = 50 * k, h = 36 * k;
      fillPoly(g, 'a', [[cx - w, cy - h], [cx + w, cy - h], [cx + w, cy + h], [cx - w, cy + h]], 'rgba(79,176,224,.3)', '#4fb0e0');
    },
    pinch: function (g, t) {
      var neck = lerp(6, 16, t);
      var y1 = 50 - neck / 2, y2 = 50 + neck / 2;
      fillPoly(g, 'a', [[20, 18], [90, 18], [90, y1], [40, y1], [40, y2], [90, y2], [90, 92], [20, 92]], 'rgba(79,176,224,.3)', '#4fb0e0');
    },
    loop: function (g, t) {
      var looped = [[30, 50], [80, 20], [140, 70], [90, 85], [70, 45], [160, 30], [210, 70]];
      var cut = [[30, 50], [80, 20], [160, 30], [210, 70]];
      poly(g, 'g0', looped, 'rgba(120,140,155,.4)', 1.5);
      poly(g, 'g1', t > 0.5 ? cut : looped, '#4fb0e0', 2.4);
    },
    spike: function (g, t) {
      var spike = [[30, 80], [110, 80], [120, 22], [130, 80], [210, 80]];
      var open = [[30, 80], [105, 80], [125, 50], [145, 80], [210, 80]];
      poly(g, 'g0', spike, 'rgba(120,140,155,.4)', 1.5);
      poly(g, 'g1', lerpPts(spike, open, t), '#4fb0e0', 2.4);
    }
  };

  function drawDemo(kind, t) {
    if (!svg) return;
    var g = svg.querySelector('.origin');
    if (!g) {
      g = el('g', { 'class': 'origin', transform: 'translate(0,55)' });
      svg.appendChild(g);
    }
    var fn = DEMOS[kind];
    if (fn) fn(g, t);
  }
  function stop() { if (tl) { tl.kill(); tl = null; } }
  function sliderT(id) {
    var el = document.getElementById(id);
    if (!el) {
      var types = window.SeamStack && window.SeamStack.TYPES;
      var meta = types && types[id];
      var pid = meta && meta.params && meta.params[0];
      if (pid && pid !== id) return sliderT(pid);
      return 0.7;
    }
    if (el.min === '' || el.max === '') return 0.7;
    var min = +el.min, max = +el.max, v = +el.value;
    if (!(max > min)) return 0.5;
    return (v - min) / (max - min);
  }
  function valueLabel(id) {
    var el = document.getElementById(id);
    if (el) return id + ' = ' + el.value;
    var h = HELP[id];
    return h ? h.title : id;
  }
  function helpIdFrom(node) {
    if (!node || !node.closest) return null;
    var q = node.closest('.qhelp');
    if (q) return q.getAttribute('data-help');
    var card = node.closest('.knob');
    if (!card) return null;
    var b = card.querySelector('.qhelp');
    return b ? b.getAttribute('data-help') : null;
  }
  function markActive(id) {
    document.querySelectorAll('#pluginKnobs .knob').forEach(function (card) {
      var b = card.querySelector('.qhelp');
      var on = b && b.getAttribute('data-help') === id;
      card.classList.toggle('is-active', !!on);
      if (b) b.setAttribute('aria-expanded', on ? 'true' : 'false');
    });
  }
  function replay() {
    if (!currentId || !HELP[currentId]) return;
    var h = HELP[currentId];
    var peak = Math.max(0.08, sliderT(currentId));
    stop();
    target.t = 0;
    if (svg) while (svg.firstChild) svg.removeChild(svg.firstChild);
    drawDemo(h.demo, 0);
    var gsap = window.gsap;
    if (gsap) {
      tl = gsap.timeline({ repeat: -1, yoyo: true });
      tl.fromTo(target, { t: 0 }, {
        t: peak, duration: 0.55 + peak * 1.1, ease: 'sine.inOut',
        onUpdate: function () { drawDemo(h.demo, target.t); }
      });
    } else drawDemo(h.demo, peak);
  }
  function select(id) {
    var h = HELP[id];
    if (!h) {
      var types = window.SeamStack && window.SeamStack.TYPES;
      var meta = types && types[id];
      if (meta && meta.help) h = HELP[meta.help];
    }
    if (!h) return;
    currentId = HELP[id] ? id : ((window.SeamStack && window.SeamStack.TYPES[id] && window.SeamStack.TYPES[id].help) || id);
    if (!HELP[currentId]) currentId = id;
    h = HELP[currentId] || h;
    markActive(currentId);
    if (titleEl) titleEl.textContent = h.title;
    if (bodyEl) bodyEl.textContent = h.body;
    if (valEl) valEl.textContent = valueLabel(currentId);
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
    window.SeamHelp = { select: select, refresh: refresh };
    var st = window.SeamStack && window.SeamStack.STACK;
    select((st && st[0] && st[0].type) || 'gapSpring');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
