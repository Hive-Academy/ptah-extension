/**
 * TypeScriptDiagnosticsProvider — shared IDiagnosticsProvider for Electron/CLI.
 *
 * Uses the TypeScript compiler API (no `tsc` subprocess, no shell) to collect
 * config, syntactic, options, global, and semantic diagnostics from workspace
 * `tsconfig*.json` files. Returns an honest available/unavailable contract:
 *
 * - `unavailable` for no root, no tsconfig, malformed config, missing compiler,
 *   a dead type-check worker, or when no discovered config produced a single
 *   compilable program (so `available` + zero diagnostics can only ever mean
 *   "checked, and clean").
 * - `available` with zero diagnostics for a clean project.
 * - `available` with diagnostics for a project with errors — including an
 *   error entry per discovered config that could NOT be checked, so partial
 *   coverage is never delivered with the confidence of complete coverage.
 * - Throws only for genuine execution failures (e.g. a filesystem read error
 *   out of `findFiles`).
 *
 * **The compile does not run on the caller's thread** (TASK_2026_323, blocker
 * B3). `ts.createProgram` + `ts.getPreEmitDiagnostics` is a single synchronous
 * call with no yield point; on this monorepo it blocks for tens of seconds. In
 * Electron the caller IS the main process, so that stall froze the window and
 * back-pressured every agent subprocess — and the core prompt tells every agent
 * to call `ptah_get_diagnostics` first, with Codex/Copilot agents reaching it
 * through the HTTP MCP server on the same loop. Everything below the discovery
 * step is handed to `tsDiagnosticsWorker`; this thread only awaits.
 *
 * Two more properties follow from the same defect. **Single-flight per root**:
 * three agents asking at once share one compile rather than queueing three.
 * **A short result cache** (`RESULT_CACHE_TTL_MS`, per root): a burst of agent
 * calls at the start of a session pays once. The cache is keyed by resolved
 * root and capped, so a workspace switch is never answered from another
 * workspace's result. It holds only COMPLETED checks — an `unavailable` result
 * is never cached — and `invalidate(root)` drops an entry for a caller that
 * has just written to the workspace.
 */

import * as path from 'path';
import { isPathWithinRoots } from '@ptah-extension/platform-core';
import type {
  IDiagnosticsProvider,
  DiagnosticsResult,
  FileDiagnostics,
  DiagnosticEntry,
} from '@ptah-extension/platform-core';
import type { IFileSystemProvider } from '@ptah-extension/platform-core';
import { DEFAULT_WORKSPACE_EXCLUDES } from '../file-indexing/workspace-default-excludes';
import {
  tsDiagnosticsWorker,
  type CollectedDiagnostic,
  type ConfigFailure,
  type TsDiagnosticsRunOutcome,
} from './ts-diagnostics-worker';

const SOURCE = 'typescript-compiler';

/**
 * How many `tsconfig*.json` files discovery will look at (TASK_2026_301).
 *
 * This was 200, passed inline to `findFiles` as a bare limit nothing downstream
 * could see. A workspace with more configs than the cap had the rest silently
 * dropped — never parsed, never compiled, never reported — and the result was
 * indistinguishable from a genuinely clean subtree. That is the same family of
 * defect TASK_2026_299 exists to remove: a partial answer delivered with the
 * confidence of a complete one.
 *
 * This repo makes it reachable rather than theoretical. 13 apps plus roughly 80
 * libs, most carrying `tsconfig.json` beside `tsconfig.lib.json` /
 * `tsconfig.app.json` and `tsconfig.spec.json`, plausibly clears 200 on its own.
 * So the ceiling is raised AND saturation is made observable — raising it alone
 * would just move the same lie further away.
 */
const DEFAULT_MAX_CONFIGS = 2000;

/**
 * How long a result stays servable for a given root.
 *
 * This was 30 s, and 30 s was too long to be honest (TASK_2026_325 finding 2).
 * The cache key is the root, and nothing in the key moves when a source file
 * does — so an agent that read diagnostics, applied a fix and asked again (the
 * exact loop the core prompt instructs) was answered from before its own edit,
 * for half a minute, with no signal that the answer was stale.
 *
 * The change signal that would fix this properly is not affordable here: the
 * newest `mtimeMs` across a monorepo's source roots costs a full walk, which is
 * the work the cache exists to avoid, and this provider is handed no file
 * watcher to subscribe to. So the two cheap halves are used instead — the
 * window is cut to the width of one agent's burst, and `invalidate()` lets a
 * caller that just wrote a file say so explicitly.
 *
 * 5 s still collapses the burst the cache was added for: three agents calling
 * `ptah_get_diagnostics` at the start of a session land inside it, and one
 * compile serves all three.
 */
const RESULT_CACHE_TTL_MS = 5_000;

/**
 * Roots retained in the cache, evicted least-recently-used. Matches the bound
 * the autocomplete caches in this lib use, and for the same reason: a single
 * slot turns two alternating workspaces into a permanent miss.
 */
const RESULT_CACHE_MAX_ROOTS = 8;

interface CachedResult {
  readonly at: number;
  readonly result: DiagnosticsResult;
}

/**
 * Absolute path of the `typescript` module to type-check with.
 *
 * The workspace's own compiler is preferred: it is the version that project's
 * `tsconfig` was written against, and in a packaged host it may be the only one
 * present at all. Falls back to the compiler this bundle can resolve, and to
 * `undefined` — reported as `unavailable` — when there is none.
 */
function resolveTypescriptModulePath(
  workspaceRoot: string,
): string | undefined {
  try {
    return require.resolve('typescript', { paths: [workspaceRoot] });
  } catch {
    // No compiler installed in the target workspace; try our own.
  }
  try {
    return require.resolve('typescript');
  } catch {
    return undefined;
  }
}

export class TypeScriptDiagnosticsProvider implements IDiagnosticsProvider {
  private readonly maxConfigs: number;
  private readonly cache = new Map<string, CachedResult>();
  private readonly inFlight = new Map<string, Promise<DiagnosticsResult>>();

  /**
   * @param maxConfigs discovery ceiling. Parameterized so a spec can prove the
   *   saturation rule without writing 2000 files; hosts never pass it.
   * @param platform Node platform string, for the same reason
   *   {@link isPathWithinRoots} takes one — so a spec can drive the win32
   *   case-fold rule on a Linux CI runner. Hosts never pass it either.
   */
  constructor(
    private readonly fs: IFileSystemProvider,
    maxConfigs: number = DEFAULT_MAX_CONFIGS,
    private readonly platform: NodeJS.Platform = process.platform,
  ) {
    this.maxConfigs = maxConfigs;
  }

  async getDiagnostics(workspaceRoot?: string): Promise<DiagnosticsResult> {
    if (!workspaceRoot) {
      return {
        status: 'unavailable',
        source: SOURCE,
        reason: 'No workspace root resolved.',
      };
    }

    const normRoot = normalizeRoot(workspaceRoot);

    const cached = this.readCache(normRoot);
    if (cached) return cached;

    // Single-flight: concurrent callers on the same root share one compile.
    // Resolve the cache lookup and this lookup in the same synchronous block —
    // re-reading either after an `await` reintroduces the duplicate run.
    const existing = this.inFlight.get(normRoot);
    if (existing) return existing;

    const run = this.runOnce(workspaceRoot, normRoot).finally(() => {
      this.inFlight.delete(normRoot);
    });
    this.inFlight.set(normRoot, run);
    return run;
  }

  /**
   * Drop the cached result for one root, or for every root when called with no
   * argument.
   *
   * A caller that has just written to the workspace knows something this
   * provider cannot cheaply discover (see `RESULT_CACHE_TTL_MS`), and this is
   * how it says so. Mirrors `invalidateCache(root?)` on the autocomplete
   * discovery services in this lib, for the same reason and with the same
   * shape. Never re-runs the check — warming a result nobody has asked for is
   * work for an answer that may never be requested.
   */
  invalidate(workspaceRoot?: string): void {
    if (workspaceRoot === undefined) {
      this.cache.clear();
      return;
    }
    this.cache.delete(normalizeRoot(workspaceRoot));
  }

  /**
   * Release the shared type-check worker. Optional — the worker is `unref`'d
   * while idle and self-terminates — but hosts with an explicit shutdown path
   * can call it to reclaim the compiler's memory immediately. Resolves once the
   * thread is gone.
   */
  dispose(): Promise<void> {
    return tsDiagnosticsWorker.dispose();
  }

  private async runOnce(
    workspaceRoot: string,
    normRoot: string,
  ): Promise<DiagnosticsResult> {
    const result = await this.compute(workspaceRoot, normRoot);

    // Never cache a failure (TASK_2026_325 finding 3). `unavailable` reports a
    // condition, not a measurement: a dead worker, a compiler that was not
    // installed yet, a config being edited at that instant. Caching it gives
    // every caller in the next window the same failure without retrying the
    // one thing that could clear it, and the retry costs nothing when the
    // cause has not gone away. Only a completed check is worth reusing.
    if (result.status === 'available') {
      this.writeCache(normRoot, result);
    }
    return result;
  }

  private async compute(
    workspaceRoot: string,
    normRoot: string,
  ): Promise<DiagnosticsResult> {
    const tsModulePath = resolveTypescriptModulePath(workspaceRoot);
    if (!tsModulePath) {
      return unavailable('TypeScript compiler not available.');
    }

    // Discover tsconfig*.json files under the root, excluding generated/vendor trees.
    const configPaths: string[] = await this.fs.findFiles(
      '**/tsconfig*.json',
      [...DEFAULT_WORKSPACE_EXCLUDES],
      this.maxConfigs,
      workspaceRoot,
    );

    // `findFiles` has no cursor and reports no overflow, so a full page is the
    // only evidence available that there may be more. It is deliberately
    // treated as "possibly truncated" rather than "truncated" — a workspace
    // holding exactly `maxConfigs` configs is indistinguishable from one
    // holding more, and the safe reading of an ambiguous count is the pessimistic
    // one.
    const discoveryMaybeTruncated = configPaths.length >= this.maxConfigs;

    if (configPaths.length === 0) {
      return unavailable('No tsconfig.json found under workspace root.');
    }

    let outcome: TsDiagnosticsRunOutcome;
    try {
      outcome = await tsDiagnosticsWorker.run({
        tsModulePath,
        configPaths,
        normRoot,
        platform: this.platform,
      });
    } catch (error: unknown) {
      // The worker died, timed out, or the compiler threw. Nothing was
      // checked, so the one answer that must not be given is a clean one.
      const msg = error instanceof Error ? error.message : String(error);
      return unavailable(`TypeScript type-check did not complete: ${msg}`);
    }

    // "At least one program was created" is a condition distinct from "no
    // errors occurred". If no program was ever built, nothing was type-checked
    // — reporting `available` + `[]` here would render as "No issues found",
    // a false clean. Report `unavailable`, distinguishing the two causes.
    if (outcome.programCount === 0) {
      return unavailable(
        outcome.errors.length > 0
          ? outcome.errors.map(describeFailure).join('; ')
          : 'No tsconfig produced a compilable project (all discovered configs were reference-only with no resolvable root files).',
      );
    }

    // A config that failed while its siblings compiled is still a hole in the
    // coverage, and it used to vanish: `outcome.errors` was read only on the
    // `programCount === 0` path, so one malformed tsconfig beside one healthy
    // one produced `available` + the healthy project's (possibly empty) list
    // (TASK_2026_325 finding 1). Each failure is reported as an error
    // diagnostic ON the config that failed — which is what it is, and what
    // `tsc -b` reports too. That keeps the gap visible through every consumer
    // this result reaches, none of which carry a side-channel: the MCP
    // formatter renders it in the error list, and the `execute_code` payload
    // carries it as an ordinary entry. It also means a run whose only finding
    // is a broken config can never render as "No issues found".
    //
    // Root containment is decided HERE, and this is the AUTHORITATIVE decision
    // (TASK_2026_303 finding 1). The worker has already applied a coarse filter
    // of its own, but that one is a transport bound — it exists so a reference
    // graph's worth of diagnostics does not cross `postMessage` to be
    // deserialized on the main thread — not the answer. The answer comes from
    // `platform-core`'s `isPathWithinRoots`: the same tested predicate the
    // terminal spawn guard and the VS Code diagnostics adapter use.
    //
    // Both used to be one hand-rolled `path.relative(root, file)
    // .startsWith('..')` inside the worker. Contrary to the premise
    // TASK_2026_303 was opened on, that form was NOT dropping in-root
    // diagnostics on a casing mismatch — `path.win32.relative` lower-cases both
    // operands, so it agreed with this helper on every measured case. The
    // reason to consolidate is narrower and structural: the rule now has one
    // tested, platform-explicit owner instead of three hand-rolled copies, one
    // of which was silently relying on that undocumented Node behaviour.
    //
    // The worker's copy cannot be removed (no module resolution under
    // `eval: true`), so it is held to this one by
    // `ts-diagnostics-worker-containment.spec.ts`, which drives both over a
    // shared truth table. That test is the real protection here: it is what
    // stops the worker's pre-`postMessage` filter drifting into dropping
    // something this filter would have kept.
    const diagnostics = withConfigFailures(
      groupByFile(
        outcome.collected.filter((d) =>
          isPathWithinRoots(d.file, [normRoot], this.platform),
        ),
      ),
      outcome.errors,
    );

    // A saturated discovery may have dropped configs, so "clean" is the one
    // claim this pass is not entitled to make (TASK_2026_301). `available` +
    // `[]` renders as "No issues found", which is exactly the false clean
    // TASK_2026_299 was opened to remove.
    //
    // Note this fires ONLY on the empty result. A saturated pass that DID find
    // diagnostics still returns them: those findings are real, coverage being
    // partial does not make them wrong, and suppressing a real error behind a
    // capability message would be the worse trade. The reference-graph walk in
    // the worker narrows the exposure further — a config reachable from one
    // that WAS discovered is still visited — but it cannot close it, because a
    // project in neither the page nor any discovered reference graph stays
    // invisible.
    if (discoveryMaybeTruncated && diagnostics.length === 0) {
      return unavailable(
        `Config discovery returned its maximum of ${this.maxConfigs} tsconfig files, ` +
          'so some may not have been checked. A clean result cannot be reported from partial coverage.',
      );
    }

    return {
      status: 'available',
      source: SOURCE,
      diagnostics,
    };
  }

  private readCache(normRoot: string): DiagnosticsResult | undefined {
    const entry = this.cache.get(normRoot);
    if (!entry) return undefined;
    if (Date.now() - entry.at >= RESULT_CACHE_TTL_MS) {
      this.cache.delete(normRoot);
      return undefined;
    }
    // Refresh LRU recency.
    this.cache.delete(normRoot);
    this.cache.set(normRoot, entry);
    return entry.result;
  }

  private writeCache(normRoot: string, result: DiagnosticsResult): void {
    this.cache.delete(normRoot);
    this.cache.set(normRoot, { at: Date.now(), result });
    while (this.cache.size > RESULT_CACHE_MAX_ROOTS) {
      const oldest = this.cache.keys().next();
      if (oldest.done) break;
      this.cache.delete(oldest.value);
    }
  }
}

function normalizeRoot(workspaceRoot: string): string {
  return path.resolve(workspaceRoot).replace(/\\/g, '/');
}

function unavailable(reason: string): DiagnosticsResult {
  return { status: 'unavailable', source: SOURCE, reason };
}

/** One failed config as a single line, for an `unavailable` reason string. */
function describeFailure(failure: ConfigFailure): string {
  return `${failure.config}: ${failure.message}`;
}

/**
 * Fold per-config failures into the diagnostics list as error entries on the
 * config that failed, ahead of the compiled findings.
 *
 * Failures lead because they describe what was NOT checked, and that bounds how
 * much the rest of the list is worth. Merging rather than appending blindly
 * keeps one file to one `FileDiagnostics` entry, which is the shape every
 * consumer groups on.
 */
function withConfigFailures(
  files: FileDiagnostics[],
  failures: readonly ConfigFailure[],
): FileDiagnostics[] {
  if (failures.length === 0) return files;

  const byFile = new Map(files.map((entry) => [entry.file, entry]));
  const added: FileDiagnostics[] = [];

  for (const failure of failures) {
    const entry: DiagnosticEntry = {
      message: failure.message,
      line: 0,
      severity: 'error',
      ...(failure.code !== undefined ? { code: failure.code } : {}),
    };
    const existing = byFile.get(failure.config);
    if (existing) {
      existing.diagnostics.unshift(entry);
      continue;
    }
    const created: FileDiagnostics = {
      file: failure.config,
      diagnostics: [entry],
    };
    byFile.set(failure.config, created);
    added.push(created);
  }

  return [...added, ...files];
}

/**
 * Deduplicate by `file:line:code:message`, then group by file.
 *
 * Dedup is required because a source file reachable from two discovered
 * configs is compiled twice and reports the same error twice.
 */
function groupByFile(
  collected: readonly CollectedDiagnostic[],
): FileDiagnostics[] {
  const seen = new Set<string>();
  const byFile = new Map<string, DiagnosticEntry[]>();

  for (const d of collected) {
    const key = `${d.file}:${d.line}:${d.code}:${d.message}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const entry: DiagnosticEntry = {
      message: d.message,
      line: d.line,
      severity: d.severity,
      code: d.code,
    };
    const existing = byFile.get(d.file);
    if (existing) {
      existing.push(entry);
    } else {
      byFile.set(d.file, [entry]);
    }
  }

  const diagnostics: FileDiagnostics[] = [];
  for (const [file, entries] of byFile) {
    diagnostics.push({ file, diagnostics: entries });
  }
  return diagnostics;
}
