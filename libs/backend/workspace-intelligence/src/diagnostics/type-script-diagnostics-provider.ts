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
 * - `available` with diagnostics for a project with errors.
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
 * workspace's result.
 */

import * as path from 'path';
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
 * Short enough that an agent which just fixed an error sees the fix on its next
 * turn; long enough that the burst of `ptah_get_diagnostics` calls three agents
 * make on the same workspace within a few seconds costs one compile.
 */
const RESULT_CACHE_TTL_MS = 30_000;

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
   */
  constructor(
    private readonly fs: IFileSystemProvider,
    maxConfigs: number = DEFAULT_MAX_CONFIGS,
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
    this.writeCache(normRoot, result);
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
          ? outcome.errors.join('; ')
          : 'No tsconfig produced a compilable project (all discovered configs were reference-only with no resolvable root files).',
      );
    }

    const diagnostics = groupByFile(outcome.collected);

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
