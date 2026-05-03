/**
 * `ptah websearch` command — search provider settings + connectivity test.
 *
 * TASK_2026_104 Sub-batch B5d.
 *
 * Sub-commands (per task-description.md §3.1) — all delegate to the shared
 * WebSearchRpcHandlers:
 *
 *   status                          RPC `webSearch:getApiKeyStatus` (per
 *                                   provider — gathered for the active
 *                                   provider only)
 *   set-key --provider <p> --key <k>  RPC `webSearch:setApiKey`
 *   remove-key --provider <p>       RPC `webSearch:deleteApiKey`
 *   test                            RPC `webSearch:test`
 *   config get                      RPC `webSearch:getConfig`
 *   config set --provider <p> --max-results <n>   RPC `webSearch:setConfig`
 *
 * `status` and `config get` redact secrets unless `--reveal` is set globally.
 *
 * No DI mocking in production; tests inject hooks via {@link WebsearchExecuteHooks}.
 */

import { withEngine } from '../bootstrap/with-engine.js';
import { buildFormatter, type Formatter } from '../output/formatter.js';
import { redact } from '../output/redactor.js';
import { ExitCode } from '../jsonrpc/types.js';
import type { GlobalOptions } from '../router.js';
import type { CliMessageTransport } from '../../transport/cli-message-transport.js';

export type WebsearchSubcommand =
  | 'status'
  | 'set-key'
  | 'remove-key'
  | 'test'
  | 'config-get'
  | 'config-set';

export interface WebsearchOptions {
  subcommand: WebsearchSubcommand;
  /** set-key / remove-key / config-set */
  provider?: string;
  /** set-key */
  key?: string;
  /** config-set */
  maxResults?: number;
}

export interface WebsearchStderrLike {
  write(chunk: string): boolean;
}

export interface WebsearchExecuteHooks {
  stderr?: WebsearchStderrLike;
  formatter?: Formatter;
  withEngine?: typeof withEngine;
}

export async function execute(
  opts: WebsearchOptions,
  globals: GlobalOptions,
  hooks: WebsearchExecuteHooks = {},
): Promise<number> {
  const formatter = hooks.formatter ?? buildFormatter(globals);
  const stderr: WebsearchStderrLike = hooks.stderr ?? process.stderr;
  const engine = hooks.withEngine ?? withEngine;

  try {
    switch (opts.subcommand) {
      case 'status':
        return await runStatus(opts, globals, formatter, engine);
      case 'set-key':
        return await runSetKey(opts, globals, formatter, stderr, engine);
      case 'remove-key':
        return await runRemoveKey(opts, globals, formatter, stderr, engine);
      case 'test':
        return await runTest(globals, formatter, engine);
      case 'config-get':
        return await runConfigGet(globals, formatter, engine);
      case 'config-set':
        return await runConfigSet(opts, globals, formatter, stderr, engine);
      default:
        stderr.write(
          `ptah websearch: unknown sub-command '${String(opts.subcommand)}'\n`,
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

async function runStatus(
  opts: WebsearchOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  engine: typeof withEngine,
): Promise<number> {
  return engine(globals, { mode: 'full' }, async (ctx) => {
    // First learn the active provider (so `status` without --provider answers
    // the most useful question: "is the active provider configured?").
    const config = await callRpc<{ provider?: string; maxResults?: number }>(
      ctx.transport,
      'webSearch:getConfig',
      {},
    );
    const provider = opts.provider ?? config?.provider ?? 'tavily';
    const status = await callRpc<{ configured?: boolean }>(
      ctx.transport,
      'webSearch:getApiKeyStatus',
      { provider },
    );
    await formatter.writeNotification(
      'websearch.status',
      redact(
        {
          provider,
          configured: status?.configured === true,
          maxResults: config?.maxResults,
        },
        { reveal: globals.reveal },
      ),
    );
    return ExitCode.Success;
  });
}

async function runSetKey(
  opts: WebsearchOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  stderr: WebsearchStderrLike,
  engine: typeof withEngine,
): Promise<number> {
  if (!opts.provider) {
    stderr.write('ptah websearch set-key: --provider is required\n');
    return ExitCode.UsageError;
  }
  if (!opts.key) {
    stderr.write('ptah websearch set-key: --key is required\n');
    return ExitCode.UsageError;
  }
  const key = Array.isArray(opts.key) ? opts.key[0] : opts.key;
  return engine(globals, { mode: 'full' }, async (ctx) => {
    await callRpc<{ success?: boolean }>(ctx.transport, 'webSearch:setApiKey', {
      provider: opts.provider,
      apiKey: key,
    });
    await formatter.writeNotification('websearch.updated', {
      provider: opts.provider,
      action: 'set-key',
    });
    return ExitCode.Success;
  });
}

async function runRemoveKey(
  opts: WebsearchOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  stderr: WebsearchStderrLike,
  engine: typeof withEngine,
): Promise<number> {
  if (!opts.provider) {
    stderr.write('ptah websearch remove-key: --provider is required\n');
    return ExitCode.UsageError;
  }
  return engine(globals, { mode: 'full' }, async (ctx) => {
    await callRpc<{ success?: boolean }>(
      ctx.transport,
      'webSearch:deleteApiKey',
      { provider: opts.provider },
    );
    await formatter.writeNotification('websearch.updated', {
      provider: opts.provider,
      action: 'remove-key',
    });
    return ExitCode.Success;
  });
}

async function runTest(
  globals: GlobalOptions,
  formatter: Formatter,
  engine: typeof withEngine,
): Promise<number> {
  return engine(globals, { mode: 'full' }, async (ctx) => {
    const result = await callRpc<{
      success?: boolean;
      provider?: string;
      error?: string;
    }>(ctx.transport, 'webSearch:test', {});
    await formatter.writeNotification('websearch.test', {
      success: result?.success === true,
      provider: result?.provider,
      error: result?.error,
    });
    return result?.success === true ? ExitCode.Success : ExitCode.GeneralError;
  });
}

async function runConfigGet(
  globals: GlobalOptions,
  formatter: Formatter,
  engine: typeof withEngine,
): Promise<number> {
  return engine(globals, { mode: 'full' }, async (ctx) => {
    const result = await callRpc<unknown>(
      ctx.transport,
      'webSearch:getConfig',
      {},
    );
    await formatter.writeNotification(
      'websearch.config',
      redact(wrapResult(result), { reveal: globals.reveal }),
    );
    return ExitCode.Success;
  });
}

async function runConfigSet(
  opts: WebsearchOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  stderr: WebsearchStderrLike,
  engine: typeof withEngine,
): Promise<number> {
  if (opts.provider === undefined && opts.maxResults === undefined) {
    stderr.write(
      'ptah websearch config set: at least one of --provider or --max-results is required\n',
    );
    return ExitCode.UsageError;
  }
  return engine(globals, { mode: 'full' }, async (ctx) => {
    const params: Record<string, unknown> = {};
    if (opts.provider !== undefined) params['provider'] = opts.provider;
    if (opts.maxResults !== undefined) params['maxResults'] = opts.maxResults;
    await callRpc<{ success?: boolean }>(
      ctx.transport,
      'webSearch:setConfig',
      params,
    );
    await formatter.writeNotification('websearch.config', params);
    return ExitCode.Success;
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function wrapResult(result: unknown): Record<string, unknown> {
  if (result === null || result === undefined) return {};
  if (typeof result === 'object' && !Array.isArray(result)) {
    return result as Record<string, unknown>;
  }
  return { result };
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
