import { mcpAttachmentObserver as observer } from './mcp-attachment-observer';

describe('MCP attachment observer', () => {
  afterEach(() => observer.clear());

  it('cancels an attachment waiter on abort', async () => {
    const abort = new AbortController();
    const waiting = observer.waitFor('lane', 51821, 15_000, abort.signal);
    abort.abort();
    await expect(waiting).resolves.toBeUndefined();
    observer.record({
      agentId: 'lane',
      port: 51821,
      method: 'initialize',
      time: Date.now(),
    });
  });

  it('resolves old waiters as misses when the server port clears', async () => {
    const waiting = observer.waitFor('lane', 51821, 15_000);
    observer.clearPort(51821);
    await expect(waiting).resolves.toBeUndefined();
  });
});
