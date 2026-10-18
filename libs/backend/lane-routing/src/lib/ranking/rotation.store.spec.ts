import type { IStateStorage } from '@ptah-extension/platform-core';
import {
  OUTCOME_TASK_KINDS,
  type LaneLimitState,
} from '@ptah-extension/shared';
import type { LaneRoutingLogger } from '../lane-routing-logger';
import { MISSING_INPUT_REASON } from '../reasons/compile-reasons';
import { ROTATION_MAX_KEYS, ROTATION_STORAGE_KEY } from '../routing-constants';
import type { LaneCandidate } from './candidate.types';
import { spread, type RankedCandidate } from './spread';
import {
  ROTATION_DOCUMENT_VERSION,
  ROTATION_UNAVAILABLE_REASON,
  RotationStore,
  emptyRotationState,
  lastCandidateId,
  rotationKey,
  withPick,
  type RotationState,
} from './rotation.store';

class MemoryStorage implements IStateStorage {
  readonly values = new Map<string, unknown>();
  failRead = false;
  failWrite = false;
  writes = 0;

  get<T>(key: string, defaultValue?: T): T | undefined {
    if (this.failRead) throw new Error('read failed');
    if (!this.values.has(key)) return defaultValue;
    return this.values.get(key) as T;
  }

  async update(key: string, value: unknown): Promise<void> {
    this.writes += 1;
    if (this.failWrite) throw new Error('write failed');
    if (value === undefined) {
      this.values.delete(key);
      return;
    }
    this.values.set(key, value);
  }

  keys(): readonly string[] {
    return [...this.values.keys()];
  }
}

function recordingLogger(): LaneRoutingLogger & { readonly warns: string[] } {
  const warns: string[] = [];
  return {
    warns,
    debug() {
      return undefined;
    },
    info() {
      return undefined;
    },
    warn(message: string) {
      warns.push(message);
    },
    error() {
      return undefined;
    },
  };
}

function lane(
  id: string,
  limitState: LaneLimitState = 'confirmed-room',
): LaneCandidate {
  return {
    kind: 'lane',
    id,
    cli: 'codex',
    family: 'codex',
    installed: true,
    disabled: false,
    limitState,
  };
}

function ranked(id: string, score = 50): RankedCandidate {
  return { candidate: lane(id), score };
}

describe('rotation store', () => {
  it('uses the compiler phrase for an unavailable rotation store', () => {
    expect(ROTATION_UNAVAILABLE_REASON).toBe(
      MISSING_INPUT_REASON['rotation-store'],
    );
    expect(ROTATION_UNAVAILABLE_REASON).toBe('rotation store unavailable');
  });

  it('builds an opaque key from the phase id and an OutcomeTaskKind', () => {
    expect(rotationKey('build', 'implement')).toBe('build|implement');
    expect(rotationKey('a|b', 'plan')).toBe('a|b|plan');
    for (const taskKind of OUTCOME_TASK_KINDS) {
      expect(rotationKey('phase', taskKind)).toBe(`phase|${taskKind}`);
    }
    expect(() => rotationKey('', 'implement')).toThrow(/phase id/);
  });

  it('persists one global document under laneRouting.rotation.v1', async () => {
    const storage = new MemoryStorage();
    const store = new RotationStore(storage, recordingLogger());
    const key = rotationKey('build', 'implement');

    expect(store.load()).toEqual({
      state: emptyRotationState(),
      reason: null,
    });
    expect(await store.record(key, 'codex')).toEqual({ persisted: true });

    expect(storage.keys()).toEqual([ROTATION_STORAGE_KEY]);
    expect(storage.values.get(ROTATION_STORAGE_KEY)).toEqual({
      version: ROTATION_DOCUMENT_VERSION,
      entries: [{ key: 'build|implement', candidateId: 'codex' }],
    });
    expect(lastCandidateId(store.load().state, key)).toBe('codex');
  });

  it('continues the rotation after a restart (Req 7.5)', async () => {
    const storage = new MemoryStorage();
    const logger = recordingLogger();
    const first = new RotationStore(storage, logger);
    const candidates = [ranked('a'), ranked('b'), ranked('c')];
    const opened = first.load();
    const step1 = spread({
      phaseId: 'build',
      taskKind: 'implement',
      candidates,
      rotation: opened.state,
    });

    expect(opened.reason).toBeNull();
    expect(step1.pick?.candidate.id).toBe('a');
    expect(await first.save(step1.rotation)).toEqual({ persisted: true });

    const restarted = new RotationStore(storage, logger);
    const loaded = restarted.load();
    const step2 = spread({
      phaseId: 'build',
      taskKind: 'implement',
      candidates,
      rotation: loaded.state,
    });

    expect(loaded.reason).toBeNull();
    expect(logger.warns).toEqual([]);
    expect(step2.pick?.candidate.id).toBe('b');
    expect(lastCandidateId(loaded.state, 'build|implement')).toBe('a');
  });

  it('returns an empty state and the unavailable reason when the read throws', async () => {
    const storage = new MemoryStorage();
    storage.values.set(ROTATION_STORAGE_KEY, {
      version: ROTATION_DOCUMENT_VERSION,
      entries: [{ key: 'build|implement', candidateId: 'codex' }],
    });
    storage.failRead = true;
    const logger = recordingLogger();
    const store = new RotationStore(storage, logger);

    expect(store.load()).toEqual({
      state: emptyRotationState(),
      reason: ROTATION_UNAVAILABLE_REASON,
    });
    expect(await store.record('build|implement', 'grok')).toEqual({
      persisted: false,
    });
    expect(logger.warns).toEqual([
      '[lane-routing] rotation state could not be read',
      '[lane-routing] rotation state could not be read',
    ]);
    expect(storage.writes).toBe(0);
    expect(storage.values.get(ROTATION_STORAGE_KEY)).toEqual({
      version: ROTATION_DOCUMENT_VERSION,
      entries: [{ key: 'build|implement', candidateId: 'codex' }],
    });
  });

  it('logs a failed write and still resolves', async () => {
    const storage = new MemoryStorage();
    storage.failWrite = true;
    const logger = recordingLogger();
    const store = new RotationStore(storage, logger);

    await expect(store.record('build|implement', 'codex')).resolves.toEqual({
      persisted: false,
    });
    expect(logger.warns).toEqual([
      '[lane-routing] rotation state could not be written',
    ]);
    expect(storage.values.has(ROTATION_STORAGE_KEY)).toBe(false);
  });

  it('replaces an invalid document on the next record', async () => {
    const storage = new MemoryStorage();
    storage.values.set(ROTATION_STORAGE_KEY, {
      version: 1,
      entries: [{ key: '', candidateId: 'codex' }],
    });
    const logger = recordingLogger();
    const store = new RotationStore(storage, logger);

    expect(store.load().state).toEqual(emptyRotationState());
    expect(store.load().reason).toBeNull();
    expect(logger.warns).toEqual([
      '[lane-routing] rotation state is invalid; starting from an empty rotation',
      '[lane-routing] rotation state is invalid; starting from an empty rotation',
    ]);
    expect(await store.record('build|docs', 'codex')).toEqual({
      persisted: true,
    });
    expect(storage.values.get(ROTATION_STORAGE_KEY)).toEqual({
      version: ROTATION_DOCUMENT_VERSION,
      entries: [{ key: 'build|docs', candidateId: 'codex' }],
    });
  });

  it('drops the oldest key past the cap and keeps a key that was written again', () => {
    let state: RotationState = emptyRotationState();
    const keys: string[] = [];
    for (let index = 0; index < ROTATION_MAX_KEYS; index += 1) {
      const key = rotationKey(`p${index}`, 'plan');
      keys.push(key);
      state = withPick(state, key, 'a');
    }
    expect(state.entries).toHaveLength(ROTATION_MAX_KEYS);
    expect(lastCandidateId(state, keys[0] ?? '')).toBe('a');

    const refreshed = withPick(state, keys[0] ?? '', 'b');
    const overflow = withPick(
      refreshed,
      rotationKey('overflow', 'research'),
      'c',
    );

    expect(overflow.entries).toHaveLength(ROTATION_MAX_KEYS);
    expect(lastCandidateId(overflow, keys[0] ?? '')).toBe('b');
    expect(lastCandidateId(overflow, keys[1] ?? '')).toBeNull();
    expect(lastCandidateId(overflow, rotationKey('overflow', 'research'))).toBe(
      'c',
    );
    expect(overflow.entries[overflow.entries.length - 1]).toEqual({
      key: rotationKey('overflow', 'research'),
      candidateId: 'c',
    });
  });

  it('does not mutate the document passed to withPick', () => {
    const state = emptyRotationState();
    const next = withPick(state, 'build|tests', 'codex');

    expect(state.entries).toEqual([]);
    expect(next.entries).toEqual([
      { key: 'build|tests', candidateId: 'codex' },
    ]);
  });

  it('rejects a document over the cap', async () => {
    const entries = Array.from(
      { length: ROTATION_MAX_KEYS + 1 },
      (_, index) => ({
        key: `k${index}|plan`,
        candidateId: 'a',
      }),
    );
    const store = new RotationStore(new MemoryStorage(), recordingLogger());

    await expect(
      store.save({ version: ROTATION_DOCUMENT_VERSION, entries }),
    ).rejects.toThrow(/invalid/);
  });

  it('stores every OutcomeTaskKind the same way', async () => {
    const storage = new MemoryStorage();
    const store = new RotationStore(storage, recordingLogger());
    let state = emptyRotationState();
    for (const taskKind of OUTCOME_TASK_KINDS) {
      state = withPick(state, rotationKey('phase', taskKind), taskKind);
    }
    expect(await store.save(state)).toEqual({ persisted: true });

    const loaded = store.load().state;
    expect(loaded.entries.map((entry) => entry.candidateId)).toEqual([
      ...OUTCOME_TASK_KINDS,
    ]);
  });

  it('persists both keys when two saves run at the same time', async () => {
    const storage = new MemoryStorage();
    const store = new RotationStore(storage, recordingLogger());
    const keyA = rotationKey('build', 'implement');
    const keyB = rotationKey('review', 'review');

    const [first, second] = await Promise.all([
      store.save({
        version: ROTATION_DOCUMENT_VERSION,
        entries: [{ key: keyA, candidateId: 'codex' }],
      }),
      store.save({
        version: ROTATION_DOCUMENT_VERSION,
        entries: [{ key: keyB, candidateId: 'grok' }],
      }),
    ]);

    expect(first).toEqual({ persisted: true });
    expect(second).toEqual({ persisted: true });
    expect(lastCandidateId(store.load().state, keyA)).toBe('codex');
    expect(lastCandidateId(store.load().state, keyB)).toBe('grok');
  });

  it('keeps the other key when two saves touch the same key', async () => {
    const storage = new MemoryStorage();
    const store = new RotationStore(storage, recordingLogger());
    const other = rotationKey('docs', 'docs');
    const key = rotationKey('build', 'implement');
    await store.record(other, 'kept');

    await Promise.all([
      store.save({
        version: ROTATION_DOCUMENT_VERSION,
        entries: [{ key, candidateId: 'first' }],
      }),
      store.save({
        version: ROTATION_DOCUMENT_VERSION,
        entries: [{ key, candidateId: 'second' }],
      }),
    ]);

    const loaded = store.load().state;
    expect(lastCandidateId(loaded, other)).toBe('kept');
    expect(lastCandidateId(loaded, key)).toBe('second');
  });
});
