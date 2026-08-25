/**
 * PluginBrowserModalComponent — per-workspace skill selection (TASK_2026_316
 * Batch 4). Only the SECOND axis added by this task is pinned here: the
 * plugin-checkbox axis already has no coverage and is out of this batch's
 * scope.
 *
 *   - **A user-layer slug with no plugin above it renders as ordinary.** A
 *     promoted synth skill or a `skills.sh` install has `pluginId: null`, and
 *     that is the normal case, not an error — the whole reason the list is
 *     keyed on `available` rather than on `availablePlugins`.
 *   - **Switching to `'all'` sends `mode: 'all'`**, with no stale `slugs`.
 *   - **An untouched derived `'all'` is never recorded as a choice.**
 *     `harness:set-skill-selection` must not fire when the user saves without
 *     touching the control — that is the difference between the migration's
 *     inference and the user's decision.
 */

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ClaudeRpcService } from '@ptah-extension/core';
import type { HarnessGetSkillSelectionResult } from '@ptah-extension/shared';
import { PluginBrowserModalComponent } from './plugin-browser-modal.component';

/**
 * Minimal stand-in for the core `RpcResult` shape: `isSuccess()`, `.data`,
 * `.error`. Mirrors the real class's truthiness rule (success AND data !==
 * undefined) — same idiom as `smithery-surface.component.spec.ts`.
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

describe('plugin browser modal — per-workspace skill selection', () => {
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

  /** Mount the modal already open, letting `loadPlugins` settle. */
  const mountOpen = async (): Promise<
    ComponentFixture<PluginBrowserModalComponent>
  > => {
    const fixture = TestBed.createComponent(PluginBrowserModalComponent);
    fixture.componentRef.setInput('isOpen', true);
    await settle(fixture);
    return fixture;
  };

  /** The lone `.modal-action` primary button — "Save Configuration". */
  const clickSave = (host: HTMLElement): void => {
    host
      .querySelector<HTMLButtonElement>('.modal-action .btn-primary')
      ?.click();
  };

  beforeEach(() => {
    calls = [];
    responders = new Map();
    rpcMock.call.mockClear();
    // Harmless empty plugin catalogue for every test here — this axis is
    // untouched by this batch and irrelevant to what's being pinned.
    setResponder('plugins:list-available', () => ok({ plugins: [] }));
    setResponder('plugins:get-config', () =>
      ok({ enabledPluginIds: [], disabledPluginIds: [], disabledSkillIds: [] }),
    );
    setResponder('plugins:save-config', () => ok({ saved: true }));
    TestBed.configureTestingModule({
      providers: [{ provide: ClaudeRpcService, useValue: rpcMock }],
    });
  });

  afterEach(() => TestBed.resetTestingModule());

  it('lists a user-layer slug with no bundled plugin above it as an ordinary selectable row', async () => {
    setResponder('harness:get-skill-selection', () =>
      ok(
        selection({
          mode: 'selected',
          slugs: [],
          available: [
            {
              slug: 'user-layer-skill',
              name: 'User Layer Skill',
              description: 'promoted from a synth trajectory',
              pluginId: null,
            },
          ],
        }),
      ),
    );

    const fixture = await mountOpen();
    const host = fixture.nativeElement as HTMLElement;
    const section = host.querySelector('[data-testid="skill-selection"]');

    expect(section).not.toBeNull();
    expect(section?.textContent).toContain('User Layer Skill');

    const row = Array.from(section?.querySelectorAll('label') ?? []).find(
      (label) => label.textContent?.includes('User Layer Skill'),
    );
    expect(row).toBeDefined();
    // An ordinary row: a plain checkbox, ticked/untickable like any other —
    // and specifically NO plugin-id badge, since `pluginId` is null.
    expect(row?.querySelector('input[type="checkbox"]')).not.toBeNull();
    expect(row?.querySelectorAll('.badge')).toHaveLength(0);
  });

  it('sends mode: "all" with no slugs when the user switches to All of them', async () => {
    setResponder('harness:get-skill-selection', () =>
      ok(
        selection({
          mode: 'selected',
          slugs: ['a'],
          available: [
            { slug: 'a', name: 'A', description: '', pluginId: null },
          ],
          derived: false,
        }),
      ),
    );
    setResponder('harness:set-skill-selection', () =>
      ok({ saved: true, mode: 'all', slugs: [], health: null, summary: {} }),
    );

    const fixture = await mountOpen();
    const host = fixture.nativeElement as HTMLElement;

    host
      .querySelector<HTMLButtonElement>('[data-testid="skill-mode-all"]')
      ?.click();
    await settle(fixture);

    clickSave(host);
    await settle(fixture);

    const setCall = calls.find(
      (c) => c.method === 'harness:set-skill-selection',
    );
    expect(setCall).toBeDefined();
    expect(setCall?.params).toEqual({ mode: 'all' });
  });

  it('never records an untouched derived "all" as a choice', async () => {
    setResponder('harness:get-skill-selection', () =>
      ok(
        selection({
          mode: 'all',
          slugs: [],
          available: [
            { slug: 'a', name: 'A', description: '', pluginId: null },
          ],
          derived: true,
        }),
      ),
    );

    const fixture = await mountOpen();
    const host = fixture.nativeElement as HTMLElement;

    // Save without ever touching the mode control or ticking anything.
    clickSave(host);
    await settle(fixture);

    expect(calls.some((c) => c.method === 'harness:set-skill-selection')).toBe(
      false,
    );
    // The plugin axis still saved — only the skill-selection write is withheld.
    expect(calls.some((c) => c.method === 'plugins:save-config')).toBe(true);
  });
});
