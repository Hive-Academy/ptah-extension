/**
 * The consent dialog — where the claim of ownership over a blocked path is
 * actually made.
 *
 * WHAT THESE SPECS ARE PROTECTING. `harness:repairBlocked` re-derives the
 * blocked set server-side and refuses everything outside it, moves rather than
 * overwrites, and never cleans the quarantine up. All of that is worth exactly
 * as much as this dialog's honesty: the backend cannot tell a path the user
 * deliberately ticked from a path the UI ticked for them. So the assertions
 * below are not about rendering, they are about what leaves the component —
 * whether a request is sent at all, and which paths are in it.
 *
 * The four that would each, alone, undo the batch:
 *
 *   - a checkbox that arrives ticked (decision U3 in one property);
 *   - a confirm that fires an RPC with an empty selection, which is a consent
 *     call made when consent was withheld and is indistinguishable on the wire
 *     from one where it was given;
 *   - a request carrying a path the user did not tick;
 *   - a request carrying a path that is not in the blocked set at all, which
 *     would turn a narrow repair into a general-purpose "move this directory".
 *
 * The wording cases are held to the same bar as Batches 7 and 11 and asserted
 * over the WHOLE dialog rather than one paragraph, because a reassuring
 * sentence next to a destructive verb somewhere else is not a reassurance.
 */

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ClaudeRpcService } from '@ptah-extension/core';
import {
  MESSAGE_TYPES,
  summarizeHarnessHealth,
  harnessBlockedWordingViolations,
  HARNESS_BLOCKED_APPROVED_ACTIONS,
  HARNESS_REPAIR_REASONS,
  type HarnessHealth,
  type HarnessRepairBlockedParams,
  type HarnessRepairBlockedResult,
  type HarnessRepairPathResult,
  type HarnessTargetHealth,
  type HarnessTargetId,
} from '@ptah-extension/shared';
import { harnessBlockedPaths } from './harness-health.model';
import { HarnessHealthStore } from './harness-health.store';
import { HarnessRepairDialogComponent } from './harness-repair-dialog.component';

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

function makeHealth(targets: HarnessTargetHealth[]): HarnessHealth {
  return {
    workspaceRoot: 'D:/repo',
    generatedAt: '2026-08-23T10:00:00.000Z',
    mode: 'full',
    reason: 'activation',
    sources: 'ok',
    targets,
    collisions: [],
  };
}

/**
 * A target whose `blocked` set is `paths`, plus `alsoMissing` (a gap nobody
 * occupies) and `alsoForeign` (an occupant nobody wanted). Those two exist so
 * the "cannot send an unblocked path" case has real near-misses to try, rather
 * than an invented string no reasonable bug would produce.
 */
function blockedTarget(
  target: HarnessTargetId,
  paths: string[],
  alsoMissing: string[] = [],
  alsoForeign: string[] = [],
): HarnessTargetHealth {
  return makeTarget(target, {
    expected: 27,
    found: 27 - paths.length,
    missing: [...paths, ...alsoMissing],
    foreign: [...paths, ...alsoForeign],
  });
}

function pathResult(
  relPath: string,
  over: Partial<HarnessRepairPathResult> = {},
): HarnessRepairPathResult {
  return { target: 'claude', relPath, outcome: 'repaired', ...over };
}

function repairResult(
  paths: HarnessRepairPathResult[],
  health: HarnessHealth | null = null,
): HarnessRepairBlockedResult {
  return {
    paths,
    repaired: paths.filter((p) => p.outcome === 'repaired').length,
    health,
    summary: summarizeHarnessHealth(health),
  };
}

describe('harness repair consent dialog', () => {
  const rpcMock = { call: jest.fn() };
  let store: HarnessHealthStore;
  let fixture: ComponentFixture<HarnessRepairDialogComponent>;
  let host: HTMLElement;

  const textOf = (element: Element | null | undefined): string =>
    (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

  const settle = async (): Promise<void> => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  /** Deliver a report through the real push path the whole webview shares. */
  const push = (health: HarnessHealth): void => {
    store.handleMessage({
      type: MESSAGE_TYPES.HARNESS_HEALTH_CHANGED,
      payload: { health, summary: summarizeHarnessHealth(health) },
    });
  };

  /**
   * Mount the dialog against a report, exactly as the Dashboard card does:
   * `[blocked]` is `harnessBlockedPaths(store.health())`, the ONE derivation.
   * Passing a hand-built disclosure here would let a spec offer the dialog a
   * path the shared function would never produce.
   */
  const open = async (health: HarnessHealth): Promise<void> => {
    push(health);
    fixture = TestBed.createComponent(HarnessRepairDialogComponent);
    fixture.componentRef.setInput('blocked', harnessBlockedPaths(health));
    host = fixture.nativeElement as HTMLElement;
    await settle();
  };

  const checkboxes = (): HTMLInputElement[] =>
    Array.from(
      host.querySelectorAll<HTMLInputElement>(
        '[data-testid="harness-repair-checkbox"]',
      ),
    );

  const checkboxFor = (key: string): HTMLInputElement => {
    const found = checkboxes().find((box) => box.dataset['path'] === key);
    if (!found) throw new Error(`no checkbox rendered for ${key}`);
    return found;
  };

  const tick = async (key: string): Promise<void> => {
    checkboxFor(key).dispatchEvent(new Event('change'));
    await settle();
  };

  const click = async (testId: string): Promise<void> => {
    host.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)?.click();
    await settle();
  };

  const confirmButton = (): HTMLButtonElement | null =>
    host.querySelector<HTMLButtonElement>(
      '[data-testid="harness-repair-confirm"]',
    );

  /** Every `harness:repairBlocked` call the dialog made, params only. */
  const repairCalls = (): HarnessRepairBlockedParams[] =>
    rpcMock.call.mock.calls
      .filter((call: unknown[]) => call[0] === 'harness:repairBlocked')
      .map((call: unknown[]) => call[1] as HarnessRepairBlockedParams);

  beforeEach(() => {
    rpcMock.call.mockReset();
    rpcMock.call.mockResolvedValue(ok(repairResult([])));
    TestBed.configureTestingModule({
      providers: [{ provide: ClaudeRpcService, useValue: rpcMock }],
    });
    store = TestBed.inject(HarnessHealthStore);
  });

  afterEach(() => TestBed.resetTestingModule());

  describe('what the dialog arrives in', () => {
    it('ticks nothing on open', async () => {
      // Decision U3, as one property. The dialog authorises moving directories
      // whose provenance nobody can establish; arriving with the claim already
      // made on the user's behalf is the failure the whole consent design
      // exists to prevent.
      await open(
        makeHealth([
          blockedTarget('claude', [
            '.claude/skills/a',
            '.claude/skills/b',
            '.claude/skills/c',
          ]),
        ]),
      );

      expect(checkboxes()).toHaveLength(3);
      expect(checkboxes().every((box) => box.checked)).toBe(false);
      expect(checkboxes().some((box) => box.checked)).toBe(false);
      expect(
        textOf(host.querySelector('[data-testid="harness-repair-count"]')),
      ).toBe('0 of 3 selected');
    });

    it('opens with the default action disabled, so doing nothing is the default', async () => {
      await open(makeHealth([blockedTarget('claude', ['.claude/skills/a'])]));

      expect(confirmButton()?.disabled).toBe(true);
    });

    it('ticks nothing on a re-open after a partial repair', async () => {
      // The host mounts this behind an `@if`, so a re-open is a new instance
      // and there is no selection to carry over. Asserted rather than assumed:
      // a later refactor to a persistent instance with an `open` input would
      // silently reintroduce carry-over, and this is the case that catches it.
      const before = makeHealth([
        blockedTarget('claude', ['.claude/skills/a', '.claude/skills/b']),
      ]);
      await open(before);
      await tick('claude::.claude/skills/a');
      expect(checkboxFor('claude::.claude/skills/a').checked).toBe(true);
      fixture.destroy();

      // One of the two repaired; the other is still blocked.
      await open(makeHealth([blockedTarget('claude', ['.claude/skills/b'])]));

      expect(checkboxes()).toHaveLength(1);
      expect(checkboxes().every((box) => box.checked)).toBe(false);
    });

    it('offers select-all as a press, never as a starting state', async () => {
      // The objection U3 records was never to selecting thirteen paths at
      // once; it was to a dialog that arrives having selected them. So the
      // affordance is allowed, and what is pinned is that it starts at "Select
      // all" and only a click moves it.
      await open(
        makeHealth([
          blockedTarget('claude', ['.claude/skills/a', '.claude/skills/b']),
        ]),
      );

      const label = (): string =>
        textOf(host.querySelector('[data-testid="harness-repair-select-all"]'));
      expect(label()).toBe('Select all');
      expect(checkboxes().some((box) => box.checked)).toBe(false);

      await click('harness-repair-select-all');

      expect(checkboxes().every((box) => box.checked)).toBe(true);
      expect(label()).toBe('Clear selection');

      await click('harness-repair-select-all');

      expect(checkboxes().some((box) => box.checked)).toBe(false);
    });
  });

  describe('what leaves the dialog', () => {
    it('sends no request when confirm is reached with nothing ticked', async () => {
      // The button is disabled, so this drives `confirm()` directly — the
      // disabled attribute is a rendering and this asserts the DECISION. A
      // consent RPC fired with an empty list is indistinguishable on the wire
      // from one fired with consent, which is why an empty list must produce
      // no call rather than a call the handler ignores.
      await open(
        makeHealth([
          blockedTarget('claude', ['.claude/skills/a', '.claude/skills/b']),
        ]),
      );

      await (
        fixture.componentInstance as unknown as {
          confirm: () => Promise<void>;
        }
      ).confirm();
      await settle();

      expect(repairCalls()).toHaveLength(0);
      expect(rpcMock.call).not.toHaveBeenCalled();
    });

    it('sends no request when the user cancels a selection they made', async () => {
      // Declining after ticking is the case that matters — declining without
      // ticking anything would pass even on a dialog that only ever sends its
      // selection.
      await open(
        makeHealth([
          blockedTarget('claude', ['.claude/skills/a', '.claude/skills/b']),
        ]),
      );
      await tick('claude::.claude/skills/a');
      await tick('claude::.claude/skills/b');

      await click('harness-repair-cancel');

      expect(rpcMock.call).not.toHaveBeenCalled();
    });

    it('carries exactly the ticked paths and no others', async () => {
      // Five blocked, two ticked. The negative half is the point: a dialog
      // that sends its whole candidate list passes any assertion that only
      // checks the two are present.
      await open(
        makeHealth([
          blockedTarget('claude', [
            '.claude/skills/alpha',
            '.claude/skills/beta',
            '.claude/skills/gamma',
            '.claude/skills/delta',
            '.claude/skills/epsilon',
          ]),
        ]),
      );

      await tick('claude::.claude/skills/beta');
      await tick('claude::.claude/skills/delta');
      await click('harness-repair-confirm');

      expect(repairCalls()).toHaveLength(1);
      expect(repairCalls()[0].paths).toEqual([
        { target: 'claude', relPath: '.claude/skills/beta' },
        { target: 'claude', relPath: '.claude/skills/delta' },
      ]);
    });

    it('drops a path the user unticked before confirming', async () => {
      await open(
        makeHealth([
          blockedTarget('claude', ['.claude/skills/a', '.claude/skills/b']),
        ]),
      );

      await tick('claude::.claude/skills/a');
      await tick('claude::.claude/skills/b');
      await tick('claude::.claude/skills/a');
      await click('harness-repair-confirm');

      expect(repairCalls()[0].paths).toEqual([
        { target: 'claude', relPath: '.claude/skills/b' },
      ]);
    });

    it('keeps two targets blocking the same relative path apart', async () => {
      // `.mcp.json` is blocked on both `claude` and `cursor`. A selection keyed
      // on `relPath` alone would tick and send both from one click, consenting
      // to a file in a tool the user never looked at.
      await open(
        makeHealth([
          blockedTarget('claude', ['.mcp.json']),
          blockedTarget('cursor', ['.mcp.json']),
        ]),
      );

      expect(checkboxes()).toHaveLength(2);
      await tick('cursor::.mcp.json');
      await click('harness-repair-confirm');

      expect(repairCalls()[0].paths).toEqual([
        { target: 'cursor', relPath: '.mcp.json' },
      ]);
    });

    it('cannot be made to send a path outside the blocked set', async () => {
      // The three near-misses a real bug would produce: a gap nobody occupies
      // (`missing` only), an occupant nobody wanted (`foreign` only), and a
      // path on an undetected target. None of them is a block, none of them
      // renders a row, and — because the request is built by filtering the
      // RENDERED candidates rather than by reading a selection set directly —
      // none of them is constructible even by ticking everything.
      await open(
        makeHealth([
          blockedTarget(
            'claude',
            ['.claude/skills/blocked'],
            ['.claude/skills/just-missing'],
            ['.claude/skills/just-foreign'],
          ),
          makeTarget('cursor', {
            detected: false,
            expected: 0,
            found: 0,
            missing: ['.cursor/rules/ghost'],
            foreign: ['.cursor/rules/ghost'],
          }),
        ]),
      );

      await click('harness-repair-select-all');
      await click('harness-repair-confirm');

      expect(repairCalls()[0].paths).toEqual([
        { target: 'claude', relPath: '.claude/skills/blocked' },
      ]);
      const rendered = textOf(host);
      expect(rendered).not.toContain('.claude/skills/just-missing');
      expect(rendered).not.toContain('.claude/skills/just-foreign');
      expect(rendered).not.toContain('.cursor/rules/ghost');
    });

    it('will not send a ticked path that stopped being blocked before confirm', async () => {
      // Another window reconciled, or the boot push landed late. The tick is
      // stale; the request must be current. `selected` is derived by filtering
      // the LIVE candidate list, so the stale key has nowhere to come from.
      await open(
        makeHealth([
          blockedTarget('claude', ['.claude/skills/a', '.claude/skills/b']),
        ]),
      );
      await tick('claude::.claude/skills/a');
      await tick('claude::.claude/skills/b');

      fixture.componentRef.setInput(
        'blocked',
        harnessBlockedPaths(
          makeHealth([blockedTarget('claude', ['.claude/skills/b'])]),
        ),
      );
      await settle();
      await click('harness-repair-confirm');

      expect(repairCalls()[0].paths).toEqual([
        { target: 'claude', relPath: '.claude/skills/b' },
      ]);
    });

    it('makes one call when confirm is pressed twice while the first is in flight', async () => {
      // The store's in-flight guard plus the disabled button. A double-send
      // would quarantine the same occupant twice and leave a stray copy that
      // nothing ever cleans up. The call is held open on purpose — pressing
      // twice after it resolved would be a no-op for an unrelated reason (the
      // dialog has moved to its outcomes view) and would prove nothing.
      let release: (value: unknown) => void = () => undefined;
      rpcMock.call.mockReturnValue(
        new Promise((resolve) => {
          release = resolve;
        }),
      );
      await open(
        makeHealth([blockedTarget('claude', ['.claude/skills/alpha'])]),
      );
      await tick('claude::.claude/skills/alpha');

      confirmButton()?.click();
      await settle();
      expect(confirmButton()?.disabled).toBe(true);
      confirmButton()?.click();
      await settle();

      expect(repairCalls()).toHaveLength(1);

      release(ok(repairResult([pathResult('.claude/skills/alpha')])));
      await settle();
      expect(
        host.querySelector('[data-testid="harness-repair-results"]'),
      ).not.toBeNull();
    });
  });

  describe('what it says', () => {
    it('says exactly this: move-first, may be your own work, no ownership claimed', async () => {
      // POSITIVE, not a denylist. Batch 12's review established why: a verb
      // denylist is not a semantic check — "purge", "wipe", "drop", "unlink"
      // and "nuke" all pass one — and the two false-positive traps in the
      // repo's existing list (`\brm\b` matching `rm-helper`, `\btrash\b`
      // matching `trash-cleaner`) show it is not even reliable in the
      // direction it does cover. So the sentence the user reads before
      // authorising a move over content of unknown provenance is pinned
      // WHOLE and EXACT. Any rewrite lands here, and the reviewer of that
      // rewrite reads the intended wording rather than a list of what is
      // forbidden.
      //
      // Against the SHARED allowlist rather than a literal copied into this
      // file (TASK_2026_309). The dialog is one of five surfaces saying how a
      // blocked path gets cleared, and five private copies of the sentence is
      // how the wording drifted apart in the first place — three of the five
      // were still on a bare `not.toContain('delete')` check when this was
      // written.
      //
      // Four properties are baked into that literal, and each is why a clause
      // is where it is: it opens on MOVE; it names the destination and the
      // fact that the destination is permanent; it claims no ownership; and it
      // closes by handing the judgement back to the user.
      await open(
        makeHealth([
          blockedTarget('claude', ['.claude/skills/a', '.claude/skills/b']),
        ]),
      );

      expect(
        textOf(host.querySelector('[data-testid="harness-repair-action"]')),
      ).toBe(HARNESS_BLOCKED_APPROVED_ACTIONS['repair-dialog']);
    });

    it('says nothing unapproved anywhere else in the dialog either', async () => {
      // The exact-text case above pins ONE paragraph. This is the second net,
      // and its value is entirely in its SCOPE: a careful sentence next to a
      // button reading "Delete and install", or an outcome line reading "your
      // directory was removed", is not a careful dialog. Held over the whole
      // rendered surface, in both phases, because the outcomes view is text
      // the user reads AFTER trusting the first one.
      //
      // This used to be eight regexes, with a comment admitting it was "NOT a
      // completeness claim" — "purge", "wipe", "drop", "unlink" and "nuke" all
      // passed it. It is now the same allowlist the action clause is held to,
      // widened to the whole surface: every fixed sentence the dialog may
      // render is on the list in
      // `libs/shared/src/lib/types/harness-blocked-wording.ts`, and anything
      // else that reads as prose fails. That converts "we banned the verbs we
      // thought of" into "we approved the sentences we meant", which is the
      // only form of this check that can be complete.
      rpcMock.call.mockResolvedValue(
        ok(
          repairResult([
            pathResult('.claude/skills/a', { outcome: 'repaired' }),
            pathResult('.claude/skills/b', {
              outcome: 'move-failed',
              reason: 'the directory is open in another program',
            }),
          ]),
        ),
      );
      await open(
        makeHealth([
          blockedTarget('claude', ['.claude/skills/a', '.claude/skills/b']),
        ]),
      );

      const action = textOf(
        host.querySelector('[data-testid="harness-repair-action"]'),
      );
      const choosePhase = textOf(
        host.querySelector('[data-testid="harness-repair"]'),
      );
      await click('harness-repair-select-all');
      await click('harness-repair-confirm');
      const reportPhase = textOf(
        host.querySelector('[data-testid="harness-repair"]'),
      );

      // Paths, target labels and the failure reason this test injected are
      // DATA, not wording — a user's filename and a backend error string are
      // not sentences anybody has to approve. Declaring them here is what
      // keeps that distinction visible in the test that made it.
      const data = [
        '.claude/skills/a',
        '.claude/skills/b',
        'Claude Code',
        'the directory is open in another program',
      ];

      for (const phase of [choosePhase, reportPhase]) {
        expect(
          harnessBlockedWordingViolations({
            surface: 'repair-dialog',
            action,
            wholeText: phase,
            data,
          }),
        ).toEqual([]);
      }
      expect(reportPhase.toLowerCase()).toContain('moved aside');
    });

    it('guards the per-path `reason` — the sixth surface, rendered from the REAL literals', async () => {
      // `HarnessRepairPathResult.reason` is Ptah-authored prose, not user data.
      // `HarnessBlockedRepairService` writes it (`blocked-repair.service.ts`
      // :230, :318, :334, :399, :406) and this dialog renders it
      // unconditionally at `harness-repair-dialog.component.ts:276-280`.
      //
      // It was invisible to the first version of this guard: the only `reason`
      // any spec exercised was an invented fixture, always declared as `data`,
      // and `data` is struck before the residue is judged. A destructive
      // rewrite of any real literal shipped green. So this case renders the
      // ACTUAL constants — every outcome that carries one — and declares NONE
      // of them as data. They pass only because they are on the allowlist.
      //
      // The backend half of the pin is in
      // `harness-sync/.../blocked-repair.service.spec.ts`, which asserts the
      // service emits exactly these. Neither half is sufficient alone: this one
      // proves the allowlist renders cleanly, that one proves production says
      // what the allowlist says.
      const quarantined =
        '.claude/skills/.ptah-quarantine/c-20260823T141530123';
      rpcMock.call.mockResolvedValue(
        ok(
          repairResult([
            pathResult('.claude/skills/a', {
              outcome: 'move-failed',
              // A template: the head is approved wording, the tail is the OS.
              reason: `${HARNESS_REPAIR_REASONS.moveFailed} EBUSY: resource busy or locked`,
            }),
            pathResult('.claude/skills/b', {
              outcome: 'restored',
              reason: HARNESS_REPAIR_REASONS.restored,
            }),
            pathResult('.claude/skills/c', {
              outcome: 'restore-failed',
              quarantinePath: quarantined,
              reason: `${HARNESS_REPAIR_REASONS.restoreFailed} ${quarantined} (EPERM: operation not permitted)`,
            }),
            pathResult('.vscode/mcp.json#wanted', {
              outcome: 'not-a-path',
              reason: HARNESS_REPAIR_REASONS.notAPath,
            }),
            pathResult('.claude/skills/d', {
              outcome: 'not-blocked',
              reason: HARNESS_REPAIR_REASONS.notBlocked,
            }),
          ]),
        ),
      );
      await open(
        makeHealth([
          blockedTarget('claude', ['.claude/skills/a', '.claude/skills/b']),
        ]),
      );
      await click('harness-repair-select-all');
      await click('harness-repair-confirm');

      const reportPhase = textOf(
        host.querySelector('[data-testid="harness-repair"]'),
      );

      // Every reason really did reach the DOM — otherwise this case would pass
      // by rendering nothing.
      for (const reason of Object.values(HARNESS_REPAIR_REASONS)) {
        expect(reportPhase).toContain(reason);
      }

      expect(
        harnessBlockedWordingViolations({
          surface: 'repair-dialog',
          action: textOf(
            host.querySelector('[data-testid="harness-repair-action"]'),
          ),
          wholeText: reportPhase,
          // Paths, labels and the two OS error strings only. Not one reason.
          data: [
            '.claude/skills/a',
            '.claude/skills/b',
            '.claude/skills/c',
            '.claude/skills/d',
            '.vscode/mcp.json#wanted',
            'Claude Code',
            quarantined,
            'EBUSY: resource busy or locked',
            'EPERM: operation not permitted',
          ],
        }),
      ).toEqual([]);
    });

    it('names the quarantine destination while the user can still decline', async () => {
      // "Where does my directory go" is not an after-the-fact detail. The rule
      // and a worked example are both present BEFORE any request is made, and
      // the confirm button is still sitting there unpressed.
      await open(
        makeHealth([blockedTarget('claude', ['.claude/skills/orchestration'])]),
      );

      const action = textOf(
        host.querySelector('[data-testid="harness-repair-action"]'),
      );
      expect(action).toContain('.ptah-quarantine');
      expect(action).toContain(
        '.claude/skills/.ptah-quarantine/orchestration-20260823T141530123',
      );
      expect(confirmButton()).not.toBeNull();
      expect(rpcMock.call).not.toHaveBeenCalled();
    });

    it('says the quarantine is never emptied and never expires, and offers no way to empty it', async () => {
      // Decision U4. A button contradicting the documented promise is worse
      // than no button, and the promise itself has to be legible or the
      // reversibility claim is unverifiable by the person relying on it.
      await open(makeHealth([blockedTarget('claude', ['.claude/skills/a'])]));

      const action = textOf(
        host.querySelector('[data-testid="harness-repair-action"]'),
      );
      expect(action).toContain('never empties that folder');
      expect(action).toContain('nothing in it expires');

      const labels = Array.from(host.querySelectorAll('button')).map((button) =>
        textOf(button).toLowerCase(),
      );
      for (const label of labels) {
        expect(label).not.toContain('clean');
        expect(label).not.toContain('empty');
        expect(label).not.toContain('purge');
      }
    });

    it('states that Ptah cannot prove it created these directories', async () => {
      // The reason the default is nothing. Without it the empty checkboxes
      // read as an inconvenience rather than as the honest position.
      await open(makeHealth([blockedTarget('claude', ['.claude/skills/a'])]));

      expect(
        textOf(host.querySelector('[data-testid="harness-repair-provenance"]')),
      ).toContain('cannot prove it created these directories');
    });

    it('never promises to move more than is ticked', async () => {
      await open(
        makeHealth([
          blockedTarget('claude', [
            '.claude/skills/a',
            '.claude/skills/b',
            '.claude/skills/c',
          ]),
        ]),
      );

      expect(textOf(confirmButton())).toBe('Move aside and install');

      await tick('claude::.claude/skills/a');
      expect(textOf(confirmButton())).toBe('Move 1 aside and install');

      await tick('claude::.claude/skills/c');
      expect(textOf(confirmButton())).toBe('Move 2 aside and install');
    });
  });

  describe('what it reports back', () => {
    it('reports every outcome per path, and names the quarantine path on the one that stranded content', async () => {
      // `restore-failed` is the outcome where the user's directory exists in
      // the quarantine AND NOWHERE ELSE. If the dialog swallows one field in
      // this whole batch, it must not be that one.
      rpcMock.call.mockResolvedValue(
        ok(
          repairResult([
            pathResult('.claude/skills/a', { outcome: 'repaired' }),
            pathResult('.claude/skills/b', {
              outcome: 'restore-failed',
              quarantinePath:
                'D:/repo/.claude/skills/.ptah-quarantine/b-20260823T141530123',
              reason: 'the write pass did not produce a copy',
            }),
          ]),
        ),
      );
      await open(
        makeHealth([
          blockedTarget('claude', ['.claude/skills/a', '.claude/skills/b']),
        ]),
      );
      await click('harness-repair-select-all');
      await click('harness-repair-confirm');

      const rows = Array.from(
        host.querySelectorAll('[data-testid="harness-repair-result"]'),
      );
      expect(rows).toHaveLength(2);
      expect(rows[0].getAttribute('data-outcome')).toBe('repaired');
      expect(rows[1].getAttribute('data-outcome')).toBe('restore-failed');
      expect(textOf(rows[1])).toContain(
        'D:/repo/.claude/skills/.ptah-quarantine/b-20260823T141530123',
      );
      expect(textOf(rows[1])).toContain('could not be put back');
    });

    it('explains a refusal in plain language rather than showing a wire token', async () => {
      // A blocked MCP fragment key is refused as `not-a-path`. The dialog does
      // not filter those out client-side — the predicate lives in `harness-sync`
      // and copying it would be a second definition on the far side of the wire
      // — so the refusal has to be legible when it comes back.
      rpcMock.call.mockResolvedValue(
        ok(
          repairResult([
            pathResult('.mcp.json#github', { outcome: 'not-a-path' }),
          ]),
        ),
      );
      await open(makeHealth([blockedTarget('claude', ['.mcp.json#github'])]));
      await tick('claude::.mcp.json#github');
      await click('harness-repair-confirm');

      const row = host.querySelector('[data-testid="harness-repair-result"]');
      expect(textOf(row)).toContain('does not apply');
      expect(textOf(row)).not.toContain('not-a-path');
    });

    it('surfaces a transport failure without claiming anything was moved', async () => {
      rpcMock.call.mockResolvedValue({
        success: false,
        data: undefined,
        error: 'host is not responding',
        isSuccess: (): boolean => false,
      });
      await open(makeHealth([blockedTarget('claude', ['.claude/skills/a'])]));
      await tick('claude::.claude/skills/a');
      await click('harness-repair-confirm');

      expect(
        textOf(host.querySelector('[data-testid="harness-repair-error"]')),
      ).toBe('host is not responding');
      expect(
        host.querySelector('[data-testid="harness-repair-results"]'),
      ).toBeNull();
      expect(checkboxes()).toHaveLength(1);
    });
  });

  describe('the store call itself', () => {
    it('refuses an empty list before it reaches the wire', async () => {
      // The last of the three layers, asserted at the layer that owns it. The
      // dialog's disabled button and its early return both sit above this one,
      // and a future second caller of the store gets the same refusal.
      await expect(store.repairBlocked([])).resolves.toBeNull();
      expect(rpcMock.call).not.toHaveBeenCalled();
    });

    it('leaves the last good report standing when the backend ran no pass', async () => {
      // `health: null` means nothing changed — every fully-refused selection.
      // Adopting it would blank a report the user is reading in order to
      // describe a call that did nothing.
      const health = makeHealth([
        blockedTarget('claude', ['.claude/skills/a']),
      ]);
      push(health);
      rpcMock.call.mockResolvedValue(
        ok(
          repairResult(
            [pathResult('.claude/skills/a', { outcome: 'not-blocked' })],
            null,
          ),
        ),
      );

      await store.repairBlocked([
        { target: 'claude', relPath: '.claude/skills/a' },
      ]);

      expect(store.health()).toBe(health);
      expect(harnessBlockedPaths(store.health()).count).toBe(1);
    });

    it('adopts the post-repair report when the backend did run a pass', async () => {
      push(
        makeHealth([
          blockedTarget('claude', ['.claude/skills/a', '.claude/skills/b']),
        ]),
      );
      const after = makeHealth([blockedTarget('claude', ['.claude/skills/b'])]);
      rpcMock.call.mockResolvedValue(
        ok(repairResult([pathResult('.claude/skills/a')], after)),
      );

      await store.repairBlocked([
        { target: 'claude', relPath: '.claude/skills/a' },
      ]);

      expect(harnessBlockedPaths(store.health()).count).toBe(1);
      expect(store.repairing()).toBe(false);
    });
  });
});
