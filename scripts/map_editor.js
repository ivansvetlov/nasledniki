(function () {
  var svg = document.querySelector("#stage svg:not(#ruler)");
  var canvas = document.getElementById("draw");
  var viewport = document.getElementById("viewport");
  var stage = document.getElementById("stage");
  var layersEl = document.getElementById("layers");
  var hint = document.getElementById("hint");
  var thickEl = document.getElementById("thick");
  var thickVal = document.getElementById("thick-val");
  var fillEl = document.getElementById("fill");
  var nameEl = document.getElementById("prop-name");
  if (!svg || !canvas || !viewport) return;

  var vb = svg.viewBox.baseVal;
  var W = vb.width, H = vb.height;
  canvas.width = W;
  canvas.height = H;
  stage.style.width = W + "px";
  stage.style.height = H + "px";
  var ctx = canvas.getContext("2d");
  var labels = new Uint16Array(W * H);
  var MIN_BLOB = 48;
  var MIN_FRAG = 12;
  var GAP_DEFAULT = 3;
  var gapPx = GAP_DEFAULT;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  var mode = "pick";
  var target = null;
  var targetFill = null;
  var selected = [];
  var fragSeq = 0;
  var drawing = false;
  var ruler = { a: null, b: null, live: false };
  var magnetOn = true;
  var pan = { x: 0, y: 0, s: 1 };
  var panning = false;
  var pan0 = { x: 0, y: 0, px: 0, py: 0 };
  var space = false;
  var handMode = false;
  var handSticky = false;
  var lastTap = 0;
  var lastTapX = 0;
  var lastTapY = 0;
  var pendingTap = false;
  var pendingHand = false;
  var press = { t: 0, x: 0, y: 0, maxd: 0 };
  var undoStack = [];
  var redoStack = [];
  var actionSeq = 0;
  var journalOpen = false;
  var layersOpen = true;
  var layerSeq = 1;
  var layerList = [];
  var activeLayerId = 1;
  var sketchSeq = 0;
  var textSeq = 0;
  var strokePts = [];
  var pendingText = false;
  var textDrag = null;
  var selectedObj = null;

  function paths() {
    return Array.prototype.slice.call(
      svg.querySelectorAll("path[data-name]:not([data-kind])")
    );
  }
  function thickness() {
    var n = parseFloat(thickEl.value);
    if (!isFinite(n) || n <= 0) return 0.25;
    return n;
  }
  function formatThick(n) {
    return n < 1 ? n.toFixed(2).replace(/0+$/, "").replace(/\.$/, "") : String(n);
  }
  function strokeWidth() {
    if (mode === "knife") return Math.max(1, gapPx);
    return thickness();
  }
  function inkAlphaMin() {
    if (mode === "knife") return 90;
    return strokeWidth() < 1 ? 16 : 40;
  }
  function inkHits(ink, j) {
    return ink[j + 3] > inkAlphaMin();
  }
  function syncThickUi() {
    var lock = mode === "knife";
    if (thickEl) thickEl.disabled = lock;
    var lab = thickEl && thickEl.closest ? thickEl.closest(".thick") : null;
    if (lab) lab.classList.toggle("locked", lock);
    if (!thickVal) return;
    thickVal.textContent = lock ? "щель " + gapPx : formatThick(thickness());
  }
  thickEl.addEventListener("input", syncThickUi);
  syncThickUi();

  function setMode(m) {
    if (m !== "ruler") clearRuler();
    handSticky = false;
    setHand(false);
    mode = m;
    canvas.style.pointerEvents =
      handMode || m !== "pick" ? "auto" : "none";
    ["pick", "pen", "erase", "knife", "ruler", "marker"].forEach(function (id) {
      var b = document.getElementById("btn-" + id);
      if (b) b.classList.toggle("on", mode === id);
    });
    viewport.classList.toggle("draw", mode !== "pick" && mode !== "ruler");
    viewport.classList.toggle("ruler", mode === "ruler");
    syncThickUi();
    if (hint) {
      if (m === "knife")
        hint.textContent =
          "нож — рез толщиной щели карты (" + gapPx + " px), не кисть";
      else if (m === "erase")
        hint.textContent = "ластик — стереть в подложку, толщина кисти";
      else if (m === "ruler")
        hint.textContent = magnetOn
          ? "клик — точка, веди мышь, второй клик — готово (магнит к кромке)"
          : "клик — точка, веди мышь, второй клик — готово";
      else if (m === "pen")
        hint.textContent = target
          ? "карандаш: «" +
            short(target) +
            "» · клик по другому району — сменить, веди — рисовать"
          : "клик по району — выбрать, веди — рисовать (P — карандаш, не надо на указатель)";
      else if (m === "marker")
        hint.textContent =
          "маркер: нарисуй линию/контур поверх карты — она сохранится как подсказка";
    }
  }

  function applyTransform() {
    stage.style.transform =
      "translate(" + pan.x + "px," + pan.y + "px) scale(" + pan.s + ")";
    if (ruler.a) renderRuler();
  }
  function fit() {
    var r = viewport.getBoundingClientRect();
    var pad = 48;
    var s = Math.min((r.width - pad) / W, (r.height - pad) / H);
    pan.s = Math.max(0.15, s);
    pan.x = (r.width - W * pan.s) / 2;
    pan.y = (r.height - H * pan.s) / 2;
    applyTransform();
  }
  fit();
  window.addEventListener("resize", fit);

  viewport.addEventListener(
    "wheel",
    function (e) {
      e.preventDefault();
      var r = viewport.getBoundingClientRect();
      var cx = e.clientX - r.left;
      var cy = e.clientY - r.top;
      var old = pan.s;
      var next = old * (e.deltaY > 0 ? 0.92 : 1.08);
      next = Math.max(0.12, Math.min(8, next));
      pan.x = cx - (cx - pan.x) * (next / old);
      pan.y = cy - (cy - pan.y) * (next / old);
      pan.s = next;
      applyTransform();
    },
    { passive: false }
  );

  var momentaryHand = false;
  var ignoreClicksUntil = 0;
  function clicksBlocked() {
    return panning || handMode || Date.now() < ignoreClicksUntil;
  }
  function setHand(on) {
    handMode = !!on;
    viewport.classList.toggle("hand", handMode);
    var hb = document.getElementById("btn-hand");
    if (hb) hb.classList.toggle("on", handMode);
    canvas.style.pointerEvents =
      handMode || mode !== "pick" ? "auto" : "none";
  }
  function isChrome(el) {
    return !!(
      el &&
      el.closest &&
      el.closest("button,.dock,.layer,.rail,.left,#xy,input,label,#ctx-menu")
    );
  }
  function startDragPan(e) {
    ignoreClicksUntil = Date.now() + 800;
    setHand(true);
    panning = true;
    try {
      viewport.setPointerCapture(e.pointerId);
    } catch (err) {}
    pan0 = { x: pan.x, y: pan.y, px: e.clientX, py: e.clientY };
    viewport.classList.add("panning");
  }
  viewport.addEventListener(
    "pointerdown",
    function (e) {
      if (e.ctrlKey || e.metaKey) return;
      if (isChrome(e.target)) return;
      press = { t: Date.now(), x: e.clientX, y: e.clientY, maxd: 0 };
      if (handSticky || handMode) {
        pendingTap = false;
        pendingHand = false;
        e.preventDefault();
        e.stopPropagation();
        startDragPan(e);
        return;
      }
      var wantHoldPan =
        space || e.button === 1 || (e.button === 0 && e.altKey);
      if (wantHoldPan) {
        pendingTap = false;
        pendingHand = false;
        startDragPan(e);
        return;
      }
      if (e.button !== 0) return;
      var now = Date.now();
      var slop = e.pointerType === "touch" ? 44 : 32;
      if (
        lastTap &&
        now - lastTap < 900 &&
        Math.abs(e.clientX - lastTapX) < slop &&
        Math.abs(e.clientY - lastTapY) < slop
      ) {
        pendingHand = true;
        pendingTap = false;
        lastTap = 0;
        return;
      }
      pendingHand = false;
      pendingTap = true;
      lastTap = now;
      lastTapX = e.clientX;
      lastTapY = e.clientY;
    },
    true
  );
  viewport.addEventListener("pointermove", function (e) {
    if (textDrag) {
      var tp = pos(e);
      var nx = textDrag.ox + (tp.x - textDrag.x0);
      var ny = textDrag.oy + (tp.y - textDrag.y0);
      if (!textDrag.moved && Math.abs(tp.x - textDrag.x0) + Math.abs(tp.y - textDrag.y0) > 1) {
        snapshotPaths("текст");
        textDrag.moved = true;
      }
      textDrag.el.setAttribute("x", nx.toFixed(1));
      textDrag.el.setAttribute("y", ny.toFixed(1));
      return;
    }
    if (press.t) {
      var dd = Math.hypot(e.clientX - press.x, e.clientY - press.y);
      if (dd > press.maxd) press.maxd = dd;
    }
    if (pendingHand && press.maxd > 8) {
      pendingHand = false;
      momentaryHand = true;
      cancelDrawing();
      e.preventDefault();
      e.stopPropagation();
      startDragPan(e);
      return;
    }
    if (mode === "ruler" && ruler.live && !panning && !isChrome(e.target)) {
      ruler.b = snapPoint(e, ruler.a && ruler.a.id);
      renderRuler();
    }
    if (!panning) return;
    pan.x = pan0.x + (e.clientX - pan0.px);
    pan.y = pan0.y + (e.clientY - pan0.py);
    applyTransform();
  });
  function endPan(e) {
    pendingTap = false;
    if (!panning) return;
    var wasMomentary = momentaryHand;
    panning = false;
    momentaryHand = false;
    viewport.classList.remove("panning");
    if (handSticky) {
      ignoreClicksUntil = Date.now() + 200;
      setHand(true);
    } else if (wasMomentary || handMode) {
      ignoreClicksUntil = Date.now() + 300;
      setHand(false);
    }
  }
  function onViewportUp(e) {
    if (textDrag) textDrag = null;
    pendingHand = false;
    if (panning) {
      endPan(e);
      press.t = 0;
      return;
    }
    if (press.maxd > 18) lastTap = 0;
    press.t = 0;
  }
  viewport.addEventListener("pointerup", onViewportUp);
  viewport.addEventListener("pointercancel", onViewportUp);
  viewport.addEventListener(
    "click",
    function (e) {
      if (isChrome(e.target)) return;
      if (clicksBlocked()) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    true
  );

  window.addEventListener("keydown", function (e) {
    if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    if (e.code === "Space") {
      space = true;
      e.preventDefault();
      viewport.classList.add("hand");
    }
    if (
      (e.ctrlKey || e.metaKey) &&
      (e.code === "KeyZ" || e.key === "z" || e.key === "Z" || e.key === "я" || e.key === "Я")
    ) {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    }
    if (
      (e.ctrlKey || e.metaKey) &&
      (e.code === "KeyY" || e.key === "y" || e.key === "Y" || e.key === "н" || e.key === "Н")
    ) {
      e.preventDefault();
      redo();
    }
    if (e.code === "KeyV") {
      e.preventDefault();
      setMode("pick");
    }
    if (e.code === "KeyP") {
      e.preventDefault();
      setMode("pen");
    }
    if (e.code === "KeyE") {
      e.preventDefault();
      setMode("erase");
    }
    if (e.code === "KeyK") {
      e.preventDefault();
      setMode("knife");
    }
    if (e.code === "KeyR") {
      e.preventDefault();
      setMode("ruler");
    }
    if (e.code === "KeyB") {
      e.preventDefault();
      setMode("marker");
    }
    if (e.code === "KeyH") {
      e.preventDefault();
      var hb = document.getElementById("btn-hand");
      if (hb) hb.click();
    }
    if (e.code === "KeyT") {
      e.preventDefault();
      pendingText = true;
      if (hint) hint.textContent = "клик на карте — текст на текущем слое";
    }
    if (e.code === "KeyM") {
      e.preventDefault();
      mergeSelected();
    }

    if (e.key === "Escape") {
      e.preventDefault();
      if (document.getElementById("ctx-menu")) {
        hideCtx();
        return;
      }
      if (ruler.a) {
        clearRuler();
        return;
      }
      if (selected.length) {
        selectDistrict(null, false);
        setMode("pick");
      }
    }
  });
  window.addEventListener("keyup", function (e) {
    if (e.code === "Space") {
      space = false;
      viewport.classList.remove("hand");
    }
  });

  function selectDistrict(name, additive) {
    if (!name) {
      selected = [];
      target = null;
    } else if (additive) {
      var ix = selected.indexOf(name);
      if (ix >= 0) selected.splice(ix, 1);
      else selected.push(name);
      target = selected[selected.length - 1] || null;
    } else if (selected.length === 1 && selected[0] === name) {
      selected = [];
      target = null;
    } else {
      selected = [name];
      target = name;
    }
    paths().forEach(function (p) {
      var on = selected.indexOf(p.getAttribute("data-name")) >= 0;
      p.classList.toggle("sel", on);
      if (p.getAttribute("data-name") === target)
        targetFill = p.getAttribute("fill");
    });
    document.querySelectorAll(".layer").forEach(function (el) {
      el.classList.toggle(
        "on",
        selected.indexOf(el.getAttribute("data-name")) >= 0
      );
    });
    if (nameEl)
      nameEl.textContent = selected.length
        ? selected.map(short).join(" + ")
        : "Ничего не выбрано";
    if (fillEl && targetFill) fillEl.value = toHex(targetFill);
    if (hint)
      hint.textContent = selected.length
        ? selected.length > 1
          ? canMergeSelection()
            ? "ПКМ → объединить"
            : "разные слои — объединить нельзя"
          : "карандаш отдаёт землю «" + short(target) + "», нож режет щель"
        : "выберите район";
    fillZoneLayerSelect();
  }

  function short(n) {
    return String(n || "")
      .replace(/\s*муниципальный район$/i, "")
      .replace(/\s*муниципальный округ$/i, "")
      .replace(/\s*городской округ$/i, "")
      .replace(/^городской округ\s+/i, "")
      .replace(/\s*район$/i, "");
  }
  function toHex(c) {
    if (!c) return "#cccccc";
    if (c[0] === "#") return c.length === 4
      ? "#" + c[1] + c[1] + c[2] + c[2] + c[3] + c[3]
      : c;
    return "#888888";
  }
  function paintColor() {
    if (fillEl && fillEl.value) return fillEl.value;
    if (targetFill) return toHex(targetFill);
    return "#6b8f71";
  }

  function layerById(id) {
    for (var i = 0; i < layerList.length; i++)
      if (layerList[i].id === id) return layerList[i];
    return null;
  }
  function layerGroup(id) {
    return svg.querySelector('[data-layer-id="' + id + '"]');
  }
  function nsG() {
    return document.createElementNS("http://www.w3.org/2000/svg", "g");
  }
  function syncLayerOrder() {
    var stack = svg.querySelector("#layer-stack");
    if (!stack) return;
    layerList.forEach(function (L) {
      var g = layerGroup(L.id);
      if (g) stack.appendChild(g);
    });
  }
  function applyLayerVisibility() {
    layerList.forEach(function (L) {
      var g = layerGroup(L.id);
      if (!g) return;
      g.style.display = L.visible ? "" : "none";
      g.style.pointerEvents = L.locked || !L.visible ? "none" : "";
    });
  }
  function selectObj(el) {
    svg.querySelectorAll("[data-kind].sel").forEach(function (x) {
      x.classList.remove("sel");
    });
    selectedObj = el || null;
    if (el) {
      el.classList.add("sel");
      var lid = el.parentNode && el.parentNode.getAttribute("data-layer-id");
      if (lid) activeLayerId = parseInt(lid, 10);
      if (nameEl) nameEl.textContent = el.getAttribute("data-label") || "текст";
    }
  }
  function bindOverlayClicks() {
    svg.querySelectorAll("path[data-kind],text[data-kind]").forEach(function (el) {
      el.onmousedown = el.onpointerdown = null;
      el.onclick = function (e) {
        if (mode !== "pick" || space || clicksBlocked()) return;
        e.stopPropagation();
        selectDistrict(null, false);
        selectObj(el);
        buildLayers();
      };
      el.ondblclick = function (e) {
        if (el.tagName.toLowerCase() !== "text") return;
        e.stopPropagation();
        e.preventDefault();
        editTextEl(el);
      };
      el.onpointerdown = function (e) {
        if (mode !== "pick" || space || e.button !== 0 || clicksBlocked()) return;
        if (el.tagName.toLowerCase() !== "text") return;
        e.stopPropagation();
        selectDistrict(null, false);
        selectObj(el);
        var p = pos(e);
        textDrag = {
          el: el,
          x0: p.x,
          y0: p.y,
          ox: parseFloat(el.getAttribute("x")) || 0,
          oy: parseFloat(el.getAttribute("y")) || 0,
          moved: false,
        };
        try {
          el.setPointerCapture(e.pointerId);
        } catch (err) {}
      };
    });
  }
  function initLayers() {
    var stack = svg.querySelector("#layer-stack");
    var regions = svg.querySelector("#regions");
    if (!regions) {
      regions = nsG();
      regions.setAttribute("id", "regions");
      Array.prototype.slice
        .call(svg.querySelectorAll("path[data-name]:not([data-kind])"))
        .forEach(function (p) {
          regions.appendChild(p);
        });
      var bg = svg.querySelector("rect");
      if (bg && bg.nextSibling) svg.insertBefore(regions, bg.nextSibling);
      else svg.appendChild(regions);
    }
    if (!stack) {
      stack = nsG();
      stack.setAttribute("id", "layer-stack");
      regions.parentNode.insertBefore(stack, regions);
      Array.prototype.slice
        .call(svg.querySelectorAll("g[data-layer-id]"))
        .forEach(function (g) {
          if (g === regions || g === stack) return;
          stack.appendChild(g);
        });
      stack.appendChild(regions);
    }
    regions.setAttribute("data-layer-id", regions.getAttribute("data-layer-id") || "1");
    regions.setAttribute("data-layer-type", "body");
    if (!regions.getAttribute("data-layer-name"))
      regions.setAttribute("data-layer-name", "Районы");
    var discovered = [];
    Array.prototype.slice.call(stack.children).forEach(function (g) {
      if (!g.getAttribute || !g.getAttribute("data-layer-id")) return;
      var id = parseInt(g.getAttribute("data-layer-id"), 10);
      if (!id) return;
      var nm =
        g.getAttribute("data-layer-name") ||
        (g.getAttribute("id") === "water"
          ? "Вода"
          : g.getAttribute("id") === "regions"
            ? "Районы"
            : "Слой " + id);
      discovered.push({
        id: id,
        name: nm,
        type: g.getAttribute("data-layer-type") || "body",
        visible: true,
        locked: false,
        collapsed: false,
      });
    });
    if (discovered.length) {
      layerList = discovered;
      layerSeq = discovered.reduce(function (m, L) {
        return Math.max(m, L.id);
      }, 1);
    } else {
      layerSeq = 1;
      layerList = [
        {
          id: 1,
          name: "Районы",
          type: "body",
          visible: true,
          locked: false,
          collapsed: false,
        },
      ];
    }
    activeLayerId = 1;
    applyLayerVisibility();
  }
  function addEditorLayer(typ) {
    snapshotPaths("новый слой");
    layerSeq++;
    var id = layerSeq;
    var L = {
      id: id,
      name: "Слой " + id,
      type: "layer",
      visible: true,
      locked: false,
      collapsed: false,
    };
    layerList.push(L);
    activeLayerId = id;
    var g = nsG();
    g.setAttribute("data-layer-id", String(id));
    g.setAttribute("data-layer-type", "layer");
    var stack = svg.querySelector("#layer-stack");
    if (stack) stack.appendChild(g);
    selectDistrict(null, false);
    buildLayers();
    if (hint)
      hint.textContent = "новый слой · T или ПКМ — текст, карандаш рисует сюда";
    return id;
  }
  function deleteEditorLayer(id) {
    var L = layerById(id);
    if (!L) return;
    var others = layerList.filter(function (x) {
      return x.id !== id;
    });
    var g = layerGroup(id);
    var held = g
      ? Array.prototype.slice.call(
          g.querySelectorAll("path[data-name]:not([data-kind])")
        )
      : [];
    if (held.length && !others.length) {
      if (hint) hint.textContent = "нельзя удалить последний слой с районами";
      return;
    }
    snapshotPaths("удалить слой");
    if (others.length && g) {
      var dest = layerGroup(others[others.length - 1].id);
      if (dest) {
        while (g.firstChild) dest.appendChild(g.firstChild);
      }
    }
    if (g) g.remove();
    layerList = layerList.filter(function (x) {
      return x.id !== id;
    });
    if (activeLayerId === id)
      activeLayerId = layerList.length ? layerList[layerList.length - 1].id : 1;
    buildLayers();
  }
  function raiseLayer(id, dir) {
    var i = -1;
    for (var k = 0; k < layerList.length; k++)
      if (layerList[k].id === id) i = k;
    var j = i + dir;
    if (i < 0 || j < 0 || j >= layerList.length) return;
    snapshotPaths("порядок слоёв");
    var t = layerList[i];
    layerList[i] = layerList[j];
    layerList[j] = t;
    syncLayerOrder();
    buildLayers();
  }
  function moveElToLayer(el, layerId, silent) {
    var L = layerById(layerId);
    var g = layerGroup(layerId);
    if (!el || !g || !L || L.locked) return;
    if (!silent) snapshotPaths("на слой «" + L.name + "»");
    g.appendChild(el);
    activeLayerId = layerId;
    buildLayers();
  }
  function moveZoneToLayer(name, layerId) {
    var L = layerById(layerId);
    if (!L) return;
    snapshotPaths("на слой «" + L.name + "»");
    paths().forEach(function (p) {
      if (p.getAttribute("data-name") === name) moveElToLayer(p, layerId, true);
    });
  }
  function startRenameLayer(L, labEl) {
    if (!L) return;
    if (!labEl) {
      var n = window.prompt("имя слоя", L.name);
      if (n && String(n).trim() && String(n).trim() !== L.name) {
        snapshotPaths("имя слоя");
        L.name = String(n).trim();
        buildLayers();
      }
      return;
    }
    var inp = document.createElement("input");
    inp.type = "text";
    inp.className = "ln-edit";
    inp.value = L.name;
    inp.setAttribute("aria-label", "имя слоя");
    labEl.replaceWith(inp);
    inp.focus();
    inp.select();
    var done = false;
    function commit() {
      if (done) return;
      done = true;
      var n = String(inp.value || "").trim();
      if (n && n !== L.name) {
        snapshotPaths("имя слоя");
        L.name = n;
      }
      buildLayers();
    }
    inp.addEventListener("blur", commit);
    inp.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        inp.blur();
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        inp.value = L.name;
        inp.blur();
      }
    });
  }
  function hideCtx() {
    var m = document.getElementById("ctx-menu");
    if (m) m.parentNode.removeChild(m);
  }
  function showCtx(cx, cy, items) {
    hideCtx();
    if (!items || !items.length) return;
    var m = document.createElement("div");
    m.id = "ctx-menu";
    items.forEach(function (it) {
      if (it.sep) {
        var hr = document.createElement("div");
        hr.className = "sep";
        m.appendChild(hr);
        return;
      }
      var b = document.createElement("button");
      b.type = "button";
      if (it.checked) b.className = "on";
      if (it.disabled) b.disabled = true;
      b.textContent = (it.checked ? "✓ " : "") + it.label;
      b.onclick = function (e) {
        e.stopPropagation();
        if (it.disabled) return;
        hideCtx();
        if (it.run) it.run();
      };
      m.appendChild(b);
    });
    document.body.appendChild(m);
    var r = m.getBoundingClientRect();
    var x = cx;
    var y = cy;
    if (x + r.width > window.innerWidth - 8) x = window.innerWidth - r.width - 8;
    if (y + r.height > window.innerHeight - 8)
      y = window.innerHeight - r.height - 8;
    if (x < 8) x = 8;
    if (y < 8) y = 8;
    m.style.left = x + "px";
    m.style.top = y + "px";
  }
  function zoneLayerId(name) {
    var id = 1;
    paths().forEach(function (p) {
      if (p.getAttribute("data-name") !== name) return;
      var v = p.parentNode && p.parentNode.getAttribute("data-layer-id");
      if (v) id = parseInt(v, 10);
    });
    return id;
  }
  function selectedLayerIds() {
    var ids = [];
    selected.forEach(function (name) {
      var id = zoneLayerId(name);
      if (ids.indexOf(id) < 0) ids.push(id);
    });
    return ids;
  }
  function canMergeSelection() {
    return selected.length >= 2 && selectedLayerIds().length === 1;
  }
  function mergeCtxItem() {
    if (selected.length < 2) return null;
    var same = canMergeSelection();
    return {
      label: same ? "объединить" : "объединить (разные слои)",
      disabled: !same,
      run: mergeSelected,
    };
  }
  function prependMerge(items) {
    var m = mergeCtxItem();
    if (!m) return items;
    return [m, { sep: true }].concat(items);
  }
  function layerMoveItems(curId, onPick) {
    return layerList.map(function (L) {
      return {
        label: "на слой «" + L.name + "»",
        checked: L.id === curId,
        disabled: L.id === curId,
        run: function () {
          onPick(L.id);
        },
      };
    });
  }
  function showZoneCtx(cx, cy, name, mapX, mapY) {
    var cur = zoneLayerId(name);
    var items = layerMoveItems(cur, function (id) {
      moveZoneToLayer(name, id);
    });
    items.push({ sep: true });
    items.push({
      label: "на новый слой",
      run: function () {
        addEditorLayer();
        moveZoneToLayer(name, activeLayerId);
      },
    });
    if (mapX != null && mapY != null) {
      items.push({ sep: true });
      items.push({
        label: "вставить текст",
        run: function () {
          placeTextAt(mapX, mapY, cur);
        },
      });
    }
    showCtx(cx, cy, prependMerge(items));
  }
  function showObjectCtx(cx, cy, el) {
    if (!el) return;
    var cur = parseInt(
      (el.parentNode && el.parentNode.getAttribute("data-layer-id")) || "1",
      10
    );
    var items = [];
    if (el.tagName && el.tagName.toLowerCase() === "text") {
      items.push({
        label: "изменить текст",
        run: function () {
          editTextEl(el);
        },
      });
      items.push({ sep: true });
    }
    items = items.concat(
      layerMoveItems(cur, function (id) {
        moveElToLayer(el, id);
      })
    );
    items.push({ sep: true });
    items.push({
      label: "на новый слой",
      run: function () {
        addEditorLayer();
        moveElToLayer(el, activeLayerId);
      },
    });
    items.push({ sep: true });
    items.push({
      label: "удалить",
      run: function () {
        snapshotPaths("удалить");
        el.remove();
        selectedObj = null;
        buildLayers();
      },
    });
    showCtx(cx, cy, items);
  }
  function showProjectCtx(cx, cy, m, card) {
    if (!m) return;
    showCtx(cx, cy, [
      {
        label: "переименовать",
        run: function () {
          var lab = card && card.querySelector(".pname");
          if (lab) startRenameProject(m, lab);
        },
      },
      { sep: true },
      {
        label: "удалить проект",
        run: function () {
          deleteProject(m);
        },
      },
    ]);
  }
  function showLayerCtx(cx, cy, id) {
    var L = layerById(id);
    if (!L) return;
    showCtx(cx, cy, [
      {
        label: L.collapsed ? "развернуть" : "свернуть",
        run: function () {
          L.collapsed = !L.collapsed;
          buildLayers();
        },
      },
      {
        label: "вперёд",
        run: function () {
          raiseLayer(id, 1);
        },
      },
      {
        label: "назад",
        run: function () {
          raiseLayer(id, -1);
        },
      },
      {
        label: "переименовать",
        run: function () {
          var lab = layersEl.querySelector(
            '.head[data-layer-id="' + id + '"] .ln'
          );
          startRenameLayer(L, lab);
        },
      },
      { sep: true },
      {
        label: "удалить слой",
        run: function () {
          deleteEditorLayer(id);
        },
      },
    ]);
  }
  function hitSvgAt(e) {
    var prev = canvas ? canvas.style.pointerEvents : "";
    if (canvas) canvas.style.pointerEvents = "none";
    var el = document.elementFromPoint(e.clientX, e.clientY);
    if (canvas) canvas.style.pointerEvents = prev;
    return el;
  }
  function onContextMenu(e) {
    var t = e.target;
    if (t && t.closest && t.closest("input,textarea,select,a,.txt-edit")) return;
    if (t && t.closest && t.closest(".dock,.rail,#xy,#ctx-menu")) {
      e.preventDefault();
      return;
    }
    e.preventDefault();
    hideCross();
    var row = t && t.closest && t.closest("#layers .layer");
    if (row) {
      var zn = row.getAttribute("data-name");
      if (zn) {
        if (selected.indexOf(zn) < 0) selectDistrict(zn, false);
        showZoneCtx(e.clientX, e.clientY, zn);
        return;
      }
      var oid = row.getAttribute("data-oid");
      if (oid) {
        var obj = svg.querySelector('[data-oid="' + oid + '"]');
        if (obj) {
          selectDistrict(null, false);
          selectObj(obj);
          showObjectCtx(e.clientX, e.clientY, obj);
          return;
        }
      }
      var lid = parseInt(row.getAttribute("data-layer-id"), 10);
      if (lid) {
        activeLayerId = lid;
        showLayerCtx(e.clientX, e.clientY, lid);
        return;
      }
    }
    var proj = t && t.closest && t.closest(".map-item");
    if (
      proj &&
      !(t.closest && t.closest("#layers-fold, #journal-box"))
    ) {
      var slug = proj.getAttribute("data-slug");
      var found = null;
      (lastCatalog.maps || []).forEach(function (x) {
        if (x.slug === slug) found = x;
      });
      if (found) showProjectCtx(e.clientX, e.clientY, found, proj);
      return;
    }
    if (isChrome(t)) return;
    var hit = hitSvgAt(e);
    var kindEl =
      hit && hit.closest && hit.closest("text[data-kind],path[data-kind]");
    if (kindEl) {
      selectDistrict(null, false);
      selectObj(kindEl);
      showObjectCtx(e.clientX, e.clientY, kindEl);
      return;
    }
    var name = zoneAtEvent(e);
    var p = pos(e);
    if (name) {
      if (selected.indexOf(name) < 0) selectDistrict(name, false);
      showZoneCtx(e.clientX, e.clientY, name, p.x, p.y);
      return;
    }
    showCtx(
      e.clientX,
      e.clientY,
      prependMerge([
        {
          label: "вставить текст",
          run: function () {
            placeTextAt(p.x, p.y, activeLayerId);
          },
        },
        {
          label: "новый слой",
          run: function () {
            addEditorLayer();
          },
        },
      ])
    );
  }
  function fillZoneLayerSelect() {
    var sel = document.getElementById("zone-layer");
    if (!sel) return;
    sel.style.display = target && layerList.length ? "block" : "none";
    if (!target) return;
    var cur = zoneLayerId(target);
    sel.innerHTML = "";
    layerList.forEach(function (L) {
      var o = document.createElement("option");
      o.value = String(L.id);
      o.textContent = "слой: " + L.name;
      if (L.id === cur) o.selected = true;
      sel.appendChild(o);
    });
  }
  function applyOverlayStroke() {
    var L = layerById(activeLayerId);
    if (!L || L.locked || !L.visible) return false;
    var g = layerGroup(L.id);
    if (!g) return false;
    var ink = ctx.getImageData(0, 0, W, H).data;
    var mask = new Uint8Array(W * H);
    var hits = 0;
    for (var i = 0; i < W * H; i++) {
      if (inkHits(ink, i * 4)) {
        mask[i] = 1;
        hits++;
      }
    }
    if (!hits) return false;
    snapshotPaths("штрих");
    sketchSeq++;
    var color = paintColor();
    var d = ringsToD(contoursFromMask(mask)).trim();
    var np = document.createElementNS("http://www.w3.org/2000/svg", "path");
    np.setAttribute("data-kind", "draw");
    np.setAttribute("data-oid", "s" + sketchSeq);
    np.setAttribute("data-label", "Штрих " + sketchSeq);
    if (d && hits > 40) {
      np.setAttribute("d", d);
      np.setAttribute("fill", color);
    } else {
      var pts = strokePts;
      if (pts.length < 2) {
        discardLastUndo();
        return false;
      }
      var dd = ["M" + pts[0].x.toFixed(1) + "," + pts[0].y.toFixed(1)];
      for (var k = 1; k < pts.length; k++)
        dd.push("L" + pts[k].x.toFixed(1) + "," + pts[k].y.toFixed(1));
      np.setAttribute("d", dd.join(" "));
      np.setAttribute("fill", "none");
      np.setAttribute("stroke", color);
      np.setAttribute("stroke-width", String(Math.max(thickness(), 0.75)));
      np.setAttribute("stroke-linecap", "round");
      np.setAttribute("stroke-linejoin", "round");
    }
    g.appendChild(np);
    bindOverlayClicks();
    buildLayers();
    return true;
  }
  function applyMarkerStroke() {
    var L = layerById(activeLayerId);
    if (!L || L.locked || !L.visible) return false;
    var g = layerGroup(L.id);
    if (!g) return false;
    var pts = strokePts;
    if (pts.length < 2) return false;
    snapshotPaths("маркер");
    sketchSeq++;
    var dd = ["M" + pts[0].x.toFixed(1) + "," + pts[0].y.toFixed(1)];
    for (var k = 1; k < pts.length; k++)
      dd.push("L" + pts[k].x.toFixed(1) + "," + pts[k].y.toFixed(1));
    var np = document.createElementNS("http://www.w3.org/2000/svg", "path");
    np.setAttribute("data-kind", "marker");
    np.setAttribute("data-oid", "m" + sketchSeq);
    np.setAttribute("data-label", "Маркер " + sketchSeq);
    np.setAttribute("d", dd.join(" "));
    np.setAttribute("fill", "none");
    np.setAttribute("stroke", "#ff3d7f");
    np.setAttribute("stroke-width", "2");
    np.setAttribute("stroke-linecap", "round");
    np.setAttribute("stroke-linejoin", "round");
    np.setAttribute("data-marker", "1");
    g.appendChild(np);
    bindOverlayClicks();
    buildLayers();
    return true;
  }
  function applyOverlayErase() {
    var L = layerById(activeLayerId);
    if (!L || L.locked) return false;
    var g = layerGroup(L.id);
    if (!g) return false;
    var ink = ctx.getImageData(0, 0, W, H).data;
    var hit = false;
    var list = Array.prototype.slice.call(
      g.querySelectorAll("path[data-kind='draw'],path[data-kind='marker']")
    );
    snapshotPaths("ластик");
    list.forEach(function (p) {
      var d = p.getAttribute("d");
      if (!d) return;
      var p2 = new Path2D(d);
      var sw = parseFloat(p.getAttribute("stroke-width") || "2");
      ctx.save();
      ctx.lineWidth = sw + 6;
      ctx.lineCap = "round";
      var del = false;
      for (var y = 0; y < H && !del; y += 2) {
        for (var x = 0; x < W; x += 2) {
          var j = (y * W + x) * 4;
          if (!inkHits(ink, j)) continue;
          var fill = p.getAttribute("fill");
          if (fill && fill !== "none" && ctx.isPointInPath(p2, x + 0.5, y + 0.5))
            del = true;
          else if (ctx.isPointInStroke && ctx.isPointInStroke(p2, x + 0.5, y + 0.5))
            del = true;
          if (del) break;
        }
      }
      ctx.restore();
      if (del) {
        p.remove();
        hit = true;
      }
    });
    if (!hit) {
      discardLastUndo();
      return false;
    }
    buildLayers();
    return true;
  }
  function editTextEl(el) {
    if (!el) return;
    var r = el.getBoundingClientRect();
    var inp = document.createElement("input");
    inp.type = "text";
    inp.className = "txt-edit";
    inp.value = el.textContent || "";
    inp.style.left = r.left + "px";
    inp.style.top = r.top + "px";
    document.body.appendChild(inp);
    inp.focus();
    inp.select();
    var done = false;
    function commit() {
      if (done) return;
      done = true;
      var n = String(inp.value || "").trim();
      if (inp.parentNode) inp.parentNode.removeChild(inp);
      if (!n) {
        snapshotPaths("удалить");
        el.remove();
        selectedObj = null;
        buildLayers();
        return;
      }
      snapshotPaths("текст");
      el.textContent = n;
      el.setAttribute("data-label", n.slice(0, 24));
      buildLayers();
    }
    inp.addEventListener("blur", commit);
    inp.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        inp.blur();
      }
      if (e.key === "Escape") {
        e.preventDefault();
        inp.value = el.textContent || "";
        inp.blur();
      }
    });
  }
  function placeTextAt(x, y, layerId) {
    var lid = layerId || activeLayerId;
    var L = layerById(lid);
    if (!L || L.locked || !L.visible) {
      if (hint) hint.textContent = "слой скрыт или заблокирован";
      return;
    }
    var g = layerGroup(L.id);
    if (!g) return;
    var t = window.prompt("текст", "");
    if (t == null || !String(t).trim()) return;
    snapshotPaths("текст");
    textSeq++;
    var el = document.createElementNS("http://www.w3.org/2000/svg", "text");
    el.setAttribute("x", String(Math.round(x)));
    el.setAttribute("y", String(Math.round(y)));
    el.setAttribute("fill", "#1a1a1a");
    el.setAttribute("font-size", "16");
    el.setAttribute("font-family", "system-ui,sans-serif");
    el.setAttribute("data-kind", "text");
    el.setAttribute("data-oid", "t" + textSeq);
    el.setAttribute("data-label", String(t).slice(0, 24));
    el.textContent = t;
    g.appendChild(el);
    selectDistrict(null, false);
    selectObj(el);
    bindOverlayClicks();
    buildLayers();
    if (hint) hint.textContent = "текст: двойной клик — править, тащи — двигать, ПКМ — слой";
  }
  function buildLayers() {
    if (!layersEl) return;
    layersEl.innerHTML = "";
    var top = layerList.slice().reverse();
    top.forEach(function (L) {
      var row = document.createElement("div");
      row.className =
        "layer head" +
        (L.id === activeLayerId && !target ? " on" : "") +
        (L.visible ? "" : " off");
      var tw = document.createElement("button");
      tw.type = "button";
      tw.className = "tw";
      tw.textContent = L.collapsed ? "▶" : "▼";
      tw.title = L.collapsed ? "развернуть" : "свернуть";
      tw.onclick = function (e) {
        e.stopPropagation();
        L.collapsed = !L.collapsed;
        buildLayers();
      };
      var eye = document.createElement("button");
      eye.type = "button";
      eye.className = "eye";
      eye.textContent = L.visible ? "◉" : "○";
      eye.title = "видимость";
      eye.onclick = function (e) {
        e.stopPropagation();
        L.visible = !L.visible;
        applyLayerVisibility();
        buildLayers();
      };
      var lk = document.createElement("button");
      lk.type = "button";
      lk.className = "lk";
      lk.textContent = L.locked ? "🔒" : "🔓";
      lk.title = "блокировка";
      lk.onclick = function (e) {
        e.stopPropagation();
        L.locked = !L.locked;
        applyLayerVisibility();
        buildLayers();
      };
      var lab = document.createElement("span");
      lab.className = "ln";
      lab.textContent = L.name;
      lab.title = "двойной клик — переименовать";
      lab.ondblclick = function (e) {
        e.stopPropagation();
        startRenameLayer(L, lab);
      };
      row.setAttribute("data-layer-id", String(L.id));
      row.appendChild(tw);
      row.appendChild(eye);
      row.appendChild(lk);
      row.appendChild(lab);
      row.onclick = function () {
        activeLayerId = L.id;
        if (L.type !== "body") selectDistrict(null, false);
        buildLayers();
        if (hint) {
          hint.textContent =
            "слой «" + L.name + "» · T — текст, карандаш без района рисует сюда";
        }
      };
      layersEl.appendChild(row);
      if (L.collapsed) return;
      var g = layerGroup(L.id);
      if (!g) return;
      paths().forEach(function (p) {
        if (p.parentNode !== g) return;
        var name = p.getAttribute("data-name");
        var fill = p.getAttribute("fill");
        var el = document.createElement("button");
        el.type = "button";
        el.className =
          "layer child" +
          (selected.indexOf(name) >= 0 ? " on" : "") +
          (L.visible ? "" : " off");
        el.setAttribute("data-name", name);
        el.innerHTML =
          '<span class="sw" style="background:' +
          fill +
          '"></span><span class="ln">' +
          short(name) +
          "</span>";
        el.onclick = function (e) {
          e.stopPropagation();
          activeLayerId = L.id;
          selectDistrict(name, e.shiftKey);
        };
        layersEl.appendChild(el);
      });
      Array.prototype.slice
        .call(g.querySelectorAll("[data-kind]"))
        .forEach(function (el) {
          var b = document.createElement("button");
          b.type = "button";
          b.className =
            "layer child" + (el.classList.contains("sel") ? " on" : "");
          if (el.getAttribute("data-oid"))
            b.setAttribute("data-oid", el.getAttribute("data-oid"));
          b.innerHTML =
            '<span class="ln">' +
            (el.getAttribute("data-label") || el.getAttribute("data-kind")) +
            "</span>";
          b.onclick = function (e) {
            e.stopPropagation();
            activeLayerId = L.id;
            selectDistrict(null, false);
            selectObj(el);
            buildLayers();
          };
          layersEl.appendChild(b);
        });
    });
    fillZoneLayerSelect();
    var n = layerList.length;
    var countEl = document.getElementById("layers-count");
    if (countEl) countEl.textContent = n ? String(n) : "";
    var fold = document.getElementById("layers-fold");
    if (fold) fold.classList.toggle("open", layersOpen);
  }
  function initEditorChrome() {
    var bd = document.getElementById("btn-add-draw");
    if (bd)
      bd.onclick = function () {
        addEditorLayer();
      };
    var zs = document.getElementById("zone-layer");
    if (zs)
      zs.onchange = function () {
        if (target) moveZoneToLayer(target, parseInt(zs.value, 10));
      };
    document.addEventListener("contextmenu", onContextMenu);
    document.addEventListener(
      "pointerdown",
      function (e) {
        var m = document.getElementById("ctx-menu");
        if (m && !m.contains(e.target)) hideCtx();
      },
      true
    );
    bindJournal();
    bindLayersFold();
  }
  initLayers();
  initEditorChrome();
  buildLayers();

  paths().forEach(bindPathClick);
  function onSvgBgClick(e) {
    if (mode !== "pick" || space || clicksBlocked()) return;
    if (e.target && e.target.closest && e.target.closest("path[data-name]:not([data-kind])"))
      return;
    if (e.target && e.target.closest && e.target.closest("[data-kind]"))
      return;
    if (pendingText) {
      pendingText = false;
      var pt = pos(e);
      placeTextAt(pt.x, pt.y, activeLayerId);
      return;
    }
    selectDistrict(null, false);
  }
  function bindSvgShell() {
    if (!svg) return;
    svg.removeEventListener("click", onSvgBgClick);
    svg.addEventListener("click", onSvgBgClick);
  }
  bindSvgShell();

  if (fillEl)
    fillEl.addEventListener("input", function () {
      if (!target) return;
      paths().forEach(function (p) {
        if (p.getAttribute("data-name") === target) {
          p.setAttribute("fill", fillEl.value);
          targetFill = fillEl.value;
        }
      });
      var sw = document.querySelector(".layer.on .sw");
      if (sw) sw.style.background = fillEl.value;
    });

  function pos(ev) {
    var r = canvas.getBoundingClientRect();
    return {
      x: ((ev.clientX - r.left) * W) / r.width,
      y: ((ev.clientY - r.top) * H) / r.height,
    };
  }
  function dropTrailingStrokes() {
    while (undoStack.length && undoStack[undoStack.length - 1].type === "stroke")
      undoStack.pop();
  }
  function pushUndo(item) {
    undoStack.push(item);
    redoStack = [];
    if (undoStack.length > 80) undoStack.shift();
    if (item && item.type !== "stroke") renderJournal();
  }
  function discardLastUndo() {
    if (undoStack.length) undoStack.pop();
    renderJournal();
  }
  function snapshotStroke() {
    pushUndo({ type: "stroke", data: ctx.getImageData(0, 0, W, H) });
  }
  function captureState(label, id) {
    return {
      type: "apply",
      id: id || 0,
      label: label || "действие",
      html: stackEl().innerHTML,
      labels: labels.slice(),
      layers: JSON.parse(JSON.stringify(layerList)),
      activeLayerId: activeLayerId,
      layerSeq: layerSeq,
    };
  }
  function regionsEl() {
    if (target) {
      var tp = null;
      paths().forEach(function (p) {
        if (p.getAttribute("data-name") === target) tp = p;
      });
      if (tp && tp.parentNode) return tp.parentNode;
    }
    var L = layerById(activeLayerId);
    if (L) {
      var g = layerGroup(L.id);
      if (g) return g;
    }
    return (
      svg.querySelector("#regions") ||
      svg.querySelector("#layer-stack") ||
      svg
    );
  }
  function stackEl() {
    return svg.querySelector("#layer-stack") || regionsEl();
  }
  function snapshotPaths(label) {
    dropTrailingStrokes();
    actionSeq++;
    var item = captureState(label || "действие", actionSeq);
    pushUndo(item);
    scheduleSave();
  }
  function restoreDom(html, meta) {
    stackEl().innerHTML = html;
    if (meta && meta.layers) {
      layerList = meta.layers;
      activeLayerId = meta.activeLayerId;
      if (meta.layerSeq) layerSeq = meta.layerSeq;
    }
    paths().forEach(bindPathClick);
    bindOverlayClicks();
    applyLayerVisibility();
    buildLayers();
  }
  function restorePaths(map) {
    paths().forEach(function (p) {
      var n = p.getAttribute("data-name");
      if (map[n] != null) p.setAttribute("d", map[n]);
    });
  }
  function currentPaths() {
    var snap = {};
    paths().forEach(function (p) {
      snap[p.getAttribute("data-name")] = p.getAttribute("d");
    });
    return snap;
  }
  function undo(quiet) {
    dropTrailingStrokes();
    var last = undoStack.pop();
    if (!last) {
      if (!quiet && hint) hint.textContent = "нечего отменять";
      return false;
    }
    if (last.type === "stroke") {
      redoStack.push({ type: "stroke", data: ctx.getImageData(0, 0, W, H) });
      ctx.putImageData(last.data, 0, 0);
    } else {
      redoStack.push(captureState(last.label, last.id));
      restoreDom(last.html, last);
      if (last.labels) labels = last.labels.slice();
    }
    if (!quiet) {
      if (hint) hint.textContent = "отмена" + (last.label ? " · " + last.label : "");
      renderJournal();
    }
    scheduleSave();
    return true;
  }
  function redo(quiet) {
    var last = redoStack.pop();
    if (!last) {
      if (!quiet && hint) hint.textContent = "нечего повторить";
      return false;
    }
    if (last.type === "stroke") {
      undoStack.push({ type: "stroke", data: ctx.getImageData(0, 0, W, H) });
      ctx.putImageData(last.data, 0, 0);
    } else {
      undoStack.push(captureState(last.label, last.id));
      restoreDom(last.html, last);
      if (last.labels) labels = last.labels.slice();
    }
    if (!quiet) {
      if (hint) hint.textContent = "повтор" + (last.label ? " · " + last.label : "");
      renderJournal();
    }
    scheduleSave();
    return true;
  }
  function journalEntries() {
    var items = [{ id: 0, label: "начало", kind: "done" }];
    undoStack.forEach(function (s) {
      if (s.type === "stroke") return;
      items.push({ id: s.id, label: s.label || "действие", kind: "done" });
    });
    items[items.length - 1].kind = "current";
    for (var r = redoStack.length - 1; r >= 0; r--) {
      var s = redoStack[r];
      if (!s || s.type === "stroke") continue;
      items.push({ id: s.id, label: s.label || "действие", kind: "future" });
    }
    return items;
  }
  function jumpToHistory(id) {
    dropTrailingStrokes();
    var cur = 0;
    for (var i = undoStack.length - 1; i >= 0; i--) {
      if (undoStack[i].type !== "stroke") {
        cur = undoStack[i].id;
        break;
      }
    }
    if (id === cur) return;
    if (id === 0) {
      while (undoStack.length) undo(true);
      if (hint) hint.textContent = "откат к началу";
      renderJournal();
      return;
    }
    var found = -1;
    for (var u = 0; u < undoStack.length; u++) {
      if (undoStack[u].type !== "stroke" && undoStack[u].id === id) found = u;
    }
    if (found >= 0) {
      while (undoStack.length > found + 1) undo(true);
      if (hint) hint.textContent = "откат к «" + (undoStack[found].label || "") + "»";
      renderJournal();
      return;
    }
    var label = "";
    while (redoStack.length) {
      var nxt = redoStack[redoStack.length - 1];
      if (!redo(true)) break;
      if (nxt && nxt.type !== "stroke") {
        label = nxt.label || "";
        if (nxt.id === id) break;
      }
    }
    if (hint) hint.textContent = label ? "повтор до «" + label + "»" : "повтор";
    renderJournal();
  }
  function renderJournal() {
    var box = document.getElementById("journal");
    var countEl = document.getElementById("journal-count");
    var wrap = document.getElementById("journal-box");
    var items = journalEntries();
    var n = items.length - 1;
    if (countEl) countEl.textContent = n ? String(n) : "";
    if (wrap) wrap.classList.toggle("open", journalOpen);
    if (!box) return;
    box.innerHTML = "";
    items.forEach(function (it) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "jitem" + (it.kind === "current" ? " now" : it.kind === "future" ? " future" : "");
      b.textContent = it.label;
      if (it.kind === "current") {
        var mark = document.createElement("span");
        mark.className = "jnow";
        mark.textContent = "сейчас";
        b.appendChild(mark);
      }
      b.onclick = function (e) {
        e.stopPropagation();
        jumpToHistory(it.id);
      };
      box.appendChild(b);
    });
    if (journalOpen) box.scrollTop = box.scrollHeight;
  }
  function bindJournal() {
    var tog = document.getElementById("journal-toggle");
    if (!tog) return;
    tog.onclick = function (e) {
      e.stopPropagation();
      journalOpen = !journalOpen;
      renderJournal();
    };
    renderJournal();
  }
  function bindLayersFold() {
    var tog = document.getElementById("layers-toggle");
    if (!tog) return;
    tog.onclick = function (e) {
      e.stopPropagation();
      layersOpen = !layersOpen;
      var fold = document.getElementById("layers-fold");
      if (fold) fold.classList.toggle("open", layersOpen);
    };
  }

  function buildLabels() {
    var plist = paths();
    var off = document.createElement("canvas");
    off.width = W;
    off.height = H;
    var octx = off.getContext("2d", { willReadFrequently: true });
    octx.imageSmoothingEnabled = false;
    for (var t = 0; t < labels.length; t++) labels[t] = 0;
    plist.forEach(function (p, i) {
      octx.clearRect(0, 0, W, H);
      var path = new Path2D(p.getAttribute("d"));
      octx.fillStyle = "#fff";
      octx.fill(
        path,
        p.getAttribute("fill-rule") === "evenodd" ? "evenodd" : "nonzero"
      );
      var pix = octx.getImageData(0, 0, W, H).data;
      var id = i + 1;
      for (var t = 0; t < W * H; t++) {
        if (pix[t * 4 + 3] > 128) labels[t] = id;
      }
    });
  }

  function dropSpeckles(id) {
    var vis = new Uint8Array(W * H);
    for (var y = 0; y < H; y++) {
      for (var x = 0; x < W; x++) {
        var i0 = y * W + x;
        if (labels[i0] !== id || vis[i0]) continue;
        var stack = [[x, y]];
        var cells = [];
        vis[i0] = 1;
        while (stack.length) {
          var p = stack.pop();
          cells.push(p);
          var dirs = [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ];
          for (var k = 0; k < 4; k++) {
            var nx = p[0] + dirs[k][0],
              ny = p[1] + dirs[k][1];
            if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
            var ni = ny * W + nx;
            if (vis[ni] || labels[ni] !== id) continue;
            vis[ni] = 1;
            stack.push([nx, ny]);
          }
        }
        if (cells.length < MIN_BLOB) {
          for (var c = 0; c < cells.length; c++)
            labels[cells[c][1] * W + cells[c][0]] = 0;
        }
      }
    }
  }

  function pathById(id) {
    var list = paths();
    for (var i = 0; i < list.length; i++) {
      if (parseInt(list[i].getAttribute("data-lid"), 10) === id) return list[i];
    }
    return null;
  }
  function lid(p) {
    return parseInt(p.getAttribute("data-lid"), 10);
  }
  function zoneAtEvent(ev) {
    var p = pos(ev);
    var x = Math.round(p.x);
    var y = Math.round(p.y);
    if (x < 0 || y < 0 || x >= W || y >= H) return null;
    var id = labels[y * W + x];
    if (!id) return null;
    var path = pathById(id);
    return path ? path.getAttribute("data-name") : null;
  }

  function inZone(x, y, zone) {
    var xi = Math.round(x);
    var yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= W || yi >= H) return false;
    return !!zone[yi * W + xi];
  }
  function nearId(x, y, id, r) {
    var xi = Math.round(x);
    var yi = Math.round(y);
    for (var dy = -r; dy <= r; dy++) {
      for (var dx = -r; dx <= r; dx++) {
        var xx = xi + dx;
        var yy = yi + dy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        if (labels[yy * W + xx] === id) return true;
      }
    }
    return false;
  }
  function nearestOnRing(ring, p) {
    var best = 0;
    var bestD = 1e15;
    for (var i = 0; i < ring.length; i++) {
      var dx = ring[i][0] - p[0];
      var dy = ring[i][1] - p[1];
      var d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }
  function ringArc(ring, i0, i1) {
    var out = [ring[i0]];
    var n = ring.length;
    var i = i0;
    while (i !== i1) {
      i = (i + 1) % n;
      out.push(ring[i]);
      if (out.length > n + 2) break;
    }
    return out;
  }
  function shorterArc(ring, i0, i1) {
    var a = ringArc(ring, i0, i1);
    var b = ringArc(ring, i1, i0);
    return a.length <= b.length ? a : b;
  }
  function spliceRing(orig, neu, zone, id) {
    if (!orig || orig.length < 4) return neu;
    if (!neu || neu.length < 4) return orig;
    var n = orig.length;
    var keep = new Array(n);
    var anyKeep = false;
    var anyDrop = false;
    for (var i = 0; i < n; i++) {
      var p = orig[i];
      keep[i] = !inZone(p[0], p[1], zone) && nearId(p[0], p[1], id, 3);
      if (keep[i]) anyKeep = true;
      else anyDrop = true;
    }
    if (!anyKeep) return neu;
    if (!anyDrop) return orig;
    var s = 0;
    while (s < n && !keep[s]) s++;
    if (s >= n) return neu;
    var out = [];
    var i = s;
    do {
      while (keep[i]) {
        out.push(orig[i]);
        i = (i + 1) % n;
        if (i === s) break;
      }
      if (i === s) break;
      var gapStart = orig[(i - 1 + n) % n];
      while (!keep[i] && i !== s) i = (i + 1) % n;
      var gapEnd = orig[i];
      var ia = nearestOnRing(neu, gapStart);
      var ib = nearestOnRing(neu, gapEnd);
      var arcA = ringArc(neu, ia, ib);
      var arcB = ringArc(neu, ib, ia);
      function zoneHit(arc) {
        var c = 0;
        for (var t = 0; t < arc.length; t++)
          if (inZone(arc[t][0], arc[t][1], zone)) c++;
        return c;
      }
      var arc = zoneHit(arcA) >= zoneHit(arcB) ? arcA : arcB;
      for (var k = 1; k < arc.length - 1; k++) out.push(arc[k]);
    } while (i !== s);
    return out.length >= 3 ? out : neu;
  }
  function largestRingIx(rings) {
    var b = 0;
    for (var i = 1; i < rings.length; i++)
      if (rings[i].length > rings[b].length) b = i;
    return b;
  }
  function rebuildIds(idSet, zone) {
    var plist = paths();
    plist.forEach(function (p) {
      var id = lid(p);
      if (!id || !idSet[id]) return;
      var mask = new Uint8Array(W * H);
      for (var t = 0; t < labels.length; t++) if (labels[t] === id) mask[t] = 1;
      var neu = contoursFromMask(mask);
      if (!neu.length) return;
      var d;
      var orig = zone ? parseD(p.getAttribute("d")) : [];
      if (zone && orig.length) {
        var oi = largestRingIx(orig);
        var ni = largestRingIx(neu);
        var spliced = spliceRing(orig[oi], neu[ni], zone, id);
        var rings = [spliced];
        for (var h = 0; h < orig.length; h++) {
          if (h === oi) continue;
          var hole = orig[h];
          if (!hole.length) continue;
          var hit = false;
          for (var t = 0; t < hole.length; t++) {
            if (inZone(hole[t][0], hole[t][1], zone)) {
              hit = true;
              break;
            }
          }
          if (!hit && nearId(hole[0][0], hole[0][1], id, 6)) rings.push(hole);
        }
        for (var nh = 0; nh < neu.length; nh++) {
          if (nh === ni) continue;
          var hr = neu[nh];
          var inCut = false;
          for (var u = 0; u < hr.length; u++) {
            if (inZone(hr[u][0], hr[u][1], zone)) {
              inCut = true;
              break;
            }
          }
          if (inCut) rings.push(hr);
        }
        d = ringsToD(rings).trim();
      } else {
        d = ringsToD(neu).trim();
      }
      if (d) {
        p.setAttribute("d", d);
        p.setAttribute("fill-rule", "evenodd");
      }
    });
  }

  function cancelDrawing() {
    if (!drawing) return;
    drawing = false;
    ctx.clearRect(0, 0, W, H);
    var last = undoStack[undoStack.length - 1];
    if (last && last.type === "stroke") undoStack.pop();
  }
  canvas.addEventListener("pointerdown", function (ev) {
    if (ev.button !== 0) return;
    if (handMode || mode === "pick" || space || ev.button === 1) return;
    if (pendingHand || panning) return;
    if (mode === "ruler") {
      ev.preventDefault();
      if (ruler.live && ruler.a) return;
      ruler.a = snapPoint(ev, 0);
      ruler.b = {
        x: ruler.a.x,
        y: ruler.a.y,
        snap: ruler.a.snap,
        id: ruler.a.id,
      };
      ruler.live = true;
      ruler.justPlacedA = true;
      renderRuler();
      return;
    }
    snapshotStroke();
    drawing = true;
    canvas.setPointerCapture(ev.pointerId);
    var p = pos(ev);
    strokePts = [{ x: p.x, y: p.y }];
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.strokeStyle = mode === "erase" ? "#c0392b" : "#111";
    ctx.globalCompositeOperation = "source-over";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = strokeWidth();
    ctx.lineTo(p.x + 0.15, p.y);
    ctx.stroke();
  });
  canvas.addEventListener("pointermove", function (ev) {
    if (ruler.live) return;
    if (!drawing) return;
    var p = pos(ev);
    strokePts.push({ x: p.x, y: p.y });
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  });
  function stopDraw(ev) {
    if (mode === "ruler") {
      if (ruler.justPlacedA) {
        ruler.justPlacedA = false;
        return;
      }
      if (ruler.live && ruler.a && !panning && ev && press.maxd < 18) {
        ruler.b = snapPoint(ev, ruler.a.id);
        ruler.live = false;
        renderRuler();
      }
      return;
    }
    if (!drawing) return;
    drawing = false;
    if (press.maxd < 18 && Date.now() - press.t < 500) {
      ctx.clearRect(0, 0, W, H);
      var last = undoStack[undoStack.length - 1];
      if (last && last.type === "stroke") undoStack.pop();
      if (mode === "pen" && ev) {
        var name = zoneAtEvent(ev);
        if (name) selectDistrict(name, false);
      }
      return;
    }
    var L = layerById(activeLayerId);
    if (mode === "pen") {
      if (target) applyPaint();
      else if (L) {
        if (!applyOverlayStroke())
          hint.textContent = "клик по району — выбрать, или рисуй на активном слое";
      } else {
        hint.textContent = "клик по району — выбрать, затем веди линию";
        ctx.clearRect(0, 0, W, H);
        return;
      }
    } else if (mode === "marker") {
      if (!applyMarkerStroke())
        hint.textContent = "маркер: веди линию по карте";
    } else if (mode === "knife") {
      if (!target && L && L.type === "draw") applyOverlayErase();
      else applyVoid("knife");
    } else if (mode === "erase") {
      if (!target && L && L.type === "draw") applyOverlayErase();
      else applyVoid("erase");
    }
    ctx.clearRect(0, 0, W, H);
  }
  canvas.addEventListener("pointerup", stopDraw);
  canvas.addEventListener("pointercancel", stopDraw);

  function floodMark(mask, vis, sx, sy) {
    var st = [[sx, sy]];
    while (st.length) {
      var p = st.pop(),
        x = p[0],
        y = p[1];
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      var i = y * W + x;
      if (!mask[i] || vis[i]) continue;
      vis[i] = 1;
      st.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
  }
  function dist2seg(p, a, b) {
    var vx = b[0] - a[0],
      vy = b[1] - a[1];
    var wx = p[0] - a[0],
      wy = p[1] - a[1];
    var c1 = vx * wx + vy * wy,
      c2 = vx * vx + vy * vy;
    var t = c2 === 0 ? 0 : Math.max(0, Math.min(1, c1 / c2));
    var dx = p[0] - (a[0] + t * vx),
      dy = p[1] - (a[1] + t * vy);
    return Math.sqrt(dx * dx + dy * dy);
  }
  function simplify(pts, eps) {
    if (pts.length < 3) return pts;
    function rec(s, e) {
      var maxd = 0,
        idx = 0;
      for (var i = s + 1; i < e; i++) {
        var d = dist2seg(pts[i], pts[s], pts[e]);
        if (d > maxd) {
          maxd = d;
          idx = i;
        }
      }
      if (maxd > eps) {
        var L = rec(s, idx),
          R = rec(idx, e);
        return L.slice(0, -1).concat(R);
      }
      return [pts[s], pts[e]];
    }
    return rec(0, pts.length - 1);
  }
  function contoursFromMask(mask) {
    var vis = new Uint8Array(W * H);
    var out = [];
    var dirs = [
      [1, 0],
      [1, 1],
      [0, 1],
      [-1, 1],
      [-1, 0],
      [-1, -1],
      [0, -1],
      [1, -1],
    ];
    function inside(x, y) {
      return x >= 0 && y >= 0 && x < W && y < H && mask[y * W + x];
    }
    for (var y = 1; y < H - 1; y++) {
      for (var x = 1; x < W - 1; x++) {
        if (!inside(x, y) || vis[y * W + x]) continue;
        if (inside(x - 1, y)) continue;
        var cx = x,
          cy = y,
          dir = 0,
          ring = [[x, y]],
          guard = 0;
        do {
          var found = false;
          for (var k = 0; k < 8; k++) {
            var nd = (dir + 6 + k) % 8;
            var nx = cx + dirs[nd][0],
              ny = cy + dirs[nd][1];
            if (inside(nx, ny)) {
              cx = nx;
              cy = ny;
              dir = nd;
              found = true;
              break;
            }
          }
          if (!found) break;
          ring.push([cx, cy]);
        } while ((cx !== x || cy !== y) && ++guard < W * H);
        floodMark(mask, vis, x, y);
        if (ring.length >= 5) out.push(simplify(ring, 1.2));
      }
    }
    return out;
  }
  function ringsToD(rings) {
    var d = [];
    rings.forEach(function (r) {
      if (r.length < 3) return;
      d.push("M" + Math.round(r[0][0]) + "," + Math.round(r[0][1]));
      for (var i = 1; i < r.length; i++)
        d.push("L" + Math.round(r[i][0]) + "," + Math.round(r[i][1]));
      d.push("Z");
    });
    return d.join(" ");
  }

  function dilateMask4(src) {
    var o = new Uint8Array(src.length);
    for (var y = 0; y < H; y++) {
      for (var x = 0; x < W; x++) {
        var i = y * W + x;
        if (src[i]) {
          o[i] = 1;
          continue;
        }
        if (x && src[i - 1]) o[i] = 1;
        else if (x + 1 < W && src[i + 1]) o[i] = 1;
        else if (y && src[i - W]) o[i] = 1;
        else if (y + 1 < H && src[i + W]) o[i] = 1;
      }
    }
    return o;
  }
  function fillEnclosedVoid(tid, inkMask, neu) {
    var wall = dilateMask4(inkMask);
    for (var i = 0; i < labels.length; i++) {
      if (labels[i] === tid) wall[i] = 1;
    }
    var outside = new Uint8Array(W * H);
    var st = [];
    function seed(x, y) {
      if (x < 0 || y < 0 || x >= W || y >= H) return;
      var i = y * W + x;
      if (wall[i] || outside[i]) return;
      outside[i] = 1;
      st.push(i);
    }
    for (var x = 0; x < W; x++) {
      seed(x, 0);
      seed(x, H - 1);
    }
    for (var y = 0; y < H; y++) {
      seed(0, y);
      seed(W - 1, y);
    }
    while (st.length) {
      var i = st.pop();
      var x = i % W;
      var y = (i / W) | 0;
      seed(x + 1, y);
      seed(x - 1, y);
      seed(x, y + 1);
      seed(x, y - 1);
    }
    var filled = 0;
    for (var j = 0; j < labels.length; j++) {
      if (outside[j] || wall[j]) continue;
      if (labels[j] !== 0) continue;
      labels[j] = tid;
      neu[j] = 1;
      filled++;
    }
    return filled;
  }
  function applyPaint() {
    if (!target) {
      hint.textContent = "выберите район";
      return;
    }
    var ink = ctx.getImageData(0, 0, W, H).data;
    var inkMask = new Uint8Array(W * H);
    var has = false;
    for (var y = 0; y < H; y++) {
      for (var x = 0; x < W; x++) {
        var j = (y * W + x) * 4;
        if (!inkHits(ink, j)) continue;
        inkMask[y * W + x] = 1;
        has = true;
      }
    }
    if (!has) return;
    var plist = paths();
    var tid = -1;
    plist.forEach(function (p) {
      if (p.getAttribute("data-name") === target) tid = lid(p);
    });
    if (tid < 1) return;
    snapshotPaths("карандаш · " + short(target));
    var neu = new Uint8Array(W * H);
    var stolenFrom = new Uint16Array(W * H);
    var paintedVoid = 0;
    for (var i = 0; i < labels.length; i++) {
      if (!inkMask[i]) continue;
      var prev = labels[i];
      if (prev === tid) continue;
      if (prev === 0) {
        labels[i] = tid;
        neu[i] = 1;
        paintedVoid++;
      } else {
        stolenFrom[i] = prev;
      }
    }
    var pocket = fillEnclosedVoid(tid, inkMask, neu);
    for (var k = 0; k < stolenFrom.length; k++) {
      if (!stolenFrom[k]) continue;
      labels[k] = tid;
      neu[k] = 1;
    }
    keepNewWithGap(tid, neu, gapPx);
    var claimed = 0;
    var restored = 0;
    var touched = {};
    touched[tid] = 1;
    for (var t = 0; t < stolenFrom.length; t++) {
      if (!stolenFrom[t]) continue;
      if (labels[t] === tid) {
        claimed++;
        touched[stolenFrom[t]] = 1;
      } else {
        labels[t] = stolenFrom[t];
        neu[t] = 0;
        restored++;
      }
    }
    var keptNew = 0;
    for (var n = 0; n < neu.length; n++) if (neu[n] && labels[n] === tid) keptNew++;
    if (!keptNew && !claimed) {
      discardLastUndo();
      ctx.clearRect(0, 0, W, H);
      hint.textContent =
        "площадь не добавилась — замкни петлю на выбранном районе или рисуй по подложке";
      return;
    }
    dropSpeckles(tid);
    Object.keys(touched).forEach(function (idk) {
      var id = parseInt(idk, 10);
      dropSpeckles(id);
      if (id !== tid) splitIslands(id, touched);
    });
    var zoneSrc = new Uint8Array(W * H);
    for (var zi = 0; zi < zoneSrc.length; zi++) {
      if (inkMask[zi] || neu[zi]) zoneSrc[zi] = 1;
    }
    var pdt = chebyshevDT(zoneSrc);
    var editZone = new Uint8Array(W * H);
    for (var z = 0; z < pdt.length; z++) if (pdt[z] <= 16) editZone[z] = 1;
    rebuildIds(touched, editZone);
    buildLayers();
    document.querySelectorAll(".layer").forEach(function (el) {
      el.classList.toggle(
        "on",
        selected.indexOf(el.getAttribute("data-name")) >= 0
      );
    });
    ctx.clearRect(0, 0, W, H);
    if (pocket)
      hint.textContent =
        "добавлена площадь внутрь петли → " +
        short(target) +
        " · щель " +
        gapPx +
        "px";
    else if (claimed)
      hint.textContent =
        "дорисовано + забрано у соседа → " +
        short(target) +
        " · щель " +
        gapPx +
        "px";
    else
      hint.textContent =
        "дорисовано по подложке → " + short(target) + " · щель " + gapPx + "px";
  }

  function nextLabelId() {
    var m = 0;
    for (var i = 0; i < labels.length; i++) if (labels[i] > m) m = labels[i];
    return m + 1;
  }

  function pinchBridges(id, zone) {
    var kill = [];
    for (var y = 1; y < H - 1; y++) {
      for (var x = 1; x < W - 1; x++) {
        var i = y * W + x;
        if (labels[i] !== id) continue;
        if (zone && !zone[i]) continue;
        var lr = labels[i - 1] === 0 && labels[i + 1] === 0;
        var ud = labels[i - W] === 0 && labels[i + W] === 0;
        if (lr || ud) kill.push(i);
      }
    }
    for (var k = 0; k < kill.length; k++) labels[kill[k]] = 0;
  }
  function bindPathClick(p) {
    p.addEventListener("click", function (e) {
      if (mode !== "pick" || space || clicksBlocked()) return;
      e.stopPropagation();
      selectDistrict(p.getAttribute("data-name"), e.shiftKey);
    });
  }

  function applyVoid(kind) {
    var ink = ctx.getImageData(0, 0, W, H).data;
    var has = false;
    for (var i = 0; i < ink.length; i += 4) {
      if (inkHits(ink, i)) {
        has = true;
        break;
      }
    }
    if (!has) {
      ctx.clearRect(0, 0, W, H);
      return;
    }
    snapshotPaths(kind === "knife" ? "нож" : "ластик");
    var touched = {};
    var inkMask = new Uint8Array(W * H);
    var cut = 0;
    for (var y = 0; y < H; y++) {
      for (var x = 0; x < W; x++) {
        var j = (y * W + x) * 4;
        if (!inkHits(ink, j)) continue;
        var idx = y * W + x;
        inkMask[idx] = 1;
        var prev = labels[idx];
        if (!prev) continue;
        touched[prev] = 1;
        labels[idx] = 0;
        cut++;
      }
    }
    if (!cut) {
      discardLastUndo();
      ctx.clearRect(0, 0, W, H);
      hint.textContent = "нож не задел тело — проведи через район";
      return;
    }
    var dt = chebyshevDT(inkMask);
    var pinchZone = new Uint8Array(W * H);
    var editZone = new Uint8Array(W * H);
    for (var z = 0; z < dt.length; z++) {
      if (dt[z] <= 4) pinchZone[z] = 1;
      if (dt[z] <= 16) editZone[z] = 1;
    }
    Object.keys(touched).forEach(function (k) {
      var id = parseInt(k, 10);
      pinchBridges(id, pinchZone);
      splitIslands(id, touched, editZone);
    });
    rebuildIds(touched, editZone);
    ctx.clearRect(0, 0, W, H);
    buildLayers();
    document.querySelectorAll(".layer").forEach(function (el) {
      el.classList.toggle(
        "on",
        selected.indexOf(el.getAttribute("data-name")) >= 0
      );
    });
    hint.textContent =
      kind === "knife"
        ? "разрез · щель " + gapPx + " px · обломки в слоях"
        : "стёрто в подложку · обломки в слоях";
  }

  function splitIslands(id, idSet, zone) {
    var vis = new Uint8Array(W * H);
    var comps = [];
    for (var y = 0; y < H; y++) {
      for (var x = 0; x < W; x++) {
        var i0 = y * W + x;
        if (labels[i0] !== id || vis[i0]) continue;
        var stack = [[x, y]];
        var cells = [];
        vis[i0] = 1;
        while (stack.length) {
          var p = stack.pop();
          cells.push(p);
          var ds = [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ];
          for (var k = 0; k < 4; k++) {
            var nx = p[0] + ds[k][0],
              ny = p[1] + ds[k][1];
            if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
            var ni = ny * W + nx;
            if (vis[ni] || labels[ni] !== id) continue;
            vis[ni] = 1;
            stack.push([nx, ny]);
          }
        }
        comps.push(cells);
      }
    }
    if (comps.length <= 1) return;
    comps.sort(function (a, b) {
      return b.length - a.length;
    });
    var parent = pathById(id);
    var fill = parent ? parent.getAttribute("fill") : "#ddd";
    var g =
      (parent && parent.parentNode) || svg.querySelector("#regions") || svg;
    for (var c = 1; c < comps.length; c++) {
      if (comps[c].length < MIN_FRAG) {
        for (var t = 0; t < comps[c].length; t++)
          labels[comps[c][t][1] * W + comps[c][t][0]] = 0;
        continue;
      }
      if (zone) {
        var nearCut = false;
        for (var zc = 0; zc < comps[c].length; zc++) {
          if (zone[comps[c][zc][1] * W + comps[c][zc][0]]) {
            nearCut = true;
            break;
          }
        }
        if (!nearCut) continue;
      }
      var nid = nextLabelId();
      fragSeq++;
      var np = document.createElementNS("http://www.w3.org/2000/svg", "path");
      np.setAttribute("fill", fill);
      np.setAttribute("data-name", "Обломок " + fragSeq);
      np.setAttribute("data-region", "frag" + fragSeq);
      np.setAttribute("data-lid", String(nid));
      if (idSet) idSet[nid] = 1;
      g.appendChild(np);
      bindPathClick(np);
      for (var u = 0; u < comps[c].length; u++)
        labels[comps[c][u][1] * W + comps[c][u][0]] = nid;
      var mask = new Uint8Array(W * H);
      for (var v = 0; v < labels.length; v++) if (labels[v] === nid) mask[v] = 1;
      var d = ringsToD(contoursFromMask(mask));
      if (d) np.setAttribute("d", d);
    }
  }

  function maskOf(id) {
    var m = new Uint8Array(W * H);
    for (var i = 0; i < labels.length; i++) if (labels[i] === id) m[i] = 1;
    return m;
  }
  function fourTouch(idA, idB) {
    for (var y = 0; y < H; y++) {
      for (var x = 0; x < W; x++) {
        if (labels[y * W + x] !== idA) continue;
        if (x > 0 && labels[y * W + x - 1] === idB) return true;
        if (x < W - 1 && labels[y * W + x + 1] === idB) return true;
        if (y > 0 && labels[(y - 1) * W + x] === idB) return true;
        if (y < H - 1 && labels[(y + 1) * W + x] === idB) return true;
      }
    }
    return false;
  }
  function chebyshevDT(mask) {
    var INF = 32767;
    var d = new Int16Array(W * H);
    for (var i = 0; i < d.length; i++) d[i] = mask[i] ? 0 : INF;
    for (var y = 0; y < H; y++) {
      for (var x = 0; x < W; x++) {
        var i = y * W + x;
        if (x > 0 && d[i - 1] + 1 < d[i]) d[i] = d[i - 1] + 1;
        if (y > 0 && d[i - W] + 1 < d[i]) d[i] = d[i - W] + 1;
        if (x > 0 && y > 0 && d[i - W - 1] + 1 < d[i]) d[i] = d[i - W - 1] + 1;
        if (x + 1 < W && y > 0 && d[i - W + 1] + 1 < d[i])
          d[i] = d[i - W + 1] + 1;
      }
    }
    for (var y = H - 1; y >= 0; y--) {
      for (var x = W - 1; x >= 0; x--) {
        var i = y * W + x;
        if (x + 1 < W && d[i + 1] + 1 < d[i]) d[i] = d[i + 1] + 1;
        if (y + 1 < H && d[i + W] + 1 < d[i]) d[i] = d[i + W] + 1;
        if (x + 1 < W && y + 1 < H && d[i + W + 1] + 1 < d[i])
          d[i] = d[i + W + 1] + 1;
        if (x > 0 && y + 1 < H && d[i + W - 1] + 1 < d[i])
          d[i] = d[i + W - 1] + 1;
      }
    }
    return d;
  }
  function keepNewWithGap(tid, neu, gap) {
    gap = gap || GAP_DEFAULT;
    var foreign = new Uint8Array(W * H);
    for (var i = 0; i < labels.length; i++) {
      if (labels[i] && labels[i] !== tid) foreign[i] = 1;
    }
    var dt = chebyshevDT(foreign);
    var punched = 0;
    var kept = 0;
    for (var j = 0; j < neu.length; j++) {
      if (!neu[j]) continue;
      if (dt[j] > 0 && dt[j] <= gap) {
        labels[j] = 0;
        punched++;
      } else {
        kept++;
      }
    }
    return { punched: punched, kept: kept };
  }
  function nearestTwoIds(x, y, maxr) {
    var first = 0;
    var d1 = 0;
    var second = 0;
    var d2 = 0;
    for (var r = 1; r <= maxr; r++) {
      for (var dy = -r; dy <= r; dy++) {
        for (var dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          var xx = x + dx;
          var yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
          var id = labels[yy * W + xx];
          if (!id) continue;
          if (!first) {
            first = id;
            d1 = r;
          } else if (id !== first && !second) {
            second = id;
            d2 = r;
          }
          if (first && second)
            return { gap: d1 + d2 - 1, a: first, b: second };
        }
      }
    }
    return null;
  }
  function measureGapPx() {
    var samples = [];
    var step = 5;
    for (var y = 2; y < H - 2; y += step) {
      for (var x = 2; x < W - 2; x += step) {
        if (labels[y * W + x]) continue;
        var hit = nearestTwoIds(x, y, 8);
        if (!hit || hit.gap < 2 || hit.gap > 6) continue;
        samples.push(hit.gap);
      }
    }
    if (samples.length < 12) {
      gapPx = GAP_DEFAULT;
      syncThickUi();
      return gapPx;
    }
    samples.sort(function (a, b) {
      return a - b;
    });
    gapPx = Math.max(2, Math.min(6, samples[(samples.length / 2) | 0]));
    syncThickUi();
    return gapPx;
  }
  var DIRS8 = [
    [1, 0],
    [1, 1],
    [0, 1],
    [-1, 1],
    [-1, 0],
    [-1, -1],
    [0, -1],
    [1, -1],
  ];
  function rayFirst(x, y, dx, dy, seam) {
    for (var s = 1; s <= seam; s++) {
      var nx = x + dx * s,
        ny = y + dy * s;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) return { id: 0, d: s };
      var lab = labels[ny * W + nx];
      if (lab) return { id: lab, d: s };
    }
    return { id: 0, d: seam + 1 };
  }
  function rayHitsForeign(x, y, allow, seam) {
    for (var k = 0; k < 8; k++) {
      var h = rayFirst(x, y, DIRS8[k][0], DIRS8[k][1], seam);
      if (h.id && !allow[h.id]) return true;
    }
    return false;
  }
  function oppositePair(x, y, idA, idB, seam) {
    var bestA = null,
      bestB = null;
    for (var k = 0; k < 8; k++) {
      var dx = DIRS8[k][0],
        dy = DIRS8[k][1];
      var h = rayFirst(x, y, dx, dy, seam);
      if (h.id === idA && (!bestA || h.d < bestA.d))
        bestA = { dx: dx, dy: dy, d: h.d };
      if (h.id === idB && (!bestB || h.d < bestB.d))
        bestB = { dx: dx, dy: dy, d: h.d };
    }
    if (!bestA || !bestB) return false;
    return bestA.dx * bestB.dx + bestA.dy * bestB.dy < 0;
  }
  function minChebyshev(idA, idB) {
    var dB = chebyshevDT(maskOf(idB));
    var best = 32767;
    for (var i = 0; i < labels.length; i++) {
      if (labels[i] === idA && dB[i] < best) best = dB[i];
    }
    return best;
  }
  function isFrag(id) {
    var p = pathById(id);
    var n = p ? p.getAttribute("data-name") : "";
    return n.indexOf("Обломок") === 0;
  }
  function seamLimit(idA, idB, md) {
    if (md >= 32767 || md <= 0) return -1;
    if (isFrag(idA) || isFrag(idB))
      return Math.max(md + 2, gapPx + 2);
    if (md > 6) return -1;
    return Math.min(md + 2, 6);
  }
  function nearVoidSeam(idA, idB, maxSum, mergeIds) {
    var allow = {};
    allow[idA] = 1;
    allow[idB] = 1;
    if (mergeIds)
      mergeIds.forEach(function (id) {
        allow[id] = 1;
      });
    var dA = chebyshevDT(maskOf(idA));
    var dB = chebyshevDT(maskOf(idB));
    var idx = [];
    for (var i = 0; i < labels.length; i++) {
      if (labels[i] !== 0) continue;
      if (!(dA[i] > 0 && dB[i] > 0 && dA[i] + dB[i] <= maxSum)) continue;
      var x = i % W,
        y = (i / W) | 0;
      if (rayHitsForeign(x, y, allow, maxSum)) continue;
      idx.push(i);
    }
    return idx;
  }
  function pairSeam(idA, idB, mergeIds) {
    var allow = {};
    mergeIds.forEach(function (id) {
      allow[id] = 1;
    });
    var md = minChebyshev(idA, idB);
    var seam = seamLimit(idA, idB, md);
    if (seam < 0) return [];
    var dA = chebyshevDT(maskOf(idA));
    var dB = chebyshevDT(maskOf(idB));
    var idx = [];
    for (var i = 0; i < labels.length; i++) {
      if (labels[i] !== 0) continue;
      if (dA[i] + dB[i] > seam) continue;
      var x = i % W,
        y = (i / W) | 0;
      if (rayHitsForeign(x, y, allow, seam)) continue;
      if (!oppositePair(x, y, idA, idB, seam)) continue;
      idx.push(i);
    }
    return idx;
  }
  function areNeighbors(idA, idB, mergeIds) {
    if (fourTouch(idA, idB)) return { ok: true, gap: [] };
    var md = minChebyshev(idA, idB);
    var strip = stripPixels(idA, idB, mergeIds);
    var gap = strip.length ? strip : pairSeam(idA, idB, mergeIds);
    var frag = isFrag(idA) || isFrag(idB);
    if (frag && md <= gapPx + 3) {
      var loose = nearVoidSeam(
        idA,
        idB,
        Math.max(md + 2, gapPx + 2),
        mergeIds
      );
      if (loose.length > gap.length) gap = loose;
      return { ok: true, gap: gap };
    }
    return { ok: gap.length > 12, gap: gap };
  }
  function parseD(d) {
    var rings = [];
    var cur = [];
    var parts = String(d || "").match(/[MLZmlz][^MLZmlz]*/g) || [];
    for (var i = 0; i < parts.length; i++) {
      var op = parts[i][0];
      var nums = parts[i].match(/-?\d+(?:\.\d+)?/g) || [];
      var pts = [];
      for (var j = 0; j + 1 < nums.length; j += 2)
        pts.push([parseFloat(nums[j]), parseFloat(nums[j + 1])]);
      if (op === "M" || op === "m") {
        if (cur.length) rings.push(cur);
        cur = pts.slice();
      } else if (op === "L" || op === "l") {
        cur = cur.concat(pts);
      } else {
        if (cur.length) rings.push(cur);
        cur = [];
      }
    }
    if (cur.length) rings.push(cur);
    return rings;
  }
  function densifyRing(ring, step) {
    if (!ring || ring.length < 2) return ring || [];
    var pts = ring.slice();
    if (
      pts.length > 1 &&
      pts[0][0] === pts[pts.length - 1][0] &&
      pts[0][1] === pts[pts.length - 1][1]
    )
      pts.pop();
    var out = [];
    for (var i = 0; i < pts.length; i++) {
      var a = pts[i],
        b = pts[(i + 1) % pts.length];
      out.push(a);
      var dx = b[0] - a[0],
        dy = b[1] - a[1];
      var dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= step) continue;
      var k = (dist / step) | 0;
      for (var j = 1; j < k; j++) {
        var t = j / k;
        out.push([a[0] + t * dx, a[1] + t * dy]);
      }
    }
    return out;
  }
  function catmullSpline(p0, p1, p2, p3, t) {
    var t2 = t * t,
      t3 = t2 * t;
    return [
      0.5 *
        (2 * p1[0] +
          (-p0[0] + p2[0]) * t +
          (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
          (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
      0.5 *
        (2 * p1[1] +
          (-p0[1] + p2[1]) * t +
          (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
          (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
    ];
  }
  function catmullRomRing(ring, tension, step) {
    if (!ring || ring.length < 3) return ring || [];
    tension = tension == null ? 0.6 : tension;
    step = step == null ? 2 : step;
    if (tension <= 0) return ring.slice();
    var pts = densifyRing(ring, step);
    pts = simplify(pts, step * 0.75);
    var n = pts.length;
    if (n < 4) return pts;
    var out = [];
    for (var i = 0; i < n; i++) {
      var p0 = pts[(i - 1 + n) % n],
        p1 = pts[i],
        p2 = pts[(i + 1) % n],
        p3 = pts[(i + 2) % n];
      var len = 0,
        prev = p1;
      for (var k = 1; k <= 4; k++) {
        var q = catmullSpline(p0, p1, p2, p3, k / 4);
        len += Math.sqrt(
          (q[0] - prev[0]) * (q[0] - prev[0]) +
            (q[1] - prev[1]) * (q[1] - prev[1])
        );
        prev = q;
      }
      var count = Math.max(1, Math.round(len / step));
      for (var j = 0; j < count; j++) {
        var t = j / count;
        var sp = catmullSpline(p0, p1, p2, p3, t);
        var chx = p1[0] + (p2[0] - p1[0]) * t;
        var chy = p1[1] + (p2[1] - p1[1]) * t;
        out.push([chx + (sp[0] - chx) * tension, chy + (sp[1] - chy) * tension]);
      }
    }
    return out;
  }
  var splineTension = 0.6;
  var splineStep = 2;
  function smoothDistrictPaths(names, level) {
    var restore = level === 0 || (level == null && splineTension <= 0);
    if (!names || !names.length) {
      if (hint) hint.textContent = "сначала выбери район";
      return;
    }
    var changed = 0;
    snapshotPaths(restore ? "вернуть контуры" : "сгладить");
    paths().forEach(function (p) {
      var nm = p.getAttribute("data-name");
      if (names.indexOf(nm) < 0) return;
      if (!p.getAttribute("data-orig-d"))
        p.setAttribute("data-orig-d", p.getAttribute("d") || "");
      var baseD = p.getAttribute("data-orig-d");
      if (restore) {
        p.setAttribute("d", baseD);
        p.removeAttribute("data-smooth");
        changed++;
        return;
      }
      var rings = parseD(baseD);
      var out = [];
      for (var i = 0; i < rings.length; i++) {
        out.push(catmullRomRing(rings[i], splineTension, splineStep));
      }
      p.setAttribute("d", ringsToDFine(out));
      p.setAttribute("data-smooth", String(Math.round(splineTension * 100)));
      changed++;
    });
    var seamsChanged = 0;
    if (!restore)
      seamsChanged = seamAlignPathsAll(names && names.length ? names : null);
    if (typeof buildLabels === "function") buildLabels();
    if (hint)
      hint.textContent = restore
        ? "контуры возвращены: " + changed
        : "сплайн (натяж. " +
          Math.round(splineTension * 100) +
          ", шаг " +
          splineStep +
          " px): " +
          changed +
          (seamsChanged ? " · швы согласованы: " + seamsChanged : "");
  }
  function smoothAll() {
    var all = paths().map(function (p) {
      return p.getAttribute("data-name");
    });
    smoothDistrictPaths(all);
  }
  function smoothSelected() {
    if (selected && selected.length) smoothDistrictPaths(selected.slice());
    else smoothAll();
  }
  function resampleChain(chain, n) {
    if (!chain.length) return [];
    if (chain.length === 1) return [chain[0]];
    if (n <= 1) return [chain[0]];
    var total = 0,
      segs = [];
    for (var i = 0; i < chain.length - 1; i++) {
      var dx = chain[i + 1][0] - chain[i][0],
        dy = chain[i + 1][1] - chain[i][1];
      var d = Math.sqrt(dx * dx + dy * dy);
      segs.push(d);
      total += d;
    }
    var out = [chain[0]];
    var stepLen = total / (n - 1);
    var acc = 0,
      si = 0;
    for (var k = 1; k < n - 1; k++) {
      var want = k * stepLen;
      while (si < segs.length - 1 && acc + segs[si] < want) {
        acc += segs[si];
        si++;
      }
      var segLen = segs[si] || 1e-6;
      var t = Math.min(1, (want - acc) / segLen);
      out.push([
        chain[si][0] + t * (chain[si + 1][0] - chain[si][0]),
        chain[si][1] + t * (chain[si + 1][1] - chain[si][1]),
      ]);
    }
    out.push(chain[chain.length - 1]);
    return out;
  }
  function midpointChain(fa, fb) {
    var n = Math.max(2, Math.max(fa.length, fb.length));
    var a = resampleChain(fa, n),
      b = resampleChain(fb, n);
    return a.map(function (pt, i) {
      return [(pt[0] + b[i][0]) / 2, (pt[1] + b[i][1]) / 2];
    });
  }
  function longestChain(runs) {
    var best = [];
    for (var i = 0; i < runs.length; i++)
      if (runs[i].length > best.length) best = runs[i];
    return best;
  }
  function seamAlignPairRings(ringsA, ringsB, maxD) {
    var A = ringsA[0],
      B = ringsB[0];
    if (!A || !B || A.length < 4 || B.length < 4) return null;
    var fas = facingRuns(A, B, maxD);
    var fbs = facingRuns(B, A, maxD);
    if (!fas.length || !fbs.length) return null;
    var fa = longestChain(fas);
    var fb = null,
      bestD = 1e18;
    for (var j = 0; j < fbs.length; j++) {
      var r = fbs[j];
      if (r.length < 2) continue;
      var d = Math.min(
        dist2seg(fa[0], r[0], r[0]),
        dist2seg(fa[0], r[r.length - 1], r[r.length - 1]),
        dist2seg(fa[fa.length - 1], r[0], r[0]),
        dist2seg(fa[fa.length - 1], r[r.length - 1], r[r.length - 1])
      );
      if (d < bestD) {
        bestD = d;
        fb = r;
      }
    }
    if (!fb || fb.length < 2) return null;
    var seams = pairEndSeams(fa, fb);
    if (seams.length !== 2) return null;
    var fa0 = seams[0][0],
      fa1 = seams[1][0],
      fb0 = seams[0][1],
      fb1 = seams[1][1];
    var faO = fa[0][0] === fa0[0] && fa[0][1] === fa0[1] ? fa : fa.slice().reverse();
    var fbO = fb[0][0] === fb0[0] && fb[0][1] === fb0[1] ? fb : fb.slice().reverse();
    var mid = midpointChain(faO, fbO);
    if (mid.length < 2) return null;
    var tailA = walkRing(A, fa1, fa0, true).slice(1);
    var newA = mid.concat(tailA);
    var tailB = walkRing(B, fb1, fb0, true).slice(1);
    var newB = mid.slice().reverse().concat(tailB);
    return {
      A: [newA].concat(ringsA.slice(1)),
      B: [newB].concat(ringsB.slice(1)),
    };
  }
  function seamAlignPathsAll(onlyNames) {
    var all = paths();
    var changed = 0;
    for (var i = 0; i < all.length; i++) {
      for (var j = i + 1; j < all.length; j++) {
        var pa = all[i],
          pb = all[j];
        if (onlyNames && onlyNames.length) {
          var na = pa.getAttribute("data-name"),
            nb = pb.getAttribute("data-name");
          if (onlyNames.indexOf(na) < 0 && onlyNames.indexOf(nb) < 0) continue;
        }
        var ra = parseD(pa.getAttribute("d")),
          rb = parseD(pb.getAttribute("d"));
        if (!ra[0] || !rb[0]) continue;
        var r = seamAlignPairRings(ra, rb, 9);
        if (!r) continue;
        pa.setAttribute("d", ringsToDFine(r.A));
        pb.setAttribute("d", ringsToDFine(r.B));
        changed++;
      }
    }
    return changed;
  }
  function distToRing(p, ring) {
    var best = 1e9;
    for (var i = 0; i < ring.length; i++) {
      var a = ring[i],
        b = ring[(i + 1) % ring.length];
      var d = dist2seg(p, a, b);
      if (d < best) best = d;
    }
    return best;
  }
  function closestOnRing(p, ring) {
    var best = ring[0],
      bestD = 1e9;
    for (var i = 0; i < ring.length; i++) {
      var a = ring[i],
        b = ring[(i + 1) % ring.length];
      var vx = b[0] - a[0],
        vy = b[1] - a[1];
      var wx = p[0] - a[0],
        wy = p[1] - a[1];
      var c2 = vx * vx + vy * vy;
      var t = c2 === 0 ? 0 : Math.max(0, Math.min(1, (vx * wx + vy * wy) / c2));
      var q = [a[0] + t * vx, a[1] + t * vy];
      var d = (q[0] - p[0]) * (q[0] - p[0]) + (q[1] - p[1]) * (q[1] - p[1]);
      if (d < bestD) {
        bestD = d;
        best = q;
      }
    }
    return best;
  }
  function closeNearHoles(flags, dists, maxD, slack, maxGap) {
    var n = flags.length;
    if (!n) return flags;
    var out = flags.slice();
    var i = 0;
    while (i < n) {
      if (flags[i]) {
        i++;
        continue;
      }
      var j = i;
      while (j < n && !flags[j]) j++;
      var hole = j - i;
      var left = i > 0 && flags[i - 1];
      var right = j < n && flags[j];
      var near = hole <= maxGap;
      if (near) {
        for (var k = i; k < j; k++) {
          if (dists[k] > maxD + slack) {
            near = false;
            break;
          }
        }
      }
      if (left && right && near) {
        for (var k = i; k < j; k++) out[k] = true;
      }
      i = j;
    }
    return out;
  }
  function longestTrueRun(flags) {
    var n = flags.length,
      bestS = 0,
      bestL = 0,
      i = 0;
    if (!n) return null;
    while (i < n) {
      if (!flags[i]) {
        i++;
        continue;
      }
      var j = i;
      while (j < i + n && flags[j % n]) j++;
      if (j - i > bestL) {
        bestL = j - i;
        bestS = i % n;
      }
      i = j;
    }
    return bestL ? [bestS, bestL] : null;
  }
  function allTrueRuns(flags, pts) {
    var n = flags.length;
    var vis = [];
    var runs = [];
    for (var i = 0; i < n; i++) {
      if (!flags[i] || vis[i]) continue;
      var s = i;
      var guard = 0;
      while (flags[(s - 1 + n) % n] && (s - 1 + n) % n !== i && guard < n) {
        s = (s - 1 + n) % n;
        guard++;
      }
      var run = [];
      var j = s;
      do {
        vis[j] = 1;
        run.push(pts[j]);
        j = (j + 1) % n;
      } while (flags[j] && !vis[j]);
      if (run.length >= 2) runs.push(run);
    }
    return runs;
  }
  function facingRuns(ring, other, maxD) {
    var pts = densifyRing(ring, 2);
    var flags = [];
    var dists = [];
    for (var i = 0; i < pts.length; i++) {
      var d = distToRing(pts[i], other);
      dists.push(d);
      flags.push(d <= maxD);
    }
    flags = closeNearHoles(flags, dists, maxD, 3, 80);
    return allTrueRuns(flags, pts);
  }
  function facingRun(ring, other, maxD) {
    var runs = facingRuns(ring, other, maxD);
    if (!runs.length) return [];
    return runs.reduce(function (a, b) {
      return a.length >= b.length ? a : b;
    });
  }
  function clipChain(chain, p0, p1) {
    if (chain.length < 2) return [p0, p1];
    function nearestI(p) {
      var bi = 0,
        bd = 1e9;
      for (var i = 0; i < chain.length; i++) {
        var d =
          (chain[i][0] - p[0]) * (chain[i][0] - p[0]) +
          (chain[i][1] - p[1]) * (chain[i][1] - p[1]);
        if (d < bd) {
          bd = d;
          bi = i;
        }
      }
      return bi;
    }
    var i0 = nearestI(p0),
      i1 = nearestI(p1);
    var mid, alt;
    if (i0 <= i1) {
      mid = chain.slice(i0, i1 + 1);
      alt = chain.slice(i1).concat(chain.slice(0, i0 + 1));
    } else {
      mid = chain.slice(i0).concat(chain.slice(0, i1 + 1));
      alt = chain.slice(i1, i0 + 1);
    }
    var walk = mid.length <= alt.length ? mid : alt;
    return [p0].concat(walk, [p1]);
  }
  function pairEndSeams(a, b) {
    if (a.length < 2 || b.length < 2) return [];
    function d2(p, q) {
      return (p[0] - q[0]) * (p[0] - q[0]) + (p[1] - q[1]) * (p[1] - q[1]);
    }
    var pairs =
      d2(a[0], b[0]) + d2(a[a.length - 1], b[b.length - 1]) <=
      d2(a[0], b[b.length - 1]) + d2(a[a.length - 1], b[0])
        ? [
            [a[0], b[0]],
            [a[a.length - 1], b[b.length - 1]],
          ]
        : [
            [a[0], b[b.length - 1]],
            [a[a.length - 1], b[0]],
          ];
    var seams = [];
    for (var i = 0; i < pairs.length; i++) {
      var pa = pairs[i][0],
        pb = pairs[i][1];
      var da = distToRing(pa, b),
        db = distToRing(pb, a);
      if (da <= db) seams.push([pa, closestOnRing(pa, b)]);
      else seams.push([closestOnRing(pb, a), pb]);
    }
    return seams;
  }
  function walkRing(ring, p0, p1, wantLong) {
    var pts = ring.slice();
    if (
      pts.length > 1 &&
      pts[0][0] === pts[pts.length - 1][0] &&
      pts[0][1] === pts[pts.length - 1][1]
    )
      pts.pop();
    if (pts.length < 2) return [p0, p1];
    function ni(p) {
      var bi = 0,
        bd = 1e9;
      for (var i = 0; i < pts.length; i++) {
        var d =
          (pts[i][0] - p[0]) * (pts[i][0] - p[0]) +
          (pts[i][1] - p[1]) * (pts[i][1] - p[1]);
        if (d < bd) {
          bd = d;
          bi = i;
        }
      }
      return bi;
    }
    var i0 = ni(p0),
      i1 = ni(p1),
      n = pts.length;
    if (i0 === i1) return [p0, p1];
    function along(step) {
      var out = [pts[i0]];
      var i = i0,
        guard = 0;
      while (i !== i1 && guard < n + 2) {
        i = (i + step + n) % n;
        out.push(pts[i]);
        guard++;
      }
      return out;
    }
    var fwd = along(1),
      bwd = along(-1);
    var walk = wantLong
      ? fwd.length >= bwd.length
        ? fwd
        : bwd
      : fwd.length <= bwd.length
        ? fwd
        : bwd;
    return [p0].concat(walk.slice(1, -1), [p1]);
  }
  function fmtPt(p) {
    return Math.round(p[0] * 10) / 10 + "," + Math.round(p[1] * 10) / 10;
  }
  function ringsToDFine(rings) {
    var d = [];
    rings.forEach(function (r) {
      if (r.length < 3) return;
      d.push("M" + fmtPt(r[0]));
      for (var i = 1; i < r.length; i++) d.push("L" + fmtPt(r[i]));
      d.push("Z");
    });
    return d.join(" ");
  }
  function stripRing(fa, fb) {
    var seams = pairEndSeams(fa, fb);
    if (seams.length !== 2) return null;
    var ca = clipChain(fa, seams[0][0], seams[1][0]);
    var cb = clipChain(fb, seams[0][1], seams[1][1]);
    if (ca.length < 2 || cb.length < 2) return null;
    return ca.concat(cb.slice().reverse());
  }
  function allStripRings(ringsA, ringsB) {
    var fas = facingRuns(ringsA[0], ringsB[0], 7);
    var fbs = facingRuns(ringsB[0], ringsA[0], 7);
    var used = [];
    var out = [];
    for (var i = 0; i < fas.length; i++) {
      var fa = fas[i];
      if (fa.length < 2) continue;
      var best = -1,
        bestD = 1e18;
      for (var j = 0; j < fbs.length; j++) {
        if (used[j] || fbs[j].length < 2) continue;
        var fb = fbs[j];
        var d = Math.min(
          dist2seg(fa[0], fb[0], fb[0]),
          dist2seg(fa[0], fb[fb.length - 1], fb[fb.length - 1]),
          dist2seg(fa[fa.length - 1], fb[0], fb[0]),
          dist2seg(fa[fa.length - 1], fb[fb.length - 1], fb[fb.length - 1])
        );
        if (d < bestD) {
          bestD = d;
          best = j;
        }
      }
      if (best < 0) continue;
      used[best] = 1;
      var s = stripRing(fa, fbs[best]);
      if (s && s.length >= 3) out.push(s);
    }
    return out;
  }
  function stitchPaths(pA, pB, maxD) {
    maxD = maxD || 7;
    var ringsA = parseD(pA.getAttribute("d"));
    var ringsB = parseD(pB.getAttribute("d"));
    if (!ringsA[0] || !ringsB[0]) return null;
    var fas = facingRuns(ringsA[0], ringsB[0], maxD);
    var fbs = facingRuns(ringsB[0], ringsA[0], maxD);
    if (!fas.length || !fbs.length) return null;
    var fa = fas.reduce(function (a, b) {
      return a.length >= b.length ? a : b;
    });
    var fb = null,
      bestD = 1e18;
    for (var j = 0; j < fbs.length; j++) {
      var r = fbs[j];
      if (r.length < 2) continue;
      var d = Math.min(
        dist2seg(fa[0], r[0], r[0]),
        dist2seg(fa[0], r[r.length - 1], r[r.length - 1]),
        dist2seg(fa[fa.length - 1], r[0], r[0]),
        dist2seg(fa[fa.length - 1], r[r.length - 1], r[r.length - 1])
      );
      if (d < bestD) {
        bestD = d;
        fb = r;
      }
    }
    if (!fb) return null;
    var seams = pairEndSeams(fa, fb);
    if (seams.length !== 2) return null;
    var aBody = walkRing(ringsA[0], seams[0][0], seams[1][0], true);
    var bBody = walkRing(ringsB[0], seams[1][1], seams[0][1], true);
    var outer = aBody.concat(bBody.slice(1));
    if (outer.length < 4) return null;
    var extra = ringsA.slice(1).concat(ringsB.slice(1));
    return ringsToDFine([outer].concat(extra));
  }
  function pointInPoly(x, y, poly) {
    var inside = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var xi = poly[i][0],
        yi = poly[i][1];
      var xj = poly[j][0],
        yj = poly[j][1];
      var hit =
        yi > y !== yj > y &&
        x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi;
      if (hit) inside = !inside;
    }
    return inside;
  }
  function stripPixels(idA, idB, mergeIds) {
    var pa = pathById(idA),
      pb = pathById(idB);
    if (!pa || !pb) return [];
    var ringsA = parseD(pa.getAttribute("d"));
    var ringsB = parseD(pb.getAttribute("d"));
    var strips = allStripRings(ringsA, ringsB);
    if (!strips.length) return [];
    var minx = W,
      miny = H,
      maxx = 0,
      maxy = 0;
    for (var s = 0; s < strips.length; s++) {
      for (var i = 0; i < strips[s].length; i++) {
        if (strips[s][i][0] < minx) minx = strips[s][i][0];
        if (strips[s][i][1] < miny) miny = strips[s][i][1];
        if (strips[s][i][0] > maxx) maxx = strips[s][i][0];
        if (strips[s][i][1] > maxy) maxy = strips[s][i][1];
      }
    }
    minx = Math.max(0, minx - 1) | 0;
    miny = Math.max(0, miny - 1) | 0;
    maxx = Math.min(W - 1, maxx + 1) | 0;
    maxy = Math.min(H - 1, maxy + 1) | 0;
    var idx = [];
    for (var y = miny; y <= maxy; y++) {
      for (var x = minx; x <= maxx; x++) {
        var i0 = y * W + x;
        if (labels[i0] !== 0) continue;
        var hit = false;
        for (var s = 0; s < strips.length; s++) {
          if (pointInPoly(x + 0.5, y + 0.5, strips[s])) {
            hit = true;
            break;
          }
        }
        if (hit) idx.push(i0);
      }
    }
    return idx;
  }
  function countId(id) {
    var n = 0;
    for (var i = 0; i < labels.length; i++) if (labels[i] === id) n++;
    return n;
  }

  function fillEnclosedZeroVoids(keepId) {
    var vis = new Uint8Array(W * H);
    var dirs = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    for (var y = 0; y < H; y++) {
      for (var x = 0; x < W; x++) {
        var i0 = y * W + x;
        if (labels[i0] !== 0 || vis[i0]) continue;
        var stack = [[x, y]];
        var cells = [];
        vis[i0] = 1;
        var touchBorder = false;
        var touchForeign = false;
        while (stack.length) {
          var p = stack.pop();
          cells.push(p);
          if (p[0] === 0 || p[1] === 0 || p[0] === W - 1 || p[1] === H - 1)
            touchBorder = true;
          for (var k = 0; k < 4; k++) {
            var nx = p[0] + dirs[k][0],
              ny = p[1] + dirs[k][1];
            if (nx < 0 || ny < 0 || nx >= W || ny >= H) {
              touchBorder = true;
              continue;
            }
            var ni = ny * W + nx;
            var lab = labels[ni];
            if (lab === 0) {
              if (!vis[ni]) {
                vis[ni] = 1;
                stack.push([nx, ny]);
              }
            } else if (lab !== keepId) {
              touchForeign = true;
            }
          }
        }
        if (!touchBorder && !touchForeign) {
          for (var c = 0; c < cells.length; c++)
            labels[cells[c][1] * W + cells[c][0]] = keepId;
        }
      }
    }
  }

  function writeContour(p, id) {
    var d = ringsToD(contoursFromMask(maskOf(id)));
    if (!d) return false;
    p.setAttribute("d", d);
    p.setAttribute("fill-rule", "evenodd");
    return true;
  }

  function mergeSelected() {
    if (selected.length < 2) {
      if (hint)
        hint.textContent =
          "Shift+клик по двум телам на одном слое, затем ПКМ → объединить";
      return;
    }
    if (!canMergeSelection()) {
      if (hint)
        hint.textContent = "объединять можно только тела на одном слое";
      return;
    }
    var plist = paths();
    var ids = [];
    var nameOf = {};
    selected.forEach(function (name) {
      plist.forEach(function (p) {
        if (p.getAttribute("data-name") === name) {
          var id = lid(p);
          ids.push(id);
          nameOf[id] = name;
        }
      });
    });
    if (ids.length < 2) return;
    var keepName = selected[0];
    selected.forEach(function (n) {
      if (keepName.indexOf("Обломок") === 0 && n.indexOf("Обломок") < 0)
        keepName = n;
    });
    var keepId = 0;
    plist.forEach(function (p) {
      if (p.getAttribute("data-name") === keepName) keepId = lid(p);
    });
    if (!keepId) keepId = ids[0];
    var parent = {};
    ids.forEach(function (id) {
      parent[id] = id;
    });
    function find(a) {
      while (parent[a] !== a) a = parent[a] = parent[parent[a]];
      return a;
    }
    function uni(a, b) {
      a = find(a);
      b = find(b);
      parent[b] = a;
    }
    var pairGap = {};
    for (var a = 0; a < ids.length; a++) {
      for (var b = a + 1; b < ids.length; b++) {
        var nb = areNeighbors(ids[a], ids[b], ids);
        if (nb.ok) {
          uni(ids[a], ids[b]);
          pairGap[ids[a] + ":" + ids[b]] = nb.gap;
        }
      }
    }
    var keepRoot = find(keepId);
    var leftover = [];
    var linked = [];
    ids.forEach(function (id) {
      if (find(id) === keepRoot) linked.push(id);
      else leftover.push(nameOf[id] || String(id));
    });
    if (linked.length < 2) {
      if (hint)
        hint.textContent =
          "не соседи: между зонами нет общей щели — объединять нельзя";
      return;
    }
    ids = linked;
    var allGap = [];
    var seenGap = {};
    for (var a = 0; a < ids.length; a++) {
      for (var b = a + 1; b < ids.length; b++) {
        var key = ids[a] + ":" + ids[b];
        var gpx = pairGap[key];
        if (!gpx) continue;
        for (var g = 0; g < gpx.length; g++) {
          if (seenGap[gpx[g]]) continue;
          seenGap[gpx[g]] = 1;
          allGap.push(gpx[g]);
        }
      }
    }
    var beforeKeep = 0;
    ids.forEach(function (id) {
      beforeKeep += countId(id);
    });
    snapshotPaths("объединить");
    for (var g = 0; g < allGap.length; g++) labels[allGap[g]] = keepId;
    var drop = {};
    ids.forEach(function (id) {
      if (id === keepId) return;
      drop[id] = 1;
      for (var i = 0; i < labels.length; i++)
        if (labels[i] === id) labels[i] = keepId;
    });
    var keepPath = pathById(keepId);
    if (!keepPath) {
      discardLastUndo();
      return;
    }
    var stitchOk = true;
    var usedRaster = false;
    var faceD = Math.max(7, gapPx + 5);
    ids.forEach(function (id) {
      if (id === keepId || !stitchOk) return;
      var other = pathById(id);
      if (!other) return;
      var useD = isFrag(id) || isFrag(keepId) ? faceD : 7;
      var nd = stitchPaths(keepPath, other, useD);
      if (!nd) {
        stitchOk = false;
        return;
      }
      keepPath.setAttribute("d", nd);
      keepPath.setAttribute("fill-rule", "nonzero");
    });
    if (!stitchOk) {
      stitchOk = writeContour(keepPath, keepId);
      usedRaster = stitchOk;
    }
    var afterKeep = countId(keepId);
    var extra = afterKeep - beforeKeep - allGap.length;
    if (!stitchOk || extra > 8) {
      var snap = undoStack.pop();
      if (snap && snap.labels) labels = snap.labels.slice();
      if (snap && snap.html) restoreDom(snap.html, snap);
      renderJournal();
      if (hint)
        hint.textContent = stitchOk
          ? "отказ: сшивка добавила " + extra + " px вне разрыва"
          : "не удалось сшить контуры по шву — границы не трогаем";
      return;
    }
    plist.forEach(function (p) {
      if (drop[lid(p)]) p.remove();
    });
    buildLayers();
    selectDistrict(keepName, false);
    var msg = usedRaster
      ? "объединены · контур по маске"
      : "сшиты контуры по шву · остальные границы как были";
    if (leftover.length)
      msg +=
        " · не соседи, оставил: " +
        leftover
          .map(function (n) {
            return short(n);
          })
          .join(", ");
    if (hint) hint.textContent = msg;
  }

  document.getElementById("btn-pick").onclick = function () {
    setMode("pick");
  };
  document.getElementById("btn-pen").onclick = function () {
    setMode("pen");
    if (!target && hint)
      hint.textContent = "сначала район в слоях — карандаш отдаёт ему землю";
  };
  document.getElementById("btn-erase").onclick = function () {
    setMode("erase");
  };
  var knifeBtn = document.getElementById("btn-knife");
  if (knifeBtn)
    knifeBtn.onclick = function () {
      setMode("knife");
    };
  var rulerBtn = document.getElementById("btn-ruler");
  if (rulerBtn)
    rulerBtn.onclick = function () {
      setMode("ruler");
    };
  var markerBtn = document.getElementById("btn-marker");
  if (markerBtn)
    markerBtn.onclick = function () {
      setMode("marker");
    };
  var magnetBtn = document.getElementById("btn-magnet");
  if (magnetBtn)
    magnetBtn.onclick = function () {
      magnetOn = !magnetOn;
      syncMagnetBtn();
      if (mode === "ruler" && hint)
        hint.textContent = magnetOn
          ? "магнит к кромке включён (Alt — без)"
          : "магнит выключен";
    };
  syncMagnetBtn();
  var handBtn = document.getElementById("btn-hand");
  if (handBtn)
    handBtn.onclick = function () {
      if (handSticky) {
        handSticky = false;
        setHand(false);
        if (hint) hint.textContent = "указатель";
        return;
      }
      if (mode !== "pick") setMode("pick");
      handSticky = true;
      setHand(true);
      if (hint) hint.textContent = "рука — тащи карту · снова рука или V — выход";
    };
  document.getElementById("btn-undo").onclick = undo;
  document.getElementById("btn-redo").onclick = redo;
  document.getElementById("btn-fit").onclick = fit;
  var smoothBtn = document.getElementById("btn-smooth");
  if (smoothBtn)
    smoothBtn.onclick = function () {
      smoothSelected();
    };
  var smoothSlider = document.getElementById("smooth");
  var smoothVal = document.getElementById("smooth-val");
  if (smoothSlider) {
    smoothSlider.addEventListener("input", function () {
      splineTension = (parseInt(smoothSlider.value, 10) || 0) / 100;
      if (smoothVal) smoothVal.textContent = smoothSlider.value;
    });
    splineTension = (parseInt(smoothSlider.value, 10) || splineTension * 100) / 100;
  }
  var stepSlider = document.getElementById("smooth-step");
  var stepVal = document.getElementById("smooth-step-val");
  if (stepSlider) {
    stepSlider.addEventListener("input", function () {
      splineStep = parseFloat(stepSlider.value) || 2;
      if (stepVal) stepVal.textContent = stepSlider.value;
    });
    splineStep = parseFloat(stepSlider.value) || splineStep;
  }

  var mapsBox = document.getElementById("maps-box");
  function showLeft(which) {
    if (mapsBox) mapsBox.classList.add("show");
    var rm = document.getElementById("rail-maps");
    if (rm) rm.classList.add("on");
    if (which === "layers") {
      layersOpen = true;
      var fold = document.getElementById("layers-fold");
      if (fold) fold.classList.add("open");
    }
  }
  var railMaps = document.getElementById("rail-maps");
  if (railMaps)
    railMaps.onclick = function () {
      showLeft("maps");
    };
  var railLayers = document.getElementById("rail-layers");
  if (railLayers)
    railLayers.onclick = function () {
      showLeft("layers");
    };

  var crossEl = document.getElementById("cross");
  var xyEl = document.getElementById("xy");
  var hover = { x: -1, y: -1, name: "" };

  function nameAt(x, y) {
    if (x < 0 || y < 0 || x >= W || y >= H) return "";
    var id = labels[y * W + x];
    if (!id) return "подложка";
    var p = pathById(id);
    return p ? p.getAttribute("data-name") : "#" + id;
  }
  function hideCross() {
    if (crossEl) crossEl.classList.remove("on");
    if (xyEl) xyEl.style.display = "none";
  }
  function moveCross(ev) {
    if (panning || space || isChrome(ev.target)) {
      hideCross();
      return;
    }
    var vr = viewport.getBoundingClientRect();
    var lx = ev.clientX - vr.left;
    var ly = ev.clientY - vr.top;
    if (lx < 0 || ly < 0 || lx > vr.width || ly > vr.height) {
      hideCross();
      return;
    }
    if (crossEl) {
      crossEl.classList.add("on");
      crossEl.querySelector(".h").style.top = ly + "px";
      crossEl.querySelector(".v").style.left = lx + "px";
    }
    var p = pos(ev);
    var x = Math.round(p.x);
    var y = Math.round(p.y);
    hover.x = x;
    hover.y = y;
    hover.name = nameAt(x, y);
    if (xyEl) {
      xyEl.style.display = "block";
      var ox = lx + 14;
      var oy = ly + 14;
      if (ox + 160 > vr.width) ox = lx - 170;
      if (oy + 40 > vr.height) oy = ly - 36;
      xyEl.style.left = ox + "px";
      xyEl.style.top = oy + "px";
      xyEl.innerHTML =
        "<b>" +
        x +
        " × " +
        y +
        "</b> <span class='mute'>" +
        (hover.name || "") +
        "</span>";
    }
  }
  viewport.addEventListener("pointermove", moveCross);
  viewport.addEventListener("pointerleave", hideCross);
  var dockEl = document.querySelector(".dock");
  if (dockEl) {
    dockEl.addEventListener("pointerenter", hideCross);
    dockEl.addEventListener("pointerleave", hideCross);
  }

  function ensureRulerSvg() {
    var s = document.getElementById("ruler");
    if (s) return s;
    if (!stage) return null;
    s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    s.setAttribute("id", "ruler");
    stage.appendChild(s);
    return s;
  }
  function setRulerSize() {
    var s = ensureRulerSvg();
    if (!s) return;
    s.setAttribute("viewBox", "0 0 " + W + " " + H);
    s.setAttribute("width", String(W));
    s.setAttribute("height", String(H));
  }
  function isCoast(x, y) {
    x = x | 0;
    y = y | 0;
    if (x < 0 || y < 0 || x >= W || y >= H) return false;
    var id = labels[y * W + x];
    if (!id) return false;
    for (var dy = -1; dy <= 1; dy++) {
      for (var dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        var xx = x + dx;
        var yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) return true;
        if (labels[yy * W + xx] !== id) return true;
      }
    }
    return false;
  }
  function snapToCoast(px, py, otherId) {
    var x = Math.round(px);
    var y = Math.round(py);
    var r = Math.round(14 / (pan.s || 1));
    if (r < 3) r = 3;
    if (r > 48) r = 48;
    var bestAny = null;
    var bestAnyD = r * r + 1;
    var bestOther = null;
    var bestOtherD = r * r + 1;
    for (var dy = -r; dy <= r; dy++) {
      for (var dx = -r; dx <= r; dx++) {
        var d = dx * dx + dy * dy;
        if (d > r * r) continue;
        var xx = x + dx;
        var yy = y + dy;
        if (!isCoast(xx, yy)) continue;
        var id = labels[yy * W + xx];
        if (d < bestAnyD) {
          bestAnyD = d;
          bestAny = { x: xx, y: yy, snap: true, id: id };
        }
        if (otherId && id !== otherId && d < bestOtherD) {
          bestOtherD = d;
          bestOther = { x: xx, y: yy, snap: true, id: id };
        }
      }
    }
    if (bestOther) return bestOther;
    if (bestAny) return bestAny;
    return { x: px, y: py, snap: false, id: 0 };
  }
  function snapPoint(ev, otherId) {
    var p = pos(ev);
    if (!magnetOn || (ev && ev.altKey))
      return { x: p.x, y: p.y, snap: false, id: 0 };
    return snapToCoast(p.x, p.y, otherId || 0);
  }
  function syncMagnetBtn() {
    var b = document.getElementById("btn-magnet");
    if (b) b.classList.toggle("on", magnetOn);
  }
  function clearRuler() {
    ruler.a = null;
    ruler.b = null;
    ruler.live = false;
    var s = document.getElementById("ruler");
    if (s) s.innerHTML = "";
    if (hint && mode === "ruler")
      hint.textContent = magnetOn
        ? "клик — точка, веди мышь, второй клик — готово (магнит к кромке)"
        : "клик — точка, веди мышь, второй клик — готово";
  }
  function renderRuler() {
    var s = ensureRulerSvg();
    if (!s || !ruler.a) return;
    setRulerSize();
    var b = ruler.b || ruler.a;
    var dx = b.x - ruler.a.x;
    var dy = b.y - ruler.a.y;
    var dist = Math.sqrt(dx * dx + dy * dy);
    var mx = (ruler.a.x + b.x) / 2;
    var my = (ruler.a.y + b.y) / 2;
    var ax = Math.round(ruler.a.x);
    var ay = Math.round(ruler.a.y);
    var bx = Math.round(b.x);
    var by = Math.round(b.y);
    var label = dist.toFixed(1) + " px";
    if (dist >= 0.5)
      label +=
        "  Δ" +
        Math.round(Math.abs(dx)) +
        "×" +
        Math.round(Math.abs(dy));
    var inv = pan.s ? 1 / pan.s : 1;
    function g(x, y, inner) {
      return (
        '<g transform="translate(' +
        x +
        "," +
        y +
        ") scale(" +
        inv.toFixed(5) +
        ')">' +
        inner +
        "</g>"
      );
    }
    var aCls = ruler.a.snap ? "mark snap" : "mark";
    var bCls = b.snap ? "mark snap" : "mark";
    if (ruler.a.snap && b.snap && ruler.a.id && b.id && ruler.a.id !== b.id)
      label += "  кромка";
    var dash = (4 / (pan.s || 1)).toFixed(3);
    var gap = (3 / (pan.s || 1)).toFixed(3);
    s.innerHTML =
      '<line x1="' +
      ax +
      '" y1="' +
      ay +
      '" x2="' +
      bx +
      '" y2="' +
      by +
      '" stroke-dasharray="' +
      dash +
      " " +
      gap +
      '" vector-effect="non-scaling-stroke"/>' +
      g(ax, ay, '<circle class="' + aCls + '" r="3.5"/>') +
      g(bx, by, '<circle class="' + bCls + '" r="3.5"/>') +
      g(
        mx.toFixed(1),
        my.toFixed(1),
        '<text x="0" y="-10" text-anchor="middle">' + label + "</text>"
      );
    if (hint) hint.textContent = "линейка: " + label;
  }
  setRulerSize();

  function remountSvg(svgText) {
    var box = document.createElement("div");
    box.innerHTML = String(svgText || "").trim();
    var neu = box.querySelector("svg");
    if (!neu || !stage) return false;
    var old = stage.querySelector("svg:not(#ruler)");
    if (old) old.replaceWith(neu);
    else stage.insertBefore(neu, canvas);
    svg = neu;
    vb = svg.viewBox.baseVal;
    W = vb.width;
    H = vb.height;
    canvas.width = W;
    canvas.height = H;
    stage.style.width = W + "px";
    stage.style.height = H + "px";
    setRulerSize();
    clearRuler();
    labels = new Uint16Array(W * H);
    undoStack = [];
    redoStack = [];
    actionSeq = 0;
    selected = [];
    target = null;
    fragSeq = 0;
    buildLabels();
    measureGapPx();
    paths().forEach(function (p, i) {
      p.setAttribute("data-lid", String(i + 1));
      bindPathClick(p);
      var nm = p.getAttribute("data-name") || "";
      var fm = /^Обломок\s+(\d+)$/.exec(nm);
      if (fm) fragSeq = Math.max(fragSeq, parseInt(fm[1], 10));
    });
    bindSvgShell();
    initLayers();
    if (pendingLayerState && pendingLayerState.layers) {
      layerList = pendingLayerState.layers;
      if (pendingLayerState.activeLayerId)
        activeLayerId = pendingLayerState.activeLayerId;
      if (pendingLayerState.layerSeq) layerSeq = pendingLayerState.layerSeq;
      applyLayerVisibility();
      pendingLayerState = null;
    }
    bindOverlayClicks();
    buildLayers();
    renderJournal();
    selectDistrict(null, false);
    fit();
    setMode("pick");
    return true;
  }
  var EMPTY_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" width="720" height="720" viewBox="0 0 720 720">' +
    '<rect width="720" height="720" fill="#F2E8D5"/>' +
    '<g id="regions"></g></svg>';

  function emptyCanvas() {
    remountSvg(EMPTY_SVG);
  }

  var currentSlug = "samara";
  var currentUser = null;
  var pendingLayerState = null;
  var suppressSave = false;
  var saveTimer = 0;
  var saveDirty = false;
  var lastCatalog = { maps: [] };
  var mapStatus = document.getElementById("map-status");
  var mapListEl = document.getElementById("map-list");
  var mapSearch = document.getElementById("map-search");
  var mapHits = document.getElementById("map-hits");
  var mapQ = document.getElementById("map-q");
  var mapGo = document.getElementById("map-go");
  var KIND_RU = {
    empty: "пустой проект",
    city: "город",
    district: "район",
    region: "регион",
    place: "место",
  };
  function setMapStatus(t) {
    if (mapStatus) mapStatus.textContent = t || "";
    if (hint && t) hint.textContent = t;
  }
  function hasApi() {
    return location.protocol !== "file:";
  }
  function currentProject() {
    var maps = lastCatalog.maps || [];
    for (var i = 0; i < maps.length; i++)
      if (maps[i].slug === currentSlug) return maps[i];
    return null;
  }
  function kindLabel(m) {
    if (!m) return "";
    if (m.kind === "empty" || !m.zones) return KIND_RU.empty;
    var k = KIND_RU[m.kind] || "";
    var z = m.zones ? m.zones + " зон" : "";
    if (k && z) return k + " · " + z;
    return z || k || "проект";
  }
  function setMapChrome(m) {
    m = m || currentProject() || {};
    var chip = document.getElementById("status-chip");
    if (chip) {
      chip.className = "chip";
      chip.textContent = m.zones
        ? m.zones + " зон"
        : m.slug
          ? m.name || m.slug
          : "пусто";
    }
    var sub = document.getElementById("layers-sub");
    if (sub) sub.textContent = m.name || "проект";
    var tgt = document.getElementById("map-search-target");
    if (tgt)
      tgt.textContent = m.name
        ? "загрузить в «" + m.name + "» · ПКМ по проекту — удалить"
        : "загрузка в текущий проект";
    renderMapList(lastCatalog);
  }
  function findInCatalog(q, hit) {
    var maps = lastCatalog.maps || [];
    if (hit && hit.osm_id != null) {
      for (var i = 0; i < maps.length; i++) {
        if (maps[i].osm_relation === hit.osm_id) return maps[i];
      }
    }
    q = String(q || "")
      .toLowerCase()
      .trim();
    if (!q) return null;
    for (var j = 0; j < maps.length; j++) {
      var n = String(maps[j].name || "").toLowerCase();
      var qq = String(maps[j].query || "").toLowerCase();
      if (n === q || qq === q) return maps[j];
    }
    return null;
  }
  function startRenameProject(m, labEl) {
    if (!m || !labEl || !hasApi()) return;
    var inp = document.createElement("input");
    inp.type = "text";
    inp.className = "ln-edit";
    inp.value = m.name || "";
    labEl.replaceWith(inp);
    inp.focus();
    inp.select();
    var done = false;
    function commit() {
      if (done) return;
      done = true;
      var n = String(inp.value || "").trim();
      if (inp.parentNode) {
        var span = document.createElement("div");
        span.className = "pname";
        span.textContent = n || m.name;
        inp.replaceWith(span);
      }
      if (!n || n === m.name) {
        renderMapList();
        return;
      }
      fetch("/api/maps", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "rename", slug: m.slug, name: n }),
      })
        .then(function (r) {
          return r.json();
        })
        .then(function (j) {
          if (j.map) {
            var maps = lastCatalog.maps || [];
            for (var i = 0; i < maps.length; i++)
              if (maps[i].slug === m.slug) lastCatalog.maps[i] = j.map;
          }
          setMapChrome(j.map || m);
        })
        .catch(function () {
          renderMapList();
        });
    }
    inp.addEventListener("blur", commit);
    inp.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        inp.blur();
      }
      if (e.key === "Escape") {
        e.preventDefault();
        inp.value = m.name;
        inp.blur();
      }
    });
  }
  function parkProjectChrome() {
    var box = document.getElementById("maps-box");
    var layersFold = document.getElementById("layers-fold");
    var journalBox = document.getElementById("journal-box");
    if (!box) return;
    if (layersFold) box.appendChild(layersFold);
    if (journalBox) box.appendChild(journalBox);
  }
  function renderMapList(cat) {
    if (cat) lastCatalog = cat;
    if (!mapListEl) return;
    var box = document.getElementById("maps-box");
    parkProjectChrome();
    if (mapSearch && box && mapSearch.parentNode !== box)
      box.appendChild(mapSearch);
    mapListEl.innerHTML = "";
    if (!hasApi()) {
      var note = document.createElement("p");
      note.className = "sub";
      note.style.padding = "8px";
      note.textContent =
        "открой http://127.0.0.1:8765 — file:// не ходит в OSM";
      mapListEl.appendChild(note);
    }
    var currentCard = null;
    (lastCatalog.maps || []).forEach(function (m) {
      var card = document.createElement("div");
      card.className = "map-item" + (m.slug === currentSlug ? " on" : "");
      card.setAttribute("data-slug", m.slug);
      var b = document.createElement("button");
      b.type = "button";
      b.className = "map-item-btn";
      b.innerHTML =
        '<span class="dot"></span><div><div class="pname"></div><div class="meta"></div></div>';
      b.querySelector(".pname").textContent = m.name || m.slug;
      b.querySelector(".meta").textContent = kindLabel(m);
      b.onclick = function () {
        if (m.slug === currentSlug) {
          layersOpen = !layersOpen;
          var fold = document.getElementById("layers-fold");
          if (fold) fold.classList.toggle("open", layersOpen);
          return;
        }
        openMap(m);
      };
      b.ondblclick = function (e) {
        e.preventDefault();
        e.stopPropagation();
        startRenameProject(m, b.querySelector(".pname"));
      };
      card.appendChild(b);
      if (m.slug === currentSlug) currentCard = card;
      mapListEl.appendChild(card);
    });
    var nestHost = currentCard;
    if (nestHost) {
      var nest = document.createElement("div");
      nest.className = "nest";
      nestHost.appendChild(nest);
      nestHost = nest;
    } else {
      nestHost = mapListEl;
    }
    var layersFold = document.getElementById("layers-fold");
    var journalBox = document.getElementById("journal-box");
    if (layersFold) nestHost.appendChild(layersFold);
    if (journalBox) nestHost.appendChild(journalBox);
    if (mapSearch && box) box.appendChild(mapSearch);
  }
  function editorState() {
    return {
      layers: JSON.parse(JSON.stringify(layerList)),
      activeLayerId: activeLayerId,
      layerSeq: layerSeq,
    };
  }
  function currentSvgText() {
    var s = document.querySelector("#stage svg:not(#ruler)");
    if (!s) return "";
    return new XMLSerializer().serializeToString(s);
  }
  function scheduleSave() {
    if (suppressSave || !currentUser || !currentSlug || !hasApi()) return;
    saveDirty = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, 1200);
  }
  function flushSave() {
    if (suppressSave || !saveDirty || !currentUser || !currentSlug || !hasApi())
      return;
    saveDirty = false;
    var svg = currentSvgText();
    if (!svg) return;
    fetch("/api/maps", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "save",
        slug: currentSlug,
        svg: svg,
        state: editorState(),
      }),
    }).catch(function () {});
  }
  var mapOp = 0;
  function upsertCatalogMap(meta) {
    if (!meta || !meta.slug) return;
    var maps = lastCatalog.maps || [];
    var found = false;
    for (var i = 0; i < maps.length; i++) {
      if (maps[i].slug === meta.slug) {
        lastCatalog.maps[i] = meta;
        found = true;
      }
    }
    if (!found) lastCatalog.maps = maps.concat([meta]);
  }
  function deleteProject(m) {
    if (!m || !m.slug || !hasApi()) return;
    var op = ++mapOp;
    setBusy(false);
    fetch("/api/maps", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", slug: m.slug }),
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (j) {
        if (j.error) {
          setMapStatus(j.error);
          return;
        }
        lastCatalog.maps = j.maps || [];
        if (m.slug !== currentSlug) {
          renderMapList();
          return;
        }
        var next = lastCatalog.maps[0] || null;
        if (next) openMap(next);
        else {
          if (op !== mapOp) return;
          currentSlug = "";
          emptyCanvas();
          setMapChrome({});
          showLeft("maps");
          setMapStatus("проект удалён");
        }
      })
      .catch(function (e) {
        setMapStatus("не удалился: " + e);
      });
  }
  function openMap(m) {
    if (!m || !m.slug) return;
    if (!hasApi() || !currentUser) return;
    var op = ++mapOp;
    if (m.slug !== currentSlug) flushSave();
    setBusy(false);
    setMapStatus("открываю «" + m.name + "»…");
    suppressSave = true;
    fetch("/api/project?slug=" + encodeURIComponent(m.slug), {
      credentials: "same-origin",
    })
      .then(function (r) {
        if (r.status === 401) {
          showAuth();
          throw new Error("войди");
        }
        if (!r.ok) throw new Error(r.status);
        return r.json();
      })
      .then(function (j) {
        if (op !== mapOp) return;
        pendingLayerState = j.state || null;
        currentSlug = (j.map && j.map.slug) || m.slug;
        remountSvg(j.svg);
        setMapChrome(j.map || m);
        setMapStatus((j.map && j.map.name) || m.name);
        suppressSave = false;
      })
      .catch(function (e) {
        if (op !== mapOp) return;
        suppressSave = false;
        setMapStatus("не открылось: " + e);
      });
  }
  var loading = false;
  function setBusy(on, text) {
    loading = !!on;
    var loadTxt = document.getElementById("map-load-txt");
    if (text && loadTxt) loadTxt.textContent = text;
    if (text) setMapStatus(text);
    if (hint && text) hint.textContent = text;
    if (mapSearch) mapSearch.classList.toggle("busy", !!on);
    if (mapGo) mapGo.disabled = !!on;
  }
  function pickBestHit(q, hits) {
    q = String(q || "")
      .toLowerCase()
      .replace("ё", "е")
      .trim();
    if (!hits || !hits.length) return null;
    var wantCity = !/область|край|республика|район|округ/i.test(q);
    function nameOf(h) {
      return String(h.name || "")
        .toLowerCase()
        .replace("ё", "е");
    }
    var exact = [];
    for (var i = 0; i < hits.length; i++)
      if (nameOf(hits[i]) === q) exact.push(hits[i]);
    var pool = exact.length ? exact : hits;
    if (wantCity) {
      for (var c = 0; c < pool.length; c++) {
        var h = pool[c];
        if (h.kind === "city" || h.type === "city" || h.type === "town")
          return h;
      }
    }
    return pool[0];
  }
  function renderHits(hits, auto) {
    if (!mapHits) return;
    mapHits.innerHTML = "";
    (hits || []).forEach(function (h) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "hit";
      var k = KIND_RU[h.kind] || h.type || "";
      b.innerHTML =
        "<b>" +
        h.name +
        "</b><small>" +
        (k ? k + " · " : "") +
        (h.display || "") +
        "</small>";
      b.onclick = function () {
        loadIntoCurrent(h);
      };
      mapHits.appendChild(b);
    });
    if (auto && hits && hits.length) {
      var best = pickBestHit(mapQ ? mapQ.value : "", hits);
      if (best) loadIntoCurrent(best);
    }
  }
  function runSearch(auto) {
    var q = mapQ ? mapQ.value.trim() : "";
    if (!q || loading) return;
    if (!hasApi()) {
      setMapStatus("запусти: python scripts/map_server.py");
      return;
    }
    if (!currentSlug) {
      setMapStatus("сначала создай проект — кнопка +");
      return;
    }
    setBusy(true, "ищу «" + q + "»…");
    fetch("/api/search?q=" + encodeURIComponent(q), {
      credentials: "same-origin",
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (j) {
        if (j.error) {
          setBusy(false, j.error);
          return;
        }
        if (!(j.hits || []).length) {
          setBusy(false, "ничего не нашли");
          if (mapHits) mapHits.innerHTML = "";
          return;
        }
        var best = pickBestHit(q, j.hits);
        renderHits(j.hits, false);
        if (auto !== false && best) {
          loadIntoCurrent(best);
          return;
        }
        setBusy(false, "выбери — загрузим в этот проект");
      })
      .catch(function (e) {
        setBusy(false, "поиск не удался: " + e);
      });
  }
  function loadIntoCurrent(hit) {
    if (!currentSlug) {
      setMapStatus("сначала создай проект — кнопка +");
      return;
    }
    var slug = currentSlug;
    var op = ++mapOp;
    suppressSave = true;
    clearTimeout(saveTimer);
    saveDirty = false;
    setBusy(true, "загружаю «" + (hit.name || "") + "»…");
    fetch("/api/maps", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "load",
        slug: slug,
        query: hit.name,
        hit: hit,
      }),
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (j) {
        if (j.map) upsertCatalogMap(j.map);
        if (op !== mapOp) return;
        if (j.error) {
          suppressSave = false;
          setBusy(false, j.error);
          return;
        }
        setBusy(false);
        if (j.map && currentSlug === slug) openMap(j.map);
        else {
          suppressSave = false;
          renderMapList();
        }
      })
      .catch(function (e) {
        if (op !== mapOp) return;
        suppressSave = false;
        setBusy(false, "сборка не удалась: " + e);
      });
  }
  function refreshCatalog() {
    if (!hasApi() || !currentUser) return;
    fetch("/api/maps", { credentials: "same-origin" })
      .then(function (r) {
        if (r.status === 401) {
          showAuth();
          return null;
        }
        return r.json();
      })
      .then(function (j) {
        if (j) renderMapList(j);
      })
      .catch(function () {});
  }
  function openNewProject(m) {
    mapOp++;
    setBusy(false);
    currentSlug = m.slug;
    emptyCanvas();
    setMapChrome(m);
    showLeft("maps");
    if (mapQ) {
      mapQ.value = "";
      mapQ.focus();
    }
    if (mapHits) mapHits.innerHTML = "";
    setMapStatus("загрузить район или город в этот проект");
  }
  var btnNew = document.getElementById("btn-new-map");
  if (btnNew)
    btnNew.onclick = function () {
      showLeft("maps");
      if (!hasApi()) {
        var n = (lastCatalog.maps || []).length + 1;
        var m = {
          slug: "local-" + Date.now(),
          name: "Проект " + n,
          kind: "empty",
          zones: 0,
        };
        lastCatalog.maps = (lastCatalog.maps || []).concat([m]);
        openNewProject(m);
        setMapStatus("сначала: python scripts/map_server.py");
        return;
      }
      fetch("/api/maps", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create" }),
      })
        .then(function (r) {
          return r.json();
        })
        .then(function (j) {
          if (j.error) {
            setMapStatus(j.error);
            return;
          }
          if (j.map) {
            lastCatalog.maps = (lastCatalog.maps || []).concat([j.map]);
            openNewProject(j.map);
          }
        })
        .catch(function (e) {
          setMapStatus("не создался: " + e);
        });
    };
  var searchTimer = 0;
  if (mapQ) {
    mapQ.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        clearTimeout(searchTimer);
        runSearch(true);
      }
    });
    mapQ.addEventListener("input", function () {
      clearTimeout(searchTimer);
      var q = mapQ.value.trim();
      if (q.length < 5) return;
      searchTimer = setTimeout(function () {
        runSearch(false);
      }, 700);
    });
  }
  if (mapGo)
    mapGo.onclick = function () {
      clearTimeout(searchTimer);
      runSearch(true);
    };

  buildLabels();
  measureGapPx();
  paths().forEach(function (p, i) {
    p.setAttribute("data-lid", String(i + 1));
    var nm = p.getAttribute("data-name") || "";
    var fm = /^Обломок\s+(\d+)$/.exec(nm);
    if (fm) fragSeq = Math.max(fragSeq, parseInt(fm[1], 10));
  });
  setMode("pick");
  showLeft("maps");

  function showAuth(msg) {
    currentUser = null;
    var g = document.getElementById("auth-gate");
    if (g) g.classList.remove("hidden");
    var e = document.getElementById("auth-err");
    if (e && msg) e.textContent = msg;
  }
  function hideAuth() {
    var g = document.getElementById("auth-gate");
    if (g) g.classList.add("hidden");
  }
  function afterLogin(me) {
    if (!me || !me.user) {
      showAuth();
      return;
    }
    currentUser = me.user;
    var who = document.getElementById("auth-who");
    if (who) who.textContent = me.user.name;
    hideAuth();
    lastCatalog = { maps: me.maps || [] };
    renderMapList();
    var slug = me.last_slug || "";
    var found = null;
    (lastCatalog.maps || []).forEach(function (m) {
      if (m.slug === slug) found = m;
    });
    if (!found && lastCatalog.maps && lastCatalog.maps.length)
      found = lastCatalog.maps[0];
    if (found) openMap(found);
    else {
      currentSlug = "";
      emptyCanvas();
      showLeft("maps");
    }
  }
  function apiBase() {
    if (location.protocol === "http:" || location.protocol === "https:")
      return location.origin;
    return "http://127.0.0.1:8765";
  }
  function authFailText(e) {
    var t = String((e && e.message) || e || "");
    if (location.protocol === "file:")
      return "открой http://127.0.0.1:8765/prototype/map-bench.html — не file://";
    if (/Failed to fetch|NetworkError|Load failed/i.test(t))
      return "сервер не ответил. страница: http://127.0.0.1:8765/prototype/map-bench.html";
    return t;
  }
  function authPost(action) {
    var nameEl = document.getElementById("auth-name");
    var passEl = document.getElementById("auth-pass");
    var err = document.getElementById("auth-err");
    var name = nameEl ? nameEl.value : "";
    var password = passEl ? passEl.value : "";
    if (err) err.textContent = "";
    if (location.protocol === "file:") {
      if (err)
        err.textContent =
          "открой http://127.0.0.1:8765/prototype/map-bench.html";
      return;
    }
    fetch(apiBase() + "/api/auth", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: JSON.stringify({ action: action, name: name, password: password }),
    })
      .then(function (r) {
        return r.json().then(function (j) {
          j._ok = r.ok;
          return j;
        });
      })
      .then(function (j) {
        if (j.error) {
          if (err) err.textContent = j.error;
          return null;
        }
        return fetch(apiBase() + "/api/me", { credentials: "include" }).then(
          function (r) {
            return r.json();
          }
        );
      })
      .then(function (me) {
        if (me && me.user) afterLogin(me);
      })
      .catch(function (e) {
        if (err) err.textContent = authFailText(e);
      });
  }
  var authLogin = document.getElementById("auth-login");
  var authReg = document.getElementById("auth-register");
  if (authLogin)
    authLogin.onclick = function () {
      authPost("login");
    };
  if (authReg)
    authReg.onclick = function () {
      authPost("register");
    };
  var authPass = document.getElementById("auth-pass");
  if (authPass)
    authPass.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        authPost("login");
      }
    });
  var btnOut = document.getElementById("btn-logout");
  if (btnOut)
    btnOut.onclick = function () {
      flushSave();
      fetch(apiBase() + "/api/auth", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
        body: JSON.stringify({ action: "logout" }),
      }).finally(function () {
        currentUser = null;
        lastCatalog = { maps: [] };
        showAuth();
      });
    };
  window.addEventListener("beforeunload", function () {
    if (!currentUser || !currentSlug || !hasApi()) return;
    var svg = currentSvgText();
    if (!svg) return;
    try {
      navigator.sendBeacon(
        "/api/maps",
        new Blob(
          [
            JSON.stringify({
              action: "save",
              slug: currentSlug,
              svg: svg,
              state: editorState(),
            }),
          ],
          { type: "application/json" }
        )
      );
    } catch (err) {}
  });
  if (hasApi()) {
    fetch(apiBase() + "/api/me", { credentials: "include" })
      .then(function (r) {
        return r.json();
      })
      .then(function (me) {
        if (me && me.user) afterLogin(me);
        else showAuth();
      })
      .catch(function (e) {
        showAuth(authFailText(e));
      });
  } else {
    showAuth("открой через http://127.0.0.1:8765");
  }
})();
