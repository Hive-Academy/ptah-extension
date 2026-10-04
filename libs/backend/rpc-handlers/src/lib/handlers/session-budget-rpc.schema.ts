/**
 * Zod schema for {@link SessionBudgetRpcHandlers} (TASK_2026_597 N7).
 *
 * `session:budgetAction` params arrive from the webview's budget banner. The
 * session id becomes a map key in `SessionBudgetService` and, for the handoff
 * actions, part of a file name under `~/.ptah/handoffs/`, so it must be an SDK
 * session UUID; the action must be one of the five banner actions.
 */
import { z } from 'zod';
import {
  UUID_REGEX,
  type RpcMethodParams,
  type SessionBudgetAction,
} from '@ptah-extension/shared';

/** The banner actions, in the order the shared union declares them. */
export const SESSION_BUDGET_ACTIONS = [
  'dismiss',
  'extend',
  'restore-window',
  'write-handoff',
  'preview-handoff',
] as const satisfies readonly SessionBudgetAction[];

export const SessionBudgetActionParamsSchema = z.object({
  sessionId: z.string().regex(UUID_REGEX),
  action: z.enum(SESSION_BUDGET_ACTIONS),
});

/**
 * Parse `session:budgetAction` params.
 *
 * Returns `null` for anything malformed so the handler can answer with a
 * structured `{ success: false }` result instead of an unmapped transport
 * fault.
 */
export function parseSessionBudgetActionParams(
  raw: unknown,
): RpcMethodParams<'session:budgetAction'> | null {
  const result = SessionBudgetActionParamsSchema.safeParse(raw);
  return result.success ? result.data : null;
}
