/**
 * Zod schemas for {@link HarnessRpcHandlers}.
 *
 * Most harness methods validate their params via the static TypeScript types
 * exported from `@ptah-extension/shared` plus inline guards. The two
 * agent-driven workflow methods carry boundary-validated shapes:
 *   - `harness:start-new-project` carries the Setup Hub intake answers, which
 *     are interpolated straight into the agent's first turn.
 *   - `harness:workflow-prompt` carries a discriminating `mode` literal and a
 *     freeform `intent` string that must be validated before prompt assembly.
 */

import * as path from 'node:path';
import { z } from 'zod';
import {
  NEW_PROJECT_PLATFORM_VALUES,
  NEW_PROJECT_STACK_VALUES,
} from '@ptah-extension/shared';

/**
 * Intake answers behind the New Project flow. `what` is the only required
 * freeform field; it lands verbatim in the seed prompt, so an empty string
 * would produce a prompt with a blank brief. `stackOther` is only meaningful
 * when `stack === 'other'` and is dropped otherwise, so a stale value from a
 * changed radio selection can never leak into the prompt.
 *
 * `platform` and `stack` take their enums from the shared `as const` tuples
 * rather than repeating the members here. That is the TS/Zod parity mechanism:
 * the union and the enum are built from the SAME array, so they cannot drift —
 * previously they were two hand-written lists that agreed only by inspection.
 *
 * `platform` is optional because absence means `node-ts` (see
 * `NewProjectIntake.platform`). It is NOT defaulted here: writing the default
 * in would put a `platform` key into a payload the caller did not send, and
 * `renderIntakeBlock` uses that key's presence to decide whether the prompt
 * mentions a platform at all.
 */
export const NewProjectIntakeSchema = z
  .object({
    what: z.string().trim().min(1).max(4000),
    audience: z.enum(['b2b', 'b2c', 'internal', 'unsure']),
    constraints: z.string().trim().max(4000).optional(),
    platform: z.enum(NEW_PROJECT_PLATFORM_VALUES).optional(),
    stack: z.enum(NEW_PROJECT_STACK_VALUES),
    stackOther: z.string().trim().max(500).optional(),
  })
  .transform((intake) =>
    intake.stack === 'other'
      ? intake
      : { ...intake, stackOther: undefined as string | undefined },
  );

export const HarnessStartNewProjectParamsSchema = z.object({
  intake: NewProjectIntakeSchema,
});

/**
 * Boundary schema for the workspace-pinning param shared by file-mutating
 * harness methods (currently `harness:apply`). Only the `workspaceRoot` field
 * is validated here — the large `config` payload keeps its existing
 * TS-type + `normalizeHarnessConfig` contract, so we `passthrough()` the rest.
 *
 * SECURITY: a supplied `workspaceRoot` flows straight into CLAUDE.md /
 * subagent file-write paths at the handler, so it is validated the same way
 * `validateAndNormalizeWorkspaceRoot` (cron-rpc.handlers.ts) validates the cron
 * `workspaceRoot`: it must be a non-empty ABSOLUTE path with no `..`
 * traversal segments. Omission is valid and resolves to the active workspace
 * at the handler.
 */
export const HarnessWorkspacePinParamsSchema = z
  .object({
    workspaceRoot: z
      .string()
      .min(1)
      .refine((wr) => path.isAbsolute(wr), {
        message: 'workspaceRoot must be an absolute path',
      })
      // Reject `..` in the RAW value (checking both separators) so a traversal
      // segment can never slip through — `path.normalize` would otherwise
      // silently collapse interior `..` on an already-absolute path.
      .refine((wr) => !wr.split(/[/\\]+/).includes('..'), {
        message: "workspaceRoot must not contain '..' segments",
      })
      .optional(),
  })
  .passthrough();

export const HarnessWorkflowPromptParamsSchema = z.object({
  mode: z.literal('configure-harness'),
  intent: z.string().min(1),
});

/**
 * The reconciler surface (TASK_2026_278 Batch 4).
 *
 * These three take params from the webview, from `ptah harness doctor` and
 * eventually from anything that can reach the RPC socket, so unlike the wizard
 * methods above they are fully parsed rather than trusted. The target ids are
 * enumerated from the shared `HarnessTargetId` union — a typo'd id must fail at
 * the boundary, not silently reconcile nothing.
 */
export const HarnessTargetIdSchema = z.enum([
  'claude',
  'codex',
  'copilot',
  'cursor',
  'antigravity',
  'vscode',
]);

export const HarnessHealthParamsSchema = z.object({
  refresh: z.boolean().optional(),
});

export const HarnessReconcileParamsSchema = z.object({
  mode: z.enum(['full', 'preflight']).optional(),
  targets: z.array(HarnessTargetIdSchema).max(6).optional(),
});

/**
 * `confirm` is `z.literal(true)`, not `z.boolean()`. This method deletes every
 * managed copy in the workspace; a caller that omits the flag, or sends
 * `false`, must be rejected at the schema rather than reaching a handler that
 * then has to remember to check.
 */
export const HarnessRemoveParamsSchema = z.object({
  confirm: z.literal(true),
});
