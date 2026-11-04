/* Prototype behaviour only: theme switch, tab roving, copy feedback, demo of the choice flow. */
(function () {
  var q = new URLSearchParams(location.search);
  var theme = q.get('theme') === 'light' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', theme);
  if (q.get('bare')) { var b = document.querySelector('.proto-bar'); if (b) b.remove(); }
  document.querySelectorAll('[data-theme-link]').forEach(function (a) {
    var t = a.getAttribute('data-theme-link');
    a.href = location.pathname + '?theme=' + t;
    if (t === theme) a.setAttribute('aria-current', 'true');
  });
  document.querySelectorAll('.proto-bar a[data-nav]').forEach(function (a) { a.href = a.getAttribute('data-nav') + '?theme=' + theme; });

  document.querySelectorAll('[role=tablist]').forEach(function (list) {
    var tabs = Array.prototype.slice.call(list.querySelectorAll('[role=tab]'));
    function select(t) {
      tabs.forEach(function (x) {
        var on = x === t;
        x.setAttribute('aria-selected', on);
        x.tabIndex = on ? 0 : -1;
        document.getElementById(x.getAttribute('aria-controls')).hidden = !on;
      });
      t.focus();
    }
    tabs.forEach(function (t, i) {
      t.addEventListener('click', function () { select(t); });
      t.addEventListener('keydown', function (e) {
        var n = null;
        if (e.key === 'ArrowRight') n = tabs[(i + 1) % tabs.length];
        if (e.key === 'ArrowLeft') n = tabs[(i - 1 + tabs.length) % tabs.length];
        if (n) { e.preventDefault(); select(n); }
      });
    });
  });

  document.querySelectorAll('[data-copy]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var label = btn.querySelector('.lbl');
      label.textContent = 'Copied';
      setTimeout(function () { label.textContent = 'Copy'; }, 2000);
    });
  });

  /* choice demo (stage1-fresh.html) */
  var confirm = document.getElementById('demo-confirm');
  if (confirm) {
    var radios = document.querySelectorAll('input[name=main]');
    var saved = 'claude';
    var live = document.getElementById('choice-live');
    function show() {
      var v = document.querySelector('input[name=main]:checked').value;
      confirm.hidden = v === saved;
      var rc = document.querySelector('.foot .btn-primary, .foot .btn-outline');
      if (rc) { rc.classList.toggle('btn-outline', v !== saved); rc.classList.toggle('btn-primary', v === saved); }
      confirm.querySelector('.to').textContent = v === 'codex' ? 'Codex' : 'Claude Code';
      confirm.querySelector('[data-yes]').lastChild.textContent = ' Use ' + (v === 'codex' ? 'Codex' : 'Claude Code');
    }
    radios.forEach(function (r) { r.addEventListener('change', show); });
    confirm.querySelector('[data-no]').addEventListener('click', function () {
      document.querySelector('input[name=main][value=' + saved + ']').checked = true; show();
      document.querySelector('input[name=main]:checked').focus();
    });
    confirm.querySelector('[data-yes]').addEventListener('click', function () {
      saved = document.querySelector('input[name=main]:checked').value;
      confirm.hidden = true;
      document.querySelectorAll('.panel[data-p]').forEach(function (p) {
        var main = p.getAttribute('data-p') === saved;
        p.classList.toggle('main', main); p.classList.toggle('info', !main);
        var tag = p.querySelector('.tag'); tag.textContent = main ? 'Main connection' : 'Not your main connection';
        var d = p.querySelector('details[data-opt]'); if (d) d.open = main;
      });
      live.innerHTML = '<div class="note ok"><svg class="i" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg><p>Saved. ' + (saved === 'codex' ? 'Codex' : 'Claude Code') + ' is your main connection.</p></div>';
      document.querySelector('input[name=main]:checked').focus();
    });
  }
})();
