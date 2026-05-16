/**
 * `ptah settings` command — export / import portable settings bundles.
 *
 * Sub-commands (per task-description.md §3.1):
 *
 *   export [--out <path>]      Collect settings via SDK SettingsExportService
 *                              and write JSON to `<path>` (or stdout when
 *                              omitted). The export contains secret material —
 *                              the file is opened with mode 0o600.
 *   import [--in <path>]       Read JSON from `<path>` (or stdin when omitted)
 *                              and apply via SDK SettingsImportService.
 *                              Existing credentials are preserved unless
 *                              `--overwrite` is set.
 *
 * SECURITY NOTES:
 * - The CLI bypasses Electron's `dialog.showSaveDialog`/`showOpenDialog`
 *   pipeline entirely — paths are explicit. This avoids the Electron-only
 *   `settings:export-bundle` / `settings:import-bundle` RPC handlers that
 *   require a GUI surface.
 * - When `--out` is omitted the bundle is written to stdout. Callers should
 *   redirect to a chmod'd file (`ptah --json settings export > out.json &&
 *   chmod 600 out.json`). When `--out` is provided we set 0o600 ourselves.
 *
 * No DI mocking in production; tests inject hooks via {@link SettingsExecuteHooks}.
 */

import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as pathJoin } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { Readable } from 'node:stream';

import { SDK_TOKENS } from '@ptah-extension/agent-sdk';

import { withEngine } from '../bootstrap/with-engine.js';
import { buildFormatter, type Formatter } from '../output/formatter.js';
import { ExitCode } from '../jsonrpc/types.js';
import type { GlobalOptions } from '../router.js';
import type { EngineContext } from '../bootstrap/with-engine.js';

export type SettingsSubcommand = 'export' | 'import';

export interface SettingsOptions {
  subcommand: SettingsSubcommand;
  /** export: output path (optional — defaults to stdout). */
  out?: string;
  /** import: input path (optional — defaults to stdin). */
  in?: string;
  /** import: overwrite existing credentials. */
  overwrite?: boolean;
}

export interface SettingsStderrLike {
  write(chunk: string): boolean;
}

export interface SettingsStdoutLike {
  write(chunk: string): boolean;
}

export interface SettingsExecuteHooks {
  stderr?: SettingsStderrLike;
  /** Override stdout (used when `--out` omitted on export). */
  stdout?: SettingsStdoutLike;
  /** Override stdin reader (used when `--in` omitted on import). */
  stdin?: Readable;
  formatter?: Formatter;
  withEngine?: typeof withEngine;
}

export async function execute(
  opts: SettingsOptions,
  globals: GlobalOptions,
  hooks: SettingsExecuteHooks = {},
): Promise<number> {
  const formatter = hooks.formatter ?? buildFormatter(globals);
  const stderr: SettingsStderrLike = hooks.stderr ?? process.stderr;
  const engine = hooks.withEngine ?? withEngine;

  try {
    switch (opts.subcommand) {
      case 'export':
        return await runExport(opts, globals, formatter, stderr, engine, hooks);
      case 'import':
        return await runImport(opts, globals, formatter, stderr, engine, hooks);
      default:
        stderr.write(
          `ptah settings: unknown sub-command '${String(opts.subcommand)}'\n`,
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
// `settings export`
// ---------------------------------------------------------------------------

async function runExport(
  opts: SettingsOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  stderr: SettingsStderrLike,
  engine: typeof withEngine,
  hooks: SettingsExecuteHooks,
): Promise<number> {
  return engine(globals, { mode: 'full' }, async (ctx) => {
    const exportService = await resolveExportService(ctx);
    const bundle = await exportService.collectSettings('cli');
    const json = JSON.stringify(bundle, null, 2);

    if (opts.out) {
      // Atomic + restrictive-permission write: tmp file in the same dir,
      // 0o600, then rename onto the target.
      await atomicWriteSecret(opts.out, json);
      await formatter.writeNotification('settings.exported', {
        path: opts.out,
        bytes: json.length,
        version: bundle.version,
      });
    } else {
      // Stream to stdout (or test sink). Caller is responsible for chmod.
      const out = hooks.stdout ?? process.stdout;
      out.write(`${json}\n`);
      stderr.write(
        '[ptah] settings export written to stdout — pipe to a file and `chmod 600` it.\n',
      );
      await formatter.writeNotification('settings.exported', {
        path: null,
        bytes: json.length,
        version: bundle.version,
      });
    }
    return ExitCode.Success;
  });
}

// ---------------------------------------------------------------------------
// `settings import`
// ---------------------------------------------------------------------------

async function runImport(
  opts: SettingsOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  stderr: SettingsStderrLike,
  engine: typeof withEngine,
  hooks: SettingsExecuteHooks,
): Promise<number> {
  return engine(globals, { mode: 'full' }, async (ctx) => {
    const raw = opts.in
      ? await fs.readFile(opts.in, 'utf8')
      : await readAllStream(hooks.stdin ?? process.stdin);
    if (!raw.trim()) {
      stderr.write('ptah settings import: empty input\n');
      return ExitCode.UsageError;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      stderr.write(`ptah settings import: invalid JSON — ${message}\n`);
      return ExitCode.UsageError;
    }

    const importService = await resolveImportService(ctx);
    const result = await importService.importSettings(
      parsed as Parameters<typeof importService.importSettings>[0],
      { overwrite: opts.overwrite === true },
    );

    await formatter.writeNotification('settings.imported', {
      imported: result.imported,
      skipped: result.skipped,
      errors: result.errors,
      source: opts.in ?? '<stdin>',
    });

    if (result.errors.length > 0) {
      return ExitCode.GeneralError;
    }
    return ExitCode.Success;
  });
}

// ---------------------------------------------------------------------------
// Service resolution helpers
// ---------------------------------------------------------------------------

function resolveExportService(ctx: EngineContext): {
  collectSettings(
    source: 'vscode' | 'electron' | 'cli',
  ): Promise<{ version: string } & Record<string, unknown>>;
} {
  return ctx.container.resolve(SDK_TOKENS.SDK_SETTINGS_EXPORT);
}

function resolveImportService(ctx: EngineContext): {
  importSettings(
    data: unknown,
    options?: { overwrite?: boolean },
  ): Promise<{
    imported: string[];
    skipped: string[];
    errors: string[];
  }>;
} {
  return ctx.container.resolve(SDK_TOKENS.SDK_SETTINGS_IMPORT);
}

// ---------------------------------------------------------------------------
// IO helpers
// ---------------------------------------------------------------------------

/**
 * Write `data` to `target` with 0o600 perms via tmp+rename. The tmp file lives
 * in the OS tmp dir to side-step EXDEV / cross-device issues — `fs.rename`
 * can still fail across volumes, in which case we fall back to copy+unlink.
 */
async function atomicWriteSecret(target: string, data: string): Promise<void> {
  const tmpName = `ptah-settings-${Date.now()}-${randomBytes(6).toString('hex')}.json`;
  const tmpPath = pathJoin(tmpdir(), tmpName);
  await fs.writeFile(tmpPath, data, { encoding: 'utf8', mode: 0o600 });
  try {
    await fs.rename(tmpPath, target);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EXDEV' || code === 'EPERM') {
      await fs.copyFile(tmpPath, target);
      await fs.chmod(target, 0o600);
      await fs.unlink(tmpPath).catch(() => {
        /* swallow */
      });
      return;
    }
    throw error;
  }
  // Defensive chmod after rename in case the dest filesystem ignored mode.
  try {
    await fs.chmod(target, 0o600);
  } catch {
    /* best-effort — Windows refs do not honor POSIX bits */
  }
}

async function readAllStream(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}
