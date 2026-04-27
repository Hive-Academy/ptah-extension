/**
 * `ptah analyze` command — workspace deep-analysis runner.
 *
 * TASK_2026_104 Sub-batch B5d.
 *
 * Top-level command (per task-description.md §3.1):
 *
 *   analyze [--model <m>] [--save] [--out <path>]
 *
 * Streams `analyze.start | analyze.framework_detected |
 * analyze.dependency_detected | analyze.recommendation | analyze.complete`
 * notifications to stdout while the underlying multi-phase pipeline runs via
 * `wizard:deep-analyze`.
 *
 * The handler returns the full {@link MultiPhaseAnalysisResponse} on success.
 * - When `--save` is set (and `--out` omitted), the manifest + phase contents
 *   are persisted to `~/.ptah/analyses/<slug>/manifest.json` (atomic write).
 * - When `--out <path>` is provided, the bundle is written verbatim to
 *   `<path>` (atomic write); `--save` is implied.
 *
 * Premium licence + MCP server are required by the backend; the CLI surfaces
 * the backend's structured error verbatim if either gate fails.
 *
 * No DI mocking in production; tests inject hooks via {@link AnalyzeExecuteHooks}.
 */

import { promises as fs } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname as pathDirname, join as pathJoin } from 'node:path';
import { randomBytes } from 'node:crypto';

import { withEngine } from '../bootstrap/with-engine.js';
import { buildFormatter, type Formatter } from '../output/formatter.js';
import { ExitCode } from '../jsonrpc/types.js';
import type { GlobalOptions } from '../router.js';
import type { CliMessageTransport } from '../../transport/cli-message-transport.js';

export interface AnalyzeOptions {
  /** Model id forwarded to wizard:deep-analyze. Optional. */
  model?: string;
  /** Persist the bundle to ~/.ptah/analyses/<slug>/manifest.json. */
  save?: boolean;
  /** Explicit output path. When set, `--save` is implied. */
  out?: string;
}

export interface AnalyzeStderrLike {
  write(chunk: string): boolean;
}

export interface AnalyzeExecuteHooks {
  stderr?: AnalyzeStderrLike;
  formatter?: Formatter;
  withEngine?: typeof withEngine;
  /** Override the analyses dir (tests). Defaults to `~/.ptah/analyses`. */
  analysesDir?: string;
}

interface MultiPhaseManifestLite {
  slug: string;
  analyzedAt: string;
  model: string;
  totalDurationMs: number;
  phases: Record<
    string,
    { status: string; file: string; durationMs: number; error?: string }
  >;
}

interface MultiPhaseAnalysisLite {
  isMultiPhase: true;
  manifest: MultiPhaseManifestLite;
  phaseContents: Record<string, string>;
  analysisDir: string;
}

export async function execute(
  opts: AnalyzeOptions,
  globals: GlobalOptions,
  hooks: AnalyzeExecuteHooks = {},
): Promise<number> {
  const formatter = hooks.formatter ?? buildFormatter(globals);
  const stderr: AnalyzeStderrLike = hooks.stderr ?? process.stderr;
  const engine = hooks.withEngine ?? withEngine;
  const analysesDir =
    hooks.analysesDir ?? pathJoin(homedir(), '.ptah', 'analyses');

  try {
    return await engine(globals, { mode: 'full' }, async (ctx) => {
      const startedAt = new Date().toISOString();
      await formatter.writeNotification('analyze.start', {
        startedAt,
        model: opts.model,
        cwd: globals.cwd,
      });

      const result = await callRpc<MultiPhaseAnalysisLite>(
        ctx.transport,
        'wizard:deep-analyze',
        opts.model ? { model: opts.model } : {},
      );

      // Stream phase-level discoveries derived from the manifest. We do not
      // get token-level streaming from the in-process RPC, but each phase
      // still surfaces as a notification so consumers can track progress.
      await emitPhaseSummaries(formatter, result);

      // `analyze.recommendation` is reserved for future agent-recommendation
      // integration. We forward an empty list today so consumers can rely on
      // its envelope shape.
      await formatter.writeNotification('analyze.recommendation', {
        slug: result.manifest.slug,
        recommendations: [],
      });

      const persistedPath = await maybePersist(
        result,
        opts,
        analysesDir,
        stderr,
      );

      await formatter.writeNotification('analyze.complete', {
        slug: result.manifest.slug,
        analyzedAt: result.manifest.analyzedAt,
        model: result.manifest.model,
        totalDurationMs: result.manifest.totalDurationMs,
        analysisDir: result.analysisDir,
        savedTo: persistedPath,
      });

      return ExitCode.Success;
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await formatter.writeNotification('task.error', {
      ptah_code: 'internal_failure',
      message,
    });
    return ExitCode.InternalFailure;
  }
}

// ---------------------------------------------------------------------------
// Phase emission
// ---------------------------------------------------------------------------

/**
 * Walk the multi-phase manifest and emit framework / dependency notifications
 * derived from each phase's markdown content. This is best-effort heuristic
 * extraction so machine consumers see something between `analyze.start` and
 * `analyze.complete` rather than a long silence.
 *
 * The CLI does not parse the markdown — it forwards the raw phase blocks under
 * `analyze.framework_detected` (phase id includes 'framework' / 'detection')
 * and `analyze.dependency_detected` (phase id includes 'dependency' / 'deps').
 * Other phases are emitted under `analyze.framework_detected` with a generic
 * payload so downstream consumers see one notification per phase.
 */
async function emitPhaseSummaries(
  formatter: Formatter,
  result: MultiPhaseAnalysisLite,
): Promise<void> {
  for (const [phaseId, phaseResult] of Object.entries(result.manifest.phases)) {
    if (phaseResult.status !== 'completed') continue;
    const content = result.phaseContents[phaseId] ?? '';
    const lower = phaseId.toLowerCase();
    if (lower.includes('depend')) {
      await formatter.writeNotification('analyze.dependency_detected', {
        phase: phaseId,
        durationMs: phaseResult.durationMs,
        file: phaseResult.file,
        contentLength: content.length,
      });
    } else {
      await formatter.writeNotification('analyze.framework_detected', {
        phase: phaseId,
        durationMs: phaseResult.durationMs,
        file: phaseResult.file,
        contentLength: content.length,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

async function maybePersist(
  result: MultiPhaseAnalysisLite,
  opts: AnalyzeOptions,
  analysesDir: string,
  stderr: AnalyzeStderrLike,
): Promise<string | undefined> {
  const wantsExplicitOut = typeof opts.out === 'string' && opts.out.length > 0;
  const wantsSave = opts.save === true || wantsExplicitOut;
  if (!wantsSave) return undefined;

  const target =
    opts.out ??
    pathJoin(analysesDir, sanitizeSlug(result.manifest.slug), 'manifest.json');

  const payload = JSON.stringify(
    {
      isMultiPhase: result.isMultiPhase,
      manifest: result.manifest,
      phaseContents: result.phaseContents,
      analysisDir: result.analysisDir,
    },
    null,
    2,
  );

  try {
    await fs.mkdir(pathDirname(target), { recursive: true });
    await atomicWrite(target, payload);
    return target;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stderr.write(`[ptah] analyze: failed to persist manifest — ${message}\n`);
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// IO helpers
// ---------------------------------------------------------------------------

async function atomicWrite(target: string, data: string): Promise<void> {
  const tmpName = `ptah-analysis-${Date.now()}-${randomBytes(6).toString('hex')}.json`;
  const tmpPath = pathJoin(tmpdir(), tmpName);
  await fs.writeFile(tmpPath, data, { encoding: 'utf8' });
  try {
    await fs.rename(tmpPath, target);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EXDEV' || code === 'EPERM') {
      await fs.copyFile(tmpPath, target);
      await fs.unlink(tmpPath).catch(() => {
        /* swallow */
      });
      return;
    }
    throw error;
  }
}

function sanitizeSlug(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128) || 'analysis';
}

async function callRpc<T = unknown>(
  transport: CliMessageTransport,
  method: string,
  params: unknown,
): Promise<T> {
  const response = await transport.call<unknown, T>(method, params);
  if (!response.success) {
    const err = new Error(response.error ?? `${method} failed`);
    if (response.errorCode) {
      (err as unknown as { code: string }).code = response.errorCode;
    }
    throw err;
  }
  return (response.data as T) ?? (null as unknown as T);
}
