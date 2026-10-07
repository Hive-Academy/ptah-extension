import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import type { BenchHostContainer } from '../../../transport/bench-host-boot';
import { CassetteStore, sha256Hex } from '../../doubles/cassette-store';
import {
  curatorExtractKey,
  RecordedCuratorLlm,
} from '../../doubles/recorded-curator-llm';
import { RECORD_SEPARATOR } from '../../ground-truth/session-jsonl-writer';
import type { MemorySkillsHostSuiteContext } from '../../host/memory-skills-host';
import { curationDetailsSchema } from '../../memory-skills-suite-kinds';
import { toScorecardSuite } from '../../runner/run-scorecard';
import { readSuiteResult } from '../../runner/suite-result';
import {
  benchDataDirOf,
  createScopeWriteSuite,
  createScratchRepos,
  SCOPE_WRITE_CASSETTE_VERSION,
  SCOPE_WRITE_SUITE_ID,
  type ScopeWritePort,
} from './scope-write.suite';

const SESSION = [
  {
    type: 'user',
    timestamp: '2026-09-04T10:00:00.000Z',
    message: {
      role: 'user',
      content: [
        { type: 'text', text: 'Keep this for later: lanes over subagents.' },
      ],
    },
  },
  {
    type: 'assistant',
    timestamp: '2026-09-04T10:01:00.000Z',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: 'Noted as durable.' }],
    },
  },
];
const TRANSCRIPT = [
  'USER: Keep this for later: lanes over subagents.',
  'ASSISTANT: Noted as durable.',
].join(RECORD_SEPARATOR);

/** A synthetic replay cassette: the one extract call returns two drafts. */
function writeSyntheticCassette(path: string): void {
  const entry = {
    key: curatorExtractKey(TRANSCRIPT),
    method: 'extract',
    model: 'synthetic-spec',
    promptSha: sha256Hex(TRANSCRIPT),
    response: {
      status: 'extracted',
      drafts: [
        {
          kind: 'preference',
          subject: 'orchestration',
          content: 'Lanes over subagents.',
          salienceHint: 0.5,
        },
        {
          kind: 'fact',
          subject: 'durability',
          content: 'Noted as durable.',
          salienceHint: 0.3,
        },
      ],
    },
  };
  writeFileSync(path, `${JSON.stringify(entry)}\n`);
}

type StoreKey = (root: string | null, sessionId: string) => string | null;

/**
 * A port over the replay double: one row per extracted draft, keyed by
 * `storeKey`. `asToday` stores `workspaceRoot ?? null` verbatim, which is
 * what `memory-curator.service.ts:867` does.
 */
function fakePort(
  curator: RecordedCuratorLlm,
  storeKey: StoreKey,
): ScopeWritePort & { rows: { sessionId: string; root: string | null }[] } {
  const rows: { sessionId: string; root: string | null }[] = [];
  return {
    rows,
    async curate(input) {
      const extraction = await curator.extract(input.transcript);
      if (extraction.status !== 'extracted')
        return { outcome: extraction.status };
      for (let i = 0; i < extraction.drafts.length; i += 1) {
        rows.push({
          sessionId: input.sessionId,
          root: storeKey(input.workspaceRoot, input.sessionId),
        });
      }
      return { outcome: 'ran' };
    },
    async rowsOfSession(sessionId) {
      return rows
        .filter((row) => row.sessionId === sessionId)
        .map((row) => row.root);
    },
    async countRows() {
      return rows.length;
    },
    modelCalls() {
      const counts = curator.callCounts();
      return counts.extract + counts.resolve;
    },
  };
}

const asToday: StoreKey = (root) => root;

function git(args: readonly string[], cwd: string): string {
  return execFileSync('git', [...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/** The fixed writer: the main repository's real path for every spelling, never `''`. */
const canonicalising: StoreKey = (root) => {
  if (root === null || root === '' || !existsSync(root)) return null;
  const common = git(
    ['-C', root, 'rev-parse', '--git-common-dir'],
    root,
  ).trim();
  return realpathSync.native(dirname(resolve(root, common)));
};

describe('mem.scope.write', () => {
  let root: string;
  let bench: string;
  let home: string;
  let runId: string;
  let curator: RecordedCuratorLlm;

  beforeEach(() => {
    // realpath: on win32 tmpdir() may be an 8.3 short path; git reports long ones.
    root = realpathSync.native(
      mkdtempSync(join(tmpdir(), 'ptah-620-b19-scope-')),
    );
    bench = join(root, 'bench');
    home = join(root, 'home');
    mkdirSync(join(home, 'fixtures'), { recursive: true });
    writeFileSync(
      join(home, 'fixtures', 'scope-session.jsonl'),
      SESSION.map((l) => JSON.stringify(l)).join('\n'),
    );
    const cassette = join(root, 'cassettes', 'scope-write.v1.jsonl');
    mkdirSync(dirname(cassette), { recursive: true });
    writeSyntheticCassette(cassette);
    curator = new RecordedCuratorLlm({
      store: new CassetteStore({ path: cassette, mode: 'replay' }),
      model: 'synthetic-spec',
    });
    runId = 'ms-scope-1';
    mkdirSync(join(bench, 'runs', runId), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function contextFor(id = runId): MemorySkillsHostSuiteContext {
    return {
      runId: id,
      runDir: join(bench, 'runs', id),
      options: { sessionFile: 'fixtures/scope-session.jsonl' },
      workspaceRoot: join(root, 'workspace'),
      isolation: {
        home,
        userDataPath: join(home, '.ptah'),
        dbPath: join(home, 'db.sqlite'),
      },
      container: {} as BenchHostContainer,
      doubles: {
        mode: 'replay',
        curator,
      } as unknown as MemorySkillsHostSuiteContext['doubles'],
      ci: true,
    };
  }

  it("records today's expected failure: non-canonical keys and '' rows", async () => {
    const port = fakePort(curator, asToday);
    await createScopeWriteSuite({ portOf: () => port }).run(contextFor());
    const { result, cases } = readSuiteResult(
      join(bench, 'runs', runId),
      SCOPE_WRITE_SUITE_ID,
    );

    expect(cases.map((c) => c.caseId)).toEqual([
      'scope.empty',
      'scope.null',
      'scope.main',
      'scope.worktree',
      'scope.case-variant',
      'scope.trailing-slash',
      'scope.workspace-b',
    ]);
    const details = curationDetailsSchema.parse(result.details);
    expect(details.operation).toBe('scope-write');
    // win32 folds the case-variant onto the main repository; elsewhere it is no repository.
    const familyCases = process.platform === 'win32' ? 4 : 3;
    expect(result.metrics['nonCanonicalShare.den']).toBe(2 * familyCases);
    expect(result.metrics['nonCanonicalShare.num']).toBe(2 * (familyCases - 1));
    expect(result.metrics['nonCanonicalShare']).toBe(
      (familyCases - 1) / familyCases,
    );
    expect(result.metrics['emptyRootRows']).toBe(2);
    expect(result.metrics['crossWorkspaceLeaks']).toBe(0);
    expect(result.metrics['preexistingRows']).toBe(0);
    expect(result.verdict).toBe('fail');
    expect(cases.find((c) => c.caseId === 'scope.main')?.outcome).toBe('pass');
    expect(cases.find((c) => c.caseId === 'scope.worktree')).toMatchObject({
      outcome: 'fail',
      observed: 'outcome=ran; rows=2; keys=worktree-key:2',
    });
    expect(cases.find((c) => c.caseId === 'scope.empty')?.outcome).toBe('fail');
    expect(cases.find((c) => c.caseId === 'scope.null')?.outcome).toBe('pass');
    for (const record of cases) expect(record.observed).not.toContain(root);
    // One replayed extract per case; no live call possible in replay.
    expect(result.modelCalls).toBe(7);
    expect(result.cost.calls).toBe(2 * 7 + 1 + 7);
    expect(result.cassetteVersion).toBe(SCOPE_WRITE_CASSETTE_VERSION);
  });

  it('is na, never pass, on a database another suite already wrote', async () => {
    const port = fakePort(curator, (_root, sessionId) => `/repo-${sessionId}`);
    port.rows.push({ sessionId: 'other-suite', root: '/elsewhere' });
    await createScopeWriteSuite({ portOf: () => port }).run(contextFor());
    const { result } = readSuiteResult(
      join(bench, 'runs', runId),
      SCOPE_WRITE_SUITE_ID,
    );
    expect(result.metrics['preexistingRows']).toBe(1);
    expect(result.verdict).toBe('na');
    expect(result.naReason).toBe('shared-db-not-fresh: 1 pre-existing rows');
  });

  it('declares itself the first host suite', () => {
    expect(createScopeWriteSuite().placement).toBe('first');
  });

  it('creates the scratch repositories and worktree only under <benchData>/git-scope/<runId>', async () => {
    await createScopeWriteSuite({
      portOf: () => fakePort(curator, asToday),
    }).run(contextFor());
    const scope = join(bench, 'git-scope', runId);
    for (const name of ['repo', 'repo-b', 'repo-wt', 'no-hooks']) {
      expect(existsSync(join(scope, name))).toBe(true);
    }
    const worktrees = git(
      ['-C', join(scope, 'repo'), 'worktree', 'list', '--porcelain'],
      scope,
    );
    expect(worktrees).toContain(
      `worktree ${join(scope, 'repo-wt').replace(/\\/g, '/')}`,
    );
    const top = git(
      ['-C', join(scope, 'repo-wt'), 'rev-parse', '--show-toplevel'],
      scope,
    ).trim();
    expect(resolve(top).toLowerCase()).toBe(
      join(scope, 'repo-wt').toLowerCase(),
    );
  });

  it('passes once the writer canonicalises every spelling to the main key', async () => {
    await createScopeWriteSuite({
      portOf: () => fakePort(curator, canonicalising),
    }).run(contextFor());
    const { result } = readSuiteResult(
      join(bench, 'runs', runId),
      SCOPE_WRITE_SUITE_ID,
    );
    expect(result.metrics).toMatchObject({
      nonCanonicalShare: 0,
      emptyRootRows: 0,
      crossWorkspaceLeaks: 0,
    });
    expect(result.verdict).toBe('pass');
  });

  it('counts a row of workspace B stored under workspace A as a leak', async () => {
    const leaky: StoreKey = (rootKey, sessionId) =>
      sessionId === 'scope-write-workspace-b'
        ? join(bench, 'git-scope', runId, 'repo')
        : rootKey;
    await createScopeWriteSuite({ portOf: () => fakePort(curator, leaky) }).run(
      contextFor(),
    );
    const { result, cases } = readSuiteResult(
      join(bench, 'runs', runId),
      SCOPE_WRITE_SUITE_ID,
    );
    expect(result.metrics['crossWorkspaceLeaks']).toBe(2);
    expect(cases.find((c) => c.caseId === 'scope.workspace-b')?.outcome).toBe(
      'fail',
    );
  });

  it('records a cassette miss as a case error instead of hiding it', async () => {
    const empty = join(root, 'cassettes', 'empty.jsonl');
    writeFileSync(empty, '');
    const missing = new RecordedCuratorLlm({
      store: new CassetteStore({ path: empty, mode: 'replay' }),
      model: 'synthetic-spec',
    });
    await createScopeWriteSuite({
      portOf: () => fakePort(missing, asToday),
    }).run(contextFor());
    const { result, cases } = readSuiteResult(
      join(bench, 'runs', runId),
      SCOPE_WRITE_SUITE_ID,
    );
    expect(cases.every((c) => c.error?.includes('Cassette miss'))).toBe(true);
    expect(result.verdict).toBe('na');
    expect(result.naReason).toBe('no-rows-written');
    expect(result.cost.error_rate).toBe(1);
  });

  it('sets cost.source cassette for a replayed run', async () => {
    await createScopeWriteSuite({
      portOf: () => fakePort(curator, asToday),
    }).run(contextFor());
    const scored = readSuiteResult(
      join(bench, 'runs', runId),
      SCOPE_WRITE_SUITE_ID,
    );
    const host = {
      pid: 1,
      port: 2,
      guardMode: 'hash',
      exitedEarly: () => false,
      stop: async () => undefined,
    };
    const suite = toScorecardSuite({ placement: 'host', ...scored }, 'replay', {
      runId,
      startedAt: '2026-10-07T00:00:00.000Z',
      host: host as never,
    });
    expect(suite.cost.source).toBe('cassette');
    expect(suite.projectionSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('refuses a run directory that is not <benchData>/runs/<runId>', () => {
    expect(
      benchDataDirOf({ runId: 'ms-1', runDir: join(bench, 'runs', 'ms-1') }),
    ).toBe(bench);
    expect(() =>
      benchDataDirOf({ runId: 'ms-1', runDir: join(bench, 'other', 'ms-1') }),
    ).toThrow(/not <benchData>/);
    expect(() =>
      benchDataDirOf({ runId: 'ms-2', runDir: join(bench, 'runs', 'ms-1') }),
    ).toThrow(/not <benchData>/);
  });

  it('refuses to reuse a scratch folder and a repository that is not its own', () => {
    createScratchRepos(bench, 'ms-reuse', git);
    expect(() => createScratchRepos(bench, 'ms-reuse', git)).toThrow(/EEXIST/);
    const lying = (args: readonly string[], cwd: string): string =>
      args.includes('--show-toplevel') ? root : git(args, cwd);
    expect(() => createScratchRepos(bench, 'ms-lie', lying)).toThrow(
      /refusing to touch it/,
    );
  });
});
