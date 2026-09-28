import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  SURFACE_VIEW_MODEL_BUILDER,
  SurfaceRendererComponent,
  type SurfaceInteractionState,
  type SurfaceViewState,
} from '@ptah-extension/declarative-dashboard';
import { renderDashboardSpecText } from '@ptah-extension/shared/mcp-apps-contracts';
import type {
  SurfaceComponent,
  SurfaceContent,
} from '@ptah-extension/shared/mcp-apps-contracts/surface';
import { makeDashboardSpec, makeTable } from '@ptah-extension/shared/testing';
import { AppsSessionService } from '../services/apps-session.service';
import { AppsSurfaceOperations } from '../services/apps-surface-operations.service';
import {
  APPS_EVICTED_NOTICE,
  activateSurface,
  applySurfacePush,
  createAppsSurfaceState,
  setSurfaceViewState,
  type AppsSurfaceState,
} from '../state/apps-surface-reducer';
import {
  APPS_UNSHOWN_TEXT,
  AppsSurfacePanelComponent,
  readLastSubmit,
} from './apps-surface-panel.component';

const ROUTING_ID = 'tab_apps-routing';

function v2(surfaceId: string, title: string): SurfaceContent {
  return {
    contract: 'dashboard-spec/2',
    surface: {
      schemaVersion: 'dashboard-spec/2',
      catalogVersion: 'dashboard-catalog/2',
      surfaceId,
      title: { text: title },
      components: [makeTable(3, 2) as SurfaceComponent],
    },
    dataModel: {},
  };
}

function snapshot(
  surfaceId: string,
  revision: number,
  content: unknown,
  origin: 'agent' | 'ui' | 'host' = 'agent',
  lastSubmit: unknown = null,
) {
  return {
    routingId: ROUTING_ID,
    surfaceId,
    revision,
    origin,
    change: {
      kind: 'snapshot',
      state: { surfaceId, revision, content, selection: null, lastSubmit },
    },
  };
}

function evicted(surfaceId: string, revision: number) {
  return {
    routingId: ROUTING_ID,
    surfaceId,
    revision,
    origin: 'host',
    change: { kind: 'deleted', reason: 'evicted' },
  };
}

describe('AppsSurfacePanelComponent', () => {
  let fixture: ComponentFixture<AppsSurfacePanelComponent>;
  let surfaces: ReturnType<typeof signal<AppsSurfaceState>>;
  let syncNotice: ReturnType<typeof signal<string | null>>;
  let setViewState: jest.Mock;
  let warn: jest.SpyInstance;

  function push(payload: unknown): void {
    surfaces.update((state) => applySurfacePush(state, payload).state);
  }

  function render(): HTMLElement {
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  function tabs(): HTMLButtonElement[] {
    return Array.from(
      (
        fixture.nativeElement as HTMLElement
      ).querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    );
  }

  function configure(builder?: unknown): void {
    surfaces = signal(createAppsSurfaceState());
    syncNotice = signal<string | null>(null);
    setViewState = jest.fn((surfaceId: string, viewState: SurfaceViewState) =>
      surfaces.update((state) =>
        setSurfaceViewState(state, surfaceId, viewState),
      ),
    );
    const interaction: SurfaceInteractionState = {
      selection: null,
      selectionUnsynced: false,
      pendingValues: new Map(),
      issues: new Map(),
      actions: new Map(),
      submitDisabled: false,
    };
    TestBed.configureTestingModule({
      imports: [AppsSurfacePanelComponent],
      providers: [
        {
          provide: AppsSessionService,
          useValue: {
            surfaces: surfaces.asReadonly(),
            syncNotice: syncNotice.asReadonly(),
            setSurfaceViewState: setViewState,
            activateSurface: (surfaceId: string) =>
              surfaces.update((state) => activateSurface(state, surfaceId)),
          },
        },
        {
          provide: AppsSurfaceOperations,
          useValue: {
            interaction: () => interaction,
            notice: () => null,
            change: jest.fn(),
            select: jest.fn(),
            submit: jest.fn(),
          },
        },
        ...(builder === undefined
          ? []
          : [{ provide: SURFACE_VIEW_MODEL_BUILDER, useValue: builder }]),
      ],
    });
    fixture = TestBed.createComponent(AppsSurfacePanelComponent);
  }

  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
    TestBed.resetTestingModule();
  });

  it('shows the empty state and no switcher when no surface is held', () => {
    configure();
    const element = render();
    expect(
      element.querySelector('[data-testid="apps-empty"]')?.textContent,
    ).toContain('No app yet');
    expect(element.querySelector('[role="tablist"]')).toBeNull();
    expect(element.querySelector('ptah-surface-renderer')).toBeNull();
  });

  it('shows a role="tablist" switcher only when two surfaces are held', () => {
    configure();
    push(snapshot('a', 1, v2('a', 'Weekly Deploy Cost')));
    let element = render();
    expect(element.querySelector('[role="tablist"]')).toBeNull();
    expect(element.querySelector('[role="tabpanel"]')).toBeNull();
    expect(element.querySelector('ptah-surface-renderer')).not.toBeNull();

    push(snapshot('b', 1, v2('b', 'Rollback Request')));
    element = render();
    const list = element.querySelector('[role="tablist"]');
    expect(list?.getAttribute('aria-label')).toBe('Open apps');
    expect(tabs().map((tab) => tab.textContent?.trim())).toEqual([
      'Weekly Deploy Cost',
      'Rollback Request',
    ]);
    expect(tabs().map((tab) => tab.getAttribute('aria-selected'))).toEqual([
      'false',
      'true',
    ]);
    const panel = element.querySelector('[role="tabpanel"]');
    expect(panel?.getAttribute('aria-labelledby')).toBe(tabs()[1].id);
    expect(tabs()[0].getAttribute('aria-controls')).toBe(panel?.id);
    expect(tabs().map((tab) => tab.getAttribute('tabindex'))).toEqual([
      '-1',
      '0',
    ]);
  });

  it('activates a new agent surface, and a user pick sticks through writes to the other surface', () => {
    configure();
    push(snapshot('a', 1, v2('a', 'First')));
    push(snapshot('b', 1, v2('b', 'Second')));
    render();
    expect(surfaces().activeSurfaceId).toBe('b');

    tabs()[0].click();
    render();
    expect(surfaces().activeSurfaceId).toBe('a');
    expect(tabs()[0].getAttribute('aria-selected')).toBe('true');

    // A ui-origin write to the other surface does not steal the pick.
    push(snapshot('b', 2, v2('b', 'Second'), 'ui'));
    render();
    expect(surfaces().activeSurfaceId).toBe('a');

    // The agent replaced "b". PLAN DEVIATION (coordinator ruling, B15 round
    // 1): an agent update to another surface no longer takes the selection;
    // the pick stays on "a" and only the tab label of "b" changes.
    push(snapshot('b', 3, v2('b', 'Second, rebuilt')));
    render();
    expect(surfaces().activeSurfaceId).toBe('a');
    expect(tabs()[1].textContent?.trim()).toBe('Second, rebuilt');
    expect(tabs()[0].getAttribute('aria-selected')).toBe('true');
    expect(tabs()[1].getAttribute('aria-selected')).toBe('false');
  });

  it('keeps focus inside the picked surface when the agent updates another one', () => {
    configure();
    push(snapshot('a', 1, v2('a', 'First')));
    push(snapshot('b', 1, v2('b', 'Second')));
    const element = render();
    document.body.appendChild(element);
    try {
      tabs()[0].click();
      render();
      const search = element.querySelector<HTMLInputElement>(
        'ptah-dashboard-table input[type="search"]',
      );
      expect(search).not.toBeNull();
      search?.focus();
      expect(document.activeElement).toBe(search);

      push(snapshot('b', 2, v2('b', 'Second, rebuilt')));
      render();
      // Same renderer subtree: the focused input was not destroyed.
      expect(element.contains(search)).toBe(true);
      expect(document.activeElement).toBe(search);
    } finally {
      element.remove();
    }
  });

  it('keeps a user pick when the agent creates a new surface', () => {
    configure();
    push(snapshot('a', 1, v2('a', 'First')));
    push(snapshot('b', 1, v2('b', 'Second')));
    render();
    tabs()[0].click();
    render();

    push(snapshot('c', 1, v2('c', 'Third')));
    render();
    expect(surfaces().activeSurfaceId).toBe('a');
    expect(tabs().map((tab) => tab.getAttribute('aria-selected'))).toEqual([
      'true',
      'false',
      'false',
    ]);
  });

  it('falls back to the most recent surface when the picked one is evicted, then new agent surfaces activate again', () => {
    configure();
    push(snapshot('a', 1, v2('a', 'First')));
    push(snapshot('b', 1, v2('b', 'Second')));
    push(snapshot('c', 1, v2('c', 'Third')));
    render();
    tabs()[0].click();
    render();
    expect(surfaces().pickedSurfaceId).toBe('a');

    push(evicted('a', 1));
    render();
    // The most recently changed surface that remains ("c") takes over.
    expect(surfaces().activeSurfaceId).toBe('c');
    expect(surfaces().pickedSurfaceId).toBeNull();
    expect(tabs().map((tab) => tab.textContent?.trim())).toEqual([
      'Second',
      'Third',
    ]);

    // The pick is gone with its surface: a new agent surface activates.
    push(snapshot('d', 1, v2('d', 'Fourth')));
    render();
    expect(surfaces().activeSurfaceId).toBe('d');
  });

  it('with no manual pick, a new agent surface activates but an agent update to another surface does not', () => {
    configure();
    push(snapshot('a', 1, v2('a', 'First')));
    push(snapshot('b', 1, v2('b', 'Second')));
    render();
    expect(surfaces().pickedSurfaceId).toBeNull();
    expect(surfaces().activeSurfaceId).toBe('b');

    push(snapshot('a', 2, v2('a', 'First, rebuilt')));
    render();
    expect(surfaces().activeSurfaceId).toBe('b');

    push(snapshot('c', 1, v2('c', 'Third')));
    render();
    expect(surfaces().activeSurfaceId).toBe('c');
    expect(tabs()[2].getAttribute('aria-selected')).toBe('true');
  });

  it('moves between tabs with the arrow keys, Home and End', () => {
    configure();
    push(snapshot('a', 1, v2('a', 'First')));
    push(snapshot('b', 1, v2('b', 'Second')));
    push(snapshot('c', 1, v2('c', 'Third')));
    const element = render();
    document.body.appendChild(element);
    try {
      const list = element.querySelector('[role="tablist"]') as HTMLElement;
      const key = (value: string) =>
        list.dispatchEvent(
          new KeyboardEvent('keydown', { key: value, bubbles: true }),
        );
      key('ArrowRight');
      render();
      expect(surfaces().activeSurfaceId).toBe('a');
      expect(document.activeElement).toBe(tabs()[0]);
      key('ArrowLeft');
      render();
      expect(surfaces().activeSurfaceId).toBe('c');
      key('Home');
      render();
      expect(surfaces().activeSurfaceId).toBe('a');
      key('End');
      render();
      expect(surfaces().activeSurfaceId).toBe('c');
    } finally {
      element.remove();
    }
  });

  it('shows the eviction notice as role="status", latest eviction only', () => {
    configure();
    push(snapshot('a', 1, v2('a', 'First')));
    push(snapshot('b', 1, v2('b', 'Second')));
    push(evicted('a', 1));
    let element = render();
    let notices = element.querySelectorAll('[data-testid="apps-notice"]');
    expect(notices).toHaveLength(1);
    expect(notices[0].getAttribute('role')).toBe('status');
    expect(notices[0].textContent?.trim()).toBe(APPS_EVICTED_NOTICE);
    expect(element.querySelector('ptah-surface-renderer')).not.toBeNull();

    // A second eviction replaces the first notice (single slot, latest wins),
    // and the empty state stays hidden behind it.
    push(evicted('b', 1));
    element = render();
    notices = element.querySelectorAll('[data-testid="apps-notice"]');
    expect(notices).toHaveLength(1);
    expect(notices[0].textContent?.trim()).toBe(APPS_EVICTED_NOTICE);
    expect(element.querySelector('[data-testid="apps-empty"]')).toBeNull();

    // The agent rebuilds "b": its notice clears.
    push(snapshot('b', 2, v2('b', 'Second')));
    element = render();
    expect(
      element.querySelectorAll('[data-testid="apps-notice"]'),
    ).toHaveLength(0);
  });

  it('shows the sync notice as role="status" text', () => {
    configure();
    push(snapshot('a', 1, v2('a', 'First')));
    syncNotice.set('Could not refresh this app.');
    const element = render();
    const notice = element.querySelector('[data-testid="apps-notice"]');
    expect(notice?.getAttribute('role')).toBe('status');
    expect(notice?.textContent?.trim()).toBe('Could not refresh this app.');
  });

  it('shows a rejected document as the mono fallback with its reason and no renderer', () => {
    configure();
    push(snapshot('a', 1, { contract: 'dashboard-spec/9' }));
    const element = render();
    const fallback = element.querySelector('[data-testid="apps-fallback"] pre');
    expect(fallback?.classList.contains('font-mono')).toBe(true);
    expect(fallback?.textContent).toBe(
      `${APPS_UNSHOWN_TEXT}\nReason: surface content names an unknown contract.`,
    );
    expect(element.querySelector('ptah-surface-renderer')).toBeNull();
    // Color on the icon and spine only; the text is plain base-content.
    expect(fallback?.classList.contains('text-base-content')).toBe(true);
    expect(fallback?.className).not.toMatch(/text-(error|warning)/);
  });

  it('shows renderDashboardSpecText for a v1 document the renderer could not draw', async () => {
    configure(() => ({ renderFailed: true }));
    const spec = makeDashboardSpec();
    push(snapshot('a', 1, { contract: 'dashboard-spec/1', spec }));
    render();
    await fixture.whenStable();
    const element = render();
    expect(element.querySelector('ptah-surface-renderer')).toBeNull();
    const text =
      element.querySelector('[data-testid="apps-fallback"] pre')?.textContent ??
      '';
    expect(text.startsWith(APPS_UNSHOWN_TEXT)).toBe(true);
    expect(text.endsWith(renderDashboardSpecText(spec))).toBe(true);
  });

  it('keeps each failed surface on its fallback when switching between two failed surfaces, with no rebuild', async () => {
    const builder = jest.fn(() => ({ renderFailed: true }));
    configure(builder);
    push(snapshot('a', 1, v2('a', 'First')));
    push(snapshot('b', 1, v2('b', 'Second')));
    render();
    await fixture.whenStable();
    let element = render();
    const fallbackText = () =>
      element.querySelector('[data-testid="apps-fallback"] pre')?.textContent ??
      '';
    // "b" is active: its build failed once and its fallback shows.
    expect(builder).toHaveBeenCalledTimes(1);
    expect(element.querySelector('ptah-surface-renderer')).toBeNull();
    expect(fallbackText()).toContain('Second');

    tabs()[0].click();
    render();
    await fixture.whenStable();
    element = render();
    expect(builder).toHaveBeenCalledTimes(2);
    expect(element.querySelector('ptah-surface-renderer')).toBeNull();
    expect(fallbackText()).toContain('First');

    // Switching back and forth reuses each surface's recorded failure.
    for (const [index, title] of [
      [1, 'Second'],
      [0, 'First'],
      [1, 'Second'],
    ] as const) {
      tabs()[index].click();
      render();
      await fixture.whenStable();
      element = render();
      expect(element.querySelector('ptah-surface-renderer')).toBeNull();
      expect(fallbackText().startsWith(APPS_UNSHOWN_TEXT)).toBe(true);
      expect(fallbackText()).toContain(title);
    }
    expect(builder).toHaveBeenCalledTimes(2);

    // A new renderable of "b" retries its build.
    push(snapshot('b', 2, v2('b', 'Second, rebuilt'), 'ui'));
    render();
    await fixture.whenStable();
    render();
    expect(builder).toHaveBeenCalledTimes(3);
  });

  it('stores the emitted view state of the shown surface verbatim', () => {
    configure();
    push(snapshot('a', 1, v2('a', 'First')));
    const element = render();
    expect(element.querySelector('ptah-surface-renderer')).not.toBeNull();
    const renderer = fixture.debugElement.query(
      (debug) => debug.componentInstance instanceof SurfaceRendererComponent,
    ).componentInstance as SurfaceRendererComponent;
    renderer.writeComponentState({
      componentId: 'slowest-tests',
      state: { page: 0, filter: 'x' },
    });
    const emitted = setViewState.mock.calls[0][1] as SurfaceViewState;
    expect(setViewState).toHaveBeenCalledWith('a', emitted);
    expect(surfaces().entries.get('a')?.viewState).toBe(emitted);
    render();
    expect(renderer.viewState()).toBe(emitted);
  });

  describe('readLastSubmit', () => {
    it('shows a well-formed record and hides malformed ones', () => {
      expect(readLastSubmit({ status: 'applied', submittedAt: 5 })).toEqual({
        status: 'applied',
        submittedAt: 5,
      });
      for (const bad of [
        null,
        'applied',
        [],
        { status: 'applied' },
        { status: 'sent', submittedAt: 5 },
        { status: 'applied', submittedAt: Number.NaN },
        { status: 'applied', submittedAt: -1 },
        { status: 'indeterminate', submittedAt: '5' },
        // Finite but past the Date range: DatePipe would print "NaN:NaN".
        { status: 'applied', submittedAt: Number.MAX_VALUE },
        { status: 'applied', submittedAt: 8_640_000_000_000_001 },
      ]) {
        expect(readLastSubmit(bad)).toBeNull();
      }
      // The last valid Date is still shown.
      expect(
        readLastSubmit({
          status: 'applied',
          submittedAt: 8_640_000_000_000_000,
        }),
      ).toEqual({ status: 'applied', submittedAt: 8_640_000_000_000_000 });
    });

    it('omits the line for a finite submittedAt outside the Date range', () => {
      configure();
      push(
        snapshot('a', 1, v2('a', 'First'), 'agent', {
          status: 'applied',
          submittedAt: Number.MAX_VALUE,
        }),
      );
      const element = render();
      expect(
        element.querySelector('[data-testid="apps-last-submit"]'),
      ).toBeNull();
      expect(element.textContent).not.toContain('NaN');
    });

    it('renders only a validated lastSubmit', () => {
      configure();
      push(
        snapshot('a', 1, v2('a', 'First'), 'agent', {
          status: 'indeterminate',
          submittedAt: Date.UTC(2026, 8, 25, 10, 30),
        }),
      );
      let element = render();
      expect(
        element.querySelector('[data-testid="apps-last-submit"]')?.textContent,
      ).toContain('may have been sent');

      push(
        snapshot('a', 2, v2('a', 'First'), 'agent', {
          status: 'applied',
          submittedAt: 'yesterday',
        }),
      );
      element = render();
      expect(
        element.querySelector('[data-testid="apps-last-submit"]'),
      ).toBeNull();
    });
  });
});
