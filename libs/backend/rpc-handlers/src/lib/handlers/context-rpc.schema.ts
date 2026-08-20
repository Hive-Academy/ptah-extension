/**
 * Zod schemas for {@link ContextRpcHandlers}.
 *
 * Was intentionally empty ("the handler defers validation to the downstream
 * `ContextOrchestrationService`"). TASK_2026_200 fills it in, because that
 * posture stopped being tenable the moment these params grew a
 * `workspaceRoot`: it selects which workspace's files come back, it arrives
 * from the renderer, and an unvalidated boundary is exactly where an
 * `''`/`null`/`{}` slips through and gets `path.resolve`d into "whatever
 * `process.cwd()` happens to be". Validating it here is the lib's
 * mandatory-schema rule (rpc-handlers CLAUDE.md) applied at the one boundary
 * that was skipping it.
 *
 * Shape only, no policy: these schemas type-check and reject, they do NOT
 * default or clamp. `limit` bounding stays the orchestration layer's job, which
 * is the contract `context-rpc.handlers.spec.ts` already locks in ("the handler
 * MUST NOT mutate, default, or bound them"). `.strip()` is Zod's default, so
 * unknown keys are dropped rather than rejected — an older or newer webview
 * sending an extra field must not hard-fail.
 *
 * `workspaceRoot` is `.min(1)`, matching `git-rpc.schema.ts`. The empty string
 * is not "no opinion": absent means "process-global active folder", while `''`
 * would resolve to the process CWD and quietly answer for the wrong tree.
 * Callers must omit the field, not blank it.
 */
import { z } from 'zod';
import type {
  ContextGetAllFilesParams,
  ContextGetFileSuggestionsParams,
} from '@ptah-extension/shared';

/**
 * Shared workspace-scoping field. Mirrors `PickerWorkspaceScopedParams` in
 * `@ptah-extension/shared` — one convention on the wire, one at the boundary.
 */
export const PickerWorkspaceRootSchema = z.string().min(1).optional();

export const ContextGetAllFilesParamsSchema = z.object({
  includeImages: z.boolean().optional(),
  limit: z.number().int().nonnegative().optional(),
  workspaceRoot: PickerWorkspaceRootSchema,
});

export const ContextGetFileSuggestionsParamsSchema = z.object({
  query: z.string().optional(),
  limit: z.number().int().nonnegative().optional(),
  workspaceRoot: PickerWorkspaceRootSchema,
});

/**
 * Parse `context:getAllFiles` params.
 *
 * Returns `null` for anything malformed so the handler can answer with its own
 * sanitized message instead of leaking Zod's issue text to the renderer.
 * `undefined` / missing params parse as `{}` — the pre-existing contract is
 * that omitted params are legal and the orchestration layer picks the defaults.
 */
export function parseContextGetAllFilesParams(
  raw: unknown,
): ContextGetAllFilesParams | null {
  const result = ContextGetAllFilesParamsSchema.safeParse(raw ?? {});
  return result.success ? result.data : null;
}

/**
 * Parse `context:getFileSuggestions` params. Same null-on-malformed contract as
 * {@link parseContextGetAllFilesParams}.
 */
export function parseContextGetFileSuggestionsParams(
  raw: unknown,
): ContextGetFileSuggestionsParams | null {
  const result = ContextGetFileSuggestionsParamsSchema.safeParse(raw ?? {});
  return result.success ? result.data : null;
}
