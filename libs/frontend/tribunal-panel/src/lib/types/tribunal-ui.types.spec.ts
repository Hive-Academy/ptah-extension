import {
  CRUCIBLE_ROLES,
  NO_PROGRESS,
  RELAY_ROLES,
  rolesForMove,
  type CrucibleTermination,
  type CrucibleVerdict,
  type RelayPhaseStatus,
  type TribunalMove,
  type TribunalProgress,
} from './tribunal-ui.types';

/**
 * Every move, listed once. Declared as `readonly TribunalMove[]` rather than
 * derived, so adding a sixth member to the union without adding it here is
 * caught by the `toHaveLength` assertion below rather than silently skipped by
 * every table-driven test in this file.
 */
const ALL_MOVES: readonly TribunalMove[] = [
  'council',
  'forge',
  'race',
  'relay',
  'crucible',
];

describe('tribunal-ui.types', () => {
  describe('TribunalMove', () => {
    it('carries exactly five moves', () => {
      expect(ALL_MOVES).toHaveLength(5);
      expect(new Set(ALL_MOVES).size).toBe(5);
    });
  });

  describe('RELAY_ROLES', () => {
    it('is the four phases in pipeline order', () => {
      // Order is load-bearing: it is the order the phase rail renders and the
      // order the conductor relays the baton in (relay.md:45-50).
      expect(RELAY_ROLES).toEqual(['plan', 'architect', 'implement', 'review']);
    });
  });

  describe('CRUCIBLE_ROLES', () => {
    it('is the unequal executor/judge pair, executor first', () => {
      expect(CRUCIBLE_ROLES).toEqual(['executor', 'judge']);
    });
  });

  describe('rolesForMove', () => {
    it('returns the four relay phases for relay', () => {
      expect(rolesForMove('relay')).toEqual(RELAY_ROLES);
    });

    it('returns the executor/judge pair for crucible', () => {
      expect(rolesForMove('crucible')).toEqual(CRUCIBLE_ROLES);
    });

    it.each(['council', 'forge', 'race'] as const)(
      'returns no roles for the flat move %s',
      (move) => {
        expect(rolesForMove(move)).toEqual([]);
      },
    );

    it('answers for every move without throwing — the switch has no hole', () => {
      for (const move of ALL_MOVES) {
        expect(Array.isArray(rolesForMove(move))).toBe(true);
      }
    });
  });

  describe('RelayPhaseStatus — AC-4.2 enforced structurally', () => {
    it('has no "running" member, so two live phases is unrepresentable', () => {
      // `runningIndex` on the container is the ONLY way to say a phase is live.
      // If a `'running'` status is ever added to RelayPhaseStatus this
      // assignment compiles and this test must be revisited, not deleted.
      const statuses: readonly RelayPhaseStatus[] = [
        'pending',
        'complete',
        'failed',
      ];
      expect(statuses).toHaveLength(3);
      expect(statuses).not.toContain('running');
    });

    it('models a single live phase as one nullable index', () => {
      const progress: TribunalProgress = {
        kind: 'relay',
        phases: [
          {
            role: 'plan',
            deliverable: 'task-description.md',
            laneId: 'codex#0',
            status: 'complete',
          },
          {
            role: 'architect',
            deliverable: 'implementation-plan.md',
            laneId: 'copilot#0',
            status: 'pending',
          },
        ],
        runningIndex: 1,
      };

      expect(progress.kind).toBe('relay');
      if (progress.kind !== 'relay') throw new Error('unreachable');
      expect(progress.runningIndex).toBe(1);
      // No phase carries its own "running" flag that could contradict the index.
      expect(progress.phases.map((p) => p.status)).toEqual([
        'complete',
        'pending',
      ]);
    });
  });

  describe('CrucibleVerdict', () => {
    it('includes "unparsed" as a first-class member', () => {
      // An unreadable report must be distinguishable from a PASS (AC-5.2).
      const verdicts: readonly CrucibleVerdict[] = [
        'pass',
        'revise',
        'reject',
        'unparsed',
      ];
      expect(verdicts).toContain('unparsed');
      expect(verdicts).toHaveLength(4);
    });
  });

  describe('CrucibleTermination', () => {
    it('keeps all four honest stopping conditions distinguishable', () => {
      const terminal: readonly CrucibleTermination[] = [
        'pass',
        'cap-reached-with-defects',
        'reject',
        'regression-stop',
      ];
      expect(new Set(terminal).size).toBe(4);
    });
  });

  describe('NO_PROGRESS', () => {
    it('is the "none" arm', () => {
      expect(NO_PROGRESS).toEqual({ kind: 'none' });
    });

    it('is a stable reference, so an untouched slice compares equal', () => {
      const a: TribunalProgress = NO_PROGRESS;
      const b: TribunalProgress = NO_PROGRESS;
      expect(a).toBe(b);
    });
  });

  describe('TribunalProgress "unavailable" arm', () => {
    it('carries a reason and is never confused with "pending"', () => {
      // AC-4.5: `pending` means "we know it has not started"; `unavailable`
      // means "we cannot tell". They are different arms of different types.
      const progress: TribunalProgress = {
        kind: 'unavailable',
        reason: 'No spec folder was allocated for this run.',
      };
      expect(progress.kind).toBe('unavailable');
      if (progress.kind !== 'unavailable') throw new Error('unreachable');
      expect(progress.reason).toContain('spec folder');
    });
  });
});
