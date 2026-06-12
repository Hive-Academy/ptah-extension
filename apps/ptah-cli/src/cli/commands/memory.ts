/**
 * `ptah memory` command — Memory Curator operations.
 *
 * Thin `withEngine({ thoth: 'oneshot' })` wrapper over the `memory:*` RPC
 * namespace exposed in-process over the CLI transport.
 *
 *   list                        RPC `memory:list`    -> memory.list
 *   search <query>              RPC `memory:search`  -> memory.search
 *   get <id>                    RPC `memory:get`     -> memory.entry
 *   stats                       RPC `memory:stats`   -> memory.stats
 *   pin <id>                    RPC `memory:pin`     -> memory.pinned
 *   unpin <id>                  RPC `memory:unpin`   -> memory.pinned
 *   forget <id>                 RPC `memory:forget`  -> memory.forgotten
 *
 * Read verbs (list / search / get / stats) attach a `degraded` field derived
 * from `db:health` + `embedder:status` so callers see when vector search or the
 * embedder is unavailable rather than receiving silently thinner data.
 */

import { withEngine } from '../bootstrap/with-engine.js';
import { buildFormatter, type Formatter } from '../output/formatter.js';
import { ExitCode } from '../jsonrpc/types.js';
import type { GlobalOptions } from '../router.js';
import type { CliMessageTransport } from '../../transport/cli-message-transport.js';
import { callRpc, oneshot } from './thoth-command-shared.js';
import type {
  DbHealthResult,
  EmbedderStatusResult,
  MemoryForgetResult,
  MemoryGetResult,
  MemoryListResult,
  MemoryPinResult,
  MemorySearchResult,
  MemoryStatsResult,
} from '@ptah-extension/shared';

export type MemorySubcommand =
  | 'list'
  | 'search'
  | 'get'
  | 'stats'
  | 'pin'
  | 'unpin'
  | 'forget';

export interface MemoryOptions {
  subcommand: MemorySubcommand;
  /** For `search` — free-form query. */
  query?: string;
  /** For `get` / `pin` / `unpin` / `forget` — memory id. */
  id?: string;
  /** For `list` — tier filter. */
  tier?: string;
  /** For `list` — page size. */
  limit?: number;
  /** For `list` — page offset. */
  offset?: number;
  /** For `search` — max hits. */
  topK?: number;
}

export interface MemoryStderrLike {
  write(chunk: string): boolean;
}

export interface MemoryExecuteHooks {
  stderr?: MemoryStderrLike;
  formatter?: Formatter;
  withEngine?: typeof withEngine;
}

export interface DegradedFlags {
  vec: boolean;
  embedder: boolean;
}

const VALID_TIERS: readonly string[] = ['core', 'recall', 'archival'];

export async function execute(
  opts: MemoryOptions,
  globals: GlobalOptions,
  hooks: MemoryExecuteHooks = {},
): Promise<number> {
  const formatter = hooks.formatter ?? buildFormatter(globals);
  const stderr: MemoryStderrLike = hooks.stderr ?? process.stderr;
  const engine = hooks.withEngine ?? withEngine;

  try {
    switch (opts.subcommand) {
      case 'list':
        return await runList(opts, globals, formatter, stderr, engine);
      case 'search':
        return await runSearch(opts, globals, formatter, stderr, engine);
      case 'get':
        return await runGet(opts, globals, formatter, stderr, engine);
      case 'stats':
        return await runStats(globals, formatter, engine);
      case 'pin':
        return await runPinToggle(
          opts,
          globals,
          formatter,
          stderr,
          engine,
          true,
        );
      case 'unpin':
        return await runPinToggle(
          opts,
          globals,
          formatter,
          stderr,
          engine,
          false,
        );
      case 'forget':
        return await runForget(opts, globals, formatter, stderr, engine);
      default:
        stderr.write(
          `ptah memory: unknown sub-command '${String(opts.subcommand)}'\n`,
        );
        return ExitCode.UsageError;
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    await formatter.writeNotification('task.error', {
      ptah_code: 'internal_failure',
      message,
    });
    return ExitCode.InternalFailure;
  }
}

async function runList(
  opts: MemoryOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  stderr: MemoryStderrLike,
  engine: typeof withEngine,
): Promise<number> {
  if (opts.tier !== undefined && !VALID_TIERS.includes(opts.tier)) {
    stderr.write(
      `ptah memory list: --tier must be one of ${VALID_TIERS.join('|')}\n`,
    );
    return ExitCode.UsageError;
  }

  return engine(globals, oneshot(), async (ctx) => {
    const params: {
      tier?: string;
      limit?: number;
      offset?: number;
    } = {};
    if (opts.tier !== undefined) params.tier = opts.tier;
    if (opts.limit !== undefined) params.limit = opts.limit;
    if (opts.offset !== undefined) params.offset = opts.offset;

    const result = await callRpc<MemoryListResult>(
      ctx.transport,
      'memory:list',
      params,
    );
    const degraded = await probeDegraded(ctx.transport);
    await formatter.writeNotification('memory.list', {
      memories: result?.memories ?? [],
      total: result?.total ?? 0,
      degraded,
    });
    return ExitCode.Success;
  });
}

async function runSearch(
  opts: MemoryOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  stderr: MemoryStderrLike,
  engine: typeof withEngine,
): Promise<number> {
  if (!opts.query || opts.query.trim().length === 0) {
    stderr.write('ptah memory search: <query> is required\n');
    return ExitCode.UsageError;
  }
  const query = opts.query;

  return engine(globals, oneshot(), async (ctx) => {
    const params: { query: string; topK?: number } = { query };
    if (opts.topK !== undefined) params.topK = opts.topK;

    const result = await callRpc<MemorySearchResult>(
      ctx.transport,
      'memory:search',
      params,
    );
    const degraded = await probeDegraded(ctx.transport);
    await formatter.writeNotification('memory.search', {
      query,
      hits: result?.hits ?? [],
      bm25Only: result?.bm25Only ?? false,
      degraded,
    });
    return ExitCode.Success;
  });
}

async function runGet(
  opts: MemoryOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  stderr: MemoryStderrLike,
  engine: typeof withEngine,
): Promise<number> {
  const id = requireId(opts, stderr, 'get');
  if (id === null) return ExitCode.UsageError;

  return engine(globals, oneshot(), async (ctx) => {
    const result = await callRpc<MemoryGetResult>(ctx.transport, 'memory:get', {
      id,
    });
    const degraded = await probeDegraded(ctx.transport);
    await formatter.writeNotification('memory.entry', {
      id,
      memory: result?.memory ?? null,
      chunks: result?.chunks ?? [],
      degraded,
    });
    return ExitCode.Success;
  });
}

async function runStats(
  globals: GlobalOptions,
  formatter: Formatter,
  engine: typeof withEngine,
): Promise<number> {
  return engine(globals, oneshot(), async (ctx) => {
    const result = await callRpc<MemoryStatsResult>(
      ctx.transport,
      'memory:stats',
      {},
    );
    const degraded = await probeDegraded(ctx.transport);
    await formatter.writeNotification('memory.stats', {
      core: result?.core ?? 0,
      recall: result?.recall ?? 0,
      archival: result?.archival ?? 0,
      codeIndex: result?.codeIndex ?? 0,
      lastCuratedAt: result?.lastCuratedAt ?? null,
      degraded,
    });
    return ExitCode.Success;
  });
}

async function runPinToggle(
  opts: MemoryOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  stderr: MemoryStderrLike,
  engine: typeof withEngine,
  pin: boolean,
): Promise<number> {
  const verb = pin ? 'pin' : 'unpin';
  const id = requireId(opts, stderr, verb);
  if (id === null) return ExitCode.UsageError;

  return engine(globals, oneshot(), async (ctx) => {
    const result = await callRpc<MemoryPinResult>(
      ctx.transport,
      pin ? 'memory:pin' : 'memory:unpin',
      { id },
    );
    await formatter.writeNotification('memory.pinned', {
      id,
      success: result?.success ?? false,
      pinned: result?.pinned ?? pin,
    });
    return ExitCode.Success;
  });
}

async function runForget(
  opts: MemoryOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  stderr: MemoryStderrLike,
  engine: typeof withEngine,
): Promise<number> {
  const id = requireId(opts, stderr, 'forget');
  if (id === null) return ExitCode.UsageError;

  return engine(globals, oneshot(), async (ctx) => {
    const result = await callRpc<MemoryForgetResult>(
      ctx.transport,
      'memory:forget',
      { id },
    );
    await formatter.writeNotification('memory.forgotten', {
      id,
      success: result?.success ?? false,
    });
    return ExitCode.Success;
  });
}

function requireId(
  opts: MemoryOptions,
  stderr: MemoryStderrLike,
  verb: string,
): string | null {
  if (!opts.id || opts.id.trim().length === 0) {
    stderr.write(`ptah memory ${verb}: <id> is required\n`);
    return null;
  }
  return opts.id;
}

async function probeDegraded(
  transport: CliMessageTransport,
): Promise<DegradedFlags> {
  let vec = false;
  let embedder = false;
  try {
    const health = await callRpc<DbHealthResult>(transport, 'db:health', {});
    vec = health?.vecExtensionLoaded === false;
  } catch {
    vec = true;
  }
  try {
    const status = await callRpc<EmbedderStatusResult>(
      transport,
      'embedder:status',
      {},
    );
    embedder = status?.status?.ready === false;
  } catch {
    embedder = true;
  }
  return { vec, embedder };
}
