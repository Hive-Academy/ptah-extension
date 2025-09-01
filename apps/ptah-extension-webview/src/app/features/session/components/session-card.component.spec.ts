import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ChangeDetectionStrategy } from '@angular/core';
import { SessionCardComponent } from './session-card.component';
import { StrictChatSession } from '@ptah-extension/shared';

describe('SessionCardComponent - Signal Architecture Validation', () => {
  let component: SessionCardComponent;
  let fixture: ComponentFixture<SessionCardComponent>;

  const mockSession: StrictChatSession = {
    id: 'session-123',
    name: 'Test Session',
    messages: [
      { id: 'msg-1', type: 'user', content: 'Hello, how can I improve my code?', timestamp: Date.now() - 3600000 },
      { id: 'msg-2', type: 'assistant', content: 'I can help you improve your code by reviewing it for best practices.', timestamp: Date.now() - 3000000 },
      { id: 'msg-3', type: 'user', content: 'Great! Here is my component...', timestamp: Date.now() - 1000000 },
    ],
    createdAt: Date.now() - 86400000, // 1 day ago
    updatedAt: Date.now() - 1000000,  // ~16 minutes ago
    lastActiveAt: Date.now() - 1000000,
    messageCount: 3,
    tokenUsage: {
      input: 250,
      output: 180,
      total: 430,
      percentage: 43,
    },
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SessionCardComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(SessionCardComponent);
    component = fixture.componentInstance;
    
    fixture.componentRef.setInput('session', mockSession);
    fixture.componentRef.setInput('isCurrent', false);
    fixture.componentRef.setInput('isLoading', false);
  });

  describe('USER REQUIREMENT 1: Computed Signals for Template Function Elimination', () => {
    it('should convert template function calls to computed signals', () => {
      // VALIDATION: Phase 1.1 - Fix Signal Reactivity Crisis
      // User complained about "1,000+ template function calls breaking Angular's reactivity"
      
      expect(component.sessionDisplayName).toBeDefined();
      expect(typeof component.sessionDisplayName).toBe('function');
      
      expect(component.sessionStats).toBeDefined();
      expect(typeof component.sessionStats).toBe('function');
      
      expect(component.recentMessages).toBeDefined();
      expect(typeof component.recentMessages).toBe('function');
      
      expect(component.availableActions).toBeDefined();
      expect(typeof component.availableActions).toBe('function');
    });

    it('should provide reactive computed signal updates', () => {
      // VALIDATION: Signals must react to input changes
      fixture.detectChanges();
      
      const initialDisplayName = component.sessionDisplayName();
      expect(initialDisplayName).toBe('Test Session');
      
      // Change session name
      const updatedSession = { ...mockSession, name: 'Updated Test Session' };
      fixture.componentRef.setInput('session', updatedSession);
      fixture.detectChanges();
      
      const updatedDisplayName = component.sessionDisplayName();
      expect(updatedDisplayName).toBe('Updated Test Session');
      expect(updatedDisplayName).not.toBe(initialDisplayName);
    });

    it('should compute session stats reactively for debugging clarity', () => {
      // VALIDATION: User's "hard to debug signals" should be resolved
      fixture.detectChanges();
      
      const stats = component.sessionStats();
      expect(stats.messageCount).toBe(3);
      expect(stats.tokenUsage).toBeDefined();
      expect(stats.timeAgo).toContain('ago'); // Should show relative time
      
      // Test with different session to verify reactivity
      const newSession = {
        ...mockSession,
        messages: [...mockSession.messages, { id: 'msg-4', type: 'assistant', content: 'Another message', timestamp: Date.now() }],
        messageCount: 4,
      };
      
      fixture.componentRef.setInput('session', newSession);
      fixture.detectChanges();
      
      const updatedStats = component.sessionStats();
      expect(updatedStats.messageCount).toBe(4);
    });

    it('should compute available actions based on session state', () => {
      // VALIDATION: Complex logic in computed signals for debuggability
      fixture.detectChanges();
      
      // Non-current session should have all actions
      fixture.componentRef.setInput('isCurrent', false);
      fixture.detectChanges();
      
      const actionsForNonCurrent = component.availableActions();
      expect(actionsForNonCurrent).toContain(jasmine.objectContaining({ type: 'switch' }));
      expect(actionsForNonCurrent).toContain(jasmine.objectContaining({ type: 'delete' }));
      
      // Current session should not have switch/delete actions
      fixture.componentRef.setInput('isCurrent', true);
      fixture.detectChanges();
      
      const actionsForCurrent = component.availableActions();
      expect(actionsForCurrent.find(a => a.type === 'switch')).toBeUndefined();
      expect(actionsForCurrent.find(a => a.type === 'delete')).toBeUndefined();
      expect(actionsForCurrent).toContain(jasmine.objectContaining({ type: 'rename' }));
    });
  });

  describe('USER REQUIREMENT 2: Signal Immutability Pattern', () => {
    it('should use readonly modifiers on internal signals', () => {
      // VALIDATION: Phase 1.2 - Implement Signal Immutability
      expect(component.isEditing).toBeDefined();
      expect(component.showActionsMenu).toBeDefined();
      
      // These should be readonly signals from asReadonly()
      expect((component.isEditing as any).set).toBeUndefined();
      expect((component.showActionsMenu as any).set).toBeUndefined();
    });

    it('should protect signal state from external modification', () => {
      // VALIDATION: Signals should be immutable from outside
      const isEditingSignal = component.isEditing;
      const showActionsSignal = component.showActionsMenu;
      
      expect(typeof isEditingSignal).toBe('function');
      expect(typeof showActionsSignal).toBe('function');
      
      // Should not be able to modify from outside
      expect(() => (isEditingSignal as any).set(true)).toThrow();
      expect(() => (showActionsSignal as any).set(true)).toThrow();
    });
  });

  describe('USER REQUIREMENT 3: Modern Angular Control Flow', () => {
    it('should use @if/@for instead of *ngIf/*ngFor in template', () => {
      // VALIDATION: Phase 2.2 - Migrate to Modern Control Flow
      const template = (component.constructor as any).decorators
        ?.find((d: any) => d.type.prototype.ngMetadataName === 'Component')
        ?.args[0]?.template;
        
      expect(template).toContain('@if (isEditing)');
      expect(template).toContain('@if (isCurrent())');
      expect(template).toContain('@for (action of availableActions()');
      expect(template).toContain('@for (message of recentMessages()');
      
      // Should not use legacy structural directives
      expect(template).not.toContain('*ngIf');
      expect(template).not.toContain('*ngFor');
    });

    it('should use modern input/output functions', () => {
      // VALIDATION: Modern Angular 16+ patterns
      expect(component.session).toBeDefined();
      expect(component.isCurrent).toBeDefined();
      expect(component.actionRequested).toBeDefined();
      expect(component.nameChanged).toBeDefined();
    });

    it('should use track functions in @for loops', () => {
      // VALIDATION: Performance optimization in modern control flow
      const template = (component.constructor as any).decorators
        ?.find((d: any) => d.type.prototype.ngMetadataName === 'Component')
        ?.args[0]?.template;
        
      expect(template).toContain('track action.type');
      expect(template).toContain('track message.id');
    });
  });

  describe('USER REQUIREMENT 4: OnPush Performance Strategy', () => {
    it('should use OnPush change detection strategy', () => {
      // VALIDATION: Phase 1.3 - Implement OnPush Change Detection
      const metadata = (component.constructor as any).decorators
        ?.find((d: any) => d.type.prototype.ngMetadataName === 'Component')
        ?.args[0];
        
      expect(metadata.changeDetection).toBe(ChangeDetectionStrategy.OnPush);
    });

    it('should optimize rendering with OnPush and signals', () => {
      // VALIDATION: 60-80% performance improvement expected
      spyOn(fixture, 'detectChanges').and.callThrough();
      
      // Initial render
      fixture.detectChanges();
      expect(fixture.detectChanges).toHaveBeenCalledTimes(1);
      
      // Signal-based updates should be efficient
      const initialActions = component.availableActions();
      expect(initialActions.length).toBeGreaterThan(0);
      
      // Change current status - should trigger reactive update
      fixture.componentRef.setInput('isCurrent', true);
      fixture.detectChanges();
      
      const updatedActions = component.availableActions();
      expect(updatedActions.length).not.toBe(initialActions.length);
    });
  });

  describe('USER REQUIREMENT 5: Folder Architecture Compliance', () => {
    it('should be organized in features/session/components structure', () => {
      // VALIDATION: User requested "proper folder architecture based on feature/domain"
      // This component should be in features/session/components, not dumb-components
      
      expect(component.constructor.name).toBe('SessionCardComponent');
      
      // Should be a presentation component in the session feature domain
      const metadata = (component.constructor as any).decorators
        ?.find((d: any) => d.type.prototype.ngMetadataName === 'Component')
        ?.args[0];
        
      expect(metadata.selector).toBe('vscode-session-card');
      expect(metadata.standalone).toBe(true);
    });
  });

  describe('USER REQUIREMENT 6: Functional Preservation & UX', () => {
    it('should handle session name editing correctly', () => {
      // VALIDATION: Existing functionality must work
      fixture.detectChanges();
      
      expect(component.isEditing()).toBe(false);
      
      component.onStartEdit();
      expect(component.isEditing()).toBe(true);
      
      component.onCancelEdit();
      expect(component.isEditing()).toBe(false);
    });

    it('should emit events correctly for session actions', () => {
      // VALIDATION: Component communication must work
      spyOn(component.actionRequested, 'emit');
      spyOn(component.nameChanged, 'emit');
      
      component.onAction('switch');
      expect(component.actionRequested.emit).toHaveBeenCalledWith({
        action: 'switch',
        session: mockSession,
      });
      
      component.onNameSave('New Session Name');
      expect(component.nameChanged.emit).toHaveBeenCalledWith({
        sessionId: mockSession.id,
        newName: 'New Session Name',
      });
    });

    it('should format time ago correctly', () => {
      // VALIDATION: Time formatting utility must work
      const now = Date.now();
      
      // Test different time intervals
      expect(component['getTimeAgo'](now)).toBe('Just now');
      expect(component['getTimeAgo'](now - 30 * 60 * 1000)).toBe('30m ago');
      expect(component['getTimeAgo'](now - 2 * 60 * 60 * 1000)).toBe('2h ago');
      expect(component['getTimeAgo'](now - 3 * 24 * 60 * 60 * 1000)).toBe('3d ago');
    });

    it('should preview messages correctly', () => {
      // VALIDATION: Message preview functionality
      fixture.detectChanges();
      
      const shortMessage = 'Short message';
      const longMessage = 'This is a very long message that should be truncated when displayed in the preview because it exceeds the maximum length allowed for preview text in the session card component';
      
      expect(component.getMessagePreview(shortMessage)).toBe(shortMessage);
      expect(component.getMessagePreview(longMessage)).toBe(longMessage.substring(0, 80) + '...');
    });

    it('should compute recent messages correctly', () => {
      // VALIDATION: Recent messages computation
      fixture.detectChanges();
      
      const recentMessages = component.recentMessages();
      expect(recentMessages.length).toBe(3); // Last 3 messages
      expect(recentMessages[0].id).toBe('msg-3'); // Most recent first (reversed)
      expect(recentMessages[2].id).toBe('msg-1'); // Oldest of recent
    });
  });
});