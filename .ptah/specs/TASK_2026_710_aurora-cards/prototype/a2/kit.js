/* Ptah prototype kit: icon sprite, theme toggle, cursor spotlight, dev toolbar. Vanilla, no network. */
(function () {
  var P = (window.Ptah = {});
  var S = {
    'book-open': '<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',
    bot: '<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/>',
    scan: '<path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><circle cx="12" cy="12" r="3"/><path d="m16 16-1.9-1.9"/>',
    plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    arrow: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
    folder: '<path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/>',
    radar: '<path d="M19.07 4.93A10 10 0 0 0 6.99 3.34"/><path d="M4 6h.01"/><path d="M2.29 9.62A10 10 0 1 0 21.31 8.35"/><path d="M16.24 7.76A6 6 0 1 0 8.23 16.67"/><path d="M12 18h.01"/><path d="M17.99 11.66A6 6 0 0 1 15.77 16.67"/><circle cx="12" cy="12" r="2"/><path d="m13.41 10.59 5.66-5.66"/>',
    workflow: '<rect width="8" height="8" x="3" y="3" rx="2"/><path d="M7 11v4a2 2 0 0 0 2 2h4"/><rect width="8" height="8" x="13" y="13" rx="2"/>',
    chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    hammer: '<path d="m15 12-8.373 8.373a1 1 0 1 1-3-3L12 9"/><path d="m18 15 4-4"/><path d="m21.5 11.5-1.914-1.914A2 2 0 0 1 19 8.172V7l-2.26-2.26a6 6 0 0 0-4.202-1.756L9 2.96l.92.82A6.18 6.18 0 0 1 12 8.4V10l2 2h1.172a2 2 0 0 1 1.414.586L18.5 14.5"/>',
    wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94z"/>',
    shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    compass: '<circle cx="12" cy="12" r="10"/><path d="m16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z"/>',
    palette: '<path d="M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z"/><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/>',
    sparkles: '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
    moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z"/>',
    play: '<polygon points="6 3 20 12 6 21 6 3"/>',
    database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/>',
    refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    power: '<path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.77.04"/>'
  };
  var sprite = '<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>' +
    '<linearGradient id="grad-ring" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f0c75e"/><stop offset=".6" stop-color="#2dc7ad"/><stop offset="1" stop-color="#4f7fe8"/></linearGradient></defs>';
  Object.keys(S).forEach(function (k) {
    sprite += '<symbol id="i-' + k + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' + S[k] + '</symbol>';
  });
  document.body.insertAdjacentHTML('afterbegin', sprite + '</svg>');

  P.i = function (n, c) { return '<svg class="i ' + (c || '') + '" aria-hidden="true"><use href="#i-' + n + '"/></svg>'; };
  document.querySelectorAll('[data-i]').forEach(function (el) { el.outerHTML = P.i(el.getAttribute('data-i'), el.getAttribute('class') || ''); });

  /* theme */
  var root = document.documentElement;
  var q = /theme=light/.test(location.search) ? 'anubis-light' : /theme=dark/.test(location.search) ? 'anubis' : null;
  var saved = null; try { saved = localStorage.getItem('ptah-proto-theme'); } catch (e) {}
  root.setAttribute('data-theme', q || saved || 'anubis');
  P.toggleTheme = function () {
    var t = root.getAttribute('data-theme') === 'anubis' ? 'anubis-light' : 'anubis';
    root.setAttribute('data-theme', t); try { localStorage.setItem('ptah-proto-theme', t); } catch (e) {}
    var b = document.getElementById('theme'); if (b) b.setAttribute('aria-pressed', t === 'anubis-light');
  };

  /* cursor spotlight */
  document.addEventListener('pointermove', function (e) {
    var el = e.target.closest && e.target.closest('.spot'); if (!el) return;
    var r = el.getBoundingClientRect();
    el.style.setProperty('--x', e.clientX - r.left + 'px'); el.style.setProperty('--y', e.clientY - r.top + 'px');
  });

  /* dev toolbar: opts {states:[[key,label]], current, on(key), widths:true} */
  P.dev = function (o) {
    o = o || {};
    var d = document.createElement('div'); d.className = 'dev'; d.setAttribute('role', 'toolbar'); d.setAttribute('aria-label', 'Prototype controls');
    var h = '';
    (o.states || []).forEach(function (s) { h += '<button type="button" data-state="' + s[0] + '" aria-pressed="' + (s[0] === o.current) + '">' + s[1] + '</button>'; });
    if (o.states && o.states.length) h += '<span class="sep"></span>';
    if (o.widths) h += '<button type="button" data-w="600" aria-pressed="true">600px</button><button type="button" data-w="760" aria-pressed="false">760px</button><span class="sep"></span>';
    h += '<button type="button" id="theme" aria-pressed="false" aria-label="Toggle dark / light theme">' + P.i('moon', 'moon') + P.i('sun', 'sun') + '<span>Theme</span></button>';
    d.innerHTML = h; document.body.appendChild(d);
    d.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.id === 'theme') return P.toggleTheme();
      if (b.dataset.state != null) { d.querySelectorAll('[data-state]').forEach(function (x) { x.setAttribute('aria-pressed', x === b); }); o.on && o.on(b.dataset.state); }
      if (b.dataset.w) { d.querySelectorAll('[data-w]').forEach(function (x) { x.setAttribute('aria-pressed', x === b); }); root.style.setProperty('--col', b.dataset.w + 'px'); }
    });
    var t = document.getElementById('theme'); t.setAttribute('aria-pressed', root.getAttribute('data-theme') === 'anubis-light');
    o.on && o.on(o.current);
  };

  /* setup card state model (content 1:1 with project-setup-card) */
  P.setup = function (n) {
    n = +n;
    var items = [
      { k: 'skills', i: 'book-open', name: 'Skills', ok: n >= 1, status: n >= 1 ? 'Ready' : 'No skills enabled', btn: 'Open Library', m: '' },
      { k: 'agents', i: 'bot', name: 'Agents', ok: n >= 2, status: n >= 2 ? 'Ready' : 'Not configured', btn: n >= 2 ? 'Manage' : 'Configure', m: 'm-lapis' },
      { k: 'scan', i: 'scan', name: 'Project scan', ok: false, status: 'Run setup to scan this workspace', btn: 'Run setup', m: 'm-teal' }
    ];
    return {
      n: n, title: n >= 2 ? 'Ready' : 'Get ready',
      sub: n >= 2 ? 'Skills and agents are set up. Ptah understands your workspace.' : 'Prepare your skills and agents so Ptah can understand your workspace.',
      badge: n + ' of 2 ready', items: items
    };
  };
  P.esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
})();
