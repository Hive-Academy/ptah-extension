import { z } from 'zod';
import {
  OUTCOME_TASK_KINDS,
  SYSTEM_CLI_TYPES,
  type ProviderAccountSelection,
  type SystemCliType,
} from '@ptah-extension/shared';
import { ProviderAccountSelectionSchema } from '@ptah-extension/shared/schemas';

export const MAX_TASK_LENGTH = 100 * 1024;

/**
 * The one system lane whose spawn takes an account selection. Codex accounts
 * share the account vocabulary but have no lane contract yet.
 */
export const AGENT_SPAWN_ACCOUNT_CLI =
  'claude' as const satisfies SystemCliType;

/** The spawn fields an account refusal depends on, in either casing. */
export interface AgentSpawnAccountInput {
  readonly cli?: string;
  readonly ptahCliId?: string;
  readonly resumeSessionId?: string;
  readonly accountSelection?: ProviderAccountSelection;
}

/**
 * Refuse an account selection the spawn cannot honour, before anything runs.
 * Returns the reason, or `undefined` when the spawn may proceed.
 *
 * - The selection applies to `cli: 'claude'` only, never to a Ptah CLI
 *   provider or an auto-detected lane.
 * - A resume never takes a named account: the resumed session keeps the
 *   account stored with it. Ambient on resume is checked by the runtime's
 *   resume gate against that stored binding, which refuses a bound session.
 *
 * An accepted selection is forwarded on `SpawnAgentRequest.accountSelection`.
 * Ambient and omitted keep the existing Claude login. A named selection on a
 * fresh `claude` spawn is admitted by the runtime (`AgentProcessManager`),
 * which refuses the spawn when that account cannot be proved.
 */
export function agentSpawnAccountRefusal(
  input: AgentSpawnAccountInput,
): string | undefined {
  const selection = input.accountSelection;
  if (selection === undefined) return undefined;
  // Truthiness matches the spawn paths: an empty id selects no Ptah CLI lane
  // and an empty resume id resumes nothing.
  if (input.ptahCliId || input.cli !== AGENT_SPAWN_ACCOUNT_CLI) {
    return `accountSelection applies only to cli "${AGENT_SPAWN_ACCOUNT_CLI}" lanes, not to Ptah CLI agents, auto-detected lanes or other CLIs.`;
  }
  if (selection.kind === 'named' && input.resumeSessionId) {
    return 'a resumed lane keeps the account stored with its session; omit accountSelection when resuming.';
  }
  // Ambient, omitted, or named on a fresh claude spawn: the runtime admits it.
  return undefined;
}

/**
 * Deliverable paths one spawn may declare (TASK_2026_515).
 *
 * Bounded because every entry costs one filesystem check when the lane ends,
 * and a lane asked for twenty separate files is a lane that should have been
 * two lanes.
 */
export const MAX_DELIVERABLES = 20;

/**
 * Longest `effort` string a spawn may carry (TASK_2026_597). The longest real
 * level is six characters; the bound keeps an arbitrary value out of the
 * `Lane policy` log line, which echoes an ignored effort.
 */
export const MAX_EFFORT_LENGTH = 32;

export const AgentSpawnArgsSchema = z
  .object({
    task: z.string().min(1).max(MAX_TASK_LENGTH),
    cli: z.enum(SYSTEM_CLI_TYPES).optional(),
    ptahCliId: z.string().min(1).optional(),
    workingDirectory: z.string().optional(),
    timeout: z.number().int().nonnegative().optional(),
    files: z.array(z.string()).optional(),
    taskFolder: z.string().optional(),
    deliverables: z
      .array(z.string().min(1).max(1024))
      .max(MAX_DELIVERABLES)
      .optional(),
    model: z.string().optional(),
    modelTier: z.enum(['opus', 'sonnet', 'haiku']).optional(),
    resume_session_id: z.string().optional(),
    role: z.string().min(1).max(100).optional(),
    // Free string, not an enum: each CLI accepts its own scale, and the lane
    // spawn policy ignores a value its CLI does not take (R2.3 step 1).
    effort: z.string().min(1).max(MAX_EFFORT_LENGTH).optional(),
    // Task kind this lane is routed for (TASK_2026_646, SC-6). Copied onto the
    // tracked process info and from there onto the lane's outcome record;
    // absent when the spawn did not name one.
    taskKind: z.enum(OUTCOME_TASK_KINDS).optional(),
    // What routed this lane (SC-6): 'model' (a model was pinned), 'ranking'
    // (the router chose it) or 'pin' (the lane itself was pinned). The
    // 'not-routed' default is recorded at write time, so the spawn never
    // takes it. Never forwarded to the CLI.
    routingSource: z.enum(['model', 'ranking', 'pin']).optional(),
    // Overrides the pre-spawn limit gate; never forwarded to `agent.spawn`.
    force: z.boolean().optional(),
    // Optional account route for a `claude` lane: ID or sentinel only, never
    // a path, env, token or owner (strict shared schema).
    accountSelection: ProviderAccountSelectionSchema.optional(),
  })
  .strict()
  .superRefine((args, ctx) => {
    const refusal = agentSpawnAccountRefusal({
      cli: args.cli,
      ptahCliId: args.ptahCliId,
      resumeSessionId: args.resume_session_id,
      accountSelection: args.accountSelection,
    });
    if (refusal !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['accountSelection'],
        message: refusal,
      });
    }
  });
