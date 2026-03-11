/**
 * Unit tests for SessionManager - Session State Machine
 *
 * Tests cover:
 * - setSessionId() with state parameter
 * - confirmSessionId() state transition (draft → confirmed)
 * - failSession() marks session as failed
 * - isSessionConfirmed() returns correct boolean
 * - getCurrentSessionId() returns current ID regardless of state
 * - Double confirm warning (not error)
 * - Integration test: Full session lifecycle (draft → confirmed)
 * - Draft ID storage and retrieval
 *
 * Validates the new state machine API replacing dual ID system (sessionId + claudeSessionId)
 */

import { TestBed } from '@angular/core/testing';
import { SessionManager } from './session-manager.service';
import { SessionId } from '@ptah-extension/shared';

describe('SessionManager - Session State Machine', () => {
  let service: SessionManager;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [SessionManager],
    });
    service = TestBed.inject(SessionManager);
  });

  // ============================================================================
  // BASIC STATE MACHINE OPERATIONS
  // ============================================================================

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should set session ID with draft state', () => {
    const draftId = 'draft_123' as SessionId;

    service.setSessionId(draftId, 'draft');

    expect(service.sessionId()).toBe(draftId);
    expect(service.sessionState()).toBe('draft');
    expect(service.draftId()).toBe(draftId);
  });

  it('should set session ID with default draft state when state not provided', () => {
    const draftId = 'draft_456' as SessionId;

    service.setSessionId(draftId); // No state parameter

    expect(service.sessionId()).toBe(draftId);
    expect(service.sessionState()).toBe('draft');
    expect(service.draftId()).toBe(draftId);
  });

  it('should confirm session ID and transition to confirmed state', () => {
    const draftId = 'draft_123' as SessionId;
    const confirmedId = 'real_abc' as SessionId;

    // Start with draft
    service.setSessionId(draftId, 'draft');
    expect(service.sessionState()).toBe('draft');
    expect(service.sessionId()).toBe(draftId);

    // Confirm with real ID
    service.confirmSessionId(confirmedId);

    expect(service.sessionId()).toBe(confirmedId);
    expect(service.sessionState()).toBe('confirmed');
    expect(service.draftId()).toBe(draftId); // Draft ID preserved for reference
  });

  it('should warn on double confirm (not error)', () => {
    const confirmedId1 = 'real_abc' as SessionId;
    const confirmedId2 = 'real_xyz' as SessionId;

    // Spy on console.warn
    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

    // First confirm
    service.confirmSessionId(confirmedId1);
    expect(service.sessionState()).toBe('confirmed');
    expect(consoleWarnSpy).not.toHaveBeenCalled();

    // Second confirm (should warn but not throw)
    service.confirmSessionId(confirmedId2);

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Session already confirmed')
    );
    // Session ID should NOT change on double confirm
    expect(service.sessionId()).toBe(confirmedId1);
    expect(service.sessionState()).toBe('confirmed');

    consoleWarnSpy.mockRestore();
  });

  it('should mark session as failed', () => {
    const draftId = 'draft_fail' as SessionId;

    service.setSessionId(draftId, 'draft');
    expect(service.sessionState()).toBe('draft');

    service.failSession();

    expect(service.sessionState()).toBe('failed');
    expect(service.sessionId()).toBe(draftId); // ID preserved
  });

  it('should check if session is confirmed', () => {
    const draftId = 'draft_123' as SessionId;
    const confirmedId = 'real_abc' as SessionId;

    // Draft state - not confirmed
    service.setSessionId(draftId, 'draft');
    expect(service.isSessionConfirmed()).toBe(false);

    // Confirm session
    service.confirmSessionId(confirmedId);
    expect(service.isSessionConfirmed()).toBe(true);

    // Failed state - not confirmed
    service.failSession();
    expect(service.isSessionConfirmed()).toBe(false);
  });

  it('should get current session ID regardless of state', () => {
    const draftId = 'draft_123' as SessionId;
    const confirmedId = 'real_abc' as SessionId;

    // Draft state
    service.setSessionId(draftId, 'draft');
    expect(service.getCurrentSessionId()).toBe(draftId);

    // Confirmed state
    service.confirmSessionId(confirmedId);
    expect(service.getCurrentSessionId()).toBe(confirmedId);

    // Failed state (ID still accessible)
    service.failSession();
    expect(service.getCurrentSessionId()).toBe(confirmedId);
  });

  // ============================================================================
  // STATE TRANSITIONS
  // ============================================================================

  it('should transition from draft to streaming on confirm', () => {
    const draftId = 'draft_123' as SessionId;
    const confirmedId = 'real_abc' as SessionId;

    service.setSessionId(draftId, 'draft');
    service.setStatus('draft');

    service.confirmSessionId(confirmedId);

    // Status should transition to streaming
    expect(service.status()).toBe('streaming');
    expect(service.sessionState()).toBe('confirmed');
  });

  it('should not transition status if not in draft status', () => {
    const confirmedId = 'real_abc' as SessionId;

    service.setStatus('loaded');

    service.confirmSessionId(confirmedId);

    // Status should NOT change (only transitions from draft)
    expect(service.status()).toBe('loaded');
    expect(service.sessionState()).toBe('confirmed');
  });

  // ============================================================================
  // DRAFT ID STORAGE
  // ============================================================================

  it('should store draft ID when setting session with draft state', () => {
    const draftId = 'draft_789' as SessionId;

    service.setSessionId(draftId, 'draft');

    expect(service.draftId()).toBe(draftId);
  });

  it('should NOT store draft ID when setting session with non-draft state', () => {
    const confirmedId = 'real_abc' as SessionId;

    service.setSessionId(confirmedId, 'confirmed');

    expect(service.draftId()).toBeNull();
  });

  it('should preserve draft ID after confirmation', () => {
    const draftId = 'draft_123' as SessionId;
    const confirmedId = 'real_abc' as SessionId;

    service.setSessionId(draftId, 'draft');
    const originalDraftId = service.draftId();

    service.confirmSessionId(confirmedId);

    // Draft ID should be preserved for debugging/reference
    expect(service.draftId()).toBe(originalDraftId);
    expect(service.draftId()).toBe(draftId);
  });

  // ============================================================================
  // CLEAR SESSION
  // ============================================================================

  it('should clear all session state including state machine', () => {
    const draftId = 'draft_123' as SessionId;
    const confirmedId = 'real_abc' as SessionId;

    service.setSessionId(draftId, 'draft');
    service.confirmSessionId(confirmedId);

    service.clearSession();

    expect(service.sessionId()).toBeNull();
    expect(service.sessionId()).toBeNull();
    expect(service.sessionState()).toBe('draft');
    expect(service.draftId()).toBeNull();
    expect(service.status()).toBe('fresh');
  });

  // ============================================================================
  // INTEGRATION TESTS - SESSION LIFECYCLE
  // ============================================================================

  it('should handle full session lifecycle: draft → confirmed', () => {
    const draftId = 'draft_lifecycle_123' as SessionId;
    const confirmedId = 'real_lifecycle_abc' as SessionId;

    // Step 1: User starts new conversation (draft)
    service.setSessionId(draftId, 'draft');
    service.setStatus('draft');

    expect(service.sessionState()).toBe('draft');
    expect(service.sessionId()).toBe(draftId);
    expect(service.draftId()).toBe(draftId);
    expect(service.isSessionConfirmed()).toBe(false);

    // Step 2: Backend resolves session ID (session:id-resolved event)
    service.confirmSessionId(confirmedId);

    expect(service.sessionState()).toBe('confirmed');
    expect(service.sessionId()).toBe(confirmedId);

    expect(service.draftId()).toBe(draftId); // Original draft ID preserved
    expect(service.isSessionConfirmed()).toBe(true);
    expect(service.status()).toBe('streaming'); // Status transitioned

    // Step 3: User continues conversation
    expect(service.getCurrentSessionId()).toBe(confirmedId);
  });

  it('should handle session failure lifecycle: draft → failed', () => {
    const draftId = 'draft_fail_123' as SessionId;

    // Step 1: User starts new conversation (draft)
    service.setSessionId(draftId, 'draft');
    service.setStatus('draft');

    expect(service.sessionState()).toBe('draft');
    expect(service.isSessionConfirmed()).toBe(false);

    // Step 2: RPC fails (network error, backend crash)
    service.failSession();

    expect(service.sessionState()).toBe('failed');
    expect(service.isSessionConfirmed()).toBe(false);
    expect(service.sessionId()).toBe(draftId); // ID preserved for cleanup
  });

  it('should handle session loading lifecycle: loaded session is confirmed', () => {
    const loadedId = 'real_loaded_abc' as SessionId;

    // When loading existing session from backend, set as confirmed immediately
    service.setSessionId(loadedId, 'confirmed');
    service.setStatus('loaded');

    expect(service.sessionState()).toBe('confirmed');
    expect(service.sessionId()).toBe(loadedId);
    expect(service.isSessionConfirmed()).toBe(true);
    expect(service.status()).toBe('loaded');
  });

  // ============================================================================
  // BACKWARD COMPATIBILITY WITH OLD API
  // ============================================================================

  it('should maintain backward compatibility with setClaudeSessionId (deprecated)', () => {
    const realId = 'real_compat_123';

    service.setStatus('draft');
    service.setSessionId(realId);

    expect(service.sessionId()).toBe(realId);
    expect(service.status()).toBe('streaming'); // Old API transitions status
  });

  it('should work with both old and new API during transition period', () => {
    const draftId = 'draft_123' as SessionId;
    const realId = 'real_abc';

    // New API: setSessionId with state
    service.setSessionId(draftId, 'draft');
    expect(service.sessionId()).toBe(draftId);
    expect(service.sessionState()).toBe('draft');

    // Old API: setClaudeSessionId (deprecated but functional)
    service.setStatus('draft');
    service.setSessionId(realId);
    expect(service.sessionId()).toBe(realId);
    expect(service.status()).toBe('streaming');
  });

  // ============================================================================
  // EDGE CASES
  // ============================================================================

  it('should handle null session ID', () => {
    service.setSessionId(null);

    expect(service.sessionId()).toBeNull();
    expect(service.sessionState()).toBe('draft');
    expect(service.draftId()).toBeNull();
    expect(service.getCurrentSessionId()).toBeNull();
  });

  it('should handle empty string session ID', () => {
    const emptyId = '' as SessionId;

    service.setSessionId(emptyId, 'draft');

    expect(service.sessionId()).toBe('');
    expect(service.sessionState()).toBe('draft');
    // draftId should be null for empty string (guard in setSessionId)
    expect(service.draftId()).toBeNull();
  });

  it('should allow confirmation from failed state', () => {
    const draftId = 'draft_fail_then_confirm' as SessionId;
    const confirmedId = 'real_recovered' as SessionId;

    service.setSessionId(draftId, 'draft');
    service.failSession();
    expect(service.sessionState()).toBe('failed');

    // Retry: confirm should work even from failed state
    service.confirmSessionId(confirmedId);

    expect(service.sessionState()).toBe('confirmed');
    expect(service.sessionId()).toBe(confirmedId);
    expect(service.isSessionConfirmed()).toBe(true);
  });

  it('should log confirmation details for debugging', () => {
    const draftId = 'draft_log' as SessionId;
    const confirmedId = 'real_log' as SessionId;

    const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();

    service.setSessionId(draftId, 'draft');
    service.confirmSessionId(confirmedId);

    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('Session ID confirmed'),
      expect.objectContaining({
        draftId,
        confirmedId,
      })
    );

    consoleLogSpy.mockRestore();
  });

  it('should log failure details for debugging', () => {
    const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();

    service.failSession();

    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('Session marked as failed')
    );

    consoleLogSpy.mockRestore();
  });
});
