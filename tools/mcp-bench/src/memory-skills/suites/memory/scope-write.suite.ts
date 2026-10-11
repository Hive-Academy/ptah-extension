/**
 * `mem.scope.write` (benchmark-design.md 3.6): which `workspace_root` key the
 * WRITE path stores when one seeded session is curated under the spellings a
 * real workspace arrives with. The memory DB keys rows by the exact string
 * (`memory.store.ts:215`, `workspace_root IS ?` everywhere), so a spelling the
 * writer does not canonicalise becomes a separate workspace.
 *
 * Boundary with TASK_2026_619 (R-M10, context.md): read-side scope, isolation,
 * worktree-to-repo recall and the spill-root bug belong to 619's
 * `ptah_memory_search` suites. This suite never searches; it curates and then
 * reads back only the keys it wrote (by session id).
 *
 * Scratch git (design :176): a temporary repository, one `git worktree add`
 * and a second repository are created under `<benchData>/git-scope/<runId>/`
 * only — never in the user's repository and never through `withPinnedCorpus`.
 * Every git call runs with `-C <scratch dir>` after the suite proved the
 * scratch repository's top level is its own directory, with an empty
 * `core.hooksPath` (no user hook runs) and signing off (a scratch commit in the
 * isolated bench folder, not the user's history).
 *
 * Cases, in this order (each a distinct session id, the same transcript):
 *   `''` first and `null` second, while no other key has rows: `''` scopes the
 *   merge-candidate search to every workspace, so curating it later would show
 *   the resolver ulid-keyed candidates and the replayed cassette key would
 *   drift. Then main, worktree, case-variant, trailing-slash, workspace-b.
 *
 * Metrics (design :177): rows by stored key class; non-canonical share = rows
 * whose key canonicalises (git common dir, case-folded on win32) to the main
 * repository but differs from the main key, over rows that canonicalise to it;
 * rows keyed `''`; two-workspace leaks (a row of one workspace's session
 * carrying the other's canonical key). Expected today (forensics M5): share >
 * 0 and `''` rows > 0 — a recorded failure until the canonicalisation fix.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';

import { z } from 'zod';

import { compareCodeUnits } from '../../../utils/compare-code-units';
import { getGitExecutable } from '../../../utils/git-executable';
import type { BenchHostContainer } from '../../../transport/bench-host-boot';
import { RECORD_SEPARATOR } from '../../ground-truth/session-jsonl-writer';
import type {
  MemorySkillsHostSuite,
  MemorySkillsHostSuiteContext,
} from '../../host/memory-skills-host';
import { rate } from '../../metrics/curation-metrics';
import { writeSuiteResult, type CaseRecord } from '../../runner/suite-result';
import {
  costOf,
  inputSha256,
  rateMetrics,
  readSessionMessages,
  recordCase,
  resolveHomeFile,
  type RecordedCase,
} from './memory-suite-support';

export const SCOPE_WRITE_SUITE_ID = 'mem.scope.write';
/** The cassette set `## Pending live recording` produces for this suite. */
export const SCOPE_WRITE_CASSETTE_VERSION = 'memory/scope-write.v1';
const GIT_TIMEOUT_MS = 30_000;

export const scopeWriteOptionsSchema = z.strictObject({
  /** SDK-shaped session JSONL in the isolated home (home-relative). */
  sessionFile: z.string().min(1),
});

/** The product write path and the double's call count, as one narrow port. */
export interface ScopeWritePort {
  curate(input: {
    readonly sessionId: string;
    readonly workspaceRoot: string | null;
    readonly transcript: string;
  }): Promise<{ readonly outcome: string }>;
  /** Stored `workspace_root` of every row of `sessionId`, in id order. */
  rowsOfSession(sessionId: string): Promise<readonly (string | null)[]>;
  /** Rows in the whole DB (a non-empty DB makes the `''` case's replay drift). */
  countRows(): Promise<number>;
  /** Model calls the curator double has served so far. */
  modelCalls(): number;
}

/** `git <args>` with `-C`-style cwd; returns stdout. Throws on a non-zero exit. */
export type ScratchGit = (args: readonly string[], cwd: string) => string;

/** Env vars that point git at another repository than the one discovered from `cwd`. */
const REPOSITORY_REDIRECTS = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_COMMON_DIR',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_NAMESPACE',
];

/**
 * Scratch git: an argument array, a 30 s timeout, no prompt, and an env
 * without any repository redirect (a `GIT_DIR` inherited from a hook would
 * otherwise send `-C <scratch>` commands to the user's repository). Discovery
 * never climbs above the directory that holds `cwd`.
 */
const defaultGit: ScratchGit = (args, cwd) => {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const name of REPOSITORY_REDIRECTS) delete env[name];
  env['GIT_TERMINAL_PROMPT'] = '0';
  env['GIT_CEILING_DIRECTORIES'] = dirname(resolve(cwd));
  return execFileSync(getGitExecutable(), [...args], {
    cwd,
    encoding: 'utf8',
    timeout: GIT_TIMEOUT_MS,
    stdio: ['ignore', 'pipe', 'pipe'],
    env,
  });
};

interface CuratorSlice {
  curate(input: {
    sessionId: string;
    workspaceRoot: string | null;
    transcript: string;
    userInitiated: boolean;
  }): Promise<{ readonly outcome: string }>;
}

interface SqliteSlice {
  readonly db: {
    prepare(sql: string): {
      all(...params: unknown[]): unknown[];
      get(...params: unknown[]): unknown;
    };
  };
}

/**
 * The real port. Tokens are the product's interned keys, resolved without
 * value-importing the memory-curator barrel: `PtahMemoryCurator`
 * (`memory-curator/src/lib/di/tokens.ts:11`) and `PtahSqliteConnection`
 * (`persistence-sqlite/src/lib/di/tokens.ts:12`). `userInitiated` keeps the
 * pass off the background-work governor; it does not change the write path.
 */
export function containerScopeWritePort(
  context: MemorySkillsHostSuiteContext,
): ScopeWritePort {
  const resolveService = <T>(
    container: BenchHostContainer,
    name: string,
  ): T => {
    const token = Symbol.for(name);
    if (!container.isRegistered(token, true)) {
      throw new Error(`the bench host container has no ${name}`);
    }
    return container.resolve<T>(token);
  };
  const curator = resolveService<CuratorSlice>(
    context.container,
    'PtahMemoryCurator',
  );
  const sqlite = resolveService<SqliteSlice>(
    context.container,
    'PtahSqliteConnection',
  );
  return {
    curate: (input) => curator.curate({ ...input, userInitiated: true }),
    rowsOfSession: async (sessionId) =>
      (
        sqlite.db
          .prepare(
            'SELECT workspace_root FROM memories WHERE session_id IS ? ORDER BY id ASC',
          )
          .all(sessionId) as { workspace_root: string | null }[]
      ).map((row) => row.workspace_root),
    countRows: async () =>
      (
        sqlite.db.prepare('SELECT COUNT(*) AS n FROM memories').get() as {
          n: number;
        }
      ).n,
    modelCalls: () => {
      const counts = context.doubles.curator.callCounts();
      return counts.extract + counts.resolve;
    },
  };
}

/**
 * `<benchData>` from the host context: the runner creates the run directory as
 * `<benchData>/runs/<runId>` (Batch 16), and the host child cannot resolve the
 * bench folder itself (its HOME is the isolated one). Refuses any other shape.
 */
export function benchDataDirOf(
  context: Pick<MemorySkillsHostSuiteContext, 'runDir' | 'runId'>,
): string {
  const runs = dirname(resolve(context.runDir));
  if (
    basename(resolve(context.runDir)) !== context.runId ||
    basename(runs) !== 'runs'
  ) {
    throw new Error(
      `run directory ${context.runDir} is not <benchData>/runs/${context.runId}`,
    );
  }
  return dirname(runs);
}

/** Path comparison key: resolved, no trailing separator, case-folded on win32. */
export function pathKey(
  path: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const resolved = resolve(path).replace(/[\\/]+$/, '');
  return platform === 'win32' ? resolved.toLowerCase() : resolved;
}

/** The scratch layout under `<benchData>/git-scope/<runId>/`. */
interface ScratchRepos {
  readonly main: string;
  readonly worktree: string;
  readonly second: string;
}

/**
 * Create the scratch repositories. The run folder is created non-recursively,
 * so a second run with the same id is refused instead of reusing old state.
 */
export function createScratchRepos(
  benchDataDir: string,
  runId: string,
  git: ScratchGit,
): ScratchRepos {
  const scopeRoot = join(benchDataDir, 'git-scope');
  mkdirSync(scopeRoot, { recursive: true });
  const root = join(scopeRoot, runId);
  mkdirSync(root);
  const hooks = join(root, 'no-hooks');
  mkdirSync(hooks);
  const isolation = [
    '-c',
    `core.hooksPath=${hooks}`,
    '-c',
    'commit.gpgsign=false',
    '-c',
    'user.name=ptah-bench',
    '-c',
    'user.email=bench@ptah.invalid',
    '-c',
    'init.defaultBranch=main',
  ];
  const initRepo = (dir: string): void => {
    mkdirSync(dir);
    git([...isolation, 'init', '--quiet', dir], root);
    const top = git(['-C', dir, 'rev-parse', '--show-toplevel'], root).trim();
    if (pathKey(top) !== pathKey(dir)) {
      throw new Error(
        `scratch repository ${dir} resolves to ${top}; refusing to touch it`,
      );
    }
    writeFileSync(join(dir, 'README.md'), '# memory scope fixture\n', 'utf8');
    git([...isolation, '-C', dir, 'add', 'README.md'], root);
    git(
      [...isolation, '-C', dir, 'commit', '--quiet', '-m', 'scope fixture'],
      root,
    );
  };
  const main = join(root, 'repo');
  const second = join(root, 'repo-b');
  const worktree = join(root, 'repo-wt');
  initRepo(main);
  initRepo(second);
  git(
    [
      ...isolation,
      '-C',
      main,
      'worktree',
      'add',
      '--quiet',
      '-b',
      'scope-wt',
      worktree,
    ],
    root,
  );
  return { main, worktree, second };
}

/**
 * The repository a stored key belongs to: its git common directory (a
 * worktree shares the main repository's), compared by {@link pathKey}.
 * `null` for `''`, `null` or a path git does not resolve.
 */
export function canonicalRepoKey(
  root: string | null,
  git: ScratchGit,
): string | null {
  if (root === null || root === '' || !existsSync(root)) return null;
  try {
    const common = git(
      ['-C', root, 'rev-parse', '--git-common-dir'],
      root,
    ).trim();
    return pathKey(resolve(root, common));
  } catch {
    // A directory git does not recognise belongs to no repository: it is a
    // key no canonicalisation could map to the main one.
    return null;
  }
}

/** Flip the case of every letter of the last path segment (`repo` → `REPO`). */
function caseVariant(path: string): string {
  const name = basename(path);
  const flipped = [...name]
    .map((ch) =>
      ch === ch.toLowerCase() ? ch.toUpperCase() : ch.toLowerCase(),
    )
    .join('');
  return join(dirname(path), flipped);
}

type Workspace = 'main' | 'workspace-b' | 'none';

interface ScopeCase {
  readonly variant: string;
  readonly root: string | null;
  /** The workspace the session belongs to; `none` for `''` and `null`. */
  readonly workspace: Workspace;
}

/** Case order is load-bearing (module header). */
function scopeCases(repos: ScratchRepos): ScopeCase[] {
  return [
    { variant: 'empty', root: '', workspace: 'none' },
    { variant: 'null', root: null, workspace: 'none' },
    { variant: 'main', root: repos.main, workspace: 'main' },
    { variant: 'worktree', root: repos.worktree, workspace: 'main' },
    {
      variant: 'case-variant',
      root: caseVariant(repos.main),
      workspace: 'main',
    },
    {
      variant: 'trailing-slash',
      root: `${repos.main}${sep}`,
      workspace: 'main',
    },
    { variant: 'workspace-b', root: repos.second, workspace: 'workspace-b' },
  ];
}

interface CaseRows {
  readonly scopeCase: ScopeCase;
  readonly roots: readonly (string | null)[];
}

/** The stored key's class, named without any run path so the projection is stable. */
function keyClass(root: string | null, cases: readonly ScopeCase[]): string {
  if (root === null) return 'null';
  if (root === '') return 'empty';
  const exact = cases.find((item) => item.root === root);
  return exact === undefined ? 'other' : `${exact.variant}-key`;
}

function countBy(values: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of [...values].sort(compareCodeUnits))
    counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

function describeKeys(counts: Record<string, number>): string {
  const entries = Object.entries(counts);
  return entries.length === 0
    ? 'none'
    : entries.map(([k, n]) => `${k}:${n}`).join(',');
}

/** Options for {@link createScopeWriteSuite}; specs inject fakes. */
export interface ScopeWriteSuiteDeps {
  readonly portOf?: (context: MemorySkillsHostSuiteContext) => ScopeWritePort;
  readonly git?: ScratchGit;
  readonly platform?: NodeJS.Platform;
}

export function createScopeWriteSuite(
  deps: ScopeWriteSuiteDeps = {},
): MemorySkillsHostSuite {
  const portOf = deps.portOf ?? containerScopeWritePort;
  const git = deps.git ?? defaultGit;
  return {
    id: SCOPE_WRITE_SUITE_ID,
    // It counts every row in the shared database (`suite-placement.ts`).
    placement: 'first',
    async run(context) {
      const options = scopeWriteOptionsSchema.parse(context.options ?? {});
      const sessionPath = resolveHomeFile(
        context.isolation.home,
        options.sessionFile,
      );
      const transcript = readSessionMessages(sessionPath)
        .map((message) => `${message.role.toUpperCase()}: ${message.text}`)
        .join(RECORD_SEPARATOR);
      if (transcript.length === 0) {
        throw new Error(
          `${options.sessionFile} holds no user or assistant text`,
        );
      }
      const port = portOf(context);
      const repos = createScratchRepos(
        benchDataDirOf(context),
        context.runId,
        git,
      );
      const cases = scopeCases(repos);
      const keyOf = (root: string | null) => canonicalRepoKey(root, git);
      const mainCanonical = keyOf(repos.main);
      const secondCanonical = keyOf(repos.second);
      if (mainCanonical === null || secondCanonical === null) {
        throw new Error(
          'the scratch repositories have no git common directory',
        );
      }
      const preexistingRows = await port.countRows();
      const modelCallsBefore = port.modelCalls();

      const recorded: RecordedCase<CaseRows>[] = [];
      for (const scopeCase of cases) {
        const sessionId = `scope-write-${scopeCase.variant}`;
        const expected =
          scopeCase.workspace === 'none'
            ? "rows written and none keyed ''"
            : `every row keyed exactly as the ${scopeCase.workspace === 'main' ? 'main' : 'workspace-b'} key`;
        recorded.push(
          await recordCase(
            `scope.${scopeCase.variant}`,
            {
              suite: SCOPE_WRITE_SUITE_ID,
              variant: scopeCase.variant,
              transcriptSha256: inputSha256(transcript),
            },
            expected,
            async () => {
              const stats = await port.curate({
                sessionId,
                workspaceRoot: scopeCase.root,
                transcript,
              });
              const roots = await port.rowsOfSession(sessionId);
              const classes = countBy(
                roots.map((root) => keyClass(root, cases)),
              );
              const wanted =
                scopeCase.workspace === 'workspace-b'
                  ? repos.second
                  : repos.main;
              const pass =
                roots.length > 0 &&
                (scopeCase.workspace === 'none'
                  ? roots.every((root) => root !== '')
                  : roots.every((root) => root === wanted));
              return {
                value: { scopeCase, roots },
                verdict: {
                  expected,
                  observed: `outcome=${stats.outcome}; rows=${roots.length}; keys=${describeKeys(classes)}`,
                  outcome: pass ? 'pass' : 'fail',
                },
              };
            },
          ),
        );
      }

      const caseRecords: CaseRecord[] = recorded.map((item) => item.record);
      const done = recorded.flatMap((item) =>
        item.value === null ? [] : [item.value],
      );
      const rows = done.flatMap((item) =>
        item.roots.map((root) => ({
          root,
          workspace: item.scopeCase.workspace,
          canonical: keyOf(root),
        })),
      );
      const toMain = rows.filter((row) => row.canonical === mainCanonical);
      const nonCanonical = rate(
        toMain.filter((row) => row.root !== repos.main).length,
        toMain.length,
      );
      const emptyRootRows = rows.filter((row) => row.root === '').length;
      const crossWorkspaceLeaks = rows.filter(
        (row) =>
          (row.workspace === 'main' && row.canonical === secondCanonical) ||
          (row.workspace === 'workspace-b' && row.canonical === mainCanonical),
      ).length;
      const rowsByKeyClass = countBy(
        rows.map((row) => keyClass(row.root, cases)),
      );
      const errors = caseRecords.filter(
        (record) => record.error != null,
      ).length;
      const modelCalls = port.modelCalls() - modelCallsBefore;
      const productCalls = 2 * caseRecords.length + 1;
      const pathCasesWrote = done
        .filter((item) => item.scopeCase.workspace !== 'none')
        .every((item) => item.roots.length > 0);
      const pass =
        errors === 0 &&
        pathCasesWrote &&
        nonCanonical.num === 0 &&
        emptyRootRows === 0 &&
        crossWorkspaceLeaks === 0;
      // Defence in depth beside the plan-order check: a database another
      // suite or a fixture already wrote is not the fresh one this measures.
      const naReason =
        preexistingRows > 0
          ? `shared-db-not-fresh: ${preexistingRows} pre-existing rows`
          : rows.length === 0
            ? 'no-rows-written'
            : undefined;
      writeSuiteResult(
        context.runDir,
        {
          suiteId: SCOPE_WRITE_SUITE_ID,
          kind: 'curation',
          details: {
            operation: 'scope-write',
            rowsByKeyClass,
            nonCanonicalShare: nonCanonical.value,
            emptyRootRows,
            crossWorkspaceLeaks,
          },
          claim: {
            source: 'code',
            ref: 'libs/backend/memory-curator/src/lib/memory-curator.service.ts:864-867',
            text: 'A curated session is stored under one key per repository, whatever spelling of its workspace root the caller passed.',
          },
          groundTruth: {
            id: 'gt-scope-write',
            version: 'v1',
            method: 'generated',
          },
          // Design 3.6 names no baseline: the claim is an invariant (share 0).
          baselines: [],
          deltas: {},
          cost: costOf(caseRecords, productCalls + modelCalls),
          modelCalls,
          verdict: naReason !== undefined ? 'na' : pass ? 'pass' : 'fail',
          ...(naReason === undefined ? {} : { naReason }),
          metrics: {
            ...rateMetrics('nonCanonicalShare', nonCanonical),
            emptyRootRows,
            crossWorkspaceLeaks,
            rows: rows.length,
            preexistingRows,
            errors,
          },
          cassetteVersion: modelCalls > 0 ? SCOPE_WRITE_CASSETTE_VERSION : null,
        },
        caseRecords,
      );
    },
  };
}

/** Registered in the host entry's `HOST_SUITES`. */
export const SCOPE_WRITE_SUITE = createScopeWriteSuite();
