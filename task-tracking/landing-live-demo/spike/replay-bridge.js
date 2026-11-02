/* PtahCode offline replay bridge. Classic script: installed before Angular. */
(function () {
  'use strict';
  var script = document.currentScript;
  var scenarioUrl = script && script.dataset.scenario || '/replay/scenarios/chat-tool-call.json';
  var originalFetch = window.fetch.bind(window);
  var scenario = null;
  var savedState = { 'theme-v2': 'ptah-glass' };
  var misses = [];
  var outbound = [];
  var rpcCalls = [];
  var timer = null;
  var startedAt = 0;
  var elapsed = 0;
  var index = 0;
  var speed = 1;
  var ready = false;
  var scenarioPromise;
  function report(kind, value) {
    var miss = { kind: kind, value: value, at: Date.now() };
    misses.push(miss);
    console.warn('[PtahCode replay] ' + kind + ': ' + value);
  }
  function staticAsset(url) {
    try {
      var parsed = new URL(url, location.href);
      return parsed.origin === location.origin &&
        (parsed.pathname.startsWith('/assets/') ||
          parsed.pathname.startsWith('/replay/') ||
          /\.(?:js|css|svg|png|jpe?g|webp|gif|ico|woff2?|ttf|otf|map)$/.test(parsed.pathname));
    }
    catch (_) { return false; }
  }
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : input && input.url;
    if (!staticAsset(url)) {
      report('blocked-network', String(url));
      return Promise.reject(new Error('PtahCode replay is offline'));
    }
    return originalFetch(input, init);
  };
  function OfflineSocket(url) { report('blocked-network', String(url)); throw new Error('PtahCode replay is offline'); }
  window.WebSocket = OfflineSocket;
  window.EventSource = OfflineSocket;
  var originalXhrOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    if (!staticAsset(url)) { report('blocked-network', String(url)); throw new Error('PtahCode replay is offline'); }
    return originalXhrOpen.apply(this, arguments);
  };
  function activeTabId() {
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        if (!key || !key.startsWith('ptah.tabs')) continue;
        var stored = JSON.parse(localStorage.getItem(key) || 'null');
        if (stored && stored.activeTabId) return stored.activeTabId;
      }
    } catch (_) { /* A fresh page may have no persisted tab yet. */ }
    var match = location.pathname.match(/\/chat\/([^/]+)/);
    return match ? decodeURIComponent(match[1]) : undefined;
  }
  function inject(message) {
    if (message && message.payload && message.payload.tabId === '$activeTabId') {
      message = Object.assign({}, message, { payload: Object.assign({}, message.payload, { tabId: activeTabId() }) });
    }
    window.dispatchEvent(new MessageEvent('message', { data: message }));
  }
  function answer(message) {
    var payload = message.payload || {};
    var method = payload.method;
    rpcCalls.push(method);
    var map = scenario && scenario.rpc || {};
    var has = Object.prototype.hasOwnProperty.call(map, method);
    if (!has) report('unanswered-rpc', method);
    var value = has ? map[method] : null;
    var response = value && value.__rpcEnvelope ? value.__rpcEnvelope : { success: true, data: value };
    queueMicrotask(function () {
      inject(Object.assign({ type: 'rpc:response', correlationId: payload.correlationId }, response));
    });
  }
  function outboundMessage(message) {
    outbound.push(message);
    if (!message || typeof message.type !== 'string') { report('unknown-outbound', String(message)); return; }
    if (message.type === 'rpc:call') {
      scenarioPromise.then(function () { answer(message); });
    } else if (message.type === 'webview-ready') {
      ready = true;
      publishState();
      scenarioPromise.then(function () {
        var restart = sessionStorage.getItem('ptah-replay-restart') === '1';
        if (restart) sessionStorage.removeItem('ptah-replay-restart');
        if (restart || new URLSearchParams(location.search).get('autoplay') !== '0') play();
      });
    } else if (!['set-state', 'log', 'telemetry'].includes(message.type)) {
      report('unknown-outbound', message.type);
    }
  }
  var api = {
    postMessage: outboundMessage,
    getState: function () { return savedState; },
    setState: function (state) { savedState = state || {}; }
  };
  var acquired = false;
  window.acquireVsCodeApi = function () {
    if (acquired) throw new Error('acquireVsCodeApi may only be called once');
    acquired = true;
    return api;
  };
  window.vscode = api;
  window.ptahConfig = {
    isVSCode: false, isElectron: true, theme: 'dark',
    workspaceRoot: '/workspace/acme-app', workspaceName: 'acme-app',
    extensionUri: '', baseUri: '', iconUri: './images/ptah-icon.png',
    userIconUri: './images/user-icon.png', panelId: 'electron-main',
    platform: 'linux', initialView: 'chat',
    initialSessionId: '11111111-1111-4111-8111-111111111111',
    initialSessionName: 'Explore the project'
  };
  // The Electron shell switches to a workspace after TabManager's pop-out tab
  // initialization. Seed that workspace partition so the session survives it.
  var seedKey = 'ptah.tabs.ws._2Fworkspace_2Facme-app.electron-main';
  if (!localStorage.getItem(seedKey)) {
    localStorage.setItem(seedKey, JSON.stringify({ version: 2, activeTabId: 'ptahcode-demo-tab', tabs: [{
      id: 'ptahcode-demo-tab', claudeSessionId: '11111111-1111-4111-8111-111111111111',
      name: 'Explore the project', title: 'Explore the project', titleOrigin: 'history',
      order: 0, status: 'loaded', isDirty: false, lastActivityAt: Date.now(),
      messages: [{ id: 'demo-u-start', role: 'user', timestamp: 1793476800100,
        rawContent: 'Can you find where the app starts?', streamingState: null }],
      streamingState: null
    }] }));
  }
  function currentElapsed() { return timer ? elapsed + (performance.now() - startedAt) * speed : elapsed; }
  function publishState() {
    var s = replay.state;
    s.ready = ready; s.playing = !!timer; s.elapsed = currentElapsed();
    s.index = index; s.speed = speed; s.complete = !!scenario && index >= scenario.timeline.length;
    return s;
  }
  function tick() {
    timer = null;
    if (!scenario || index >= scenario.timeline.length) { publishState(); return; }
    var item = scenario.timeline[index];
    var wait = Math.max(0, (item.at - elapsed) / speed);
    startedAt = performance.now();
    timer = setTimeout(function () {
      timer = null;
      elapsed = item.at;
      index++;
      inject(item.message);
      if (index < scenario.timeline.length) tick();
      publishState();
    }, wait);
  }
  function play() {
    if (!ready || !scenario || timer || index >= scenario.timeline.length) return;
    tick();
  }
  function pause() {
    if (!timer) return;
    elapsed = currentElapsed(); clearTimeout(timer); timer = null; publishState();
  }
  function restart() {
    localStorage.removeItem(seedKey);
    localStorage.removeItem('ptah.tabs.electron-main');
    sessionStorage.setItem('ptah-replay-restart', '1');
    location.reload();
  }
  function setSpeed(value) {
    var n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return;
    var wasPlaying = !!timer; pause(); speed = n; if (wasPlaying) play(); else publishState();
  }
  var replay = window.__ptahReplay = {
    play: play, pause: pause, setSpeed: setSpeed, restart: restart,
    state: {}, misses: misses, outbound: outbound, rpcCalls: rpcCalls
  };
  window.addEventListener('message', function (event) {
    var data = event.data;
    if (!data || data.source !== 'ptah-replay-control' || event.source !== window.parent) return;
    if (data.cmd === 'play') play();
    else if (data.cmd === 'pause') pause();
    else if (data.cmd === 'speed') setSpeed(data.value);
    else if (data.cmd === 'restart') restart();
  });
  scenarioPromise = originalFetch(scenarioUrl).then(function (r) {
    if (!r.ok) throw new Error('Scenario HTTP ' + r.status);
    return r.json();
  }).then(function (value) { scenario = value; replay.scenario = value; publishState(); return value; })
    .catch(function (error) { report('scenario-load', String(error)); throw error; });
  // The host-generated ready script is absent from the plain Angular index.
  // Wait for a rendered root, then emit the same signal as the host startup script.
  var attempts = 0;
  var waitForAngular = setInterval(function () {
    attempts++;
    var root = document.querySelector('app-root');
    if ((root && root.textContent && root.textContent.trim()) || attempts > 200) {
      clearInterval(waitForAngular);
      setTimeout(function () { outboundMessage({ type: 'webview-ready' }); }, 100);
    }
  }, 50);
})();
