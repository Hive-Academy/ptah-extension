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
 *     the existing Configure Ptah Skills modal — same shape as the precedent
 *     `HarnessCardComponent`, which performs no repair itself.
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

      // Opening the modal is the only thing the button does.
      calls.length = 0;
      before
        ?.querySelector<HTMLButtonElement>(
          '[data-testid="skill-selection-card-choose"]',
        )
        ?.click();
      await settle(fixture);

      // The modal — a SIBLING of the card's section, not a child of it — is
      // where selection happens. It routed there and did nothing else itself.
      expect(
        host.querySelector('[data-testid="skill-selection"]'),
      ).not.toBeNull();

      // The card's own section still owns no selection UI while the modal is open.
      const after = host.querySelector('[data-testid="skill-selection-card"]');
      expect(after?.querySelectorAll('input')).toHaveLength(0);
      expect(after?.querySelectorAll('button')).toHaveLength(1);
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
