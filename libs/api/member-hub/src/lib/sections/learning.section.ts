import { Injectable } from '@nestjs/common';
import type { ContinueLearning, HubSection } from '@ptah-contracts/community';
import type { MemberContext } from '@ptah-api/membership';
import type { HubSectionResolver } from './hub-section';

/**
 * The hub's `learning` section — "continue where you left off" (R6.1).
 *
 * ── PHASE 1: `{ status: 'empty', data: null }` ─────────────────────────────
 * There is no `Course`, `Lesson` or `LessonProgress` table yet — Batch 9 (P3)
 * creates them. So this reports `'empty'`, which is the literal truth: the
 * source answered and there is genuinely nothing to continue.
 *
 * ⚠️ `'empty'`, NOT `'unavailable'`. Nothing has failed and nothing is
 * switched off. `'unavailable'` would make the member's home screen apologise
 * for an outage that is not happening, and it would burn the one signal R6.4
 * needs to stay meaningful — if a not-yet-built section is indistinguishable
 * from a broken one, a real breakage is invisible.
 *
 * ⚠️ THIS FILE IS THE SEAM, NOT A PLACEHOLDER. Batch 9 replaces the body of
 * `resolve` with the two-query lookup from AD-4 (one `Lesson` join for the next
 * incomplete lesson in course order, one `groupBy` for completed counts) and
 * changes NOTHING else — not the envelope, not the composer, not the client.
 * That is the whole reason all five sections are declared in Phase 1.
 */
@Injectable()
export class LearningSection implements HubSectionResolver<ContinueLearning | null> {
  async resolve(
    _ctx: MemberContext,
  ): Promise<HubSection<ContinueLearning | null>> {
    return { status: 'empty', data: null };
  }
}
