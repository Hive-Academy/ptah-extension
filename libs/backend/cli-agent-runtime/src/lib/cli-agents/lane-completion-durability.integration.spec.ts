/**
 * Lane completion durability, end to end over one fake state storage:
 * the real `LaneCompletionNotifier`, `ParentEnvelopeStoreService`,
 * `ParentDeliveryDrainerService` and the `agent-events` terminal checkpoint.
 * A "restart" is a new store, drainer and notifier over the same storage; a
 * "crash" disposes the old drainer and abandons its in-flight work.
 *
 * The re-association case uses the real agent-sdk `SessionMetadataStore`
 * (`addCliSession` replaces the original agent's ref) to prove replay never
 * depends on refs. The clock is a `Date.now` mock; nothing waits in real time.
 */
import 'reflect-metadata';
import { container as rootContainer } from 'tsyringe';
import {
  AgentId,
  type AgentProcessInfo,
  type CliSessionReference,
  type IAgentAdapter,
} from '@ptah-extension/shared';
import type { IFileSystemProvider } from '@ptah-extension/platform-core';
import type { Logger } from '@ptah-extension/vscode-core';
import { SessionMetadataStore } from '@ptah-extension/agent-sdk';
import { createLaneTerminalCheckpoint } from '../wiring/agent-events';
import { LaneCompletionNotifier } from './lane-completion-notifier.service';
import { FakeStateStorage } from './parent-delivery/__fixtures__/fake-state-storage';
import {
  ParentEnvelopeStoreService,
  type ParentEnqueueResult,
} from './parent-delivery/parent-envelope-store.service';
import { ParentDeliveryDrainerService } from './parent-delivery/parent-delivery-drainer.service';
import {
  PARENT_COMPLETION_KEYS_PREFIX,
  PARENT_COMPLETION_OUTBOX_PREFIX,
  PARENT_ENVELOPE_BODY_PREFIX,
  PARENT_ENVELOPE_INDEX_KEY,
} from './parent-delivery/parent-envelope.schema';

const PARENT = '11111111-2222-4333-8444-555555555555';
const AGENT = AgentId.from('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
const RESUMED_AGENT = AgentId.from('aaaaaaaa-bbbb-4ccc-8ddd-ffffffffffff');
const COMPLETED_AT = '2026-11-07T00:00:00.000Z';
const KEY = `${AGENT}:${COMPLETED_AT}`;
const DELIVERY_ID = `lane-delivery:${KEY}`;
const OUTBOX_KEY = `${PARENT_COMPLETION_OUTBOX_PREFIX}${PARENT}`;
const SHARD_KEY = `${PARENT_COMPLETION_KEYS_PREFIX}${PARENT}`;
const BODY_KEY = `${PARENT_ENVELOPE_BODY_PREFIX}${DELIVERY_ID}`;
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

interface Host {
  readonly store: ParentEnvelopeStoreService;
  readonly drainer: ParentDeliveryDrainerService;
  readonly notifier: LaneCompletionNotifier;
  readonly send: jest.Mock<Promise<void>, Parameters<IAgentAdapter['sendMessageToSession']>>;
}

const hosts: Host[] = [];

/** One host run: real store, drainer, notifier and agent-events checkpoint. */
async function host(storage: FakeStateStorage): Promise<Host> {
  const log = logger();
  const store = new ParentEnvelopeStoreService(log, storage);
  await store.ready;
  const send = jest.fn<Promise<void>, Parameters<IAgentAdapter['sendMessageToSession']>>(
    async () => undefined);
  const adapter: Pick<IAgentAdapter, 'isSessionActive' | 'sendMessageToSession'> = {
    isSessionActive: () => true, sendMessageToSession: send,
  };
  const drainer = new ParentDeliveryDrainerService(log, store, adapter as IAgentAdapter, null, null);
  const scope = rootContainer.createChildContainer();
  scope.registerInstance(ParentEnvelopeStoreService, store);
  const checkpoint = createLaneTerminalCheckpoint(scope, log);
  const fileSystem: Pick<IFileSystemProvider, 'exists' | 'stat'> = {
    exists: jest.fn(async () => false), stat: jest.fn(async () => { throw new Error('none'); }),
  };
  const notifier = new LaneCompletionNotifier(log, fileSystem as IFileSystemProvider,
    adapter as IAgentAdapter, () => null, drainer, () => checkpoint);
  const created = { store, drainer, notifier, send };
  hosts.push(created);
  return created;
}

/** The process dies: its timer and listeners stop, in-flight promises are abandoned. */
function crash(h: Host): void {
  h.drainer.dispose();
}

/** Every envelope body write fails: the completion is refused after a durable checkpoint. */
function failCompletionBody(storage: FakeStateStorage): void {
  storage.failWrites = (key) => key.startsWith(PARENT_ENVELOPE_BODY_PREFIX);
}

/** An outbox write that no longer holds the completion key is a removal. */
function isOutboxRemoval(key: string, value: unknown): boolean {
  return key.startsWith(PARENT_COMPLETION_OUTBOX_PREFIX) && !JSON.stringify(value ?? null).includes(KEY);
}

function outboxEntries(storage: FakeStateStorage): readonly unknown[] {
  const value = storage.values.get(OUTBOX_KEY);
  if (!value || typeof value !== 'object' || !('entries' in value)) return [];
  return Array.isArray(value.entries) ? value.entries : [];
}

function shardHasKey(storage: FakeStateStorage): boolean {
  return JSON.stringify(storage.values.get(SHARD_KEY) ?? null).includes(KEY);
}

function indexHasKey(storage: FakeStateStorage): boolean {
  return JSON.stringify(storage.values.get(PARENT_ENVELOPE_INDEX_KEY) ?? null).includes(KEY);
}

async function flushUntil(condition: () => boolean): Promise<void> {
  for (let turn = 0; turn < 50 && !condition(); turn++)
    await new Promise<void>((resolve) => setImmediate(resolve));
  if (!condition()) throw new Error('condition not reached');
}

beforeEach(() => {
  now = Date.UTC(2026, 10, 7);
  jest.spyOn(Date, 'now').mockImplementation(() => now);
});
afterEach(() => {
  for (const created of hosts.splice(0)) created.drainer.dispose();
  jest.restoreAllMocks();
});

describe('lane completion durability (integration)', () => {
  it('crash between the outbox write and the enqueue: a new container delivers exactly once', async () => {
    const storage = new FakeStateStorage();
    const first = await host(storage);
    const enqueue = jest.spyOn(first.drainer, 'enqueue')
      .mockReturnValue(new Promise<ParentEnqueueResult>(() => undefined));
    void first.notifier.signal(info);
    await flushUntil(() => enqueue.mock.calls.length > 0);
    expect(outboxEntries(storage)).toHaveLength(1);
    crash(first);

    const restarted = await host(storage);
    await restarted.notifier.replayOutbox(PARENT);
    await restarted.notifier.replayOutbox(PARENT);
    expect(restarted.send).toHaveBeenCalledTimes(1);
    expect(restarted.send.mock.calls[0][2]).toMatchObject({ clientMessageId: DELIVERY_ID });
    expect(restarted.store.list(PARENT)).toHaveLength(1);
    expect(outboxEntries(storage)).toHaveLength(0);
  });

  it('crash between the body and the index write: the orphan is re-indexed and replay adds none', async () => {
    const storage = new FakeStateStorage();
    const first = await host(storage);
    storage.failWrites = (key) => key === PARENT_ENVELOPE_INDEX_KEY;
    expect(await first.notifier.signal(info)).toMatchObject({ reason: 'storage-unavailable' });
    expect(storage.values.has(BODY_KEY)).toBe(true);
    crash(first);
    storage.failWrites = () => false;

    const restarted = await host(storage);
    const enqueue = jest.spyOn(restarted.drainer, 'enqueue');
    await restarted.notifier.replayOutbox(PARENT);
    await restarted.drainer.drain(PARENT);
    expect(enqueue).not.toHaveBeenCalled();
    expect(restarted.store.list(PARENT)).toHaveLength(1);
    expect(restarted.send).toHaveBeenCalledTimes(1);
    expect(outboxEntries(storage)).toHaveLength(0);
  });

  it('failed enqueue, re-association under a new agent id, restart: exactly one completion', async () => {
    const storage = new FakeStateStorage();
    const metadata = new SessionMetadataStore(storage, logger());
    await metadata.create(PARENT, '/ws', 'parent');
    const ref = (agentId: AgentId): CliSessionReference => ({
      cliSessionId: 'cli-1', cli: 'codex', agentId, task: 'do a thing',
      startedAt: info.startedAt, status: 'completed',
    });
    await metadata.addCliSession(PARENT, ref(AGENT));

    const first = await host(storage);
    failCompletionBody(storage);
    expect(await first.notifier.signal(info)).toMatchObject({
      delivered: false, recorded: false, reason: 'storage-unavailable',
    });
    expect(outboxEntries(storage)).toHaveLength(1);
    await metadata.addCliSession(PARENT, ref(RESUMED_AGENT));
    expect((await metadata.get(PARENT))?.cliSessions?.map((item) => item.agentId))
      .toEqual([RESUMED_AGENT]);
    crash(first);
    storage.failWrites = () => false;

    const restarted = await host(storage);
    await restarted.notifier.replayOutbox(PARENT);
    expect(restarted.send).toHaveBeenCalledTimes(1);
    expect(restarted.store.list(PARENT)).toEqual([
      expect.objectContaining({ id: DELIVERY_ID, agentId: AGENT, state: 'delivered' }),
    ]);
    await restarted.notifier.replayOutbox(PARENT);
    expect(restarted.send).toHaveBeenCalledTimes(1);
    expect(restarted.store.list(PARENT)).toHaveLength(1);
    expect(outboxEntries(storage)).toHaveLength(0);
  });

  it('crash between acceptance and outbox removal, restart after 7+ days: no second envelope', async () => {
    const storage = new FakeStateStorage();
    const first = await host(storage);
    storage.failWrites = isOutboxRemoval;
    expect(await first.notifier.signal(info)).toMatchObject({ delivered: true });
    expect(shardHasKey(storage)).toBe(true);
    expect(outboxEntries(storage)).toHaveLength(1);
    crash(first);
    storage.failWrites = () => false;
    now += 8 * DAY;

    const restarted = await host(storage);
    const enqueue = jest.spyOn(restarted.drainer, 'enqueue');
    await restarted.notifier.replayOutbox(PARENT);
    expect(enqueue).not.toHaveBeenCalled();
    expect(restarted.send).not.toHaveBeenCalled();
    expect(shardHasKey(storage)).toBe(true);
    expect(outboxEntries(storage)).toHaveLength(0);
    expect(restarted.store.list(PARENT).filter((entry) => entry.state !== 'delivered')).toEqual([]);
  });

  it('shard outage beyond 7 days then removal failure and restart: pinned index, ordered recovery', async () => {
    const storage = new FakeStateStorage();
    const first = await host(storage);
    storage.failWrites = (key, value) => key === SHARD_KEY || isOutboxRemoval(key, value);
    expect(await first.notifier.signal(info)).toMatchObject({ delivered: true });
    expect(first.send).toHaveBeenCalledTimes(1);
    crash(first);
    now += 8 * DAY;

    const restarted = await host(storage);
    const enqueue = jest.spyOn(restarted.drainer, 'enqueue');
    await restarted.notifier.replayOutbox(PARENT);
    expect(enqueue).not.toHaveBeenCalled();
    expect(restarted.send).not.toHaveBeenCalled();
    expect(storage.values.has(BODY_KEY)).toBe(false);
    expect(indexHasKey(storage)).toBe(true);
    expect(shardHasKey(storage)).toBe(false);
    expect(outboxEntries(storage)).toHaveLength(1);

    storage.failWrites = () => false;
    storage.writes.length = 0;
    await restarted.notifier.replayOutbox(PARENT);
    const shardWrite = storage.writes.indexOf(SHARD_KEY);
    const outboxWrite = storage.writes.indexOf(OUTBOX_KEY);
    const indexWrite = storage.writes.lastIndexOf(PARENT_ENVELOPE_INDEX_KEY);
    expect(shardWrite).toBeGreaterThanOrEqual(0);
    expect(outboxWrite).toBeGreaterThan(shardWrite);
    expect(indexWrite).toBeGreaterThan(outboxWrite);
    expect(shardHasKey(storage)).toBe(true);
    expect(outboxEntries(storage)).toHaveLength(0);
    expect(indexHasKey(storage)).toBe(false);
    expect(enqueue).not.toHaveBeenCalled();
    crash(restarted);

    const later = await host(storage);
    const laterEnqueue = jest.spyOn(later.drainer, 'enqueue');
    await later.notifier.replayOutbox();
    expect(laterEnqueue).not.toHaveBeenCalled();
    expect(later.send).not.toHaveBeenCalled();
  });

  it('persist failure after a durable checkpoint, restart 8 days later: exactly one delivery', async () => {
    const storage = new FakeStateStorage();
    const first = await host(storage);
    failCompletionBody(storage);
    expect(await first.notifier.signal(info)).toMatchObject({ reason: 'storage-unavailable' });
    expect(outboxEntries(storage)).toHaveLength(1);
    crash(first);
    storage.failWrites = () => false;
    now += 8 * DAY;

    const restarted = await host(storage);
    await restarted.notifier.replayOutbox();
    await restarted.notifier.replayOutbox();
    expect(restarted.send).toHaveBeenCalledTimes(1);
    expect(restarted.store.list(PARENT)).toHaveLength(1);
    expect(outboxEntries(storage)).toHaveLength(0);
  });

  it('exit ordering: the checkpoint outbox write completes before enqueue is called', async () => {
    const storage = new FakeStateStorage();
    const h = await host(storage);
    const order: string[] = [];
    const update = storage.update.bind(storage);
    let releaseOutbox: (() => void) | undefined;
    jest.spyOn(storage, 'update').mockImplementation(async (key, value) => {
      if (key === OUTBOX_KEY && JSON.stringify(value ?? null).includes(KEY) && !releaseOutbox) {
        await new Promise<void>((resolve) => { releaseOutbox = resolve; });
        await update(key, value);
        order.push('outbox-durable');
        return;
      }
      await update(key, value);
    });
    const enqueue = h.drainer.enqueue.bind(h.drainer);
    jest.spyOn(h.drainer, 'enqueue').mockImplementation(async (envelope, onAccepted) => {
      order.push(outboxEntries(storage).length === 1 ? 'enqueue-after-outbox' : 'enqueue-early');
      return enqueue(envelope, onAccepted);
    });

    const pending = h.notifier.signal(info);
    await flushUntil(() => releaseOutbox !== undefined);
    expect(order).toEqual([]);
    releaseOutbox?.();
    expect(await pending).toMatchObject({ delivered: true });
    expect(order).toEqual(['outbox-durable', 'enqueue-after-outbox']);
    expect(h.send).toHaveBeenCalledTimes(1);
  });
});
