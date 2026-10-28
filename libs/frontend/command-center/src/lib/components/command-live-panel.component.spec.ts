import { Component, input } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  SessionEmbedComponent,
  type SessionCardActions,
  type SessionStartGuard,
  type SessionStopHandler,
} from '@ptah-extension/chat';
import {
  CommandLivePanelComponent,
  LIVE_START_BLOCK_REASON,
  type CommandLiveTarget,
} from './command-live-panel.component';

@Component({ selector: 'ptah-session-embed', standalone: true, template: '' })
class SessionEmbedStubComponent {
  public readonly tabId = input.required<string>();
  public readonly chrome = input('full');
  public readonly contentVisible = input(true);
  public readonly focused = input(true);
  public readonly startGuard = input<SessionStartGuard | null>(null);
  public readonly cardActions = input<SessionCardActions | null>(null);
  public readonly retainRailTranscript = input(false);
  public readonly readOnly = input(false);
  public readonly stopHandler = input<SessionStopHandler | null>(null);
}

describe('CommandLivePanelComponent', () => {
  let fixture: ComponentFixture<CommandLivePanelComponent>;

  const render = (target: CommandLiveTarget, hasSession = true): void => {
    fixture.componentRef.setInput('target', target);
    fixture.componentRef.setInput('hasSession', hasSession);
    fixture.detectChanges();
  };
  const embed = (): SessionEmbedStubComponent | null =>
    fixture.debugElement.query(
      (node) => node.componentInstance instanceof SessionEmbedStubComponent,
    )?.componentInstance ?? null;
  const status = (): string =>
    (
      fixture.nativeElement.querySelector(
        '[data-testid="live-status"]',
      ) as HTMLElement
    ).textContent?.trim() ?? '';

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [CommandLivePanelComponent] });
    TestBed.overrideComponent(CommandLivePanelComponent, {
      remove: { imports: [SessionEmbedComponent] },
      add: { imports: [SessionEmbedStubComponent] },
    });
    fixture = TestBed.createComponent(CommandLivePanelComponent);
  });

  it('embeds the target tab read-only, bare, and retained like Canvas', () => {
    render({ tabId: 'root-tab', state: 'running', summary: null });
    const stub = embed();
    expect(stub?.tabId()).toBe('root-tab');
    expect(stub?.chrome()).toBe('bare');
    expect(stub?.retainRailTranscript()).toBe(true);
    expect(stub?.startGuard()?.()).toBe(LIVE_START_BLOCK_REASON);
    expect(stub?.readOnly()).toBe(true);
    expect(stub?.stopHandler()?.('root-tab')).toBe('handled');
    expect(status()).toBe('Streaming');
  });

  it('hides the embed content while another tab covers it', () => {
    render({ tabId: 'root-tab', state: 'completed', summary: null });
    fixture.componentRef.setInput('visible', false);
    fixture.detectChanges();
    expect(embed()?.contentVisible()).toBe(false);
    expect(status()).toBe('Idle');
  });

  it('reports waiting for input in the status line', () => {
    render({ tabId: 'child-tab', state: 'awaiting input', summary: null });
    expect(status()).toBe('Waiting for input');
  });

  it('relays card actions as outputs', () => {
    const lanes: string[] = [];
    let sessions = 0;
    fixture.componentInstance.openLane.subscribe((key) => lanes.push(key));
    fixture.componentInstance.openSession.subscribe(() => sessions++);
    render({ tabId: 'root-tab', state: 'running', summary: null });
    embed()?.cardActions()?.openLane('agent-1');
    embed()?.cardActions()?.openSession();
    expect(lanes).toEqual(['agent-1']);
    expect(sessions).toBe(1);
  });

  it('explains a persisted child with no live transcript and shows its last summary', () => {
    render({ tabId: null, state: 'unknown', summary: 'Wrote the report.' });
    expect(embed()).toBeNull();
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('No session data for this agent.');
    expect(text).toContain('It finished in an earlier session.');
    expect(text).toContain('Wrote the report.');
    expect(status()).toBe('');
  });

  it('does not call a fresh root finished before its tab opens', () => {
    render({ tabId: null, state: null, summary: null });
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Start a command to see live agent output.');
    expect(text).not.toContain('earlier session');
  });

  it('shows a neutral missing note for an unopened child that has not finished', () => {
    render({ tabId: null, state: 'running', summary: null });
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('No session data for this agent.');
    expect(text).not.toContain('earlier session');
  });

  it('keeps the status line visual so it never announces state flips', () => {
    render({ tabId: 'root-tab', state: 'running', summary: null });
    const line = fixture.nativeElement.querySelector(
      '[data-testid="live-status"]',
    ) as HTMLElement;
    expect(line.getAttribute('role')).toBeNull();
    expect(line.getAttribute('aria-live')).toBeNull();
  });

  it('asks for a first command before there is a session', () => {
    render({ tabId: null, state: null, summary: null }, false);
    expect(fixture.nativeElement.textContent).toContain(
      'Start a command to see live agent output.',
    );
  });
});
