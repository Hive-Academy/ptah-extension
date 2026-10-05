import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { EffortSelectorComponent } from './effort-selector.component';
import { EffortStateService } from '@ptah-extension/core';
import { TabManagerService } from '@ptah-extension/chat-state';
import { ChatStore } from '../../../services/chat.store';
import { KeyboardNavigationService } from '@ptah-extension/ui';
import { SESSION_CONTEXT } from '../../../tokens/session-context.token';

describe('EffortSelectorComponent.selectEffort', () => {
  const mockEffortState = {
    currentEffort: signal<string | undefined>('medium'),
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
  };

  const mockChatStore = {
    currentSessionId: signal<string | null>('global-session'),
  };

  const mockKeyboardNav = {
    activeIndex: signal(0),
    setActiveIndex: jest.fn(),
  };

  function createComponent(sessionContext: unknown): EffortSelectorComponent {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: EffortStateService, useValue: mockEffortState },
        { provide: TabManagerService, useValue: mockTabManager },
        { provide: ChatStore, useValue: mockChatStore },
        { provide: KeyboardNavigationService, useValue: mockKeyboardNav },
        { provide: SESSION_CONTEXT, useValue: sessionContext },
      ],
    });
    return TestBed.runInInjectionContext(() => new EffortSelectorComponent());
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockTabManager.tabs.set([]);
    mockChatStore.currentSessionId.set('global-session');
  });

  describe('non-tile context (SESSION_CONTEXT absent)', () => {
    it('persists via setEffort using the global session id', () => {
      const component = createComponent(null);

      component.selectEffort({ value: 'high' });

      expect(mockEffortState.setEffort).toHaveBeenCalledWith(
        'high',
        'global-session',
      );
      expect(mockTabManager.setOverrideEffort).not.toHaveBeenCalled();
    });

    it("maps the 'Default' option to undefined", () => {
      const component = createComponent(null);

      component.selectEffort({ value: '' });

      expect(mockEffortState.setEffort).toHaveBeenCalledWith(
        undefined,
        'global-session',
      );
    });
  });

  describe('tile context (SESSION_CONTEXT provides a tabId)', () => {
    it('pins the per-tab override AND persists the new default + live-syncs the tile session', () => {
      mockTabManager.tabs.set([
        {
          id: 'tab-1',
          claudeSessionId: 'tile-session',
          overrideEffort: undefined,
        },
      ]);
      const component = createComponent(signal('tab-1'));

      component.selectEffort({ value: 'xhigh' });

      expect(mockTabManager.setOverrideEffort).toHaveBeenCalledWith(
        'tab-1',
        'xhigh',
      );
      expect(mockEffortState.setEffort).toHaveBeenCalledWith(
        'xhigh',
        'tile-session',
      );
    });

    it('passes null session id when the tile has no live session yet', () => {
      mockTabManager.tabs.set([
        { id: 'tab-1', claudeSessionId: null, overrideEffort: undefined },
      ]);
      const component = createComponent(signal('tab-1'));

      component.selectEffort({ value: 'low' });

      expect(mockTabManager.setOverrideEffort).toHaveBeenCalledWith(
        'tab-1',
        'low',
      );
      expect(mockEffortState.setEffort).toHaveBeenCalledWith('low', null);
    });

    it("stores null override for the 'Default' option", () => {
      mockTabManager.tabs.set([
        {
          id: 'tab-1',
          claudeSessionId: 'tile-session',
          overrideEffort: 'high',
        },
      ]);
      const component = createComponent(signal('tab-1'));

      component.selectEffort({ value: '' });

      expect(mockTabManager.setOverrideEffort).toHaveBeenCalledWith(
        'tab-1',
        null,
      );
      expect(mockEffortState.setEffort).toHaveBeenCalledWith(
        undefined,
        'tile-session',
      );
    });

    it('runs the 90/10 workflow: pins the tile AND live-syncs the tile session in one pick', () => {
      mockTabManager.tabs.set([
        {
          id: 'tab-1',
          claudeSessionId: 'tile-session',
          overrideEffort: undefined,
        },
      ]);
      const component = createComponent(signal('tab-1'));

      component.selectEffort({ value: 'high' });

      expect(mockTabManager.setOverrideEffort).toHaveBeenCalledWith(
        'tab-1',
        'high',
      );
      expect(mockEffortState.setEffort).toHaveBeenCalledWith(
        'high',
        'tile-session',
      );
      expect(mockTabManager.setOverrideEffort).toHaveBeenCalledTimes(1);
      expect(mockEffortState.setEffort).toHaveBeenCalledTimes(1);
    });

    it("uses the tile's OWN claudeSessionId, not the global currentSessionId", () => {
      mockChatStore.currentSessionId.set('global-session');
      mockTabManager.tabs.set([
        {
          id: 'tab-1',
          claudeSessionId: 'tile-session',
          overrideEffort: undefined,
        },
      ]);
      const component = createComponent(signal('tab-1'));

      component.selectEffort({ value: 'medium' });

      expect(mockEffortState.setEffort).toHaveBeenCalledWith(
        'medium',
        'tile-session',
      );
      expect(mockEffortState.setEffort).not.toHaveBeenCalledWith(
        'medium',
        'global-session',
      );
    });
  });
});

describe('EffortSelectorComponent — level bar transitions', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [EffortSelectorComponent],
      providers: [
        {
          provide: EffortStateService,
          useValue: {
            currentEffort: signal('medium'),
            isLoaded: signal(true),
            setEffort: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: TabManagerService,
          useValue: { tabs: signal([]), setOverrideEffort: jest.fn() },
        },
        { provide: ChatStore, useValue: { currentSessionId: signal(null) } },
      ],
    });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('animates only the fill color on the toolbar bars (no transition-all)', () => {
    const fixture = TestBed.createComponent(EffortSelectorComponent);
    fixture.detectChanges();

    const trigger = fixture.nativeElement.querySelector(
      'button[trigger]',
    ) as HTMLButtonElement;
    const bars = Array.from(
      trigger.querySelectorAll<HTMLElement>('div'),
    ).filter((div) => div.className.includes('rounded-[1px]'));

    // Only the fill color changes between efforts (each bar's height is fixed
    // by its slot), so `transition-all` must not come back: it also animated
    // inherited animatable properties like scrollbar-color and started
    // non-composited transitions on every scroll recalculation.
    expect(bars).toHaveLength(5);
    for (const bar of bars) {
      expect(bar.className).toContain('transition-colors');
      expect(bar.className).not.toContain('transition-all');
    }
  });
});
