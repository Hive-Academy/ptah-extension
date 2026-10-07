/**
 * Lifecycle scenarios of the MCP benchmark (research-report.md B7; batches.md
 * Task 9.2). Each scenario is a scored case in the scorecard's `lifecycle[]`
 * (`{ scenario, tool, pass, detail }`); a failed case also fails every suite of
 * its tool (`applyLifecycleVerdicts`).
 *
 * Two groups, because only some scenarios change files:
 * - {@link runCopyScenarios} (1-6 and the restart half of 8) run on a
 *   disposable copy of the corpus (`withLifecycleCorpus`), never on the pinned
 *   corpus, with hosts of their own: cold start, edit/add/delete then query,
 *   large files, index age beyond 24 h (rows backdated in the host's isolated
 *   DB), and a server restart under an in-flight call.
 * - {@link runSessionScenarios} (7, the idle-gap half of 8, and 9) use the
 *   run's main host and change no corpus file: two workspaces plus a worktree
 *   (memory leak count, spool path, symbol scope), 200 calls with 4-8 s idle
 *   gaps on one keep-alive connection, and the task tools in a git worktree.
 *
 * Expected today, recorded as failures (never `na`): on `cli-headless`, cold
 * start and edit/add then query (no boot-time index), and scenario 9 (the
 * task tools take no `workspaceRoot`; Phase 2 Batch 34b turns it to pass).
 *
 * Every host is launched through an injected {@link HostLauncher}, so the
 * guard modes and stop classification of the launcher apply unchanged. A
 * guard error (`RealStateChangedError`, `BenchHeldRealStateError`,
 * `ConcurrentWriterError`) is never caught here: it voids the run.
 */

import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { buildMemoryQuestionSet } from '../ground-truth/memory-questions';
import { mulberry32 } from '../ground-truth/ts-program';
import { CallRecorder, classifyToolResult } from '../transport/call-recorder';
import type { MemorySeedRoots } from '../transport/memory-seed-env';
import { runThenStop, stopThenRethrow } from '../transport/guarded-stop';
import type { HostExit } from '../transport/host-launcher';
import type { McpToolCaller } from '../transport/mcp-client';
import { MEMORY_SEEDED_SCENARIOS, naScenarios } from './lifecycle-na';
import {
  describeOutcome,
  indexAgeScenario,
  pollUntil,
  searchSymbol,
  states,
} from './lifecycle-probe';
import { parseMemoryContents } from '../suites/tool-results';
import { ToolResultParseError } from '../suites/suite-runner';

/** The cases {@link runCopyScenarios} scores, in order. */
export const COPY_SCENARIOS: readonly { scenario: string; tool: string }[] = [
  ...[
    'cold-start',
    'edit-then-query-5s',
    'edit-then-query-60s',
    'add-then-query',
    'delete-then-query',
    'large-file-3900-lines',
    'large-file-1.5mib',
    'index-age-24h',
  ].map((scenario) => ({ scenario, tool: 'ptah_code_search_symbols' })),
  { scenario: 'transport-restart', tool: 'ptah_search_files' },
];

/** The cases {@link runSessionScenarios} scores, in order. */
export const SESSION_SCENARIOS: readonly { scenario: string; tool: string }[] =
  [
    { scenario: 'two-workspaces-memory-leak', tool: 'ptah_memory_search' },
    { scenario: 'worktree-memory-scope', tool: 'ptah_memory_search' },
    { scenario: 'worktree-spool-path', tool: 'ptah_memory_search' },
    {
      scenario: 'two-workspaces-symbol-scope',
      tool: 'ptah_code_search_symbols',
    },
    { scenario: 'transport-idle-gaps', tool: 'ptah_search_files' },
    { scenario: 'worktree-task-tools', tool: 'ptah_task_create' },
  ];

/**
 * Failed rows for the cases of `expected` that `got` lacks: a scenario that
 * could not run (its host never started, or a step broke) is a failure with
 * the reason, never a silent gap.
 */
export function unscoredScenarios(
  expected: readonly { scenario: string; tool: string }[],
  got: readonly LifecycleResult[],
  reason: string,
): LifecycleResult[] {
  const scored = new Set(got.map((item) => item.scenario));
  return expected
    .filter((item) => !scored.has(item.scenario))
    .map((item) => ({ ...item, pass: false, detail: `not run: ${reason}` }));
}

/** One scored case of the scorecard's `lifecycle[]`. */
export interface LifecycleResult {
  readonly scenario: string;
  readonly tool: string;
  readonly pass: boolean;
  readonly detail: string;
  /** Why the host cannot run the scenario; set means not run, not failed. */
  readonly na?: string;
}

/** A running bench host, as the scenarios drive it. */
export interface BenchSession {
  readonly workspaceRoot: string;
  /** Spawn to first `tools/list`; `null` when unknown. */
  readonly coldStartMs: number | null;
  /** The host's isolated SQLite file, or `null` when the host has none the bench can reach. */
  readonly dbPath: string | null;
  /** The keep-alive client of `workspaceRoot`. */
  readonly client: McpToolCaller;
  /** A client for another `/workspace/{root}` of the same server. */
  callerFor(workspaceRoot: string): McpToolCaller;
  /** Stops the host; resolves with how it ended. Guard errors reject. */
  stop(): Promise<{ readonly exit: HostExit }>;
}

export type HostLauncher = (workspaceRoot: string) => Promise<BenchSession>;

/** What the session scenarios need: everything but a launcher (they use the main host). */
export type SessionDeps = Omit<LifecycleDeps, 'launch'>;

export interface LifecycleDeps {
  readonly launch: HostLauncher;
  readonly sleep: (ms: number) => Promise<void>;
  readonly now: () => number;
  /** Shifts every `code_symbols.updated_at` in `dbPath` back by `ageMs`; returns the rows changed. */
  readonly backdateCodeSymbols: (
    dbPath: string,
    ageMs: number,
  ) => Promise<number>;
  /** `git` in `cwd`; rejects on a non-zero exit. */
  readonly git: (cwd: string, args: readonly string[]) => Promise<string>;
  readonly log: (line: string) => void;
}

/** A symbol of the corpus the scenarios ask for (a symbols-exact truth). */
export interface ProbeSymbol {
  readonly name: string;
  /** `file:line`, workspace-relative. */
  readonly location: string;
}

/**
 * The probe the scenarios ask for: the first symbols-exact truth of the
 * large-file stratum (a real symbol the index should hold), else the first
 * positive question.
 */
export function probeSymbolOf(
  questions: readonly {
    readonly query: string;
    readonly stratum: string;
    readonly truth: readonly string[];
  }[],
): ProbeSymbol {
  const question =
    questions.find(
      (item) => item.stratum === 'large' && item.truth.length > 0,
    ) ?? questions.find((item) => item.truth.length > 0);
  if (question === undefined)
    throw new Error(
      'symbols-exact.json holds no positive question for the lifecycle probe',
    );
  return { name: question.query, location: question.truth[0] };
}

export interface LifecycleOptions {
  /** `--smoke`: shorter waits and 40 instead of 200 transport calls. */
  readonly smoke: boolean;
  readonly probe: ProbeSymbol;
  /** Unique per run; part of every symbol the scenarios write. */
  readonly tag: string;
}

const SCENARIO_DIR = 'libs/mcp-bench-lifecycle';

const timeouts = (smoke: boolean) => ({
  coldStartMs: smoke ? 120_000 : 300_000,
  settleMs: 60_000,
  refreshMs: smoke ? 120_000 : 300_000,
  transportCalls: smoke ? 40 : 200,
});

async function writeScenarioFile(
  root: string,
  name: string,
  content: string,
): Promise<string> {
  await mkdir(join(root, SCENARIO_DIR), { recursive: true });
  await writeFile(join(root, SCENARIO_DIR, name), content, 'utf8');
  return `${SCENARIO_DIR}/${name}`;
}

/** A TS file of `lines` lines ending in `export function <name>`. */
export function largeTsFile(name: string, lines: number): string {
  const body = Array.from(
    { length: Math.max(0, lines - 3) },
    (_, index) => `export const filler${index} = ${index};`,
  );
  return [
    ...body,
    `export function ${name}(): number {`,
    '  return 1;',
    '}',
    '',
  ].join('\n');
}

/** Appended when a positive hit under unknown coverage is what made the case pass. */
const FOUND_UNDER_UNKNOWN = ' (found under unknown coverage)';

function noteUnknownHit(decided: boolean): string {
  return decided ? FOUND_UNDER_UNKNOWN : '';
}

/** A TS file of at least `bytes` bytes ending in `export function <name>`. */
export function paddedTsFile(name: string, bytes: number): string {
  const line = `// ${'x'.repeat(1_020)}\n`;
  return `${line.repeat(Math.ceil(bytes / line.length))}export function ${name}(): number {\n  return 1;\n}\n`;
}

/**
 * Scenarios 1-6 and the restart half of 8, on `copyRoot` (a disposable copy
 * of the corpus). Launches its own hosts; returns the scored cases and how
 * each host ended.
 */
export async function runCopyScenarios(
  copyRoot: string,
  deps: LifecycleDeps,
  options: LifecycleOptions,
  /** Receives each result as it is scored, so a later throw keeps them. */
  results: LifecycleResult[] = [],
): Promise<{ results: LifecycleResult[]; exits: HostExit[] }> {
  const limits = timeouts(options.smoke);
  const exits: HostExit[] = [];
  const tool = 'ptah_code_search_symbols';
  const probeFile = options.probe.location.replace(/:\d+$/, '');
  const session = await deps.launch(copyRoot);
  const search = (name: string, file: string) => () =>
    searchSymbol(session.client, copyRoot, name, file);
  try {
    // 1. Cold start: fresh process, no DB.
    deps.log('[lifecycle] 1 cold-start');
    const cold = await pollUntil(
      deps,
      limits.coldStartMs,
      search(options.probe.name, probeFile),
      (probe) => probe.found,
    );
    results.push({
      scenario: 'cold-start',
      tool,
      pass: cold.ok,
      detail: `${session.coldStartMs === null ? '' : `boot ${Math.round(session.coldStartMs)} ms; `}${cold.ok ? `first correct answer for ${options.probe.name} after ${cold.elapsedMs} ms` : `no correct answer for ${options.probe.name} within ${limits.coldStartMs / 1000} s`}; reindexInFlight false first seen ${cold.settledAtMs === null ? 'never (within the wait)' : `after ${cold.settledAtMs} ms`}; states: ${states(cold.states)}${noteUnknownHit(cold.ok && cold.last.underUnknownCoverage)}`,
    });

    // 2. Edit then query, within 5 s and within 60 s.
    deps.log('[lifecycle] 2 edit-then-query');
    const edited = `benchEdited_${options.tag}`;
    await writeFile(
      join(copyRoot, probeFile),
      `\nexport function ${edited}(): number {\n  return 2;\n}\n`,
      { encoding: 'utf8', flag: 'a' },
    );
    const editedAt = deps.now();
    await deps.sleep(5_000);
    const at5 = await searchSymbol(session.client, copyRoot, edited, probeFile);
    results.push({
      scenario: 'edit-then-query-5s',
      tool,
      pass: at5.found,
      detail: `${edited} appended to ${probeFile}; at 5 s: ${at5.found ? 'found' : `not found (${at5.state})`}${noteUnknownHit(at5.underUnknownCoverage)}`,
    });
    await deps.sleep(Math.max(0, limits.settleMs - (deps.now() - editedAt)));
    const at60 = await searchSymbol(
      session.client,
      copyRoot,
      edited,
      probeFile,
    );
    results.push({
      scenario: 'edit-then-query-60s',
      tool,
      pass: at60.found,
      detail: `at 60 s: ${at60.found ? 'found' : `not found (${at60.state})`}${noteUnknownHit(at60.underUnknownCoverage)}`,
    });

    // 3. Add then query.
    deps.log('[lifecycle] 3 add-then-query');
    const added = `benchAdded_${options.tag}`;
    const addedFile = await writeScenarioFile(
      copyRoot,
      `added-${options.tag}.ts`,
      `export function ${added}(): number {\n  return 3;\n}\n`,
    );
    const add = await pollUntil(
      deps,
      limits.settleMs,
      search(added, addedFile),
      (probe) => probe.found,
    );
    results.push({
      scenario: 'add-then-query',
      tool,
      pass: add.ok,
      detail: `${addedFile}: ${add.ok ? `found after ${add.elapsedMs} ms` : `not found within ${limits.settleMs / 1000} s`}; states: ${states(add.states)}${noteUnknownHit(add.ok && add.last.underUnknownCoverage)}`,
    });

    // 4. Delete then query: the symbol must disappear.
    deps.log('[lifecycle] 4 delete-then-query');
    if (!add.ok) {
      results.push({
        scenario: 'delete-then-query',
        tool,
        pass: false,
        detail: `precondition failed: ${added} was never indexed, so its removal cannot be observed`,
      });
    } else {
      await rm(join(copyRoot, addedFile), { force: true });
      const gone = await pollUntil(
        deps,
        limits.settleMs,
        search(added, addedFile),
        (probe) => !probe.errored && !probe.found,
      );
      results.push({
        scenario: 'delete-then-query',
        tool,
        pass: gone.ok,
        detail: `${addedFile} deleted; ${gone.ok ? `gone after ${gone.elapsedMs} ms` : `still answered after ${limits.settleMs / 1000} s`}; states: ${states(gone.states)}`,
      });
    }

    // 5. Large files: 3,900 lines (indexable) and 1.5 MiB (over the 1 MiB cap: fail honestly or succeed).
    deps.log('[lifecycle] 5 large-file');
    const long = `benchLarge3900_${options.tag}`;
    const longFile = await writeScenarioFile(
      copyRoot,
      `large-3900-${options.tag}.ts`,
      largeTsFile(long, 3_900),
    );
    const big = `benchLargeMib_${options.tag}`;
    const bigFile = await writeScenarioFile(
      copyRoot,
      `large-mib-${options.tag}.ts`,
      paddedTsFile(big, 1.5 * 1024 * 1024),
    );
    const longProbe = await pollUntil(
      deps,
      limits.settleMs,
      search(long, longFile),
      (probe) => probe.found,
    );
    results.push({
      scenario: 'large-file-3900-lines',
      tool,
      pass: longProbe.ok,
      detail: `${longFile}: ${longProbe.ok ? 'found' : 'not found'} (symbol on line 3,898); states: ${states(longProbe.states)}${noteUnknownHit(longProbe.ok && longProbe.last.underUnknownCoverage)}`,
    });
    const bigProbe = await searchSymbol(session.client, copyRoot, big, bigFile);
    // A hit under unknown coverage is not proof the over-cap file was indexed.
    const bigIndexed = bigProbe.found && !bigProbe.underUnknownCoverage;
    const reindex = await session.client.callTool('ptah_code_reindex', {
      filePath: join(copyRoot, bigFile),
    });
    const reindexText =
      reindex.kind === 'result' ? reindex.text : describeOutcome(reindex);
    const honest = /too[- ]large|exceeds/i.test(
      `${bigProbe.text}\n${reindexText}`,
    );
    results.push({
      scenario: 'large-file-1.5mib',
      tool,
      pass: bigIndexed || honest,
      detail: `${bigFile}: ${bigIndexed ? 'found' : honest ? 'not indexed, reported as too large' : 'not found and not reported as too large'}; reindex: ${reindexText.slice(0, 160)}`,
    });

    // 6. Index age beyond 24 h: backdate the rows, check the lazy refresh and its cap.
    deps.log('[lifecycle] 6 index-age');
    results.push(
      await indexAgeScenario(
        session,
        copyRoot,
        deps,
        options,
        limits.refreshMs,
        probeFile,
      ),
    );

    // 8 (restart half): stop the host under an in-flight call, then boot a fresh one.
    deps.log('[lifecycle] 8 transport-restart');
    const inFlight = session.client.callTool('ptah_relevance_rank_files', {
      query: 'transport restart probe',
    });
    const [flight, stopped] = await Promise.all([inFlight, session.stop()]);
    exits.push(stopped.exit);
    const restarted = await deps.launch(copyRoot);
    await runThenStop(
      async () => {
        exits.push((await restarted.stop()).exit);
      },
      async () => {
        const after = await restarted.client.callTool('ptah_search_files', {
          pattern: 'package.json',
          limit: 5,
        });
        results.push({
          scenario: 'transport-restart',
          tool: 'ptah_search_files',
          pass: after.kind === 'result' && !after.isError,
          detail: `in-flight call during stop: ${describeOutcome(flight)}${flight.kind === 'transport-error' && flight.code === 'ECONNRESET' ? ' (ECONNRESET)' : ''}; host exit ${stopped.exit.kind}; fresh host answered: ${describeOutcome(after)}`,
        });
      },
    );
    return { results, exits };
  } catch (error: unknown) {
    // Stop the scenario host if it still runs (stop is idempotent). A guard
    // error from that stop outranks the scenario error: it voids the run.
    return stopThenRethrow(() => session.stop(), error);
  }
}

/** Run inputs of {@link runSessionScenarios}. */
export interface SessionScenarioOptions extends LifecycleOptions {
  /** The memory roots of the main host (workspace B is also the symbol-scope probe). */
  readonly memoryRoots: MemorySeedRoots;
  /**
   * Whether the host seeded the memory ground truth into those roots. When it
   * did not (Electron: no seeding hook), the memory scenarios are `na` with
   * this reason instead of scoring an empty store.
   */
  readonly memoryNaReason?: string;
  /** A private temp folder for the scenario 9 repository (removed by the caller). */
  readonly scratchDir: string;
}

/** Scenarios 7, 8 (idle gaps) and 9 on the run's main host. */
export async function runSessionScenarios(
  session: BenchSession,
  deps: SessionDeps,
  options: SessionScenarioOptions,
  /** Receives each result as it is scored, so a later throw keeps them. */
  results: LifecycleResult[] = [],
): Promise<LifecycleResult[]> {
  deps.log('[lifecycle] 7 two-workspaces-worktree');
  if (options.memoryNaReason === undefined) {
    results.push(...(await memoryScopeScenarios(session, options.memoryRoots)));
    results.push(
      await spoolPathScenario(session, options.memoryRoots.worktreeOfA),
    );
  } else
    results.push(
      ...naScenarios(
        SESSION_SCENARIOS.filter((item) =>
          MEMORY_SEEDED_SCENARIOS.includes(item.scenario),
        ),
        options.memoryNaReason,
      ),
    );
  results.push(
    await symbolScopeScenario(
      session,
      options.memoryRoots.rootB,
      options.probe,
    ),
  );
  deps.log('[lifecycle] 8 transport-idle-gaps');
  results.push(
    await idleGapScenario(
      session,
      deps,
      timeouts(options.smoke).transportCalls,
    ),
  );
  deps.log('[lifecycle] 9 worktree-task-tools');
  results.push(
    await worktreeTaskScenario(session, deps, options.scratchDir, options.tag),
  );
  return results;
}

/** Ten facts per root, asked from A, from B and from the worktree of A. */
async function memoryScopeScenarios(
  session: BenchSession,
  roots: MemorySeedRoots,
): Promise<LifecycleResult[]> {
  const set = buildMemoryQuestionSet();
  const rowRoot = new Map<string, 'A' | 'B'>();
  for (const fact of set.facts)
    for (const row of fact.rows) rowRoot.set(row.content.trim(), fact.root);
  const questions = set.questions
    .filter(
      (q) => q.abstain !== true && q.scorable !== false && q.id.endsWith('-v'),
    )
    .slice(0, 20);
  let leaks = 0;
  let asked = 0;
  let errors = 0;
  for (const question of questions) {
    const root = question.scope === '<rootB>' ? roots.rootB : roots.rootA;
    const expected = question.scope === '<rootB>' ? 'B' : 'A';
    const contents = await memoryContents(
      session.callerFor(root),
      question.query,
      root,
    );
    if (contents === null) {
      errors += 1;
      continue;
    }
    asked += 1;
    leaks += contents.filter(
      (content) => (rowRoot.get(content) ?? expected) !== expected,
    ).length;
  }
  const worktreeQuestions = set.questions.filter(
    (q) => q.scope === '<worktreeOfA>' && q.abstain !== true,
  );
  let worktreeHits = 0;
  for (const question of worktreeQuestions) {
    const contents = await memoryContents(
      session.callerFor(roots.worktreeOfA),
      question.query,
      roots.worktreeOfA,
    );
    const truth = new Set(
      set.facts.flatMap((fact) =>
        fact.rows
          .filter((row) => question.expectedFactIds.includes(row.id))
          .map((row) => row.content.trim()),
      ),
    );
    if (
      contents !== null &&
      contents.slice(0, 5).some((content) => truth.has(content))
    )
      worktreeHits += 1;
  }
  return [
    {
      scenario: 'two-workspaces-memory-leak',
      tool: 'ptah_memory_search',
      pass: leaks === 0 && errors === 0 && asked > 0,
      detail: `${asked} verbatim queries from roots A and B; leak count ${leaks} (expected 0); errors ${errors}`,
    },
    {
      scenario: 'worktree-memory-scope',
      tool: 'ptah_memory_search',
      pass: worktreeHits === worktreeQuestions.length,
      detail: `queries from the worktree of A found A's fact in the top 5 for ${worktreeHits} of ${worktreeQuestions.length} (read-side worktree mapping, Phase 2 Fix 7)`,
    },
  ];
}

async function memoryContents(
  caller: McpToolCaller,
  query: string,
  root: string,
): Promise<string[] | null> {
  const outcome = await caller.callTool('ptah_memory_search', {
    query,
    maxResults: 10,
  });
  if (
    outcome.kind !== 'result' ||
    classifyToolResult(outcome.text, outcome.isError, root).errorClass !== null
  )
    return null;
  try {
    return parseMemoryContents(outcome.text);
  } catch (error: unknown) {
    if (error instanceof ToolResultParseError) return null;
    throw error;
  }
}

/** A result over the output budget, asked from the worktree: its spool file must land under the worktree. */
async function spoolPathScenario(
  session: BenchSession,
  worktree: string,
): Promise<LifecycleResult> {
  const recorder = new CallRecorder(session.callerFor(worktree), {
    workspaceRoot: worktree,
  });
  const { final } = await recorder.answer('ptah_memory_search', {
    query: 'project facts',
    maxResults: 50,
    global: true,
  });
  const truncation = final.truncation;
  return {
    scenario: 'worktree-spool-path',
    tool: 'ptah_memory_search',
    pass: truncation !== null && truncation.spoolUnderWorkspace === true,
    detail:
      truncation === null
        ? `the result (${final.text.length} chars, ${final.errorClass ?? 'ok'}) was not spooled, so the spool path could not be observed`
        : `spooled to ${truncation.spoolPath ?? truncation.spoolLocator ?? 'nowhere'}; under the caller's root (${worktree}): ${String(truncation.spoolUnderWorkspace)}`,
  };
}

/** A symbol search declared for workspace B must not answer with the corpus's symbols. */
async function symbolScopeScenario(
  session: BenchSession,
  rootB: string,
  probe: ProbeSymbol,
): Promise<LifecycleResult> {
  const result = await searchSymbol(
    session.callerFor(rootB),
    rootB,
    probe.name,
    probe.location.replace(/:\d+$/, ''),
  );
  return {
    scenario: 'two-workspaces-symbol-scope',
    tool: 'ptah_code_search_symbols',
    pass: !result.errored && result.hits === 0,
    detail: result.errored
      ? `no clean answer from workspace B: ${result.state}`
      : `workspace B (no indexed file) got ${result.hits} hits for ${probe.name} (expected 0)`,
  };
}

/** N calls with 4-8 s idle gaps on the main host's keep-alive connection. */
async function idleGapScenario(
  session: BenchSession,
  deps: SessionDeps,
  calls: number,
): Promise<LifecycleResult> {
  const random = mulberry32(6190908);
  const codes = new Map<string, number>();
  let resets = 0;
  for (let index = 0; index < calls; index += 1) {
    if (index > 0) await deps.sleep(4_000 + Math.floor(random() * 4_000));
    const outcome = await session.client.callTool('ptah_search_files', {
      pattern: 'package.json',
      limit: 5,
    });
    if (outcome.kind === 'transport-error') {
      codes.set(outcome.code, (codes.get(outcome.code) ?? 0) + 1);
      if (outcome.code === 'ECONNRESET') resets += 1;
    }
  }
  const failed = [...codes.values()].reduce((sum, count) => sum + count, 0);
  return {
    scenario: 'transport-idle-gaps',
    tool: 'ptah_search_files',
    pass: failed === 0,
    detail: `${calls} calls with 4-8 s idle gaps on one keep-alive connection; ECONNRESET ${resets}; transport errors ${failed === 0 ? 0 : [...codes.entries()].map(([code, count]) => `${code} ${count}`).join(', ')}`,
  };
}

/**
 * Scenario 9: `ptah_task_create` with `workspaceRoot` = a git worktree must
 * write under the worktree's `.ptah/specs` and leave the main checkout's
 * listing unchanged; a `workspaceRoot` outside the repository must be refused.
 * The repository is created under `scratchDir`, never the real one.
 */
async function worktreeTaskScenario(
  session: BenchSession,
  deps: SessionDeps,
  scratchDir: string,
  tag: string,
): Promise<LifecycleResult> {
  const main = join(scratchDir, 'task-repo');
  const worktree = join(scratchDir, 'task-worktree');
  const outside = join(scratchDir, 'outside');
  await mkdir(main, { recursive: true });
  await mkdir(outside, { recursive: true });
  await deps.git(main, ['init']);
  await deps.git(main, ['config', 'user.email', 'bench@example.test']);
  await deps.git(main, ['config', 'user.name', 'MCP Bench']);
  await writeFile(join(main, 'README.md'), '# scenario 9\n', 'utf8');
  await deps.git(main, ['add', 'README.md']);
  await deps.git(main, ['commit', '-m', 'scenario 9']);
  await deps.git(main, ['worktree', 'add', '-b', `bench-${tag}`, worktree]);

  const listing = async (root: string): Promise<string[]> =>
    readdir(join(root, '.ptah', 'specs')).catch(() => []);
  const mainBefore = await listing(main);
  const caller = session.callerFor(main);
  const created = await caller.callTool('ptah_task_create', {
    title: `scenario 9 ${tag}`,
    type: 'BUGFIX',
    workspaceRoot: worktree,
  });
  const inWorktree = await listing(worktree);
  const mainAfter = await listing(main);
  const mainUnchanged =
    mainAfter.length === mainBefore.length &&
    mainAfter.every((name) => mainBefore.includes(name));
  const refusedOutside = await caller.callTool('ptah_task_create', {
    title: `scenario 9 outside ${tag}`,
    type: 'BUGFIX',
    workspaceRoot: outside,
  });
  const refused =
    refusedOutside.kind === 'result' &&
    (refusedOutside.isError || /"ok"\s*:\s*false/.test(refusedOutside.text));
  const landed = inWorktree.length > 0;
  return {
    scenario: 'worktree-task-tools',
    tool: 'ptah_task_create',
    pass: landed && mainUnchanged && refused,
    detail: `create with workspaceRoot=worktree: ${describeOutcome(created)}; task folder under the worktree: ${landed ? inWorktree.join(', ') : 'none'}; main checkout listing ${mainUnchanged ? 'unchanged' : `changed (${mainAfter.filter((name) => !mainBefore.includes(name)).join(', ')})`}; workspaceRoot outside the repository ${refused ? 'refused' : 'accepted'}`,
  };
}
