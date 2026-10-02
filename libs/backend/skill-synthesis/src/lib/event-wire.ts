import type { SkillSynthesisEventWire } from '@ptah-extension/shared';
import type { SkillSynthesisEvent } from './diagnostics.types';

/**
 * The ONE mapping from a recorded event to the wire shape the webview reads.
 * Both the live `SKILL_SYNTHESIS_EVENT` broadcast and the
 * `skillSynthesis:diagnostics` snapshot go through it, so an event carries the
 * same id and the same payload on either path.
 *
 * The wire type has no `candidateId`/`reason` fields, so those are folded into
 * `stats` when present to keep them visible to the UI.
 */
export function toSkillSynthesisEventWire(
  ev: SkillSynthesisEvent,
): SkillSynthesisEventWire {
  const stats =
    ev.candidateId || ev.reason
      ? {
          ...(ev.stats ?? {}),
          ...(ev.candidateId ? { candidateId: ev.candidateId } : {}),
          ...(ev.reason ? { reason: ev.reason } : {}),
        }
      : ev.stats;
  return {
    id: ev.id,
    kind: ev.kind,
    timestamp: ev.timestamp,
    sessionId: ev.sessionId,
    stats,
    error: ev.error,
  };
}
