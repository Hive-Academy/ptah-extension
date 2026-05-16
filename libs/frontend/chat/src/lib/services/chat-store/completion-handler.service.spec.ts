/**
 * CompletionHandlerService specs â€” error routing from chat:error events.
 *
 * The service is largely deprecated (per its own docstring) and now only
 * handles `handleChatError`. Tests assert the error is routed to the correct
 * tab, streaming state is reset, and mismatched session IDs are rejected with
 * a warning.
 */

import { TestBed } from '@angular/core/testing';
import { CompletionHandlerService } from './completion-handler.service';
import { TabManagerService } from '@ptah-extension/chat-state';
import { SessionManager } from '@ptah-extension/chat-streaming';
import type { TabState } from '@ptah-extension/chat-types';
import { SessionId } from '@ptah-extension/shared';

// Production `CompletionHandlerService.handleChatError` validates the incoming
// sessionId via `SessionId.from()` (UUID v4). Mint stable ids per spec run.
const SESS_1 = SessionId.create();
const SESS_SHARED = SessionId.create();
const SESS_OTHER = SessionId.create();
const SESS_FOREIGN = SessionId.create();
const SESS_UNKNOWN = SessionId.create();
const SESS_X = SessionId.create();
const SESS_S = SessionId.create();

type TabManagerSlice = Pick<
  TabManagerService,
  | 'findTabsBySessionId'
  | 'activeTabId'
  | 'activeTab'
  | 'applyStatusErrorReset'
  | 'markTabIdle'
>;
type SessionManagerSlice = Pick<SessionManager, 'setStatus'>;

function makeTab(overrides: Partial<TabState> = {}): TabState {
  return {
    id: 'tab-1',
    title: 'Session',
    name: 'Session',
    status: 'streaming',
    messages: [],
    streamingState: null,
    currentMessageId: null,
    claudeSessionId: 'session-1',
    ...overrides,
  } as TabState;
}

describe('CompletionHandlerService', () => {
  let service: CompletionHandlerService;
  let tabManager: jest.Mocked<TabManagerSlice>;
  let sessionManager: jest.Mocked<SessionManagerSlice>;
  let consoleError: jest.SpyInstance;
  let consoleWarn: jest.SpyInstance;
  let consoleLog: jest.SpyInstance;

  beforeEach(() => {
    tabManager = {
      findTabsBySessionId: jest.fn(() => [] as TabState[]),
      activeTabId: jest.fn(),
      activeTab: jest.fn(),
      applyStatusErrorReset: jest.fn(),
      markTabIdle: jest.fn(),
    } as unknown as jest.Mocked<TabManagerSlice>;

    sessionManager = {
      setStatus: jest.fn(),
    } as jest.Mocked<SessionManagerSlice>;

    consoleError = jest.spyOn(console, 'error').mockImplementation();
    consoleWarn = jest.spyOn(console, 'warn').mockImplementation();
    consoleLog = jest.spyOn(console, 'log').mockImplementation();

    TestBed.configureTestingModule({
      providers: [
        CompletionHandlerService,
        { provide: TabManagerService, useValue: tabManager },
        { provide: SessionManager, useValue: sessionManager },
      ],
    });
    service = TestBed.inject(CompletionHandlerService);
  });

  afterEach(() => {
    consoleError.mockRestore();
    consoleWarn.mockRestore();
    consoleLog.mockRestore();
    TestBed.resetTestingModule();
  });

  describe('handleChatError', () => {
    it('routes the error to the tab matching the payload sessionId', () => {
      const targetTab = makeTab({ id: 'tab-abc', claudeSessionId: SESS_1 });
      tabManager.findTabsBySessionId.mockReturnValue([targetTab]);

      service.handleChatError({ sessionId: SESS_1, error: 'CLI crashed' });

      expect(tabManager.findTabsBySessionId).toHaveBeenCalledWith(SESS_1);
      expect(tabManager.applyStatusErrorReset).toHaveBeenCalledWith('tab-abc');
      expect(sessionManager.setStatus).toHaveBeenCalledWith('loaded');
      expect(tabManager.markTabIdle).toHaveBeenCalledWith('tab-abc');
    });

    it('fans out reset to ALL tabs bound to the same sessionId (TASK_2026_106 Phase 4b)', () => {
      const tabA = makeTab({ id: 'tab-a', claudeSessionId: SESS_SHARED });
      const tabB = makeTab({ id: 'tab-b', claudeSessionId: SESS_SHARED });
      tabManager.findTabsBySessionId.mockReturnValue([tabA, tabB]);

      service.handleChatError({
        sessionId: SESS_SHARED,
        error: 'CLI crashed',
      });

      expect(tabManager.applyStatusErrorReset).toHaveBeenCalledWith('tab-a');
      expect(tabManager.applyStatusErrorReset).toHaveBeenCalledWith('tab-b');
      expect(tabManager.markTabIdle).toHaveBeenCalledWith('tab-a');
      expect(tabManager.markTabIdle).toHaveBeenCalledWith('tab-b');
      // Session-level status set ONCE.
      expect(sessionManager.setStatus).toHaveBeenCalledTimes(1);
    });

    it('falls back to the active tab when no tab matches the sessionId', () => {
      tabManager.findTabsBySessionId.mockReturnValue([]);
      const activeTab = makeTab({ id: 'tab-active', claudeSessionId: null });
      tabManager.activeTabId.mockReturnValue('tab-active');
      tabManager.activeTab.mockReturnValue(activeTab);

      service.handleChatError({ sessionId: SESS_UNKNOWN, error: 'boom' });

      expect(tabManager.applyStatusErrorReset).toHaveBeenCalledWith(
        'tab-active',
      );
      expect(tabManager.markTabIdle).toHaveBeenCalledWith('tab-active');
    });

    it('warns and skips when sessionId mismatches the active tab claudeSessionId', () => {
      tabManager.findTabsBySessionId.mockReturnValue([]);
      const activeTab = makeTab({
        id: 'tab-active',
        claudeSessionId: SESS_OTHER,
      });
      tabManager.activeTabId.mockReturnValue('tab-active');
      tabManager.activeTab.mockReturnValue(activeTab);

      service.handleChatError({
        sessionId: SESS_FOREIGN,
        error: 'nope',
      });

      expect(consoleWarn).toHaveBeenCalledWith(
        expect.stringContaining('Error for unknown session'),
        expect.objectContaining({
          sessionId: SESS_FOREIGN,
          activeTabSessionId: SESS_OTHER,
        }),
      );
      expect(tabManager.applyStatusErrorReset).not.toHaveBeenCalled();
      expect(tabManager.markTabIdle).not.toHaveBeenCalled();
    });

    it('warns and aborts when there is no active tab and no matching session', () => {
      tabManager.findTabsBySessionId.mockReturnValue([]);
      tabManager.activeTabId.mockReturnValue(null);
      tabManager.activeTab.mockReturnValue(null);

      service.handleChatError({ sessionId: SESS_X, error: 'y' });

      expect(consoleWarn).toHaveBeenCalledWith(
        expect.stringContaining('No target tab for chat error'),
      );
      expect(tabManager.applyStatusErrorReset).not.toHaveBeenCalled();
    });

    it('falls back to active tab when sessionId is empty string', () => {
      const activeTab = makeTab({ id: 'tab-active', claudeSessionId: null });
      tabManager.activeTabId.mockReturnValue('tab-active');
      tabManager.activeTab.mockReturnValue(activeTab);

      service.handleChatError({ sessionId: '', error: 'bad' });

      // Empty sessionId means findTabsBySessionId is NOT called (guarded by if data.sessionId).
      expect(tabManager.findTabsBySessionId).not.toHaveBeenCalled();
      expect(tabManager.applyStatusErrorReset).toHaveBeenCalledWith(
        'tab-active',
      );
    });

    it('logs the error via console.error before processing', () => {
      tabManager.findTabsBySessionId.mockReturnValue([
        makeTab({ id: 'tab-1', claudeSessionId: SESS_S }),
      ]);
      service.handleChatError({ sessionId: SESS_S, error: 'network' });

      expect(consoleError).toHaveBeenCalledWith(
        expect.stringContaining('Chat error'),
        expect.objectContaining({ sessionId: SESS_S, error: 'network' }),
      );
    });
  });
});
