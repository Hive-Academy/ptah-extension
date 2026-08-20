/**
 * `ptah agent-cli` command — agent CLI surface.
 *
 * Sub-commands per `task-description.md` §3 `agent-cli *` table:
 *
 *   detect                                          RPC `agent:detectClis`
 *                                                   emits `agent_cli.detection`
 *   config get                                      RPC `agent:getConfig`
 *                                                   emits `agent_cli.config`
 *   config set --key <k> --value <v>                RPC `agent:setConfig`
 *                                                   emits `agent_cli.config.updated`
 *   models list [--cli <id>]                        RPC `agent:listCliModels`
 *                                                   emits `agent_cli.models`
 *   stop <id> [--cli <id>]                          RPC `agent:stop`
 *                                                   emits `agent_cli.stopped`
 *   resume <id> --cli <id> --task <text>            RPC `agent:resumeCliSession`
 *   [--ptah-cli-id <id>]                            emits `agent_cli.resumed`
 *
 * **`--cli` NAMES A TARGET; IT DOES NOT ASK PERMISSION** (TASK_2026_297 phase 2).
 *
 * This file used to hold `CLI_AGENT_ALLOWLIST = ['glm']` and call it a locked
 * policy. It was not a policy, it was an accident of subtraction. `ptah
 * agent-cli` shipped with `['glm', 'gemini']` when `gemini` was a real member of
 * `CliType`; two later commits removed Gemini from the type and from the list,
 * deleting the entry that worked and leaving the one that never did. Meanwhile
 * `CliDetectionService` registered six spawnable adapters — `codex`, `copilot`,
 * `cursor`, `antigravity`, `opencode`, `pi` — every one of them rejected here
 * with exit 3, and nothing blocked at the runtime layer at all. The README's
 * "copilot and cursor are blocked due to Windows spawn issues" outlived its
 * cause and was never revisited when those adapters landed.
 *
 * So there is no gate any more. {@link CLI_AGENT_SELECTORS} is the set of values
 * `--cli` can NAME, and it is DERIVED from `SYSTEM_CLI_TYPES` — the declared
 * single source of truth — rather than re-listed here. A seventh adapter becomes
 * reachable from this CLI the moment it is added there, which is precisely how
 * these six failed to.
 *
 * **Two vocabularies, one translation point.** A selector is what the user
 * types; `CliType` is what goes on the wire. For the six system CLIs those
 * coincide. They do not for `glm`, which names an Anthropic-compatible provider
 * (Z.AI GLM) reached through the `'ptah-cli'` wire value and addressed by
 * `ptahCliId` — never a binary on PATH. This file used to bridge that gap with
 * `allowed as unknown as CliType`, a cast a single `as` could not even express
 * because the types do not overlap, and `resume` threw "glm CLI is not
 * installed" for its entire life. `glm` survives only as a DEPRECATED ALIAS for
 * `--cli ptah-cli`, because it is documented in four places including a skill
 * that ships to users; it writes a deprecation notice to stderr.
 *
 * {@link CLI_AGENT_TARGETS} is the one place the two vocabularies meet, and it
 * stays a `Record<CliAgentSelector, CliAgentTarget>` on purpose: the accepted
 * SET is derived, but each selector's wire MEANING must still be declared, so a
 * future non-identity selector cannot be added without deciding what it maps to.
 *
 * Rejection of an unknown selector still emits `task.error` with
 * `ptah_code: 'cli_agent_unavailable'` and exits `ExitCode.AuthRequired = 3` —
 * that code is documented on the wire and is kept even though the internal
 * vocabulary changed. The check reads `opts.cli` only;
 * `process.env.PTAH_AGENT_CLI_OVERRIDE` is never consulted, because there is
 * nothing left for it to override.
 */

import { withEngine } from '@ptah-extension/cli-engine';
import { SYSTEM_CLI_TYPES } from '@ptah-extension/shared';
import { buildFormatter, type Formatter } from '../output/formatter.js';
import { ExitCode } from '../jsonrpc/types.js';
import type { GlobalOptions } from '../router.js';
import type { CliMessageTransport } from '@ptah-extension/cli-engine';
import type {
  AgentOrchestrationConfig,
  AgentSetConfigParams,
  AgentListCliModelsResult,
  CliDetectionResult,
  CliType,
  SystemCliType,
} from '@ptah-extension/shared';

/**
 * Every value `--cli` accepts, in the user's vocabulary.
 *
 * DERIVED, not re-listed. The six system CLIs come straight from
 * `SYSTEM_CLI_TYPES`, so adding a seventh adapter makes it selectable here with
 * no edit to this file — the exact failure mode that left `codex`, `copilot`,
 * `cursor`, `antigravity`, `opencode` and `pi` unreachable behind a
 * single-entry list for their whole existence. `ptah-cli` is appended because it
 * is deliberately not a member of the system family (see `agent-process.types.ts`).
 * `glm` is appended as a deprecated alias and nothing more.
 *
 * This mirrors `agent-rpc.schema.ts`'s `CLI_TYPES`, which derives its zod enum
 * the same way, so the CLI cannot name a target the boundary would refuse.
 */
export const CLI_AGENT_SELECTORS = [
  ...SYSTEM_CLI_TYPES,
  'ptah-cli',
  'glm',
] as const;

/** A value the user may pass to `--cli`. */
export type CliAgentSelector = (typeof CLI_AGENT_SELECTORS)[number];

export type AgentCliSubcommand =
  | 'detect'
  | 'config-get'
  | 'config-set'
  | 'models-list'
  | 'stop'
  | 'resume';

export interface AgentCliOptions {
  subcommand: AgentCliSubcommand;
  /** For `config set` — settings key. */
  key?: string;
  /** For `config set` — settings value (string; the command coerces booleans/numbers). */
  value?: string;
  /**
   * For `models list [--cli]`, `stop [--cli]` (both optional), `resume --cli`
   * (required). A raw string, narrowed by {@link resolveCliAgentSelector} —
   * this is the user's vocabulary, not `CliType`.
   */
  cli?: string;
  /** For `stop <id>`. */
  agentId?: string;
  /** For `resume <id>`. */
  cliSessionId?: string;
  /**
   * For `resume` — the work to hand the resumed session. REQUIRED and
   * non-empty: `agent:resumeCliSession` means "resume this session AND give it
   * this task", so an empty task is a caller that lost its prompt, not a caller
   * with nothing to say. The boundary schema enforces the same rule with
   * `.min(1)` (TASK_2026_296).
   */
  task?: string;
  /**
   * For `resume` — which configured Ptah CLI provider to resume on. Optional:
   * when absent the field is OMITTED from the wire payload entirely and the
   * backend's `resolveDefaultPtahCliId()` picks the first enabled provider that
   * has a key. Never defaulted here — the CLI has no provider list to resolve
   * against, and the backend already errors actionably when none is configured.
   */
  ptahCliId?: string;
}

export interface AgentCliStderrLike {
  write(chunk: string): boolean;
}

export interface AgentCliExecuteHooks {
  stderr?: AgentCliStderrLike;
  formatter?: Formatter;
  withEngine?: typeof withEngine;
}

export async function execute(
  opts: AgentCliOptions,
  globals: GlobalOptions,
  hooks: AgentCliExecuteHooks = {},
): Promise<number> {
  const formatter = hooks.formatter ?? buildFormatter(globals);
  const stderr: AgentCliStderrLike = hooks.stderr ?? process.stderr;
  const engine = hooks.withEngine ?? withEngine;

  try {
    switch (opts.subcommand) {
      case 'detect':
        return await runDetect(globals, formatter, engine);
      case 'config-get':
        return await runConfigGet(globals, formatter, engine);
      case 'config-set':
        return await runConfigSet(opts, globals, formatter, stderr, engine);
      case 'models-list':
        return await runModelsList(opts, globals, formatter, stderr, engine);
      case 'stop':
        return await runStop(opts, globals, formatter, stderr, engine);
      case 'resume':
        return await runResume(opts, globals, formatter, stderr, engine);
      default:
        stderr.write(
          `ptah agent-cli: unknown sub-command '${String(opts.subcommand)}'\n`,
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

/**
 * Narrow a raw `--cli` string to a known selector, or `null` when it names no
 * target at all.
 *
 * Exact, case-sensitive match — `'GLM'` and `'glm '` are still unknown, because
 * a near-miss is a typo and answering it would guess at intent.
 *
 * NEVER reads `process.env.PTAH_AGENT_CLI_OVERRIDE` or any other env var. That
 * used to matter because there was a policy an env var might have loosened;
 * now there is simply nothing to override — every registered adapter is already
 * selectable — and the tests keep the env var inert so it cannot come back as a
 * side channel.
 */
export function resolveCliAgentSelector(
  cli: string | undefined,
): CliAgentSelector | null {
  if (cli === undefined) return null;
  return CLI_AGENT_SELECTORS.find((selector) => selector === cli) ?? null;
}

/**
 * How a selector is addressed on the wire.
 *
 * `cli` is the `CliType` the backend routes on. `ptahCliId` names a specific
 * configured provider; leaving it undefined means "let the backend resolve its
 * default", which is a real, implemented path — not a gap.
 */
export interface CliAgentTarget {
  readonly cli: CliType;
  /** Omitted from the payload when undefined. Never invented. */
  readonly ptahCliId?: string;
  /**
   * Set only on deprecated aliases. Written to stderr when the selector is
   * used, and the reason the alias still exists at all.
   */
  readonly deprecation?: string;
}

/**
 * The six system CLIs, whose wire meaning is their own name.
 *
 * Built from `SYSTEM_CLI_TYPES` rather than written out, so a seventh adapter
 * needs no decision here: a system CLI's `CliType` IS its selector. The single
 * assertion is provable — the loop writes one entry per member of the very
 * tuple that defines the key union — and is not the `as unknown as` this task
 * deleted, which bridged two types that do not overlap.
 */
const SYSTEM_CLI_TARGETS: Record<SystemCliType, CliAgentTarget> = (() => {
  const table: Partial<Record<SystemCliType, CliAgentTarget>> = {};
  for (const cli of SYSTEM_CLI_TYPES) {
    table[cli] = { cli };
  }
  return table as Record<SystemCliType, CliAgentTarget>;
})();

/**
 * The selector → wire vocabulary translation table.
 *
 * `Record<CliAgentSelector, CliAgentTarget>` is doing real work: it makes the
 * mapping TOTAL. The accepted SET is derived, but each selector's MEANING is
 * still declared, so a future non-identity selector is a compile error until
 * someone decides what it maps to — precisely the check that was missing when
 * `'glm'` was cast straight into `CliType`.
 *
 * Neither ptah-cli entry carries a `ptahCliId`: which provider to use is
 * whichever one the user configured, so the id belongs to their settings, not
 * to this table. Absence routes to the backend's `resolveDefaultPtahCliId()`;
 * `--ptah-cli-id` overrides it.
 */
const CLI_AGENT_TARGETS: Record<CliAgentSelector, CliAgentTarget> = {
  ...SYSTEM_CLI_TARGETS,
  'ptah-cli': { cli: 'ptah-cli' },
  glm: {
    cli: 'ptah-cli',
    deprecation:
      "'--cli glm' is deprecated: GLM is an Anthropic-compatible provider " +
      'reached through the ptah-cli agent type, not a CLI binary. Use ' +
      '`--cli ptah-cli [--ptah-cli-id <id>]` instead.',
  },
};

/**
 * Translate a resolved selector into the wire vocabulary.
 *
 * Total by construction — the argument is already narrowed to
 * {@link CliAgentSelector} by {@link resolveCliAgentSelector}, so there is no
 * failure mode and no cast.
 */
export function resolveCliAgentTarget(
  selector: CliAgentSelector,
): CliAgentTarget {
  return CLI_AGENT_TARGETS[selector];
}

/**
 * Write the deprecation notice for a selector, if it has one.
 *
 * stderr, not a `task.error`: the command still succeeds, and a notification on
 * stdout would be an extra frame every NDJSON consumer would have to skip.
 */
function noteSelectorDeprecation(
  selector: CliAgentSelector,
  stderr: AgentCliStderrLike,
): void {
  const { deprecation } = resolveCliAgentTarget(selector);
  if (deprecation !== undefined) {
    stderr.write(`ptah agent-cli: ${deprecation}\n`);
  }
}

/**
 * Emit a `task.error` notification carrying `ptah_code: 'cli_agent_unavailable'`.
 * Returns `ExitCode.AuthRequired` per spec §4.4 + verification spec line 408.
 *
 * The `ptah_code` and the `data` shape are the DOCUMENTED wire contract and are
 * kept verbatim even though this is no longer an allowlist rejection — only
 * what fills `allowed` changed, from one label that could never route to every
 * target that can. The condition is now what the name always claimed: the
 * requested CLI agent is not one this build knows about.
 */
async function emitCliAgentUnavailable(
  formatter: Formatter,
  requestedCli: string,
): Promise<number> {
  await formatter.writeNotification('task.error', {
    ptah_code: 'cli_agent_unavailable',
    message:
      `CLI agent '${requestedCli}' is not a known target. Valid values: ` +
      `${CLI_AGENT_SELECTORS.join(', ')}.`,
    data: {
      requested_cli: requestedCli,
      allowed: [...CLI_AGENT_SELECTORS],
    },
  });
  return ExitCode.AuthRequired;
}

async function runDetect(
  globals: GlobalOptions,
  formatter: Formatter,
  engine: typeof withEngine,
): Promise<number> {
  return engine(globals, { mode: 'full' }, async (ctx) => {
    const result = await callRpc<{ clis: CliDetectionResult[] }>(
      ctx.transport,
      'agent:detectClis',
      undefined,
    );
    await formatter.writeNotification('agent_cli.detection', {
      clis: result?.clis ?? [],
    });
    return ExitCode.Success;
  });
}

async function runConfigGet(
  globals: GlobalOptions,
  formatter: Formatter,
  engine: typeof withEngine,
): Promise<number> {
  return engine(globals, { mode: 'full' }, async (ctx) => {
    const result = await callRpc<AgentOrchestrationConfig>(
      ctx.transport,
      'agent:getConfig',
      undefined,
    );
    await formatter.writeNotification('agent_cli.config', {
      config: result,
    });
    return ExitCode.Success;
  });
}

async function runConfigSet(
  opts: AgentCliOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  stderr: AgentCliStderrLike,
  engine: typeof withEngine,
): Promise<number> {
  if (!opts.key || opts.key.trim().length === 0) {
    stderr.write('ptah agent-cli config set: --key is required\n');
    return ExitCode.UsageError;
  }
  if (opts.value === undefined) {
    stderr.write('ptah agent-cli config set: --value is required\n');
    return ExitCode.UsageError;
  }
  const params = buildSetConfigParams(opts.key, opts.value);

  return engine(globals, { mode: 'full' }, async (ctx) => {
    const result = await callRpc<{ success: boolean; error?: string }>(
      ctx.transport,
      'agent:setConfig',
      params,
    );
    if (!result?.success) {
      throw new Error(result?.error ?? 'agent:setConfig failed');
    }
    await formatter.writeNotification('agent_cli.config.updated', {
      key: opts.key,
      value: params[opts.key as keyof AgentSetConfigParams],
    });
    return ExitCode.Success;
  });
}

async function runModelsList(
  opts: AgentCliOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  stderr: AgentCliStderrLike,
  engine: typeof withEngine,
): Promise<number> {
  if (opts.cli !== undefined) {
    const selector = resolveCliAgentSelector(opts.cli);
    if (selector === null) {
      return await emitCliAgentUnavailable(formatter, opts.cli);
    }
    noteSelectorDeprecation(selector, stderr);

    const wireCli = resolveCliAgentTarget(selector).cli;

    // A ptah-cli-scoped answer IS structurally unanswerable, and says so.
    //
    // `AgentListCliModelsResult` has one field per SYSTEM CLI and no ptah-cli
    // member at all, so this RPC cannot report a configured provider's models.
    // It used to be called anyway and its result discarded in favour of a
    // hardcoded `[]`, which was indistinguishable from "this provider has no
    // models". Wiring a real per-provider list means adding a ptah-cli source
    // to that RPC — a backend change, out of scope — so the emptiness is
    // LABELLED instead: `supported: false` is the machine-readable half,
    // `reason`/`hint` the human half. No RPC call, because a full DI boot for a
    // discarded reply is pure cost.
    if (wireCli === 'ptah-cli') {
      await formatter.writeNotification('agent_cli.models', {
        cli: selector,
        models: [],
        supported: false,
        reason:
          `'${selector}' selects a configured Ptah CLI provider, not a system CLI binary. ` +
          'agent:listCliModels enumerates only the detected system CLIs; provider models ' +
          "come from the provider's own configuration.",
        hint: 'Run `ptah agent-cli detect` to list configured Ptah CLI providers and their ids.',
      });
      return ExitCode.Success;
    }

    // A SYSTEM CLI IS A REAL QUERY, SO ASK IT (TASK_2026_297 phase 2).
    //
    // `--cli codex` used to exit 3 before it could be asked. It is now a field
    // lookup on the same result the unscoped branch already reports, keyed by
    // the wire type — `AgentListCliModelsResult`'s keys ARE `SYSTEM_CLI_TYPES`,
    // so this indexes without a cast and a seventh adapter comes along for free.
    return engine(globals, { mode: 'full' }, async (ctx) => {
      const result = await callRpc<AgentListCliModelsResult>(
        ctx.transport,
        'agent:listCliModels',
        undefined,
      );
      await formatter.writeNotification('agent_cli.models', {
        cli: selector,
        models: result?.[wireCli] ?? [],
        supported: true,
      });
      return ExitCode.Success;
    });
  }

  return engine(globals, { mode: 'full' }, async (ctx) => {
    const result = await callRpc<AgentListCliModelsResult>(
      ctx.transport,
      'agent:listCliModels',
      undefined,
    );

    // All six system CLIs, not just codex+copilot. The RPC has returned cursor,
    // antigravity, opencode and pi for as long as `AgentListCliModelsResult`
    // has had those fields; dropping them here silently hid four CLIs' models
    // from every CLI consumer.
    await formatter.writeNotification('agent_cli.models', {
      codex: result?.codex ?? [],
      copilot: result?.copilot ?? [],
      cursor: result?.cursor ?? [],
      antigravity: result?.antigravity ?? [],
      opencode: result?.opencode ?? [],
      pi: result?.pi ?? [],
    });
    return ExitCode.Success;
  });
}

async function runStop(
  opts: AgentCliOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  stderr: AgentCliStderrLike,
  engine: typeof withEngine,
): Promise<number> {
  if (!opts.agentId || opts.agentId.trim().length === 0) {
    stderr.write('ptah agent-cli stop: <id> is required\n');
    return ExitCode.UsageError;
  }

  // `--cli` IS OPTIONAL HERE, AND THAT IS THE FIX (TASK_2026_297).
  //
  // `agent:stop` takes `{ agentId }` and nothing else — `cli` has never reached
  // the wire from this command. So the flag was a pure client-side guard that
  // the user was nonetheless FORCED to type, and which rejected every value but
  // `glm` with exit 3. An agent id already names one specific running agent
  // regardless of which CLI produced it, so requiring the flag made
  // `stop <id> --cli codex` fail on an agent `agent:stop` would have stopped
  // happily, and made `stop <id>` alone impossible.
  //
  // It stays accepted and still resolved when supplied — a value that names no
  // target is a typo worth reporting, not something to echo back unread — and
  // is documented as a client-side check only.
  let selector: CliAgentSelector | null = null;
  if (opts.cli !== undefined) {
    selector = resolveCliAgentSelector(opts.cli);
    if (selector === null) {
      return await emitCliAgentUnavailable(formatter, opts.cli);
    }
    noteSelectorDeprecation(selector, stderr);
  }

  return engine(globals, { mode: 'full' }, async (ctx) => {
    const result = await callRpc<{ success: boolean; error?: string }>(
      ctx.transport,
      'agent:stop',
      { agentId: opts.agentId },
    );
    if (!result?.success) {
      throw new Error(result?.error ?? 'agent:stop failed');
    }
    // `cli` is echoed only when the user supplied it. Absent flag, absent field
    // — the notification does not claim to know a CLI it was never told.
    await formatter.writeNotification('agent_cli.stopped', {
      agentId: opts.agentId,
      ...(selector === null ? {} : { cli: selector }),
    });
    return ExitCode.Success;
  });
}

async function runResume(
  opts: AgentCliOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  stderr: AgentCliStderrLike,
  engine: typeof withEngine,
): Promise<number> {
  if (!opts.cliSessionId || opts.cliSessionId.trim().length === 0) {
    stderr.write('ptah agent-cli resume: <id> is required\n');
    return ExitCode.UsageError;
  }
  // An absent `--cli` is a USAGE error, not an unknown-target rejection:
  // nothing was requested, so nothing can be reported unavailable. Reporting
  // `requested_cli: ''` was the same invent-a-value habit as `task ?? ''`.
  // (Unreachable through the router, where `--cli` is a requiredOption.)
  if (opts.cli === undefined) {
    stderr.write('ptah agent-cli resume: --cli is required\n');
    return ExitCode.UsageError;
  }
  // Selector resolution stays ahead of the flag checks below. It reports on its
  // own documented wire code (`cli_agent_unavailable` / exit 3), and an unknown
  // CLI id must not be masked by a usage error about some other flag. Only
  // `<id>` — the command's subject — is checked earlier.
  const selector = resolveCliAgentSelector(opts.cli);
  if (selector === null) {
    return await emitCliAgentUnavailable(formatter, opts.cli);
  }
  noteSelectorDeprecation(selector, stderr);
  const target = resolveCliAgentTarget(selector);
  // `agent:resumeCliSession` resumes a session AND hands it work. There is no
  // "resume with nothing to do" — the sole in-app caller always passes a real
  // message, and the boundary schema rejects `''`. This used to send
  // `opts.task ?? ''`, inventing a value the CLI did not have; the fix is to
  // refuse here, in the user's own vocabulary, rather than to fabricate one.
  if (!opts.task || opts.task.trim().length === 0) {
    stderr.write(
      'ptah agent-cli resume: --task is required and must not be empty\n',
    );
    return ExitCode.UsageError;
  }
  // Present-but-empty is a caller that lost its value, not a caller opting out.
  // Opting out is spelled by omitting the flag.
  if (opts.ptahCliId !== undefined && opts.ptahCliId.trim().length === 0) {
    stderr.write(
      'ptah agent-cli resume: --ptah-cli-id must not be empty (omit the flag to use the default provider)\n',
    );
    return ExitCode.UsageError;
  }
  // A provider id only means something for a ptah-cli target. Now that the six
  // system CLIs are selectable, `--cli codex --ptah-cli-id x` is expressible and
  // is nonsense: `codex` is a binary on PATH, not a configured provider. Saying
  // so beats forwarding a field the spawn path has nothing to do with.
  if (opts.ptahCliId !== undefined && target.cli !== 'ptah-cli') {
    stderr.write(
      `ptah agent-cli resume: --ptah-cli-id only applies to --cli ptah-cli; '${selector}' is a system CLI binary\n`,
    );
    return ExitCode.UsageError;
  }

  const params = buildResumeCliSessionParams({
    cliSessionId: opts.cliSessionId,
    task: opts.task,
    target,
    ptahCliId: opts.ptahCliId,
  });

  return engine(globals, { mode: 'full' }, async (ctx) => {
    const result = await callRpc<{
      success: boolean;
      agentId?: string;
      error?: string;
    }>(ctx.transport, 'agent:resumeCliSession', params);
    if (!result?.success) {
      throw new Error(result?.error ?? 'agent:resumeCliSession failed');
    }
    // `cli` reports the SELECTOR the user typed; `ptahCliId` appears only when
    // one was actually pinned. When it is absent the backend chose the provider,
    // and echoing a guess here would be the same invention this task removed.
    await formatter.writeNotification('agent_cli.resumed', {
      cliSessionId: opts.cliSessionId,
      cli: selector,
      ...(params.ptahCliId === undefined
        ? {}
        : { ptahCliId: params.ptahCliId }),
      agentId: result.agentId,
    });
    return ExitCode.Success;
  });
}

/** The exact wire payload `resume` sends to `agent:resumeCliSession`. */
export interface ResumeCliSessionParams {
  readonly cliSessionId: string;
  readonly cli: CliType;
  readonly task: string;
  readonly ptahCliId?: string;
}

/**
 * Build the `agent:resumeCliSession` payload.
 *
 * Extracted and exported so the payload can be validated against the REAL
 * boundary schema in tests. `agent-cli.spec.ts` mocked the transport, so it
 * asserted call shape and never outcome — which is how a command that could
 * never succeed stayed green for its whole life. A payload this function
 * returns is parsed by `AgentResumeCliSessionParamsSchema` itself in the spec,
 * so the CLI can no longer send something the boundary rejects.
 *
 * `ptahCliId` is spread conditionally rather than set to `undefined`: the key
 * must be ABSENT, not present-and-undefined, so the backend's default
 * resolution runs instead of seeing a field it has to second-guess.
 */
export function buildResumeCliSessionParams(input: {
  cliSessionId: string;
  task: string;
  target: CliAgentTarget;
  ptahCliId?: string;
}): ResumeCliSessionParams {
  const ptahCliId = input.ptahCliId ?? input.target.ptahCliId;
  return {
    cliSessionId: input.cliSessionId,
    cli: input.target.cli,
    task: input.task,
    ...(ptahCliId === undefined ? {} : { ptahCliId }),
  };
}

/**
 * Build the `AgentSetConfigParams` payload for a single key/value pair.
 *
 * Coerces:
 *   - `*AutoApprove` keys → boolean (true/false strings only).
 *   - `maxConcurrentAgents`, `mcpPort` → number.
 *   - `preferredAgentOrder`, `disabledClis`, `disabledMcpNamespaces` →
 *     CSV-split string array.
 *   - everything else (model ids, reasoning effort tiers) → string passthrough.
 */
function buildSetConfigParams(
  key: string,
  rawValue: string,
): AgentSetConfigParams {
  const params: AgentSetConfigParams = {};
  switch (key) {
    case 'codexAutoApprove':
    case 'copilotAutoApprove':
    case 'browserAllowLocalhost': {
      const v = rawValue.toLowerCase();
      params[
        key as
          | 'codexAutoApprove'
          | 'copilotAutoApprove'
          | 'browserAllowLocalhost'
      ] = v === 'true' || v === '1';
      break;
    }
    case 'maxConcurrentAgents':
    case 'mcpPort': {
      const n = Number.parseInt(rawValue, 10);
      if (Number.isFinite(n)) {
        params[key as 'maxConcurrentAgents' | 'mcpPort'] = n;
      }
      break;
    }
    case 'preferredAgentOrder':
    case 'disabledClis':
    case 'disabledMcpNamespaces': {
      params[
        key as 'preferredAgentOrder' | 'disabledClis' | 'disabledMcpNamespaces'
      ] = rawValue
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      break;
    }
    default:
      // Model ids and reasoning-effort tiers pass through as strings. A single
      // widening view is enough here — `as unknown as` was never needed.
      (params as Record<string, unknown>)[key] = rawValue;
  }
  return params;
}

/** An RPC failure, carrying the backend's error code when it supplied one. */
interface RpcCallError extends Error {
  code?: string;
}

/**
 * Call an RPC method and unwrap its envelope.
 *
 * Returns `T | null` rather than laundering a `null` through `as unknown as T`.
 * Every caller already reads the result with `?.`, so the nullability was real
 * all along — the cast only hid it from the compiler.
 */
async function callRpc<T = unknown>(
  transport: CliMessageTransport,
  method: string,
  params: unknown,
): Promise<T | null> {
  const response = await transport.call<unknown, T>(method, params);
  if (!response.success) {
    const err: RpcCallError = new Error(response.error ?? `${method} failed`);
    if (response.errorCode) {
      err.code = response.errorCode;
    }
    throw err;
  }
  return (response.data as T | undefined) ?? null;
}
