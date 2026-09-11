import { TestBed } from '@angular/core/testing';
import type { TabState } from '@ptah-extension/chat-types';
import { createExecutionChatMessage, SessionId } from '@ptah-extension/shared';
import { ConfirmationDialogService } from './confirmation-dialog.service';
import { ConversationRegistry } from './conversation-registry.service';
import {
  MODEL_REFRESH_CONTROL,
  type ModelRefreshControl,
} from './model-refresh-control';
import {
  AUTO_SESSION_TITLE_MAX_LENGTH,
  deriveSessionTitle,
  isGenuinelyNewFirstMessage,
  workspaceLabelFromPath,
} from './session-identity';
import { TabManagerService } from './tab-manager.service';
import { TabSessionBinding } from './tab-session-binding.service';
import { projectTabForPersist, sanitizeRestoredTab } from './tab-persistence';
import { TabWorkspacePartitionService } from './tab-workspace-partition.service';

function userMessage(id: string, rawContent: string) {
  return createExecutionChatMessage({ id, role: 'user', rawContent });
}

describe('session identity', () => {
  let service: TabManagerService;
  let workspacePartition: TabWorkspacePartitionService;

  beforeEach(() => {
    localStorage.clear();
    const modelRefresh: jest.Mocked<ModelRefreshControl> = {
      refreshModels: jest.fn().mockResolvedValue(undefined),
    };

    TestBed.configureTestingModule({
      providers: [
        TabManagerService,
        TabWorkspacePartitionService,
        ConversationRegistry,
        TabSessionBinding,
        ConfirmationDialogService,
        { provide: MODEL_REFRESH_CONTROL, useValue: modelRefresh },
      ],
    });
    service = TestBed.inject(TabManagerService);
    workspacePartition = TestBed.inject(TabWorkspacePartitionService);
    service.switchWorkspace('C:\\work\\ptah-extension');
  });

  afterEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
  });

  it('derives a plain title from the genuinely new first user message', () => {
    const tabId = service.createTab('session-09-09-12-30');
    const message = userMessage(
      'u1',
      '## Fix **the** [compaction](https://example.test) reload bug',
    );

    service.applyNewConversationStreaming(tabId);
    service.appendUserMessageAndResetStreaming(tabId, [message]);

    expect(service.findTabByIdAcrossWorkspaces(tabId)?.tab).toMatchObject({
      name: 'Fix the compaction reload bug',
      title: 'Fix the compaction reload bug',
      titleOrigin: 'auto',
    });
  });

  it('does not re-derive for a second or replayed message', () => {
    const tabId = service.createTab();
    const first = userMessage('u1', 'First durable title');
    service.appendUserMessageAndResetStreaming(tabId, [first]);

    const second = userMessage('u2', 'A different later request');
    service.appendUserMessageAndResetStreaming(tabId, [first, second]);
    service.appendUserMessageAndResetStreaming(tabId, [first, second]);

    expect(service.findTabByIdAcrossWorkspaces(tabId)?.tab.title).toBe(
      'First durable title',
    );
  });

  it('recognizes only the first user write on an untouched default tab', () => {
    const first = userMessage('u1', 'First');

    expect(isGenuinelyNewFirstMessage('default', [], [first])).toBe(true);
    expect(isGenuinelyNewFirstMessage('history', [], [first])).toBe(false);
    expect(isGenuinelyNewFirstMessage('default', [first], [first])).toBe(false);
  });

  it('does not stamp auto when title derivation is empty', () => {
    const tabId = service.createTab();
    const empty = userMessage('u1', '');

    service.appendUserMessageAndResetStreaming(tabId, [empty]);
    service.appendUserMessageAndResetStreaming(tabId, [empty]);

    expect(service.findTabByIdAcrossWorkspaces(tabId)?.tab).toMatchObject({
      title: 'New Chat',
      titleOrigin: 'default',
    });
  });

  it('uses a bounded raw fallback when markdown cleanup removes everything', () => {
    const tabId = service.createTab();
    const punctuation = userMessage('u1', '***');

    service.appendUserMessageAndResetStreaming(tabId, [punctuation]);

    expect(service.findTabByIdAcrossWorkspaces(tabId)?.tab).toMatchObject({
      name: '***',
      title: '***',
      titleOrigin: 'auto',
    });
  });

  it('does not derive while restoring or resuming history', () => {
    const restored = sanitizeRestoredTab({
      id: 'restored-tab',
      claudeSessionId: SessionId.from('11111111-1111-4111-8111-111111111111'),
      name: 'Stored history title',
      title: 'Stored history title',
      order: 0,
      status: 'loaded',
      isDirty: false,
      lastActivityAt: 0,
      messages: [userMessage('history-u1', 'Historical first request')],
      streamingState: null,
    } as TabState);

    expect(restored.titleOrigin).toBe('history');
    expect(restored.title).toBe('Stored history title');

    const tabId = service.openSessionTab(
      SessionId.from('22222222-2222-4222-8222-222222222222'),
      'Resumed title',
    );
    service.applyResumedHistory(tabId, [
      userMessage('resume-u1', 'Should not become the title'),
    ]);
    expect(service.findTabByIdAcrossWorkspaces(tabId)?.tab).toMatchObject({
      title: 'Resumed title',
      titleOrigin: 'history',
    });
  });

  it('never overwrites an explicit user-given name', () => {
    const tabId = service.createTab('My release investigation', 'user');
    service.appendUserMessageAndResetStreaming(tabId, [
      userMessage('u1', 'Ignore this for the title'),
    ]);

    expect(service.findTabByIdAcrossWorkspaces(tabId)?.tab).toMatchObject({
      name: 'My release investigation',
      title: 'My release investigation',
      titleOrigin: 'user',
    });
  });

  it('never overwrites renameTab ownership', () => {
    const tabId = service.createTab();
    service.renameTab(tabId, 'User renamed this');
    service.appendUserMessageAndResetStreaming(tabId, [
      userMessage('u1', 'Ignore this after rename'),
    ]);

    expect(service.findTabByIdAcrossWorkspaces(tabId)?.tab).toMatchObject({
      title: 'User renamed this',
      titleOrigin: 'user',
    });
  });

  it('round-trips the once-only marker through projection and restore', () => {
    const tabId = service.createTab();
    service.appendUserMessageAndResetStreaming(tabId, [
      userMessage('u1', 'Persist this identity'),
    ]);
    const tab = service.findTabByIdAcrossWorkspaces(tabId)?.tab;
    expect(tab).toBeDefined();

    const restored = sanitizeRestoredTab(projectTabForPersist(tab as TabState));
    expect(restored).toMatchObject({
      name: 'Persist this identity',
      title: 'Persist this identity',
      titleOrigin: 'auto',
    });
  });

  it('restores a legacy empty draft and derives on its first send', () => {
    const workspacePath = 'C:\\work\\legacy-project';
    const legacy = {
      id: 'legacy-empty',
      claudeSessionId: null,
      name: 'New Chat',
      title: 'New Chat',
      order: 0,
      status: 'fresh',
      isDirty: false,
      lastActivityAt: 0,
      messages: [],
      streamingState: null,
    } as TabState;
    localStorage.setItem(
      workspacePartition.getStorageKeyForWorkspace(workspacePath),
      JSON.stringify({
        tabs: [legacy],
        activeTabId: legacy.id,
        version: 2,
      }),
    );

    service.switchWorkspace(workspacePath);
    const first = userMessage('legacy-u1', 'Title after upgrading');
    service.applyNewConversationStreaming(legacy.id);
    service.appendUserMessageAndResetStreaming(legacy.id, [first]);

    expect(service.findTabByIdAcrossWorkspaces(legacy.id)?.tab).toMatchObject({
      name: 'Title after upgrading',
      title: 'Title after upgrading',
      titleOrigin: 'auto',
    });
  });

  it('truncates near 40 characters on a word boundary', () => {
    const title = deriveSessionTitle(
      'Investigate the unexpectedly expensive workspace hydration regression',
    );

    expect(title).toBe('Investigate the unexpectedly expensive…');
    expect(title.length).toBeLessThanOrEqual(AUTO_SESSION_TITLE_MAX_LENGTH);
  });

  it('truncates emoji without leaving a lone surrogate', () => {
    const title = deriveSessionTitle('🙂'.repeat(30));

    expect(title).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    expect(title).not.toMatch(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
    expect(Array.from(title).length).toBeLessThanOrEqual(
      AUTO_SESSION_TITLE_MAX_LENGTH,
    );
  });

  it('preserves comparison prose containing angle brackets', () => {
    expect(deriveSessionTitle('if a < b and b > c then swap them')).toBe(
      'if a < b and b > c then swap them',
    );
  });

  it('preserves TypeScript generic syntax instead of treating it as HTML', () => {
    expect(deriveSessionTitle('Fix Map<string, TabState>')).toBe(
      'Fix Map<string, TabState>',
    );
    expect(deriveSessionTitle('Keep <T extends Node> intact')).toBe(
      'Keep <T extends Node> intact',
    );
  });

  it('preserves underscores inside identifiers', () => {
    expect(deriveSessionTitle('fix user_id in file_reader')).toBe(
      'fix user_id in file_reader',
    );
  });

  it('removes paired underscore emphasis without changing identifiers', () => {
    expect(deriveSessionTitle('_Plan release_ for user_id')).toBe(
      'Plan release for user_id',
    );
    expect(deriveSessionTitle('Fix __parser__ today for file_reader')).toBe(
      'Fix parser today for file_reader',
    );
  });

  it('derives a cross-platform workspace basename without widening tab lookup', () => {
    const tabId = service.createTab();
    const lookup = service.findTabByIdAcrossWorkspaces(tabId);

    expect(lookup?.workspacePath).toBe('C:\\work\\ptah-extension');
    expect(workspaceLabelFromPath(lookup?.workspacePath ?? '')).toBe(
      'ptah-extension',
    );
    expect(workspaceLabelFromPath('/work/other-repo/')).toBe('other-repo');
  });
});
