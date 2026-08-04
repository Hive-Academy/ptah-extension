import type { MemberContext } from '@ptah-api/membership';
import { CommunitySection } from './community.section';
import { EMPTY_NOTIFICATIONS } from './hub-section';
import { LearningSection } from './learning.section';
import { NotificationsSection } from './notifications.section';
import { PacksSection } from './packs.section';

/**
 * The four sections Phase 1 does not populate.
 *
 * ⚠️ THIS FILE IS NOT TESTING A CONSTANT — it is pinning the `'empty'` versus
 * `'unavailable'` distinction. "You have no unread topics" and "the forum is
 * down" are different messages, and Phase 1's four sections are genuinely the
 * FIRST, not the second: nothing has failed and nothing is switched off, the
 * tables simply do not exist yet. A later batch that fills one of these in must
 * change `'empty'` to `'ok'`; a batch that changes it to `'unavailable'` has
 * mislabelled a working system as a broken one and burned the only signal R6.4
 * has.
 *
 * The empty SHAPES are pinned for the same reason: the contract requires array
 * sections to send `[]` in every status so one client renderer handles all
 * three (R6.3). A `null` here would make the member panel's community card the
 * one that has to null-guard, and it is the one nobody would remember to.
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

describe('the four Phase-1 empty sections', () => {
  it('learning is empty with a null payload (there is no such thing as an empty ContinueLearning)', async () => {
    await expect(
      new LearningSection().resolve(memberContext()),
    ).resolves.toEqual({ status: 'empty', data: null });
  });

  it('community is empty with an EMPTY ARRAY, never null', async () => {
    await expect(
      new CommunitySection().resolve(memberContext()),
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
        new LearningSection(),
        new CommunitySection(),
        new PacksSection(),
        new NotificationsSection(),
      ].map(async (section) => (await section.resolve(memberContext())).status),
    );

    expect(statuses).toEqual(['empty', 'empty', 'empty', 'empty']);
  });

  it('a member with cohorts gets the same answer — none of these is cohort-gated yet', async () => {
    await expect(
      new CommunitySection().resolve(
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
