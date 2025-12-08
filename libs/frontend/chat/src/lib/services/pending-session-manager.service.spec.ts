/**
 * Unit tests for PendingSessionManagerService
 *
 * Tests cover:
 * - add() creates entry in Map
 * - get() retrieves entry
 * - remove() clears entry and timeout
 * - has() returns correct boolean
 * - Timeout fires after 60s and auto-cleans up
 * - remove() prevents timeout from firing (clearTimeout validation)
 *
 * Uses Jest fake timers to advance clock for timeout testing
 */

import { TestBed } from '@angular/core/testing';
import { PendingSessionManagerService } from './pending-session-manager.service';

describe('PendingSessionManagerService', () => {
  let service: PendingSessionManagerService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [PendingSessionManagerService],
    });
    service = TestBed.inject(PendingSessionManagerService);

    // Install Jest fake timers for timeout testing
    jest.useFakeTimers();
  });

  afterEach(() => {
    // Clear all timers and restore real timers
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  // ============================================================================
  // BASIC OPERATIONS
  // ============================================================================

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should add pending resolution', () => {
    const sessionId = 'session_123';
    const tabId = 'tab_456';

    service.add(sessionId, tabId);

    expect(service.has(sessionId)).toBe(true);
    expect(service.get(sessionId)).toBe(tabId);
  });

  it('should get tab ID for pending session', () => {
    const sessionId = 'session_123';
    const tabId = 'tab_456';

    service.add(sessionId, tabId);

    expect(service.get(sessionId)).toBe(tabId);
  });

  it('should return undefined for non-existent session', () => {
    expect(service.get('non_existent')).toBeUndefined();
  });

  it('should check if session has pending resolution', () => {
    const sessionId = 'session_123';
    const tabId = 'tab_456';

    expect(service.has(sessionId)).toBe(false);

    service.add(sessionId, tabId);

    expect(service.has(sessionId)).toBe(true);
  });

  it('should remove pending resolution', () => {
    const sessionId = 'session_123';
    const tabId = 'tab_456';

    service.add(sessionId, tabId);
    expect(service.has(sessionId)).toBe(true);

    const removedTabId = service.remove(sessionId);

    expect(removedTabId).toBe(tabId);
    expect(service.has(sessionId)).toBe(false);
    expect(service.get(sessionId)).toBeUndefined();
  });

  it('should return undefined when removing non-existent session', () => {
    const removedTabId = service.remove('non_existent');

    expect(removedTabId).toBeUndefined();
  });

  // ============================================================================
  // TIMEOUT BEHAVIOR
  // ============================================================================

  it('should auto-cleanup after 60 seconds timeout', () => {
    const sessionId = 'session_123';
    const tabId = 'tab_456';

    // Spy on console.warn to verify timeout warning
    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

    service.add(sessionId, tabId);
    expect(service.has(sessionId)).toBe(true);

    // Advance clock by 59 seconds (should NOT timeout yet)
    jest.advanceTimersByTime(59000);
    expect(service.has(sessionId)).toBe(true);

    // Advance clock by 1 more second (total 60 seconds - should timeout)
    jest.advanceTimersByTime(1000);

    // Verify timeout fired and cleaned up
    expect(service.has(sessionId)).toBe(false);
    expect(service.get(sessionId)).toBeUndefined();

    // Verify warning was logged
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Timeout for session: session_123')
    );

    consoleWarnSpy.mockRestore();
  });

  it('should log warning message on timeout', () => {
    const sessionId = 'session_timeout_test';
    const tabId = 'tab_789';

    // Spy on console.warn
    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

    service.add(sessionId, tabId);

    // Advance clock to trigger timeout
    jest.advanceTimersByTime(60000);

    // Verify warning message format
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        '[PendingSessionManager] Timeout for session: session_timeout_test'
      )
    );

    consoleWarnSpy.mockRestore();
  });

  it('should prevent timeout from firing when removed early', () => {
    const sessionId = 'session_123';
    const tabId = 'tab_456';

    // Spy on console.warn to verify timeout does NOT fire
    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

    service.add(sessionId, tabId);
    expect(service.has(sessionId)).toBe(true);

    // Remove BEFORE timeout (should clear timeout)
    service.remove(sessionId);

    // Advance clock by 60 seconds (timeout should NOT fire because clearTimeout was called)
    jest.advanceTimersByTime(60000);

    // Verify session is still removed (not re-added by timeout)
    expect(service.has(sessionId)).toBe(false);

    // Verify warning was NOT logged (timeout was cancelled)
    expect(consoleWarnSpy).not.toHaveBeenCalled();

    consoleWarnSpy.mockRestore();
  });

  // ============================================================================
  // EDGE CASES
  // ============================================================================

  it('should handle rapid add/remove calls without memory leak', () => {
    const sessionId = 'session_rapid';
    const tabId = 'tab_rapid';

    // Add and remove 100 times
    for (let i = 0; i < 100; i++) {
      service.add(`${sessionId}_${i}`, `${tabId}_${i}`);
      service.remove(`${sessionId}_${i}`);
    }

    // Verify all sessions are removed
    for (let i = 0; i < 100; i++) {
      expect(service.has(`${sessionId}_${i}`)).toBe(false);
    }

    // Advance clock to verify no orphaned timeouts fire
    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
    jest.advanceTimersByTime(60000);
    expect(consoleWarnSpy).not.toHaveBeenCalled();
    consoleWarnSpy.mockRestore();
  });

  it('should handle multiple concurrent pending sessions', () => {
    const sessions = [
      { sessionId: 'session_1', tabId: 'tab_1' },
      { sessionId: 'session_2', tabId: 'tab_2' },
      { sessionId: 'session_3', tabId: 'tab_3' },
    ];

    // Add all sessions
    sessions.forEach(({ sessionId, tabId }) => {
      service.add(sessionId, tabId);
    });

    // Verify all sessions exist
    sessions.forEach(({ sessionId, tabId }) => {
      expect(service.has(sessionId)).toBe(true);
      expect(service.get(sessionId)).toBe(tabId);
    });

    // Remove middle session
    service.remove('session_2');

    // Verify middle session removed, others still exist
    expect(service.has('session_1')).toBe(true);
    expect(service.has('session_2')).toBe(false);
    expect(service.has('session_3')).toBe(true);

    // Verify timeout for remaining sessions
    jest.advanceTimersByTime(60000);

    // Only session_1 and session_3 should timeout (session_2 was removed early)
    expect(service.has('session_1')).toBe(false);
    expect(service.has('session_3')).toBe(false);
  });

  it('should clear timeout when remove is called', () => {
    const sessionId = 'session_clear_timeout';
    const tabId = 'tab_clear';

    // Add session
    service.add(sessionId, tabId);

    // Remove immediately (should call clearTimeout internally)
    service.remove(sessionId);

    // Spy on console.warn AFTER removal
    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

    // Advance clock past timeout duration
    jest.advanceTimersByTime(61000);

    // Verify timeout did NOT fire (clearTimeout worked)
    expect(consoleWarnSpy).not.toHaveBeenCalled();
    expect(service.has(sessionId)).toBe(false);

    consoleWarnSpy.mockRestore();
  });

  it('should handle empty string session IDs', () => {
    const sessionId = '';
    const tabId = 'tab_empty';

    service.add(sessionId, tabId);

    expect(service.has(sessionId)).toBe(true);
    expect(service.get(sessionId)).toBe(tabId);

    service.remove(sessionId);
    expect(service.has(sessionId)).toBe(false);
  });

  it('should handle empty string tab IDs', () => {
    const sessionId = 'session_empty_tab';
    const tabId = '';

    service.add(sessionId, tabId);

    expect(service.get(sessionId)).toBe(tabId);
    expect(service.get(sessionId)).toBe('');

    const removed = service.remove(sessionId);
    expect(removed).toBe('');
  });

  // ============================================================================
  // INTEGRATION SCENARIOS
  // ============================================================================

  it('should simulate typical session lifecycle: add -> RPC success -> remove', () => {
    const sessionId = 'session_lifecycle_success';
    const tabId = 'tab_lifecycle';

    // Step 1: Add pending resolution (conversation starts)
    service.add(sessionId, tabId);
    expect(service.has(sessionId)).toBe(true);

    // Step 2: Simulate RPC success (session ID resolved quickly)
    jest.advanceTimersByTime(2000); // 2 seconds (typical RPC roundtrip)

    // Step 3: Remove pending resolution (session:id-resolved event)
    const resolvedTabId = service.remove(sessionId);
    expect(resolvedTabId).toBe(tabId);
    expect(service.has(sessionId)).toBe(false);

    // Step 4: Verify timeout does NOT fire after removal
    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
    jest.advanceTimersByTime(60000);
    expect(consoleWarnSpy).not.toHaveBeenCalled();
    consoleWarnSpy.mockRestore();
  });

  it('should simulate RPC failure scenario: add -> RPC fail -> remove -> cleanup', () => {
    const sessionId = 'session_lifecycle_failure';
    const tabId = 'tab_failure';

    // Step 1: Add pending resolution (conversation starts)
    service.add(sessionId, tabId);
    expect(service.has(sessionId)).toBe(true);

    // Step 2: Simulate RPC failure (network error, backend crash)
    jest.advanceTimersByTime(5000); // 5 seconds (RPC fails)

    // Step 3: Error handler removes pending resolution
    service.remove(sessionId);
    expect(service.has(sessionId)).toBe(false);

    // Step 4: Verify cleanup prevents memory leak
    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
    jest.advanceTimersByTime(60000);
    expect(consoleWarnSpy).not.toHaveBeenCalled();
    consoleWarnSpy.mockRestore();
  });

  it('should simulate timeout scenario: add -> never resolved -> auto-cleanup', () => {
    const sessionId = 'session_timeout_scenario';
    const tabId = 'tab_timeout';

    // Step 1: Add pending resolution (conversation starts)
    service.add(sessionId, tabId);
    expect(service.has(sessionId)).toBe(true);

    // Step 2: Simulate backend never responding (stuck RPC)
    // User waits for 60 seconds...
    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
    jest.advanceTimersByTime(60000);

    // Step 3: Verify auto-cleanup fired
    expect(service.has(sessionId)).toBe(false);
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Timeout for session: session_timeout_scenario')
    );

    consoleWarnSpy.mockRestore();
  });
});
