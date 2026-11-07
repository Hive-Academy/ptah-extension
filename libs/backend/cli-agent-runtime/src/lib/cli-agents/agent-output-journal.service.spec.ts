import type { IStateStorage } from '@ptah-extension/platform-core';
import type { Logger } from '@ptah-extension/vscode-core';
import type { CliOutputSegment } from '@ptah-extension/shared';
import {
  AGENT_OUTPUT_CHECKPOINT_INTERVAL_MS,
  AGENT_OUTPUT_CHECKPOINT_KEY_PREFIX,
  AGENT_OUTPUT_CHECKPOINT_MAX_CHANGED_FILES,
  AGENT_OUTPUT_CHECKPOINT_MAX_SEGMENTS,
  AGENT_OUTPUT_CHECKPOINT_MAX_SEGMENT_BYTES,
  AGENT_OUTPUT_CHECKPOINT_MAX_STDOUT_CHARS,
  AGENT_OUTPUT_CHECKPOINT_RETENTION_MS,
  AgentOutputJournal,
  type AgentOutputSource,
} from './agent-output-journal.service';

const NOW = Date.parse('2026-11-07T10:00:00.000Z');

class MemoryStorage implements IStateStorage {
  readonly data = new Map<string, unknown>();
  failNext = 0;
  updates = 0;
  get<T>(key: string, defaultValue?: T): T | undefined {
    return (this.data.has(key) ? this.data.get(key) : defaultValue) as T | undefined;
  }
  async update(key: string, value: unknown): Promise<void> {
    this.updates++;
    if (this.failNext > 0) {
      this.failNext--;
      throw new Error('disk full');
    }
    if (value === undefined) this.data.delete(key);
    else this.data.set(key, structuredClone(value));
  }
  keys(): readonly string[] {
    return [...this.data.keys()];
  }
}

function logger() {
  return Object.assign(Object.create(null) as Logger, {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  });
}

function setup(output: { stdout: string; segments: CliOutputSegment[] }) {
  const storage = new MemoryStorage();
  const log = logger();
  let running = true;
  const source: AgentOutputSource = {
    readOutput: jest.fn(() => ({ stdout: output.stdout, segments: output.segments })),
    hasRunningLanes: () => running,
  };
  const journal = new AgentOutputJournal(storage, log, () => source, {
    now: () => NOW,
  });
  return {
    storage,
    log,
    source,
    journal,
    output,
    stopLanes: () => {
      running = false;
    },
  };
}

const text = (content: string): CliOutputSegment => ({ type: 'text', content });
const fileChange = (path: string): CliOutputSegment => ({ type: 'file-change', content: path });

afterEach(() => jest.useRealTimers());

describe('AgentOutputJournal', () => {
  it('marks without writing and writes once per tick (no per-delta writes)', async () => {
    const h = setup({ stdout: 'hello', segments: [text('hello')] });
    for (let i = 0; i < 50; i++) h.journal.markDirty('a1');
    expect(h.storage.updates).toBe(0);
    await h.journal.tick();
    expect(h.storage.updates).toBe(1);
    expect(h.journal.read('a1')).toMatchObject({ agentId: 'a1', seq: 1, stdoutTail: 'hello' });
    // Nothing changed since the checkpoint: the next tick writes nothing.
    await h.journal.tick();
    expect(h.storage.updates).toBe(1);
    h.journal.dispose();
  });

  it('runs one shared interval and stops it when no lane runs', async () => {
    jest.useFakeTimers();
    const h = setup({ stdout: 'x', segments: [] });
    h.journal.markDirty('a1');
    h.journal.markDirty('a2');
    expect(jest.getTimerCount()).toBe(1);
    h.stopLanes();
    await jest.advanceTimersByTimeAsync(AGENT_OUTPUT_CHECKPOINT_INTERVAL_MS);
    expect(h.storage.updates).toBe(2);
    expect(h.journal.isRunning()).toBe(false);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('a crash between checkpoints leaves the latest complete one', async () => {
    const h = setup({ stdout: 'first', segments: [text('first')] });
    h.journal.markDirty('a1');
    await h.journal.tick();
    h.output.stdout = 'first second';
    h.storage.failNext = 1;
    h.journal.markDirty('a1');
    await h.journal.tick();
    expect(h.journal.read('a1')).toMatchObject({ seq: 1, stdoutTail: 'first' });
    expect(h.log.error).toHaveBeenCalled();
    // The failed lane is retried on the next tick.
    await h.journal.tick();
    expect(h.journal.read('a1')).toMatchObject({ seq: 2, stdoutTail: 'first second' });
    h.journal.dispose();
  });

  it('ignores a malformed (partially written) checkpoint', () => {
    const h = setup({ stdout: '', segments: [] });
    h.storage.data.set(`${AGENT_OUTPUT_CHECKPOINT_KEY_PREFIX}a1`, { agentId: 'a1', seq: 3 });
    expect(h.journal.read('a1')).toBeUndefined();
    expect(h.log.warn).toHaveBeenCalled();
  });

  it('keeps a truncated stdout tail', async () => {
    const big = 'a'.repeat(AGENT_OUTPUT_CHECKPOINT_MAX_STDOUT_CHARS) + 'TAIL';
    const h = setup({ stdout: big, segments: [] });
    await h.journal.checkpointNow('a1');
    const checkpoint = h.journal.read('a1');
    expect(checkpoint?.stdoutTail).toHaveLength(AGENT_OUTPUT_CHECKPOINT_MAX_STDOUT_CHARS);
    expect(checkpoint?.stdoutTail.endsWith('TAIL')).toBe(true);
  });

  it('bounds segments, their bytes and the changed files', async () => {
    const segments: CliOutputSegment[] = [];
    for (let i = 0; i < AGENT_OUTPUT_CHECKPOINT_MAX_CHANGED_FILES + 50; i++) {
      segments.push(fileChange(`src/file-${i}.ts`));
    }
    for (let i = 0; i < AGENT_OUTPUT_CHECKPOINT_MAX_SEGMENTS + 50; i++) {
      segments.push(text(`line ${i}`));
    }
    const h = setup({ stdout: '', segments });
    await h.journal.checkpointNow('a1');
    const checkpoint = h.journal.read('a1');
    expect(checkpoint?.segmentsTail).toHaveLength(AGENT_OUTPUT_CHECKPOINT_MAX_SEGMENTS);
    expect(checkpoint?.segmentsTail.at(-1)?.content).toBe(
      `line ${AGENT_OUTPUT_CHECKPOINT_MAX_SEGMENTS + 49}`,
    );
    expect(checkpoint?.changedFiles).toHaveLength(AGENT_OUTPUT_CHECKPOINT_MAX_CHANGED_FILES);
    expect(checkpoint?.changedFiles.at(-1)).toBe(
      `src/file-${AGENT_OUTPUT_CHECKPOINT_MAX_CHANGED_FILES + 49}.ts`,
    );

    const huge = Array.from({ length: 100 }, () => text('z'.repeat(20_000)));
    const big = setup({ stdout: '', segments: huge });
    await big.journal.checkpointNow('a2');
    const bounded = big.journal.read('a2');
    expect(JSON.stringify(bounded?.segmentsTail).length).toBeLessThanOrEqual(
      AGENT_OUTPUT_CHECKPOINT_MAX_SEGMENT_BYTES,
    );
    expect(bounded?.segmentsTail.every((segment) => segment.content.length <= 8 * 1024)).toBe(true);
  });

  it('removes a checkpoint only up to the exit sequence', async () => {
    const h = setup({ stdout: 'out', segments: [] });
    const seq = await h.journal.checkpointNow('a1');
    expect(seq).toBe(1);
    // A newer turn checkpointed before the exit reference became durable.
    await h.journal.checkpointNow('a1');
    await h.journal.remove('a1', 1);
    expect(h.journal.read('a1')?.seq).toBe(2);
    await h.journal.remove('a1', 2);
    expect(h.journal.read('a1')).toBeUndefined();
  });

  it('expires old and malformed checkpoints', async () => {
    const h = setup({ stdout: 'out', segments: [] });
    await h.journal.checkpointNow('fresh');
    h.storage.data.set(`${AGENT_OUTPUT_CHECKPOINT_KEY_PREFIX}old`, {
      agentId: 'old',
      seq: 1,
      at: new Date(NOW - AGENT_OUTPUT_CHECKPOINT_RETENTION_MS - 1).toISOString(),
      stdoutTail: '',
      segmentsTail: [],
      changedFiles: [],
    });
    h.storage.data.set(`${AGENT_OUTPUT_CHECKPOINT_KEY_PREFIX}bad`, 'garbage');
    h.storage.data.set('unrelated', 1);
    await expect(h.journal.pruneExpired()).resolves.toBe(2);
    expect([...h.storage.keys()].sort()).toEqual([`${AGENT_OUTPUT_CHECKPOINT_KEY_PREFIX}fresh`, 'unrelated']);
  });
});
