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
import { EffortStateService } from '@ptah-extension/core';

describe('CanvasTileComponent freeze-at-creation effort', () => {
  const mockEffortState = {
    currentEffort: signal<string | undefined>('high'),
    isLoaded: signal(true),
    setEffort: jest.fn().mockResolvedValue(undefined),
  };

  const mockTabManager = {
    tabs: signal<
      Array<{
        id: string;
        claudeSessionId: string | null;
        overrideEffort?: unknown;
      }>
    >([]),
    setOverrideEffort: jest.fn(),
    getTabViewMode: jest.fn().mockReturnValue('full'),
    toggleTabViewMode: jest.fn(),
  };

  function mountTile(tabId: string) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [CanvasTileComponent],
      providers: [
        { provide: EffortStateService, useValue: mockEffortState },
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
