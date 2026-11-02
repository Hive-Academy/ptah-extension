/** @jest-environment jsdom */
import type { ReplayMessage, ReplayScenarioData } from './types';

describe('replay bridge entry', () => {
  it('installs isolation and globals before loading, then waits for boot before autoplay', async () => {
    jest.useFakeTimers();
    const order: string[] = [];
    let ready!: (at: number, timedOut: boolean) => void;
    let settleQuiet!: (timedOut: boolean) => void;
    const published = jest.fn();
    let outbound!: (message: ReplayMessage) => void;
    const scenario: ReplayScenarioData = { id: 'chat-tool-call', title: 'demo', timeBase: 1000,
      config: {}, rpc: {}, timeline: [{ at: 100, message: { type: 'timeline' } }],
      bootMessages: [{ type: 'switchView', payload: { view: 'chat', sessionId: '11111111-1111-4111-8111-111111111111' } }] };
    jest.doMock('./memory-storage', () => ({ installMemoryStorage: () => { order.push('storage'); } }));
    jest.doMock('./disable-dynamic-function', () => ({ disableDynamicFunction: () => { order.push('Function'); } }));
    jest.doMock('./install-host-globals', () => ({ installHostGlobals: (post: typeof outbound) => { order.push('globals'); outbound = post; } }));
    jest.doMock('./network-guard', () => ({ installNetworkGuard: () => { order.push('network'); } }));
    jest.doMock('./scenario-loader', () => ({
      ReplayScenarioError: class extends Error {},
      readReplayQuery: () => ({ id: 'chat-tool-call', autoplay: true, speed: 1 }),
      loadScenario: async () => { order.push('load'); return scenario; },
    }));
    jest.doMock('./ready-detector', () => ({ detectReady: (callback: typeof ready) => {
      ready = callback; return { rpcCall: jest.fn(), stop: jest.fn() };
    } }));
    jest.doMock('./boot-quiet', () => ({ waitForBootQuiet: () => ({ noteActivity: jest.fn(),
      done: new Promise<boolean>((resolve) => { settleQuiet = resolve; }) }) }));
    jest.doMock('./control-channel', () => ({ installControlChannel: () => published }));
    const messages: ReplayMessage[] = [];
    const onMessage = (event: MessageEvent) => messages.push(event.data as ReplayMessage);
    window.addEventListener('message', onMessage);
    try {
      await jest.isolateModulesAsync(async () => { await import('./replay-bridge.entry'); });
      expect(order.slice(0, 5)).toEqual(['storage', 'Function', 'globals', 'network', 'load']);
      const engine = (window as Window & { __ptahReplay?: { state: { ready: boolean; booted: boolean; paused: boolean; playing: boolean };
        outbound: ReplayMessage[]; play(): void; pause(): void } }).__ptahReplay;
      expect(engine).toBeDefined();
      for (let i = 0; i < 501; i++) outbound({ type: 'log', payload: { index: i } });
      expect(engine?.outbound).toHaveLength(500);
      expect(engine?.outbound[0].payload?.['index']).toBe(1);
      engine?.play();
      ready(123, false);
      await Promise.resolve();
      expect(messages.map((item) => item.type)).toEqual(['switchView']);
      expect(engine?.state.ready).toBe(false);
      engine?.pause();
      settleQuiet(false);
      await Promise.resolve();
      expect(engine?.state).toMatchObject({ booted: true, ready: true, paused: true, playing: false });
      engine?.play();
      jest.advanceTimersByTime(100);
      expect(messages.map((item) => item.type)).toEqual(['switchView', 'timeline']);
      expect(published).toHaveBeenCalledWith(expect.objectContaining({ ready: true }));
    } finally {
      window.removeEventListener('message', onMessage);
      jest.useRealTimers();
      jest.resetModules();
      for (const name of ['./memory-storage', './disable-dynamic-function', './install-host-globals',
        './network-guard', './scenario-loader', './ready-detector', './boot-quiet', './control-channel']) jest.dontMock(name);
    }
  });
});
