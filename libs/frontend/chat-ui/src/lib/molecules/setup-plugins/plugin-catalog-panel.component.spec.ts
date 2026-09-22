/**
 * PluginCatalogPanelComponent — the five assertions carried over from
 * `plugin-browser-modal.component.spec.ts` when the modal body became an
 * inline panel (TASK_2026_524, spec 4). Only the SECOND axis is pinned here:
 * the plugin-checkbox axis has never had coverage and is out of scope.
 *
 *   - **A user-layer slug with no plugin above it renders as ordinary.** A
 *     promoted synth skill or a `skills.sh` install has `pluginId: null`, and
 *     that is the normal case, not an error — the whole reason the list is
 *     keyed on `available` rather than on `availablePlugins`.
 *   - **Switching to `'all'` sends `mode: 'all'`**, with no stale `slugs`.
 *   - **An untouched derived `'all'` is never recorded as a choice.**
 *   - **The TASK_2026_345 gate regression**: the skill selection stands alone,
 *     both when the catalogue fails and while it is still in flight.
 *
 * Two things changed in the port and nothing else: there is no `isOpen` to
 * set — the panel loads from `ngOnInit` — and Save is found by
 * `[data-testid="plugin-catalog-save"]` rather than by modal chrome.
 */

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ClaudeRpcService } from '@ptah-extension/core';
import type { HarnessGetSkillSelectionResult } from '@ptah-extension/shared';
import { PluginCatalogPanelComponent } from './plugin-catalog-panel.component';

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

describe('plugin catalog panel — per-workspace skill selection', () => {
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

  /**
   * Drain the load and render the result.
   *
   * Three passes rather than one since TASK_2026_345: the plugin list and
   * config arrive through `PluginCatalogService`, so `loadPlugins` awaits a
   * shared promise which itself awaits the `Promise.all` of the two RPCs and a
   * `finally`. A single `whenStable()` settles the outermost await only and
   * leaves the panel rendering its loading skeleton, with no Save button to
   * click.
   */
  const settle = async (fixture: ComponentFixture<unknown>): Promise<void> => {
    fixture.detectChanges();
    for (let pass = 0; pass < 3; pass += 1) {
      await fixture.whenStable();
      fixture.detectChanges();
    }
  };

  /** Mount the panel and let the `ngOnInit` load settle. No `isOpen`. */
  const mount = async (): Promise<
    ComponentFixture<PluginCatalogPanelComponent>
  > => {
    const fixture = TestBed.createComponent(PluginCatalogPanelComponent);
    await settle(fixture);
    return fixture;
  };

  /** The Save button, keyed on its own testid rather than on modal chrome. */
  const clickSave = (host: HTMLElement): void => {
    host
      .querySelector<HTMLButtonElement>('[data-testid="plugin-catalog-save"]')
      ?.click();
  };

  beforeEach(() => {
    calls = [];
    responders = new Map();
    rpcMock.call.mockClear();
    // Harmless empty plugin catalogue for every test here — that axis is
    // untouched by this port and irrelevant to what's being pinned.
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

    const fixture = await mount();
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

    const fixture = await mount();
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

  it('keeps the plugin list when the host answers plugins:get-config with {}', async () => {
    // A partial config record — the e2e harness answers `{}` — must read as
    // "nothing opted in", never throw in `deriveSelection` and land the panel
    // in its error branch with the catalogue cleared.
    setResponder('plugins:list-available', () =>
      ok({
        plugins: [
          {
            id: 'ptah-core',
            name: 'Ptah Core',
            description: 'A bundled plugin.',
            category: 'core-tools',
            skillCount: 3,
            commandCount: 1,
            isDefault: true,
          },
        ],
      }),
    );
    setResponder('plugins:get-config', () => ok({}));

    const fixture = await mount();
    const host = fixture.nativeElement as HTMLElement;

    expect(fixture.componentInstance.error()).toBeNull();
    expect(fixture.componentInstance.isLoading()).toBe(false);
    expect(fixture.componentInstance.availablePlugins().map((p) => p.id)).toEqual(
      ['ptah-core'],
    );
    // The list is on screen, not merely in state.
    expect(
      host.querySelector('input[aria-label="Enable Ptah Core"]'),
    ).not.toBeNull();
    expect(host.querySelector('.text-error')).toBeNull();
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

    const fixture = await mount();
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

/**
 * TASK_2026_345 gate regression — the skill selection does not depend on the
 * plugin catalogue.
 *
 * The catalogue is SHARED, so `ensureLoaded()` can hand this panel a read
 * another component started. Sequencing the skill-selection section behind it —
 * and rendering that section inside the loading/error branch — meant the one
 * control the dashboard's skill-selection card exists FOR was hidden whenever
 * the plugin side was slow, and hidden for good whenever it failed.
 */
describe('plugin catalog panel — the skill selection stands alone', () => {
  let responders: Map<string, () => unknown>;

  const setResponder = (method: string, factory: () => unknown): void => {
    responders.set(method, factory);
  };

  const rpcMock = {
    call: jest.fn((method: string) => {
      const factory = responders.get(method);
      return factory
        ? Promise.resolve(factory())
        : Promise.resolve(ok(undefined));
    }),
  };

  function failed(message: string) {
    return {
      success: false,
      data: undefined,
      error: message,
      isSuccess: (): boolean => false,
    };
  }

  const settle = async (fixture: ComponentFixture<unknown>): Promise<void> => {
    fixture.detectChanges();
    for (let pass = 0; pass < 3; pass += 1) {
      await fixture.whenStable();
      fixture.detectChanges();
    }
  };

  beforeEach(() => {
    responders = new Map();
    rpcMock.call.mockClear();
    setResponder('harness:get-skill-selection', () =>
      ok(
        selection({
          mode: 'selected',
          slugs: [],
          available: [
            {
              slug: 'a-skill',
              name: 'A Skill',
              description: '',
              pluginId: null,
            },
          ],
        }),
      ),
    );
    TestBed.configureTestingModule({
      providers: [{ provide: ClaudeRpcService, useValue: rpcMock }],
    });
  });

  afterEach(() => TestBed.resetTestingModule());

  it('renders the selection even when both plugin reads fail', async () => {
    // "Catalogue failure -> plugins empty, selection still rendered." A read
    // that failed on an unrelated axis must not take the control away.
    setResponder('plugins:list-available', () => failed('list exploded'));
    setResponder('plugins:get-config', () => failed('config exploded'));

    const fixture = TestBed.createComponent(PluginCatalogPanelComponent);
    await settle(fixture);
    const host = fixture.nativeElement as HTMLElement;

    expect(
      host.querySelector('[data-testid="skill-selection"]'),
    ).not.toBeNull();
    expect(fixture.componentInstance.availablePlugins()).toEqual([]);
  });

  it('renders the selection while the plugin reads are still in flight', async () => {
    // The latency half. `ensureLoaded()` may be waiting on a request THIS panel
    // did not issue, so the section must not sit behind it.
    const held: Array<() => void> = [];
    const hold = () =>
      new Promise((resolve) => held.push(() => resolve(ok({ plugins: [] }))));
    setResponder('plugins:list-available', hold);
    setResponder('plugins:get-config', hold);

    const fixture = TestBed.createComponent(PluginCatalogPanelComponent);
    await settle(fixture);
    const host = fixture.nativeElement as HTMLElement;

    // Still loading the plugin list...
    expect(fixture.componentInstance.isLoading()).toBe(true);
    // ...and the control is already there.
    expect(
      host.querySelector('[data-testid="skill-selection"]'),
    ).not.toBeNull();

    for (const release of held.splice(0, held.length)) release();
    await settle(fixture);
  });
});
