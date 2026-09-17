/**
 * Zod schemas for {@link GitRpcHandlers}.
 *
 * Scope note: this file covers `git:diffFile`, `git:applyHunks`, the review
 * pair, and the methods added with them since (`git:pull`, `git:fetch`, the
 * stash mutations and `git:stashShow`). The older `git:*` methods predate them
 * and are deliberately left on
 * their hand-rolled guards — retrofitting them is a separate change with its
 * own regression surface.
 *
 * Both sets of params reach the backend from the renderer and name a path that
 * is fed to a git object spec, so the shape is validated before any subprocess
 * is spawned. Path *traversal* is a separate concern handled by
 * `GitInfoService.validatePathSegment`, which both paths are put through.
 */
import { z } from 'zod';
import type {
  GitApplyHunksParams,
  GitDiffFileParams,
  GitReviewChangesParams,
  GitReviewFileParams,
  GitStashRefParams,
  GitWorkspaceScopedParams,
} from '@ptah-extension/shared';

const WorkspaceRootSchema = z.string().min(1).max(4096);
const hasNoControlCharacters = (value: string): boolean =>
  [...value].every((character) => {
    const code = character.charCodeAt(0);
    return code > 0x1f && code !== 0x7f;
  });
const ReviewRefSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine((value) => !value.startsWith('-') && hasNoControlCharacters(value));
const ReviewShaSchema = z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i);
const RelativeGitPathSchema = z
  .string()
  .min(1)
  .max(4096)
  .refine(
    (value) =>
      !value.startsWith('/') &&
      !/^[a-z]:[\\/]/i.test(value) &&
      !value.split(/[\\/]/).some((part) => part === '..' || part === ''),
  );

export const GitReviewChangesParamsSchema = z
  .object({
    workspaceRoot: WorkspaceRootSchema.optional(),
    base: ReviewRefSchema,
    head: ReviewRefSchema,
  })
  .strict();

export const GitReviewFileParamsSchema = z
  .object({
    workspaceRoot: WorkspaceRootSchema.optional(),
    baseSha: ReviewShaSchema,
    headSha: ReviewShaSchema,
    path: RelativeGitPathSchema,
    originalPath: RelativeGitPathSchema.optional(),
  })
  .strict();

export function parseGitReviewChangesParams(
  raw: unknown,
): GitReviewChangesParams | null {
  const result = GitReviewChangesParamsSchema.safeParse(raw);
  return result.success ? result.data : null;
}

export function parseGitReviewFileParams(
  raw: unknown,
): GitReviewFileParams | null {
  const result = GitReviewFileParamsSchema.safeParse(raw);
  return result.success ? result.data : null;
}

/**
 * Params of the methods that name nothing but the workspace folder
 * (`git:pull`, `git:fetch`). A missing payload is the same as `{}`.
 */
export const GitWorkspaceScopedParamsSchema = z
  .object({ workspaceRoot: WorkspaceRootSchema.optional() })
  .strict();

export function parseGitWorkspaceScopedParams(
  raw: unknown,
): GitWorkspaceScopedParams | null {
  const result = GitWorkspaceScopedParamsSchema.safeParse(raw ?? {});
  return result.success ? result.data : null;
}

/**
 * Params naming one stash entry. `index` becomes `stash@{index}` in a git
 * argv, so it must be a non-negative integer — never a string a caller could
 * shape into another revision or an option.
 */
export const GitStashRefParamsSchema = z
  .object({
    workspaceRoot: WorkspaceRootSchema.optional(),
    index: z.number().int().nonnegative().max(1_000_000),
    expectedHash: z
      .string()
      .regex(/^[0-9a-f]{40}([0-9a-f]{24})?$/)
      .optional(),
  })
  .strict();

export function parseGitStashRefParams(raw: unknown): GitStashRefParams | null {
  const result = GitStashRefParamsSchema.safeParse(raw);
  return result.success ? result.data : null;
}

export const GitDiffComparisonSchema = z.enum(['staged', 'worktree'] as const);

export const GitDiffFileParamsSchema = z
  .object({
    workspaceRoot: z.string().min(1).optional(),
    path: z.string().min(1),
    comparison: GitDiffComparisonSchema,
    originalPath: z.string().min(1).optional(),
  })
  .strict();

/**
 * Parse `git:diffFile` params.
 *
 * Returns `null` for anything malformed so the handler can answer with a
 * structured read error rather than throwing an unmapped transport fault.
 */
export function parseGitDiffFileParams(raw: unknown): GitDiffFileParams | null {
  const result = GitDiffFileParamsSchema.safeParse(raw);
  return result.success ? result.data : null;
}

export const GitApplyHunksOperationSchema = z.enum([
  'stage',
  'unstage',
  'revert',
] as const);

/**
 * `git:applyHunks` params — the only `git:*` payload that mutates the index or
 * the working tree, so it is validated in full before git is touched (NFR-3).
 *
 * The schema proves shape only. It deliberately does NOT encode which
 * operations are legal for which comparison: that matrix is enforced in
 * `GitInfoService.applyHunks`, where it is reachable by every host and cannot
 * be bypassed by a caller that reaches the service directly.
 *
 * `snapshotToken` is `min(1)` because the empty string is what a failed
 * `git:diffFile` returns; accepting it would let a caller ask to write against
 * a snapshot that was never taken.
 */
export const GitApplyHunksParamsSchema = z
  .object({
    workspaceRoot: z.string().min(1).optional(),
    path: z.string().min(1),
    originalPath: z.string().min(1).optional(),
    comparison: GitDiffComparisonSchema,
    operation: GitApplyHunksOperationSchema,
    hunkIndices: z.array(z.number().int().nonnegative()).min(1),
    snapshotToken: z.string().min(1),
  })
  .strict();

/**
 * Parse `git:applyHunks` params.
 *
 * Returns `null` for anything malformed so the handler can answer with a
 * structured refusal rather than throwing an unmapped transport fault.
 */
export function parseGitApplyHunksParams(
  raw: unknown,
): GitApplyHunksParams | null {
  const result = GitApplyHunksParamsSchema.safeParse(raw);
  return result.success ? result.data : null;
}
