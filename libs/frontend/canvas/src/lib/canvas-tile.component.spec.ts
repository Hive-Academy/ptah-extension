/**
 * Unit tests for CanvasTileComponent freeze-at-creation effort effect.
 */

import {
  Component,
  Input,
  NgModule,
  ChangeDetectionStrategy,
} from '@angular/core';
jest.mock('ngx-markdown', () => {
  @Component({
    // eslint-disable-next-line @angular-eslint/component-selector
    selector: 'markdown',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `<div data-test="markdown-stub">{{ data }}</div>`,
  })
  class MarkdownStubComponent {
    @Input() data: string | null | undefined = '';
  }

  @NgModule({
    imports: [MarkdownStubComponent],
    exports: [MarkdownStubComponent],
  })
  class MarkdownModule {}

  return {
    MarkdownModule,
    MarkdownComponent: MarkdownStubComponent,
    provideMarkdown: () => [],
    MARKED_OPTIONS: 'MARKED_OPTIONS',
    CLIPBOARD_OPTIONS: 'CLIPBOARD_OPTIONS',
    MARKED_EXTENSIONS: 'MARKED_EXTENSIONS',
    MERMAID_OPTIONS: 'MERMAID_OPTIONS',
    SANITIZE: 'SANITIZE',
  };
});

import { TestBed } from '@angular/core/testing';
import { inject, signal } from '@angular/core';
import { SurfaceMarkdownPipe } from '@ptah-extension/markdown';
import { CanvasTileComponent } from './canvas-tile.component';
import {
  SendToMessagingComponent,
  TabManagerService,
} from '@ptah-extension/chat';
import {
  EffortStateService,
  ModelStateService,
  SURFACE_ACTIVE,
} from '@ptah-extension/core';

/** Canvas surface activity seen through the tile's element chain. */
const canvasActive = signal(true);
import { TileAgentIndicatorComponent } from './tile-agent-indicator.component';
import { TileAgentMiniPanelComponent } from './tile-agent-mini-panel.component';

@Component({
  selector: 'ptah-test-chat-view',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '',
})
class ChatViewStub {}

@Component({
  selector: 'ptah-tile-agent-indicator',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '',
})
class TileAgentIndicatorStub {
  @Input() tabId = '';
}

@Component({
  selector: 'ptah-tile-agent-mini-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '',
})
class TileAgentMiniPanelStub {
  @Input() agents: readonly unknown[] = [];
}

@Component({
  selector: 'ptah-send-to-messaging',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '',
})
class SendToMessagingStub {
  @Input() tabId = '';
}

describe('CanvasTileComponent freeze-at-creation effort', () => {
  const mockEffortState = {
    currentEffort: signal<string | undefined>('high'),
    isLoaded: signal(true),
    setEffort: jest.fn().mockResolvedValue(undefined),
  };

  const mockModelState = {
    currentModel: signal<string>('claude-sonnet-4-20250514'),
    isLoaded: signal(true),
  };

  const mockTabManager = {
    onTabClosed: jest.fn(() => () => undefined),
    tabs: signal<
      Array<{
        id: string;
        claudeSessionId: string | null;
        overrideEffort?: unknown;
        overrideModel?: unknown;
      }>
    >([]),
    setOverrideEffort: jest.fn(),
    setOverrideModel: jest.fn(),
    getTabViewMode: jest.fn().mockReturnValue('full'),
    toggleTabViewMode: jest.fn(),
    setViewMode: jest.fn(),
    registerVisibleTab: jest.fn(),
    unregisterVisibleTab: jest.fn(),
  };

  function mountTile(tabId: string) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [CanvasTileComponent],
      providers: [
        { provide: EffortStateService, useValue: mockEffortState },
        { provide: ModelStateService, useValue: mockModelState },
        { provide: TabManagerService, useValue: mockTabManager },
        { provide: SURFACE_ACTIVE, useValue: canvasActive },
      ],
    });
    TestBed.overrideComponent(CanvasTileComponent, {
      set: { template: '', imports: [] },
    });
    const fixture = TestBed.createComponent(CanvasTileComponent);
    fixture.componentRef.setInput('tabId', tabId);
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockEffortState.currentEffort.set('high');
    mockEffortState.isLoaded.set(true);
    mockModelState.currentModel.set('claude-sonnet-4-20250514');
    mockModelState.isLoaded.set(true);
    mockTabManager.tabs.set([]);
  });

  it('snapshots the global default into the tab override when none is set', () => {
    mockEffortState.currentEffort.set('medium');
    mockTabManager.tabs.set([
      { id: 'tab-1', claudeSessionId: 'sess-1', overrideEffort: undefined },
    ]);

    mountTile('tab-1');

    expect(mockTabManager.setOverrideEffort).toHaveBeenCalledWith(
      'tab-1',
      'medium',
    );
  });

  it('freezes to null when the global effort is undefined (SDK default)', () => {
    mockEffortState.currentEffort.set(undefined);
    mockTabManager.tabs.set([
      { id: 'tab-1', claudeSessionId: 'sess-1', overrideEffort: undefined },
    ]);

    mountTile('tab-1');

    expect(mockTabManager.setOverrideEffort).toHaveBeenCalledWith(
      'tab-1',
      null,
    );
  });

  it('does NOT overwrite an existing override', () => {
    mockTabManager.tabs.set([
      { id: 'tab-1', claudeSessionId: 'sess-1', overrideEffort: 'high' },
    ]);

    mountTile('tab-1');

    expect(mockTabManager.setOverrideEffort).not.toHaveBeenCalled();
  });

  it('does nothing while isLoaded() is false, then snapshots once it flips true', () => {
    mockEffortState.isLoaded.set(false);
    mockEffortState.currentEffort.set('low');
    mockTabManager.tabs.set([
      { id: 'tab-1', claudeSessionId: 'sess-1', overrideEffort: undefined },
    ]);

    const fixture = mountTile('tab-1');

    expect(mockTabManager.setOverrideEffort).not.toHaveBeenCalled();

    mockEffortState.isLoaded.set(true);
    fixture.detectChanges();

    expect(mockTabManager.setOverrideEffort).toHaveBeenCalledWith(
      'tab-1',
      'low',
    );
  });

  it('makes a fresh tile inherit the last picked effort', () => {
    mockEffortState.currentEffort.set('xhigh');
    mockTabManager.tabs.set([
      { id: 'tab-new', claudeSessionId: null, overrideEffort: undefined },
    ]);

    mountTile('tab-new');

    expect(mockTabManager.setOverrideEffort).toHaveBeenCalledWith(
      'tab-new',
      'xhigh',
    );
  });
});

describe('CanvasTileComponent freeze-at-creation model', () => {
  const mockEffortState = {
    currentEffort: signal<string | undefined>('high'),
    isLoaded: signal(true),
    setEffort: jest.fn().mockResolvedValue(undefined),
  };

  const mockModelState = {
    currentModel: signal<string>('claude-sonnet-4-20250514'),
    isLoaded: signal(true),
  };

  const mockTabManager = {
    onTabClosed: jest.fn(() => () => undefined),
    tabs: signal<
      Array<{
        id: string;
        claudeSessionId: string | null;
        overrideEffort?: unknown;
        overrideModel?: unknown;
      }>
    >([]),
    setOverrideEffort: jest.fn(),
    setOverrideModel: jest.fn(),
    getTabViewMode: jest.fn().mockReturnValue('full'),
    toggleTabViewMode: jest.fn(),
    setViewMode: jest.fn(),
    registerVisibleTab: jest.fn(),
    unregisterVisibleTab: jest.fn(),
  };

  function mountTile(tabId: string) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [CanvasTileComponent],
      providers: [
        { provide: EffortStateService, useValue: mockEffortState },
        { provide: ModelStateService, useValue: mockModelState },
        { provide: TabManagerService, useValue: mockTabManager },
        { provide: SURFACE_ACTIVE, useValue: canvasActive },
      ],
    });
    TestBed.overrideComponent(CanvasTileComponent, {
      set: { template: '', imports: [] },
    });
    const fixture = TestBed.createComponent(CanvasTileComponent);
    fixture.componentRef.setInput('tabId', tabId);
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockEffortState.currentEffort.set('high');
    mockEffortState.isLoaded.set(true);
    mockModelState.currentModel.set('claude-sonnet-4-20250514');
    mockModelState.isLoaded.set(true);
    mockTabManager.tabs.set([]);
  });

  it('snapshots the global model into the tab override when none is set', () => {
    mockModelState.currentModel.set('claude-opus-4-20250514');
    mockTabManager.tabs.set([
      {
        id: 'tab-1',
        claudeSessionId: 'sess-1',
        overrideEffort: 'high',
        overrideModel: undefined,
      },
    ]);

    mountTile('tab-1');

    expect(mockTabManager.setOverrideModel).toHaveBeenCalledWith(
      'tab-1',
      'claude-opus-4-20250514',
    );
  });

  it('does NOT overwrite an existing model override', () => {
    mockTabManager.tabs.set([
      {
        id: 'tab-1',
        claudeSessionId: 'sess-1',
        overrideEffort: 'high',
        overrideModel: 'claude-opus-4-20250514',
      },
    ]);

    mountTile('tab-1');

    expect(mockTabManager.setOverrideModel).not.toHaveBeenCalled();
  });

  it('does NOT snapshot when the global currentModel is empty (still loading)', () => {
    mockModelState.currentModel.set('');
    mockTabManager.tabs.set([
      {
        id: 'tab-1',
        claudeSessionId: 'sess-1',
        overrideEffort: 'high',
        overrideModel: undefined,
      },
    ]);

    mountTile('tab-1');

    expect(mockTabManager.setOverrideModel).not.toHaveBeenCalled();
  });

  it('waits for modelState.isLoaded() before snapshotting', () => {
    mockModelState.isLoaded.set(false);
    mockModelState.currentModel.set('claude-sonnet-4-20250514');
    mockTabManager.tabs.set([
      {
        id: 'tab-1',
        claudeSessionId: 'sess-1',
        overrideEffort: 'high',
        overrideModel: undefined,
      },
    ]);

    const fixture = mountTile('tab-1');

    expect(mockTabManager.setOverrideModel).not.toHaveBeenCalled();

    mockModelState.isLoaded.set(true);
    fixture.detectChanges();

    expect(mockTabManager.setOverrideModel).toHaveBeenCalledWith(
      'tab-1',
      'claude-sonnet-4-20250514',
    );
  });
});

describe('CanvasTileComponent visibility-driven streaming registration', () => {
  const mockEffortState = {
    currentEffort: signal<string | undefined>('high'),
    isLoaded: signal(true),
    setEffort: jest.fn().mockResolvedValue(undefined),
  };

  const mockModelState = {
    currentModel: signal<string>('claude-sonnet-4-20250514'),
    isLoaded: signal(true),
  };

  const mockTabManager = {
    onTabClosed: jest.fn(() => () => undefined),
    tabs: signal<Array<{ id: string; claudeSessionId: string | null }>>([]),
    setOverrideEffort: jest.fn(),
    setOverrideModel: jest.fn(),
    getTabViewMode: jest.fn().mockReturnValue('full'),
    toggleTabViewMode: jest.fn(),
    setViewMode: jest.fn(),
    registerVisibleTab: jest.fn(),
    unregisterVisibleTab: jest.fn(),
  };

  function mountTile(tabId: string, visible: boolean) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [CanvasTileComponent],
      providers: [
        { provide: EffortStateService, useValue: mockEffortState },
        { provide: ModelStateService, useValue: mockModelState },
        { provide: TabManagerService, useValue: mockTabManager },
        { provide: SURFACE_ACTIVE, useValue: canvasActive },
      ],
    });
    TestBed.overrideComponent(CanvasTileComponent, {
      set: { template: '', imports: [] },
    });
    const fixture = TestBed.createComponent(CanvasTileComponent);
    fixture.componentRef.setInput('tabId', tabId);
    fixture.componentRef.setInput('visible', visible);
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockTabManager.tabs.set([]);
  });

  it('registers the tab as visible when mounted visible', () => {
    mountTile('tab-1', true);

    expect(mockTabManager.registerVisibleTab).toHaveBeenCalledWith('tab-1');
  });

  it('does NOT register while hidden, then registers when it becomes visible', () => {
    const fixture = mountTile('tab-1', false);

    expect(mockTabManager.registerVisibleTab).not.toHaveBeenCalled();

    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();

    expect(mockTabManager.registerVisibleTab).toHaveBeenCalledWith('tab-1');
  });

  it('unregisters when it becomes hidden (not tied to lifecycle)', () => {
    const fixture = mountTile('tab-1', true);
    mockTabManager.unregisterVisibleTab.mockClear();

    fixture.componentRef.setInput('visible', false);
    fixture.detectChanges();

    expect(mockTabManager.unregisterVisibleTab).toHaveBeenCalledWith('tab-1');
  });

  it('still unregisters on destroy', () => {
    const fixture = mountTile('tab-1', true);
    mockTabManager.unregisterVisibleTab.mockClear();

    fixture.destroy();

    expect(mockTabManager.unregisterVisibleTab).toHaveBeenCalledWith('tab-1');
  });
});

describe('CanvasTileComponent layout menu contract', () => {
  const tabManager = {
    onTabClosed: jest.fn(() => () => undefined),
    tabs: signal([{ id: 'tile-1', title: 'Alpha', name: 'Alpha' }]),
    setOverrideEffort: jest.fn(),
    setOverrideModel: jest.fn(),
    getTabViewMode: jest.fn(() => 'full'),
    toggleTabViewMode: jest.fn(),
    setViewMode: jest.fn(),
    // Signal-backed so stepper clicks re-render like the real service.
    getTabCompactHeightUnits: jest.fn(() => storedHeight()),
    setCompactHeight: jest.fn((_tabId: string, units: number) =>
      storedHeight.set(units),
    ),
    registerVisibleTab: jest.fn(),
    unregisterVisibleTab: jest.fn(),
  };
  const storedHeight = signal<number | undefined>(undefined);
  const effort = {
    currentEffort: signal<string | null>(null),
    isLoaded: signal(false),
  };
  const model = { currentModel: signal(''), isLoaded: signal(false) };

  beforeEach(() => {
    jest.clearAllMocks();
    storedHeight.set(undefined);
  });

  afterEach(() => {
    tabManager.getTabViewMode.mockReturnValue('full');
  });

  function setup(locked = false) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [CanvasTileComponent],
      providers: [
        { provide: TabManagerService, useValue: tabManager },
        { provide: SURFACE_ACTIVE, useValue: canvasActive },
        { provide: EffortStateService, useValue: effort },
        { provide: ModelStateService, useValue: model },
      ],
    });
    TestBed.overrideComponent(CanvasTileComponent, {
      remove: {
        imports: [
          TileAgentIndicatorComponent,
          TileAgentMiniPanelComponent,
          SendToMessagingComponent,
        ],
      },
      add: {
        imports: [
          TileAgentIndicatorStub,
          TileAgentMiniPanelStub,
          SendToMessagingStub,
        ],
      },
    });
    const fixture = TestBed.createComponent(CanvasTileComponent);
    (
      fixture.componentInstance as unknown as {
        chatViewComponent: typeof ChatViewStub;
      }
    ).chatViewComponent = ChatViewStub;
    fixture.componentRef.setInput('tabId', 'tile-1');
    fixture.componentRef.setInput('widthIntent', {
      kind: 'span',
      span: 'half',
    });
    fixture.componentRef.setInput('layoutLocked', locked);
    fixture.detectChanges();
    return fixture;
  }

  /** Mount a compact tile at a stored height (`undefined` = none stored). */
  function setupCompact(units: number | undefined, locked = false) {
    tabManager.getTabViewMode.mockReturnValue('compact');
    storedHeight.set(units);
    return setup(locked);
  }

  function openMenu(fixture: ReturnType<typeof setup>): void {
    fixture.nativeElement
      .querySelector('[data-testid="tile-layout-trigger"]')
      .click();
    fixture.detectChanges();
  }

  function heightPresets(
    fixture: ReturnType<typeof setup>,
  ): HTMLButtonElement[] {
    return Array.from(
      fixture.nativeElement.querySelectorAll('[data-view-mode]'),
    ) as HTMLButtonElement[];
  }

  it('exposes trigger/menu ARIA and four stored-span radio choices', () => {
    const fixture = setup();
    const trigger = fixture.nativeElement.querySelector(
      '[data-testid="tile-layout-trigger"]',
    );
    expect(trigger.getAttribute('aria-label')).toBe('Layout options for Alpha');
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    trigger.click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="menu"]')).not.toBeNull();
    const radios = [
      ...fixture.nativeElement.querySelectorAll('[data-span]'),
    ] as HTMLButtonElement[];
    expect(radios.map((button) => button.dataset['span'])).toEqual([
      'third',
      'half',
      'two-thirds',
      'full',
    ]);
    expect(radios.map((button) => button.getAttribute('aria-label'))).toEqual([
      'Set tile width to one third',
      'Set tile width to one half',
      'Set tile width to two thirds',
      'Set tile width to full',
    ]);
    expect(radios.map((button) => button.getAttribute('aria-checked'))).toEqual(
      ['false', 'true', 'false', 'false'],
    );
    expect(
      fixture.nativeElement
        .querySelector('[data-layout-action="focus"]')
        .getAttribute('aria-label'),
    ).toBe('Focus tile at full width');
    expect(
      fixture.nativeElement
        .querySelector('[data-layout-action="row"]')
        .getAttribute('aria-label'),
    ).toBe('Start a new row before this tile');
  });

  it('emits span, focus and row actions and closes after selection', () => {
    const fixture = setup();
    const span = jest.fn();
    const focus = jest.fn();
    const row = jest.fn();
    fixture.componentInstance.spanRequested.subscribe(span);
    fixture.componentInstance.layoutFocusToggled.subscribe(focus);
    fixture.componentInstance.rowBreakToggled.subscribe(row);
    const open = (): void => {
      fixture.nativeElement
        .querySelector('[data-testid="tile-layout-trigger"]')
        .click();
      fixture.detectChanges();
    };
    open();
    (
      fixture.nativeElement.querySelectorAll(
        '[data-span]',
      )[2] as HTMLButtonElement
    ).click();
    expect(span).toHaveBeenCalledWith('two-thirds');
    open();
    (
      fixture.nativeElement.querySelector(
        '[aria-label="Focus tile at full width"]',
      ) as HTMLButtonElement
    ).click();
    expect(focus).toHaveBeenCalledTimes(1);
    open();
    (
      fixture.nativeElement.querySelector(
        '[aria-label="Start a new row before this tile"]',
      ) as HTMLButtonElement
    ).click();
    expect(row).toHaveBeenCalledTimes(1);
  });

  it('cycles enabled items with arrows/Home/End and disables layout actions when locked', () => {
    const fixture = setup();
    fixture.nativeElement
      .querySelector('[data-testid="tile-layout-trigger"]')
      .click();
    fixture.detectChanges();
    const items = [
      ...fixture.nativeElement.querySelectorAll('[data-layout-item]'),
    ] as HTMLButtonElement[];
    items[1].focus();
    items[1].dispatchEvent(
      new KeyboardEvent('keydown', { key: 'End', bubbles: true }),
    );
    expect(document.activeElement).toBe(items.at(-1));
    items
      .at(-1)
      ?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
      );
    expect(document.activeElement).toBe(items[0]);

    const locked = setup(true);
    locked.nativeElement
      .querySelector('[data-testid="tile-layout-trigger"]')
      .click();
    locked.detectChanges();
    expect(
      [
        ...locked.nativeElement.querySelectorAll(
          '[data-layout-item]:not([data-view-mode])',
        ),
      ].every((item) => (item as HTMLButtonElement).disabled),
    ).toBe(true);
  });

  it('keeps the view-mode toggle enabled under layout lock', () => {
    const locked = setup(true);
    const toggle = locked.nativeElement.querySelector(
      '[data-testid="tile-view-mode-toggle"]',
    ) as HTMLButtonElement;
    expect(toggle).not.toBeNull();
    expect(toggle.disabled).toBe(false);
    toggle.click();
    expect(tabManager.toggleTabViewMode).toHaveBeenCalledWith('tile-1');
  });

  it.each([
    [
      'full',
      () =>
        expect(tabManager.setViewMode).toHaveBeenCalledWith('tile-1', 'full'),
    ],
    [
      'compact',
      () =>
        expect(tabManager.setCompactHeight).toHaveBeenCalledWith('tile-1', 2),
    ],
    [
      'tall',
      () =>
        expect(tabManager.setCompactHeight).toHaveBeenCalledWith('tile-1', 3),
    ],
  ] as const)(
    'applies the %s height preset directly from the menu even while locked',
    (preset, expectWrite) => {
      const fixture = setup(true);
      const focus = jest.fn();
      fixture.componentInstance.focusRequested.subscribe(focus);
      openMenu(fixture);
      const choices = heightPresets(fixture);
      expect(choices.map((choice) => choice.textContent?.trim())).toEqual([
        'Full',
        'Compact',
        'Tall',
      ]);
      expect(
        choices.map((choice) => choice.getAttribute('aria-label')),
      ).toEqual([
        'Set tile height to Full',
        'Set tile height to Compact',
        'Set tile height to Compact tall',
      ]);
      expect(
        choices.map((choice) => choice.getAttribute('aria-checked')),
      ).toEqual(['true', 'false', 'false']);
      expect(choices.every((choice) => !choice.disabled)).toBe(true);
      choices.find((button) => button.dataset['viewMode'] === preset)?.click();
      expectWrite();
      expect(fixture.componentInstance.layoutMenuOpen()).toBe(false);
      expect(focus).not.toHaveBeenCalled();
    },
  );

  it('includes height choices in keyboard navigation under layout lock', () => {
    const fixture = setup(true);
    openMenu(fixture);
    const choices = heightPresets(fixture);
    choices[0].focus();
    choices[0].dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }),
    );
    expect(document.activeElement).toBe(choices[2]);
    choices[2].dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Home', bubbles: true }),
    );
    expect(document.activeElement).toBe(choices[0]);
  });

  it('labels the view-mode toggle from the current view mode', () => {
    const full = setup();
    expect(
      full.nativeElement
        .querySelector('[data-testid="tile-view-mode-toggle"]')
        .getAttribute('aria-label'),
    ).toBe('Switch to compact view');

    // Every compact height advertises the SAME return trip, because the
    // one-click affordance is binary. Picking a height belongs to the menu.
    for (const units of [2, 4]) {
      const compact = setupCompact(units);
      expect(compact.componentInstance.isCompactMode()).toBe(true);
      expect(
        compact.nativeElement
          .querySelector('[data-testid="tile-view-mode-toggle"]')
          .getAttribute('aria-label'),
      ).toBe('Switch to full view');
    }
  });

  describe('height stepper', () => {
    const stepper = (fixture: ReturnType<typeof setup>) => ({
      decrease: fixture.nativeElement.querySelector(
        '[data-height-step="decrease"]',
      ) as HTMLButtonElement | null,
      increase: fixture.nativeElement.querySelector(
        '[data-height-step="increase"]',
      ) as HTMLButtonElement | null,
      value: (
        fixture.nativeElement.querySelector(
          '[data-testid="tile-height-units"]',
        ) as HTMLElement | null
      )?.textContent?.trim(),
    });

    it('appears only for a compact tile, labelled, with the current height visible', () => {
      const full = setup();
      openMenu(full);
      expect(stepper(full).increase).toBeNull();
      expect(stepper(full).decrease).toBeNull();

      const compact = setupCompact(3);
      openMenu(compact);
      const { decrease, increase, value } = stepper(compact);
      expect(decrease?.getAttribute('aria-label')).toBe('Decrease tile height');
      expect(increase?.getAttribute('aria-label')).toBe('Increase tile height');
      expect(decrease?.hasAttribute('data-layout-item')).toBe(true);
      expect(increase?.hasAttribute('data-layout-item')).toBe(true);
      expect(value).toBe('3 rows');
    });

    it('shows the default two rows when no height is stored', () => {
      const compact = setupCompact(undefined);
      openMenu(compact);
      expect(stepper(compact).value).toBe('2 rows');
      expect(stepper(compact).decrease?.disabled).toBe(true);
    });

    it('steps one row at a time, keeps the menu open and disables at 2 and 5', () => {
      const fixture = setupCompact(2);
      openMenu(fixture);
      expect(stepper(fixture).decrease?.disabled).toBe(true);
      expect(stepper(fixture).increase?.disabled).toBe(false);

      stepper(fixture).increase?.click();
      fixture.detectChanges();
      expect(tabManager.setCompactHeight).toHaveBeenLastCalledWith('tile-1', 3);
      expect(fixture.componentInstance.layoutMenuOpen()).toBe(true);
      expect(stepper(fixture).value).toBe('3 rows');

      stepper(fixture).increase?.click();
      stepper(fixture).increase?.click();
      fixture.detectChanges();
      expect(stepper(fixture).value).toBe('5 rows');
      expect(stepper(fixture).increase?.disabled).toBe(true);
      expect(stepper(fixture).decrease?.disabled).toBe(false);

      stepper(fixture).decrease?.click();
      fixture.detectChanges();
      expect(tabManager.setCompactHeight).toHaveBeenLastCalledWith('tile-1', 4);
      expect(stepper(fixture).value).toBe('4 rows');
      expect(tabManager.setCompactHeight).toHaveBeenCalledTimes(4);
    });

    it('clamps a stored height above the maximum and never writes past it', () => {
      const fixture = setupCompact(9);
      openMenu(fixture);
      expect(stepper(fixture).value).toBe('5 rows');
      expect(stepper(fixture).increase?.disabled).toBe(true);
      stepper(fixture).decrease?.click();
      expect(tabManager.setCompactHeight).toHaveBeenCalledWith('tile-1', 4);
    });

    it('moves focus off a step button that just reached its bound', () => {
      const fixture = setupCompact(4);
      openMenu(fixture);
      const { increase, decrease } = stepper(fixture);
      increase?.focus();
      increase?.click();
      fixture.detectChanges();
      expect(increase?.disabled).toBe(true);
      expect(document.activeElement).toBe(decrease);
    });

    it('stays enabled under layout lock beside the disabled geometry items', () => {
      const fixture = setupCompact(3, true);
      openMenu(fixture);
      const { decrease, increase } = stepper(fixture);
      expect(decrease?.disabled).toBe(false);
      expect(increase?.disabled).toBe(false);
      expect(heightPresets(fixture).every((choice) => !choice.disabled)).toBe(
        true,
      );
      const spans = Array.from(
        fixture.nativeElement.querySelectorAll('[data-span]'),
      ) as HTMLButtonElement[];
      expect(spans.every((button) => button.disabled)).toBe(true);

      increase?.click();
      expect(tabManager.setCompactHeight).toHaveBeenCalledWith('tile-1', 4);
    });

    it('is reachable with Up/Down under lock and keeps Left/Right inside its row', () => {
      const fixture = setupCompact(3, true);
      openMenu(fixture);
      const { decrease, increase } = stepper(fixture);
      const presets = heightPresets(fixture);
      presets[2].focus();
      presets[2].dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
      );
      expect(document.activeElement).toBe(decrease);
      decrease?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
      );
      expect(document.activeElement).toBe(increase);
      increase?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
      );
      expect(document.activeElement).toBe(decrease);
    });

    it.each([
      [2, 'compact'],
      [3, 'tall'],
      [4, null],
      [5, null],
    ] as const)('at %i rows checks the %s preset only', (units, checked) => {
      const fixture = setupCompact(units);
      openMenu(fixture);
      const presets = heightPresets(fixture);
      expect(
        presets
          .filter((button) => button.getAttribute('aria-checked') === 'true')
          .map((button) => button.dataset['viewMode']),
      ).toEqual(checked ? [checked] : []);
      expect(
        presets
          .filter((button) => button.classList.contains('btn-primary'))
          .map((button) => button.dataset['viewMode']),
      ).toEqual(checked ? [checked] : []);
    });
  });

  it('toggles the view mode once per click and swallows every pointer start', () => {
    const fixture = setup();
    const toggle = fixture.nativeElement.querySelector(
      '[data-testid="tile-view-mode-toggle"]',
    ) as HTMLButtonElement;
    const focus = jest.fn();
    fixture.componentInstance.focusRequested.subscribe(focus);
    const arrivals: string[] = [];
    for (const type of ['mousedown', 'pointerdown', 'touchstart']) {
      fixture.nativeElement.addEventListener(type, () => arrivals.push(type));
    }
    toggle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    toggle.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    toggle.dispatchEvent(new Event('touchstart', { bubbles: true }));
    expect(arrivals).toEqual([]);

    toggle.click();
    expect(tabManager.toggleTabViewMode).toHaveBeenCalledTimes(1);
    expect(tabManager.toggleTabViewMode).toHaveBeenCalledWith('tile-1');
    expect(focus).not.toHaveBeenCalled();
  });

  it('marks the checked span and view mode with a visible active class', () => {
    const fixture = setup();
    fixture.nativeElement
      .querySelector('[data-testid="tile-layout-trigger"]')
      .click();
    fixture.detectChanges();
    const spans = Array.from(
      fixture.nativeElement.querySelectorAll('[data-span]'),
    ) as HTMLButtonElement[];
    const activeSpans = spans.filter((button) =>
      button.classList.contains('btn-primary'),
    );
    expect(activeSpans.map((button) => button.dataset['span'])).toEqual([
      'half',
    ]);
    const heights = Array.from(
      fixture.nativeElement.querySelectorAll('[data-view-mode]'),
    ) as HTMLButtonElement[];
    const activeHeights = heights.filter((button) =>
      button.classList.contains('btn-primary'),
    );
    expect(activeHeights.map((button) => button.dataset['viewMode'])).toEqual([
      'full',
    ]);
  });

  it('navigates Left/Right within the width group and wraps at the edges', () => {
    const fixture = setup();
    fixture.nativeElement
      .querySelector('[data-testid="tile-layout-trigger"]')
      .click();
    fixture.detectChanges();
    const widths = Array.from(
      fixture.nativeElement.querySelectorAll('[data-span]'),
    ) as HTMLButtonElement[];
    widths[1].focus();
    widths[1].dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
    );
    expect(document.activeElement).toBe(widths[2]);
    widths[2].dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }),
    );
    expect(document.activeElement).toBe(widths[1]);
    // Wrap: past the last width stays inside the width group.
    widths[3].focus();
    widths[3].dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
    );
    expect(document.activeElement).toBe(widths[0]);
    // Horizontal arrows never leave the group: from the first width, Left
    // wraps to the last width instead of reaching the height section.
    widths[0].focus();
    widths[0].dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }),
    );
    expect(document.activeElement).toBe(widths[3]);
  });

  it('shows the Layout locked hint instead of silently disabled width buttons', () => {
    const unlocked = setup();
    unlocked.nativeElement
      .querySelector('[data-testid="tile-layout-trigger"]')
      .click();
    unlocked.detectChanges();
    expect(
      unlocked.nativeElement.querySelector(
        '[data-testid="layout-locked-hint"]',
      ),
    ).toBeNull();

    const locked = setup(true);
    locked.nativeElement
      .querySelector('[data-testid="tile-layout-trigger"]')
      .click();
    locked.detectChanges();
    const hint = locked.nativeElement.querySelector(
      '[data-testid="layout-locked-hint"]',
    );
    expect(hint?.textContent?.trim()).toBe('Layout locked');
    const spans = Array.from(
      locked.nativeElement.querySelectorAll('[data-span]'),
    ) as HTMLButtonElement[];
    expect(spans.every((button) => button.disabled)).toBe(true);
    // The hint line itself is not a focusable menu item.
    expect(hint?.matches('[data-layout-item]')).toBe(false);
  });
});

describe('CanvasTileComponent SURFACE_ACTIVE for tile content', () => {
  /** Stream content the tile's store keeps ingesting while hidden. */
  const content = signal('v1');

  /** Stands in for ChatViewComponent: a SURFACE_ACTIVE consumer. */
  @Component({
    selector: 'ptah-test-surface-probe',
    standalone: true,
    imports: [SurfaceMarkdownPipe],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `<span data-test="probe">{{
      content() | surfaceMarkdown: active()
    }}</span>`,
  })
  class SurfaceProbe {
    readonly active = inject(SURFACE_ACTIVE);
    readonly content = content;
  }

  const tabManager = {
    onTabClosed: jest.fn(() => () => undefined),
    tabs: signal<Array<{ id: string; claudeSessionId: string | null }>>([]),
    setOverrideEffort: jest.fn(),
    setOverrideModel: jest.fn(),
    getTabViewMode: jest.fn().mockReturnValue('full'),
    getTabCompactHeightUnits: jest.fn().mockReturnValue(undefined),
    registerVisibleTab: jest.fn(),
    unregisterVisibleTab: jest.fn(),
  };

  afterEach(() => {
    canvasActive.set(true);
    content.set('v1');
  });

  function mount(visible: boolean) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [CanvasTileComponent],
      providers: [
        { provide: TabManagerService, useValue: tabManager },
        { provide: SURFACE_ACTIVE, useValue: canvasActive },
        {
          provide: EffortStateService,
          useValue: { currentEffort: signal(null), isLoaded: signal(false) },
        },
        {
          provide: ModelStateService,
          useValue: { currentModel: signal(''), isLoaded: signal(false) },
        },
      ],
    });
    TestBed.overrideComponent(CanvasTileComponent, {
      remove: {
        imports: [
          TileAgentIndicatorComponent,
          TileAgentMiniPanelComponent,
          SendToMessagingComponent,
        ],
      },
      add: {
        imports: [
          TileAgentIndicatorStub,
          TileAgentMiniPanelStub,
          SendToMessagingStub,
        ],
      },
    });
    const fixture = TestBed.createComponent(CanvasTileComponent);
    (
      fixture.componentInstance as unknown as {
        chatViewComponent: typeof SurfaceProbe;
      }
    ).chatViewComponent = SurfaceProbe;
    fixture.componentRef.setInput('tabId', 'tile-1');
    fixture.componentRef.setInput('visible', visible);
    fixture.detectChanges();
    return fixture;
  }

  const rendered = (
    fixture: ReturnType<typeof TestBed.createComponent<CanvasTileComponent>>,
  ): string =>
    (
      fixture.nativeElement.querySelector('[data-test="probe"]') as HTMLElement
    ).textContent?.trim() ?? '';

  const tileSurfaceActive = (
    fixture: ReturnType<typeof TestBed.createComponent<CanvasTileComponent>>,
  ): boolean => fixture.componentInstance.childInjector()!.get(SURFACE_ACTIVE)();

  it('provides canvas activity AND tile visibility to the tile content', () => {
    const fixture = mount(true);
    expect(tileSurfaceActive(fixture)).toBe(true);

    fixture.componentRef.setInput('visible', false);
    fixture.detectChanges();
    expect(tileSurfaceActive(fixture)).toBe(false);

    fixture.componentRef.setInput('visible', true);
    canvasActive.set(false);
    fixture.detectChanges();
    expect(tileSurfaceActive(fixture)).toBe(false);

    canvasActive.set(true);
    fixture.detectChanges();
    expect(tileSurfaceActive(fixture)).toBe(true);
  });

  it('pauses rendering while the workspace is hidden and catches up with the latest content when shown', () => {
    const fixture = mount(true);
    expect(rendered(fixture)).toBe('v1');

    fixture.componentRef.setInput('visible', false);
    content.set('v2');
    fixture.detectChanges();
    expect(rendered(fixture)).toBe('v1');

    content.set('v3');
    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
    expect(rendered(fixture)).toBe('v3');
  });

  it('pauses while navigated away from the canvas and catches up on return', () => {
    const fixture = mount(true);

    canvasActive.set(false);
    content.set('streamed while on settings');
    fixture.detectChanges();
    expect(rendered(fixture)).toBe('v1');

    canvasActive.set(true);
    fixture.detectChanges();
    expect(rendered(fixture)).toBe('streamed while on settings');
  });
});
