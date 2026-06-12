/**
 * `ptah skill-synthesis` command — synthesized-skill candidate operations.
 *
 * Thin `withEngine({ thoth: 'oneshot' })` wrapper over the `skillSynthesis:*`
 * RPC namespace exposed in-process over the CLI transport. This is a SIBLING of
 * `ptah skill` (which manages skills.sh packs) — that surface is untouched.
 *
 *   list                        RPC `skillSynthesis:listCandidates` -> skill_synthesis.list
 *   get <id>                    RPC `skillSynthesis:getCandidate`   -> skill_synthesis.candidate
 *   promote <id>                RPC `skillSynthesis:promote`        -> skill_synthesis.promoted
 *   reject <id>                 RPC `skillSynthesis:reject`         -> skill_synthesis.rejected
 *   invocations <skillId>       RPC `skillSynthesis:invocations`    -> skill_synthesis.invocations
 *   stats                       RPC `skillSynthesis:stats`          -> skill_synthesis.stats
 */

import { withEngine } from '../bootstrap/with-engine.js';
import { buildFormatter, type Formatter } from '../output/formatter.js';
import { ExitCode } from '../jsonrpc/types.js';
import type { GlobalOptions } from '../router.js';
import type { CliMessageTransport } from '../../transport/cli-message-transport.js';
import type {
  SkillSynthesisGetCandidateResult,
  SkillSynthesisInvocationsResult,
  SkillSynthesisListCandidatesResult,
  SkillSynthesisPromoteResult,
  SkillSynthesisRejectResult,
  SkillSynthesisStatsResult,
} from '@ptah-extension/shared';

export type SkillSynthesisSubcommand =
  | 'list'
  | 'get'
  | 'promote'
  | 'reject'
  | 'invocations'
  | 'stats';

export interface SkillSynthesisOptions {
  subcommand: SkillSynthesisSubcommand;
  /** For `get` / `promote` / `reject` — candidate id. */
  id?: string;
  /** For `invocations` — skill id. */
  skillId?: string;
  /** For `list` — status filter. */
  status?: string;
  /** For `list` / `invocations` — page size. */
  limit?: number;
  /** For `reject` — optional reason. */
  reason?: string;
}

export interface SkillSynthesisStderrLike {
  write(chunk: string): boolean;
}

export interface SkillSynthesisExecuteHooks {
  stderr?: SkillSynthesisStderrLike;
  formatter?: Formatter;
  withEngine?: typeof withEngine;
}

const VALID_STATUSES: readonly string[] = [
  'candidate',
  'promoted',
  'rejected',
  'all',
];

export async function execute(
  opts: SkillSynthesisOptions,
  globals: GlobalOptions,
  hooks: SkillSynthesisExecuteHooks = {},
): Promise<number> {
  const formatter = hooks.formatter ?? buildFormatter(globals);
  const stderr: SkillSynthesisStderrLike = hooks.stderr ?? process.stderr;
  const engine = hooks.withEngine ?? withEngine;

  try {
    switch (opts.subcommand) {
      case 'list':
        return await runList(opts, globals, formatter, stderr, engine);
      case 'get':
        return await runGet(opts, globals, formatter, stderr, engine);
      case 'promote':
        return await runPromote(opts, globals, formatter, stderr, engine);
      case 'reject':
        return await runReject(opts, globals, formatter, stderr, engine);
      case 'invocations':
        return await runInvocations(opts, globals, formatter, stderr, engine);
      case 'stats':
        return await runStats(globals, formatter, engine);
      default:
        stderr.write(
          `ptah skill-synthesis: unknown sub-command '${String(opts.subcommand)}'\n`,
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
  opts: SkillSynthesisOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  stderr: SkillSynthesisStderrLike,
  engine: typeof withEngine,
): Promise<number> {
  if (opts.status !== undefined && !VALID_STATUSES.includes(opts.status)) {
    stderr.write(
      `ptah skill-synthesis list: --status must be one of ${VALID_STATUSES.join('|')}\n`,
    );
    return ExitCode.UsageError;
  }

  return engine(globals, oneshot(), async (ctx) => {
    const params: {
      status?: 'candidate' | 'promoted' | 'rejected' | 'all';
      limit?: number;
    } = {};
    if (opts.status !== undefined) {
      params.status = opts.status as
        | 'candidate'
        | 'promoted'
        | 'rejected'
        | 'all';
    }
    if (opts.limit !== undefined) params.limit = opts.limit;

    const result = await callRpc<SkillSynthesisListCandidatesResult>(
      ctx.transport,
      'skillSynthesis:listCandidates',
      params,
    );
    await formatter.writeNotification('skill_synthesis.list', {
      candidates: result?.candidates ?? [],
    });
    return ExitCode.Success;
  });
}

async function runGet(
  opts: SkillSynthesisOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  stderr: SkillSynthesisStderrLike,
  engine: typeof withEngine,
): Promise<number> {
  const id = requireId(opts, stderr, 'get');
  if (id === null) return ExitCode.UsageError;

  return engine(globals, oneshot(), async (ctx) => {
    const result = await callRpc<SkillSynthesisGetCandidateResult>(
      ctx.transport,
      'skillSynthesis:getCandidate',
      { id },
    );
    await formatter.writeNotification('skill_synthesis.candidate', {
      id,
      candidate: result?.candidate ?? null,
    });
    return ExitCode.Success;
  });
}

async function runPromote(
  opts: SkillSynthesisOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  stderr: SkillSynthesisStderrLike,
  engine: typeof withEngine,
): Promise<number> {
  const id = requireId(opts, stderr, 'promote');
  if (id === null) return ExitCode.UsageError;

  return engine(globals, oneshot(), async (ctx) => {
    const result = await callRpc<SkillSynthesisPromoteResult>(
      ctx.transport,
      'skillSynthesis:promote',
      { id },
    );
    await formatter.writeNotification('skill_synthesis.promoted', {
      id,
      promoted: result?.promoted ?? false,
      reason: result?.reason ?? null,
      filePath: result?.filePath ?? null,
    });
    return ExitCode.Success;
  });
}

async function runReject(
  opts: SkillSynthesisOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  stderr: SkillSynthesisStderrLike,
  engine: typeof withEngine,
): Promise<number> {
  const id = requireId(opts, stderr, 'reject');
  if (id === null) return ExitCode.UsageError;

  return engine(globals, oneshot(), async (ctx) => {
    const params: { id: string; reason?: string } = { id };
    if (opts.reason !== undefined) params.reason = opts.reason;

    const result = await callRpc<SkillSynthesisRejectResult>(
      ctx.transport,
      'skillSynthesis:reject',
      params,
    );
    await formatter.writeNotification('skill_synthesis.rejected', {
      id,
      rejected: result?.rejected ?? false,
    });
    if (result?.rejected === false) return ExitCode.UsageError;
    return ExitCode.Success;
  });
}

async function runInvocations(
  opts: SkillSynthesisOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  stderr: SkillSynthesisStderrLike,
  engine: typeof withEngine,
): Promise<number> {
  if (!opts.skillId || opts.skillId.trim().length === 0) {
    stderr.write('ptah skill-synthesis invocations: <skillId> is required\n');
    return ExitCode.UsageError;
  }
  const skillId = opts.skillId;

  return engine(globals, oneshot(), async (ctx) => {
    const params: { skillId: string; limit?: number } = { skillId };
    if (opts.limit !== undefined) params.limit = opts.limit;

    const result = await callRpc<SkillSynthesisInvocationsResult>(
      ctx.transport,
      'skillSynthesis:invocations',
      params,
    );
    await formatter.writeNotification('skill_synthesis.invocations', {
      skillId,
      invocations: result?.invocations ?? [],
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
    const result = await callRpc<SkillSynthesisStatsResult>(
      ctx.transport,
      'skillSynthesis:stats',
      {},
    );
    await formatter.writeNotification('skill_synthesis.stats', {
      totalCandidates: result?.totalCandidates ?? 0,
      totalPromoted: result?.totalPromoted ?? 0,
      totalRejected: result?.totalRejected ?? 0,
      totalInvocations: result?.totalInvocations ?? 0,
      activeSkills: result?.activeSkills ?? 0,
    });
    return ExitCode.Success;
  });
}

function oneshot(): {
  mode: 'full';
  requireSdk: false;
  thoth: 'oneshot';
} {
  return { mode: 'full', requireSdk: false, thoth: 'oneshot' };
}

function requireId(
  opts: SkillSynthesisOptions,
  stderr: SkillSynthesisStderrLike,
  verb: string,
): string | null {
  if (!opts.id || opts.id.trim().length === 0) {
    stderr.write(`ptah skill-synthesis ${verb}: <id> is required\n`);
    return null;
  }
  return opts.id.trim();
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
