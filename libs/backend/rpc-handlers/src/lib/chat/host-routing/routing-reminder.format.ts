/**
 * Pure text builders for the host routing reminder (TASK_2026_857, Component 16).
 *
 * Neither text tells the model to call `route_decide`; executor choice stays
 * with gate-0.1 at plan approval.
 */
import type { PreflightResult } from '@ptah-extension/lane-routing';

/** Upper bound for one reminder; matches the next-turn queue cap. */
export const ROUTING_REMINDER_MAX_LENGTH = 600;

const MAX_LABEL_LENGTH = 48;

export const ROUTING_NUDGE_TEXT =
  'Routing: the engineering scope does not look settled yet. Confirm the goal and boundaries with the user before planning.';

const CLOSING = 'Executor choice stays with gate-0.1 at plan approval.';

/** Currently available executors. `null` or empty omits that part. */
export interface RoutingCandidates {
  readonly lanes: readonly string[] | null;
  readonly subagents: readonly string[] | null;
}

type PreflightAnswer = PreflightResult['taskType'] | PreflightResult['depth'];

/**
 * The `Routing:` reminder for a pre-flight result, or `null` when the result
 * carries no model judgement (both answers are skill-table fallbacks with a
 * cause) and so is not worth a reminder.
 */
export function formatRoutingReminder(
  result: PreflightResult,
  candidates: RoutingCandidates,
): string | null {
  if (isFallbackOnly(result.taskType) && isFallbackOnly(result.depth)) {
    return null;
  }
  const parts = [
    `Routing: pre-flight taskType=${answerText(result.taskType)}; depth=${answerText(result.depth)}.`,
  ];
  const lanes = listText(candidates.lanes);
  if (lanes !== null) parts.push(`Available lanes: ${lanes}.`);
  const subagents = listText(candidates.subagents);
  if (subagents !== null) parts.push(`Available subagents: ${subagents}.`);
  parts.push(CLOSING);
  return parts.join(' ').slice(0, ROUTING_REMINDER_MAX_LENGTH);
}

function isFallbackOnly(answer: PreflightAnswer): boolean {
  return answer.source === 'skill-table' && answer.fallbackCause !== null;
}

function answerText(answer: PreflightAnswer): string {
  const value = answer.value ?? 'undetermined';
  const confidence =
    answer.confidence === null ? '' : `, ${answer.confidence.toFixed(2)}`;
  return `${value} (${answer.source}${confidence})`;
}

function listText(labels: readonly string[] | null): string | null {
  if (labels === null) return null;
  const kept = labels
    .map((label) => label.trim().slice(0, MAX_LABEL_LENGTH))
    .filter((label) => label.length > 0);
  return kept.length === 0 ? null : kept.join(', ');
}
