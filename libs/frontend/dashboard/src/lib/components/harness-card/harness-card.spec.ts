/**
 * Dashboard harness card — the promotion of the blocked-paths disclosure to a
 * boot-visible surface.
 *
 * The disclosure itself is already pinned by
 * `libs/frontend/marketplace/src/lib/harness/harness-blocked-paths.spec.ts`.
 * These specs exist for the three things that are new here and that a
 * well-meaning tidy-up would break:
 *
 *   - **It is on the home.** The whole point of this batch is reachability, so
 *     the first two cases mount the REAL `DashboardGridComponent` and would go
 *     red if `<ptah-harness-card />` were dropped from its template or its
 *     `imports`. A card-only test cannot see that and would pass on an
 *     unreachable card, which is the state this batch was raised to fix.
 *   - **It agrees with the popover.** Both surfaces render one report, so both
 *     must print one number. The agreement case mounts the real Marketplace
 *     badge alongside the card against a single shared store and compares the
 *     two headings rather than each against a literal.
 *   - **It derives nothing.** `blockedTargetPaths` in `@ptah-extension/shared`
 *     is the only place `missing ∩ foreign` is computed. A `foreign`
 *     passthrough here would name paths Ptah never wanted, and it would
 *     compile — so it is caught behaviourally, on the rendered set.
 */

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component } from '@angular/core';
import {
  AppStateManager,
  ClaudeRpcService,
  WebviewNavigationService,
} from '@ptah-extension/core';
import { HarnessHealthStore } from '@ptah-extension/marketplace/services';
import { HarnessHealthBadgeComponent } from '@ptah-extension/marketplace';
import {
  MESSAGE_TYPES,
  summarizeHarnessHealth,
  type HarnessHealth,
  type HarnessTargetHealth,
  type HarnessTargetId,
} from '@ptah-extension/shared';
import { AnalyticsCardComponent } from '../analytics-card/analytics-card.component';
import { BuildersCardComponent } from '../builders-card/builders-card.component';
import { DashboardGridComponent } from '../dashboard-grid/dashboard-grid.component';
import { HarnessCardComponent } from './harness-card.component';

/** Inert stand-ins for the grid's two unrelated cards, which both load session RPC on init. */
@Component({
  selector: 'ptah-analytics-card',
  standalone: true,
  template: '',
})
class StubAnalyticsCardComponent {}

@Component({
  selector: 'ptah-builders-card',
  standalone: true,
  template: '',
})
class StubBuildersCardComponent {}

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
    generatedAt: '2026-08-23T10:00:00.000Z',
    mode: 'full',
    reason: 'activation',
    sources: 'ok',
    targets: [makeTarget('claude')],
    collisions: [],
    ...over,
  };
}

/** A report with `n` desired-and-occupied paths on `claude`, plus `extra` merely-foreign ones. */
function blockedHealth(n: number, extra = 0): HarnessHealth {
  const blocked = Array.from(
    { length: n },
    (_, i) => `.claude/skills/legacy-${i}`,
  );
  const unwanted = Array.from(
    { length: extra },
    (_, i) => `.claude/skills/not-desired-${i}`,
  );
  return makeHealth({
    targets: [
      makeTarget('claude', {
        expected: 27,
        found: 27 - n,
        missing: blocked,
        foreign: [...blocked, ...unwanted],
        writeFailed: [],
      }),
    ],
  });
}

describe('dashboard harness card', () => {
  const rpcMock = { call: jest.fn() };
  const appStateMock = { setCurrentView: jest.fn() };
  const navigationMock = { navigateToView: jest.fn().mockResolvedValue(true) };

  let store: HarnessHealthStore;

  /** Rendered text with whitespace runs collapsed — line wrapping is prettier's business. */
  const textOf = (element: Element | null | undefined): string =>
    (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

  /**
   * Deliver a report the way the backend actually does at boot: the
   * edge-triggered `harness:healthChanged` push into the store the whole
   * webview shares. No RPC involved, which is what lets the "no pull needed"
   * case assert on `rpcMock.call` not having fired.
   */
  const push = (health: HarnessHealth | null): void => {
    store.handleMessage({
      type: MESSAGE_TYPES.HARNESS_HEALTH_CHANGED,
      payload: { health, summary: summarizeHarnessHealth(health) },
    });
  };

  const settle = async (fixture: ComponentFixture<unknown>): Promise<void> => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  /** Mount the card alone. */
  const mountCard = async (): Promise<HTMLElement> => {
    const fixture = TestBed.createComponent(HarnessCardComponent);
    await settle(fixture);
    return fixture.nativeElement as HTMLElement;
  };

  /** Mount the real home. The two unrelated cards are stubbed in `beforeEach`. */
  const mountHome = async (): Promise<HTMLElement> => {
    const fixture = TestBed.createComponent(DashboardGridComponent);
    await settle(fixture);
    return fixture.nativeElement as HTMLElement;
  };

  /** Mount the Marketplace badge and open its popover, so its disclosure renders. */
  const mountPopover = async (): Promise<HTMLElement> => {
    const fixture = TestBed.createComponent(HarnessHealthBadgeComponent);
    const host = fixture.nativeElement as HTMLElement;
    await settle(fixture);
    host
      .querySelector<HTMLButtonElement>('[data-testid="harness-health-badge"]')
      ?.click();
    await settle(fixture);
    return host;
  };

  beforeEach(() => {
    rpcMock.call.mockReset();
    rpcMock.call.mockResolvedValue(ok(undefined));
    TestBed.configureTestingModule({
      providers: [
        { provide: ClaudeRpcService, useValue: rpcMock },
        { provide: AppStateManager, useValue: appStateMock },
        { provide: WebviewNavigationService, useValue: navigationMock },
      ],
    });
    // Before the first `inject`, which instantiates the module and locks
    // overrides out. The harness card is left REAL — it is what is under test;
    // the other two grid cards each load session RPC on init and have nothing
    // to do with this batch.
    TestBed.overrideComponent(DashboardGridComponent, {
      remove: { imports: [AnalyticsCardComponent, BuildersCardComponent] },
      add: { imports: [StubAnalyticsCardComponent, StubBuildersCardComponent] },
    });
    store = TestBed.inject(HarnessHealthStore);
  });

  afterEach(() => TestBed.resetTestingModule());

  describe('on the home', () => {
    it('renders the blocked-paths disclosure on the Dashboard home', async () => {
      // The batch IS this assertion. Before it, the disclosure existed only
      // inside the Marketplace Plugins popover, one click deep on a page a
      // user may never open.
      push(blockedHealth(13, 6));

      const home = await mountHome();

      expect(home.querySelector('[data-testid="harness-card"]')).not.toBeNull();
      expect(
        textOf(home.querySelector('[data-testid="harness-blocked-heading"]')),
      ).toBe('13 blocked paths');
      expect(
        textOf(home.querySelector('[data-testid="harness-blocked"]')),
      ).toContain('.claude/skills/legacy-0');
    });

    it('adds no card to the home when nothing is blocked', async () => {
      // The home must not grow a permanent empty card explaining a condition
      // that is not happening.
      push(makeHealth());

      const home = await mountHome();

      expect(home.querySelector('[data-testid="harness-card"]')).toBeNull();
      expect(home.querySelector('[data-testid="harness-blocked"]')).toBeNull();
      expect(
        home.querySelector('[data-testid="dashboard-grid"]'),
      ).not.toBeNull();
    });
  });

  describe('which paths it names', () => {
    it('names the desired paths an unowned file occupies, and only those', async () => {
      // `gone` is desired and simply absent — a gap, not a refusal. `theirs`
      // exists but was never wanted — foreign, not blocked. Only the overlap
      // is a block, and a `foreign` passthrough would print all three.
      push(
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

      const card = await mountCard();
      const rendered = textOf(
        card.querySelector('[data-testid="harness-blocked"]'),
      );

      expect(rendered).toContain('.claude/skills/orchestration');
      expect(rendered).not.toContain('.claude/skills/gone');
      expect(rendered).not.toContain('.claude/skills/theirs');
      expect(
        textOf(card.querySelector('[data-testid="harness-blocked-heading"]')),
      ).toBe('1 blocked path');
    });

    it('stays hidden when the gaps and the foreign files are disjoint', async () => {
      // Both lists non-empty is exactly what a `missing.length &&
      // foreign.length` shortcut gets wrong.
      push(
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

      const card = await mountCard();

      expect(card.querySelector('[data-testid="harness-card"]')).toBeNull();
    });

    it('ignores an uninstalled target, so it never claims a bigger shortfall than the badge', async () => {
      // `summarizeHarnessHealth` drops undetected targets from every count, so
      // a card reading "1 blocked path" while the badge reads "Harness in
      // sync" would be incoherent. An uninstalled Cursor is not a gap.
      push(
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

      const card = await mountCard();

      expect(card.querySelector('[data-testid="harness-card"]')).toBeNull();
    });
  });

  describe('agreement with the Marketplace popover', () => {
    it('prints the same count as the popover for one report', async () => {
      // `coldstart-306.log:844` — claude=14/27, missing=13, foreign=19,
      // writeFailed=0. Names are nominal; the shape is the point. Compared
      // against each OTHER rather than against a literal, because the property
      // being pinned is that the two surfaces cannot disagree — which is the
      // whole reason the intersection has exactly one definition.
      push(blockedHealth(13, 6));

      const popover = await mountPopover();
      const card = await mountCard();

      const popoverHeading = textOf(
        popover.querySelector('[data-testid="harness-blocked-heading"]'),
      );
      const cardHeading = textOf(
        card.querySelector('[data-testid="harness-blocked-heading"]'),
      );

      expect(cardHeading).toBe(popoverHeading);
      expect(cardHeading).toBe('13 blocked paths');
      expect(
        card.querySelectorAll('[data-testid="harness-blocked"] code'),
      ).toHaveLength(13);
      expect(
        card.querySelectorAll('[data-testid="harness-blocked"] code'),
      ).toHaveLength(
        popover.querySelectorAll('[data-testid="harness-blocked"] code').length,
      );
    });
  });

  describe('what it says', () => {
    it("leads with move, warns the occupant may be the user's own work, and never says delete", async () => {
      // Provenance is UNKNOWN. Move is the reversible half, and the card must
      // not imply Ptah is owed the space.
      push(blockedHealth(2));

      const card = await mountCard();
      const action = textOf(
        card.querySelector('[data-testid="harness-blocked-action"]'),
      );

      expect(action).toMatch(/^Move the occupant aside/);
      expect(action).toContain('may be your own work');
      expect(action).toContain('read it before you discard anything');
      expect(action.toLowerCase()).not.toContain('delete');
      expect(
        textOf(
          card.querySelector('[data-testid="harness-card"]'),
        ).toLowerCase(),
      ).not.toContain('delete');
    });

    it('names where Reconcile lives, since this surface has no such button', async () => {
      // The popover's wording ("then run Reconcile now") points at a button
      // eight pixels below it. Reused verbatim here it would name a control
      // that does not exist on this surface.
      push(blockedHealth(2));

      const card = await mountCard();
      const action = textOf(
        card.querySelector('[data-testid="harness-blocked-action"]'),
      );

      expect(action).toContain('then reconcile from Marketplace → Plugins.');
      expect(action).not.toContain('Reconcile now');
    });

    it('discloses only — it offers no repair, consent or quarantine control', async () => {
      // Consent-gated repair is separate work. A one-click fix for a file
      // whose provenance is unknown makes the exact claim this card is
      // careful not to make, so the assertion covers the WHOLE card and not
      // just the disclosure block inside it.
      push(blockedHealth(3));

      const card = await mountCard();
      const section = card.querySelector('[data-testid="harness-card"]');

      expect(section?.querySelectorAll('button')).toHaveLength(0);
      expect(section?.querySelectorAll('input')).toHaveLength(0);
      expect(section?.querySelectorAll('a')).toHaveLength(0);
      expect(section?.getAttribute('aria-label')).toBe('Harness blocked paths');
    });
  });

  describe('how it gets the report', () => {
    it('renders from the boot push without asking for the report', async () => {
      // `harness:healthChanged` is an existing edge-triggered push and the
      // store is in `MESSAGE_HANDLERS` at bootstrap, so the report is already
      // in hand. No polling, no new RPC, no contract change.
      push(blockedHealth(4));

      const card = await mountCard();

      expect(rpcMock.call).not.toHaveBeenCalled();
      expect(
        textOf(card.querySelector('[data-testid="harness-blocked-heading"]')),
      ).toBe('4 blocked paths');
    });

    it('pulls once over the existing harness:health when no push has arrived', async () => {
      // Nothing changed at activation means nothing was broadcast, and a card
      // that only ever listened would stay blank forever on a workspace that
      // has been blocked since before this window opened.
      const health = blockedHealth(5);
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

      const card = await mountCard();

      expect(rpcMock.call).toHaveBeenCalledWith(
        'harness:health',
        {},
        expect.anything(),
      );
      expect(
        textOf(card.querySelector('[data-testid="harness-blocked-heading"]')),
      ).toBe('5 blocked paths');
    });
  });
});
