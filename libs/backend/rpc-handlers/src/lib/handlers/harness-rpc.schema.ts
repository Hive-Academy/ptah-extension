/**
 * Zod schemas for {@link HarnessRpcHandlers}.
 *
 * Most harness methods validate their params via the static TypeScript types
 * exported from `@ptah-extension/shared` plus inline guards. The two
 * agent-driven workflow methods carry boundary-validated shapes:
 *   - `harness:start-new-project` takes no params (`Record<string, never>`).
 *   - `harness:workflow-prompt` carries a discriminating `mode` literal and a
 *     freeform `intent` string that must be validated before prompt assembly.
 */

import * as path from 'node:path';
import { z } from 'zod';

export const HarnessStartNewProjectParamsSchema = z.object({}).passthrough();

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
