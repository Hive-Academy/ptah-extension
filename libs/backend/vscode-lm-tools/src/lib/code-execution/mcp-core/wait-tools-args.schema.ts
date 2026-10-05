/**
 * Argument schemas for the blocking-wait tools `ptah_agent_wait` and
 * `ptah_run_check` (TASK_2026_597, D13).
 *
 * These zod schemas are the enforcement point at the MCP boundary; the
 * advertised JSON schemas in `agent-wait.tool.ts` and `run-check.tool.ts` are
 * outlines of the same rules.
 */
import { z } from 'zod';
import { MAX_AGENT_WAIT_MS } from '@ptah-extension/cli-agent-runtime';

/**
 * Every reply either tool returns is at most this many chars: half the
 * 8,000-char MCP result budget (`DEFAULT_TOOL_RESULT_BUDGET_CHARS` in
 * `tool-result-budget.ts`), so a reply is never spooled.
 */
export const WAIT_SUMMARY_MAX_CHARS = 4_000;

/**
 * Longest wait either tool accepts, in seconds (Codex's tool timeout is 960 s).
 * Derived from the runtime's own clamp in `AgentProcessManager.waitForAgents`,
 * so the advertised ceiling and the enforced one cannot drift apart.
 */
export const MAX_WAIT_TIMEOUT_SEC = MAX_AGENT_WAIT_MS / 1000;

/** Default `ptah_agent_wait` timeout when the caller gives none. */
export const DEFAULT_AGENT_WAIT_TIMEOUT_SEC = 600;

/** Default `ptah_run_check` timeout when the caller gives none. */
export const DEFAULT_RUN_CHECK_TIMEOUT_SEC = 600;

/**
 * Most lanes one wait may name. Each lane needs a few hundred chars of the
 * 4,000-char reply to say anything useful; past this the reply is noise.
 */
export const MAX_WAIT_AGENT_IDS = 10;

/** Longest agent id accepted (ids are UUIDs; the bound keeps junk out of the reply). */
export const MAX_AGENT_ID_LENGTH = 128;

export const AgentWaitArgsSchema = z
  .object({
    agentIds: z
      .array(z.string().trim().min(1).max(MAX_AGENT_ID_LENGTH))
      .min(1)
      .max(MAX_WAIT_AGENT_IDS),
    mode: z.enum(['any', 'all']).default('all'),
    timeoutSec: z
      .number()
      .int()
      .min(0)
      .max(MAX_WAIT_TIMEOUT_SEC)
      .default(DEFAULT_AGENT_WAIT_TIMEOUT_SEC),
  })
  .strict();

export type AgentWaitArgs = z.infer<typeof AgentWaitArgsSchema>;

/** The Nx targets `ptah_run_check` may run. Anything else is rejected. */
export const RUN_CHECK_TARGETS = [
  'test',
  'lint',
  'typecheck',
  'build',
] as const;

export type RunCheckTarget = (typeof RUN_CHECK_TARGETS)[number];

/** Allowed Nx project names: the characters Nx project names use, 1-120 long. */
export const RUN_CHECK_PROJECT_PATTERN = /^[A-Za-z0-9@/_.-]{1,120}$/;

export const RunCheckArgsSchema = z
  .object({
    project: z
      .string()
      .regex(RUN_CHECK_PROJECT_PATTERN)
      // A leading dash would reach Nx as an option rather than as the value
      // of `-p`; the pattern alone allows it.
      .refine((value) => !value.startsWith('-'), {
        message: 'project must not start with "-"',
      }),
    targets: z
      .array(z.enum(RUN_CHECK_TARGETS))
      .min(1)
      .max(RUN_CHECK_TARGETS.length)
      .transform((targets) => [...new Set(targets)]),
    timeoutSec: z
      .number()
      .int()
      .min(1)
      .max(MAX_WAIT_TIMEOUT_SEC)
      .default(DEFAULT_RUN_CHECK_TIMEOUT_SEC),
  })
  .strict();

export type RunCheckArgs = z.infer<typeof RunCheckArgsSchema>;
