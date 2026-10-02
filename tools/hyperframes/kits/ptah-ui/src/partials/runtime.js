/* ptah-ui kit runtime. Inlined into each component's IIFE by build.mjs, so every mount gets its own copy.
   Rules (SPEC section 2/3): one paused timeline, fromTo with explicit endpoints, tl.set for discrete steps,
   no CSS transitions, no Date.now / Math.random, finite repeats only, transforms in px derived from --u. */
function ptahKit(root, cfg) {
  var tl = gsap.timeline({ paused: true });
  var vars = window.__hyperframes && window.__hyperframes.getVariables ? window.__hyperframes.getVariables() : {};
  var DW = cfg.dw;
  var DH = cfg.dh;
  root.style.setProperty("--dw", DW);
  root.style.setProperty("--dh", DH);
  root.style.setProperty("--u", "min(calc(100cqw / " + DW + "), calc(100cqh / " + DH + "))");
  var rw = root.offsetWidth || 1920;
  var rh = root.offsetHeight || 1080;
  var U = Math.min(rw / DW, rh / DH);
  // The template's own data-duration is a default; a mounted instance takes its length from the host element.
  var host = root.parentElement && root.parentElement.closest ? root.parentElement.closest("[data-duration]") : null;
  var duration = Math.max(0.001, parseFloat((host && host.getAttribute("data-duration")) || root.dataset.duration || cfg.duration || "4"));
  // The template's inner .clip carries the template default length; a longer mount would blank when it ends.
  var innerClip = root.querySelector(".clip[data-duration]");
  if (innerClip && host) innerClip.setAttribute("data-duration", String(duration));

  function has(name) {
    return vars[name] != null && String(vars[name]).trim() !== "";
  }
  var K = {
    tl: tl,
    root: root,
    vars: vars,
    U: U,
    duration: duration,
    px: function (d) {
      return d * U;
    },
    str: function (name, def) {
      return has(name) ? String(vars[name]) : def;
    },
    num: function (name, def, min, max) {
      var n = Number(vars[name]);
      if (!has(name) || !isFinite(n)) n = def;
      if (min != null) n = Math.max(min, n);
      if (max != null) n = Math.min(max, n);
      return n;
    },
    bool: function (name, def) {
      if (!has(name)) return def;
      var v = vars[name];
      return v === true || v === "true" || v === 1 || v === "1";
    },
    oneOf: function (name, list, def) {
      return list.indexOf(vars[name]) >= 0 ? vars[name] : def;
    },
    /* cues: per-index override of default beat times, forced non-decreasing, clamped inside the mount */
    cues: function (defaults) {
      var raw = String(vars.cues == null ? "" : vars.cues).split(",");
      var out = [];
      for (var i = 0; i < defaults.length; i++) {
        var s = (raw[i] || "").trim();
        var n = Number(s);
        var t = s !== "" && isFinite(n) ? n : defaults[i];
        if (i > 0) t = Math.max(t, out[i - 1]);
        out.push(Math.max(0, t));
      }
      return out;
    },
    esc: function (s) {
      return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    },
    el: function (html) {
      var d = document.createElement("div");
      d.innerHTML = html.trim();
      return d.firstChild;
    },
    q: function (sel) {
      return root.querySelector(sel);
    },
    qa: function (sel) {
      return Array.prototype.slice.call(root.querySelectorAll(sel));
    },
    /* motion primitives */
    hide: function (els) {
      gsap.set(els, { opacity: 0 });
    },
    settle: function (el, t, o) {
      o = o || {};
      var dy = o.dy == null ? 16 : o.dy;
      var dx = o.dx || 0;
      gsap.set(el, { opacity: 0, x: dx * U, y: dy * U });
      tl.fromTo(el, { opacity: 0, x: dx * U, y: dy * U }, { opacity: 1, x: 0, y: 0, duration: o.dur || 0.45, ease: "power3.out" }, t);
    },
    spring: function (el, t, o) {
      o = o || {};
      gsap.set(el, { opacity: 0, scale: 0.6 });
      tl.fromTo(el, { opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1, duration: o.dur || 0.32, ease: "back.out(1.6)" }, t);
    },
    fadeIn: function (el, t, d) {
      gsap.set(el, { opacity: 0 });
      tl.fromTo(el, { opacity: 0 }, { opacity: 1, duration: d || 0.2, ease: "none", immediateRender: false }, t);
    },
    fadeOut: function (el, t, d) {
      tl.fromTo(el, { opacity: 1 }, { opacity: 0, duration: d || 0.2, ease: "none", immediateRender: false }, t);
    },
    /* badge fill layers: <i class="f-ghost|f-info|f-success|f-error|f-gold"> inside .fills */
    fill: function (badge, name, t, d) {
      var layers = badge.querySelectorAll(".fills > i");
      for (var i = 0; i < layers.length; i++) {
        var on = layers[i].getAttribute("data-f") === name;
        if (t == null) gsap.set(layers[i], { opacity: on ? 1 : 0 });
        else tl.to(layers[i], { opacity: on ? 1 : 0, duration: d || 0.2, ease: "none" }, t);
      }
    },
    badgeHtml: function (label, fills, cls) {
      var f = fills
        .map(function (n) {
          return '<i class="f-' + n + '" data-f="' + n + '"></i>';
        })
        .join("");
      return '<span class="pu-badge ' + (cls || "") + '"><span class="fills">' + f + '</span><span class="lbl">' + K.esc(label) + "</span></span>";
    },
    press: function (el, t) {
      tl.fromTo(el, { scale: 1, filter: "brightness(1)" }, { scale: 0.94, filter: "brightness(1.15)", duration: 0.14, ease: "power2.inOut", immediateRender: false }, t);
      tl.fromTo(el, { scale: 0.94, filter: "brightness(1.15)" }, { scale: 1, filter: "brightness(1)", duration: 0.22, ease: "power2.inOut", immediateRender: false }, t + 0.14);
    },
    spin: function (el, t, d) {
      var turns = Math.max(1, Math.round(d));
      tl.fromTo(el, { rotation: 0 }, { rotation: 360 * turns, duration: d, ease: "none", immediateRender: false }, t);
    },
    blink: function (el, t0, t1) {
      for (var t = t0, on = true; t < t1; t += 0.25, on = !on) tl.set(el, { opacity: on ? 1 : 0 }, t);
      tl.set(el, { opacity: 0 }, t1);
    },
    /* word stream: supports **bold** and `code`; every unit is laid out first at opacity 0 (no reflow) */
    stream: function (container, text, t, rate) {
      var parts = [];
      var re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
      var last = 0;
      var m;
      while ((m = re.exec(text))) {
        if (m.index > last) parts.push({ k: "t", s: text.slice(last, m.index) });
        parts.push(m[0][0] === "`" ? { k: "c", s: m[0].slice(1, -1) } : { k: "b", s: m[0].slice(2, -2) });
        last = m.index + m[0].length;
      }
      if (last < text.length) parts.push({ k: "t", s: text.slice(last) });
      var units = [];
      container.innerHTML = "";
      parts.forEach(function (p) {
        if (p.k === "c") {
          var c = document.createElement("span");
          c.className = "pu-code";
          c.textContent = p.s;
          container.appendChild(c);
          units.push(c);
          return;
        }
        p.s.split(/(\s+)/).forEach(function (w) {
          if (w === "") return;
          if (/^\s+$/.test(w)) {
            container.appendChild(document.createTextNode(" "));
            return;
          }
          var s = document.createElement(p.k === "b" ? "strong" : "span");
          s.textContent = w;
          container.appendChild(s);
          units.push(s);
        });
      });
      if (!rate) return t;
      gsap.set(units, { opacity: 0 });
      units.forEach(function (u, i) {
        tl.set(u, { opacity: 1 }, t + i / rate);
      });
      return t + units.length / rate;
    },
    /* character typing: one tl.set of textContent per char (seek-safe).
       GSAP treats an empty recorded start value as missing, so the first char's set
       would not revert on a backward seek. The leading "" set at the same time
       reverts after it and restores the empty field. */
    type: function (el, text, t, rate) {
      el.textContent = "";
      tl.set(el, { textContent: "" }, t);
      for (var i = 1; i <= text.length; i++) tl.set(el, { textContent: text.slice(0, i) }, t + (i - 1) / rate);
      return t + text.length / rate;
    },
    /* numeric count: discrete steps at 30 fps, formatted by fmt(value) */
    count: function (el, from, to, t, d, fmt) {
      var steps = Math.max(1, Math.round(d * 30));
      el.textContent = fmt(from);
      for (var i = 1; i <= steps; i++) {
        var p = 1 - Math.pow(1 - i / steps, 3);
        tl.set(el, { textContent: fmt(from + (to - from) * p) }, t + (i / steps) * d);
      }
    },
    /* height reveal of a pre-laid-out block: animate a wrapper's height in px (container stays laid out) */
    expand: function (wrap, t, toH, d) {
      gsap.set(wrap, { height: 0, overflow: "hidden" });
      tl.fromTo(wrap, { height: 0 }, { height: toH * U, duration: d || 0.55, ease: "power3.out", immediateRender: false }, t);
    },
    /* gold focus beat on [data-ptah-part=name]; others dim */
    focus: function (name, t, dim) {
      if (!name) return;
      var parts = K.qa("[data-ptah-part]");
      var target = null;
      parts.forEach(function (p) {
        if (p.getAttribute("data-ptah-part") === name) target = p;
      });
      if (!target) return;
      // The ring lives inside the target and follows its final (font-loaded) size: no build-time measuring.
      // A target that clips its overflow gets the ring on its inner edge instead of 10 px outside.
      var cs = getComputedStyle(target);
      if (cs.position === "static") target.style.position = "relative";
      var inset = cs.overflow === "hidden" ? "0px" : "calc(-10 * var(--u))";
      var ring = document.createElement("div");
      ring.className = "pu-ring";
      ring.style.left = inset;
      ring.style.top = inset;
      ring.style.right = inset;
      ring.style.bottom = inset;
      ring.style.borderRadius = "calc(" + (parseFloat(cs.borderTopLeftRadius || "0") / U + 8) + " * var(--u))";
      ring.style.zIndex = "5";
      target.appendChild(ring);
      gsap.set(ring, { opacity: 0, scale: 1.04 });
      tl.fromTo(ring, { opacity: 0, scale: 1.04 }, { opacity: 1, scale: 1, duration: 0.5, ease: "expo.out" }, t);
      parts.forEach(function (p) {
        if (p === target || p.contains(target) || target.contains(p)) return;
        tl.to(p, { opacity: dim, duration: 0.5, ease: "expo.out" }, t);
      });
    },
    focusFromVars: function (defaultAt) {
      var name = K.str("focus", "");
      var at = K.num("focusAt", -1);
      K.focus(name, at >= 0 ? at : defaultAt, K.num("dimOthers", 0.38, 0, 1));
    },
    vignette: function () {
      if (K.bool("vignette", false)) root.insertBefore(K.el('<div class="pu-vignette"></div>'), root.firstChild);
    },
    finish: function (stage) {
      var exit = K.oneOf("exit", ["none", "fade", "up"], "none");
      if (exit !== "none") {
        var out = Math.min(0.45, duration * 0.25);
        tl.to(stage, { opacity: 0, y: exit === "up" ? -12 * U : 0, duration: out, ease: "power2.in" }, duration - out);
      }
      // preroll: start the mount as if it had already played for N seconds (a settled world at a scene cut).
      // A wrapper timeline scrubs the built one from N onward, so seeking stays a pure function of time.
      var pre = K.num("preroll", 0, 0, 60);
      var reg = tl;
      if (pre > 0) {
        reg = gsap.timeline({ paused: true });
        reg.add(tl.tweenFromTo(pre, Math.max(pre, tl.duration()), { ease: "none" }), 0);
      }
      window.__timelines[cfg.id] = reg;
    },
    icon: function (name, size, color, extra) {
      var p = PU_ICONS[name] || PU_ICONS.terminal;
      return (
        '<svg class="pu-ico ' + (extra || "") + '" viewBox="0 0 24 24" fill="none" stroke="' + (color || "currentColor") +
        '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:calc(' + size + " * var(--u));height:calc(" + size + ' * var(--u))">' +
        p + "</svg>"
      );
    },
  };
  return K;
}
/* lucide-style icons (24x24, stroke 2) */
var PU_ICONS = {
  "chevron-down": '<path d="m6 9 6 6 6-6"/>',
  "chevron-right": '<path d="m9 18 6-6-6-6"/>',
  terminal: '<path d="m4 17 6-6-6-6"/><path d="M12 19h8"/>',
  "file-text": '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/>',
  "file-plus": '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M9 15h6"/><path d="M12 12v6"/>',
  pencil: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  brain: '<path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/><path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/><path d="M12 5v13"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  loader: '<path d="M21 12a9 9 0 1 1-6.219-8.56"/>',
  send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  "arrow-up": '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  mic: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v3"/>',
  "message-square": '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  square: '<rect x="4" y="4" width="16" height="16" rx="2"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  layout: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/>',
  zap: '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
  bot: '<path d="M12 8V4H8"/><rect x="4" y="8" width="16" height="12" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/>',
  "list-checks": '<path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/>',
  workflow: '<rect x="3" y="3" width="8" height="8" rx="2"/><path d="M7 11v4a2 2 0 0 0 2 2h4"/><rect x="13" y="13" width="8" height="8" rx="2"/>',
};
/* tool name to icon and icon color (SPEC 1.6 item 1; tool-icon.component.ts:94-127) */
function ptahToolIcon(tool) {
  var t = String(tool);
  if (/^(Read|Glob)$/.test(t)) return { icon: t === "Read" ? "file-text" : "search", color: "#3b82f6" };
  if (t === "Write") return { icon: "file-plus", color: "#16a34a" };
  if (t === "Bash") return { icon: "terminal", color: "#f97316" };
  if (t === "Grep") return { icon: "search", color: "#d4af37" };
  if (t === "Edit") return { icon: "pencil", color: "#fbbf24" };
  if (t === "Workflow") return { icon: "workflow", color: "#2563eb" };
  if (/^Task/.test(t)) return { icon: "list-checks", color: "#d4af37" };
  if (t === "SendMessage") return { icon: "message-square", color: "#3b82f6" };
  if (/^mcp__ptah__/.test(t)) return { icon: "zap", color: "#d4af37" };
  return { icon: "terminal", color: "#8e8887" };
}
