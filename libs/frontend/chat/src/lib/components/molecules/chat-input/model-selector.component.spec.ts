import { signal, type Signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ModelStateService } from '@ptah-extension/core';
import { TabId, TabManagerService } from '@ptah-extension/chat-state';
import { KeyboardNavigationService } from '@ptah-extension/ui';
import { ChatStore } from '../../../services/chat.store';
import { SESSION_CONTEXT } from '../../../tokens/session-context.token';
import { ModelSelectorComponent } from './model-selector.component';

interface ModelTabStub {
  readonly id: TabId;
  readonly overrideModel?: string | null;
  readonly sessionModel?: string | null;
}

function makeHarness(options: {
  tabs: ModelTabStub[];
  activeTabId?: TabId | null;
  sessionContext?: Signal<TabId | null> | null;
  currentModel?: string;
}) {
  const currentModel = signal(options.currentModel ?? 'default');
  const tabs = signal(options.tabs);
  const activeTabId = signal(options.activeTabId ?? null);
  const activeTab = () =>
    tabs().find((tab) => tab.id === activeTabId()) ?? null;

  const modelStateStub = {
    currentModel: currentModel.asReadonly(),
    availableModels: signal([]).asReadonly(),
    isPending: signal(false).asReadonly(),
    isLoaded: signal(true).asReadonly(),
    switchModel: jest.fn().mockResolvedValue(undefined),
  } as unknown as ModelStateService;

  const tabManagerStub = {
    tabs: tabs.asReadonly(),
    activeTab,
    setOverrideModel: jest.fn(),
  } as unknown as TabManagerService;

  const keyboardNavigationStub = {
    activeIndex: signal(0).asReadonly(),
    setActiveIndex: jest.fn(),
  } as unknown as KeyboardNavigationService;

  const chatStoreStub = {
    currentSessionId: signal(null).asReadonly(),
  } as unknown as ChatStore;

  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      { provide: ModelStateService, useValue: modelStateStub },
      { provide: TabManagerService, useValue: tabManagerStub },
      { provide: KeyboardNavigationService, useValue: keyboardNavigationStub },
      { provide: ChatStore, useValue: chatStoreStub },
      { provide: SESSION_CONTEXT, useValue: options.sessionContext ?? null },
    ],
  });

  const component = TestBed.runInInjectionContext(
    () => new ModelSelectorComponent(),
  );

  return { component, currentModel };
}

describe('ModelSelectorComponent.effectiveModel', () => {
  it('keeps a resumed main-panel tab sessionModel after a global models-list refresh selects default', () => {
    const activeTabId = TabId.create();
    const { component, currentModel } = makeHarness({
      tabs: [{ id: activeTabId, sessionModel: 'claude-fable-5-1[1m]' }],
      activeTabId,
      currentModel: 'claude-fable-5-1[1m]',
    });

    expect(component.effectiveModel()).toBe('claude-fable-5-1[1m]');

    currentModel.set('default');

    expect(component.effectiveModel()).toBe('claude-fable-5-1[1m]');
  });

  it("keeps a canvas tile's overrideModel as the highest priority", () => {
    const activeTabId = TabId.create();
    const canvasTabId = TabId.create();
    const { component } = makeHarness({
      tabs: [
        { id: activeTabId, sessionModel: 'active-session-model' },
        {
          id: canvasTabId,
          overrideModel: 'canvas-override-model',
          sessionModel: 'canvas-session-model',
        },
      ],
      activeTabId,
      sessionContext: signal(canvasTabId),
      currentModel: 'default',
    });

    expect(component.effectiveModel()).toBe('canvas-override-model');
  });

  it('falls back to the global default for a fresh tab with no model fields', () => {
    const activeTabId = TabId.create();
    const { component } = makeHarness({
      tabs: [{ id: activeTabId }],
      activeTabId,
      currentModel: 'default',
    });

    expect(component.effectiveModel()).toBe('default');
  });
});
