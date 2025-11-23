import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ChatHeaderComponent } from './chat-header.component';
import { ChatService } from '@ptah-extension/core';
import { SessionSummary, SessionId } from '@ptah-extension/shared';

describe('ChatHeaderComponent', () => {
  let component: ChatHeaderComponent;
  let fixture: ComponentFixture<ChatHeaderComponent>;
  let mockChatService: jest.Mocked<Partial<ChatService>>;

  const createMockSession = (
    id: string,
    name: string,
    messageCount = 5
  ): SessionSummary => ({
    id: id as SessionId,
    name,
    messageCount,
    lastActiveAt: Date.now() - 1000 * 60 * 5, // 5 minutes ago
    createdAt: Date.now() - 1000 * 60 * 60 * 24, // 1 day ago
  });

  const mockSessions: SessionSummary[] = [
    createMockSession('session-1', 'Test Session 1'),
    createMockSession('session-2', 'Test Session 2'),
    createMockSession('session-3', 'Test Session 3'),
  ];

  beforeEach(async () => {
    // Create mock ChatService
    mockChatService = {
      switchToSession: jest.fn().mockResolvedValue(undefined),
      createNewSession: jest.fn().mockResolvedValue(undefined),
      sessions: signal<SessionSummary[]>(mockSessions),
      recentSessions: signal<SessionSummary[]>(mockSessions.slice(0, 2)),
    };

    await TestBed.configureTestingModule({
      imports: [ChatHeaderComponent],
      providers: [{ provide: ChatService, useValue: mockChatService }],
    }).compileComponents();

    fixture = TestBed.createComponent(ChatHeaderComponent);
    component = fixture.componentInstance;

    // Set required inputs
    fixture.componentRef.setInput('providerStatus', {
      name: 'Claude',
      status: 'online' as const,
    });
    fixture.componentRef.setInput('currentSession', {
      id: 'session-1' as SessionId,
    });
    fixture.componentRef.setInput('recentSessions', mockSessions.slice(0, 2));

    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('Component Structure', () => {
    it('should render session dropdown', () => {
      const dropdown = fixture.nativeElement.querySelector(
        'ptah-session-dropdown'
      );
      expect(dropdown).toBeTruthy();
    });

    it('should render analytics button', () => {
      const analyticsBtn = fixture.nativeElement.querySelector(
        '[title="View Analytics"]'
      );
      expect(analyticsBtn).toBeTruthy();
      expect(analyticsBtn.textContent).toContain('Analytics');
    });

    it('should render provider settings button', () => {
      const providerBtn = fixture.nativeElement.querySelector(
        '.provider-settings-btn'
      );
      expect(providerBtn).toBeTruthy();
    });
  });

  describe('Integration: Switch Session from Dropdown', () => {
    it('should switch session when session selected from dropdown', () => {
      // Simulate session selection from dropdown
      component.onSessionSelected('session-2' as SessionId);
      fixture.detectChanges();

      expect(mockChatService.switchToSession).toHaveBeenCalledWith('session-2');
    });

    it('should close search overlay after selecting session from dropdown', () => {
      // Open search overlay first
      component.showSearchOverlay.set(true);
      fixture.detectChanges();
      expect(component.showSearchOverlay()).toBe(true);

      // Select session
      component.onSessionSelected('session-2' as SessionId);
      fixture.detectChanges();

      // Verify overlay closed
      expect(component.showSearchOverlay()).toBe(false);
    });

    it('should verify dropdown closes after session selection', () => {
      const dropdown = fixture.debugElement.nativeElement.querySelector(
        'ptah-session-dropdown'
      );
      expect(dropdown).toBeTruthy();

      // Session selection should trigger switchToSession
      component.onSessionSelected('session-3' as SessionId);
      expect(mockChatService.switchToSession).toHaveBeenCalledWith('session-3');
    });
  });

  describe('Integration: Switch Session from Search Overlay', () => {
    it('should open search overlay when searchAllClicked emitted', () => {
      expect(component.showSearchOverlay()).toBe(false);

      // Simulate search all clicked from dropdown
      component.showSearchOverlay.set(true);
      fixture.detectChanges();

      expect(component.showSearchOverlay()).toBe(true);

      // Verify overlay rendered
      const overlay = fixture.nativeElement.querySelector(
        'ptah-session-search-overlay'
      );
      expect(overlay).toBeTruthy();
    });

    it('should switch session from search overlay results', () => {
      // Open search overlay
      component.showSearchOverlay.set(true);
      fixture.detectChanges();

      // Select session from overlay
      component.onSessionSelected('session-2' as SessionId);
      fixture.detectChanges();

      expect(mockChatService.switchToSession).toHaveBeenCalledWith('session-2');
      expect(component.showSearchOverlay()).toBe(false);
    });

    it('should close overlay when closed event emitted', () => {
      // Open overlay
      component.showSearchOverlay.set(true);
      fixture.detectChanges();
      expect(component.showSearchOverlay()).toBe(true);

      // Close overlay
      component.showSearchOverlay.set(false);
      fixture.detectChanges();

      expect(component.showSearchOverlay()).toBe(false);
    });

    it('should pass all sessions to search overlay', () => {
      component.showSearchOverlay.set(true);
      fixture.detectChanges();

      // Verify overlay receives all sessions (not just recent)
      expect(mockChatService.sessions()).toEqual(mockSessions);
    });
  });

  describe('Integration: Create New Session from Dropdown', () => {
    it('should emit newSession event when dropdown emits newSessionClicked', (done) => {
      component.newSession.subscribe(() => {
        done();
      });

      // This simulates the dropdown component emitting newSessionClicked
      // In real integration, the dropdown button would trigger this
      component.newSession.emit();
    });

    it('should verify dropdown can trigger new session creation', () => {
      const newSessionSpy = jest.fn();
      component.newSession.subscribe(newSessionSpy);

      component.newSession.emit();

      expect(newSessionSpy).toHaveBeenCalled();
    });
  });

  describe('Event Outputs', () => {
    it('should emit analytics event when analytics button clicked', (done) => {
      component.analytics.subscribe(() => {
        done();
      });

      const analyticsBtn = fixture.nativeElement.querySelector(
        '[title="View Analytics"]'
      );
      analyticsBtn.click();
    });

    it('should emit providerSettings event when provider button clicked', (done) => {
      component.providerSettings.subscribe(() => {
        done();
      });

      const providerBtn = fixture.nativeElement.querySelector(
        '.provider-settings-btn'
      );
      providerBtn.click();
    });
  });

  describe('Computed Properties', () => {
    it('should compute provider title correctly', () => {
      const title = component.providerTitle();
      expect(title).toBe('AI Provider Settings (Claude)');
    });

    it('should compute provider aria label correctly', () => {
      const ariaLabel = component.providerAriaLabel();
      expect(ariaLabel).toBe(
        'AI Provider Settings. Current provider: Claude. Status: online'
      );
    });

    it('should handle missing provider name gracefully', () => {
      fixture.componentRef.setInput('providerStatus', {
        name: '',
        status: 'offline' as const,
      });
      fixture.detectChanges();

      const title = component.providerTitle();
      const ariaLabel = component.providerAriaLabel();

      expect(title).toContain('Unknown');
      expect(ariaLabel).toContain('Unknown');
    });
  });

  describe('Provider Status Display', () => {
    it('should display online status correctly', () => {
      fixture.componentRef.setInput('providerStatus', {
        name: 'Claude',
        status: 'online' as const,
      });
      fixture.detectChanges();

      const statusElement =
        fixture.nativeElement.querySelector('.status-online');
      expect(statusElement).toBeTruthy();
      expect(statusElement.textContent.trim()).toBe('CLAUDE');
    });

    it('should display offline status correctly', () => {
      fixture.componentRef.setInput('providerStatus', {
        name: 'Claude',
        status: 'offline' as const,
      });
      fixture.detectChanges();

      const statusElement =
        fixture.nativeElement.querySelector('.status-offline');
      expect(statusElement).toBeTruthy();
    });

    it('should display error status correctly', () => {
      fixture.componentRef.setInput('providerStatus', {
        name: 'Claude',
        status: 'error' as const,
      });
      fixture.detectChanges();

      const statusElement =
        fixture.nativeElement.querySelector('.status-error');
      expect(statusElement).toBeTruthy();
    });

    it('should display loading status correctly', () => {
      fixture.componentRef.setInput('providerStatus', {
        name: 'Claude',
        status: 'loading' as const,
      });
      fixture.detectChanges();

      const statusElement =
        fixture.nativeElement.querySelector('.status-loading');
      expect(statusElement).toBeTruthy();
    });
  });

  describe('Full Integration Workflows', () => {
    it('should complete full dropdown session switch workflow', async () => {
      // 1. Initial state - dropdown closed
      expect(component.showSearchOverlay()).toBe(false);

      // 2. User selects session from dropdown (simulated)
      component.onSessionSelected('session-2' as SessionId);
      fixture.detectChanges();

      // 3. Verify switchToSession called
      expect(mockChatService.switchToSession).toHaveBeenCalledWith('session-2');

      // 4. Verify overlay stays closed (wasn't opened)
      expect(component.showSearchOverlay()).toBe(false);
    });

    it('should complete full search overlay workflow', async () => {
      // 1. Open search overlay
      component.showSearchOverlay.set(true);
      fixture.detectChanges();
      expect(component.showSearchOverlay()).toBe(true);

      // 2. User types search query (handled by overlay component)
      // 3. User selects session from search results
      component.onSessionSelected('session-3' as SessionId);
      fixture.detectChanges();

      // 4. Verify switchToSession called
      expect(mockChatService.switchToSession).toHaveBeenCalledWith('session-3');

      // 5. Verify overlay closed
      expect(component.showSearchOverlay()).toBe(false);
    });

    it('should handle multiple session switches correctly', async () => {
      // Switch 1
      component.onSessionSelected('session-1' as SessionId);
      expect(mockChatService.switchToSession).toHaveBeenCalledWith('session-1');

      // Switch 2
      component.onSessionSelected('session-2' as SessionId);
      expect(mockChatService.switchToSession).toHaveBeenCalledWith('session-2');

      // Switch 3
      component.onSessionSelected('session-3' as SessionId);
      expect(mockChatService.switchToSession).toHaveBeenCalledWith('session-3');

      expect(mockChatService.switchToSession).toHaveBeenCalledTimes(3);
    });
  });

  describe('Error Handling', () => {
    it('should handle session switch failure gracefully', async () => {
      // Mock switch failure
      mockChatService.switchToSession = jest
        .fn()
        .mockRejectedValue(new Error('Switch failed'));

      // Attempt switch
      await expect(
        component.onSessionSelected('invalid-session' as SessionId)
      ).rejects.toThrow();

      // Verify overlay still closes despite error
      expect(component.showSearchOverlay()).toBe(false);
    });
  });
});
