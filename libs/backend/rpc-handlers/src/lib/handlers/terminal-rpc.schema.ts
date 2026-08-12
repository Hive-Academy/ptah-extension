/**
 * Zod schemas for {@link TerminalRpcHandlers}.
 *
 * Scope note: this file covers `terminal:create` and `terminal:kill` only.
 * Data flow (input/output/resize/exit) runs over binary IPC, not JSON RPC, and
 * `layout:*` is intentionally NOT retrofitted here — that is a separate change
 * with its own regression surface.
 *
 * `terminal:create` params reach the backend from the Angular renderer (which
 * renders AI-generated content) and are handed to node-pty's `spawn()`. The
 * `shell` field therefore names an executable and the `cwd` field a working
 * directory. This schema validates the shape and narrows `shell` to a
 * platform allowlist before the sink. `cwd` *containment* is a separate,
 * context-dependent check the handler runs against the injected
 * `IWorkspaceProvider` (a static schema cannot express it) — mirroring
 * `git-rpc.schema.ts`, where the schema validates shape and the handler runs
 * the path check.
 */
import { z } from 'zod';
import { isAllowedShell } from '@ptah-extension/platform-core';
import type {
  TerminalCreateParams,
  TerminalKillParams,
} from '@ptah-extension/shared';

export const TerminalCreateParamsSchema = z.object({
  cwd: z.string().optional(),
  shell: z
    .string()
    .optional()
    .refine((s) => isAllowedShell(s), { message: 'shell not in allowlist' }),
  name: z.string().optional(),
});

export const TerminalKillParamsSchema = z.object({
  id: z.string().min(1),
});

/**
 * Parse `terminal:create` params.
 *
 * Accepts `raw ?? {}` so an absent `params` (the workspace-root / homedir
 * fallback path) parses to `{}` and stays valid. Returns `null` for anything
 * malformed or with a disallowed `shell`, so the handler can reject with a
 * structured error rather than throwing an unmapped transport fault.
 */
export function parseTerminalCreateParams(
  raw: unknown,
): TerminalCreateParams | null {
  const result = TerminalCreateParamsSchema.safeParse(raw ?? {});
  return result.success ? result.data : null;
}

/**
 * Parse `terminal:kill` params. Returns `null` when `id` is missing or empty.
 */
export function parseTerminalKillParams(
  raw: unknown,
): TerminalKillParams | null {
  const result = TerminalKillParamsSchema.safeParse(raw);
  return result.success ? result.data : null;
}
