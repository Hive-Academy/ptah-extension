import { join } from 'node:path';
import {
  LANE_DEFAULT_MODEL,
  SUBAGENT_LANE_ID,
  type LaneOutcomeReader,
  type LaneOutcomeSummary,
  type OutcomeTaskKind,
} from '@ptah-extension/shared';
import type { IFileSystemProvider } from '@ptah-extension/platform-core';
import {
  NEUTRAL_SCORE,
  OUTCOME_WINDOW_MS,
  SEED_LABEL_SCORE,
  STALENESS_AGE_MS,
} from '../routing-constants';
import type { LaneRoutingLogger } from '../lane-routing-logger';
import { SEED_NOTE, SEED_SOURCE_REF, isStale } from './seed-matrix';
import {
  FAMILY_PROFILE_MODEL,
  type MatrixCell,
  type MatrixProfile,
  type ValueMatrixCell,
} from './matrix.types';
import { AUTOMATIC_MATRIX_MODEL } from './local-derivation';
import {
  CapabilityMatrixStore,
  EMPTY_CAPABILITY_MATRIX_TEXT,
  MATRIX_INVALID_PREFIX,
  NO_OUTCOME_HISTORY_REASON,
  OUTCOMES_UNAVAILABLE_REASON,
  capabilityMatrixUserPath,
  capabilityMatrixViewPath,
  type CapabilityMatrixSnapshot,
  type MatrixOutcomeQuery,
} from './capability-matrix.store';

const HOME = join('C:', 'ptah-home');
const USER_PATH = capabilityMatrixUserPath(HOME);
const VIEW_PATH = capabilityMatrixViewPath(HOME);
const NOW = Date.parse('2026-10-15T00:00:00.000Z');

function coded(message: string, code: string): Error {
  const error = new Error(message);
  Object.assign(error, { code });
  return error;
}

function unsupported(method: string): never {
  throw new Error(`${method} is not used by CapabilityMatrixStore`);
}

class MemoryFiles implements IFileSystemProvider {
  readonly files = new Map<string, string>();
  readonly writes: string[] = [];
  readonly reads: string[] = [];
  readonly failReads = new Map<string, Error>();

  async readFile(path: string): Promise<string> {
    this.reads.push(path);
    const failure = this.failReads.get(path);
    if (failure !== undefined) throw failure;
    const text = this.files.get(path);
    if (text === undefined) throw coded(`ENOENT: ${path}`, 'ENOENT');
    return text;
  }

  async writeFile(path: string, content: string): Promise<void> {
    this.writes.push(path);
    this.files.set(path, content);
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }

  readFileBytes(_path: string): Promise<Uint8Array> {
    return unsupported('readFileBytes');
  }

  writeFileBytes(_path: string, _content: Uint8Array): Promise<void> {
    return unsupported('writeFileBytes');
  }

  readDirectory(_path: string): Promise<never> {
    return unsupported('readDirectory');
  }

  stat(_path: string): Promise<never> {
    return unsupported('stat');
  }

  delete(_path: string, _options?: { recursive?: boolean }): Promise<void> {
    return unsupported('delete');
  }

  createDirectory(_path: string): Promise<void> {
    return unsupported('createDirectory');
  }

  createDirectoryExclusive(_path: string): Promise<void> {
    return unsupported('createDirectoryExclusive');
  }

  copy(
    _source: string,
    _destination: string,
    _options?: { overwrite?: boolean },
  ): Promise<void> {
    return unsupported('copy');
  }

  findFiles(
    _pattern: string,
    _exclude?: string[],
    _maxResults?: number,
    _cwd?: string,
  ): Promise<string[]> {
    return unsupported('findFiles');
  }

  createFileWatcher(
    _pattern: string,
    _options?: { exclude?: string[]; cwd?: string },
  ): never {
    return unsupported('createFileWatcher');
  }
}

function unknownCells(): MatrixProfile['cells'] {
  return {
    plan: { kind: 'unknown' },
    implement: { kind: 'unknown' },
    review: { kind: 'unknown' },
    research: { kind: 'unknown' },
    tests: { kind: 'unknown' },
    docs: { kind: 'unknown' },
  };
}

function profile(
  family: string,
  model: string,
  cells: Partial<MatrixProfile['cells']> = {},
): MatrixProfile {
  return { family, model, cells: { ...unknownCells(), ...cells } };
}

function userCell(
  score: number,
  asOf = '2026-10-01',
  stale = false,
  sourceRef?: string,
): ValueMatrixCell {
  const cell: ValueMatrixCell = {
    kind: 'value',
    score,
    source: 'user',
    asOf,
    stale,
  };
  if (sourceRef !== undefined) return { ...cell, sourceRef };
  return cell;
}

function summary(
  partial: Pick<
    LaneOutcomeSummary,
    'runId' | 'family' | 'model' | 'taskKind' | 'verdict' | 'endedAt'
  > &
    Partial<LaneOutcomeSummary>,
): LaneOutcomeSummary {
  return {
    runId: partial.runId,
    laneId: partial.laneId ?? 'codex',
    family: partial.family,
    model: partial.model,
    taskKind: partial.taskKind,
    verdict: partial.verdict,
    failureClass: null,
    finalReview: partial.finalReview ?? null,
    reviseRounds: 0,
    durationMs: null,
    endedAt: partial.endedAt,
    routingSource: 'ranking',
    inputTokens: null,
    outputTokens: null,
    costUsd: null,
  };
}

function deliveredRuns(count: number, model = 'glm-5'): LaneOutcomeSummary[] {
  return Array.from({ length: count }, (_, index) =>
    summary({
      runId: `local-${model}-${index}`,
      family: 'z-ai',
      model,
      taskKind: 'implement',
      verdict: 'delivered',
      endedAt: NOW - (count - index) * 1000,
    }),
  );
}

interface ReaderDouble {
  readonly reader: LaneOutcomeReader;
  readonly calls: { laneId: string; sinceMs: number }[];
}

function outcomeReader(options: {
  persistent?: boolean;
  summaries?: readonly LaneOutcomeSummary[];
  persistThrows?: boolean;
  readThrows?: boolean;
}): ReaderDouble {
  const calls: { laneId: string; sinceMs: number }[] = [];
  const reader: LaneOutcomeReader = {
    isPersistent: () => {
      if (options.persistThrows === true) {
        throw new Error('persistence failed');
      }
      return options.persistent ?? true;
    },
    recentOutcomes: (laneId, window) => {
      calls.push({ laneId, sinceMs: window.sinceMs });
      if (options.readThrows === true) {
        return Promise.reject(new Error('outcome read failed'));
      }
      return Promise.resolve(options.summaries ?? []);
    },
  };
  return { reader, calls };
}

function warningsOf(): { logger: LaneRoutingLogger; warnings: string[] } {
  const warnings: string[] = [];
  const logger: LaneRoutingLogger = {
    debug: () => undefined,
    info: () => undefined,
    warn: (message) => {
      warnings.push(message);
    },
    error: () => undefined,
  };
  return { logger, warnings };
}

function harness(
  options: {
    reader?: LaneOutcomeReader;
    home?: string;
  } = {},
): {
  store: CapabilityMatrixStore;
  files: MemoryFiles;
  warnings: string[];
} {
  const files = new MemoryFiles();
  const { logger, warnings } = warningsOf();
  const store = new CapabilityMatrixStore({
    fileSystem: files,
    ptahHomeDir: options.home ?? HOME,
    outcomeReader: options.reader,
    logger,
  });
  return { store, files, warnings };
}

function writeUser(
  files: MemoryFiles,
  profiles: readonly MatrixProfile[],
): void {
  files.files.set(USER_PATH, JSON.stringify({ version: 1, profiles }));
}

function load(
  store: CapabilityMatrixStore,
  outcomeQueries: readonly MatrixOutcomeQuery[] = [],
  nowMs = NOW,
): Promise<CapabilityMatrixSnapshot> {
  return store.load({ nowMs, outcomeQueries });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function viewCell(
  text: string,
  family: string,
  model: string,
  kind: OutcomeTaskKind,
): Record<string, unknown> {
  const parsed: unknown = JSON.parse(text);
  if (!isRecord(parsed) || !Array.isArray(parsed['profiles'])) {
    throw new Error('view profiles missing');
  }
  for (const profile of parsed['profiles']) {
    if (!isRecord(profile)) continue;
    if (profile['family'] !== family || profile['model'] !== model) continue;
    const cells = profile['cells'];
    if (!isRecord(cells)) throw new Error('view cells missing');
    const cell = cells[kind];
    if (!isRecord(cell)) throw new Error(`view cell ${kind} missing`);
    return cell;
  }
  throw new Error(`view profile ${family}/${model} missing`);
}

function valueCell(cell: MatrixCell): ValueMatrixCell {
  if (cell.kind !== 'value') throw new Error('expected a value cell');
  return cell;
}

describe('CapabilityMatrixStore', () => {
  it('resolves an unseen family to the neutral score (Req 6.4)', async () => {
    const { store } = harness();
    const snapshot = await load(store);
    const resolved = snapshot.resolve('not-a-family', 'missing', 'implement');
    expect(resolved).toMatchObject({
      cell: { kind: 'unknown' },
      score: NEUTRAL_SCORE,
      noProfile: true,
      profileModel: FAMILY_PROFILE_MODEL,
    });
    expect(snapshot.resolve('z-ai', 'glm-5', 'plan')).toMatchObject({
      cell: { kind: 'unknown' },
      score: NEUTRAL_SCORE,
      noProfile: true,
    });
  });

  it('keeps a user value over the seed and over later local rows (Req 6.5)', async () => {
    const { store, files } = harness({
      reader: outcomeReader({ summaries: deliveredRuns(5) }).reader,
    });
    writeUser(files, [
      profile('z-ai', 'glm-5', {
        implement: userCell(42, '2026-10-01', false, 'editor'),
      }),
    ]);
    const first = await load(store, [{ laneId: 'codex', subagent: false }]);
    expect(
      valueCell(first.resolve('z-ai', 'glm-5', 'implement').cell),
    ).toMatchObject({
      score: 42,
      source: 'user',
      sourceRef: 'editor',
    });
    const later = Date.parse('2026-02-17T00:00:00.000Z') + STALENESS_AGE_MS + 1;
    const second = await load(
      store,
      [{ laneId: 'codex', subagent: false }],
      later,
    );
    expect(
      valueCell(second.resolve('z-ai', 'glm-5', 'implement').cell).score,
    ).toBe(42);
    expect(second.resolve('z-ai', 'glm-5', 'implement').cell).toMatchObject({
      source: 'user',
    });
  });

  it('replaces the seed when five local runs qualify (Req 6.6)', async () => {
    const below = harness({
      reader: outcomeReader({ summaries: deliveredRuns(4) }).reader,
    });
    const belowSnapshot = await load(below.store, [
      { laneId: 'codex', subagent: false },
    ]);
    expect(
      belowSnapshot.resolve('z-ai', 'glm-5', 'implement').cell,
    ).toMatchObject({
      source: 'seed',
      score: SEED_LABEL_SCORE.strong,
    });

    const ready = harness({
      reader: outcomeReader({ summaries: deliveredRuns(5) }).reader,
    });
    const snapshot = await load(ready.store, [
      { laneId: 'codex', subagent: false },
    ]);
    expect(
      valueCell(snapshot.resolve('z-ai', 'glm-5', 'implement').cell),
    ).toMatchObject({
      source: 'local',
      score: 100,
      sampleCount: 5,
    });
    expect(snapshot.reasons).toEqual([]);
  });

  it('rejects a user file whose source is not user and names the entry (Req 6.7)', async () => {
    const { store, files } = harness({
      reader: outcomeReader({ summaries: [] }).reader,
    });
    writeUser(files, [profile('z-ai', 'glm-5', { implement: userCell(42) })]);
    await load(store);

    writeUser(files, [
      profile('z-ai', 'glm-5', {
        implement: {
          kind: 'value',
          score: 80,
          source: 'seed',
          sourceRef: SEED_SOURCE_REF,
          asOf: '2026-02-17',
          stale: true,
          note: SEED_NOTE,
        },
      }),
    ]);
    const seeded = await load(store);
    expect(seeded.reasons).toEqual([
      `${MATRIX_INVALID_PREFIX} family "z-ai" model "glm-5" task "implement" source must be "user" (found "seed")`,
    ]);
    expect(
      valueCell(seeded.resolve('z-ai', 'glm-5', 'implement').cell).score,
    ).toBe(42);

    writeUser(files, [
      profile('codex', 'gpt-5', {
        review: {
          kind: 'value',
          score: 70,
          source: 'local',
          asOf: '2026-10-10T00:00:00.000Z',
          stale: false,
          sampleCount: 5,
        },
      }),
    ]);
    const local = await load(store);
    expect(local.reasons[0]).toContain(
      'family "codex" model "gpt-5" task "review" source must be "user" (found "local")',
    );
    expect(
      valueCell(local.resolve('z-ai', 'glm-5', 'implement').cell).score,
    ).toBe(42);
  });

  it('rejects a malformed edit by name and keeps the last valid matrix (Req 6.7)', async () => {
    const { store, files, warnings } = harness({
      reader: outcomeReader({ summaries: [] }).reader,
    });
    writeUser(files, [
      profile('z-ai', 'glm-5', {
        implement: userCell(42),
        plan: userCell(70),
      }),
    ]);
    await load(store);

    writeUser(files, [
      profile('z-ai', 'glm-5', {
        implement: { ...userCell(42), score: 101 },
        plan: userCell(99),
      }),
    ]);
    const malformed = await load(store);
    expect(
      malformed.reasons.some(
        (reason) =>
          reason.startsWith(MATRIX_INVALID_PREFIX) &&
          reason.includes('family "z-ai"') &&
          reason.includes('model "glm-5"') &&
          reason.includes('task "implement"'),
      ),
    ).toBe(true);
    expect(malformed.resolve('z-ai', 'glm-5', 'implement').score).toBe(42);
    expect(malformed.resolve('z-ai', 'glm-5', 'plan').score).toBe(70);

    files.files.set(USER_PATH, '{');
    const invalid = await load(store);
    expect(invalid.reasons).toEqual([
      `${MATRIX_INVALID_PREFIX} capability-matrix.json (not valid JSON)`,
    ]);
    expect(invalid.reasons.join(' ')).not.toContain('Unexpected');
    expect(warnings.length).toBeGreaterThan(0);
    expect(invalid.resolve('z-ai', 'glm-5', 'implement').score).toBe(42);

    writeUser(files, [
      profile('z-ai', 'glm-5', { implement: userCell(42) }),
      profile('z-ai', 'glm-5', { implement: userCell(7) }),
    ]);
    const duplicate = await load(store);
    expect(
      duplicate.reasons.some(
        (reason) =>
          reason.includes('family "z-ai"') && reason.includes('model "glm-5"'),
      ),
    ).toBe(true);
    expect(duplicate.resolve('z-ai', 'glm-5', 'implement').score).toBe(42);
  });

  it('caps named rejections and still names the entries it shows (Req 6.7)', async () => {
    const { store, files } = harness({
      reader: outcomeReader({ summaries: [] }).reader,
    });
    const localCell: ValueMatrixCell = {
      kind: 'value',
      score: 80,
      source: 'local',
      asOf: '2026-10-10T00:00:00.000Z',
      stale: false,
      sampleCount: 5,
    };
    const everyKind = {
      plan: localCell,
      implement: localCell,
      review: localCell,
      research: localCell,
      tests: localCell,
      docs: localCell,
    };
    writeUser(
      files,
      ['a', 'b', 'c', 'd'].map((family) => profile(family, 'm', everyKind)),
    );
    const snapshot = await load(store);
    expect(snapshot.reasons).toHaveLength(21);
    expect(snapshot.reasons[0]).toContain('family "a" model "m" task "plan"');
    expect(snapshot.reasons[20]).toBe(
      `${MATRIX_INVALID_PREFIX} 4 more entries`,
    );
    expect(
      snapshot.reasons.some(
        (reason) =>
          reason.includes('family "a"') && reason.includes('task "docs"'),
      ),
    ).toBe(true);
    expect(
      snapshot.reasons.some(
        (reason) =>
          reason.includes('family "d"') && reason.includes('task "docs"'),
      ),
    ).toBe(false);
  });

  it('writes the view with provenance only when its content changes (Req 6.8)', async () => {
    const { store, files } = harness();
    const first = await load(store);
    expect(files.files.get(USER_PATH)).toBe(EMPTY_CAPABILITY_MATRIX_TEXT);
    expect(files.writes.filter((path) => path === USER_PATH)).toEqual([
      USER_PATH,
    ]);
    expect(files.reads.filter((path) => path === USER_PATH)).toHaveLength(1);
    const seedCell = viewCell(
      files.files.get(VIEW_PATH) ?? '',
      'z-ai',
      'glm-5',
      'implement',
    );
    expect(seedCell).toMatchObject({
      kind: 'value',
      source: 'seed',
      sourceRef: SEED_SOURCE_REF,
      asOf: '2026-02-17',
      stale: true,
      sampleCount: null,
      note: SEED_NOTE,
    });
    expect(
      viewCell(files.files.get(VIEW_PATH) ?? '', 'z-ai', 'glm-5', 'plan'),
    ).toEqual({
      kind: 'unknown',
    });
    expect(first.resolve('z-ai', 'glm-5', 'implement').cell).toMatchObject({
      source: 'seed',
      stale: isStale('2026-02-17', NOW),
    });

    const viewWrites = files.writes.filter((path) => path === VIEW_PATH).length;
    await load(store);
    expect(files.writes.filter((path) => path === USER_PATH)).toEqual([
      USER_PATH,
    ]);
    expect(files.writes.filter((path) => path === VIEW_PATH)).toHaveLength(
      viewWrites,
    );
    expect(files.reads.filter((path) => path === USER_PATH)).toHaveLength(2);
    expect(files.reads.filter((path) => path === VIEW_PATH)).toHaveLength(1);

    const restarted = new CapabilityMatrixStore({
      fileSystem: files,
      ptahHomeDir: HOME,
      logger: warningsOf().logger,
    });
    await load(restarted);
    expect(files.writes.filter((path) => path === VIEW_PATH)).toHaveLength(
      viewWrites,
    );

    writeUser(files, [
      profile('z-ai', 'glm-5', {
        implement: userCell(42, '2020-01-01', false, 'editor'),
      }),
    ]);
    const edited = await load(store);
    expect(
      files.writes.filter((path) => path === VIEW_PATH).length,
    ).toBeGreaterThan(viewWrites);
    expect(files.writes.filter((path) => path === USER_PATH)).toEqual([
      USER_PATH,
    ]);
    const shown = viewCell(
      files.files.get(VIEW_PATH) ?? '',
      'z-ai',
      'glm-5',
      'implement',
    );
    expect(shown).toMatchObject({
      source: 'user',
      sourceRef: 'editor',
      asOf: '2020-01-01',
      stale: true,
      sampleCount: null,
    });
    expect(files.files.get(USER_PATH)).toContain('"stale":false');
    expect(edited.resolve('z-ai', 'glm-5', 'implement').cell).toMatchObject({
      stale: isStale('2020-01-01', NOW),
    });
  });

  it('falls back to the family profile for lane-default, auto and an unknown model', async () => {
    const { store, files } = harness();
    writeUser(files, [
      profile('z-ai', FAMILY_PROFILE_MODEL, { implement: userCell(70) }),
      profile('z-ai', LANE_DEFAULT_MODEL, { implement: userCell(11) }),
      profile('z-ai', AUTOMATIC_MATRIX_MODEL, { implement: userCell(12) }),
    ]);
    const snapshot = await load(store);
    expect(
      snapshot.resolve('z-ai', LANE_DEFAULT_MODEL, 'implement'),
    ).toMatchObject({
      score: 70,
      profileModel: FAMILY_PROFILE_MODEL,
    });
    expect(
      snapshot.resolve('z-ai', AUTOMATIC_MATRIX_MODEL, 'implement').score,
    ).toBe(70);
    expect(snapshot.resolve('z-ai', 'other-model', 'implement')).toMatchObject({
      score: 70,
      profileModel: FAMILY_PROFILE_MODEL,
    });
    expect(snapshot.resolve('z-ai', 'glm-5', 'implement').cell).toMatchObject({
      source: 'seed',
      score: SEED_LABEL_SCORE.strong,
    });
  });

  it('puts lane-default outcomes on the family profile', async () => {
    const { store } = harness({
      reader: outcomeReader({
        summaries: deliveredRuns(5, LANE_DEFAULT_MODEL),
      }).reader,
    });
    const snapshot = await load(store, [{ laneId: 'codex', subagent: false }]);
    expect(
      snapshot.resolve('z-ai', LANE_DEFAULT_MODEL, 'implement').cell,
    ).toMatchObject({
      source: 'local',
      score: 100,
      sampleCount: 5,
    });
    expect(
      snapshot.resolve('z-ai', LANE_DEFAULT_MODEL, 'implement').profileModel,
    ).toBe(FAMILY_PROFILE_MODEL);
  });

  it('skips local cells when the outcome store is not persistent', async () => {
    const doubled = outcomeReader({
      persistent: false,
      summaries: deliveredRuns(5),
    });
    const { store } = harness({ reader: doubled.reader });
    const snapshot = await load(store, [{ laneId: 'codex', subagent: false }]);
    expect(doubled.calls).toEqual([]);
    expect(snapshot.reasons).toEqual([NO_OUTCOME_HISTORY_REASON]);
    expect(snapshot.resolve('z-ai', 'glm-5', 'implement').cell).toMatchObject({
      source: 'seed',
    });
  });

  it('names a missing or throwing outcome reader and still uses the seed', async () => {
    const absent = harness();
    const absentSnapshot = await load(absent.store);
    expect(absentSnapshot.reasons).toEqual([OUTCOMES_UNAVAILABLE_REASON]);

    const doubled = outcomeReader({
      readThrows: true,
      summaries: deliveredRuns(5),
    });
    const { store, warnings } = harness({ reader: doubled.reader });
    const snapshot = await load(store, [{ laneId: 'codex', subagent: false }]);
    expect(snapshot.reasons).toEqual([OUTCOMES_UNAVAILABLE_REASON]);
    expect(warnings).toContain('lane outcome read failed');
    expect(snapshot.resolve('z-ai', 'glm-5', 'implement').cell).toMatchObject({
      source: 'seed',
      score: SEED_LABEL_SCORE.strong,
    });
  });

  it('reads each lane once and uses the subagent lane id', async () => {
    const doubled = outcomeReader({ summaries: [] });
    const { store } = harness({ reader: doubled.reader });
    await load(store, [
      { laneId: 'codex', subagent: false },
      { laneId: 'codex', subagent: false },
      { laneId: 'subagent:researcher', subagent: true },
      { laneId: 'subagent:reviewer', subagent: true },
      { laneId: '   ', subagent: false },
    ]);
    expect(doubled.calls.map((call) => call.laneId).sort()).toEqual(
      ['codex', SUBAGENT_LANE_ID].sort(),
    );
    expect(
      doubled.calls.every((call) => call.sinceMs === NOW - OUTCOME_WINDOW_MS),
    ).toBe(true);
  });

  it('keeps the seed when the user file is missing or unreadable', async () => {
    const created = harness();
    const snapshot = await load(created.store);
    expect(snapshot.reasons).toEqual([OUTCOMES_UNAVAILABLE_REASON]);
    expect(snapshot.resolve('z-ai', 'glm-5', 'implement').score).toBe(
      SEED_LABEL_SCORE.strong,
    );

    const blocked = harness();
    blocked.files.failReads.set(USER_PATH, coded('denied', 'EACCES'));
    const unreadable = await load(blocked.store);
    expect(unreadable.reasons).toContain(
      `${MATRIX_INVALID_PREFIX} capability-matrix.json (unreadable)`,
    );
    expect(blocked.files.writes.filter((path) => path === USER_PATH)).toEqual(
      [],
    );
    expect(blocked.warnings).toContain(
      'capability matrix user file could not be read',
    );
    expect(unreadable.resolve('z-ai', 'glm-5', 'implement').cell).toMatchObject(
      {
        source: 'seed',
      },
    );
  });

  it('refuses a blank home directory and a non-finite clock before any write', async () => {
    const blank = new MemoryFiles();
    expect(
      () =>
        new CapabilityMatrixStore({
          fileSystem: blank,
          ptahHomeDir: '   ',
        }),
    ).toThrow('ptahHomeDir must be the absolute ~/.ptah directory');
    const { store, files } = harness();
    await expect(
      store.load({ nowMs: Number.POSITIVE_INFINITY, outcomeQueries: [] }),
    ).rejects.toThrow('nowMs must be a finite epoch millisecond');
    expect(files.writes).toEqual([]);
  });
});
