import {
  CUSTOM_ELEMENTS_SCHEMA,
  provideZonelessChangeDetection,
  signal,
} from '@angular/core';

jest.mock('ngx-markdown', () => ({
  MarkdownModule: class MarkdownModule {},
  MarkdownComponent: class MarkdownComponent {},
  provideMarkdown: () => [],
  MARKED_OPTIONS: 'MARKED_OPTIONS',
  CLIPBOARD_OPTIONS: 'CLIPBOARD_OPTIONS',
  MARKED_EXTENSIONS: 'MARKED_EXTENSIONS',
  MERMAID_OPTIONS: 'MERMAID_OPTIONS',
  SANITIZE: 'SANITIZE',
}));

import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  AppStateManager,
  AuthStateService,
  AutopilotStateService,
  ClaudeRpcService,
  CommandDiscoveryFacade,
  VSCodeService,
} from '@ptah-extension/core';
import { rpcSuccess } from '@ptah-extension/core/testing';
import {
  CommandCenterSendLockService,
  TabManagerService,
} from '@ptah-extension/chat-state';
import { ChatInputComponent } from './chat-input.component';
import { ChatStore } from '../../../services/chat.store';
import { ComposerDraftStore } from '../../../services/composer-draft.store';
import { ComposerCompactStore } from '../../../services/composer-compact.store';
import { COMPOSER_TRIGGER_CACHE_ENABLED } from '../../../services/composer-trigger-scheduler';
import { FilePickerService } from '../../../services/file-picker.service';
import { VoiceInputService } from '../../../services/voice-input.service';
import { ComposerActivityDirective } from '../../../directives/composer-activity.directive';
import { ComposerCompactBarComponent } from '@ptah-extension/chat-ui';
import { ComposerTypeToExpandDirective } from './composer-type-to-expand.directive';
import { UnifiedSuggestionsDropdownComponent } from '../../file-suggestions/unified-suggestions-dropdown.component';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('ChatInputComponent streaming fold', () => {
  let fixture: ComponentFixture<ChatInputComponent>;
  const heldTabId = signal<string | null>(null);
  const activeTabId = signal<string | null>('tab-1');
  const tabs = signal([{ id: 'tab-1', status: 'loaded' }]);
  const draft = new Map<
    string,
    { text: string; files: never[]; images: never[] }
  >();
  const lockStub = {
    state: heldTabId,
    isHeld: (tabId: string) => heldTabId() === tabId,
  };
  const chatStoreStub = {
    activeTab: signal(null),
    isStreaming: signal(false),
    currentSessionId: signal(null),
    queueRestoreContent: signal(null),
    clearQueueRestoreSignal: jest.fn(),
    sendOrQueueMessage: jest.fn().mockResolvedValue({ success: true }),
    abortWithConfirmation: jest.fn().mockResolvedValue(true),
    isCompactingForTab: jest.fn(() => false),
  };
  const tabManagerStub = {
    tabs,
    activeTabId,
    activeTabQueuedContent: signal(null),
    isTabStreaming: jest.fn(() => false),
    onTabClosed: jest.fn(() => () => undefined),
    findTabByIdAcrossWorkspaces: jest.fn((id: string) => {
      const tab = tabs().find((candidate) => candidate.id === id);
      return tab ? { tab, workspacePath: '/ws' } : null;
    }),
  };
  const filePickerStub = {
    searchFiles: jest.fn(() => []),
    ensureFilesLoaded: jest.fn().mockResolvedValue(undefined),
    workspaceFiles: signal([]),
    searchFilesRemote: jest.fn(),
    clearRemoteResults: jest.fn(),
    remoteResults: signal([]),
    fetchError: signal(null),
  };
  const voiceInputStub = {
    state: signal('idle'),
    elapsedSeconds: signal(0),
    error: signal(null),
    isRecording: signal(false),
    isTranscribing: signal(false),
    isBusy: signal(false),
    startRecording: jest.fn().mockResolvedValue(undefined),
    stopRecording: jest.fn().mockResolvedValue(null),
    cancelRecording: jest.fn(),
  };
  const appStateStub = { setCurrentView: jest.fn() };

  function root(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function button(testId: string): HTMLButtonElement {
    const found = root().querySelector<HTMLButtonElement>(
      `[data-testid="${testId}"]`,
    );
    if (!found) throw new Error(`Missing button: ${testId}`);
    return found;
  }

  function textarea(): HTMLTextAreaElement {
    const found = root().querySelector('textarea');
    if (!found) throw new Error('Missing composer textarea');
    return found;
  }

  beforeEach(async () => {
    heldTabId.set(null);
    activeTabId.set('tab-1');
    tabs.set([{ id: 'tab-1', status: 'loaded' }]);
    draft.clear();
    chatStoreStub.sendOrQueueMessage.mockClear();
    chatStoreStub.abortWithConfirmation.mockClear();
    appStateStub.setCurrentView.mockClear();
    await TestBed.configureTestingModule({
      imports: [ChatInputComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: ChatStore, useValue: chatStoreStub },
        { provide: TabManagerService, useValue: tabManagerStub },
        { provide: CommandCenterSendLockService, useValue: lockStub },
        {
          provide: AutopilotStateService,
          useValue: {
            enabled: signal(false),
            agentPlanMode: signal(false),
            permissionLevel: signal('default'),
            statusText: signal(''),
          },
        },
        { provide: FilePickerService, useValue: filePickerStub },
        {
          provide: CommandDiscoveryFacade,
          useValue: {
            searchCommands: jest.fn(() => []),
            fetchCommands: jest.fn().mockResolvedValue(undefined),
            clearCache: jest.fn(),
          },
        },
        {
          provide: ClaudeRpcService,
          useValue: {
            call: jest.fn(async (method: string) => {
              if (method === 'config:models-list') {
                return rpcSuccess({ models: [] });
              }
              if (method === 'config:pricing-get') {
                return rpcSuccess({ pricing: {}, hydrated: false });
              }
              return { isSuccess: () => false, data: null };
            }),
          },
        },
        {
          provide: VSCodeService,
          useValue: {
            isElectron: false,
            config: () => ({ workspaceRoot: '' }),
          },
        },
        { provide: VoiceInputService, useValue: voiceInputStub },
        {
          provide: AuthStateService,
          useValue: {
            authMethodLabel: signal(null),
            loadAuthStatus: jest.fn().mockResolvedValue(undefined),
          },
        },
        { provide: AppStateManager, useValue: appStateStub },
        {
          provide: ComposerDraftStore,
          useValue: {
            get: (id: string) => draft.get(id),
            save: (
              id: string,
              value: { text: string; files: never[]; images: never[] },
            ) => draft.set(id, value),
            clear: (id: string) => draft.delete(id),
          },
        },
        { provide: COMPOSER_TRIGGER_CACHE_ENABLED, useValue: false },
        // Component-level in production; the override below clears those.
        ComposerCompactStore,
      ],
    })
      .overrideComponent(ChatInputComponent, {
        set: {
          imports: [
            ComposerActivityDirective,
            ComposerCompactBarComponent,
            ComposerTypeToExpandDirective,
            UnifiedSuggestionsDropdownComponent,
          ],
          providers: [],
          schemas: [CUSTOM_ELEMENTS_SCHEMA],
        },
      })
      .compileComponents();
    fixture = TestBed.createComponent(ChatInputComponent);
    fixture.detectChanges();
  });

  afterEach(() => fixture.destroy());

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
  }

  function stage(): HTMLElement {
    return root().querySelector('[data-testid="chat-composer-stage"]')!;
  }

  function fullRegion(): HTMLElement {
    return root().querySelector('[data-testid="chat-composer-full"]')!;
  }

  function announcer(): string {
    return (
      root()
        .querySelector('[data-testid="chat-composer-fold-announcer"]')
        ?.textContent?.trim() ?? ''
    );
  }

  async function startStreaming(): Promise<void> {
    tabs.set([{ id: 'tab-1', status: 'streaming' }]);
    await settle();
  }

  it('shows the full composer while the tab is idle', async () => {
    await settle();
    expect(stage().hasAttribute('data-compact')).toBe(false);
    expect(fullRegion().hasAttribute('inert')).toBe(false);
    expect(announcer()).toBe('');
  });

  it('folds into the compact bar while streaming with an idle composer', async () => {
    await startStreaming();
    expect(stage().hasAttribute('data-compact')).toBe(true);
    expect(fullRegion().hasAttribute('inert')).toBe(true);

    const expand = button('composer-compact-expand');
    expect(expand.getAttribute('aria-expanded')).toBe('false');
    expect(expand.getAttribute('aria-controls')).toBe(fullRegion().id);
    expect(fullRegion().id).not.toBe('');
    expect(button('chat-stop-btn')).toBeTruthy();
    expect(announcer()).toContain('minimized');
  });

  it('expands from the bar and moves focus into the textarea', async () => {
    await startStreaming();
    button('composer-compact-expand').click();
    await settle();

    expect(stage().hasAttribute('data-compact')).toBe(false);
    expect(fullRegion().hasAttribute('inert')).toBe(false);
    expect(document.activeElement).toBe(textarea());
    expect(announcer()).toBe('Composer expanded.');
  });

  // Regression (electron-e2e task-374): a Stop left on the folded card keeps
  // a layout box inside the inert, zero-height clip, so a click lands on the
  // composer root instead. Exactly one Stop exists, outside any inert layer.
  function stops(): HTMLButtonElement[] {
    return Array.from(
      root().querySelectorAll<HTMLButtonElement>(
        '[data-testid="chat-stop-btn"]',
      ),
    );
  }

  function compactBar(): HTMLElement {
    const found = root().querySelector<HTMLElement>(
      '[data-testid="composer-compact-bar"]',
    );
    if (!found) throw new Error('Missing compact bar');
    return found;
  }

  it('renders exactly one clickable Stop, outside the inert fold, in each state', async () => {
    await startStreaming();
    expect(stage().hasAttribute('data-compact')).toBe(true);
    expect(stops()).toHaveLength(1);
    expect(stops()[0].closest('[inert]')).toBeNull();
    expect(fullRegion().contains(stops()[0])).toBe(false);
    expect(compactBar().contains(stops()[0])).toBe(true);

    button('composer-compact-expand').click();
    await settle();
    expect(stage().hasAttribute('data-compact')).toBe(false);
    expect(stops()).toHaveLength(1);
    expect(stops()[0].closest('[inert]')).toBeNull();
    expect(fullRegion().contains(stops()[0])).toBe(true);
  });

  it('runs the abort path from the folded bar Stop', async () => {
    const handleStop = jest.spyOn(fixture.componentInstance, 'handleStop');
    await startStreaming();
    expect(stage().hasAttribute('data-compact')).toBe(true);

    stops()[0].click();
    expect(handleStop).toHaveBeenCalledTimes(1);
    expect(chatStoreStub.abortWithConfirmation).toHaveBeenCalledTimes(1);
  });

  it('keeps the card open with a draft and runs the abort path from its Stop', async () => {
    const handleStop = jest.spyOn(fixture.componentInstance, 'handleStop');
    const input = textarea();
    input.value = 'draft while streaming';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await startStreaming();

    expect(stage().hasAttribute('data-compact')).toBe(false);
    expect(stops()).toHaveLength(1);
    const stop = stops()[0];
    expect(stop.closest('[inert]')).toBeNull();
    expect(fullRegion().contains(stop)).toBe(true);
    expect(compactBar().contains(stop)).toBe(false);

    stop.click();
    expect(handleStop).toHaveBeenCalledTimes(1);
    expect(chatStoreStub.abortWithConfirmation).toHaveBeenCalledTimes(1);
  });

  it('expands when the user types a printable key in the chat view', async () => {
    await startStreaming();
    const expand = button('composer-compact-expand');
    expand.focus();
    expand.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'h', bubbles: true }),
    );
    await settle();

    expect(stage().hasAttribute('data-compact')).toBe(false);
    expect(document.activeElement).toBe(textarea());
  });

  it('does not expand on shortcuts', async () => {
    await startStreaming();
    const expand = button('composer-compact-expand');
    expand.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true }),
    );
    await settle();
    expect(stage().hasAttribute('data-compact')).toBe(true);
  });

  it('stays full while a draft is pending', async () => {
    const input = textarea();
    input.value = 'draft';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await startStreaming();
    expect(stage().hasAttribute('data-compact')).toBe(false);
  });

  it('stays full while focus is inside the composer', async () => {
    textarea().focus();
    await startStreaming();
    expect(stage().hasAttribute('data-compact')).toBe(false);
  });

  it('opens again when the stream ends', async () => {
    await startStreaming();
    tabs.set([{ id: 'tab-1', status: 'loaded' }]);
    await settle();
    expect(stage().hasAttribute('data-compact')).toBe(false);
    expect(fullRegion().hasAttribute('inert')).toBe(false);
  });

  // Real text insertion needs a trusted key event; only a manual Electron check proves it.
  it('expands on "/" and focuses the textarea without cancelling the keydown', async () => {
    await startStreaming();
    const expand = button('composer-compact-expand');
    const event = new KeyboardEvent('keydown', {
      key: '/',
      bubbles: true,
      cancelable: true,
    });
    const stop = jest.spyOn(event, 'stopPropagation');
    expand.dispatchEvent(event);
    await settle();

    expect(stage().hasAttribute('data-compact')).toBe(false);
    expect(document.activeElement).toBe(textarea());
    expect(event.defaultPrevented).toBe(false);
    expect(stop).not.toHaveBeenCalled();
  });

  it('stays open while files hover longer than the refold delay', async () => {
    await startStreaming();
    jest.useFakeTimers();
    try {
      const drag = new Event('dragover', { bubbles: true, cancelable: true });
      Object.defineProperty(drag, 'dataTransfer', {
        value: { types: ['Files'] },
      });
      root()
        .querySelector('[data-testid="chat-composer"]')!
        .dispatchEvent(drag);
      fixture.detectChanges();
      TestBed.tick();
      expect(stage().hasAttribute('data-compact')).toBe(false);

      jest.advanceTimersByTime(ComposerCompactStore.REFOLD_DELAY_MS * 2);
      TestBed.tick();
      expect(stage().hasAttribute('data-compact')).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  it('never animates opacity on an element that is or holds a glass surface', async () => {
    tabs.set([{ id: 'tab-1', status: 'loaded' }]);
    const input = textarea();
    input.value = 'x';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();

    const faded = Array.from(
      root().querySelectorAll<HTMLElement>('.ptah-fold-fade, .ptah-compact-row'),
    );
    expect(faded.length).toBeGreaterThan(0);
    for (const el of faded) {
      expect(el.matches('[data-glass-surface]')).toBe(false);
      expect(el.querySelector('[data-glass-surface]')).toBeNull();
    }
    // The toolbar holds the attach menu's glass overlay: it must not fade.
    const toolbar = root().querySelector('.ptah-composer-toolbar')!;
    expect(toolbar.querySelector('[data-glass-surface]')).not.toBeNull();
    expect(toolbar.closest('.ptah-fold-fade')).toBeNull();
    expect(toolbar.querySelector('.ptah-fold-fade')).toBeNull();
  });

  it('keeps every opacity rule of the fold stylesheet on .ptah-fold-fade', () => {
    const css = readFileSync(join(__dirname, 'chat-input.component.css'), 'utf8');
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, '').match(/[^{}]+\{[^{}]*\}/g) ?? [];
    const opacityRules = rules.filter((rule) => /(^|[;{\s])opacity\s*:|transition:\s*opacity/.test(rule));
    expect(opacityRules.length).toBeGreaterThan(0);
    for (const rule of opacityRules) {
      expect(rule.split('{')[0]).toContain('.ptah-fold-fade');
    }
  });

  // The moving card's translate makes the clip box the containing block of
  // the fixed suggestions panel; positioning then would go stale (Electron
  // showed the panel at the window's top-left).
  it('opens slash suggestions only after the expand has settled', async () => {
    await startStreaming();
    jest.useFakeTimers();
    try {
      button('composer-compact-expand').click();
      fixture.componentInstance.handleSlashActivated({
        query: '',
      } as Parameters<ChatInputComponent['handleSlashActivated']>[0]);
      fixture.detectChanges();
      TestBed.tick();
      const dropdown = () =>
        root().querySelector('ptah-unified-suggestions-dropdown');
      expect(stage().hasAttribute('data-compact')).toBe(false);
      expect(fullRegion().classList.contains('is-unclipped')).toBe(false);
      expect(dropdown()).toBeNull();

      jest.advanceTimersByTime(ComposerCompactStore.UNCLIP_DELAY_MS);
      TestBed.tick();
      fixture.detectChanges();
      expect(fullRegion().classList.contains('is-unclipped')).toBe(true);
      expect(dropdown()).not.toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it('opens slash suggestions at once when the composer is not folding', async () => {
    await settle();
    fixture.componentInstance.handleSlashActivated({
      query: '',
    } as Parameters<ChatInputComponent['handleSlashActivated']>[0]);
    fixture.detectChanges();
    expect(
      root().querySelector('ptah-unified-suggestions-dropdown'),
    ).not.toBeNull();
  });

  it('stops generation from the bar', async () => {
    await startStreaming();
    button('chat-stop-btn').click();
    expect(chatStoreStub.abortWithConfirmation).toHaveBeenCalledTimes(1);
  });
});
