import { rosterIsLaunchable, validateRoster } from './tribunal-roster-rules';
import type { LaneRole, VendorLane } from '../types/tribunal-ui.types';

function lane(
  role: LaneRole,
  family: string,
  model?: string,
  laneId = `${family}#${role}`,
): VendorLane {
  return {
    laneId,
    family,
    displayName: `${family} (${role})`,
    cli: family === 'ptah-cli' ? 'ptah-cli' : 'codex',
    role,
    ...(model ? { model } : {}),
  };
}

const FULL_RELAY: readonly VendorLane[] = [
  lane('plan', 'codex'),
  lane('architect', 'copilot'),
  lane('implement', 'cursor'),
  lane('review', 'antigravity'),
];

const FULL_CRUCIBLE: readonly VendorLane[] = [
  lane('executor', 'codex'),
  lane('judge', 'copilot'),
];

function blocks(issues: readonly { severity: string }[]): number {
  return issues.filter((i) => i.severity === 'block').length;
}

describe('validateRoster', () => {
  describe('flat moves have no role model', () => {
    it.each(['council' as const, 'forge' as const, 'race' as const])(
      '%s produces no issues even with roleless lanes',
      (move) => {
        const flat: VendorLane[] = [
          {
            laneId: 'codex#0',
            family: 'codex',
            displayName: 'Codex',
            cli: 'codex',
          },
        ];
        expect(validateRoster(move, flat)).toEqual([]);
        expect(rosterIsLaunchable(move, flat)).toBe(true);
      },
    );

    it('does not block a flat move on an empty roster — that rule lives in prepare()', () => {
      expect(validateRoster('council', [])).toEqual([]);
    });
  });

  describe('relay', () => {
    it('accepts a fully assigned, all-distinct roster', () => {
      expect(validateRoster('relay', FULL_RELAY)).toEqual([]);
      expect(rosterIsLaunchable('relay', FULL_RELAY)).toBe(true);
    });

    it('blocks when any phase is unassigned', () => {
      const issues = validateRoster('relay', FULL_RELAY.slice(0, 3));
      expect(blocks(issues)).toBe(1);
      expect(issues[0].message).toContain('review');
      expect(rosterIsLaunchable('relay', FULL_RELAY.slice(0, 3))).toBe(false);
    });

    it('names every unfilled phase, not just the first', () => {
      const issues = validateRoster('relay', [lane('plan', 'codex')]);
      expect(issues[0].message).toContain('architect');
      expect(issues[0].message).toContain('implement');
      expect(issues[0].message).toContain('review');
    });

    it('blocks an empty roster', () => {
      expect(rosterIsLaunchable('relay', [])).toBe(false);
    });

    it('blocks when implement and review are the same family AND model (relay.md:84)', () => {
      const roster = [
        lane('plan', 'codex'),
        lane('architect', 'copilot'),
        lane('implement', 'cursor', 'sonnet-4'),
        lane('review', 'cursor', 'sonnet-4'),
      ];
      const issues = validateRoster('relay', roster);
      expect(blocks(issues)).toBe(1);
      expect(issues[0].message).toContain('cannot be the implement lane');
      expect(rosterIsLaunchable('relay', roster)).toBe(false);
    });

    it('treats two unset models as the same model — an omitted model is a value, not a gap', () => {
      const roster = [
        lane('plan', 'codex'),
        lane('architect', 'copilot'),
        lane('implement', 'cursor'),
        lane('review', 'cursor'),
      ];
      expect(blocks(validateRoster('relay', roster))).toBe(1);
    });

    it('warns — but does not block — on same family, different model (relay.md:85)', () => {
      const roster = [
        lane('plan', 'codex'),
        lane('architect', 'copilot'),
        lane('implement', 'cursor', 'sonnet-4'),
        lane('review', 'cursor', 'opus-4'),
      ];
      const issues = validateRoster('relay', roster);
      expect(blocks(issues)).toBe(0);
      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe('warn');
      expect(issues[0].message).toContain('weaker signal');
      expect(rosterIsLaunchable('relay', roster)).toBe(true);
    });

    it('allows the same family on two NON-adjudicating phases without comment', () => {
      // relay.md:60 — Relay lanes have different jobs, so a family may
      // legitimately appear twice. Only implement-vs-review is constrained.
      const roster = [
        lane('plan', 'codex', 'gpt-5'),
        lane('architect', 'codex', 'gpt-5'),
        lane('implement', 'cursor'),
        lane('review', 'copilot'),
      ];
      expect(validateRoster('relay', roster)).toEqual([]);
    });
  });

  describe('crucible', () => {
    it('accepts a cross-family executor/judge pair', () => {
      expect(validateRoster('crucible', FULL_CRUCIBLE)).toEqual([]);
      expect(rosterIsLaunchable('crucible', FULL_CRUCIBLE)).toBe(true);
    });

    it('blocks when a role is unassigned', () => {
      const issues = validateRoster('crucible', [lane('executor', 'codex')]);
      expect(blocks(issues)).toBe(1);
      expect(issues[0].message).toContain('judge');
    });

    it('blocks a same-family judge with NO override (crucible.md:37, :53)', () => {
      const roster = [
        lane('executor', 'codex', 'gpt-5-mini'),
        lane('judge', 'codex', 'gpt-5-pro'),
      ];
      const issues = validateRoster('crucible', roster);
      expect(blocks(issues)).toBe(1);
      expect(issues[0].severity).toBe('block');
      expect(issues[0].message).toContain('different vendor family');
      expect(rosterIsLaunchable('crucible', roster)).toBe(false);
    });

    it('does not downgrade the same-family judge to a warning', () => {
      // Unlike relay's implement/review pair, there is no warn-level tier here:
      // independence is the entire basis of the loop.
      const roster = [lane('executor', 'codex'), lane('judge', 'codex')];
      expect(
        validateRoster('crucible', roster).every((i) => i.severity === 'block'),
      ).toBe(true);
    });
  });

  describe('lane lookup', () => {
    it('ignores roleless lanes when filling slots', () => {
      const roster: VendorLane[] = [
        ...FULL_CRUCIBLE,
        {
          laneId: 'tribunal-agent#late',
          family: 'cursor',
          displayName: 'late panelist',
          cli: 'cursor',
        },
      ];
      // A late-spawned lane carries no role and must not be mistaken for one.
      expect(validateRoster('crucible', roster)).toEqual([]);
    });
  });
});
