/**
 * `ptah quality` command — quality assessment dashboard surface.
 *
 * Backed by the shared `QualityRpcHandlers` (registered globally via
 * `registerAllRpcHandlers()`).
 *
 * Sub-commands (per task-description.md §3.1 `quality *` table):
 *
 *   assessment [--id <id>]    RPC `quality:getAssessment` → emits
 *                             `quality.assessment`
 *   history [--limit <n>]     RPC `quality:getHistory` → emits
 *                             `quality.history`
 *   export [--out <path>]     RPC `quality:export { format: 'json' }` →
 *                             emits `quality.export.complete`
 *
 * `export` design note:
 * The backend `quality:export` handler writes through `ISaveDialogProvider.
 * showSaveAndWrite`, which the CLI app registers as `CliSaveDialog`. That
 * provider writes the buffer to `<cwd>/<filename>` and returns the path; the
 * backend tolerates a `null` return (`saved: false`) and always echoes the
 * `content` string in the result regardless of dialog outcome.
 *
 * The CLI command treats the `content` field as the source of truth:
 *   - When `--out <path>` is provided, the CLI writes `content` to that path
 *     atomically. (The backend may also have written a copy to cwd via the
 *     existing `CliSaveDialog`; we delete that side-effect when it differs
 *     from `--out`.)
 *   - When `--out` is omitted, the CLI streams `content` to stdout AFTER the
 *     `quality.export.complete` notification frame.
 *
 * The `--id` flag on `assessment` is currently advisory — `quality:
 * getAssessment` returns the latest assessment for the active workspace and
 * does not accept an id parameter. We forward it for forward compat.
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';

import { withEngine } from '../bootstrap/with-engine.js';
import { buildFormatter, type Formatter } from '../output/formatter.js';
import { ExitCode } from '../jsonrpc/types.js';
import type { GlobalOptions } from '../router.js';
import type { CliMessageTransport } from '../../transport/cli-message-transport.js';
import type {
  QualityGetAssessmentResult,
  QualityGetHistoryResult,
  QualityExportResult,
} from '@ptah-extension/shared';

export type QualitySubcommand = 'assessment' | 'history' | 'export';

export interface QualityOptions {
  subcommand: QualitySubcommand;
  /** For `assessment` — optional advisory id (forwarded but unused by backend). */
  id?: string;
  /** For `history` — max entries to return. */
  limit?: number;
  /** For `export` — output path. When omitted, content streams to stdout. */
  out?: string;
}

export interface QualityStderrLike {
  write(chunk: string): boolean;
}

export interface QualityStdoutLike {
  write(chunk: string): boolean;
}

export interface QualityExecuteHooks {
  stderr?: QualityStderrLike;
  stdout?: QualityStdoutLike;
  formatter?: Formatter;
  withEngine?: typeof withEngine;
  /** Override hook for tests — defaults to `node:fs/promises.writeFile`. */
  writeFile?: (path: string, data: string) => Promise<void>;
  /** Override hook for tests — defaults to `node:fs/promises.mkdir`. */
  mkdir?: (path: string, opts: { recursive: boolean }) => Promise<void>;
  /** Override hook for tests — defaults to `node:fs/promises.unlink`. */
  unlink?: (path: string) => Promise<void>;
}

export async function execute(
  opts: QualityOptions,
  globals: GlobalOptions,
  hooks: QualityExecuteHooks = {},
): Promise<number> {
  const formatter = hooks.formatter ?? buildFormatter(globals);
  const stderr: QualityStderrLike = hooks.stderr ?? process.stderr;
  const engine = hooks.withEngine ?? withEngine;

  try {
    switch (opts.subcommand) {
      case 'assessment':
        return await runAssessment(opts, globals, formatter, engine);
      case 'history':
        return await runHistory(opts, globals, formatter, engine);
      case 'export':
        return await runExport(opts, globals, formatter, engine, hooks);
      default:
        stderr.write(
          `ptah quality: unknown sub-command '${String(opts.subcommand)}'\n`,
        );
        return ExitCode.UsageError;
    }
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
// assessment — RPC `quality:getAssessment`
// ---------------------------------------------------------------------------

async function runAssessment(
  opts: QualityOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  engine: typeof withEngine,
): Promise<number> {
  return engine(globals, { mode: 'full' }, async (ctx) => {
    const result = await callRpc<QualityGetAssessmentResult>(
      ctx.transport,
      'quality:getAssessment',
      {},
    );
    await formatter.writeNotification('quality.assessment', {
      id: opts.id,
      intelligence: result?.intelligence,
      fromCache: result?.fromCache ?? false,
    });
    return ExitCode.Success;
  });
}

// ---------------------------------------------------------------------------
// history — RPC `quality:getHistory`
// ---------------------------------------------------------------------------

async function runHistory(
  opts: QualityOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  engine: typeof withEngine,
): Promise<number> {
  return engine(globals, { mode: 'full' }, async (ctx) => {
    const params = opts.limit !== undefined ? { limit: opts.limit } : {};
    const result = await callRpc<QualityGetHistoryResult>(
      ctx.transport,
      'quality:getHistory',
      params,
    );
    await formatter.writeNotification('quality.history', {
      limit: opts.limit,
      entries: result?.entries ?? [],
    });
    return ExitCode.Success;
  });
}

// ---------------------------------------------------------------------------
// export — RPC `quality:export { format: 'json' }`
// ---------------------------------------------------------------------------

async function runExport(
  opts: QualityOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  engine: typeof withEngine,
  hooks: QualityExecuteHooks,
): Promise<number> {
  return engine(globals, { mode: 'full' }, async (ctx) => {
    const result = await callRpc<QualityExportResult>(
      ctx.transport,
      'quality:export',
      { format: 'json' },
    );

    const content = result?.content ?? '';
    const contentBytes = Buffer.byteLength(content, 'utf8');

    const writeFile =
      hooks.writeFile ?? ((p: string, d: string) => fs.writeFile(p, d, 'utf8'));
    const mkdir =
      hooks.mkdir ??
      ((p: string, o: { recursive: boolean }) =>
        fs.mkdir(p, o).then(() => undefined));
    const unlink =
      hooks.unlink ?? ((p: string) => fs.unlink(p).catch(() => undefined));

    let outPath: string | undefined;
    if (opts.out && opts.out.length > 0) {
      outPath = path.resolve(globals.cwd, opts.out);
      await mkdir(path.dirname(outPath), { recursive: true });
      await writeFile(outPath, content);

      // The CLI's existing CliSaveDialog has already written a copy to
      // <cwd>/<filename> as a side-effect. When --out points elsewhere,
      // remove the duplicate so consumers see exactly one artifact.
      const sideEffectPath = result?.filePath;
      if (
        sideEffectPath &&
        path.resolve(globals.cwd, sideEffectPath) !== outPath
      ) {
        await unlink(sideEffectPath);
      }
    } else {
      // No --out: stream content to stdout AFTER the notification frame.
      const stdout: QualityStdoutLike = hooks.stdout ?? process.stdout;
      // Fall through — write happens after notification below.
      await formatter.writeNotification('quality.export.complete', {
        outPath: undefined,
        savedBytes: contentBytes,
        filename: result?.filename,
        mimeType: result?.mimeType,
      });
      stdout.write(content);
      return ExitCode.Success;
    }

    await formatter.writeNotification('quality.export.complete', {
      outPath,
      savedBytes: contentBytes,
      filename: result?.filename,
      mimeType: result?.mimeType,
    });
    return ExitCode.Success;
  });
}

// ---------------------------------------------------------------------------
// Helpers — module-private.
// ---------------------------------------------------------------------------

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
