import { SessionApprovalRouter } from './session-approval-router';

const address = { sessionId: 'session', threadId: 'thread', requestId: '7' };
const response = {
  ...address,
  requestId: 7,
  contextId: 'context',
  processGeneration: 2,
  turnId: 'turn',
  decision: 'accept' as const,
};
function setup() {
  const claude = { handleResponse: jest.fn() };
  const cancelled = jest.fn();
  const sink = {
    sessionId: 'session',
    contextId: 'context',
    respond: jest.fn().mockReturnValue(true),
  };
  return {
    claude,
    cancelled,
    sink,
    router: new SessionApprovalRouter(claude, cancelled),
  };
}
describe('SessionApprovalRouter', () => {
  it('preserves Claude modifiedInput in the existing SDK handler', () => {
    const { router, claude, sink } = setup();
    router.register(address, { kind: 'claude' });
    const permission = {
      id: '7',
      decision: 'allow' as const,
      modifiedInput: { command: 'pwd' },
    };
    expect(
      router.respond(address, { kind: 'claude', response: permission }),
    ).toBe(true);
    expect(claude.handleResponse).toHaveBeenCalledWith('7', permission);
    expect(sink.respond).not.toHaveBeenCalled();
    expect(
      router.respond(address, { kind: 'claude', response: permission }),
    ).toBe(false);
  });
  it('routes native replies only to the owning sink', () => {
    const { router, claude, sink } = setup();
    router.register(address, { kind: 'codex', sink });
    expect(
      router.respond(address, {
        kind: 'claude',
        response: { id: '7', decision: 'allow' },
      }),
    ).toBe(false);
    expect(router.respond(address, { kind: 'codex', response })).toBe(true);
    expect(sink.respond).toHaveBeenCalledWith(response);
    expect(claude.handleResponse).not.toHaveBeenCalled();
  });
  it('isolates sessions and child threads with the same request id', () => {
    const { router, sink } = setup();
    router.register(address, { kind: 'codex', sink });
    const child = { ...address, threadId: 'child' };
    router.register(child, { kind: 'codex', sink });
    expect(
      router.respond(
        { ...address, sessionId: 'other' },
        { kind: 'codex', response },
      ),
    ).toBe(false);
    expect(router.respond(child, { kind: 'codex', response })).toBe(false);
    expect(
      router.respond(child, {
        kind: 'codex',
        response: { ...response, threadId: 'child' },
      }),
    ).toBe(true);
    expect(router.respond(address, { kind: 'codex', response })).toBe(true);
  });
  it('does not consume ownership for a stale reply rejected by the sink', () => {
    const { router, sink } = setup();
    router.register(address, { kind: 'codex', sink });
    sink.respond.mockReturnValueOnce(false);
    expect(router.respond(address, { kind: 'codex', response })).toBe(false);
    expect(router.respond(address, { kind: 'codex', response })).toBe(true);
  });
  it('cancels the UI without posting a response', () => {
    const { router, sink, claude, cancelled } = setup();
    router.register(address, { kind: 'codex', sink });
    router.cancelPrompt(address, 'timeout');
    expect(cancelled).toHaveBeenCalledWith({
      sessionId: 'session',
      requestId: '7',
      reason: 'timeout',
    });
    expect(sink.respond).not.toHaveBeenCalled();
    expect(claude.handleResponse).not.toHaveBeenCalled();
    expect(router.respond(address, { kind: 'codex', response })).toBe(false);
  });
  it('rejects ownership collisions and releases registration', () => {
    const { router, sink } = setup();
    expect(() =>
      router.register(
        { ...address, sessionId: 'foreign' },
        { kind: 'codex', sink },
      ),
    ).toThrow('session mismatch');
    const release = router.register(address, { kind: 'codex', sink });
    expect(() => router.register(address, { kind: 'claude' })).toThrow(
      'already registered',
    );
    release();
    expect(router.respond(address, { kind: 'codex', response })).toBe(false);
  });
});
