/**
 * Zod schemas for {@link AutocompleteRpcHandlers}.
 *
 * Was intentionally empty. TASK_2026_200 fills it in for the same reason as
 * `context-rpc.schema.ts`: these params now carry a `workspaceRoot` that
 * selects which workspace's `.claude/agents` and `.claude/commands` are
 * scanned, it arrives from the renderer, and it is joined onto a filesystem
 * path downstream. That is a boundary, so it gets a schema — the lib's
 * mandatory-schema rule (rpc-handlers CLAUDE.md).
 *
 * Shape only, no policy. In particular `query` stays optional and unclamped:
 * the handler's long-standing `params.query || ''` fallback is the documented
 * contract (a missing query means "top N"), and these schemas must not
 * pre-empt it.
 *
 * `workspaceRoot` is `.min(1)`, matching `git-rpc.schema.ts` and
 * `context-rpc.schema.ts`. Absent means "process-global active folder"; `''`
 * would resolve to the process CWD and scan the wrong tree, so it is rejected.
 */
import { z } from 'zod';
import type {
  AutocompleteAgentsParams,
  AutocompleteCommandsParams,
} from '@ptah-extension/shared';

/**
 * Shared workspace-scoping field. Mirrors `PickerWorkspaceScopedParams` in
 * `@ptah-extension/shared` — one convention on the wire, one at the boundary.
 */
export const PickerWorkspaceRootSchema = z.string().min(1).optional();

export const AutocompleteAgentsParamsSchema = z.object({
  query: z.string().optional(),
  maxResults: z.number().int().nonnegative().optional(),
  workspaceRoot: PickerWorkspaceRootSchema,
});

export const AutocompleteCommandsParamsSchema = z.object({
  query: z.string().optional(),
  maxResults: z.number().int().nonnegative().optional(),
  workspaceRoot: PickerWorkspaceRootSchema,
});

/**
 * Parse `autocomplete:agents` params.
 *
 * Returns `null` for anything malformed so the handler can answer with its own
 * sanitized message rather than leaking Zod's issue text. `undefined` / missing
 * params parse as `{}` — omitted params are legal on this method.
 */
export function parseAutocompleteAgentsParams(
  raw: unknown,
): AutocompleteAgentsParams | null {
  const result = AutocompleteAgentsParamsSchema.safeParse(raw ?? {});
  return result.success ? result.data : null;
}

/**
 * Parse `autocomplete:commands` params. Same null-on-malformed contract as
 * {@link parseAutocompleteAgentsParams}.
 */
export function parseAutocompleteCommandsParams(
  raw: unknown,
): AutocompleteCommandsParams | null {
  const result = AutocompleteCommandsParamsSchema.safeParse(raw ?? {});
  return result.success ? result.data : null;
}
