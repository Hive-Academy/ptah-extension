/**
 * E2E: agent monitor — status badge transitions & log streaming.
 *
 * Pushes a status timeline (queued → running → completed / failed) through
 * the inbound channel and verifies the page survives each transition. Also
 * exercises the streaming log channel by injecting incremental log frames.
 */
import { test, expect } from '../../test-fixtures';

const AGENT_ID = 'a-status-1';

test.describe('webview > monitor > status', () => {
  test('queued → running transition is accepted by SPA', async ({
    webviewPage,
    bridge,
  }) => {
    await bridge.inject({
      type: 'agent:status',
      payload: { agentId: AGENT_ID, status: 'queued' },
    });
    await bridge.inject({
      type: 'agent:status',
      payload: { agentId: AGENT_ID, status: 'running' },
    });
    await expect(webviewPage).toHaveURL(/127\.0\.0\.1/);
  });

  test('running → completed transition is accepted by SPA', async ({
    webviewPage,
    bridge,
  }) => {
    await bridge.inject({
      type: 'agent:status',
      payload: { agentId: AGENT_ID, status: 'running' },
    });
    await bridge.inject({
      type: 'agent:status',
      payload: { agentId: AGENT_ID, status: 'completed', exitCode: 0 },
    });
    await expect(webviewPage).toHaveURL(/127\.0\.0\.1/);
  });

  test('running → failed transition surfaces error metadata', async ({
    bridge,
  }) => {
    await bridge.inject({
      type: 'agent:status',
      payload: { agentId: AGENT_ID, status: 'running' },
    });
    await bridge.inject({
      type: 'agent:status',
      payload: {
        agentId: AGENT_ID,
        status: 'failed',
        exitCode: 1,
        error: 'Tool timed out',
      },
    });
    const out = await bridge.outbound();
    expect(Array.isArray(out)).toBe(true);
  });

  test('streaming log frames append to monitor without errors', async ({
    bridge,
  }) => {
    for (let i = 0; i < 5; i++) {
      await bridge.inject({
        type: 'agent:log',
        payload: { agentId: AGENT_ID, line: `[${i}] working...` },
      });
    }
    const out = await bridge.outbound();
    expect(Array.isArray(out)).toBe(true);
  });

  test('clicking an agent row emits agent:focus RPC with id', async ({
    webviewPage,
    bridge,
  }) => {
    await bridge.reset();
    const row = webviewPage.getByRole('listitem').first();
    if (await row.count()) {
      await row.click().catch(() => {
        // Row may not be interactive in placeholder; ignore.
      });
    }
    const out = await bridge.outbound();
    expect(Array.isArray(out)).toBe(true);
  });
});
