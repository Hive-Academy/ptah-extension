import { ComponentFixture, TestBed } from '@angular/core/testing';
import type {
  PeerSessionRow,
  PeerSessionSendResult,
} from '@ptah-extension/shared';
import { PeerSessionSendDialogComponent } from './peer-session-send-dialog.component';

describe('PeerSessionSendDialogComponent', () => {
  let fixture: ComponentFixture<PeerSessionSendDialogComponent>;
  let component: PeerSessionSendDialogComponent;

  const mockReachableSession: PeerSessionRow = {
    sessionId: 'session-alpha-1234',
    name: 'alpha-worker',
    nameSource: 'user',
    workspace: '/work/ptah',
    workspaceLabel: 'ptah',
    inCurrentWorkspace: true,
    reachability: 'reachable',
    pid: 12345,
  };

  const mockUnreachableSession: PeerSessionRow = {
    sessionId: 'session-beta-5678',
    name: 'beta-worker',
    nameSource: 'derived',
    workspace: '/work/other',
    workspaceLabel: 'other',
    inCurrentWorkspace: false,
    reachability: 'unreachable',
    unreachableReason: 'process-not-running',
    pid: 23456,
  };

  const mockSessions: PeerSessionRow[] = [
    mockReachableSession,
    mockUnreachableSession,
  ];

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [PeerSessionSendDialogComponent],
    });

    fixture = TestBed.createComponent(PeerSessionSendDialogComponent);
    component = fixture.componentInstance;
  });

  it('does NOT render dialog when isOpen is false', () => {
    fixture.componentRef.setInput('isOpen', false);
    fixture.componentRef.setInput('sessions', mockSessions);
    fixture.detectChanges();

    const dialog = fixture.nativeElement.querySelector(
      '[data-testid="peer-session-send-dialog"]',
    );
    expect(dialog).toBeNull();
  });

  it('renders modal dialog when isOpen is true', () => {
    fixture.componentRef.setInput('isOpen', true);
    fixture.componentRef.setInput('sessions', mockSessions);
    fixture.detectChanges();

    const dialog = fixture.nativeElement.querySelector(
      '[data-testid="peer-session-send-dialog"]',
    );
    expect(dialog).not.toBeNull();
    expect(dialog.classList).toContain('modal-open');
  });

  describe('Criterion 5: Costs disclosed BEFORE send', () => {
    it('prominently displays both costs before sending (turn cost and model mediation)', () => {
      fixture.componentRef.setInput('isOpen', true);
      fixture.componentRef.setInput('sessions', mockSessions);
      fixture.componentRef.setInput('sendResult', null);
      fixture.detectChanges();

      const costDisclosure = fixture.nativeElement.querySelector(
        '[data-testid="peer-session-cost-disclosure"]',
      );
      expect(costDisclosure).not.toBeNull();

      const consumesTurn = fixture.nativeElement.querySelector(
        '[data-testid="peer-cost-consumes-turn"]',
      );
      expect(consumesTurn).not.toBeNull();
      expect(consumesTurn.textContent).toContain('Consumes a turn');

      const modelMayDecline = fixture.nativeElement.querySelector(
        '[data-testid="peer-cost-model-may-decline"]',
      );
      expect(modelMayDecline).not.toBeNull();
      expect(modelMayDecline.textContent).toContain('Model-mediated');
      expect(modelMayDecline.textContent).toContain('decline outright');
    });
  });

  describe('Criterion 4: Honest outcome presentation', () => {
    it('displays ACCEPTED (never DELIVERED or SENT) and renders acceptanceCaveat in full', () => {
      const acceptedResult: PeerSessionSendResult = {
        outcome: 'accepted',
        route: 'model-mediated-cli-tool',
        costsATurn: true,
        modelMayDecline: true,
        acceptanceCaveat:
          'Handed to transport. Ptah cannot observe whether the peer received or read this message. Confirm arrival by reading the receiving session directly.',
        target: {
          sessionId: 'session-alpha-1234',
          name: 'alpha-worker',
          workspace: '/work/ptah',
        },
      };

      fixture.componentRef.setInput('isOpen', true);
      fixture.componentRef.setInput('sessions', mockSessions);
      fixture.componentRef.setInput('sendResult', acceptedResult);
      fixture.detectChanges();

      const outcomePanel = fixture.nativeElement.querySelector(
        '[data-testid="peer-session-outcome-panel"]',
      );
      expect(outcomePanel).not.toBeNull();

      const outcomeBadge = fixture.nativeElement.querySelector(
        '[data-testid="peer-session-outcome"]',
      );
      expect(outcomeBadge).not.toBeNull();
      expect(outcomeBadge.textContent.trim()).toBe('Accepted');

      // Crucial: Must NEVER say "delivered" or "sent" as the outcome
      expect(outcomePanel.textContent).not.toContain('Delivered');
      expect(outcomePanel.textContent).not.toContain('delivered');

      // Caveat is rendered in full to the user
      const caveatEl = fixture.nativeElement.querySelector(
        '[data-testid="peer-session-acceptance-caveat"]',
      );
      expect(caveatEl).not.toBeNull();
      expect(caveatEl.textContent).toContain('Handed to transport');
      expect(caveatEl.textContent).toContain(
        'Ptah cannot observe whether the peer received or read this message',
      );

      // Shows target name
      const targetEl = fixture.nativeElement.querySelector(
        '[data-testid="peer-session-target-name"]',
      );
      expect(targetEl.textContent).toContain('alpha-worker');
    });

    it('displays REFUSED with reason, detail, and acceptanceCaveat on refusal', () => {
      const refusedResult: PeerSessionSendResult = {
        outcome: 'refused',
        route: 'model-mediated-cli-tool',
        costsATurn: true,
        modelMayDecline: true,
        reason: 'session-unreachable',
        detail: 'The destination process is not running.',
        acceptanceCaveat:
          'Handed to transport. Ptah cannot observe whether the peer received or read this message.',
        target: {
          sessionId: 'session-beta-5678',
          name: 'beta-worker',
          workspace: '/work/other',
        },
      };

      fixture.componentRef.setInput('isOpen', true);
      fixture.componentRef.setInput('sessions', mockSessions);
      fixture.componentRef.setInput('sendResult', refusedResult);
      fixture.detectChanges();

      const outcomeBadge = fixture.nativeElement.querySelector(
        '[data-testid="peer-session-outcome"]',
      );
      expect(outcomeBadge.textContent.trim()).toBe('Refused');

      const reasonEl = fixture.nativeElement.querySelector(
        '[data-testid="peer-session-refusal-reason"]',
      );
      expect(reasonEl.textContent).toContain('session-unreachable');

      const detailEl = fixture.nativeElement.querySelector(
        '[data-testid="peer-session-refusal-detail"]',
      );
      expect(detailEl.textContent).toContain(
        'The destination process is not running.',
      );

      const caveatEl = fixture.nativeElement.querySelector(
        '[data-testid="peer-session-acceptance-caveat"]',
      );
      expect(caveatEl.textContent).toContain('Handed to transport');
    });
  });

  describe('User interaction and validation', () => {
    it('disables send button when no session is selected or message is empty', () => {
      fixture.componentRef.setInput('isOpen', true);
      fixture.componentRef.setInput('sessions', mockSessions);
      fixture.componentRef.setInput('selectedSessionId', null);
      fixture.componentRef.setInput('message', '');
      fixture.detectChanges();

      const sendBtn = fixture.nativeElement.querySelector(
        '[data-testid="peer-session-submit-btn"]',
      ) as HTMLButtonElement;
      expect(sendBtn.disabled).toBe(true);
    });

    it('disables send button when selected session is unreachable', () => {
      fixture.componentRef.setInput('isOpen', true);
      fixture.componentRef.setInput('sessions', mockSessions);
      fixture.componentRef.setInput('selectedSessionId', 'session-beta-5678');
      fixture.componentRef.setInput('message', 'Hello peer');
      fixture.detectChanges();

      const sendBtn = fixture.nativeElement.querySelector(
        '[data-testid="peer-session-submit-btn"]',
      ) as HTMLButtonElement;
      expect(sendBtn.disabled).toBe(true);
    });

    it('enables send button when reachable session is selected and message is non-empty', () => {
      fixture.componentRef.setInput('isOpen', true);
      fixture.componentRef.setInput('sessions', mockSessions);
      fixture.componentRef.setInput('selectedSessionId', 'session-alpha-1234');
      fixture.componentRef.setInput('message', 'Hello peer');
      fixture.detectChanges();

      const sendBtn = fixture.nativeElement.querySelector(
        '[data-testid="peer-session-submit-btn"]',
      ) as HTMLButtonElement;
      expect(sendBtn.disabled).toBe(false);
    });

    it('emits sendRequested when send button is clicked', () => {
      const sendSpy = jest.fn();
      component.sendRequested.subscribe(sendSpy);

      fixture.componentRef.setInput('isOpen', true);
      fixture.componentRef.setInput('sessions', mockSessions);
      fixture.componentRef.setInput('selectedSessionId', 'session-alpha-1234');
      fixture.componentRef.setInput('message', 'Hello peer');
      fixture.detectChanges();

      const sendBtn = fixture.nativeElement.querySelector(
        '[data-testid="peer-session-submit-btn"]',
      ) as HTMLButtonElement;
      sendBtn.click();

      expect(sendSpy).toHaveBeenCalledTimes(1);
    });

    it('emits messageChange when message is typed in textarea', () => {
      const changeSpy = jest.fn();
      component.messageChange.subscribe(changeSpy);

      fixture.componentRef.setInput('isOpen', true);
      fixture.componentRef.setInput('sessions', mockSessions);
      fixture.detectChanges();

      const textarea = fixture.nativeElement.querySelector(
        '[data-testid="peer-session-message-input"]',
      ) as HTMLTextAreaElement;
      textarea.value = 'Review this code please';
      textarea.dispatchEvent(new Event('input'));

      expect(changeSpy).toHaveBeenCalledWith('Review this code please');
    });

    it('emits closed when cancel button or close button is clicked', () => {
      const closeSpy = jest.fn();
      component.closed.subscribe(closeSpy);

      fixture.componentRef.setInput('isOpen', true);
      fixture.componentRef.setInput('sessions', mockSessions);
      fixture.detectChanges();

      const cancelBtn = fixture.nativeElement.querySelector(
        '[data-testid="peer-session-cancel-btn"]',
      ) as HTMLButtonElement;
      cancelBtn.click();
      expect(closeSpy).toHaveBeenCalledTimes(1);

      const closeIconBtn = fixture.nativeElement.querySelector(
        '[data-testid="peer-session-dialog-close-btn"]',
      ) as HTMLButtonElement;
      closeIconBtn.click();
      expect(closeSpy).toHaveBeenCalledTimes(2);
    });

    it('emits resetOutcome when "Send another" is clicked after a result', () => {
      const resetSpy = jest.fn();
      component.resetOutcome.subscribe(resetSpy);

      const acceptedResult: PeerSessionSendResult = {
        outcome: 'accepted',
        route: 'model-mediated-cli-tool',
        costsATurn: true,
        modelMayDecline: true,
        acceptanceCaveat: 'Handed to transport.',
      };

      fixture.componentRef.setInput('isOpen', true);
      fixture.componentRef.setInput('sessions', mockSessions);
      fixture.componentRef.setInput('sendResult', acceptedResult);
      fixture.detectChanges();

      const resetBtn = fixture.nativeElement.querySelector(
        '[data-testid="peer-session-reset-btn"]',
      ) as HTMLButtonElement;
      resetBtn.click();

      expect(resetSpy).toHaveBeenCalledTimes(1);
    });
  });
});
