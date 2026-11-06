/**
 * Completion durability through `LaneCompletionNotifier` + the parent store:
 * definite failure results, outbox replay across restarts, exit ordering.
 */
import 'reflect-metadata';
import {
  AgentId,
  type AgentProcessInfo,
  type IAgentAdapter,
} from '@ptah-extension/shared';
import type { IFileSystemProvider } from '@ptah-extension/platform-core';
import type { Logger } from '@ptah-extension/vscode-core';
import { LaneCompletionNotifier } from './lane-completion-notifier.service';
import type { LaneCheckpointResult, LaneTerminalCheckpoint } from './lane-terminal-checkpoint.port';
import { FakeStateStorage } from './parent-delivery/__fixtures__/fake-state-storage';
import { ParentEnvelopeStoreService } from './parent-delivery/parent-envelope-store.service';
import {
  ParentDeliveryDrainerService,
  type ParentDeliveryEvent,
} from './parent-delivery/parent-delivery-drainer.service';
import {
  PARENT_COMPLETION_OUTBOX_PREFIX,
  PARENT_ENVELOPE_BODY_PREFIX,
  type ParentCompletionOutboxEntry,
} from './parent-delivery/parent-envelope.schema';
import { MAX_PENDING_COMPLETION_REPLAYS, PendingCompletionReplays } from './lane-completion-replay';

const PARENT = '11111111-2222-4333-8444-555555555555';
const AGENT = AgentId.from('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
const COMPLETED_AT = '2026-11-07T00:00:00.000Z';
const KEY = `${AGENT}:${COMPLETED_AT}`;
const DAY = 24 * 60 * 60 * 1000;

let now = Date.UTC(2026, 10, 7);

function logger(): Logger {
  const log: Pick<Logger, 'info' | 'warn' | 'error' | 'debug'> = {
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
  };
  return log as Logger;
}

const info: AgentProcessInfo = {
  agentId: AGENT, cli: 'codex', task: 'do a thing', workingDirectory: '/ws',
  status: 'completed', startedAt: '2026-11-06T23:00:00.000Z', completedAt: COMPLETED_AT,
  parentSessionId: PARENT,
};

/** Writes the outbox entry exactly like the P1-C checkpoint will. */
function storeCheckpoint(store: ParentEnvelopeStoreService): LaneTerminalCheckpoint {
  return { checkpoint: async (entry) => {
    await store.putCompletionOutbox(entry);
    return 'durable';
  } };
}

interface Host {
  readonly store: ParentEnvelopeStoreService;
  readonly drainer: ParentDeliveryDrainerService;
  readonly notifier: LaneCompletionNotifier;
  readonly send: jest.Mock<Promise<void>, Parameters<IAgentAdapter['sendMessageToSession']>>;
  readonly events: ParentDeliveryEvent[];
  readonly log: Logger;
}

const hosts: Host[] = [];

async function host(
  storage: FakeStateStorage,
  checkpoint: (store: ParentEnvelopeStoreService) => LaneTerminalCheckpoint | null = storeCheckpoint,
): Promise<Host> {
  const log = logger();
  const store = new ParentEnvelopeStoreService(log, storage);
  await store.ready;
  const send = jest.fn<Promise<void>, Parameters<IAgentAdapter['sendMessageToSession']>>(
    async () => undefined);
  const adapter: Pick<IAgentAdapter, 'isSessionActive' | 'sendMessageToSession'> = {
    isSessionActive: () => true, sendMessageToSession: send,
  };
  const events: ParentDeliveryEvent[] = [];
  const drainer = new ParentDeliveryDrainerService(log, store, adapter as IAgentAdapter, null,
    { emit: (event) => events.push(event) });
  const fileSystem: Pick<IFileSystemProvider, 'exists' | 'stat'> = {
    exists: jest.fn(async () => false), stat: jest.fn(async () => { throw new Error('none'); }),
  };
  const checkpointer = checkpoint(store);
  const notifier = new LaneCompletionNotifier(log, fileSystem as IFileSystemProvider,
    adapter as IAgentAdapter, () => null, drainer, () => checkpointer);
  const created = { store, drainer, notifier, send, events, log };
  hosts.push(created);
  return created;
}

function failCompletionBody(storage: FakeStateStorage): void {
  storage.failWrites = (key) => key.startsWith(PARENT_ENVELOPE_BODY_PREFIX);
}

beforeEach(() => {
  now = Date.UTC(2026, 10, 7);
  jest.spyOn(Date, 'now').mockImplementation(() => now);
});
afterEach(() => {
  for (const created of hosts.splice(0)) created.drainer.dispose();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe('LaneCompletionNotifier completion durability', () => {
  it('returns the definite storage-unavailable failure and does not remember the key', async () => {
    const storage = new FakeStateStorage();
    const h = await host(storage);
    failCompletionBody(storage);
    const result = await h.notifier.signal(info);
    expect(result).toMatchObject({ delivered: false, recorded: false, reason: 'storage-unavailable' });
    expect(result.signal).toBeDefined();
    expect(result).not.toHaveProperty('pending');
    storage.failWrites = () => false;
    expect(await h.notifier.signal(info)).toMatchObject({ delivered: true, recorded: true });
    expect(h.send).toHaveBeenCalledTimes(1);
  });

  it('delivers exactly once after a persist failure, a restart and two replays', async () => {
    const storage = new FakeStateStorage();
    const first = await host(storage);
    failCompletionBody(storage);
    await first.notifier.signal(info);
    expect(first.send).not.toHaveBeenCalled();
    storage.failWrites = () => false;
    const restarted = await host(storage);
    await restarted.notifier.replayOutbox();
    await restarted.notifier.replayOutbox();
    expect(restarted.send).toHaveBeenCalledTimes(1);
    expect(restarted.store.list()).toHaveLength(1);
    expect(await restarted.store.listCompletionOutbox()).toEqual([]);
  });

  it('saves on the next drainer tick with healthy storage, and a restart adds nothing', async () => {
    jest.restoreAllMocks();
    jest.useFakeTimers({ now });
    const storage = new FakeStateStorage();
    const h = await host(storage);
    failCompletionBody(storage);
    await h.notifier.signal(info);
    storage.failWrites = () => false;
    await jest.advanceTimersByTimeAsync(5_000);
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(h.store.list()).toHaveLength(1);
    const restarted = await host(storage);
    await restarted.notifier.replayOutbox();
    expect(restarted.send).not.toHaveBeenCalled();
  });

  it('delivers exactly once when the restart comes more than 7 days later', async () => {
    const storage = new FakeStateStorage();
    const first = await host(storage);
    failCompletionBody(storage);
    await first.notifier.signal(info);
    storage.failWrites = () => false;
    now += 8 * DAY;
    const restarted = await host(storage);
    await restarted.notifier.replayOutbox();
    await restarted.notifier.replayOutbox();
    expect(restarted.send).toHaveBeenCalledTimes(1);
  });

  it('never duplicates after a crash between acceptance and outbox removal, 7+ days later', async () => {
    const storage = new FakeStateStorage();
    const first = await host(storage);
    expect(await first.notifier.signal(info)).toMatchObject({ delivered: true });
    const crashed: ParentCompletionOutboxEntry = {
      dedupeKey: KEY, agentId: AGENT, parentSessionId: PARENT, completedAt: COMPLETED_AT,
      body: 'body', verdict: 'delivered', originName: 'codex · lane', createdAt: now,
    };
    storage.values.set(`${PARENT_COMPLETION_OUTBOX_PREFIX}${PARENT}`, {
      version: 1, entries: [crashed],
    });
    now += 8 * DAY;
    const restarted = await host(storage);
    const enqueue = jest.spyOn(restarted.drainer, 'enqueue');
    storage.writes.length = 0;
    await restarted.notifier.replayOutbox(PARENT);
    expect(enqueue).not.toHaveBeenCalled();
    expect(restarted.send).not.toHaveBeenCalled();
    expect(storage.writes.filter((key) => key.startsWith(PARENT_COMPLETION_OUTBOX_PREFIX)))
      .toHaveLength(1);
    expect(await restarted.store.listCompletionOutbox(PARENT)).toEqual([]);
  });

  it('awaits the checkpoint with the exact entry before calling enqueue', async () => {
    const storage = new FakeStateStorage();
    let settle: ((result: LaneCheckpointResult) => void) | undefined;
    const checkpoint = jest.fn((_entry: ParentCompletionOutboxEntry) =>
      new Promise<LaneCheckpointResult>((resolve) => { settle = resolve; }));
    const h = await host(storage, () => ({ checkpoint }));
    const enqueue = jest.spyOn(h.drainer, 'enqueue');
    const pending = h.notifier.signal(info);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(checkpoint).toHaveBeenCalledWith(expect.objectContaining({
      dedupeKey: KEY, agentId: AGENT, parentSessionId: PARENT, completedAt: COMPLETED_AT,
      verdict: expect.any(String), originName: expect.any(String),
    }));
    expect(enqueue).not.toHaveBeenCalled();
    settle?.('failed');
    expect(await pending).toMatchObject({ delivered: true });
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue.mock.calls[0][0]).toMatchObject({
      id: `lane-delivery:${KEY}`, kind: 'completion', body: checkpoint.mock.calls[0][0].body,
    });
  });

  it('publishes one not-saved view on a double failure, then retryUnsaved saves once', async () => {
    const storage = new FakeStateStorage();
    const h = await host(storage, () => ({ checkpoint: async () => 'failed' }));
    failCompletionBody(storage);
    expect(await h.notifier.signal(info)).toMatchObject({ reason: 'storage-unavailable' });
    const unsaved = h.events.filter((event) => event.state === 'not-saved');
    expect(unsaved).toHaveLength(1);
    expect(h.log.error).toHaveBeenCalledWith(
      '[LaneCompletionNotifier] Completion could not be saved', expect.any(Error));
    storage.failWrites = () => false;
    expect(await h.notifier.retryUnsaved(`lane-delivery:${KEY}`))
      .toMatchObject({ deliveryId: `lane-delivery:${KEY}`, state: 'delivered' });
    expect(await h.notifier.retryUnsaved(`lane-delivery:${KEY}`)).toBeUndefined();
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(h.events.some((event) => event.state === 'not-saved' && event.removed)).toBe(true);
  });

  it('does not enqueue or replay a completion for a frozen parent', async () => {
    const storage = new FakeStateStorage();
    const h = await host(storage);
    await h.store.markIntent(PARENT);
    expect(await h.notifier.signal(info)).toMatchObject({
      delivered: false, reason: 'parent-session-not-active',
    });
    await h.notifier.replayOutbox();
    expect(h.send).not.toHaveBeenCalled();
    expect(await h.store.listCompletionOutbox(PARENT)).toHaveLength(1);
  });

  it('blocks a replay on an unreadable key shard and keeps the outbox entry', async () => {
    const storage = new FakeStateStorage();
    const first = await host(storage);
    failCompletionBody(storage);
    await first.notifier.signal(info);
    storage.failWrites = () => false;
    storage.values.set(`ptah:parent-completion-keys:v1:${PARENT}`, { version: 1, keys: [{}] });
    await expect(first.notifier.replayOutbox()).rejects.toThrow('unsaved');
    expect(first.send).not.toHaveBeenCalled();
    expect(await first.store.listCompletionOutbox(PARENT)).toHaveLength(1);
  });
});

describe('PendingCompletionReplays', () => {
  it('drops the oldest entry with an error log past its bound', () => {
    const log = logger();
    const replays = new PendingCompletionReplays(log, 2);
    const entry = (n: number): ParentCompletionOutboxEntry => ({
      dedupeKey: `k${n}`, agentId: AGENT, parentSessionId: PARENT, completedAt: COMPLETED_AT,
      body: 'b', verdict: 'delivered', originName: 'o', createdAt: n,
    });
    replays.set(entry(1));
    replays.set(entry(2));
    replays.set(entry(3));
    expect(replays.values().map((value) => value.dedupeKey)).toEqual(['k2', 'k3']);
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(MAX_PENDING_COMPLETION_REPLAYS).toBe(256);
  });
});
