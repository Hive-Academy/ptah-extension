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
import { signal } from '@angular/core';
import { CanvasTileComponent } from './canvas-tile.component';
import { TabManagerService } from '@ptah-extension/chat';
import { EffortStateService, ModelStateService } from '@ptah-extension/core';

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
    tabs: signal<Array<{ id: string; claudeSessionId: string | null }>>([]),
    setOverrideEffort: jest.fn(),
    setOverrideModel: jest.fn(),
    getTabViewMode: jest.fn().mockReturnValue('full'),
    toggleTabViewMode: jest.fn(),
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
    tabs: signal([{ id: 'tile-1', title: 'Alpha', name: 'Alpha' }]),
    setOverrideEffort: jest.fn(),
    setOverrideModel: jest.fn(),
    getTabViewMode: jest.fn(() => 'full'),
    toggleTabViewMode: jest.fn(),
    registerVisibleTab: jest.fn(),
    unregisterVisibleTab: jest.fn(),
  };
  const effort = { currentEffort: signal<string | null>(null), isLoaded: signal(false) };
  const model = { currentModel: signal(''), isLoaded: signal(false) };

  function setup(locked = false) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [CanvasTileComponent],
      providers: [
        { provide: TabManagerService, useValue: tabManager },
        { provide: EffortStateService, useValue: effort },
        { provide: ModelStateService, useValue: model },
      ],
    });
    TestBed.overrideComponent(CanvasTileComponent, {
      set: {
        imports: [],
        template: `
          <button type="button" aria-haspopup="menu"
            [attr.aria-expanded]="layoutMenuOpen()"
            [attr.aria-label]="'Layout options for ' + tabLabel()"
            (click)="toggleLayoutMenu()">Layout</button>
          @if (layoutMenuOpen()) {
            <div #layoutMenu role="menu" (keydown)="onLayoutMenuKeydown($event)">
              @for (option of spanOptions; track option.span) {
                <button type="button" role="menuitemradio" data-layout-item tabindex="-1"
                  [attr.aria-checked]="isSpanChecked(option.span)"
                  [attr.aria-label]="option.label" [disabled]="layoutLocked()"
                  (click)="requestSpan(option.span)">{{ option.text }}</button>
              }
              <button type="button" role="menuitem" data-layout-item tabindex="-1"
                aria-label="Focus tile at full width" [disabled]="layoutLocked()"
                (click)="requestLayoutFocus()">Focus</button>
              <button type="button" role="menuitem" data-layout-item tabindex="-1"
                aria-label="Start a new row before this tile"
                [disabled]="layoutLocked() || firstInOrder()"
                (click)="requestRowBreak()">Start new row</button>
            </div>
          }
        `,
      },
    });
    const fixture = TestBed.createComponent(CanvasTileComponent);
    fixture.componentRef.setInput('tabId', 'tile-1');
    fixture.componentRef.setInput('widthIntent', { kind: 'span', span: 'half' });
    fixture.componentRef.setInput('layoutLocked', locked);
    fixture.detectChanges();
    return fixture;
  }

  it('exposes trigger/menu ARIA and four stored-span radio choices', () => {
    const fixture = setup();
    const trigger = fixture.nativeElement.querySelector('button');
    expect(trigger.getAttribute('aria-label')).toBe('Layout options for Alpha');
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    trigger.click();
    fixture.detectChanges();
    const radios = [...fixture.nativeElement.querySelectorAll('[role="menuitemradio"]')] as HTMLButtonElement[];
    expect(radios.map((button) => button.getAttribute('aria-label'))).toEqual([
      'Set tile width to one third', 'Set tile width to one half',
      'Set tile width to two thirds', 'Set tile width to full',
    ]);
    expect(radios.map((button) => button.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false', 'false']);
  });

  it('emits span, focus and row actions and closes after selection', () => {
    const fixture = setup();
    const span = jest.fn();
    const focus = jest.fn();
    const row = jest.fn();
    fixture.componentInstance.spanRequested.subscribe(span);
    fixture.componentInstance.layoutFocusToggled.subscribe(focus);
    fixture.componentInstance.rowBreakToggled.subscribe(row);
    const open = (): void => { fixture.nativeElement.querySelector('button').click(); fixture.detectChanges(); };
    open();
    (fixture.nativeElement.querySelectorAll('[role="menuitemradio"]')[2] as HTMLButtonElement).click();
    expect(span).toHaveBeenCalledWith('two-thirds');
    open();
    (fixture.nativeElement.querySelector('[aria-label="Focus tile at full width"]') as HTMLButtonElement).click();
    expect(focus).toHaveBeenCalledTimes(1);
    open();
    (fixture.nativeElement.querySelector('[aria-label="Start a new row before this tile"]') as HTMLButtonElement).click();
    expect(row).toHaveBeenCalledTimes(1);
  });

  it('cycles enabled items with arrows/Home/End and disables all actions when locked', () => {
    const fixture = setup();
    fixture.nativeElement.querySelector('button').click();
    fixture.detectChanges();
    const items = [...fixture.nativeElement.querySelectorAll('[data-layout-item]')] as HTMLButtonElement[];
    items[1].focus();
    items[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    expect(document.activeElement).toBe(items.at(-1));
    items.at(-1)?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(items[0]);

    const locked = setup(true);
    locked.nativeElement.querySelector('button').click();
    locked.detectChanges();
    expect([...locked.nativeElement.querySelectorAll('[data-layout-item]')].every((item) => (item as HTMLButtonElement).disabled)).toBe(true);
  });
});
