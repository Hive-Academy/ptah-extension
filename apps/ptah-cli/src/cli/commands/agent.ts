/**
 * `ptah agent` command — agent surface.
 *
 * Sub-commands per `task-description.md` §3 `agent *` table:
 *
 *   packs list                         RPC `wizard:list-agent-packs`
 *                                      emits `agent.packs.list`
 *   packs install <pack-id>            RPC `wizard:install-pack-agents`
 *                                      emits `agent.pack.install.{start,
 *                                      progress, complete}` (changed:
 *                                      `!fromCache` on second run)
 *   list                               pure `fs.readdir(.ptah/agents)`,
 *                                      NO DI — emits `agent.list`
 *   apply <name>                       resolve via `ContentDownloadService`
 *                                      then write `.ptah/agents/<name>.md`
 *                                      with content-diff (`changed: bool`)
 *                                      emits `agent.applied`
 *
 * `list` deliberately bypasses `withEngine` — a pure fs scan must work on
 * unbootstrapped workspaces and avoid the cost of full DI bootstrap.
 *
 * `apply` uses the ContentDownloadService plugin path (~/.ptah/plugins/) as
 * the agent template source, mirroring the Electron WizardWebview-driven
 * apply flow. The template name resolves to `<plugins>/<name>/agent.md`
 * if that file exists, or a fall-through error otherwise. Content-diff is
 * computed against the existing `.ptah/agents/<name>.md` so re-running with
 * unchanged content emits `changed: false`.
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';

import { container } from 'tsyringe';

import { withEngine } from '../bootstrap/with-engine.js';
import { buildFormatter, type Formatter } from '../output/formatter.js';
import { ExitCode } from '../jsonrpc/types.js';
import type { GlobalOptions } from '../router.js';
import type { CliMessageTransport } from '../../transport/cli-message-transport.js';
import type {
  AgentPackInfoDto,
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
  /** Override hook for tests — defaults to `node:fs/promises.writeFile`. */
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

// ---------------------------------------------------------------------------
// packs list — RPC `wizard:list-agent-packs`
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// packs install — RPC `wizard:install-pack-agents`
// ---------------------------------------------------------------------------

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
    // Resolve the curated pack to get its `source` URL + `agents` list.
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

    await formatter.writeNotification('agent.pack.install.complete', {
      packId,
      source: pack.source,
      agentsDownloaded: result?.agentsDownloaded ?? 0,
      // `fromCache: true` from the backend means "no work was done — files
      // were already there", which is our `changed: false` semantic.
      changed: result ? !result.fromCache : true,
      error: result?.error,
    });
    return ExitCode.Success;
  });
}

// ---------------------------------------------------------------------------
// list — pure fs.readdir, NO DI.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// apply <name> — write .ptah/agents/<name>.md with content-diff.
// ---------------------------------------------------------------------------

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

  return engine(globals, { mode: 'full' }, async () => {
    const pluginsPath =
      hooks.resolvePluginsPath?.() ?? defaultResolvePluginsPath();
    const sourceFile = path.join(pluginsPath, name, 'agent.md');

    const readFile = hooks.readFile ?? ((p: string) => fs.readFile(p, 'utf8'));
    const writeFile =
      hooks.writeFile ?? ((p: string, d: string) => fs.writeFile(p, d, 'utf8'));
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

    let existingContent: string | null = null;
    try {
      const info = await stat(targetFile);
      if (info.isFile()) {
        existingContent = await readFile(targetFile);
      }
    } catch {
      existingContent = null;
    }

    const changed = existingContent !== sourceContent;
    if (changed) {
      await mkdir(targetDir, { recursive: true });
      await writeFile(targetFile, sourceContent);
    }

    await formatter.writeNotification('agent.applied', {
      name,
      path: targetFile,
      source: sourceFile,
      changed,
    });
    return ExitCode.Success;
  });
}

// ---------------------------------------------------------------------------
// Helpers — module-private.
// ---------------------------------------------------------------------------

function defaultResolvePluginsPath(): string {
  // `withEngine` ensures the global container is bootstrapped, so resolving
  // the ContentDownloadService here is safe in production. Tests bypass this
  // path by passing `hooks.resolvePluginsPath`.
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
