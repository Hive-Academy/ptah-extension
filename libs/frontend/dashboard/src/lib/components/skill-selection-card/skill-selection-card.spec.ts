/**
 * Dashboard skill-selection card — the "and says so" half of decision U2
 * (TASK_2026_316 Batch 4).
 *
 * These specs pin the properties `skill-selection-card.component.ts`'s own
 * doc comment claims for itself, independently of the agent that wrote it:
 *
 *   - **Visible only for the exact gap.** `'all'` and a non-empty `'selected'`
 *     allowlist are both finished decisions and must render nothing; only
 *     `'selected'` + `[]` is the unanswered question.
 *   - **One card, one control, no repair.** The card's only job is to open
 *     the Configure Ptah Skills picker — same shape as the precedent
 *     `HarnessCardComponent`, which performs no repair itself. Since
 *     TASK_2026_524 the picker is `PluginCatalogPanelComponent`, an inline
 *     panel with no chrome of its own, so this card supplies the dialog,
 *     the close button and the backdrop — all three are pinned below.
 *   - **It claims no fault.** No badge, no error/warning/amber styling — this
 *     is an unanswered question, not a degraded state, and a permanent amber
 *     badge nobody can clear is exactly the failure mode U2 rejected.
 *   - **A transport failure is silent**, not an error banner on the home
 *     screen.
 */

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ClaudeRpcService } from '@ptah-extension/core';
import type { HarnessGetSkillSelectionResult } from '@ptah-extension/shared';
import { SkillSelectionCardComponent } from './skill-selection-card.component';

/**
 * Minimal stand-in for the core `RpcResult` shape: `isSuccess()`, `.data`,
 * `.error`. Mirrors the real class's truthiness rule (success AND data !==
 * undefined) — see `harness-card.spec.ts` / `smithery-surface.component.spec.ts`
 * for the same idiom.
 */
function ok<T>(data: T) {
  return {
    success: true,
    data,
    error: undefined as string | undefined,
    isSuccess: (): boolean => data !== undefined,
  };
}

function selection(
  over: Partial<HarnessGetSkillSelectionResult> = {},
): HarnessGetSkillSelectionResult {
  return {
    mode: 'selected',
    slugs: [],
    available: [],
    derived: false,
    ...over,
  };
}

interface RpcCall {
  method: string;
  params: unknown;
}

describe('dashboard skill-selection card', () => {
  let calls: RpcCall[];
  let responders: Map<string, () => unknown>;

  const setResponder = (method: string, factory: () => unknown): void => {
    responders.set(method, factory);
  };

  const rpcMock = {
    call: jest.fn((method: string, params: unknown) => {
      calls.push({ method, params });
      const factory = responders.get(method);
      if (!factory) {
        return Promise.resolve(ok(undefined));
      }
      return Promise.resolve(factory());
    }),
  };

  const settle = async (fixture: ComponentFixture<unknown>): Promise<void> => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  const mountCard = async (): Promise<
    ComponentFixture<SkillSelectionCardComponent>
  > => {
    const fixture = TestBed.createComponent(SkillSelectionCardComponent);
    await settle(fixture);
    return fixture;
  };

  beforeEach(() => {
    calls = [];
    responders = new Map();
    rpcMock.call.mockClear();
    TestBed.configureTestingModule({
      providers: [{ provide: ClaudeRpcService, useValue: rpcMock }],
    });
  });

  afterEach(() => TestBed.resetTestingModule());

  describe('when it appears', () => {
    it('is absent when the workspace propagates everything', async () => {
      setResponder('harness:get-skill-selection', () =>
        ok(selection({ mode: 'all', slugs: [] })),
      );

      const fixture = await mountCard();
      const host = fixture.nativeElement as HTMLElement;

      expect(
        host.querySelector('[data-testid="skill-selection-card"]'),
      ).toBeNull();
    });

    it('is absent when the workspace has a deliberately short, non-empty allowlist', async () => {
      setResponder('harness:get-skill-selection', () =>
        ok(selection({ mode: 'selected', slugs: ['orchestration'] })),
      );

      const fixture = await mountCard();
      const host = fixture.nativeElement as HTMLElement;

      expect(
        host.querySelector('[data-testid="skill-selection-card"]'),
      ).toBeNull();
    });

    it('appears only for a selected mode with an empty allowlist', async () => {
      setResponder('harness:get-skill-selection', () =>
        ok(selection({ mode: 'selected', slugs: [] })),
      );

      const fixture = await mountCard();
      const host = fixture.nativeElement as HTMLElement;

      expect(
        host.querySelector('[data-testid="skill-selection-card"]'),
      ).not.toBeNull();
    });
  });

  describe('it claims no fault', () => {
    it('carries no badge, no status indicator, and no error/warning/amber styling', async () => {
      setResponder('harness:get-skill-selection', () =>
        ok(selection({ mode: 'selected', slugs: [] })),
      );

      const fixture = await mountCard();
      const host = fixture.nativeElement as HTMLElement;
      const section = host.querySelector(
        '[data-testid="skill-selection-card"]',
      );

      expect(section).not.toBeNull();
      expect(section?.querySelectorAll('[class*="badge"]')).toHaveLength(0);
      expect(
        section?.querySelectorAll(
          '[class*="error"], [class*="warning"], [class*="amber"]',
        ),
      ).toHaveLength(0);
      expect(section?.textContent?.toLowerCase()).not.toContain('degraded');
    });
  });

  describe('one card, one control, no repair', () => {
    it('offers exactly one control and performs no selection itself', async () => {
      setResponder('harness:get-skill-selection', () =>
        ok(
          selection({
            mode: 'selected',
            slugs: [],
            available: [
              { slug: 'a', name: 'A', description: '', pluginId: null },
            ],
          }),
        ),
      );

      const fixture = await mountCard();
      const host = fixture.nativeElement as HTMLElement;
      const before = host.querySelector('[data-testid="skill-selection-card"]');

      expect(before?.querySelectorAll('button')).toHaveLength(1);
      expect(
        before?.querySelector('[data-testid="skill-selection-card-choose"]'),
      ).not.toBeNull();
      expect(before?.querySelectorAll('input')).toHaveLength(0);
      expect(before?.querySelectorAll('a')).toHaveLength(0);

      // Opening the picker is the only thing the button does.
      calls.length = 0;
      before
        ?.querySelector<HTMLButtonElement>(
          '[data-testid="skill-selection-card-choose"]',
        )
        ?.click();
      await settle(fixture);

      // The picker — a SIBLING of the card's section, not a child of it — is
      // where selection happens. It routed there and did nothing else itself.
      expect(
        host.querySelector('[data-testid="skill-selection"]'),
      ).not.toBeNull();

      // The card's own section still owns no selection UI while it is open.
      const after = host.querySelector('[data-testid="skill-selection-card"]');
      expect(after?.querySelectorAll('input')).toHaveLength(0);
      expect(after?.querySelectorAll('button')).toHaveLength(1);
    });
  });

  /**
   * `PluginCatalogPanelComponent` is a bare inline panel: no `isOpen`, no
   * overlay, no `closed` output. Everything that used to make the picker read
   * as a dialog now belongs to this card, so these are the assertions that
   * would have caught a rehost that dropped the chrome and left the catalogue
   * rendered flat underneath the dashboard.
   */
  describe('the dialog chrome the card now owns', () => {
    const openPicker = async (): Promise<
      ComponentFixture<SkillSelectionCardComponent>
    > => {
      setResponder('harness:get-skill-selection', () =>
        ok(selection({ mode: 'selected', slugs: [] })),
      );
      const fixture = await mountCard();
      (fixture.nativeElement as HTMLElement)
        .querySelector<HTMLButtonElement>(
          '[data-testid="skill-selection-card-choose"]',
        )
        ?.click();
      await settle(fixture);
      return fixture;
    };

    it('mounts the catalogue panel inside an open modal dialog with a backdrop', async () => {
      const fixture = await openPicker();
      const host = fixture.nativeElement as HTMLElement;

      const dialog = host.querySelector('dialog.modal');
      expect(dialog).not.toBeNull();
      expect(dialog?.classList.contains('modal-open')).toBe(true);
      expect(dialog?.querySelector('.modal-box')).not.toBeNull();
      expect(dialog?.querySelector('.modal-backdrop')).not.toBeNull();
      expect(dialog?.querySelector('ptah-plugin-catalog-panel')).not.toBeNull();

      // Sibling, not child: the card's section must not contain the dialog.
      expect(
        host
          .querySelector('[data-testid="skill-selection-card"]')
          ?.querySelector('dialog'),
      ).toBeNull();
    });

    /**
     * D-2b: the picker shows the same storefront cards as the Marketplace.
     * jsdom computes no `@container` layout, so the 2-column / no-overflow
     * check inside `max-w-2xl` runs in Batch 25's real browser; this pins the
     * structure that check depends on.
     */
    it('renders the plugins as ptah-catalog-card items in a catalog grid inside the max-w-2xl dialog', async () => {
      setResponder('plugins:list-available', () =>
        ok({
          plugins: [
            {
              id: 'ptah-core',
              name: 'Ptah Core',
              description: 'A bundled plugin.',
              category: 'core-tools',
              skillCount: 1,
              commandCount: 0,
              isDefault: true,
            },
          ],
        }),
      );
      setResponder('plugins:get-config', () => ok({}));
      const fixture = await openPicker();
      // The panel's catalogue read needs further passes to render its cards.
      await settle(fixture);
      await settle(fixture);
      const box = (fixture.nativeElement as HTMLElement).querySelector(
        'dialog.modal .modal-box.max-w-2xl',
      );

      const grid = box?.querySelector('ptah-catalog-grid');
      expect(grid).not.toBeNull();
      expect(
        grid?.querySelector('[role="list"].ptah-catalog-grid'),
      ).not.toBeNull();
      const cards = grid?.querySelectorAll(
        'ptah-catalog-card[role="listitem"]',
      );
      expect(cards).toHaveLength(1);
      expect(cards?.[0]?.querySelector('ptah-monogram-tile')).not.toBeNull();
      expect(box?.querySelector('ptah-brand-mark')).toBeNull();
    });

    it('closes on the close button and on the backdrop, re-reading the selection each time', async () => {
      for (const closer of [
        '[data-testid="skill-selection-card-close"]',
        '.modal-backdrop',
      ]) {
        const fixture = await openPicker();
        const host = fixture.nativeElement as HTMLElement;

        calls.length = 0;
        host.querySelector<HTMLElement>(closer)?.click();
        await settle(fixture);

        expect(host.querySelector('dialog.modal')).toBeNull();
        expect(
          calls.some((c) => c.method === 'harness:get-skill-selection'),
        ).toBe(true);

        fixture.destroy();
      }
    });

    it('closes on Escape pressed anywhere in the document, and is a no-op while closed', async () => {
      const escape = (): void =>
        document.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape' }),
        );

      // Open: one Escape closes the picker and re-reads the selection.
      const fixture = await openPicker();
      const host = fixture.nativeElement as HTMLElement;
      escape();
      await settle(fixture);

      expect(host.querySelector('dialog.modal')).toBeNull();
      expect(
        calls.some((c) => c.method === 'harness:get-skill-selection'),
      ).toBe(true);

      // Closed: a second Escape does nothing — no re-read, no state change.
      calls.length = 0;
      escape();
      await settle(fixture);

      expect(host.querySelector('dialog.modal')).toBeNull();
      expect(calls).toHaveLength(0);

      fixture.destroy();
    });
  });

  describe('a transport failure', () => {
    it('leaves the card silent rather than surfacing an error', async () => {
      setResponder('harness:get-skill-selection', () =>
        Promise.reject(new Error('transport down')),
      );

      const fixture = await mountCard();
      const host = fixture.nativeElement as HTMLElement;

      expect(
        host.querySelector('[data-testid="skill-selection-card"]'),
      ).toBeNull();
      expect(host.textContent?.toLowerCase() ?? '').not.toContain('error');
      expect(
        calls.some((c) => c.method === 'harness:get-skill-selection'),
      ).toBe(true);
    });
  });
});
