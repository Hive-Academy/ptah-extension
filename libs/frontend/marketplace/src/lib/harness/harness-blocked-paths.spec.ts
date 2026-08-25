/**
 * Blocked-paths disclosure specs.
 *
 * The defect this closes is `missing=13, writeFailed=0` with no surface
 * anywhere saying why (`tmp/logs/coldstart-306.log:844`). So these assert what
 * a user READS, not that a helper returned a list: the disclosure is mounted
 * inside the real badge, driven by the real store, against a mocked
 * `ClaudeRpcService` — same shape as `harness-health-badge.component.spec.ts`,
 * which is deliberate. A card that renders thirteen paths and no explanation
 * would pass a list-shaped test and still leave the number unexplained.
 *
 * Three properties get their own cases because they are the ones a well-meaning
 * tidy-up would break:
 *   - the set is `missing ∩ foreign` and nothing wider (a naive `foreign` list
 *     would name paths Ptah never wanted);
 *   - the wording leads with MOVE and never says delete, because provenance is
 *     unknown and move is the reversible half;
 *   - it disappears completely when nothing is blocked.
 */

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ClaudeRpcService } from '@ptah-extension/core';
import type {
  HarnessHealth,
  HarnessTargetHealth,
  HarnessTargetId,
} from '@ptah-extension/shared';
import { summarizeHarnessHealth } from '@ptah-extension/shared';
import { HarnessHealthBadgeComponent } from './harness-health-badge.component';

function ok<T>(data: T) {
  return {
    success: true,
    data,
    error: undefined as string | undefined,
    isSuccess: (): boolean => data !== undefined,
  };
}

function makeTarget(
  target: HarnessTargetId,
  over: Partial<HarnessTargetHealth> = {},
): HarnessTargetHealth {
  return {
    target,
    detected: true,
    facets: {
      skills: 'supported',
      commands: 'supported',
      agents: 'supported',
      mcp: 'supported',
    },
    expected: 4,
    found: 4,
    missing: [],
    foreign: [],
    writeFailed: [],
    overwrittenLocalEdit: [],
    removed: [],
    durationMs: 8,
    ...over,
  };
}

function makeHealth(over: Partial<HarnessHealth> = {}): HarnessHealth {
  return {
    workspaceRoot: 'D:/repo',
    generatedAt: '2026-08-18T10:00:00.000Z',
    mode: 'full',
    reason: 'activation',
    sources: 'ok',
    targets: [makeTarget('claude')],
    collisions: [],
    ...over,
  };
}

describe('harness health card — blocked-paths disclosure', () => {
  let fixture: ComponentFixture<HarnessHealthBadgeComponent>;
  let host: HTMLElement;

  const rpcMock = {
    call: jest.fn(),
  };

  const testId = (id: string): HTMLElement | null =>
    host.querySelector<HTMLElement>(`[data-testid="${id}"]`);

  /**
   * Rendered text with runs of whitespace collapsed. Template line wrapping is
   * a formatting decision; asserting on prose should not be hostage to where
   * prettier chose to break a sentence.
   */
  const text = (id: string): string =>
    (testId(id)?.textContent ?? '').replace(/\s+/g, ' ').trim();

  /** Mount the badge with a report answered by `harness:health`, panel open. */
  const open = async (health: HarnessHealth | null): Promise<void> => {
    rpcMock.call.mockImplementation((method: string) =>
      Promise.resolve(
        method === 'harness:health'
          ? ok({
              health,
              summary: summarizeHarnessHealth(health),
              cached: true,
            })
          : ok(undefined),
      ),
    );
    fixture = TestBed.createComponent(HarnessHealthBadgeComponent);
    host = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    host
      .querySelector<HTMLButtonElement>('[data-testid="harness-health-badge"]')
      ?.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  beforeEach(() => {
    rpcMock.call.mockReset();
    TestBed.configureTestingModule({
      imports: [HarnessHealthBadgeComponent],
      providers: [{ provide: ClaudeRpcService, useValue: rpcMock }],
    });
  });

  afterEach(() => TestBed.resetTestingModule());

  describe('which paths it names', () => {
    it('names the desired paths an unowned file occupies, and only those', async () => {
      // `.claude/skills/gone` is desired and absent — a plain gap, not a
      // refusal. `.claude/skills/theirs` exists but Ptah never wanted it —
      // foreign, not blocked. Only the overlap is a block.
      await open(
        makeHealth({
          targets: [
            makeTarget('claude', {
              found: 2,
              missing: ['.claude/skills/orchestration', '.claude/skills/gone'],
              foreign: [
                '.claude/skills/orchestration',
                '.claude/skills/theirs',
              ],
            }),
          ],
        }),
      );

      const rendered = text('harness-blocked');

      expect(rendered).toContain('.claude/skills/orchestration');
      expect(rendered).not.toContain('.claude/skills/gone');
      expect(rendered).not.toContain('.claude/skills/theirs');
      expect(text('harness-blocked-heading')).toBe('1 blocked path');
    });

    it('preserves the order the target planned its desired entries in', async () => {
      await open(
        makeHealth({
          targets: [
            makeTarget('claude', {
              missing: ['.claude/skills/zebra', '.claude/skills/alpha'],
              foreign: ['.claude/skills/alpha', '.claude/skills/zebra'],
            }),
          ],
        }),
      );

      const rendered = Array.from(
        testId('harness-blocked')?.querySelectorAll('code') ?? [],
      ).map((code) => code.textContent);

      expect(rendered).toEqual([
        '.claude/skills/zebra',
        '.claude/skills/alpha',
      ]);
    });

    it('groups by target under its display name', async () => {
      await open(
        makeHealth({
          targets: [
            makeTarget('claude', {
              missing: ['.claude/skills/a'],
              foreign: ['.claude/skills/a'],
            }),
            makeTarget('cursor', {
              missing: ['.cursor/rules/b'],
              foreign: ['.cursor/rules/b'],
            }),
          ],
        }),
      );

      expect(text('harness-blocked-heading')).toBe('2 blocked paths');
      expect(text('harness-blocked-claude')).toContain('Claude Code');
      expect(text('harness-blocked-claude')).toContain('.claude/skills/a');
      expect(text('harness-blocked-cursor')).toContain('Cursor');
      expect(text('harness-blocked-cursor')).toContain('.cursor/rules/b');
    });

    it('ignores an uninstalled target, so it never claims a bigger shortfall than the badge', async () => {
      // `summarizeHarnessHealth` drops undetected targets from `missing`
      // (E17). Counting their blocked paths here would print "1 blocked path"
      // under a badge reporting a fully in-sync harness.
      await open(
        makeHealth({
          targets: [
            makeTarget('claude'),
            makeTarget('cursor', {
              detected: false,
              expected: 0,
              found: 0,
              missing: ['.cursor/rules/ghost'],
              foreign: ['.cursor/rules/ghost'],
            }),
          ],
        }),
      );

      expect(testId('harness-blocked')).toBeNull();
      expect(
        host.querySelector('[data-testid="harness-health-badge"]')?.textContent,
      ).toContain('Harness in sync');
    });
  });

  describe('what it says', () => {
    it('explains that a refusal is counted as missing and can never be a write failure', async () => {
      // This sentence IS the deliverable — the list is the cheap half.
      await open(
        makeHealth({
          targets: [
            makeTarget('claude', {
              missing: ['.claude/skills/a'],
              foreign: ['.claude/skills/a'],
              writeFailed: [],
            }),
          ],
        }),
      );

      const explanation = text('harness-blocked-explanation');

      expect(explanation).toContain('counts as missing');
      expect(explanation).toContain('never shows up as a write failure');
      expect(explanation).toContain('cannot prove it wrote');
    });

    it("leads with move, warns the occupant may be the user's own work, and never says delete", async () => {
      // Provenance is UNKNOWN — `SkillJunctionService` linked skills and only
      // copied commands, so it never wrote these. Move is reversible; the
      // other verb is not, and the card must not imply Ptah is owed the space.
      await open(
        makeHealth({
          targets: [
            makeTarget('claude', {
              missing: ['.claude/skills/a'],
              foreign: ['.claude/skills/a'],
            }),
          ],
        }),
      );

      const action = text('harness-blocked-action');

      expect(action).toMatch(/^Move the occupant aside/);
      expect(action).toContain('may be your own work');
      expect(action).toContain('read it before you discard anything');
      expect(action.toLowerCase()).not.toContain('delete');
      expect(text('harness-blocked').toLowerCase()).not.toContain('delete');
    });

    it('discloses only — it offers no repair, consent or quarantine control', async () => {
      // Batches 8–9 own the repair, and it is consent-gated precisely because
      // no ownership proof exists. A one-click fix here would make the claim
      // this card is careful not to make.
      await open(
        makeHealth({
          targets: [
            makeTarget('claude', {
              missing: ['.claude/skills/a'],
              foreign: ['.claude/skills/a'],
            }),
          ],
        }),
      );

      const section = testId('harness-blocked');

      expect(section?.querySelectorAll('button')).toHaveLength(0);
      expect(section?.querySelectorAll('input')).toHaveLength(0);
      expect(section?.getAttribute('aria-label')).toBe('Blocked harness paths');
    });
  });

  describe('when it is absent', () => {
    it('renders nothing at all on a healthy report', async () => {
      await open(makeHealth());

      expect(testId('harness-blocked')).toBeNull();
    });

    it('renders nothing when the gaps and the foreign files are disjoint', async () => {
      // Both lists non-empty is the case a `missing.length && foreign.length`
      // shortcut would get wrong.
      await open(
        makeHealth({
          targets: [
            makeTarget('claude', {
              found: 3,
              missing: ['.claude/skills/absent'],
              foreign: ['.claude/skills/somebody-elses'],
            }),
          ],
        }),
      );

      expect(testId('harness-blocked')).toBeNull();
      expect(testId('harness-target-missing')?.textContent).toContain(
        '1 missing',
      );
    });
  });

  describe('the captured cold start', () => {
    it('reads 13 blocked out of 19 foreign, with nothing failed', async () => {
      // `coldstart-306.log:844` — claude=14/27, missing=13, foreign=19,
      // writeFailed=0. The names are nominal; the SHAPE is the point, and the
      // number the user must see is 13, not 19.
      const blocked = Array.from(
        { length: 13 },
        (_, i) => `.claude/skills/legacy-${i}`,
      );
      const unwanted = Array.from(
        { length: 6 },
        (_, i) => `.claude/skills/not-desired-${i}`,
      );

      await open(
        makeHealth({
          targets: [
            makeTarget('claude', {
              expected: 27,
              found: 14,
              missing: blocked,
              foreign: [...blocked, ...unwanted],
              writeFailed: [],
            }),
          ],
        }),
      );

      expect(text('harness-blocked-heading')).toBe('13 blocked paths');
      expect(testId('harness-blocked')?.querySelectorAll('code')).toHaveLength(
        13,
      );
      for (const path of unwanted) {
        expect(text('harness-blocked')).not.toContain(path);
      }
    });

    it('leaves the existing summary and per-target counts untouched', async () => {
      // Additive: the disclosure explains the number, it does not change it.
      const blocked = Array.from(
        { length: 13 },
        (_, i) => `.claude/skills/legacy-${i}`,
      );

      await open(
        makeHealth({
          targets: [
            makeTarget('claude', {
              expected: 27,
              found: 14,
              missing: blocked,
              foreign: blocked,
            }),
          ],
        }),
      );

      const badgeEl = host.querySelector<HTMLElement>(
        '[data-testid="harness-health-badge"]',
      );

      expect(badgeEl?.textContent).toContain('13 missing across 1 target');
      expect(badgeEl?.className).toContain('text-warning');
      expect(testId('harness-target-missing')?.textContent).toContain(
        '13 missing',
      );
      expect(testId('harness-target-write-failed')).toBeNull();
    });
  });
});
