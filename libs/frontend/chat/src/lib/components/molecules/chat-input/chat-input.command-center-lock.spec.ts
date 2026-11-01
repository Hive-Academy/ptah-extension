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
import { ComposerTypeToExpandDirective } from './composer-type-to-expand.directive';
import { COMPOSER_TRIGGER_CACHE_ENABLED } from '../../../services/composer-trigger-scheduler';
import { FilePickerService } from '../../../services/file-picker.service';
import { VoiceInputService } from '../../../services/voice-input.service';

describe('ChatInputComponent Command Center lock', () => {
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
          // The root's type-to-expand directive binds an input on a plain div.
          imports: [ComposerTypeToExpandDirective],
          providers: [],
          schemas: [CUSTOM_ELEMENTS_SCHEMA],
        },
      })
      .compileComponents();
    fixture = TestBed.createComponent(ChatInputComponent);
    fixture.detectChanges();
  });

  afterEach(() => fixture.destroy());

  it('shows ownership, disables Send, and opens Command Center while held', () => {
    heldTabId.set('tab-1');
    fixture.detectChanges();
    const status = root().querySelector('[role="status"]');
    expect(status?.textContent).toContain(
      'Command Center voice owns this session',
    );
    const open = Array.from(root().querySelectorAll('button')).find(
      (candidate) => candidate.textContent?.includes('Open Command Center'),
    );
    if (!open) throw new Error('Missing Open Command Center action');
    expect(button('chat-send-btn').disabled).toBe(true);
    open.click();
    expect(appStateStub.setCurrentView).toHaveBeenCalledWith('command-center');
  });

  it('holds button, direct, and keyboard sends; release sends the same draft once', async () => {
    heldTabId.set('tab-1');
    fixture.detectChanges();
    const input = textarea();
    input.value = 'Keep this draft';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();
    expect(input.value).toBe('Keep this draft');
    expect(button('chat-send-btn').disabled).toBe(true);
    button('chat-send-btn').click();
    await fixture.componentInstance.handleSend();
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    );
    expect(chatStoreStub.sendOrQueueMessage).not.toHaveBeenCalled();

    heldTabId.set(null);
    fixture.detectChanges();
    expect(input.value).toBe('Keep this draft');
    expect(button('chat-send-btn').disabled).toBe(false);
    await fixture.componentInstance.handleSend();
    expect(chatStoreStub.sendOrQueueMessage).toHaveBeenCalledTimes(1);
  });

  it('keeps Stop available for a held streaming tab', async () => {
    tabs.set([{ id: 'tab-1', status: 'streaming' }]);
    heldTabId.set('tab-1');
    fixture.detectChanges();
    // An idle streaming composer folds and its Stop moves to the compact bar
    // (stubbed out here), so keep the card open with a pending draft.
    const input = textarea();
    input.value = 'Keep this draft';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();
    const stop = button('chat-stop-btn');
    expect(stop.disabled).toBe(false);
    stop.click();
    expect(chatStoreStub.abortWithConfirmation).toHaveBeenCalledTimes(1);
  });

  it('does not show the ownership banner for an unlocked tab', () => {
    heldTabId.set('another-tab');
    fixture.detectChanges();
    expect(root().querySelector('[role="status"]')).toBeNull();
    expect(root().textContent).not.toContain('Open Command Center');
  });
});
