/**
 * Zod schemas for {@link GitWorkflowRpcHandlers} (TASK_2026_576 Component 30).
 *
 * Every payload comes from the renderer. Strict objects: an unknown key is a
 * malformed request, never silently ignored.
 */
import { z } from 'zod';
import type {
  GitCancelOperationParams,
  GitGenerateCommitMessageParams,
  GitLogParams,
  GitOperationAbortParams,
  GitOperationContinueParams,
  GitPrStatusParams,
} from '@ptah-extension/shared';

import {
  GitOperationIdSchema,
  GitWorkspaceScopedParamsSchema,
} from './git-rpc.schema';

export const GitCancelOperationParamsSchema = z
  .object({ operationId: GitOperationIdSchema })
  .strict();

export function parseGitCancelOperationParams(
  raw: unknown,
): GitCancelOperationParams | null {
  const result = GitCancelOperationParamsSchema.safeParse(raw);
  return result.success ? result.data : null;
}

/** Names nothing but the workspace folder; a missing payload is `{}`. */
export const GitGenerateCommitMessageParamsSchema =
  GitWorkspaceScopedParamsSchema;

export function parseGitGenerateCommitMessageParams(
  raw: unknown,
): GitGenerateCommitMessageParams | null {
  const result = GitGenerateCommitMessageParamsSchema.safeParse(raw ?? {});
  return result.success ? result.data : null;
}

/**
 * Names nothing but the workspace folder; a missing payload is `{}`. A
 * client-supplied `branch` is an unknown key: the backend reads the branch.
 */
export const GitPrStatusParamsSchema = GitWorkspaceScopedParamsSchema;

export function parseGitPrStatusParams(raw: unknown): GitPrStatusParams | null {
  const result = GitPrStatusParamsSchema.safeParse(raw ?? {});
  return result.success ? result.data : null;
}

/**
 * Abort, continue and log name nothing but the workspace folder; a missing
 * payload is `{}`. A client-supplied `kind` (or a ref for the log) is an
 * unknown key: the backend re-detects the operation and resolves the base.
 */
export function parseGitOperationAbortParams(
  raw: unknown,
): GitOperationAbortParams | null {
  const result = GitWorkspaceScopedParamsSchema.safeParse(raw ?? {});
  return result.success ? result.data : null;
}

export function parseGitOperationContinueParams(
  raw: unknown,
): GitOperationContinueParams | null {
  const result = GitWorkspaceScopedParamsSchema.safeParse(raw ?? {});
  return result.success ? result.data : null;
}

export function parseGitLogParams(raw: unknown): GitLogParams | null {
  const result = GitWorkspaceScopedParamsSchema.safeParse(raw ?? {});
  return result.success ? result.data : null;
}
