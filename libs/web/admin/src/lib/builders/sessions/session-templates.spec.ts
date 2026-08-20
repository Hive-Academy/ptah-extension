import type { MemberGroup } from '../../services/admin-api.service';
import { colorForKey, toSessionTemplates } from './session-templates';

function cohort(overrides: Partial<MemberGroup> = {}): MemberGroup {
  return {
    id: 'grp-1',
    key: 'founding',
    name: 'Founding',
    description: null,
    sessionEventId: 'series-1',
    isDefault: true,
    memberCount: 12,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('session-templates', () => {
  it('derives one template per cohort, seeded with a title and reach', () => {
    const [template] = toSessionTemplates([
      cohort({ key: 'pro', name: 'Pro Estate', memberCount: 40 }),
    ]);

    expect(template).toEqual(
      expect.objectContaining({
        id: 'pro',
        title: 'Pro Estate — Live Session',
        cohortName: 'Pro Estate',
        memberCount: 40,
        durationMinutes: 60,
        hasOwnSeries: true,
      }),
    );
  });

  it('keeps a cohort without its own series — it still runs sessions', () => {
    // A null `sessionEventId` means the cohort falls back to
    // BUILDERS_SESSION_EVENT_ID, not that it has no sessions. Filtering it out
    // would remove a chip the admin has every reason to drag.
    const templates = toSessionTemplates([cohort({ sessionEventId: null })]);

    expect(templates).toHaveLength(1);
    expect(templates[0].hasOwnSeries).toBe(false);
  });

  it('preserves server order', () => {
    const templates = toSessionTemplates([
      cohort({ key: 'b' }),
      cohort({ key: 'a' }),
    ]);

    expect(templates.map((t) => t.id)).toEqual(['b', 'a']);
  });

  it('returns nothing for no cohorts rather than inventing a default', () => {
    expect(toSessionTemplates([])).toEqual([]);
  });

  describe('colour assignment', () => {
    it('is stable for a given key', () => {
      expect(colorForKey('founding')).toBe(colorForKey('founding'));
    });

    it('survives a cohort being added, removed, or reordered', () => {
      // Hashed rather than index-based: an index would reshuffle every chip the
      // moment the list changed, and the admin would have to relearn it.
      //
      // ⚠️ Uses MULTI-CHARACTER, SAME-LENGTH keys deliberately. An earlier
      // version compared single letters, which a degenerate hash (`key.length`)
      // maps to one colour — so the assertion held while the property it names
      // was gone. A mutation audit caught it.
      const before = toSessionTemplates([cohort({ key: 'builders' })]);
      const after = toSessionTemplates([
        cohort({ key: 'founding' }),
        cohort({ key: 'builders' }),
        cohort({ key: 'alumni77' }),
      ]);

      const movedChip = after.find((t) => t.id === 'builders');
      expect(movedChip?.color).toBe(before[0].color);
    });

    it('gives different cohorts different colours', () => {
      // Without this, "stable per key" is satisfied by returning one constant
      // for everything — every chip identical and the colour carrying no
      // information at all.
      const colors = toSessionTemplates([
        cohort({ key: 'founding' }),
        cohort({ key: 'builders' }),
        cohort({ key: 'alumni77' }),
        cohort({ key: 'partners' }),
      ]).map((t) => t.color);

      expect(new Set(colors).size).toBeGreaterThan(1);
    });

    it('distinguishes keys of identical length', () => {
      // A length-based hash would collide every one of these.
      const colors = toSessionTemplates([
        cohort({ key: 'aaaa' }),
        cohort({ key: 'bbbb' }),
        cohort({ key: 'cccc' }),
        cohort({ key: 'dddd' }),
        cohort({ key: 'eeee' }),
      ]).map((t) => t.color);

      expect(new Set(colors).size).toBeGreaterThan(1);
    });

    it('never emits the brand amber or the info blue', () => {
      // Amber is the "now" indicator and primary buttons; info blue already
      // means "protected recurring series" throughout this feature.
      const colors = toSessionTemplates(
        ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((key) => cohort({ key })),
      ).map((t) => t.color.toLowerCase());

      expect(colors).not.toContain('#f5a524');
      expect(colors).not.toContain('#38bdf8');
    });
  });
});
