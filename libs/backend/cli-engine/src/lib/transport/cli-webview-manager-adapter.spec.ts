/**
 * CliWebviewManagerAdapter — batch de-multiplexing (TASK_2026_323 B7).
 *
 * Why this file exists: this transport uses the message `type` as the
 * EventEmitter event NAME, so every subscriber is bound to a concrete name.
 * Once `ChatStreamBroadcaster` began coalescing chunks into
 * `MESSAGE_TYPES.BATCH`, a transport that forwarded the batch verbatim would
 * deliver it to NOBODY — `chat-bridge`, `session-submit.service`,
 * `anthropic-proxy.service` and the TUI's `use-chat` all listen for
 * `'chat:chunk'` by name. The failure mode is silence, which is exactly the
 * kind of regression a test has to hold down.
 */

import { MESSAGE_TYPES } from '@ptah-extension/shared';

import { CliWebviewManagerAdapter } from './cli-webview-manager-adapter';

describe('CliWebviewManagerAdapter — batch unwrapping', () => {
  it('emits each inner message of a batch under its own type', async () => {
    const adapter = new CliWebviewManagerAdapter();
    const chunks: unknown[] = [];
    const batches: unknown[] = [];
    adapter.on('chat:chunk', (payload) => chunks.push(payload));
    adapter.on(MESSAGE_TYPES.BATCH, (payload) => batches.push(payload));

    await adapter.broadcastMessage(MESSAGE_TYPES.BATCH, {
      events: [
        { type: 'chat:chunk', payload: { i: 0 } },
        { type: 'chat:chunk', payload: { i: 1 } },
      ],
    });

    expect(chunks).toEqual([{ i: 0 }, { i: 1 }]);
    // The wrapper itself is consumed here, never forwarded.
    expect(batches).toHaveLength(0);
  });

  it('preserves order across a batch', async () => {
    const adapter = new CliWebviewManagerAdapter();
    const seen: number[] = [];
    adapter.on('chat:chunk', (payload: { i: number }) => seen.push(payload.i));

    await adapter.broadcastMessage(MESSAGE_TYPES.BATCH, {
      events: Array.from({ length: 20 }, (_, i) => ({
        type: 'chat:chunk',
        payload: { i },
      })),
    });

    expect(seen).toEqual(Array.from({ length: 20 }, (_, i) => i));
  });

  it('fans a heterogeneous batch out to the right listeners', async () => {
    const adapter = new CliWebviewManagerAdapter();
    const chunks: unknown[] = [];
    const completes: unknown[] = [];
    adapter.on('chat:chunk', (payload) => chunks.push(payload));
    adapter.on('chat:complete', (payload) => completes.push(payload));

    await adapter.broadcastMessage(MESSAGE_TYPES.BATCH, {
      events: [
        { type: 'chat:chunk', payload: { i: 0 } },
        { type: 'chat:complete', payload: { code: 0 } },
      ],
    });

    expect(chunks).toEqual([{ i: 0 }]);
    expect(completes).toEqual([{ code: 0 }]);
  });

  it('unwraps a batch sent through sendMessage too', async () => {
    const adapter = new CliWebviewManagerAdapter();
    const chunks: unknown[] = [];
    adapter.on('chat:chunk', (payload) => chunks.push(payload));

    await adapter.sendMessage('any-view', MESSAGE_TYPES.BATCH, {
      events: [{ type: 'chat:chunk', payload: { i: 7 } }],
    });

    expect(chunks).toEqual([{ i: 7 }]);
  });

  it('passes an ordinary message straight through, unchanged', async () => {
    const adapter = new CliWebviewManagerAdapter();
    const chunks: unknown[] = [];
    adapter.on('chat:chunk', (payload) => chunks.push(payload));

    await adapter.broadcastMessage('chat:chunk', { i: 0 });

    expect(chunks).toEqual([{ i: 0 }]);
  });

  it('ignores a malformed batch instead of throwing at the transport', async () => {
    const adapter = new CliWebviewManagerAdapter();
    const chunks: unknown[] = [];
    adapter.on('chat:chunk', (payload) => chunks.push(payload));

    await expect(
      adapter.broadcastMessage(MESSAGE_TYPES.BATCH, undefined),
    ).resolves.toBeUndefined();
    await expect(
      adapter.broadcastMessage(MESSAGE_TYPES.BATCH, { events: 'nope' }),
    ).resolves.toBeUndefined();
    await expect(
      adapter.broadcastMessage(MESSAGE_TYPES.BATCH, { events: [null, 7] }),
    ).resolves.toBeUndefined();

    expect(chunks).toHaveLength(0);
  });
});
