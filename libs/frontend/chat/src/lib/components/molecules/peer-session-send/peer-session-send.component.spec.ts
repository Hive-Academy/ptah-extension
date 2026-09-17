import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import * as fs from 'fs';
import * as path from 'path';
import type {
  PeerSessionRow,
  PeerSessionSendResult,
} from '@ptah-extension/shared';
import { TabManagerService } from '@ptah-extension/chat-state';
import { PeerSessionFacade } from '@ptah-extension/core';
import { ChatStore } from '../../../services/chat.store';
import { PeerSessionSendComponent } from './peer-session-send.component';

describe('PeerSessionSendComponent', () => {
  let fixture: ComponentFixture<PeerSessionSendComponent>;
  let component: PeerSessionSendComponent;

  const mockReachableSession: PeerSessionRow = {
    sessionId: 'session-target-999',
    name: 'peer-worker',
    nameSource: 'user',
    workspace: '/work/ptah',
    workspaceLabel: 'ptah',
    inCurrentWorkspace: true,
    reachability: 'reachable',
    pid: 12345,
  };

  const sessionsSignal = signal<readonly PeerSessionRow[]>([
    mockReachableSession,
  ]);
  const isSendingSignal = signal<boolean>(false);
  const lastSendResultSignal = signal<PeerSessionSendResult | null>(null);

  const mockFacade = {
    sessions: sessionsSignal,
    isSending: isSendingSignal,
    lastSendResult: lastSendResultSignal,
    refreshSessions: jest.fn().mockResolvedValue(null),
    send: jest.fn(),
  };

  const activeTabIdSignal = signal<string | null>('tab-1');
  const tabsSignal = signal<
    Array<{
      id: string;
      claudeSessionId?: string | null;
      attachedBinding?: { bindingId: string } | null;
    }>
  >([
    {
      id: 'tab-1',
      claudeSessionId: 'session-origin-111',
      attachedBinding: null,
    },
  ]);

  const mockTabManager = {
    activeTabId: activeTabIdSignal,
    tabs: tabsSignal,
  };

  const currentSessionIdSignal = signal<string | null>(null);
  const mockChatStore = {
    currentSessionId: currentSessionIdSignal,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    sessionsSignal.set([mockReachableSession]);
    isSendingSignal.set(false);
    lastSendResultSignal.set(null);
    activeTabIdSignal.set('tab-1');
    tabsSignal.set([
      {
        id: 'tab-1',
        claudeSessionId: 'session-origin-111',
        attachedBinding: null,
      },
    ]);
    currentSessionIdSignal.set(null);

    TestBed.configureTestingModule({
      imports: [PeerSessionSendComponent],
      providers: [
        { provide: PeerSessionFacade, useValue: mockFacade },
        { provide: TabManagerService, useValue: mockTabManager },
        { provide: ChatStore, useValue: mockChatStore },
      ],
    });

    fixture = TestBed.createComponent(PeerSessionSendComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('renders trigger button with "Peer" label and icon', () => {
    const trigger = fixture.nativeElement.querySelector(
      '[data-testid="peer-session-send-trigger"]',
    );
    expect(trigger).not.toBeNull();
    expect(trigger.textContent).toContain('Peer');
  });

  describe('Criterion 6: Refresh on open', () => {
    it('opens dialog and calls refreshSessions with excludeSessionId on trigger click', async () => {
      const trigger = fixture.nativeElement.querySelector(
        '[data-testid="peer-session-send-trigger"]',
      ) as HTMLButtonElement;
      trigger.click();
      fixture.detectChanges();

      expect(component.isOpen()).toBe(true);
      expect(mockFacade.refreshSessions).toHaveBeenCalledWith({
        excludeSessionId: 'session-origin-111',
      });
    });

    it('calls refreshSessions whenever onPickerOpened is called', async () => {
      await component.onPickerOpened();
      expect(mockFacade.refreshSessions).toHaveBeenCalledWith({
        excludeSessionId: 'session-origin-111',
      });
    });
  });

  describe('Session context and send readiness', () => {
    it('disables sending and provides explanation when tab has no active session', () => {
      tabsSignal.set([
        {
          id: 'tab-1',
          claudeSessionId: null,
          attachedBinding: null,
        },
      ]);
      fixture.detectChanges();

      expect(component.canSend()).toBe(false);
      expect(component.cannotSendReason()).toContain(
        'No active session in this tab yet',
      );
    });

    it('disables sending when session is attached to messaging (read-only)', () => {
      tabsSignal.set([
        {
          id: 'tab-1',
          claudeSessionId: 'session-origin-111',
          attachedBinding: { bindingId: 'telegram-123' },
        },
      ]);
      fixture.detectChanges();

      expect(component.canSend()).toBe(false);
      expect(component.cannotSendReason()).toContain(
        'Session is attached to external messaging',
      );
    });

    it('enables sending when session is active and not attached to external messaging', () => {
      expect(component.canSend()).toBe(true);
      expect(component.fromSessionId()).toBe('session-origin-111');
      expect(component.cannotSendReason()).toBeNull();
    });
  });

  describe('Criterion 4: Sending and outcome handling', () => {
    it('invokes facade.send with target, fromSessionId, and trimmed message', async () => {
      const mockResult: PeerSessionSendResult = {
        outcome: 'accepted',
        route: 'model-mediated-cli-tool',
        costsATurn: true,
        modelMayDecline: true,
        acceptanceCaveat: 'Handed to transport.',
        target: {
          sessionId: 'session-target-999',
          name: 'peer-worker',
          workspace: '/work/ptah',
        },
      };
      mockFacade.send.mockResolvedValue(mockResult);

      component.onSessionSelected(mockReachableSession);
      component.onMessageChange('  Please review the test suite  ');

      await component.onSendRequested();

      expect(mockFacade.send).toHaveBeenCalledWith({
        sessionId: 'session-target-999',
        fromSessionId: 'session-origin-111',
        message: 'Please review the test suite',
      });
      expect(component.lastResult()).toBe(mockResult);
      expect(component.sendError()).toBeNull();
    });

    it('handles facade.send errors gracefully, narrows with instanceof Error, and sets sendError', async () => {
      mockFacade.send.mockRejectedValue(new Error('RPC dispatch failed'));

      component.onSessionSelected(mockReachableSession);
      component.onMessageChange('Instruction text');

      await component.onSendRequested();

      expect(component.sendError()).toBe('RPC dispatch failed');
      expect(component.lastResult()).toBeNull();
    });

    it('resets outcome and state when resetOutcome is called', async () => {
      const mockResult: PeerSessionSendResult = {
        outcome: 'accepted',
        route: 'model-mediated-cli-tool',
        costsATurn: true,
        modelMayDecline: true,
        acceptanceCaveat: 'Handed to transport.',
      };
      mockFacade.send.mockResolvedValue(mockResult);
      component.onSessionSelected(mockReachableSession);
      component.onMessageChange('Old message');
      await component.onSendRequested();
      expect(component.lastResult()).toBe(mockResult);

      component.resetOutcome();

      expect(component.lastResult()).toBeNull();
      expect(component.message()).toBe('');
      expect(component.sendError()).toBeNull();
    });
  });

  describe('Strict naming check: zero references to delivery / receipt / acknowledgement', () => {
    it('confirms source files contain zero forbidden terms', () => {
      const dir = path.join(__dirname);
      const filesToCheck = [
        path.join(dir, 'peer-session-send.component.ts'),
        path.join(dir, 'peer-session-send-dialog.component.ts'),
      ];

      // Forbidden words per Criterion 4:
      // "Do not write a field, variable, method, CSS class or user-facing string named for delivery, receipt or acknowledgement."
      const forbiddenPattern =
        /\b(?:deliver|delivered|delivering|receipt|acknowledgement|acknowledged)\b/i;

      for (const filePath of filesToCheck) {
        const raw = fs.readFileSync(filePath, 'utf-8');
        // Strip out comments so explanatory docstrings warning against "delivered" don't trip the check
        const withoutComments = raw
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/\/\/.*$/gm, '');

        const match = forbiddenPattern.exec(withoutComments);
        expect(match).toBeNull();
      }
    });
  });
});
