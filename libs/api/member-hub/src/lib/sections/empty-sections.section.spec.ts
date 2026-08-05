import type { MemberContext } from '@ptah-api/membership';
import type { TopicsReadService } from '@ptah-api/forum';
import type { CourseReadService } from '@ptah-api/learning';
import { CommunitySection } from './community.section';
import { EMPTY_NOTIFICATIONS } from './hub-section';
import { LearningSection } from './learning.section';
import { NotificationsSection } from './notifications.section';
import { PacksSection } from './packs.section';

/**
 * The sections that report `'empty'`, and why that is not `'unavailable'`.
 *
 * ⚠️ THIS FILE IS NOT TESTING A CONSTANT — it is pinning the `'empty'` versus
 * `'unavailable'` distinction. "You have no unread topics" and "the forum is
 * down" are different messages, and these sections are genuinely the FIRST, not
 * the second: nothing has failed and nothing is switched off. A later batch that
 * fills one of these in must change `'empty'` to `'ok'`; a batch that changes it
 * to `'unavailable'` has mislabelled a working system as a broken one and burned
 * the only signal R6.4 has.
 *
 * ⚠️ `community` IS NO LONGER ONE OF THE CONSTANT ONES (TASK_2026_177 P2).
 * Phase 1 returned a hard-coded `{ status: 'empty', data: [] }` because the
 * tables did not exist; Batch 6 created them and this section now queries
 * `TopicsReadService`. It is kept in this file because its `'empty'` case is
 * still real — a member whose visible categories hold no topics — and because
 * that case is now REACHED THROUGH A QUERY rather than returned unconditionally,
 * which is precisely the transition worth asserting. Its `'ok'` and
 * `'unavailable'` paths live in `community.section.spec.ts`.
 *
 * ⚠️ `learning` IS NO LONGER ONE OF THE CONSTANT ONES EITHER (TASK_2026_177 P3),
 * for exactly the same reason and by exactly the same transition. Phase 1
 * returned a hard-coded `{ status: 'empty', data: null }` because `Course`,
 * `Lesson` and `LessonProgress` did not exist; Batch 9 created them and this
 * section now queries `CourseReadService`. It is kept here with an injected stub
 * whose lookup genuinely returns NOTHING — a member with no visible course —
 * because "the query ran and found nothing" is the case this file is about. Its
 * `'ok'` and `'unavailable'` paths live in `learning.section.spec.ts`.
 *
 * ⚠️ AND ITS EMPTY PAYLOAD IS `null`, NOT `[]`, WHICH IS NOT AN INCONSISTENCY.
 * The `[]`-in-every-status rule (R6.3) applies to ARRAY sections so one client
 * renderer handles all three statuses. `ContinueLearning` is a single object and
 * there is no such thing as an empty one; `null` is the honest empty for it, and
 * `'unavailable'` carries the same `null` so the shape still does not vary by
 * status.
 *
 * The empty SHAPES are pinned for the same reason as before: the contract
 * requires array sections to send `[]` in every status so one client renderer
 * handles all three (R6.3). A `null` here would make the member panel's
 * community card the one that has to null-guard, and it is the one nobody would
 * remember to.
 */

function memberContext(overrides: Partial<MemberContext> = {}): MemberContext {
  return {
    userId: 'user_1',
    email: 'member@example.com',
    entitled: true,
    cohortKeys: [],
    isAdmin: false,
    ...overrides,
  };
}

/**
 * A curriculum whose course list genuinely returns nothing — not one that
 * failed.
 *
 * `getCourse` is a `jest.fn()` with NO implementation on purpose: the section
 * must not reach it when there is no course to detail, and an unstubbed call
 * would resolve `undefined` and blow up on `.resumeLesson` — which is a louder
 * failure than a silently-passing stub.
 */
function emptyCurriculum(): CourseReadService {
  return {
    listCourses: jest.fn().mockResolvedValue([]),
    getCourse: jest.fn(),
  } as unknown as CourseReadService;
}

/** A forum whose feed genuinely returns nothing — not one that failed. */
function emptyForum(): TopicsReadService {
  return {
    listFeed: jest.fn().mockResolvedValue({
      items: [],
      page: 1,
      pageSize: 5,
      total: 0,
      hasMore: false,
    }),
  } as unknown as TopicsReadService;
}

describe('the Phase-1 empty sections', () => {
  it('learning is empty with a null payload (there is no such thing as an empty ContinueLearning)', async () => {
    await expect(
      new LearningSection(emptyCurriculum()).resolve(memberContext()),
    ).resolves.toEqual({ status: 'empty', data: null });
  });

  it('community is empty with an EMPTY ARRAY, never null', async () => {
    await expect(
      new CommunitySection(emptyForum()).resolve(memberContext()),
    ).resolves.toEqual({ status: 'empty', data: [] });
  });

  it('packs is empty with an EMPTY ARRAY, never null', async () => {
    // Also the correct answer today for a second reason: `packs` is an
    // admin-only registry with no member-facing read by design, and the table
    // holds zero rows. Batch 14 revisits that decision explicitly.
    await expect(new PacksSection().resolve(memberContext())).resolves.toEqual({
      status: 'empty',
      data: [],
    });
  });

  it('notifications is empty with a zero COUNT OBJECT, not a bare number', async () => {
    await expect(
      new NotificationsSection().resolve(memberContext()),
    ).resolves.toEqual({ status: 'empty', data: { unreadCount: 0 } });
  });

  it('none of them reports "unavailable" — nothing is broken or switched off', async () => {
    const statuses = await Promise.all(
      [
        new LearningSection(emptyCurriculum()),
        new CommunitySection(emptyForum()),
        new PacksSection(),
        new NotificationsSection(),
      ].map(async (section) => (await section.resolve(memberContext())).status),
    );

    expect(statuses).toEqual(['empty', 'empty', 'empty', 'empty']);
  });

  it('a member with cohorts gets the same answer when the forum is genuinely empty', async () => {
    // Cohort scoping now happens INSIDE `listFeed`'s SQL (AD-10, R7.3), so this
    // no longer asserts that the section ignores cohorts — it asserts that a
    // cohort member with nothing visible is `'empty'`, not `'unavailable'`.
    await expect(
      new CommunitySection(emptyForum()).resolve(
        memberContext({ cohortKeys: ['founding'] }),
      ),
    ).resolves.toEqual({ status: 'empty', data: [] });
  });

  it('hands out a COPY of the shared empty-notifications shape', async () => {
    // The shared constant is frozen, but the section must not hand the same
    // object to two concurrent requests either — a caller that mutated it would
    // corrupt every later response in the process.
    const section = new NotificationsSection();

    const first = await section.resolve(memberContext());
    const second = await section.resolve(memberContext());

    expect(first.data).not.toBe(second.data);
    expect(first.data).not.toBe(EMPTY_NOTIFICATIONS);
    expect(first.data).toEqual(EMPTY_NOTIFICATIONS);
  });
});
