/**
 * `ptah agent` command — agent surface.
 *
 * Sub-commands per `task-description.md` §3 `agent *` table:
 *
 *   packs list                         RPC `wizard:list-agent-packs`
 *                                      emits `agent.packs.list`
 *   packs install <pack-id>            RPC `wizard:install-pack-agents`
 *                                      emits `agent.pack.install.{start,
 *                                      progress, complete}` (changed: any
 *                                      file outcome `written`). No plan
 *                                      token is sent, so the install is
 *                                      create-only (A20); files left as the
 *                                      user's are listed in one
 *                                      `agent.pack.install.kept` before
 *                                      `complete`
 *   list                               pure `fs.readdir(.ptah/agents)`,
 *                                      NO DI — emits `agent.list`
 *   apply <name>                       resolve via `ContentDownloadService`
 *                                      then create `.ptah/agents/<name>.md`
 *                                      create-only (`status: written |
 *                                      unchanged | kept`) emits
 *                                      `agent.applied`
 *
 * `list` deliberately bypasses `withEngine` — a pure fs scan must work on
 * unbootstrapped workspaces and avoid the cost of full DI bootstrap.
 *
 * `apply` uses the ContentDownloadService plugin path (~/.ptah/plugins/) as
 * the agent template source, mirroring the Electron WizardWebview-driven
 * apply flow. The template name resolves to `<plugins>/<name>/agent.md`
 * if that file exists, or a fall-through error otherwise. An existing
 * `.ptah/agents/<name>.md` is never replaced: identical bytes report
 * `unchanged`, anything else (different or unreadable) reports `kept`.
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';

import { withEngine } from '@ptah-extension/cli-engine';
import { buildFormatter, type Formatter } from '../output/formatter.js';
import { ExitCode } from '../jsonrpc/types.js';
import type { GlobalOptions } from '../router.js';
import type { CliMessageTransport } from '@ptah-extension/cli-engine';
import type {
  AgentPackInfoDto,
  FileOutcome,
  PackFileOutcome,
  WizardInstallPackAgentsResult,
} from '@ptah-extension/shared';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { ContentDownloadService } from '@ptah-extension/platform-core';

export type AgentSubcommand = 'packs-list' | 'packs-install' | 'list' | 'apply';

export interface AgentOptions {
  subcommand: AgentSubcommand;
  /** For `packs install <pack-id>`. */
  packId?: string;
  /** For `apply <name>`. */
  name?: string;
}

export interface AgentStderrLike {
  write(chunk: string): boolean;
}

export interface AgentExecuteHooks {
  stderr?: AgentStderrLike;
  formatter?: Formatter;
  withEngine?: typeof withEngine;
  /** Override hook for tests — defaults to `node:fs/promises.readdir`. */
  readdir?: (path: string) => Promise<string[]>;
  /** Override hook for tests — defaults to `node:fs/promises.readFile`. */
  readFile?: (path: string) => Promise<string>;
  /**
   * Override hook for tests — defaults to `node:fs/promises.writeFile` with
   * flag `wx`. Must create exclusively: reject with `code: 'EEXIST'` when the
   * file already exists.
   */
  writeFile?: (path: string, data: string) => Promise<void>;
  /** Override hook for tests — defaults to `node:fs/promises.mkdir`. */
  mkdir?: (path: string, opts: { recursive: boolean }) => Promise<void>;
  /** Override hook for tests — defaults to `node:fs/promises.stat`. */
  stat?: (path: string) => Promise<{ isFile(): boolean }>;
  /**
   * Override hook for tests — resolve the plugins directory used by `apply`
   * to find the source `<plugins>/<name>/agent.md`. Production callers omit
   * this; the default resolves `ContentDownloadService` from the global DI
   * container after `withEngine` bootstrap.
   */
  resolvePluginsPath?: () => string;
}

export async function execute(
  opts: AgentOptions,
  globals: GlobalOptions,
  hooks: AgentExecuteHooks = {},
): Promise<number> {
  const formatter = hooks.formatter ?? buildFormatter(globals);
  const stderr: AgentStderrLike = hooks.stderr ?? process.stderr;
  const engine = hooks.withEngine ?? withEngine;

  try {
    switch (opts.subcommand) {
      case 'packs-list':
        return await runPacksList(globals, formatter, engine);
      case 'packs-install':
        return await runPacksInstall(opts, globals, formatter, stderr, engine);
      case 'list':
        return await runList(globals, formatter, hooks);
      case 'apply':
        return await runApply(opts, globals, formatter, stderr, engine, hooks);
      default:
        stderr.write(
          `ptah agent: unknown sub-command '${String(opts.subcommand)}'\n`,
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

async function runPacksList(
  globals: GlobalOptions,
  formatter: Formatter,
  engine: typeof withEngine,
): Promise<number> {
  return engine(globals, { mode: 'full' }, async (ctx) => {
    const result = await callRpc<{ packs: AgentPackInfoDto[] }>(
      ctx.transport,
      'wizard:list-agent-packs',
      {},
    );
    await formatter.writeNotification('agent.packs.list', {
      packs: result?.packs ?? [],
    });
    return ExitCode.Success;
  });
}

async function runPacksInstall(
  opts: AgentOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  stderr: AgentStderrLike,
  engine: typeof withEngine,
): Promise<number> {
  if (!opts.packId || opts.packId.trim().length === 0) {
    stderr.write('ptah agent packs install: <pack-id> is required\n');
    return ExitCode.UsageError;
  }
  const packId = opts.packId;

  return engine(globals, { mode: 'full' }, async (ctx) => {
    const list = await callRpc<{ packs: AgentPackInfoDto[] }>(
      ctx.transport,
      'wizard:list-agent-packs',
      {},
    );
    const pack = (list?.packs ?? []).find(
      (p) => p.name === packId || p.source === packId,
    );
    if (!pack) {
      throw new Error(`Agent pack not found: ${packId}`);
    }

    await formatter.writeNotification('agent.pack.install.start', {
      packId,
      source: pack.source,
      agentCount: pack.agents.length,
    });

    const result = await callRpc<WizardInstallPackAgentsResult>(
      ctx.transport,
      'wizard:install-pack-agents',
      {
        source: pack.source,
        agentFiles: pack.agents.map((a) => a.file),
      },
    );

    await formatter.writeNotification('agent.pack.install.progress', {
      packId,
      source: pack.source,
      agentsDownloaded: result?.agentsDownloaded ?? 0,
      total: pack.agents.length,
    });

    const keptFiles = collectKeptPackFiles(result?.files);
    if (keptFiles.length > 0) {
      await formatter.writeNotification('agent.pack.install.kept', {
        packId,
        source: pack.source,
        keptCount: keptFiles.filter((f) => f.status === 'kept').length,
        changedSincePreviewCount: keptFiles.filter(
          (f) => f.status === 'changed-since-preview',
        ).length,
        files: keptFiles,
      });
    }

    await formatter.writeNotification('agent.pack.install.complete', {
      packId,
      source: pack.source,
      agentsDownloaded: result?.agentsDownloaded ?? 0,
      changed: packInstallChanged(result),
      error: result?.error,
    });
    return ExitCode.Success;
  });
}

/**
 * Whether the pack install wrote any destination file. Per-file outcomes
 * are authoritative; `!fromCache` is only a fallback for an older host
 * whose response carries no `files` array (fetch-cache state says nothing
 * about writes).
 */
export function packInstallChanged(
  result: WizardInstallPackAgentsResult | null | undefined,
): boolean {
  if (!result) return true;
  if (Array.isArray(result.files)) {
    return result.files.some((f) => f.outcome === 'written');
  }
  return !result.fromCache;
}

/** A pack file the install left as the user's, and why it was not written. */
export interface AgentPackKeptFile {
  file: string;
  status: Extract<FileOutcome, 'kept' | 'changed-since-preview'>;
  reason: string;
}

/**
 * List the pack files the install did not write over, in plan order. A
 * result from an older host without `files` yields none.
 */
export function collectKeptPackFiles(
  files: readonly PackFileOutcome[] | undefined,
): AgentPackKeptFile[] {
  if (!Array.isArray(files)) return [];
  const kept: AgentPackKeptFile[] = [];
  for (const entry of files) {
    if (entry.outcome === 'kept') {
      kept.push({
        file: entry.file,
        status: 'kept',
        reason:
          'existing file kept as yours; CLI pack installs only create new files',
      });
    } else if (entry.outcome === 'changed-since-preview') {
      kept.push({
        file: entry.file,
        status: 'changed-since-preview',
        reason: 'file changed after the install plan, so it was kept',
      });
    }
  }
  return kept;
}

async function runList(
  globals: GlobalOptions,
  formatter: Formatter,
  hooks: AgentExecuteHooks,
): Promise<number> {
  const root = globals.cwd;
  const readdir = hooks.readdir ?? ((p: string) => fs.readdir(p));
  const agentsDir = path.join(root, '.ptah', 'agents');

  let entries: string[] = [];
  try {
    entries = await readdir(agentsDir);
  } catch {
    entries = [];
  }

  const agents = entries
    .filter((entry) => entry.endsWith('.md'))
    .map((entry) => ({
      name: entry.replace(/\.md$/, ''),
      file: entry,
      path: path.join(agentsDir, entry),
    }));

  await formatter.writeNotification('agent.list', {
    path: agentsDir,
    agents,
  });
  return ExitCode.Success;
}

async function runApply(
  opts: AgentOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  stderr: AgentStderrLike,
  engine: typeof withEngine,
  hooks: AgentExecuteHooks,
): Promise<number> {
  if (!opts.name || opts.name.trim().length === 0) {
    stderr.write('ptah agent apply: <name> is required\n');
    return ExitCode.UsageError;
  }
  const name = opts.name;

  return engine(globals, { mode: 'full' }, async (ctx) => {
    const pluginsPath =
      hooks.resolvePluginsPath?.() ?? defaultResolvePluginsPath(ctx.container);
    const sourceFile = path.join(pluginsPath, name, 'agent.md');

    const readFile = hooks.readFile ?? ((p: string) => fs.readFile(p, 'utf8'));
    // Exclusive create (`wx`): an existing file rejects with EEXIST instead
    // of being replaced.
    const writeFile =
      hooks.writeFile ??
      ((p: string, d: string) =>
        fs.writeFile(p, d, { encoding: 'utf8', flag: 'wx' }));
    const mkdir =
      hooks.mkdir ??
      ((p: string, o: { recursive: boolean }) =>
        fs.mkdir(p, o).then(() => undefined));
    const stat =
      hooks.stat ??
      ((p: string) => fs.stat(p).then((s) => ({ isFile: () => s.isFile() })));

    let sourceContent: string;
    try {
      sourceContent = await readFile(sourceFile);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Agent template not found at ${sourceFile}: ${message}`);
    }

    const targetDir = path.join(globals.cwd, '.ptah', 'agents');
    const targetFile = path.join(targetDir, `${name}.md`);

    const outcome = await applyCreateOnly(
      targetDir,
      targetFile,
      sourceContent,
      { readFile, writeFile, mkdir, stat },
    );

    await formatter.writeNotification('agent.applied', {
      name,
      path: targetFile,
      source: sourceFile,
      status: outcome.status,
      changed: outcome.status === 'written',
      ...(outcome.reason ? { reason: outcome.reason } : {}),
    });
    return ExitCode.Success;
  });
}

/** What `agent apply` did with the destination file. */
export type AgentApplyStatus = 'written' | 'unchanged' | 'kept';

interface AgentApplyOutcome {
  status: AgentApplyStatus;
  reason?: string;
}

interface AgentApplyFs {
  readFile: (path: string) => Promise<string>;
  writeFile: (path: string, data: string) => Promise<void>;
  mkdir: (path: string, opts: { recursive: boolean }) => Promise<void>;
  stat: (path: string) => Promise<{ isFile(): boolean }>;
}

const KEPT_EXISTING_REASON =
  'existing file kept as yours; agent apply only creates new files';

/**
 * Create-only apply (TASK_2026_701 A1): an absent destination is created
 * with an exclusive write, an identical one is left alone, and anything
 * else (different bytes, not a regular file, unreadable, or created by
 * someone else between the check and the write) is kept as the user's.
 * Invoking apply is never taken as permission to replace a file.
 */
async function applyCreateOnly(
  targetDir: string,
  targetFile: string,
  sourceContent: string,
  io: AgentApplyFs,
): Promise<AgentApplyOutcome> {
  let exists = true;
  try {
    const info = await io.stat(targetFile);
    if (!info.isFile()) {
      return { status: 'kept', reason: 'destination is not a regular file' };
    }
  } catch (error) {
    if (!isAbsentError(error)) {
      return { status: 'kept', reason: unreadableReason(error) };
    }
    exists = false;
  }

  if (exists) {
    let existingContent: string;
    try {
      existingContent = await io.readFile(targetFile);
    } catch (error) {
      // Removed between stat and read is still "present when inspected";
      // keep rather than race a create against whoever removed it.
      return { status: 'kept', reason: unreadableReason(error) };
    }
    return existingContent === sourceContent
      ? { status: 'unchanged' }
      : { status: 'kept', reason: KEPT_EXISTING_REASON };
  }

  await io.mkdir(targetDir, { recursive: true });
  try {
    await io.writeFile(targetFile, sourceContent);
  } catch (error) {
    if (errorCode(error) === 'EEXIST') {
      return { status: 'kept', reason: KEPT_EXISTING_REASON };
    }
    throw error;
  }
  return { status: 'written' };
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }
  const { code } = error;
  return typeof code === 'string' ? code : undefined;
}

function isAbsentError(error: unknown): boolean {
  const code = errorCode(error);
  return code === 'ENOENT' || code === 'ENOTDIR';
}

function unreadableReason(error: unknown): string {
  const code = errorCode(error);
  return `destination could not be read${code ? ` (${code})` : ''}, so it was kept`;
}

function defaultResolvePluginsPath(
  container: import('tsyringe').DependencyContainer,
): string {
  const contentDownload = container.resolve<ContentDownloadService>(
    PLATFORM_TOKENS.CONTENT_DOWNLOAD,
  );
  return contentDownload.getPluginsPath();
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
