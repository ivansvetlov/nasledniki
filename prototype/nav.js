/* ===== Единая навигация «Наследники» =====
   Вставляет сверху панель с переходами между модулями:
   Редактор · Компрессор · 3D. Подсвечивает активный.
   Подключать в конце <body>, после контента. */
(function () {
  var LINKS = [
    { href: 'cartographer.html',        label: 'Редактор',   icon: 'M12 20h9 M16.5 3.5a2.1 2.1 0 0 1 3 3 L7 19 l-4 1 1-4 Z' },
    { href: 'compressor-demo.html',     label: 'Компрессор', icon: 'M2 12c2-4 4-4 6 0s4 4 6 0 4-4 6 0' },
    { href: 'seams-demo.html',          label: 'Стыки',     icon: 'M4 12h6 M14 12h6 M12 4v6 M12 14v6' },
    { href: 'http://localhost:5173/',   label: '3D карта',   icon: 'M12 2 3 7v10l9 5 9-5V7Z M3 7l9 5 9-5 M12 12v10' }
  ];

  function svg(paths) {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + paths + '"/></svg>';
  }

  function init() {
    var body = document.body;
    if (body.querySelector('.topnav')) return;

    var nav = document.createElement('header');
    nav.className = 'topnav';
    var html = '';
    html += '<span class="lights"><i class="r"></i><i class="y"></i><i class="g"></i></span>';
    html += '<span class="brand">Наследники · прототип</span>';
    html += '<span class="spacer"></span>';
    html += '<span class="links"></span>';
    nav.innerHTML = html;

    var linksWrap = nav.querySelector('.links');
    var cur = new URL(location.href);
    LINKS.forEach(function (l) {
      var u = new URL(l.href, location.href);
      var a = document.createElement('a');
      a.className = 'navlink';
      a.href = l.href;
      a.innerHTML = svg(l.icon) + '<span>' + l.label + '</span>';
      var active = u.origin === cur.origin && u.pathname === cur.pathname;
      if (active) a.classList.add('active');
      linksWrap.appendChild(a);
    });

    body.insertBefore(nav, body.firstChild);
    body.classList.add('has-topnav');

    var isThree = document.body.getAttribute('data-three') === '1' ||
                   (!!document.querySelector('#app') && !document.querySelector('.app'));
    var css = '';
    css += 'body{background:var(--background);color:var(--foreground);font-family:var(--font)}';
    if (document.querySelector('.app')) {
      // редактор: flex-колонка, навбар сверху, .app заполняет остаток
      css += 'body.has-topnav{height:100vh;overflow:hidden}';
      css += '.app{height:auto;flex:1 1 auto;min-height:0}';
      css += 'button{font-family:var(--font)}';
    } else if (isThree) {
      // 3D (three): фиксированный навбар, канвас в #scene под ним
      css += '.topnav{position:fixed;top:0;left:0;right:0}';
      css += 'body.has-topnav{padding-top:46px}';
      css += '#scene{position:absolute;top:46px;left:0;right:0;bottom:0;overflow:hidden}';
    } else {
      // обычные страницы (бенч): навбар + прокручиваемый контент
      css += 'body.has-topnav{min-height:100vh}';
      css += '.page{padding:16px}';
      wrapPage(body, nav);
    }
    var st = document.createElement('style');
    st.textContent = css;
    document.head.appendChild(st);
  }

  function wrapPage(body, nav) {
    var page = document.createElement('div');
    page.className = 'page';
    while (body.children.length > 1) {
      var c = body.children[1];
      if (c === nav || c.tagName === 'SCRIPT') break;
      page.appendChild(c);
    }
    body.appendChild(page);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
