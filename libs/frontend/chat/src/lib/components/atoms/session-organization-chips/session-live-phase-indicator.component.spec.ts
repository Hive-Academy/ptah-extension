/**
 * SessionLivePhaseIndicatorComponent specs.
 *
 * Coverage moved here from `session-organization-chips.component.spec.ts`
 * when the live-phase marker was extracted from the chips component to sit
 * beside the sidebar row, out of flow: the live-phase precedence (the
 * liveness registry wins over the row snapshot) and idle rendering nothing
 * (no marker, no label — the host stays mounted and does not shift the row).
 *
 * The fixture's host element IS the indicator: the label, title, phase and
 * invisible state live on the host itself, so the assertions read the host
 * directly instead of querying into it.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SessionLivenessRegistry } from '@ptah-extension/chat-state';
import {
  type ChatSessionSummary,
  type SessionId,
} from '@ptah-extension/shared';
import { SessionLivePhaseIndicatorComponent } from './session-live-phase-indicator.component';

const SESSION_ID = 'a1b2c3d4-0000-4000-8000-000000000001';

function row(overrides: Partial<ChatSessionSummary> = {}): ChatSessionSummary {
  return {
    id: SESSION_ID as SessionId,
    name: 'Session',
    messageCount: 1,
    createdAt: 1,
    lastActivityAt: 2,
    isActive: false,
    ...overrides,
  };
}

describe('SessionLivePhaseIndicatorComponent', () => {
  let fixture: ComponentFixture<SessionLivePhaseIndicatorComponent>;
  let host: HTMLElement;
  let registry: SessionLivenessRegistry;

  const render = (session: ChatSessionSummary): void => {
    fixture.componentRef.setInput('session', session);
    fixture.detectChanges();
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [SessionLivePhaseIndicatorComponent],
    });
    registry = TestBed.inject(SessionLivenessRegistry);
    fixture = TestBed.createComponent(SessionLivePhaseIndicatorComponent);
    host = fixture.nativeElement as HTMLElement;
  });

  it('uses the row livePhase when the registry does not track the session', () => {
    render(row({ livePhase: 'generating' }));
    expect(host.getAttribute('data-live-phase')).toBe('running');
    expect(host.getAttribute('aria-label')).toBe('Live: Running');
    expect(host.getAttribute('title')).toBe('Running');
    expect(host.getAttribute('role')).toBe('img');
    expect(host.getAttribute('data-testid')).toBe('session-chip-live');
    expect(host.classList).toContain('shrink-0');
    expect(host.classList).not.toContain('invisible');

    render(row({ livePhase: 'idle' }));
    // Idle hides the host instead of removing it, so the row's layout holds.
    expect(host.classList).toContain('invisible');
    expect(host.getAttribute('aria-label')).toBeNull();
    expect(host.getAttribute('title')).toBeNull();
    expect(host.getAttribute('data-live-phase')).toBeNull();
  });

  it('lets the liveness registry win over the row livePhase', () => {
    render(row({ livePhase: 'generating' }));
    registry.markFailed(SESSION_ID);
    fixture.detectChanges();
    expect(host.getAttribute('data-live-phase')).toBe('failed');
    expect(host.getAttribute('aria-label')).toBe('Live: Last run failed');

    registry.markIdle(SESSION_ID);
    fixture.detectChanges();
    expect(host.classList).toContain('invisible');
    expect(host.getAttribute('aria-label')).toBeNull();
    expect(host.getAttribute('data-live-phase')).toBeNull();
  });
});
