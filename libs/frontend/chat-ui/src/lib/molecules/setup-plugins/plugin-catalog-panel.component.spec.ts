/**
 * PluginCatalogPanelComponent — the five assertions carried over from
 * `plugin-browser-modal.component.spec.ts` when the modal body became an
 * inline panel (TASK_2026_524, spec 4). They pin the SECOND axis; the plugin
 * axis has one structural test for the storefront-card restyle (C13).
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

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TabManagerService } from '@ptah-extension/chat-state';
import { ClaudeRpcService } from '@ptah-extension/core';
import {
  SessionId,
  type HarnessGetSkillSelectionResult,
  type PluginSessionNotice,
} from '@ptah-extension/shared';
import {
  PLUGIN_SAVE_APPLIES_NOTICE,
  PluginCatalogPanelComponent,
} from './plugin-catalog-panel.component';

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

function pluginConfig(sessionNotice?: PluginSessionNotice) {
  return {
    enabledPluginIds: [],
    disabledPluginIds: [],
    disabledSkillIds: [],
    ...(sessionNotice ? { sessionNotice } : {}),
  };
}

function sessionNotice(
  over: Partial<PluginSessionNotice> = {},
): PluginSessionNotice {
  return {
    sessionRoot: '/worktrees/session',
    inheritsProjectSettings: true,
    overrides: [],
    incomplete: false,
    ...over,
  };
}

const FIRST_SESSION_ID = SessionId.from(
  '11111111-1111-4111-8111-111111111111',
);
const SECOND_SESSION_ID = SessionId.from(
  '22222222-2222-4222-8222-222222222222',
);

interface RpcCall {
  method: string;
  params: unknown;
}

describe('plugin catalog panel — per-workspace skill selection', () => {
  let calls: RpcCall[];
  let responders: Map<string, (params: unknown) => unknown>;
  const activeTabSessionId = signal<SessionId | null>(null);

  const setResponder = (
    method: string,
    factory: (params: unknown) => unknown,
  ): void => {
    responders.set(method, factory);
  };

  const rpcMock = {
    call: jest.fn((method: string, params: unknown) => {
      calls.push({ method, params });
      const factory = responders.get(method);
      if (!factory) {
        return Promise.resolve(ok(undefined));
      }
      return Promise.resolve(factory(params));
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
    activeTabSessionId.set(null);
    rpcMock.call.mockClear();
    // Harmless empty plugin catalogue for every test here — that axis is
    // untouched by this port and irrelevant to what's being pinned.
    setResponder('plugins:list-available', () => ok({ plugins: [] }));
    setResponder('plugins:get-config', () => ok(pluginConfig()));
    setResponder('plugins:save-config', () => ok({ saved: true }));
    TestBed.configureTestingModule({
      providers: [
        { provide: ClaudeRpcService, useValue: rpcMock },
        { provide: TabManagerService, useValue: { activeTabSessionId } },
      ],
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

  it('renders each plugin as a storefront catalog card with a monogram, toggle and skill expansion (C13)', async () => {
    setResponder('plugins:list-available', () =>
      ok({
        plugins: [
          {
            id: 'ptah-core',
            name: 'Ptah Core',
            description: 'A bundled plugin.',
            category: 'core-tools',
            skillCount: 2,
            commandCount: 1,
            isDefault: true,
          },
        ],
      }),
    );
    setResponder('plugins:get-config', () =>
      ok({
        enabledPluginIds: ['ptah-core'],
        disabledPluginIds: [],
        disabledSkillIds: [],
      }),
    );
    setResponder('plugins:list-skills', () =>
      ok({
        skills: [
          {
            skillId: 'ptah-core:review',
            pluginId: 'ptah-core',
            displayName: 'Review',
            description: 'Reviews code.',
          },
        ],
      }),
    );

    const fixture = await mount();
    const host = fixture.nativeElement as HTMLElement;

    // One grid for the Core Tools group, headed by a visible h2, one card.
    const grid = host.querySelector('ptah-catalog-grid');
    expect(grid?.previousElementSibling?.tagName).toBe('H2');
    expect(grid?.previousElementSibling?.textContent?.trim()).toBe(
      'Core Tools',
    );
    const card = grid?.querySelector('ptah-catalog-card');
    expect(card?.getAttribute('role')).toBe('listitem');
    expect(card?.querySelector('h3')?.textContent?.trim()).toBe('Ptah Core');
    expect(
      card?.querySelector('[data-testid="catalog-card-meta"]')?.textContent,
    ).toContain('2 skills · 1 command · Recommended');
    expect(
      card?.querySelector('[data-testid="catalog-card-badge"]')?.textContent,
    ).toContain('Enabled');
    // R7: the eager dashboard renders this panel, so never the brand table.
    expect(card?.querySelector('ptah-monogram-tile')).not.toBeNull();
    expect(host.querySelector('ptah-brand-mark')).toBeNull();
    const toggle = card?.querySelector<HTMLInputElement>(
      '[data-testid="catalog-card-actions"] input[aria-label="Enable Ptah Core"]',
    );
    expect(toggle?.checked).toBe(true);

    // The plugin's skills are a list inside the card expansion, behind a
    // disclosure button whose aria-expanded tracks it: false, true, false.
    const expander = (): HTMLButtonElement | null | undefined =>
      card?.querySelector<HTMLButtonElement>(
        '[data-testid="catalog-card-actions"] button[aria-expanded]',
      );
    const skills = (): Element | null | undefined =>
      card?.querySelector(
        '[data-testid="catalog-card-expansion"] [aria-label="Skills for Ptah Core"]',
      );
    expect(expander()?.getAttribute('aria-expanded')).toBe('false');
    expect(expander()?.getAttribute('aria-label')).toBe('Expand skill list');
    expect(skills()).toBeNull();

    expander()?.click();
    await settle(fixture);
    expect(expander()?.getAttribute('aria-expanded')).toBe('true');
    expect(expander()?.getAttribute('aria-label')).toBe('Collapse skill list');
    expect(
      skills()?.querySelector('input[aria-label="Disable Review"]'),
    ).not.toBeNull();

    expander()?.click();
    await settle(fixture);
    expect(expander()?.getAttribute('aria-expanded')).toBe('false');
    expect(skills()).toBeNull();

    // Unticking the toggle drops the badge; the save payload follows it.
    toggle?.click();
    await settle(fixture);
    expect(
      card?.querySelector('[data-testid="catalog-card-badge"]'),
    ).toBeNull();
    clickSave(host);
    await settle(fixture);
    expect(
      calls.find((c) => c.method === 'plugins:save-config')?.params,
    ).toEqual({
      enabledPluginIds: [],
      disabledSkillIds: [],
      disabledPluginIds: [],
    });
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

  describe('session and save notices', () => {
    const sessionConfigCalls = (): RpcCall[] =>
      calls.filter(
        (call) =>
          call.method === 'plugins:get-config' &&
          typeof call.params === 'object' &&
          call.params !== null &&
          'sessionId' in call.params,
      );
    const normalizedText = (element: Element | null): string =>
      element?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

    it('does not request or render a session notice without a selected session', async () => {
      const fixture = await mount();
      const host = fixture.nativeElement as HTMLElement;

      expect(sessionConfigCalls()).toEqual([]);
      expect(host.querySelector('[data-testid="plugin-session-notice"]')).toBeNull();
    });

    it('requests a UUID session and renders the inherited-settings notice', async () => {
      activeTabSessionId.set(FIRST_SESSION_ID);
      setResponder('plugins:get-config', () =>
        ok(pluginConfig(sessionNotice())),
      );

      const fixture = await mount();
      const host = fixture.nativeElement as HTMLElement;
      const notice = host.querySelector(
        '[data-testid="plugin-session-notice"]',
      );

      expect(sessionConfigCalls().map((call) => call.params)).toEqual([
        { sessionId: FIRST_SESSION_ID },
      ]);
      expect(notice?.getAttribute('role')).toBe('status');
      expect(normalizedText(notice)).toContain(
        "This session runs in /worktrees/session and uses this project's plugin settings.",
      );
      expect(notice?.querySelectorAll('button')).toHaveLength(0);
    });

    it('renders non-inherited settings, the incomplete line, and breakable paths', async () => {
      activeTabSessionId.set(FIRST_SESSION_ID);
      setResponder('plugins:get-config', () =>
        ok(
          pluginConfig(
            sessionNotice({
              sessionRoot: '/a/very/long/session/root/that/must/break',
              inheritsProjectSettings: false,
              incomplete: true,
            }),
          ),
        ),
      );

      const fixture = await mount();
      const notice = (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="plugin-session-notice"]',
      );

      expect(normalizedText(notice)).toContain(
        "This session runs in /a/very/long/session/root/that/must/break. It does not use this project's plugin settings.",
      );
      expect(normalizedText(notice)).toContain(
        "Some of this session's folder settings could not be read.",
      );
      expect(
        notice?.querySelector('p')?.classList.contains('break-words'),
      ).toBe(true);
    });

    it('uses catalog plugin names and retains unknown plugin and skill ids', async () => {
      activeTabSessionId.set(FIRST_SESSION_ID);
      setResponder('plugins:list-available', () =>
        ok({
          plugins: [
            {
              id: 'ptah-core',
              name: 'Ptah Core',
              description: 'A bundled plugin.',
              category: 'core-tools',
              skillCount: 0,
              commandCount: 0,
              isDefault: true,
            },
          ],
        }),
      );
      setResponder('plugins:get-config', () =>
        ok(
          pluginConfig(
            sessionNotice({
              overrides: [
                {
                  kind: 'plugin',
                  id: 'ptah-core',
                  value: 'off',
                  root: '/worktrees/session',
                },
                {
                  kind: 'plugin',
                  id: 'unknown-plugin',
                  value: 'on',
                  root: '/worktrees/session',
                },
                {
                  kind: 'skill',
                  id: 'skill-x',
                  value: 'off',
                  root: '/worktrees/session',
                },
              ],
            }),
          ),
        ),
      );

      const fixture = await mount();
      const notice = (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="plugin-session-notice"]',
      );
      const text = normalizedText(notice);

      expect(text).toContain('Ptah Core: off');
      expect(text).toContain('unknown-plugin: on');
      expect(text).toContain('skill-x: off');
    });

    it('limits the override list to ten entries and reports the remainder', async () => {
      activeTabSessionId.set(FIRST_SESSION_ID);
      setResponder('plugins:get-config', () =>
        ok(
          pluginConfig(
            sessionNotice({
              overrides: Array.from({ length: 12 }, (_, index) => ({
                kind: 'skill' as const,
                id: `skill-${index}`,
                value: 'on' as const,
                root: '/worktrees/session',
              })),
            }),
          ),
        ),
      );

      const fixture = await mount();
      const notice = (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="plugin-session-notice"]',
      );

      expect(notice?.querySelectorAll('li')).toHaveLength(11);
      expect(normalizedText(notice)).toContain('and 2 more');
      expect(normalizedText(notice)).not.toContain('skill-10');
    });

    it('re-queries on a session switch and ignores the earlier late reply', async () => {
      const pending = new Map<string, (value: unknown) => void>();
      setResponder('plugins:get-config', (params) => {
        const sessionId = (params as { sessionId?: string }).sessionId;
        if (!sessionId) return ok(pluginConfig());
        return new Promise((resolve) => pending.set(sessionId, resolve));
      });
      activeTabSessionId.set(FIRST_SESSION_ID);

      const fixture = await mount();
      expect(pending.has(FIRST_SESSION_ID)).toBe(true);

      activeTabSessionId.set(SECOND_SESSION_ID);
      TestBed.flushEffects();
      await settle(fixture);
      expect(pending.has(SECOND_SESSION_ID)).toBe(true);
      expect(sessionConfigCalls().map((call) => call.params)).toEqual([
        { sessionId: FIRST_SESSION_ID },
        { sessionId: SECOND_SESSION_ID },
      ]);

      pending.get(SECOND_SESSION_ID)?.(
        ok(pluginConfig(sessionNotice({ sessionRoot: '/sessions/second' }))),
      );
      await settle(fixture);
      const host = fixture.nativeElement as HTMLElement;
      expect(normalizedText(host)).toContain('/sessions/second');

      pending.get(FIRST_SESSION_ID)?.(
        ok(pluginConfig(sessionNotice({ sessionRoot: '/sessions/first' }))),
      );
      await settle(fixture);
      expect(normalizedText(host)).toContain('/sessions/second');
      expect(normalizedText(host)).not.toContain('/sessions/first');
    });

    it('clears the current notice as soon as the session changes', async () => {
      const pending = new Map<string, (value: unknown) => void>();
      setResponder('plugins:get-config', (params) => {
        const sessionId = (params as { sessionId?: string }).sessionId;
        if (!sessionId) return ok(pluginConfig());
        return new Promise((resolve) => pending.set(sessionId, resolve));
      });
      activeTabSessionId.set(FIRST_SESSION_ID);

      const fixture = await mount();
      const host = fixture.nativeElement as HTMLElement;
      pending.get(FIRST_SESSION_ID)?.(
        ok(pluginConfig(sessionNotice({ sessionRoot: '/sessions/first' }))),
      );
      await settle(fixture);
      expect(normalizedText(host)).toContain('/sessions/first');
      expect(
        host.querySelector('[data-testid="plugin-session-notice"]'),
      ).not.toBeNull();

      activeTabSessionId.set(SECOND_SESSION_ID);
      TestBed.flushEffects();
      fixture.detectChanges();
      expect(fixture.componentInstance.sessionNotice()).toBeNull();
      expect(
        host.querySelector('[data-testid="plugin-session-notice"]'),
      ).toBeNull();
      expect(pending.has(SECOND_SESSION_ID)).toBe(true);

      pending.get(SECOND_SESSION_ID)?.(
        ok(pluginConfig(sessionNotice({ sessionRoot: '/sessions/second' }))),
      );
      await settle(fixture);
      expect(fixture.componentInstance.sessionNotice()?.sessionRoot).toBe(
        '/sessions/second',
      );
      expect(normalizedText(host)).toContain('/sessions/second');
      expect(normalizedText(host)).not.toContain('/sessions/first');
    });

    it('drops the notice after an RPC failure and still loads the panel', async () => {
      activeTabSessionId.set(FIRST_SESSION_ID);
      setResponder('plugins:get-config', (params) => {
        const sessionId = (params as { sessionId?: string }).sessionId;
        return sessionId
          ? Promise.reject(new Error('notice unavailable'))
          : ok(pluginConfig());
      });

      const fixture = await mount();
      const host = fixture.nativeElement as HTMLElement;

      expect(host.querySelector('[data-testid="plugin-session-notice"]')).toBeNull();
      expect(fixture.componentInstance.isLoading()).toBe(false);
      expect(fixture.componentInstance.error()).toBeNull();
      expect(
        host.querySelector('[data-testid="plugin-catalog-save"]'),
      ).not.toBeNull();
    });

    it('shows the exact post-save notice and leaves the save payload unchanged', async () => {
      const fixture = await mount();
      const host = fixture.nativeElement as HTMLElement;

      clickSave(host);
      await settle(fixture);

      const notice = host.querySelector(
        '[data-testid="plugin-save-applies-notice"]',
      );
      expect(notice?.getAttribute('role')).toBe('status');
      expect(normalizedText(notice)).toBe(PLUGIN_SAVE_APPLIES_NOTICE);
      expect(
        calls.find((call) => call.method === 'plugins:save-config')?.params,
      ).toEqual({
        enabledPluginIds: [],
        disabledSkillIds: [],
        disabledPluginIds: [],
      });
    });

    it('does not show the post-save notice after a failed save', async () => {
      setResponder('plugins:save-config', () => ok(undefined));
      const fixture = await mount();
      const host = fixture.nativeElement as HTMLElement;

      clickSave(host);
      await settle(fixture);

      expect(
        host.querySelector('[data-testid="plugin-save-applies-notice"]'),
      ).toBeNull();
      expect(fixture.componentInstance.saveError()).toBe(
        'Failed to save configuration.',
      );
    });

    it('treats a success:false save reply as a failure', async () => {
      setResponder('plugins:save-config', () =>
        ok({ success: false, error: 'disk full' }),
      );
      const fixture = await mount();
      const host = fixture.nativeElement as HTMLElement;
      const saved = jest.fn();
      fixture.componentInstance.saved.subscribe(saved);

      clickSave(host);
      await settle(fixture);

      expect(
        host.querySelector('[data-testid="plugin-save-applies-notice"]'),
      ).toBeNull();
      expect(saved).not.toHaveBeenCalled();
      expect(fixture.componentInstance.saveError()).toBe(
        'Failed to save configuration.',
      );
    });
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
      providers: [
        { provide: ClaudeRpcService, useValue: rpcMock },
        {
          provide: TabManagerService,
          useValue: { activeTabSessionId: signal<SessionId | null>(null) },
        },
      ],
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
