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

/**
 * `harness:repairBlocked` — the consent-gated repair (TASK_2026_306 Batch 8).
 *
 * This is the only RPC in the lib that MOVES a directory the user may have
 * written by hand, so the boundary is deliberately narrow:
 *
 * - **No bulk shape.** `paths` is a list the user ticked, and there is no
 *   `all`, no `target`-wide filter and no "repair everything". The selection IS
 *   the ownership claim (decision U3); a claim over a set the user never
 *   enumerated would be the automatic adoption this whole design rejects.
 * - **An empty list is legal and is a complete no-op**, which is what makes
 *   "declined consent leaves the filesystem byte-identical" expressible at all.
 *   `.min(1)` would turn a decline into an error the UI has to special-case.
 * - **`relPath` is shape-checked, not authorized, here.** The real gate is in
 *   `HarnessBlockedRepairService`, which re-derives the blocked set from a
 *   fresh `verify()` and refuses anything outside it. This schema only rejects
 *   what could not be a workspace-relative POSIX path in the first place, so a
 *   traversal attempt dies at the boundary as well as at the gate rather than
 *   relying on either alone.
 * - **`.strict()`, not the default strip.** Stripping an unknown key is the
 *   right default almost everywhere and is the wrong one here: a caller that
 *   sends `{ paths: [], all: true }` has a MISCONCEPTION about this method, and
 *   silently honouring the `paths` half tells them nothing. There is no bulk
 *   entry point, so the honest answer to a request for one is an error rather
 *   than a quietly narrower result.
 */
const HarnessRepairBlockedRelPathSchema = z
  .string()
  .min(1)
  .max(400)
  .refine((value) => !value.split('/').includes('..'), {
    message: 'relPath must not traverse outside the workspace',
  })
  .refine((value) => !value.startsWith('/') && !/^[A-Za-z]:/.test(value), {
    message: 'relPath must be workspace-relative',
  })
  .refine((value) => !value.includes('\\'), {
    message: 'relPath must use POSIX separators',
  });

export const HarnessRepairBlockedParamsSchema = z
  .object({
    paths: z
      .array(
        z
          .object({
            target: HarnessTargetIdSchema,
            relPath: HarnessRepairBlockedRelPathSchema,
          })
          .strict(),
      )
      .max(200),
  })
  .strict();

/**
 * The per-workspace skill selection (TASK_2026_316 Batch 3).
 *
 * `get` takes nothing — the answer is a property of the open workspace — and is
 * left non-strict like `harness:health`, because a caller that sends a stray
 * key to a read-only method has done nothing that needs refusing.
 */
export const HarnessGetSkillSelectionParamsSchema = z.object({});

/**
 * One entry in the allowlist: a skill DIRECTORY name, keyed exactly as
 * `disabledSkillIds` is.
 *
 * Checked for traversal rather than matched against a character class. The
 * slug is the name of a directory the user created — `skills.sh` installs,
 * harness-builder output and hand-authored skills all land here — and a
 * pattern narrow enough to be a real guard would reject a legitimate name with
 * a space in it, which would make that skill permanently unselectable. What
 * genuinely must not pass is a path separator or a `..`, because this value is
 * recorded in `state.json` and read back by a builder that joins names onto
 * `~/.ptah/user/skills`.
 */
const HarnessSkillSlugSchema = z
  .string()
  .min(1)
  .max(200)
  .refine((value) => value.trim() !== '' && value !== '.' && value !== '..', {
    message: 'slug must name a skill directory',
  })
  .refine((value) => !/[/\\]/.test(value), {
    message: 'slug must be a single path segment',
  });

/**
 * `.strict()`, and here that is a safety property rather than a style choice.
 *
 * Skills are manifest-owned, so `{ mode: 'selected' }` with no allowlist is a
 * REAP of every managed skill copy in the workspace. That is a legitimate thing
 * for a user to ask for — and it is also exactly what a caller misspelling
 * `slugs` would get under the default strip. Refusing the unknown key is the
 * difference between a deliberate empty selection and a typo that deletes.
 *
 * `slugs` carries no `.min(1)` for the same reason: an empty allowlist is a
 * real state ("this workspace propagates no skills"), not an error.
 */
export const HarnessSetSkillSelectionParamsSchema = z
  .object({
    mode: z.enum(['all', 'selected']),
    slugs: z.array(HarnessSkillSlugSchema).max(1000).optional(),
  })
  .strict();
