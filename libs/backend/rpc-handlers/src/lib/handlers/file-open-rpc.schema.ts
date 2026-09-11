/**
 * Zod schema for {@link ElectronFileOpenRpcHandlers}.
 *
 * `file:open` takes a caller-supplied absolute path that reaches a spawned
 * process argv, so the shape is validated before the workspace-containment
 * check runs and before anything is spawned.
 */
import { z } from 'zod';
import type { FileOpenParams } from '@ptah-extension/shared';

export const FileOpenRpcParamsSchema = z
  .object({
    path: z.string().min(1),
    line: z.number().int().positive().optional(),
    workspaceRoot: z.string().min(1).max(4096).optional(),
  })
  .strict();

export type FileOpenParseResult =
  | { readonly success: true; readonly data: FileOpenParams }
  | { readonly success: false; readonly error: string };

/**
 * Parse `file:open` params.
 *
 * Returns a discriminated result rather than collapsing every failure to a
 * single static message — a rejected `line` (e.g. `0`, which `.positive()`
 * refuses) is a different problem than a missing `path`, and the caller
 * should be able to tell them apart.
 */
export function parseFileOpenParams(raw: unknown): FileOpenParseResult {
  const result = FileOpenRpcParamsSchema.safeParse(raw);
  if (result.success) {
    return { success: true, data: result.data };
  }
  const issue = result.error.issues[0];
  const field = issue?.path.join('.') || 'params';
  const message = issue?.message ?? 'Invalid file:open params';
  return { success: false, error: `${field}: ${message}` };
}
