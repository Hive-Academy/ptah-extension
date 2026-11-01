import { installMemoryStorage } from './memory-storage';
import { installNetworkGuard } from './network-guard';
import { installHostGlobals } from './install-host-globals';
import { createRpcResponder } from './rpc-responder';
import { detectReady } from './ready-detector';
import { PlaybackEngine } from './playback-engine';
import { installControlChannel } from './control-channel';
import { loadScenario, readReplayQuery, ReplayScenarioError } from './scenario-loader';
import { disableDynamicFunction } from './disable-dynamic-function';
import { waitForBootQuiet } from './boot-quiet';
import type { ReplayMessage, ReplayScenarioData } from './types';

installMemoryStorage();
disableDynamicFunction();
const rpcCalls: string[] = [];
const outbound: ReplayMessage[] = [];
const retain = <T>(buffer: T[], item: T) => { buffer.push(item); if (buffer.length > 500) buffer.shift(); };
let answer: (message: ReplayMessage) => void = () => undefined;
installHostGlobals((message) => {
  retain(outbound, message);
  if (message?.type === 'rpc:call') {
    if (typeof message.payload?.['method'] === 'string') retain(rpcCalls, message.payload['method']);
    answer(message);
  } else if (!['webview-ready', 'set-state', 'log', 'telemetry'].includes(message?.type)) {
    report('unknown-outbound', String(message?.type));
  }
});

let query: ReturnType<typeof readReplayQuery>;
let queryError: Error | null = null;
try { query = readReplayQuery(); }
catch (error) {
  query = { id: 'chat-tool-call', autoplay: false, speed: 1 };
  queryError = error instanceof Error ? error : new Error(String(error));
}

const inject = (message: ReplayMessage) => {
  if (message.type === 'rpc:response') { readyDetector?.rpcCall(); bootQuiet?.noteActivity(); }
  window.dispatchEvent(new MessageEvent('message', { data: message }));
};

let publish: (state: PlaybackEngine['state']) => void = () => undefined;
const engine = new PlaybackEngine(query.id, query.speed, inject, (state) => publish(state));
publish = installControlChannel(engine);
const report = (kind: Parameters<typeof engine.report>[0], value: string) => engine.report(kind, value);
installNetworkGuard(report);

let scenario: ReplayScenarioData | null = null;
const scenarioPromise = (queryError ? Promise.reject<ReplayScenarioData>(queryError) : loadScenario(query)).then((value) => {
  scenario = value;
  engine.load(value);
  const config = (window as Window & { ptahConfig?: Record<string, unknown> }).ptahConfig;
  if (config) {
    const safeConfig = { ...value.config };
    delete safeConfig['initialSessionId'];
    Object.assign(config, safeConfig);
  }
  return value;
}).catch((error: unknown) => {
  const code = error instanceof ReplayScenarioError ? error.code : 'SCENARIO_LOAD';
  const message = error instanceof Error ? error.message : String(error);
  report('scenario-load', `${code}: ${message}`);
  engine.fail(code, message);
  throw error;
});
// degradation-audit: reported — the load failure is reported and failed in the handler above
void scenarioPromise.catch(() => undefined);

let bootQuiet: ReturnType<typeof waitForBootQuiet> | undefined;
let onRpcCall: () => void = () => undefined;
answer = createRpcResponder(() => scenarioPromise, inject, report, (method, params) => {
  onRpcCall();
  if (method !== 'chat:start' || scenario?.start?.mode !== 'on-send' || !engine.state.waitingForSend) return;
  const tabId = (params && typeof params === 'object') ? (params as Record<string, unknown>)['tabId'] : undefined;
  const sessionId = (scenario.rpc['chat:start'] as Record<string, unknown> | undefined)?.['sessionId'];
  if (typeof tabId !== 'string' || typeof sessionId !== 'string') { report('unknown-outbound', 'chat:start missing tabId or sessionId'); return; }
  queueMicrotask(() => { inject({ type: 'session:id-resolved', payload: { tabId, realSessionId: sessionId } }); engine.sent(); });
});

const readyDetector = detectReady((at, timedOut) => {
  if (timedOut) {
    report('ready-timeout', 'ptah-root had no children after 8 s');
    engine.fail('READY_TIMEOUT', 'PtahCode did not render within 8 s');
    return;
  }
  void scenarioPromise.then(async (value) => {
    if (engine.state.error) return;
    engine.ready(at);
    if (value.start?.mode !== 'on-send') for (const message of value.bootMessages ?? []) inject(message);
    bootQuiet = waitForBootQuiet();
    const timedOut = await bootQuiet.done;
    bootQuiet = undefined;
    if (timedOut) report('boot-quiet-timeout', 'RPC activity continued for 5 s after boot messages');
    engine.boot(value.start?.mode === 'on-send' ? false : query.autoplay);
    if (value.start?.mode === 'on-send') {
      let created = false;
      const fill = (tries = 0) => {
        if (tries === 0) {
          const newSession = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent?.includes('New session'));
          newSession?.click();
        }
        const create = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent?.trim() === 'Create');
        if (create && !created) { created = true; create.click(); }
        const input = document.querySelector<HTMLTextAreaElement>('ptah-chat-input textarea:not([readonly])');
        if (!input) { if (tries < 30) setTimeout(() => fill(tries + 1), 100); else report('ready-timeout', 'Composer textarea did not render'); return; }
        input.value = value.start!.mode === 'on-send' ? value.start!.prompt : '';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      };
      fill();
    }
  }).catch((error: unknown) => {
    // A scenario load failure already failed the engine; report any other boot error.
    if (!engine.state.error) engine.fail('BOOT', error instanceof Error ? error.message : String(error));
  });
});
onRpcCall = () => { readyDetector?.rpcCall(); bootQuiet?.noteActivity(); };

(window as Window & { __ptahReplay?: object }).__ptahReplay = Object.assign(engine, {
  outbound, rpcCalls,
  get scenario() { return scenario; },
});
