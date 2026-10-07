/**
 * The MCP benchmark CLI (batches.md Task 9.3). Bundled by `mcp-bench:build-bench`
 * and run from the workspace root by the `bench` and `generate` targets:
 *
 *   node dist/tools/mcp-bench/bench.mjs bench [--host cli-headless|electron]
 *     [--electron-mode launch|attach] [--suite <id>[,<id>…]] [--smoke]
 *     [--out <dir>] [--compare <baseline scorecard.json>] [--noise-margin <n>]
 *   node dist/tools/mcp-bench/bench.mjs generate [--only ts,file-tools,memory,relevance]
 *     [--out <dir>] [--scip-index <corpusId>=<index.scip>]
 *
 * `bench` checks out the pinned corpus (`withPinnedCorpus`), runs every native
 * baseline before any host exists, launches the host (isolated, guarded),
 * asks every suite's questions over the MCP transport, runs the lifecycle
 * scenarios, and writes `scorecard.json` and `scorecard.md`. The run metadata
 * comes from the hosts' stop reports: `run.guardMode`, `run.guard` (partial
 * and the unprobed processes) and `run.hostExit` (a crash on shutdown is a
 * run-level fact, never a suite error).
 *
 * A host that fails to start (after one retry), a broken baseline or a broken
 * scenario fails only what it covers, with the reason; the scorecard is
 * always written. Exit codes: 0 when the scorecard was written and nothing
 * failed to run, whatever the verdicts (gate decisions belong to Batch 10);
 * 2 when the scorecard was written but a host, baseline or scenario failed to
 * run; 1 when the run itself broke; 3 when the isolation failed (the guard tripped: the run is void and
 * no scorecard is written); 4 when the environment refused the run (a
 * concurrent writer under `CI=true`), which is never retried.
 */

import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import ts from 'typescript';
import { z } from 'zod';

import { createCheckedRgRunner } from './baselines/rg-runner';
import type { NativeContext } from './baselines/native-baselines';
import {
  backdateCodeSymbols,
  benchProjectRoot,
  readPolyglotConfig,
  createMemoryRoots,
  hostLaunchRows,
  polyglotCheckout,
  runMetadata,
  startHost,
  type HostRecord,
  type HostTarget,
  type RunningHost,
} from './bench-hosts';
import {
  readCorpusConfig,
  withLifecycleCorpus,
  withPinnedCorpus,
} from './corpus/corpus';
import { naScenarios } from './lifecycle/lifecycle-na';
import {
  COPY_SCENARIOS,
  SESSION_SCENARIOS,
  probeSymbolOf,
  unscoredScenarios,
  runCopyScenarios,
  runSessionScenarios,
  type SessionDeps,
  type LifecycleResult,
} from './lifecycle/lifecycle-scenarios';
import {
  readScorecard,
  scorecardBaselineDirectory,
  scorecardOutputDirectory,
  writeScorecardJson,
  writeScorecardMarkdown,
} from './scorecard/scorecard-writers';
import type { Scorecard, ScorecardSuite } from './scorecard/scorecard.types';
import { GATE_USAGE, runGateCommand } from './gate/gate-command';
import { loadNoiseMargins, marginFor, suiteMarginKey } from './gate/gate';
import { generateOptionsSchema, runGenerate } from './generate';
import { loadQuestionBank, type QuestionBank } from './suites/question-sets';
import {
  applyLifecycleVerdicts,
  assembleSuite,
  runNativeBaselines,
  runToolQuestions,
  type NativeOutcomes,
  type ToolOutcome,
  type ToolSuiteDefinition,
} from './suites/suite-runner';
import {
  SMOKE_QUESTIONS,
  buildPolyglotSuites,
  buildTsSuites,
} from './suites/tool-suites';
import { ATTACH_MODE_NA_REASON } from './transport/electron-host';
import { isGuardError, runThenStop } from './transport/guarded-stop';
import { removeTempDir } from './transport/temp-cleanup';
import { HostLaunchError } from './transport/host-launcher';
import {
  BenchHeldRealStateError,
  ConcurrentWriterError,
  RealStateChangedError,
} from './transport/real-state-guard';

const execFileAsync = promisify(execFile);
type AnySuite = ToolSuiteDefinition<{ readonly id: string }>;

// ---------------------------------------------------------------------------
// arguments
// ---------------------------------------------------------------------------

const benchOptionsSchema = z.object({
  host: z.enum(['cli-headless', 'electron']).default('cli-headless'),
  'electron-mode': z.enum(['launch', 'attach']).default('launch'),
  suite: z.string().min(1).optional(),
  smoke: z.boolean().default(false),
  out: z.string().min(1).optional(),
  compare: z.string().min(1).optional(),
  'noise-margin': z.coerce.number().min(0).max(1).optional(),
});
export type BenchOptions = z.infer<typeof benchOptionsSchema>;

const BOOLEAN_FLAGS = new Set(['smoke', 'write']);
const REPEATED_FLAGS = new Set(['scip-index']);

/**
 * `--key value`, `--key=value`, `--flag` and `--flag=true|false` (the forms
 * an Nx `run-commands` target forwards). Unknown keys are refused by the
 * command's schema, so a typo never runs a different benchmark.
 */
export function parseArgs(argv: readonly string[]): {
  command: string;
  flags: Record<string, unknown>;
} {
  const [command = 'help', ...rest] = argv;
  const flags: Record<string, unknown> = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith('--'))
      throw new Error(`unexpected argument: ${token}`);
    const [rawKey, inline] = token.slice(2).split(/=(.*)/s, 2);
    const key = rawKey.trim();
    let value: unknown = inline;
    if (BOOLEAN_FLAGS.has(key))
      value = inline === undefined ? true : inline !== 'false';
    else if (value === undefined) {
      value = rest[index + 1];
      index += 1;
      if (value === undefined) throw new Error(`--${key} needs a value`);
    }
    if (REPEATED_FLAGS.has(key))
      flags[key] = [...((flags[key] as string[] | undefined) ?? []), value];
    else flags[key] = value;
  }
  return { command, flags };
}

function strictParse<T extends z.ZodRawShape>(
  schema: z.ZodObject<T>,
  flags: Record<string, unknown>,
) {
  const parsed = schema.strict().safeParse(flags);
  if (!parsed.success)
    throw new Error(
      parsed.error.issues
        .map((issue) =>
          issue.code === z.ZodIssueCode.unrecognized_keys
            ? `unknown flag ${issue.keys.map((key) => `--${key}`).join(', ')}`
            : `--${issue.path.join('.')}: ${issue.message}`,
        )
        .join('; '),
    );
  return parsed.data;
}

// ---------------------------------------------------------------------------
// shared helpers
// ---------------------------------------------------------------------------

const log = (line: string): void => {
  process.stderr.write(`${line}\n`);
};

async function git(
  cwd: string,
  args: readonly string[],
  timeoutMs = 120_000,
): Promise<string> {
  const { stdout } = await execFileAsync('git', [...args], {
    cwd,
    timeout: timeoutMs,
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout.trim();
}

const sleep = (ms: number): Promise<void> =>
  new Promise((done) => setTimeout(done, ms));

// ---------------------------------------------------------------------------
// bench
// ---------------------------------------------------------------------------

function selectSuites(
  all: readonly AnySuite[],
  filter: readonly string[] | null,
): AnySuite[] {
  if (filter === null) return [...all];
  return all.filter((suite) =>
    filter.some(
      (item) =>
        item === suite.id ||
        item === suite.tool ||
        (item === 'polyglot' && /-(python|go)-/.test(`${suite.id}-`)),
    ),
  );
}

interface SuiteRun {
  readonly definition: AnySuite;
  readonly natives: NativeOutcomes;
  tools: ReadonlyMap<string, ToolOutcome> | null;
  listed: ReadonlySet<string>;
  /** Why the suite could not be measured; it then fails with this reason. */
  failure?: string;
}

/** A guard error voids the run: it is never caught into a suite failure. */
const isVoidingError = isGuardError;

function errorText(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 600);
}

async function askSuites(
  runs: readonly SuiteRun[],
  host: RunningHost,
  corpusRoot: string,
): Promise<void> {
  for (const run of runs) {
    run.listed = host.listedTools;
    run.tools = await runToolQuestions(run.definition, {
      listedTools: host.listedTools,
      callerFor: host.callerFor,
      corpusRoot,
      log,
    });
  }
}

async function runBench(options: BenchOptions): Promise<number> {
  const root = benchProjectRoot();
  const margins = await loadNoiseMargins(
    scorecardBaselineDirectory(root),
    options.host,
    options.smoke,
  );
  if (margins === null) log('[bench] no stored noise margins: default applies');
  const configPath = join(root, 'corpus.config.json');
  const startedAt = new Date().toISOString();
  const runId = `${startedAt.replace(/[:.]/g, '-')}-${options.host}`;
  const rg = await createCheckedRgRunner();
  const config = await readCorpusConfig(configPath);
  const polyglot = await readPolyglotConfig(configPath);
  const bank = loadQuestionBank(root, config.commit);
  const repoRoot = resolve(root, config.repository);
  const filter =
    options.suite
      ?.split(',')
      .map((item) => item.trim())
      .filter(Boolean) ?? null;
  const wantLifecycle = filter === null || filter.includes('lifecycle');
  const sample = options.smoke ? SMOKE_QUESTIONS : null;
  const probe = probeSymbolOf(bank.symbolsExact.questions);
  const tag = startedAt.replace(/\D/g, '').slice(0, 14);
  const sessionDeps: SessionDeps = {
    sleep,
    now: () => Date.now(),
    backdateCodeSymbols,
    git: (cwd, args) => git(cwd, args),
    log,
  };
  const scratch = await mkdtemp(join(tmpdir(), 'ptah-mcp-bench-run-'));
  const hosts: HostRecord[] = [];
  const target: HostTarget = {
    host: options.host,
    electronMode: options['electron-mode'],
  };
  // Attach mode drives a user's own app: it never writes state, so every
  // lifecycle scenario (they edit files, seed memory, backdate a DB) is `na`.
  const attached =
    options.host === 'electron' && options['electron-mode'] === 'attach';
  const runsLifecycle = wantLifecycle && !attached;
  // Failures that did not void the run: each is in the scorecard, and any of
  // them makes the exit code 2 once the scorecard is written.
  const problems: string[] = [];
  /** The reason a host never started (its launch failures are on its record); rethrows a guard error. */
  const hostFailed = (label: string, error: unknown): string => {
    if (!(error instanceof HostLaunchError)) throw error;
    const exit = error.exit;
    const reason = `host ${label} failed to start (${exit.kind}, exit ${exit.exitCode ?? exit.signal ?? 'none'}${exit.detail ? `: ${exit.detail}` : ''}): ${errorText(error)}`;
    problems.push(reason);
    return reason;
  };
  try {
    const scorecard = await withPinnedCorpus(configPath, async (corpus) => {
      const native: NativeContext = {
        corpusRoot: corpus.path,
        rg,
        gitRoot: repoRoot,
        corpusCommit: config.commit,
      };
      // Roots exist on every launched host (workspace B is also the symbol-scope
      // probe); only cli-headless seeds memory into them.
      const memoryRoots = attached
        ? null
        : await createMemoryRoots(scratch, git);
      const context = { corpusRoot: corpus.path, native, sample };
      const build = (
        listed: ReadonlySet<string>,
        memoryNa: string | null,
      ): AnySuite[] =>
        selectSuites(
          buildTsSuites(bank, context, {
            listedTools: listed,
            memory: {
              roots: memoryNa === null ? memoryRoots : null,
              naReason: memoryNa ?? undefined,
              native,
            },
          }),
          filter,
        );
      // Phase 1: native baselines, before any host exists. A baseline that
      // breaks fails its suite with the reason; the run goes on.
      const assumed = build(
        new Set(['ptah_search_text']),
        memoryRoots === null ? 'memory seeding unavailable' : null,
      );
      const nativeById = new Map<string, NativeOutcomes>();
      const nativeFailures = new Map<string, string>();
      const measureNatives = async (
        definition: AnySuite,
      ): Promise<NativeOutcomes> => {
        try {
          return await runNativeBaselines(definition, log);
        } catch (error: unknown) {
          const reason = `native baseline broke: ${errorText(error)}`;
          nativeFailures.set(definition.id, reason);
          problems.push(`${definition.id}: ${reason}`);
          return new Map();
        }
      };
      for (const definition of assumed)
        nativeById.set(definition.id, await measureNatives(definition));

      const polyglotRuns: {
        id: string;
        root: string | null;
        gitRoot: string | null;
        runs: SuiteRun[];
      }[] = [];
      for (const entry of polyglot) {
        const set = bank.polyglot.find((item) => item.corpusId === entry.id);
        if (set === undefined) continue;
        const selected = selectSuites(
          buildPolyglotSuites(set, { corpusRoot: '', native, sample }),
          filter,
        );
        if (selected.length === 0) continue;
        let checkout: { root: string; gitRoot: string };
        try {
          checkout = await polyglotCheckout(entry, scratch, git, log);
        } catch (error: unknown) {
          const reason = `the ${entry.id} corpus could not be checked out: ${errorText(error)}`;
          problems.push(reason);
          polyglotRuns.push({
            id: entry.id,
            root: null,
            gitRoot: null,
            runs: selected.map((definition) => ({
              definition,
              natives: new Map(),
              tools: null,
              listed: new Set(),
              failure: reason,
            })),
          });
          continue;
        }
        const polyNative: NativeContext = {
          corpusRoot: checkout.root,
          rg,
          gitRoot: checkout.gitRoot,
          corpusCommit: entry.commit,
        };
        const runs: SuiteRun[] = [];
        for (const definition of selectSuites(
          buildPolyglotSuites(set, {
            corpusRoot: checkout.root,
            native: polyNative,
            sample,
          }),
          filter,
        ))
          runs.push({
            definition,
            natives: await measureNatives(definition),
            tools: null,
            listed: new Set(),
            failure: nativeFailures.get(definition.id),
          });
        polyglotRuns.push({
          id: entry.id,
          root: checkout.root,
          gitRoot: checkout.gitRoot,
          runs,
        });
      }

      // Phase 2: the main host on the pinned corpus.
      const lifecycle: LifecycleResult[] = [];
      let runs: SuiteRun[] = [];
      const host = await startHost(
        target,
        corpus.path,
        'main',
        hosts,
        memoryRoots,
        log,
      ).catch((error: unknown) => hostFailed('main', error));
      if (typeof host === 'string') {
        runs = build(new Set(['ptah_search_text']), null).map((definition) => ({
          definition,
          natives: nativeById.get(definition.id) ?? new Map(),
          tools: null,
          listed: new Set(),
          failure: host,
        }));
        if (runsLifecycle)
          lifecycle.push(...unscoredScenarios(SESSION_SCENARIOS, [], host));
      } else {
        await runThenStop(
          () => host.stop(),
          async () => {
            const warmStart = performance.now();
            const warm = await host.client.callTool('ptah_memory_search', {
              query: 'bench warm-up',
              maxResults: 1,
            });
            lifecycle.push({
              scenario: 'embedder-warmup',
              tool: 'ptah_memory_search',
              pass: warm.kind === 'result' && !warm.isError,
              detail: `${Math.round(performance.now() - warmStart)} ms for the first embedding call (model download and load into the per-run temp home), measured apart and kept out of query latency; host boot ${host.coldStartMs === null ? 'n/a (attached)' : `${Math.round(host.coldStartMs)} ms`}`,
            });
            runs = build(host.listedTools, host.memoryNaReason).map(
              (definition) => ({
                definition,
                natives: nativeById.get(definition.id) ?? new Map(),
                tools: null,
                listed: host.listedTools,
                failure: nativeFailures.get(definition.id),
              }),
            );
            await askSuites(runs, host, corpus.path);
            if (runsLifecycle && memoryRoots !== null) {
              const session: LifecycleResult[] = [];
              try {
                await runSessionScenarios(
                  host,
                  sessionDeps,
                  {
                    smoke: options.smoke,
                    probe,
                    tag,
                    memoryRoots,
                    ...(host.memoryNaReason === null
                      ? {}
                      : { memoryNaReason: host.memoryNaReason }),
                    scratchDir: join(scratch, 'scenario9'),
                  },
                  session,
                );
              } catch (error: unknown) {
                if (isVoidingError(error)) throw error;
                const reason = `a session scenario broke: ${errorText(error)}`;
                problems.push(reason);
                session.push(
                  ...unscoredScenarios(SESSION_SCENARIOS, session, reason),
                );
              }
              lifecycle.push(...session);
            }
          },
        );
      }

      // Phase 3: the Python and Go corpora, one host each.
      for (const poly of polyglotRuns) {
        const { root: polyRoot, gitRoot: polyGitRoot } = poly;
        if (polyRoot === null || polyGitRoot === null) continue;
        const polyHost = await startHost(
          target,
          polyRoot,
          `polyglot ${poly.id}`,
          hosts,
          null,
          log,
        ).catch((error: unknown) => hostFailed(`polyglot ${poly.id}`, error));
        try {
          if (typeof polyHost === 'string') {
            for (const run of poly.runs) run.failure ??= polyHost;
          } else {
            await runThenStop(
              () => polyHost.stop(),
              () => askSuites(poly.runs, polyHost, polyRoot),
            );
          }
        } finally {
          // The per-run worktree of the cached clone; the scratch folder goes too.
          await git(polyGitRoot, [
            'worktree',
            'remove',
            '--force',
            polyRoot,
          ]).catch((error: unknown) =>
            log(`[polyglot] worktree cleanup failed: ${String(error)}`),
          );
        }
      }

      // Phase 4: lifecycle scenarios on a disposable copy, on every launched host.
      if (runsLifecycle) {
        const copyResults: LifecycleResult[] = [];
        try {
          await withLifecycleCorpus(corpus, (copy) =>
            runCopyScenarios(
              copy.path,
              {
                ...sessionDeps,
                launch: (workspace) =>
                  startHost(target, workspace, 'lifecycle', hosts, null, log),
              },
              { smoke: options.smoke, probe, tag },
              copyResults,
            ),
          );
        } catch (error: unknown) {
          if (isVoidingError(error)) throw error;
          const reason =
            error instanceof HostLaunchError
              ? hostFailed('lifecycle', error)
              : `a lifecycle step broke: ${errorText(error)}`;
          if (!(error instanceof HostLaunchError)) problems.push(reason);
          copyResults.push(
            ...unscoredScenarios(COPY_SCENARIOS, copyResults, reason),
          );
        }
        lifecycle.push(...copyResults);
      } else if (wantLifecycle) {
        log(`[lifecycle] na on electron attach: ${ATTACH_MODE_NA_REASON}`);
        lifecycle.push(
          ...naScenarios(
            [...SESSION_SCENARIOS, ...COPY_SCENARIOS],
            ATTACH_MODE_NA_REASON,
          ),
        );
      }
      lifecycle.push(...hostLaunchRows(hosts));

      const allRuns = [...runs, ...polyglotRuns.flatMap((poly) => poly.runs)];
      const suites: ScorecardSuite[] = applyLifecycleVerdicts(
        allRuns.flatMap((run) =>
          assembleSuite(run.definition, run.natives, run.tools, {
            listedTools: run.listed,
            noiseMargin: marginFor(
              margins,
              suiteMarginKey(
                run.definition.tool,
                run.definition.groundTruth.id,
              ),
              options['noise-margin'],
            ),
            ...(run.failure === undefined ? {} : { failure: run.failure }),
          }),
        ),
        lifecycle,
      );
      return buildScorecard(
        runId,
        startedAt,
        options,
        hosts,
        bank,
        corpus.eligibleFiles,
        config.commit,
        repoRoot,
        suites,
        lifecycle,
      );
    });
    const outDir = options.out
      ? resolve(options.out)
      : scorecardOutputDirectory(root, runId);
    const jsonPath = await writeScorecardJson(scorecard, outDir);
    const mdPath = await writeScorecardMarkdown(scorecard, outDir);
    log(`[bench] wrote ${jsonPath} and ${mdPath}`);
    if (options.compare)
      await writeComparison(scorecard, resolve(options.compare), outDir);
    for (const problem of problems) log(`[bench] failure recorded: ${problem}`);
    return problems.length > 0 ? 2 : 0;
  } finally {
    const left = await removeTempDir(scratch);
    if (left !== null) log(`[bench] ${left}`);
  }
}

async function buildScorecard(
  runId: string,
  startedAt: string,
  options: BenchOptions,
  hosts: readonly HostRecord[],
  bank: QuestionBank,
  eligibleFiles: number,
  corpusCommit: string,
  repoRoot: string,
  suites: ScorecardSuite[],
  lifecycle: LifecycleResult[],
): Promise<Scorecard> {
  const sets = [
    bank.symbolsExact,
    bank.symbolsConcept,
    bank.references,
    bank.definitions,
    bank.dependents,
    bank.relevance,
    bank.memory,
    bank.fileTools,
    ...bank.polyglot.map((set) => set.references),
  ];
  const remote = await git(repoRoot, [
    'config',
    '--get',
    'remote.origin.url',
  ]).catch(() => '');
  return {
    schemaVersion: 1,
    run: {
      id: runId,
      startedAt,
      host: options.host,
      os: process.platform === 'win32' ? 'win32' : 'linux',
      node: process.version,
      smoke: options.smoke,
      ...runMetadata(hosts),
    },
    product: {
      version:
        (
          JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as {
            version?: string;
          }
        ).version ?? 'unknown',
      commit: await git(repoRoot, ['rev-parse', 'HEAD']),
    },
    corpus: {
      repo: remote || repoRoot,
      commit: corpusCommit,
      eligibleFiles,
      tsVersion: ts.version,
    },
    artifacts: [
      ...sets.map((set) => ({
        kind: 'question-set',
        path: set.path,
        sha256: set.sha256,
        schemaId: `mcp-bench/questions/${set.groundTruth.id}@${set.groundTruth.version}`,
      })),
      {
        kind: 'question-set',
        path: bank.tsAgreement.path,
        sha256: bank.tsAgreement.sha256,
        schemaId: 'mcp-bench/questions/ts-agreement@1',
      },
    ],
    suites,
    lifecycle,
    eagerSelection: {
      eager: [],
      deferred: [],
      rule: 'not computed in Phase 1; Batch 37 derives it from the scorecard',
    },
  };
}

/** `--compare`: per suite, the verdict and every tool metric next to the baseline scorecard's. */
async function writeComparison(
  current: Scorecard,
  baselinePath: string,
  outDir: string,
): Promise<void> {
  const baseline = await readScorecard(baselinePath);
  const key = (suite: ScorecardSuite): string =>
    `${(suite.details as { tool: string }).tool} / ${suite.groundTruth.id}${suite.arm ? ` / ${suite.arm}` : ''}`;
  const before = new Map(baseline.suites.map((suite) => [key(suite), suite]));
  const lines = [
    `# Comparison: ${current.run.id} vs ${baseline.run.id}`,
    '',
    '| Suite | Verdict | Metric | Baseline | Current | Change |',
    '| --- | --- | --- | ---: | ---: | ---: |',
  ];
  for (const suite of current.suites) {
    const old = before.get(key(suite));
    const metrics = (
      suite.details as { metrics: Record<string, number | null> }
    ).metrics;
    const oldMetrics =
      (old?.details as { metrics?: Record<string, number | null> } | undefined)
        ?.metrics ?? {};
    for (const [metric, value] of Object.entries(metrics)) {
      const was = oldMetrics[metric];
      const change =
        value !== null && was !== null && was !== undefined
          ? Math.round((value - was) * 10_000) / 10_000
          : null;
      lines.push(
        `| ${key(suite)} | ${old?.verdict ?? 'new'} → ${suite.verdict} | ${metric} | ${was ?? 'na'} | ${value ?? 'na'} | ${change ?? 'na'} |`,
      );
    }
  }
  const path = join(outDir, 'compare.md');
  await writeFile(path, `${lines.join('\n')}\n`, 'utf8');
  log(`[bench] wrote ${path}`);
}

// ---------------------------------------------------------------------------
// entry
// ---------------------------------------------------------------------------

const USAGE = `usage:
  bench [--host cli-headless|electron] [--electron-mode launch|attach] [--suite <id|tool|lifecycle|polyglot>[,…]]
        [--smoke] [--out <dir>] [--compare <scorecard.json>] [--noise-margin <0..1>]
  ${GATE_USAGE}
  generate [--only ts,file-tools,memory,relevance] [--out <dir>] [--scip-index <corpusId>=<index.scip>]`;

async function main(argv: readonly string[]): Promise<number> {
  const { command, flags } = parseArgs(argv);
  if (command === 'bench')
    return runBench(strictParse(benchOptionsSchema, flags));
  if (command === 'generate')
    return runGenerate(strictParse(generateOptionsSchema, flags), log);
  const gated = await runGateCommand(
    command,
    flags,
    benchProjectRoot(),
    log,
    strictParse,
  );
  if (gated !== null) return gated;
  log(USAGE);
  return command === 'help' ? 0 : 1;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    if (
      error instanceof RealStateChangedError ||
      error instanceof BenchHeldRealStateError
    ) {
      log(
        `[bench] isolation failure, the run is void (no scorecard written): ${error.message}`,
      );
      process.exit(3);
    }
    if (error instanceof ConcurrentWriterError) {
      log(`[bench] environment failure (not retried): ${error.message}`);
      process.exit(4);
    }
    log(
      `[bench] the run broke: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
    );
    process.exit(1);
  },
);
