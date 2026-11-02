/** @jest-environment jsdom */
import { installMemoryStorage } from './memory-storage';
import { shiftRecordedTimes } from './time-shift';
import { createRpcResponder } from './rpc-responder';
import { detectReady } from './ready-detector';
import { PlaybackEngine } from './playback-engine';
import { installControlChannel } from './control-channel';
import { installNetworkGuard } from './network-guard';
import { loadScenario, readReplayQuery } from './scenario-loader';
import { installHostGlobals } from './install-host-globals';
import { disableDynamicFunction } from './disable-dynamic-function';
import { waitForBootQuiet } from './boot-quiet';
import type { ReplayMessage, ReplayScenarioData } from './types';

const sample = (timeline: ReplayScenarioData['timeline'] = []): ReplayScenarioData => ({
  id: 'chat-tool-call', title: 'PtahCode replay', timeBase: 1000, config: {},
  rpc: { ping: 1 }, rpcCases: { ping: [{ match: { mode: 'special' }, data: 3 }] },
  rpcErrors: { ping: { error: 'denied', errorCode: 'DENIED' } }, timeline,
});

describe('PtahCode replay runtime', () => {
  afterEach(() => { jest.useRealTimers(); document.body.innerHTML = ''; });

  it('makes Function probes throw EvalError while preserving its prototype', () => {
    const original = globalThis.Function;
    try {
      disableDynamicFunction();
      expect(() => new Function('')).toThrow(EvalError);
      expect(() => Function('return 1')).toThrow(EvalError);
      expect((function sampleFunction() {}) instanceof Function).toBe(true);
      expect(Function.prototype).toBe(original.prototype);
    } finally {
      globalThis.Function = original;
    }
  });

  it('holds an on-send timeline until the send call is accepted', () => {
    jest.useFakeTimers();
    const injected = jest.fn();
    const engine = new PlaybackEngine('on-send', 1, injected, jest.fn());
    engine.load({ ...sample([{ at: 100, message: { type: 'chat:chunk' } }]),
      start: { mode: 'on-send', prompt: 'Review the change' } });
    engine.ready(1);
    engine.boot(false);
    engine.play();
    jest.advanceTimersByTime(200);
    expect(engine.state.waitingForSend).toBe(true);
    expect(injected).not.toHaveBeenCalled();
    engine.sent();
    jest.advanceTimersByTime(100);
    expect(injected).toHaveBeenCalledTimes(1);
    expect(engine.state.complete).toBe(true);
  });

  it('stamps on-send assistant events after a delayed send', () => {
    jest.useFakeTimers();
    jest.setSystemTime(10_000);
    const injected = jest.fn();
    const engine = new PlaybackEngine('on-send', 1, injected, jest.fn());
    engine.load({ ...sample([{ at: 100, message: { type: 'chat:chunk', payload: {
      event: { timestamp: 1_100, eventType: 'message_start' },
    } } }]), start: { mode: 'on-send', prompt: 'Review the change' } });
    engine.ready(10_000);
    engine.boot(false);
    jest.advanceTimersByTime(30_000);
    const sendTime = Date.now();
    engine.sent();
    jest.advanceTimersByTime(100);
    expect(injected).toHaveBeenCalledTimes(1);
    expect((injected.mock.calls[0][0].payload?.event as { timestamp: number }).timestamp).toBe(sendTime + 100);
  });

  it('waits for another quiet period after boot RPC activity', async () => {
    jest.useFakeTimers();
    const settled = jest.fn();
    const quiet = waitForBootQuiet();
    void quiet.done.then(settled);
    jest.advanceTimersByTime(200);
    quiet.noteActivity();
    jest.advanceTimersByTime(299);
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    await quiet.done;
    expect(settled).toHaveBeenCalledWith(false);
  });

  it('caps the second quiet period despite repeated RPC activity', async () => {
    jest.useFakeTimers();
    const quiet = waitForBootQuiet(300, 1000);
    for (let i = 0; i < 5; i++) { jest.advanceTimersByTime(200); quiet.noteActivity(); }
    await expect(quiet.done).resolves.toBe(true);
  });

  it('isolates both storage areas and starts each install empty', () => {
    installMemoryStorage();
    localStorage.setItem('key', 'value');
    sessionStorage.setItem('other', 'session');
    expect(localStorage.getItem('other')).toBeNull();
    expect(localStorage.key(0)).toBe('key');
    installMemoryStorage();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it('shifts nested recorded timestamps without changing the input', () => {
    const input = { a: [999, 1000, { t: 86_401_000, later: 86_401_001 }] };
    expect(shiftRecordedTimes(input, 1000, 5000)).toEqual({ a: [999, 5000, { t: 86_405_000, later: 86_401_001 }] });
    expect(input.a[1]).toBe(1000);
  });

  it('validates the query id and normalizes playback settings', () => {
    expect(readReplayQuery('?scenario=chat-tool-call&autoplay=0&speed=2')).toEqual({ id: 'chat-tool-call', autoplay: false, speed: 2 });
    expect(readReplayQuery('?speed=garbage')).toEqual({ id: 'chat-tool-call', autoplay: true, speed: 1 });
    expect(readReplayQuery('?speed=99').speed).toBe(8);
    expect(readReplayQuery('?speed=0').speed).toBe(0.25);
    expect(() => readReplayQuery('?scenario=../private')).toThrow('Invalid PtahCode scenario id');
  });

  it('rejects bad scenario ids, HTTP failures, invalid JSON and invalid shapes', async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = jest.fn();
    globalThis.fetch = fetchMock;
    const query = readReplayQuery('?scenario=chat-tool-call');
    try {
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ ...sample(), id: 'other' }) });
      await expect(loadScenario(query, 'https://ptah.test/demo/')).rejects.toMatchObject({ code: 'SCENARIO_SHAPE' });
      expect(fetchMock).toHaveBeenLastCalledWith('https://ptah.test/demo/scenarios/chat-tool-call.json');
      fetchMock.mockResolvedValueOnce({ ok: false, status: 404 });
      await expect(loadScenario(query)).rejects.toMatchObject({ code: 'SCENARIO_HTTP' });
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => { throw new SyntaxError('bad JSON'); } });
      await expect(loadScenario(query)).rejects.toMatchObject({ code: 'SCENARIO_JSON' });
      for (const bad of [
        { ...sample(), timeline: [{ at: NaN, message: { type: 'one' } }] },
        { ...sample(), timeline: [{ at: 2, message: { type: 'one' } }, { at: 1, message: { type: 'two' } }] },
        { ...sample(), rpcCases: [] },
      ]) {
        fetchMock.mockResolvedValueOnce({ ok: true, json: async () => bad });
        await expect(loadScenario(query)).rejects.toMatchObject({ code: bad.rpcCases instanceof Array ? 'SCENARIO_RPC_MAP' : 'SCENARIO_TIMELINE' });
      }
    } finally { globalThis.fetch = originalFetch; }
  });

  it('captures the bridge scenario version synchronously and ignores malformed versions', async () => {
    const originalScript = Object.getOwnPropertyDescriptor(document, 'currentScript');
    const originalFetch = globalThis.fetch;
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => sample() });
    globalThis.fetch = fetchMock;
    try {
      for (const [version, expected] of [
        ['a1b2c3d4', '?v=a1b2c3d4'],
        ['A1B2C3D4', ''],
        ['a1b2c3d4&extra=1', ''],
      ]) {
        const script = document.createElement('script');
        script.dataset['scenarioVersion'] = version;
        Object.defineProperty(document, 'currentScript', { configurable: true, value: script });
        let isolated!: typeof import('./scenario-loader');
        jest.isolateModules(() => { isolated = jest.requireActual<typeof import('./scenario-loader')>('./scenario-loader'); });
        Object.defineProperty(document, 'currentScript', { configurable: true, value: null });
        await isolated.loadScenario(readReplayQuery('?scenario=chat-tool-call'), 'https://ptah.test/demo/');
        expect(fetchMock).toHaveBeenLastCalledWith(`https://ptah.test/demo/scenarios/chat-tool-call.json${expected}`);
      }
    } finally {
      globalThis.fetch = originalFetch;
      if (originalScript) Object.defineProperty(document, 'currentScript', originalScript);
      else Reflect.deleteProperty(document, 'currentScript');
    }
  });

  it('installs Electron host globals with one-use VS Code API and safe config', () => {
    const post = jest.fn();
    const api = installHostGlobals(post, { initialSessionId: 'secret', workspaceName: 'demo' });
    const host = window as Window & { vscode?: typeof api; acquireVsCodeApi?: () => typeof api;
      ptahConfig?: Record<string, unknown>; ptahClipboard?: { readText(): Promise<string>; hasImage(): Promise<boolean> } };
    expect(host.vscode).toBe(api);
    expect(api.getState()).toEqual({ 'theme-v2': 'ptah-glass' });
    api.setState({ key: 'value' });
    expect(api.getState()).toEqual({ key: 'value' });
    api.postMessage({ type: 'ping' });
    expect(post).toHaveBeenCalledWith({ type: 'ping' });
    expect(host.acquireVsCodeApi?.()).toBe(api);
    expect(() => host.acquireVsCodeApi?.()).toThrow('only be called once');
    expect(host.ptahConfig).toMatchObject({ isElectron: true, isVSCode: false, platform: 'linux',
      panelId: 'electron-main', workspaceName: 'demo' });
    expect(host.ptahConfig).not.toHaveProperty('initialSessionId');
    expect(host.ptahClipboard?.readText()).resolves.toBe('');
    expect(host.ptahClipboard?.hasImage()).resolves.toBe(false);
  });

  it('answers case before error before map and uses the RPC envelope', async () => {
    const received: ReplayMessage[] = [];
    const misses: string[] = [];
    const answer = createRpcResponder(async () => sample(), (value) => received.push(value), (_kind, value) => misses.push(value), jest.fn());
    answer({ type: 'rpc:call', payload: { method: 'ping', params: { mode: 'special', extra: 1 }, correlationId: 'one' } });
    answer({ type: 'rpc:call', payload: { method: 'ping', params: {}, correlationId: 'two' } });
    answer({ type: 'rpc:call', payload: { method: 'missing', params: {}, correlationId: 'three' } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(received).toEqual([
      { type: 'rpc:response', correlationId: 'one', success: true, data: 3 },
      { type: 'rpc:response', correlationId: 'two', success: false, error: 'denied', errorCode: 'DENIED' },
      { type: 'rpc:response', correlationId: 'three', success: false, error: 'No PtahCode replay answer for missing', errorCode: 'REPLAY_MISS' },
    ]);
    expect(misses).toEqual(['missing']);
  });

  it('matches nested object and array RPC case values element by element', async () => {
    const received: ReplayMessage[] = [];
    const answer = createRpcResponder(async () => ({ ...sample(), rpcCases: { ping: [
      { match: { filters: [{ id: 1, tags: ['a', 'b'] }] }, data: 'array-match' },
      { match: {}, data: 'fallback' },
    ] } }), (value) => received.push(value), jest.fn(), jest.fn());
    answer({ type: 'rpc:call', payload: { method: 'ping', correlationId: 'one', params: { filters: [{ id: 1, tags: ['a', 'b'], extra: true }] } } });
    answer({ type: 'rpc:call', payload: { method: 'ping', correlationId: 'two', params: { filters: [{ id: 1, tags: ['a'] }] } } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(received.map((item) => item['data'])).toEqual(['array-match', 'fallback']);
  });

  it('adds the public demo prices to the config:pricing-get answer', async () => {
    const received: ReplayMessage[] = [];
    const answer = createRpcResponder(async () => ({ ...sample(), rpc: { 'config:pricing-get': { pricing: {}, hydrated: true } } }),
      (value) => received.push(value), jest.fn(), jest.fn());
    answer({ type: 'rpc:call', payload: { method: 'config:pricing-get', params: {}, correlationId: 'one' } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const data = received[0]['data'] as { hydrated: boolean; pricing: Record<string, { inputCostPerToken: number }> };
    expect(data.hydrated).toBe(true);
    expect(data.pricing['claude-opus-5-5'].inputCostPerToken).toBe(4e-6);
    expect(data.pricing['claude-sonnet-5-5'].inputCostPerToken).toBe(2e-6);
  });

  it('waits for ptah-root children and 300 ms quiet, with an 8 s cap', () => {
    jest.useFakeTimers();
    const ready = jest.fn();
    const detector = detectReady(ready);
    jest.advanceTimersByTime(500);
    expect(ready).not.toHaveBeenCalled();
    document.body.innerHTML = '<ptah-root><div></div></ptah-root>';
    detector.rpcCall();
    jest.advanceTimersByTime(299);
    expect(ready).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(ready).toHaveBeenCalledTimes(1);
    detector.stop();
    document.body.innerHTML = '';
    const cap = jest.fn();
    detectReady(cap);
    jest.advanceTimersByTime(8000);
    expect(cap).toHaveBeenCalledWith(expect.any(Number), true);
  });

  it('preserves elapsed time across pause and speed changes', () => {
    jest.useFakeTimers();
    const injected: ReplayMessage[] = [];
    const engine = new PlaybackEngine('chat-tool-call', 1, (item) => injected.push(item), jest.fn());
    engine.load(sample([{ at: 1000, message: { type: 'first' } }, { at: 2000, message: { type: 'second' } }]));
    engine.ready(0); engine.boot(false); engine.play();
    jest.advanceTimersByTime(500);
    engine.pause();
    expect(engine.state.elapsed).toBeGreaterThanOrEqual(500);
    jest.advanceTimersByTime(1000);
    expect(injected).toHaveLength(0);
    engine.setSpeed(2); engine.play();
    jest.advanceTimersByTime(250);
    expect(injected[0].type).toBe('first');
    jest.advanceTimersByTime(500);
    expect(engine.state.complete).toBe(true);
    expect(injected.map((item) => item.type)).toEqual(['first', 'second']);
  });

  it('defers pre-boot play, honors pre-boot pause, and emits each message once across speed changes', () => {
    jest.useFakeTimers();
    const injected: string[] = [];
    const engine = new PlaybackEngine('chat-tool-call', 1, (item) => injected.push(item.type), jest.fn());
    engine.load(sample([{ at: 100, message: { type: 'first' } }, { at: 200, message: { type: 'second' } },
      { at: 300, message: { type: 'third' } }]));
    engine.play();
    engine.ready(0);
    jest.advanceTimersByTime(500);
    expect(injected).toEqual([]);
    engine.pause();
    expect(engine.state).toMatchObject({ booted: false, ready: false, paused: true });
    engine.boot(true);
    expect(engine.state.playing).toBe(false);
    engine.play();
    jest.advanceTimersByTime(100);
    engine.pause();
    expect(injected).toEqual(['first']);
    engine.setSpeed(8);
    engine.play();
    jest.advanceTimersByTime(13);
    engine.setSpeed(0.1);
    expect(engine.state.speed).toBe(0.25);
    jest.advanceTimersByTime(800);
    expect(injected).toEqual(['first', 'second', 'third']);
    expect(engine.state.complete).toBe(true);
  });

  it('checks control origin and source and throttles progress posts', () => {
    jest.useFakeTimers();
    const parent = { postMessage: jest.fn() };
    const listeners: Array<(event: MessageEvent) => void> = [];
    const target = { parent, location: { origin: 'https://ptah.test' }, addEventListener: (_type: string, fn: (event: MessageEvent) => void) => listeners.push(fn) } as unknown as Window;
    const controls = { state: {} as PlaybackEngine['state'], misses: [], play: jest.fn(), pause: jest.fn(), setSpeed: jest.fn(), restart: jest.fn() };
    const publish = installControlChannel(controls, target);
    const send = (origin: string, source: MessageEventSource | null) => listeners[0]({ origin, source, data: { source: 'ptah-replay-control', cmd: 'play' } } as MessageEvent);
    send('https://wrong.test', parent as unknown as MessageEventSource);
    send('https://ptah.test', null);
    expect(controls.play).not.toHaveBeenCalled();
    send('https://ptah.test', parent as unknown as MessageEventSource);
    expect(controls.play).toHaveBeenCalledTimes(1);
    const state = { scenario: 'chat-tool-call', ready: true, waitingForSend: false, booted: true, paused: false,
      readyAt: 1, playing: true, complete: false, elapsed: 0, duration: 1000, speed: 1 };
    publish(state); publish({ ...state, elapsed: 10 });
    expect(parent.postMessage).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(250);
    publish({ ...state, elapsed: 260 });
    expect(parent.postMessage).toHaveBeenCalledTimes(2);
    expect(parent.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ source: 'ptah-replay-state' }), 'https://ptah.test');
  });

  it('posts a short error code and message to the parent on failure', () => {
    const parent = { postMessage: jest.fn() };
    const target = { parent, location: { origin: 'https://ptah.test' }, addEventListener: jest.fn() } as unknown as Window;
    let publish: (state: PlaybackEngine['state']) => void = () => undefined;
    const engine = new PlaybackEngine('chat-tool-call', 1, jest.fn(), (state) => publish(state));
    publish = installControlChannel(engine, target);
    engine.report('ready-timeout', 'empty ptah-root');
    engine.fail('READY_TIMEOUT', 'PtahCode did not render within 8 s');
    expect(engine.misses[0].kind).toBe('ready-timeout');
    expect(parent.postMessage).toHaveBeenLastCalledWith({ source: 'ptah-replay-state',
      state: expect.objectContaining({ ready: false, error: 'READY_TIMEOUT: PtahCode did not render within 8 s' }) }, 'https://ptah.test');
  });

  it('blocks cross-origin fetch and XHR before native dispatch', async () => {
    const nativeFetch = jest.fn().mockResolvedValue({ ok: true });
    const nativeBeacon = jest.fn().mockReturnValue(true);
    const fake = { fetch: nativeFetch, XMLHttpRequest: { prototype: { open: jest.fn() } },
      WebSocket: class {}, EventSource: class {}, navigator: { sendBeacon: nativeBeacon } } as unknown as Window & { XMLHttpRequest: typeof XMLHttpRequest; WebSocket: typeof WebSocket };
    const misses: string[] = [];
    installNetworkGuard((_kind, value) => misses.push(value), fake, 'https://ptah.test/demo/');
    await expect(fake.fetch('https://outside.test/api')).rejects.toThrow();
    expect(() => Reflect.apply(fake.XMLHttpRequest.prototype.open, {}, ['GET', '/outside'])).toThrow();
    expect(() => new fake.WebSocket('wss://outside.test/socket')).toThrow();
    expect(() => new fake.WebSocket('wss://ptah.test/demo/socket')).not.toThrow();
    expect(fake.navigator.sendBeacon('/outside', 'data')).toBe(false);
    await fake.fetch('https://ptah.test/demo/scenarios/chat-tool-call.json');
    expect(nativeFetch).toHaveBeenCalledTimes(1);
    expect(misses).toEqual(['https://outside.test/api', '/outside', 'wss://outside.test/socket', '/outside']);
  });

  it('patches the real jsdom window network APIs and restores them after the check', async () => {
    const originalFetch = window.fetch;
    const originalOpen = window.XMLHttpRequest.prototype.open;
    const originalSocket = Object.getOwnPropertyDescriptor(window, 'WebSocket');
    const originalBeacon = Object.getOwnPropertyDescriptor(window.navigator, 'sendBeacon');
    const nativeFetch = jest.fn().mockResolvedValue({ ok: true });
    window.fetch = nativeFetch;
    Object.defineProperty(window.navigator, 'sendBeacon', { configurable: true, value: jest.fn().mockReturnValue(true) });
    const misses: string[] = [];
    try {
      installNetworkGuard((_kind, value) => misses.push(value), window, 'https://ptah.test/demo/');
      await expect(window.fetch('https://outside.test/data')).rejects.toThrow('blocks network');
      await window.fetch('https://ptah.test/demo/data');
      expect(nativeFetch).toHaveBeenCalledTimes(1);
      const xhr = new window.XMLHttpRequest();
      expect(() => xhr.open('GET', 'https://outside.test/data')).toThrow('blocks network');
      expect(() => xhr.open('GET', 'https://ptah.test/demo/data')).not.toThrow();
      expect(() => new window.WebSocket('wss://outside.test/socket')).toThrow('blocks network');
      expect(window.navigator.sendBeacon('https://outside.test/data')).toBe(false);
      expect(misses).toEqual(['https://outside.test/data', 'https://outside.test/data', 'wss://outside.test/socket', 'https://outside.test/data']);
    } finally {
      window.fetch = originalFetch;
      window.XMLHttpRequest.prototype.open = originalOpen;
      if (originalSocket) Object.defineProperty(window, 'WebSocket', originalSocket);
      if (originalBeacon) Object.defineProperty(window.navigator, 'sendBeacon', originalBeacon);
      else Reflect.deleteProperty(window.navigator, 'sendBeacon');
    }
  });
});
