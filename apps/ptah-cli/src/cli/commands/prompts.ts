/**
 * `ptah prompts` command — Enhanced Prompts management (premium-gated).
 *
 * TASK_2026_104 Sub-batch B6c. Backed by the shared `EnhancedPromptsRpcHandlers`
 * (registered globally via `registerAllRpcHandlers()`).
 *
 * Sub-commands (per task-description.md §3.1 `prompts *` table):
 *
 *   status                RPC `enhancedPrompts:getStatus`
 *   enable                RPC `enhancedPrompts:setEnabled` { enabled: true }
 *   disable               RPC `enhancedPrompts:setEnabled` { enabled: false }
 *   regenerate            RPC `enhancedPrompts:regenerate` (premium gate;
 *                                                          streams via
 *                                                          `setup-wizard:enhance-stream`)
 *   show <name>           RPC `enhancedPrompts:getPromptContent`
 *                         (the `<name>` argument is currently informational —
 *                          the backend returns the full combined prompt for
 *                          the workspace; future iterations may filter by
 *                          section name)
 *   download              RPC `enhancedPrompts:download` (writes via
 *                                                        `saveDialogProvider`)
 *
 * The `workspacePath` parameter required by every method is sourced from
 * `globals.cwd` so the surface stays argument-light.
 */

import { withEngine } from '../bootstrap/with-engine.js';
import { buildFormatter, type Formatter } from '../output/formatter.js';
import { ExitCode } from '../jsonrpc/types.js';
import type { GlobalOptions } from '../router.js';
import type { CliMessageTransport } from '../../transport/cli-message-transport.js';
import type {
  EnhancedPromptsGetStatusResponse,
  EnhancedPromptsRegenerateResponse,
  EnhancedPromptsSetEnabledResponse,
} from '@ptah-extension/shared';

export type PromptsSubcommand =
  | 'status'
  | 'enable'
  | 'disable'
  | 'regenerate'
  | 'show'
  | 'download';

export interface PromptsOptions {
  subcommand: PromptsSubcommand;
  /** For `show <name>` — section name (informational; backend currently returns combined prompt). */
  name?: string;
  /** For `regenerate` — force flag forwarded to the RPC. */
  force?: boolean;
}

export interface PromptsStderrLike {
  write(chunk: string): boolean;
}

export interface PromptsExecuteHooks {
  stderr?: PromptsStderrLike;
  formatter?: Formatter;
  withEngine?: typeof withEngine;
}

export async function execute(
  opts: PromptsOptions,
  globals: GlobalOptions,
  hooks: PromptsExecuteHooks = {},
): Promise<number> {
  const formatter = hooks.formatter ?? buildFormatter(globals);
  const stderr: PromptsStderrLike = hooks.stderr ?? process.stderr;
  const engine = hooks.withEngine ?? withEngine;

  try {
    switch (opts.subcommand) {
      case 'status':
        return await runStatus(globals, formatter, engine);
      case 'enable':
        return await runSetEnabled(true, globals, formatter, engine);
      case 'disable':
        return await runSetEnabled(false, globals, formatter, engine);
      case 'regenerate':
        return await runRegenerate(opts, globals, formatter, engine);
      case 'show':
        return await runShow(opts, globals, formatter, engine);
      case 'download':
        return await runDownload(globals, formatter, engine);
      default:
        stderr.write(
          `ptah prompts: unknown sub-command '${String(opts.subcommand)}'\n`,
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
// Sub-commands
// ---------------------------------------------------------------------------

async function runStatus(
  globals: GlobalOptions,
  formatter: Formatter,
  engine: typeof withEngine,
): Promise<number> {
  return engine(globals, { mode: 'full' }, async (ctx) => {
    const result = await callRpc<EnhancedPromptsGetStatusResponse>(
      ctx.transport,
      'enhancedPrompts:getStatus',
      { workspacePath: globals.cwd },
    );
    if (result?.error) {
      throw new Error(result.error);
    }
    await formatter.writeNotification('prompts.status', {
      workspacePath: globals.cwd,
      enabled: result?.enabled ?? false,
      hasGeneratedPrompt: result?.hasGeneratedPrompt ?? false,
      generatedAt: result?.generatedAt ?? null,
      detectedStack: result?.detectedStack ?? null,
      cacheValid: result?.cacheValid ?? false,
      invalidationReason: result?.invalidationReason,
    });
    return ExitCode.Success;
  });
}

async function runSetEnabled(
  enabled: boolean,
  globals: GlobalOptions,
  formatter: Formatter,
  engine: typeof withEngine,
): Promise<number> {
  return engine(globals, { mode: 'full' }, async (ctx) => {
    const result = await callRpc<EnhancedPromptsSetEnabledResponse>(
      ctx.transport,
      'enhancedPrompts:setEnabled',
      { workspacePath: globals.cwd, enabled },
    );
    if (!result?.success) {
      throw new Error(result?.error ?? 'enhancedPrompts:setEnabled failed');
    }
    await formatter.writeNotification(
      enabled ? 'prompts.enabled' : 'prompts.disabled',
      {
        workspacePath: globals.cwd,
        enabled: result.enabled ?? enabled,
      },
    );
    return ExitCode.Success;
  });
}

async function runRegenerate(
  opts: PromptsOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  engine: typeof withEngine,
): Promise<number> {
  return engine(globals, { mode: 'full' }, async (ctx) => {
    await formatter.writeNotification('prompts.regenerate.start', {
      workspacePath: globals.cwd,
      force: opts.force ?? true,
    });

    const result = await callRpc<EnhancedPromptsRegenerateResponse>(
      ctx.transport,
      'enhancedPrompts:regenerate',
      { workspacePath: globals.cwd, force: opts.force ?? true },
    );
    if (!result?.success) {
      throw new Error(result?.error ?? 'enhancedPrompts:regenerate failed');
    }
    await formatter.writeNotification('prompts.regenerate.complete', {
      workspacePath: globals.cwd,
      status: result.status,
    });
    return ExitCode.Success;
  });
}

async function runShow(
  opts: PromptsOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  engine: typeof withEngine,
): Promise<number> {
  return engine(globals, { mode: 'full' }, async (ctx) => {
    const result = await callRpc<{ content: string | null; error?: string }>(
      ctx.transport,
      'enhancedPrompts:getPromptContent',
      { workspacePath: globals.cwd },
    );
    if (result?.error) {
      throw new Error(result.error);
    }
    await formatter.writeNotification('prompts.content', {
      workspacePath: globals.cwd,
      name: opts.name,
      content: result?.content ?? null,
    });
    return ExitCode.Success;
  });
}

async function runDownload(
  globals: GlobalOptions,
  formatter: Formatter,
  engine: typeof withEngine,
): Promise<number> {
  return engine(globals, { mode: 'full' }, async (ctx) => {
    const result = await callRpc<{
      success: boolean;
      filePath?: string;
      error?: string;
    }>(ctx.transport, 'enhancedPrompts:download', {
      workspacePath: globals.cwd,
    });
    if (!result?.success) {
      throw new Error(result?.error ?? 'enhancedPrompts:download failed');
    }
    await formatter.writeNotification('prompts.download.complete', {
      workspacePath: globals.cwd,
      filePath: result.filePath,
    });
    return ExitCode.Success;
  });
}

// ---------------------------------------------------------------------------
// Helpers — kept module-private.
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
