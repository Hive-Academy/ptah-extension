import { attachElectronHostAttention, createAttentionRendererReadiness } from './bootstrap';

describe('Electron attention boot', () => {
  it.each(['resolve', 'attach'] as const)('logs %s failure by name and continues', (stage) => {
    const warn = jest.fn();
    const attach = jest.fn();
    const resolve = () => {
      if (stage === 'resolve') throw new TypeError('secret');
      return { observe: jest.fn() };
    };
    if (stage === 'attach') attach.mockImplementation(() => { throw new TypeError('secret'); });
    attachElectronHostAttention(resolve, attach, warn);
    const nextBootStep = jest.fn();
    nextBootStep();
    expect(nextBootStep).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('Host attention attach failed: TypeError');
    expect(warn.mock.calls.join(' ')).not.toContain('secret');
  });

  it('waits for the current renderer snapshot request, not page load', () => {
    const loading: Array<() => void> = [];
    const contents = { on: (_event: 'did-start-loading', listener: () => void) => { loading.push(listener); } };
    let current: typeof contents | null = contents;
    let rpc: ((sender: object, message: unknown) => void) | undefined;
    const readiness = createAttentionRendererReadiness(() => current, (listener) => { rpc = listener; });
    const delivered = jest.fn();
    expect(readiness.onReady(delivered)).toBe(true);
    rpc?.({}, { type: 'rpc:call', payload: { method: 'attention:getSnapshot' } });
    expect(readiness.isReady()).toBe(false);
    rpc?.(contents, { type: 'rpc:call', payload: { method: 'attention:getSnapshot' } });
    expect(readiness.isReady()).toBe(true);
    expect(delivered).toHaveBeenCalledTimes(1);
    loading[0]();
    expect(readiness.isReady()).toBe(false);
    current = null;
    expect(readiness.onReady(delivered)).toBe(false);
  });
});
