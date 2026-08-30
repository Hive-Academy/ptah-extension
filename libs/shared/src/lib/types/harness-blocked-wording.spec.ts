/**
 * The guard on the guard.
 *
 * Five surfaces tell a user how to clear a blocked harness path, and each has
 * its own spec asserting it renders an approved sentence. Those specs are only
 * worth what the checker underneath them is worth, so this file proves the
 * checker actually FAILS — on the exact phrasings the old eight-regex denylist
 * let through, and on a destructive verb placed outside the action clause.
 *
 * The two named in TASK_2026_309 are "purge" and "remove the occupant".
 * "Purge" was never in the denylist at all; "remove" was in the denylist but
 * only on two of the five surfaces, so "remove the occupant" would have
 * shipped on the Dashboard card, the Marketplace popover and the health store
 * with a green suite.
 */
import {
  HARNESS_BLOCKED_APPROVED_ACTIONS,
  HARNESS_BLOCKED_APPROVED_PROSE,
  HARNESS_BLOCKED_RECONCILE_STEPS,
  HARNESS_BLOCKED_WARN_MESSAGE,
  HARNESS_BLOCKED_WARN_NOTE,
  HARNESS_BLOCKED_WARN_REASONS,
  HARNESS_REPAIR_REASONS,
  containsDestructiveVerb,
  harnessBlockedAction,
  harnessBlockedWordingViolations,
  type HarnessBlockedSurface,
} from './harness-blocked-wording';

const SURFACES: readonly HarnessBlockedSurface[] = [
  'reconcile-warn',
  'marketplace-popover',
  'dashboard-card',
  'repair-dialog',
  'health-store',
];

/**
 * The whole rendered surface, as each surface's own spec supplies it. Only the
 * action is needed to exercise the action rule; the other approved prose is
 * added where a surface has some, so the residue rule is exercised too.
 */
const wholeTextFor = (surface: HarnessBlockedSurface, action: string): string =>
  [
    ...HARNESS_BLOCKED_APPROVED_PROSE[surface].filter(
      (fragment) => fragment !== HARNESS_BLOCKED_APPROVED_ACTIONS[surface],
    ),
    action,
  ].join(' | ');

describe('harnessBlockedWordingViolations', () => {
  describe('the approved wording passes', () => {
    it.each(SURFACES)('%s', (surface) => {
      const action = HARNESS_BLOCKED_APPROVED_ACTIONS[surface];

      expect(
        harnessBlockedWordingViolations({
          surface,
          action,
          wholeText: wholeTextFor(surface, action),
        }),
      ).toEqual([]);
    });
  });

  describe('a destructive verb in the action fails on every surface', () => {
    // The two the eight-regex denylist let through. "purge" was never in it;
    // "remove" was, but only on two of the five surfaces.
    const swaps: readonly (readonly [string, string])[] = [
      ['Move the occupant aside', 'Purge the occupant'],
      ['Move the occupant aside', 'Remove the occupant'],
      ['Move the occupant aside', 'Wipe the occupant'],
      ['Move the occupant aside', 'Nuke the occupant'],
      ['Move the occupant aside', 'Get rid of the occupant'],
      ['Move blocked paths aside', 'Drop the blocked paths'],
    ];

    for (const surface of SURFACES) {
      for (const [from, to] of swaps) {
        const approved = HARNESS_BLOCKED_APPROVED_ACTIONS[surface];
        if (!approved.includes(from)) continue;

        it(`${surface}: "${to}"`, () => {
          const reworded = approved.replace(from, to);

          const violations = harnessBlockedWordingViolations({
            surface,
            action: reworded,
            wholeText: wholeTextFor(surface, reworded),
          });

          expect(violations.length).toBeGreaterThan(0);
          expect(violations[0]).toContain('is not the approved sentence');
        });
      }
    }
  });

  it('fails a destructive verb placed OUTSIDE the action clause', () => {
    // TASK_2026_306 Batch 12 inserted a sentence into the middle of the
    // reconcile WARN's paragraph. An action-only check would pass this.
    const action = HARNESS_BLOCKED_APPROVED_ACTIONS['reconcile-warn'];

    const violations = harnessBlockedWordingViolations({
      surface: 'reconcile-warn',
      action,
      wholeText: [
        HARNESS_BLOCKED_WARN_MESSAGE,
        HARNESS_BLOCKED_WARN_NOTE,
        'You will want to purge these before the next pass.',
        action,
      ].join(' | '),
    });

    // Both nets fire: the residue rule sees a whole unapproved sentence, and
    // the backstop names the verb inside it.
    expect(violations).toHaveLength(2);
    expect(violations[0]).toContain('unapproved prose');
    expect(violations[0]).toContain('purge these before the next pass');
    expect(violations[1]).toContain('unapproved destructive verb: "purge"');
  });

  it('fails a rewritten per-path reason, which is prose the WARN also carries', () => {
    const action = HARNESS_BLOCKED_APPROVED_ACTIONS['reconcile-warn'];

    const violations = harnessBlockedWordingViolations({
      surface: 'reconcile-warn',
      action,
      wholeText: [
        HARNESS_BLOCKED_WARN_MESSAGE,
        HARNESS_BLOCKED_WARN_NOTE,
        'occupied by a file you should get rid of yourself',
        action,
      ].join(' | '),
    });

    expect(violations).toHaveLength(2);
    expect(violations[0]).toContain('unapproved prose');
    expect(violations[1]).toContain(
      'unapproved destructive verb: "get rid of"',
    );
  });

  describe('the length-independent backstop', () => {
    // `PROSE_RUN` needs four words, because a target label ("Claude Code") and
    // a heading ("13 blocked paths") are not prose and must not each need
    // approving. That threshold is right and stays — but it means a two-word
    // button label is structurally invisible to it. The backstop is a
    // DENYLIST, which is sound only because it sits UNDER an authoritative
    // allowlist: approval comes from the allowlist alone, so this can add a
    // failure and can never grant permission.
    const short = [
      'Delete these',
      'Purge it',
      'Wipe it',
      'Nuke this',
      'Remove them',
      'Trash it',
      'Drop these',
      'Erase it',
    ];

    it.each(short)('catches "%s" as a button label', (label) => {
      const action = HARNESS_BLOCKED_APPROVED_ACTIONS['repair-dialog'];

      const violations = harnessBlockedWordingViolations({
        surface: 'repair-dialog',
        action,
        wholeText: `${wholeTextFor('repair-dialog', action)} | ${label}`,
      });

      expect(violations).toHaveLength(1);
      expect(violations[0]).toContain('unapproved destructive verb');
    });

    it('stays silent when the residue is genuinely just data', () => {
      // The backstop must not turn every path and label into a finding, or it
      // becomes the thing it is backing up.
      const action = HARNESS_BLOCKED_APPROVED_ACTIONS['dashboard-card'];

      expect(
        harnessBlockedWordingViolations({
          surface: 'dashboard-card',
          action,
          wholeText: `${wholeTextFor('dashboard-card', action)} | Claude Code | .claude/skills/legacy-0 | 13 blocked paths`,
        }),
      ).toEqual([]);
    });
  });

  describe('`data` cannot be used to launder wording', () => {
    it('rejects an instruction declared as data', () => {
      // `data` is struck unconditionally, which is exactly why it must not
      // become the door round the allowlist. A path or a label is short and
      // has no destructive verb in it; a sentence telling the user to destroy
      // something is neither.
      const action = HARNESS_BLOCKED_APPROVED_ACTIONS['repair-dialog'];

      const violations = harnessBlockedWordingViolations({
        surface: 'repair-dialog',
        action,
        wholeText: `${wholeTextFor('repair-dialog', action)} | you should delete the occupant yourself`,
        data: ['you should delete the occupant yourself'],
      });

      expect(violations).toHaveLength(1);
      expect(violations[0]).toContain('was passed as `data` but reads as an');
    });

    it('still accepts a real OS error string, a path and a label', () => {
      const action = HARNESS_BLOCKED_APPROVED_ACTIONS['repair-dialog'];

      expect(
        harnessBlockedWordingViolations({
          surface: 'repair-dialog',
          action,
          wholeText: `${wholeTextFor('repair-dialog', action)} | EBUSY: resource busy or locked | .claude/skills/a | Claude Code`,
          data: [
            'EBUSY: resource busy or locked',
            '.claude/skills/a',
            'Claude Code',
          ],
        }),
      ).toEqual([]);
    });
  });

  it('does not mistake paths, counts or target labels for prose', () => {
    // Data is not a wording decision. A filename is the user's, and a heading
    // of "13 blocked paths" is arithmetic.
    const action = HARNESS_BLOCKED_APPROVED_ACTIONS['marketplace-popover'];

    expect(
      harnessBlockedWordingViolations({
        surface: 'marketplace-popover',
        action,
        wholeText: [
          '13 blocked paths',
          'Claude Code',
          '.claude/skills/orchestration',
          '.vscode/mcp.json#wanted',
          wholeTextFor('marketplace-popover', action),
        ].join(' | '),
      }),
    ).toEqual([]);
  });

  it('accepts declared data without accepting it as wording', () => {
    // A fixture reason injected by a spec is data. It is struck out only
    // because the caller named it, which keeps the declaration visible in the
    // spec that made it.
    const action = HARNESS_BLOCKED_APPROVED_ACTIONS['repair-dialog'];
    const reason = 'the directory is open in another program';

    expect(
      harnessBlockedWordingViolations({
        surface: 'repair-dialog',
        action,
        wholeText: `${wholeTextFor('repair-dialog', action)} | ${reason}`,
        data: [reason],
      }),
    ).toEqual([]);

    expect(
      harnessBlockedWordingViolations({
        surface: 'repair-dialog',
        action,
        wholeText: `${wholeTextFor('repair-dialog', action)} | ${reason}`,
      }),
    ).not.toEqual([]);
  });

  describe('the repair `reason` field is PROSE, not data', () => {
    // The sixth surface. `HarnessRepairPathResult.reason` is populated by
    // `HarnessBlockedRepairService` with Ptah-authored sentences and rendered
    // unconditionally at `harness-repair-dialog.component.ts:276-280`. It was
    // invisible to the first version of this guard because every spec passed
    // an invented fixture as `data`, and `data` is struck before scanning.

    it('accepts every real reason literal WITHOUT it being declared as data', () => {
      const action = HARNESS_BLOCKED_APPROVED_ACTIONS['repair-dialog'];

      for (const reason of Object.values(HARNESS_REPAIR_REASONS)) {
        expect(
          harnessBlockedWordingViolations({
            surface: 'repair-dialog',
            action,
            wholeText: `${wholeTextFor('repair-dialog', action)} | ${reason}`,
          }),
        ).toEqual([]);
      }
    });

    it('accepts the quarantine assertion messages that reach the same field through describeError', () => {
      const action = HARNESS_BLOCKED_APPROVED_ACTIONS['repair-dialog'];
      const path = '.claude/skills/.ptah-quarantine/alpha-20260823T141530123';

      for (const tail of [
        `${HARNESS_REPAIR_REASONS.moveFailed} the move reported success but ${path} is still in place`,
        `${HARNESS_REPAIR_REASONS.moveFailed} quarantine destination is exhausted for alpha at ${path}`,
      ]) {
        expect(
          harnessBlockedWordingViolations({
            surface: 'repair-dialog',
            action,
            wholeText: `${wholeTextFor('repair-dialog', action)} | ${tail}`,
            data: [path, 'alpha'],
          }),
        ).toEqual([]);
      }
    });

    it('fails a destructive rewrite of any one of them', () => {
      const action = HARNESS_BLOCKED_APPROVED_ACTIONS['repair-dialog'];

      for (const reason of [
        'could not move the occupant aside, so we deleted it instead:',
        'the managed copy could not be written, so your original was purged',
        'this is a server key inside a config file you also write, not a file — just delete the key',
        'this path is not in the current blocked set, so it was removed',
      ]) {
        expect(
          harnessBlockedWordingViolations({
            surface: 'repair-dialog',
            action,
            wholeText: `${wholeTextFor('repair-dialog', action)} | ${reason}`,
          }).length,
        ).toBeGreaterThan(0);
      }
    });
  });

  it('reports the action it expected, so a reviewer reads the intent rather than a ban list', () => {
    // The denylist this replaces could only ever say "you used a forbidden
    // word". The allowlist says what the sentence is supposed to be.
    const violations = harnessBlockedWordingViolations({
      surface: 'dashboard-card',
      action: 'Delete the occupant.',
      wholeText: 'Delete the occupant.',
    });

    expect(violations[0]).toContain('Move the occupant aside');
    expect(violations[0]).toContain(
      'libs/shared/src/lib/types/harness-blocked-wording.ts',
    );
  });
});

describe('the approved action strings', () => {
  it('all open on MOVE', () => {
    for (const surface of SURFACES) {
      expect(HARNESS_BLOCKED_APPROVED_ACTIONS[surface]).toMatch(
        /^(Move|Failed to move)/,
      );
    }
  });

  it('differ between the three "clear it yourself" surfaces in exactly one clause', () => {
    // The point of the builder: the opening and the closing are one definition,
    // and only the clause naming WHERE to act varies — because the control is
    // not in the same place on the log line, the popover and the card.
    for (const surface of [
      'reconcile-warn',
      'marketplace-popover',
      'dashboard-card',
    ] as const) {
      const action = harnessBlockedAction(surface);
      expect(action).toBe(HARNESS_BLOCKED_APPROVED_ACTIONS[surface]);
      expect(action).toContain(HARNESS_BLOCKED_RECONCILE_STEPS[surface]);
      expect(
        action.replace(HARNESS_BLOCKED_RECONCILE_STEPS[surface], '<step>'),
      ).toBe(
        'Move the occupant aside — the file or directory at each path, or the ' +
          'conflicting key in each config file — <step> Nothing here proves ' +
          'Ptah wrote these, so they may be your own work: keep what you move, ' +
          'and read it before you discard anything.',
      );
    }
  });

  it('never approves a destructive verb — the allowlist is checked against itself', () => {
    // The one path the two-sided pin cannot close on its own. Editing a
    // production string alone fails its surface spec; editing the constant
    // alone fails it too. Editing BOTH, in one commit, to say "we purged it"
    // would satisfy every equality in this change — the allowlist is the
    // approval record, and that edit IS a human approval. This case says that
    // particular approval may not be given: a verb that means destruction
    // cannot become approved wording by being typed into this file.
    //
    // Sound as a denylist for the same reason the residue backstop is: it sits
    // under the allowlist and can only ever REMOVE permission, never grant it.
    const approved = [
      ...Object.values(HARNESS_BLOCKED_APPROVED_ACTIONS),
      ...Object.values(HARNESS_BLOCKED_APPROVED_PROSE).flat(),
      ...Object.values(HARNESS_REPAIR_REASONS),
      ...Object.values(HARNESS_BLOCKED_WARN_REASONS),
      HARNESS_BLOCKED_WARN_MESSAGE,
      HARNESS_BLOCKED_WARN_NOTE,
    ];

    for (const sentence of approved) {
      expect([sentence, containsDestructiveVerb(sentence)]).toEqual([
        sentence,
        false,
      ]);
    }
  });

  it('keeps the properties the prose exists to carry', () => {
    for (const surface of SURFACES) {
      const action = HARNESS_BLOCKED_APPROVED_ACTIONS[surface];
      if (surface === 'health-store') continue;
      // Ownership is never claimed, and the judgement is handed back.
      expect(action).toContain('read it before you discard anything');
      expect(action).toContain('proves Ptah wrote these');
    }
    expect(HARNESS_BLOCKED_WARN_REASONS.occupiedPath).toContain(
      'Ptah does not own',
    );
  });
});
