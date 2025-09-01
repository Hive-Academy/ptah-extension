import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ChatStateManagerService } from './chat-state-manager.service';
import { VSCodeService } from './vscode.service';
import { AppStateManager } from './app-state.service';
import { StrictChatSession } from '@ptah-extension/shared';
import { of, Subject } from 'rxjs';

describe('ChatStateManagerService - Signal Architecture Validation', () => {
  let service: ChatStateManagerService;
  let mockVSCodeService: jasmine.SpyObj<VSCodeService>;
  let mockAppStateManager: jasmine.SpyObj<AppStateManager>;

  const mockSession: StrictChatSession = {
    id: 'test-session-1',
    name: 'Test Chat Session',
    messages: [
      { id: 'msg-1', type: 'user', content: 'Hello', timestamp: Date.now() - 5000 },
      { id: 'msg-2', type: 'assistant', content: 'Hi! How can I help?', timestamp: Date.now() },
    ],
    createdAt: Date.now() - 86400000,
    updatedAt: Date.now(),
    lastActiveAt: Date.now(),
    messageCount: 2,
  };

  const mockSessions: StrictChatSession[] = [mockSession];

  beforeEach(() => {
    const vscodeSpy = jasmine.createSpyObj('VSCodeService', [
      'postMessage', 
      'onMessage', 
      'onMessageType'
    ]);
    
    const appStateSpy = jasmine.createSpyObj('AppStateManager', ['currentSession', 'isLoading']);

    // Setup default mocks
    vscodeSpy.onMessage.and.returnValue(of({ type: 'initialData', data: { sessions: mockSessions } }));
    vscodeSpy.onMessageType.and.returnValue(of({ data: { sessions: mockSessions } }));
    appStateSpy.currentSession.and.returnValue(signal(mockSession));
    appStateSpy.isLoading.and.returnValue(signal(false));

    TestBed.configureTestingModule({
      providers: [
        ChatStateManagerService,
        { provide: VSCodeService, useValue: vscodeSpy },
        { provide: AppStateManager, useValue: appStateSpy },
      ],
    });

    service = TestBed.inject(ChatStateManagerService);
    mockVSCodeService = TestBed.inject(VSCodeService) as jasmine.SpyObj<VSCodeService>;
    mockAppStateManager = TestBed.inject(AppStateManager) as jasmine.SpyObj<AppStateManager>;
  });

  describe('USER REQUIREMENT 1: Service Signal Immutability (Phase 1.2)', () => {
    it('should use readonly modifiers on all private signal properties', () => {
      // VALIDATION: User mentioned "signals hard to debug"
      // Phase 1.2 implementation: Add readonly modifiers to signal properties
      
      // Private signals should be readonly and not accessible from outside
      expect(() => (service as any)._availableSessions = signal([])).toThrow();
      expect(() => (service as any)._isSessionLoading = signal(false)).toThrow();
      expect(() => (service as any)._showSessionManager = signal(false)).toThrow();
      expect(() => (service as any)._selectedAgent = signal('general')).toThrow();
      expect(() => (service as any)._currentMessage = signal('')).toThrow();
    });

    it('should expose public signals via computed or asReadonly patterns', () => {
      // VALIDATION: Phase 1.4 - Secure Service Signal Exposure
      expect(service.availableSessions).toBeDefined();
      expect(service.isSessionLoading).toBeDefined();
      expect(service.showSessionManager).toBeDefined();
      expect(service.selectedAgent).toBeDefined();
      expect(service.currentMessage).toBeDefined();
      
      // Public signals should not have .set() method
      expect((service.availableSessions as any).set).toBeUndefined();
      expect((service.isSessionLoading as any).set).toBeUndefined();
      expect((service.showSessionManager as any).set).toBeUndefined();
    });

    it('should use computed signals for derived state validation', () => {
      // VALIDATION: Computed signals for complex logic debugging
      expect(service.agentOptions).toBeDefined();
      expect(service.canSendMessage).toBeDefined();
      
      const agentOptions = service.agentOptions();
      expect(Array.isArray(agentOptions)).toBe(true);
      expect(agentOptions.length).toBeGreaterThan(0);
      expect(agentOptions[0]).toHaveProperty('value');
      expect(agentOptions[0]).toHaveProperty('label');
      expect(agentOptions[0]).toHaveProperty('description');
    });
  });

  describe('USER REQUIREMENT 2: Modern Dependency Injection (Phase 2.3)', () => {
    it('should use inject() function instead of constructor injection', () => {
      // VALIDATION: Modern Angular 16+ pattern
      // Services should be injected using inject() function
      
      expect(service['vscode']).toBeDefined();
      expect(service['appState']).toBeDefined();
      
      // Should have proper service references
      expect(service['vscode']).toBe(mockVSCodeService);
      expect(service['appState']).toBe(mockAppStateManager);
    });

    it('should properly initialize dependencies on service creation', () => {
      // VALIDATION: Service initialization should work correctly
      expect(service).toBeDefined();
      expect(service).toBeInstanceOf(ChatStateManagerService);
    });
  });

  describe('USER REQUIREMENT 3: Reactive Signal Updates for Debugging', () => {
    it('should provide reactive state updates for session management', () => {
      // VALIDATION: User's "signals hard to debug" should be resolved
      service.initialize();
      
      // Test initial state
      expect(service.availableSessions()).toEqual([]);
      expect(service.isSessionLoading()).toBe(false);
      expect(service.selectedAgent()).toBe('general');
      
      // Test state changes
      service.updateSelectedAgent('code');
      expect(service.selectedAgent()).toBe('code');
      
      service.updateCurrentMessage('Test message');
      expect(service.currentMessage()).toBe('Test message');
    });

    it('should compute canSendMessage based on message content and loading state', () => {
      // VALIDATION: Complex computed signal logic should be debuggable
      service.initialize();
      
      // Empty message should not allow sending
      service.updateCurrentMessage('');
      expect(service.canSendMessage()).toBe(false);
      
      // Non-empty message should allow sending (when not loading)
      service.updateCurrentMessage('Hello Claude');
      expect(service.canSendMessage()).toBe(true);
      
      // Should return false when loading
      mockAppStateManager.isLoading.and.returnValue(signal(true));
      expect(service.canSendMessage()).toBe(false);
    });

    it('should handle available sessions array validation', () => {
      // VALIDATION: Defensive programming for signal state
      service.initialize();
      
      const sessions = service.availableSessions();
      expect(Array.isArray(sessions)).toBe(true);
      
      // Should handle invalid session data gracefully
      const invalidSessionsSubject = new Subject();
      mockVSCodeService.onMessageType.and.returnValue(invalidSessionsSubject);
      
      // Send invalid data
      invalidSessionsSubject.next({ data: { sessions: null } });
      expect(service.availableSessions()).toEqual([]);
      
      // Send valid data
      invalidSessionsSubject.next({ data: { sessions: mockSessions } });
      expect(service.availableSessions().length).toBe(1);
    });
  });

  describe('USER REQUIREMENT 4: Session Management Business Logic', () => {
    it('should handle session switching with proper state management', () => {
      // VALIDATION: Core functionality must work correctly
      service.initialize();
      
      service.switchToSession('test-session-1');
      
      expect(mockVSCodeService.postMessage).toHaveBeenCalledWith({
        type: 'chat:switchSession',
        data: { sessionId: 'test-session-1' },
      });
      
      expect(service.isSessionLoading()).toBe(true);
    });

    it('should handle session creation with loading state', () => {
      // VALIDATION: Session creation workflow
      service.initialize();
      
      service.createNewSession('New Test Session');
      
      expect(mockVSCodeService.postMessage).toHaveBeenCalledWith({
        type: 'chat:createSession',
        data: { name: 'New Test Session' },
      });
      
      expect(service.isSessionLoading()).toBe(true);
    });

    it('should handle session manager UI state', () => {
      // VALIDATION: UI state management
      service.initialize();
      
      expect(service.showSessionManager()).toBe(false);
      
      service.openSessionManager();
      expect(service.showSessionManager()).toBe(true);
      
      service.closeSessionManager();
      expect(service.showSessionManager()).toBe(false);
    });
  });

  describe('USER REQUIREMENT 5: Agent Selection and Input Management', () => {
    it('should provide agent options for user selection', () => {
      // VALIDATION: Agent selection functionality
      const agentOptions = service.agentOptions();
      
      expect(agentOptions).toContain(
        jasmine.objectContaining({
          value: 'general',
          label: 'General Assistant',
          description: jasmine.any(String),
        })
      );
      
      expect(agentOptions).toContain(
        jasmine.objectContaining({
          value: 'code',
          label: 'Code Expert',
          description: jasmine.any(String),
        })
      );
    });

    it('should generate contextual input placeholders based on selected agent', () => {
      // VALIDATION: Dynamic placeholder functionality
      service.updateSelectedAgent('general');
      expect(service.getInputPlaceholder()).toBe('Ask Claude anything...');
      
      service.updateSelectedAgent('code');
      expect(service.getInputPlaceholder()).toBe('Ask your code expert...');
      
      service.updateSelectedAgent('architect');
      expect(service.getInputPlaceholder()).toBe('Discuss system architecture...');
      
      service.updateSelectedAgent('researcher');
      expect(service.getInputPlaceholder()).toBe('Request research and analysis...');
    });

    it('should manage current message state correctly', () => {
      // VALIDATION: Message input state management
      expect(service.currentMessage()).toBe('');
      
      service.updateCurrentMessage('Hello Claude');
      expect(service.currentMessage()).toBe('Hello Claude');
      
      service.clearCurrentMessage();
      expect(service.currentMessage()).toBe('');
    });
  });

  describe('USER REQUIREMENT 6: Error Handling and Data Validation', () => {
    it('should handle session data validation safely', () => {
      // VALIDATION: Defensive programming for user data
      service.initialize();
      
      const invalidSessionsSubject = new Subject();
      mockVSCodeService.onMessageType.and.returnValue(invalidSessionsSubject);
      
      // Should handle missing sessions array
      invalidSessionsSubject.next({ data: {} });
      expect(service.availableSessions()).toEqual([]);
      
      // Should filter invalid session objects
      const mixedSessions = [
        mockSession,
        null,
        { id: 'invalid' }, // Missing name
        { name: 'Invalid' }, // Missing id
        mockSession,
      ];
      
      invalidSessionsSubject.next({ data: { sessions: mixedSessions } });
      const validSessions = service.availableSessions();
      expect(validSessions.length).toBe(2); // Only valid sessions
      expect(validSessions.every(s => s && s.id && s.name)).toBe(true);
    });

    it('should handle service cleanup properly', () => {
      // VALIDATION: Resource cleanup
      service.initialize();
      
      expect(() => service.destroy()).not.toThrow();
      
      // After destroy, should handle gracefully
      expect(() => service.updateCurrentMessage('test')).not.toThrow();
    });
  });
});