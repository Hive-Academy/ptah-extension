/**
 * Integration tests for ConversationService
 *
 * Tests focus on cleanup mechanisms (Batch 2 of TASK_2025_054):
 * - RPC failure → verify Map entry removed
 * - Timeout (61s) → verify Map entry removed
 * - Success → verify Map entry removed
 * - Error propagation preserved
 *
 * Uses Jest fake timers to advance clock for timeout testing
 */

import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ConversationService } from './conversation.service';
import {
  ClaudeRpcService,
  VSCodeService,
  RpcResult,
} from '@ptah-extension/core';
import { TabManagerService } from '../tab-manager.service';
import { SessionManager } from '../session-manager.service';
import { SessionLoaderService } from './session-loader.service';
import { PendingSessionManagerService } from '../pending-session-manager.service';
import { SessionId } from '@ptah-extension/shared';
import { TabState } from '../chat.types';

describe('ConversationService - Cleanup Mechanisms (Batch 2)', () => {
  let service: ConversationService;
  let pendingSessionManager: PendingSessionManagerService;
  let claudeRpcService: jest.Mocked<ClaudeRpcService>;
  let vscodeService: jest.Mocked<VSCodeService>;
  let tabManager: jest.Mocked<TabManagerService>;
  let sessionManager: jest.Mocked<SessionManager>;
  let sessionLoader: jest.Mocked<SessionLoaderService>;

  /**
   * Helper function to create a mock TabState
   */
  const createMockTabState = (overrides?: Partial<TabState>): TabState => ({
    id: 'tab_123',
    title: 'Test Tab',
    order: 0,
    status: 'loaded',
    isDirty: false,
    lastActivityAt: Date.now(),
    messages: [],
    streamingState: null,
    currentMessageId: null,
    queuedContent: '',
    claudeSessionId: null,
    ...overrides,
  });

  beforeEach(() => {
    // Mock ClaudeRpcService
    const mockClaudeRpc = {
      call: jest.fn(),
    };

    // Mock VSCodeService
    const mockVSCode = {
      config: jest.fn().mockReturnValue({
        workspaceRoot: '/test/workspace',
      }),
    };

    // Mock TabManagerService
    const mockTabManager = {
      activeTabId: jest.fn().mockReturnValue('tab_123'),
      activeTab: jest.fn().mockReturnValue(createMockTabState()),
      createTab: jest.fn().mockReturnValue('tab_123'),
      switchTab: jest.fn(),
      updateTab: jest.fn(),
      tabs: jest.fn().mockReturnValue([]),
    };

    // Mock SessionManager
    const mockSessionManager = {
      setSessionId: jest.fn(),
      getCurrentSessionId: jest.fn(),
      clearClaudeSessionId: jest.fn(),
      setStatus: jest.fn(),
      clearNodeMaps: jest.fn(),
      isStreaming: jest.fn().mockReturnValue(false),
    };

    // Mock SessionLoaderService
    const mockSessionLoader = {
      loadSessions: jest.fn().mockResolvedValue(undefined),
    };

    TestBed.configureTestingModule({
      providers: [
        ConversationService,
        PendingSessionManagerService,
        { provide: ClaudeRpcService, useValue: mockClaudeRpc },
        { provide: VSCodeService, useValue: mockVSCode },
        { provide: TabManagerService, useValue: mockTabManager },
        { provide: SessionManager, useValue: mockSessionManager },
        { provide: SessionLoaderService, useValue: mockSessionLoader },
      ],
    });

    service = TestBed.inject(ConversationService);
    pendingSessionManager = TestBed.inject(PendingSessionManagerService);
    claudeRpcService = TestBed.inject(
      ClaudeRpcService
    ) as jest.Mocked<ClaudeRpcService>;
    vscodeService = TestBed.inject(VSCodeService) as jest.Mocked<VSCodeService>;
    tabManager = TestBed.inject(
      TabManagerService
    ) as jest.Mocked<TabManagerService>;
    sessionManager = TestBed.inject(
      SessionManager
    ) as jest.Mocked<SessionManager>;
    sessionLoader = TestBed.inject(
      SessionLoaderService
    ) as jest.Mocked<SessionLoaderService>;

    // Install Jest fake timers for timeout testing
    jest.useFakeTimers();
  });

  afterEach(() => {
    // Clear all timers and restore real timers
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  // ============================================================================
  // INTEGRATION TEST: RPC Failure → Cleanup
  // ============================================================================

  it('should cleanup pending resolution on RPC call failure (result.success = false)', async () => {
    // Mock RPC to return failure
    claudeRpcService.call.mockResolvedValue(
      new RpcResult(false, undefined, 'Network error')
    );

    // Spy on pendingSessionManager
    const addSpy = jest.spyOn(pendingSessionManager, 'add');
    const removeSpy = jest.spyOn(pendingSessionManager, 'remove');

    // Call startNewConversation
    await service.startNewConversation('Test message');

    // Verify pendingSessionManager.add() was called
    expect(addSpy).toHaveBeenCalledWith(expect.any(String), 'tab_123');

    // Get the session ID that was added
    const sessionId = addSpy.mock.calls[0][0];

    // Verify pendingSessionManager.remove() was called with same session ID
    expect(removeSpy).toHaveBeenCalledWith(sessionId);

    // Verify Map entry is removed
    expect(pendingSessionManager.has(sessionId)).toBe(false);
  });

  it('should cleanup pending resolution on exception during RPC call', async () => {
    // Mock RPC to throw exception
    claudeRpcService.call.mockRejectedValue(new Error('Network timeout'));

    // Mock sessionManager.getCurrentSessionId to return session ID for cleanup
    let capturedSessionId: string | null = null;
    sessionManager.setSessionId.mockImplementation((id: string | null) => {
      capturedSessionId = id;
    });
    sessionManager.getCurrentSessionId.mockImplementation(() => {
      return (capturedSessionId ?? '') as SessionId;
    });

    // Spy on pendingSessionManager
    const addSpy = jest.spyOn(pendingSessionManager, 'add');
    const removeSpy = jest.spyOn(pendingSessionManager, 'remove');

    // Call startNewConversation (should throw after cleanup)
    try {
      await service.startNewConversation('Test message');
    } catch (error) {
      // Expected to throw
      expect(error).toBeDefined();
    }

    // Verify pendingSessionManager.add() was called
    expect(addSpy).toHaveBeenCalledWith(expect.any(String), 'tab_123');

    // Get the session ID that was added
    const sessionId = addSpy.mock.calls[0][0];

    // Verify pendingSessionManager.remove() was called in catch block
    expect(removeSpy).toHaveBeenCalledWith(sessionId);

    // Verify Map entry is removed
    expect(pendingSessionManager.has(sessionId)).toBe(false);
  });

  it('should preserve error propagation after cleanup', async () => {
    // Mock RPC to throw exception
    const testError = new Error('Test error for propagation');
    claudeRpcService.call.mockRejectedValue(testError);

    // Mock sessionManager to return session ID for cleanup
    let capturedSessionId: string | null = null;
    sessionManager.setSessionId.mockImplementation((id: string | null) => {
      capturedSessionId = id;
    });
    sessionManager.getCurrentSessionId.mockImplementation(() => {
      return (capturedSessionId ?? '') as SessionId;
    });

    // Verify error is rethrown after cleanup
    await expect(service.startNewConversation('Test message')).rejects.toThrow(
      'Test error for propagation'
    );
  });

  // ============================================================================
  // INTEGRATION TEST: Timeout → Auto-cleanup
  // ============================================================================

  it('should auto-cleanup pending resolution after 60s timeout', async () => {
    // Mock RPC to return success (but never emit session:id-resolved)
    claudeRpcService.call.mockResolvedValue(
      new RpcResult(true, { sessionId: 'real_session_123' })
    );

    // Spy on console.warn
    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

    // Spy on pendingSessionManager
    const addSpy = jest.spyOn(pendingSessionManager, 'add');

    // Call startNewConversation
    await service.startNewConversation('Test message');

    // Verify pendingSessionManager.add() was called
    expect(addSpy).toHaveBeenCalledWith(expect.any(String), 'tab_123');

    // Get the session ID that was added
    const sessionId = addSpy.mock.calls[0][0];

    // Verify session is pending
    expect(pendingSessionManager.has(sessionId)).toBe(true);

    // Advance clock by 59 seconds (should NOT timeout yet)
    jest.advanceTimersByTime(59000);
    expect(pendingSessionManager.has(sessionId)).toBe(true);

    // Advance clock by 1 more second (total 60 seconds - should timeout)
    jest.advanceTimersByTime(1000);

    // Verify auto-cleanup fired
    expect(pendingSessionManager.has(sessionId)).toBe(false);

    // Verify warning was logged
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining(`Timeout for session: ${sessionId}`)
    );

    consoleWarnSpy.mockRestore();
  });

  // ============================================================================
  // INTEGRATION TEST: Success → Cleanup via session:id-resolved
  // ============================================================================

  it('should cleanup pending resolution on success (simulated session:id-resolved)', async () => {
    // Mock RPC to return success
    claudeRpcService.call.mockResolvedValue(
      new RpcResult(true, { sessionId: 'real_session_123' })
    );

    // Spy on pendingSessionManager
    const addSpy = jest.spyOn(pendingSessionManager, 'add');
    const removeSpy = jest.spyOn(pendingSessionManager, 'remove');

    // Call startNewConversation
    await service.startNewConversation('Test message');

    // Verify pendingSessionManager.add() was called
    expect(addSpy).toHaveBeenCalledWith(expect.any(String), 'tab_123');

    // Get the session ID that was added
    const sessionId = addSpy.mock.calls[0][0];

    // Verify session is pending
    expect(pendingSessionManager.has(sessionId)).toBe(true);

    // Simulate session:id-resolved event (happens in SessionLoaderService)
    pendingSessionManager.remove(sessionId);

    // Verify Map entry is removed
    expect(pendingSessionManager.has(sessionId)).toBe(false);

    // Verify timeout does NOT fire after manual removal
    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
    jest.advanceTimersByTime(60000);
    expect(consoleWarnSpy).not.toHaveBeenCalled();
    consoleWarnSpy.mockRestore();
  });

  // ============================================================================
  // INTEGRATION TEST: Full Lifecycle Scenarios
  // ============================================================================

  it('should handle typical session lifecycle: add → RPC success → manual cleanup', async () => {
    // Mock RPC to return success
    claudeRpcService.call.mockResolvedValue(
      new RpcResult(true, { sessionId: 'real_session_abc' })
    );

    // Spy on pendingSessionManager
    const addSpy = jest.spyOn(pendingSessionManager, 'add');

    // Step 1: Start new conversation
    await service.startNewConversation('Hello');

    // Step 2: Verify pending resolution added
    const sessionId = addSpy.mock.calls[0][0];
    expect(pendingSessionManager.has(sessionId)).toBe(true);

    // Step 3: Simulate RPC success (2 seconds)
    jest.advanceTimersByTime(2000);

    // Step 4: Simulate session:id-resolved event (SessionLoaderService handles this)
    pendingSessionManager.remove(sessionId);

    // Step 5: Verify cleanup
    expect(pendingSessionManager.has(sessionId)).toBe(false);

    // Step 6: Verify timeout does NOT fire
    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
    jest.advanceTimersByTime(60000);
    expect(consoleWarnSpy).not.toHaveBeenCalled();
    consoleWarnSpy.mockRestore();
  });

  it('should handle RPC failure lifecycle: add → RPC fail → error cleanup', async () => {
    // Mock RPC to return failure
    claudeRpcService.call.mockResolvedValue(
      new RpcResult(false, undefined, 'Backend error')
    );

    // Spy on pendingSessionManager
    const addSpy = jest.spyOn(pendingSessionManager, 'add');
    const removeSpy = jest.spyOn(pendingSessionManager, 'remove');

    // Step 1: Start new conversation (fails)
    await service.startNewConversation('Hello');

    // Step 2: Verify pending resolution added
    const sessionId = addSpy.mock.calls[0][0];
    expect(addSpy).toHaveBeenCalledWith(sessionId, 'tab_123');

    // Step 3: Verify error cleanup called
    expect(removeSpy).toHaveBeenCalledWith(sessionId);

    // Step 4: Verify Map entry removed
    expect(pendingSessionManager.has(sessionId)).toBe(false);

    // Step 5: Verify timeout does NOT fire (cleanup already happened)
    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
    jest.advanceTimersByTime(60000);
    expect(consoleWarnSpy).not.toHaveBeenCalled();
    consoleWarnSpy.mockRestore();
  });

  it('should handle timeout lifecycle: add → never resolved → auto-cleanup', async () => {
    // Mock RPC to return success (but never emit session:id-resolved)
    claudeRpcService.call.mockResolvedValue(
      new RpcResult(true, { sessionId: 'stuck_session' })
    );

    // Spy on console.warn
    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

    // Spy on pendingSessionManager
    const addSpy = jest.spyOn(pendingSessionManager, 'add');

    // Step 1: Start new conversation
    await service.startNewConversation('Hello');

    // Step 2: Verify pending resolution added
    const sessionId = addSpy.mock.calls[0][0];
    expect(pendingSessionManager.has(sessionId)).toBe(true);

    // Step 3: Simulate backend never responding (60 seconds pass)
    jest.advanceTimersByTime(60000);

    // Step 4: Verify auto-cleanup fired
    expect(pendingSessionManager.has(sessionId)).toBe(false);

    // Step 5: Verify warning logged
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining(`Timeout for session: ${sessionId}`)
    );

    consoleWarnSpy.mockRestore();
  });

  // ============================================================================
  // EDGE CASE: Multiple Concurrent Sessions
  // ============================================================================

  it('should handle multiple concurrent sessions with independent cleanup', async () => {
    // Mock RPC to return success
    claudeRpcService.call.mockResolvedValue(
      new RpcResult(true, { sessionId: 'session_x' })
    );

    // Create multiple tabs
    tabManager.activeTabId.mockReturnValueOnce('tab_1');
    tabManager.activeTabId.mockReturnValueOnce('tab_2');
    tabManager.activeTabId.mockReturnValueOnce('tab_3');

    tabManager.activeTab.mockReturnValueOnce(
      createMockTabState({ id: 'tab_1', title: 'Tab 1' })
    );
    tabManager.activeTab.mockReturnValueOnce(
      createMockTabState({ id: 'tab_2', title: 'Tab 2' })
    );
    tabManager.activeTab.mockReturnValueOnce(
      createMockTabState({ id: 'tab_3', title: 'Tab 3' })
    );

    // Spy on pendingSessionManager
    const addSpy = jest.spyOn(pendingSessionManager, 'add');

    // Start 3 concurrent conversations
    await service.startNewConversation('Message 1');
    await service.startNewConversation('Message 2');
    await service.startNewConversation('Message 3');

    // Verify 3 pending resolutions added
    expect(addSpy).toHaveBeenCalledTimes(3);
    const sessionIds = addSpy.mock.calls.map((call) => call[0]);

    // Verify all 3 sessions are pending
    expect(pendingSessionManager.has(sessionIds[0])).toBe(true);
    expect(pendingSessionManager.has(sessionIds[1])).toBe(true);
    expect(pendingSessionManager.has(sessionIds[2])).toBe(true);

    // Manually resolve session 2 (simulate session:id-resolved)
    pendingSessionManager.remove(sessionIds[1]);

    // Verify session 2 removed, others still pending
    expect(pendingSessionManager.has(sessionIds[0])).toBe(true);
    expect(pendingSessionManager.has(sessionIds[1])).toBe(false);
    expect(pendingSessionManager.has(sessionIds[2])).toBe(true);

    // Advance clock to trigger timeout for remaining sessions
    jest.advanceTimersByTime(60000);

    // Verify sessions 1 and 3 timeout (session 2 already removed)
    expect(pendingSessionManager.has(sessionIds[0])).toBe(false);
    expect(pendingSessionManager.has(sessionIds[1])).toBe(false);
    expect(pendingSessionManager.has(sessionIds[2])).toBe(false);
  });

  // ============================================================================
  // EDGE CASE: continueConversation() does NOT need cleanup
  // ============================================================================

  it('should NOT add pending resolution for continueConversation()', async () => {
    // Mock RPC to return success
    claudeRpcService.call.mockResolvedValue(
      new RpcResult(true, { sessionId: 'existing_session' })
    );

    // Mock existing session
    tabManager.activeTab.mockReturnValue(
      createMockTabState({
        id: 'tab_123',
        title: 'Existing Tab',
        status: 'loaded',
        claudeSessionId: 'existing_session_id' as SessionId,
      })
    );

    // Spy on pendingSessionManager
    const addSpy = jest.spyOn(pendingSessionManager, 'add');

    // Call continueConversation
    await service.continueConversation('Follow-up message');

    // Verify pendingSessionManager.add() was NOT called
    expect(addSpy).not.toHaveBeenCalled();

    // No cleanup needed for continueConversation
  });
});
