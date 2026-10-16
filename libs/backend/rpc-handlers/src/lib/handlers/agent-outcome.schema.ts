/**
 * Zod schema for `agent:outcomeSignals` (TASK_2026_646 B7, SC-8).
 *
 * `.strict()` rejects a caller that adds a field. At most 500 slugs, each
 * 1–200 characters. The handler puts {@link agentOutcomeIssueText} on the
 * `RpcUserError`, so the webview sees the field and the Zod issue, not the
 * value that failed.
 */

import { z } from 'zod';

export const AgentOutcomeSignalsParamsSchema = z
  .object({
    slugs: z.array(z.string().min(1).max(200)).max(500),
  })
  .strict();

/** First Zod issue as `path: message`. */
export function agentOutcomeIssueText(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return 'Invalid parameters.';
  const path = issue.path.map(String).join('.');
  return path ? `${path}: ${issue.message}` : issue.message;
}
