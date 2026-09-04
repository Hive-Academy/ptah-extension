/**
 * `ptah websearch` command — search provider settings + connectivity test.
 *
 * Sub-commands (per task-description.md §3.1) — all delegate to the shared
 * WebSearchRpcHandlers:
 *
 *   status [--provider <p[,p]>]     RPC `webSearch:getApiKeyStatus` (once per
 *                                   configured provider, or per override)
 *   set-key --provider <p> --key <k>  RPC `webSearch:setApiKey`
 *   remove-key --provider <p>       RPC `webSearch:deleteApiKey`
 *   test                            RPC `webSearch:test`
 *   config get                      RPC `webSearch:getConfig`
 *   config set --provider <p[,p]> --max-results <n>   RPC `webSearch:setConfig`
 *
 * `status` and `config get` redact secrets unless `--reveal` is set globally.
 *
 * No DI mocking in production; tests inject hooks via {@link WebsearchExecuteHooks}.
 */

import { withEngine } from '@ptah-extension/cli-engine';
import { buildFormatter, type Formatter } from '../output/formatter.js';
import { redact } from '../output/redactor.js';
import { ExitCode } from '../jsonrpc/types.js';
import type { GlobalOptions } from '../router.js';
import type { CliMessageTransport } from '@ptah-extension/cli-engine';

const VALID_WEBSEARCH_PROVIDERS = ['tavily', 'serper', 'exa'] as const;

type WebSearchProvider = (typeof VALID_WEBSEARCH_PROVIDERS)[number];

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
        return await runStatus(opts, globals, formatter, stderr, engine);
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
  stderr: WebsearchStderrLike,
  engine: typeof withEngine,
): Promise<number> {
  const overrides =
    opts.provider === undefined
      ? undefined
      : parseProviderList(opts.provider, stderr, 'status');
  if (overrides === null) return ExitCode.UsageError;

  return engine(globals, { mode: 'full' }, async (ctx) => {
    const config = await callRpc<{
      providers?: WebSearchProvider[];
      maxResults?: number;
    }>(ctx.transport, 'webSearch:getConfig', {});
    const configuredProviders = config?.providers?.length
      ? config.providers
      : ['tavily'];
    const providers = overrides ?? configuredProviders;

    for (const provider of providers) {
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
    }
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
      results?: Array<{
        provider: string;
        success: boolean;
        error?: string;
      }>;
    }>(ctx.transport, 'webSearch:test', {});
    for (const providerResult of result?.results ?? []) {
      await formatter.writeNotification('websearch.test', {
        provider: providerResult.provider,
        success: providerResult.success,
        error: providerResult.error,
      });
    }
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

  const providers =
    opts.provider === undefined
      ? undefined
      : parseProviderList(opts.provider, stderr, 'config set');
  if (providers === null) return ExitCode.UsageError;

  return engine(globals, { mode: 'full' }, async (ctx) => {
    const params: Record<string, unknown> = {};
    if (providers !== undefined) params['providers'] = providers;
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

function parseProviderList(
  raw: string,
  stderr: WebsearchStderrLike,
  command: string,
): WebSearchProvider[] | null {
  const values = Array.from(
    new Set(
      raw
        .split(',')
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
    ),
  );

  if (values.length === 0) {
    stderr.write(
      `ptah websearch ${command}: --provider must contain at least one provider (tavily, serper, or exa)\n`,
    );
    return null;
  }

  const unknown = values.filter((value) => !isWebSearchProvider(value));
  if (unknown.length > 0) {
    stderr.write(
      `ptah websearch ${command}: unknown provider${unknown.length === 1 ? '' : 's'} '${unknown.join(', ')}'; expected tavily, serper, or exa\n`,
    );
    return null;
  }

  return values.filter(isWebSearchProvider);
}

function isWebSearchProvider(value: string): value is WebSearchProvider {
  return (VALID_WEBSEARCH_PROVIDERS as readonly string[]).includes(value);
}

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
