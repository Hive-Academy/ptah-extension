import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type { MonitoredAgent } from '@ptah-extension/chat-streaming';
import {
  ProviderAccountsStateService,
  type ProviderAccountsView,
} from '@ptah-extension/core';
import type { ProviderAccountsSnapshot } from '@ptah-extension/shared';
import { AgentCardHeaderComponent } from './agent-card-header.component';

function lane(overrides: Partial<MonitoredAgent> = {}): MonitoredAgent {
  return {
    agentId: 'agent-1',
    cli: 'codex',
    task: 'Do work',
    status: 'running',
    startedAt: 0,
    stdout: '',
    stderr: '',
    expanded: true,
    segments: [],
    streamEvents: [],
    streamRevision: 0,
    permissionQueue: [],
    cacheState: 'unknown',
    cacheReported: false,
    ...overrides,
  };
}

describe('AgentCardHeaderComponent — prompt cache (N6)', () => {
  let fixture: ComponentFixture<AgentCardHeaderComponent>;

  function setup(agent: MonitoredAgent): HTMLElement {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ imports: [AgentCardHeaderComponent] });
    fixture = TestBed.createComponent(AgentCardHeaderComponent);
    fixture.componentRef.setInput('agent', agent);
    fixture.componentRef.setInput('elapsedDisplay', '1s');
    fixture.componentRef.setInput('isStopping', false);
    fixture.componentRef.setInput('isResuming', false);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('keeps cache details in the usage card instead of duplicating them in the lane header', () => {
    const el = setup(lane());
    expect(
      el.querySelector('[data-testid="lane-cache-not-reported"]'),
    ).toBeNull();
    expect(el.textContent).not.toMatch(/\b(warm|cold|ctx)\b/);
  });

  it('shows no cache chip when the agent carries no cache fields', () => {
    const el = setup(lane({ cacheReported: undefined, cacheState: undefined }));
    expect(el.querySelector('[data-testid="lane-cache-not-reported"]')).toBe(
      null,
    );
  });

  it('explains a repeat-call stop', () => {
    const repeat = setup(
      lane({ status: 'stopped', stopReason: 'repeat-call' }),
    );
    expect(
      repeat.querySelector('[data-testid="lane-stop-reason"]')?.textContent,
    ).toContain('Stopped: repeated the same tool call');
  });

  it('hides the stop reason while the lane is running and when none was recorded', () => {
    const running = setup(
      lane({ status: 'running', stopReason: 'repeat-call' }),
    );
    expect(
      running.querySelector('[data-testid="lane-stop-reason"]'),
    ).toBeNull();

    const plain = setup(lane({ status: 'stopped' }));
    expect(plain.querySelector('[data-testid="lane-stop-reason"]')).toBeNull();
  });

  it('keeps card controls by default and removes repeated labels in flat presentation', () => {
    const value = lane({ displayName: 'Worker Alpha', model: 'gpt-5', cliSessionId: 'session-123' });
    const card = setup(value);
    expect(card.querySelector('[aria-label="Collapse Worker Alpha"]')).not.toBeNull();
    expect(card.textContent).toContain('Worker Alpha');
    fixture.componentRef.setInput('presentation', 'flat');
    fixture.detectChanges();
    const flat = fixture.nativeElement as HTMLElement;
    expect(flat.querySelector('[aria-label="Collapse Worker Alpha"]')).toBeNull();
    expect(flat.textContent).not.toContain('Worker Alpha');
    expect(flat.textContent).toContain('running');
    expect(flat.textContent).toContain('gpt-5');
    expect(flat.textContent).toContain('1s');
    expect(flat.querySelector('[aria-label="Stop agent"]')).not.toBeNull();
    expect(flat.textContent).not.toContain('session-123');
  });
});

describe('AgentCardHeaderComponent — lane account (U5)', () => {
  const PROFILE = 'profile_work_0001';
  const view = signal<Pick<ProviderAccountsView, 'status' | 'snapshot'>>({
    status: 'idle',
    snapshot: null,
  });
  const fakeAccounts = { state: () => view };

  function ready(...accounts: Array<{ profileId: string; label: string }>) {
    view.set({
      status: 'ready',
      snapshot: {
        accounts: accounts.map((a) => ({ ...a, provider: 'claude' })),
      } as unknown as ProviderAccountsSnapshot,
    });
  }

  function render(agent: MonitoredAgent): HTMLElement {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [AgentCardHeaderComponent],
      providers: [
        { provide: ProviderAccountsStateService, useValue: fakeAccounts },
      ],
    });
    const fixture = TestBed.createComponent(AgentCardHeaderComponent);
    fixture.componentRef.setInput('agent', agent);
    fixture.componentRef.setInput('elapsedDisplay', '1s');
    fixture.componentRef.setInput('isStopping', false);
    fixture.componentRef.setInput('isResuming', false);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  function accountText(el: HTMLElement): string | undefined {
    return el
      .querySelector('[data-testid="lane-account"]')
      ?.textContent?.trim();
  }

  beforeEach(() => view.set({ status: 'idle', snapshot: null }));

  it.each(['running', 'completed'] as const)(
    'shows the named account label on a %s lane, never its profile ID',
    (status) => {
      ready({ profileId: PROFILE, label: 'Work' });
      const el = render(
        lane({ cli: 'claude', status, accountProfileId: PROFILE }),
      );
      expect(accountText(el)).toBe('Account: Work');
      expect(el.textContent).not.toContain(PROFILE);
    },
  );

  it.each(['running', 'failed'] as const)(
    'shows "Default" for an ambient %s lane',
    (status) => {
      const el = render(
        lane({ cli: 'claude', status, accountProfileId: null }),
      );
      expect(accountText(el)).toBe('Default');
    },
  );

  it('shows "Removed account" when the loaded list no longer has the profile', () => {
    ready({ profileId: 'profile_other_0002', label: 'Personal' });
    const el = render(
      lane({ cli: 'claude', status: 'stopped', accountProfileId: PROFILE }),
    );
    expect(accountText(el)).toBe('Removed account');
    expect(el.textContent).not.toContain(PROFILE);
  });

  it('shows nothing before the account list loads or for an unknown account', () => {
    const named = render(lane({ cli: 'claude', accountProfileId: PROFILE }));
    expect(accountText(named)).toBeUndefined();
    expect(named.textContent).not.toContain(PROFILE);
    const unknown = render(lane());
    expect(accountText(unknown)).toBeUndefined();
  });

  it('updates the label when the account list changes', () => {
    ready({ profileId: PROFILE, label: 'Work' });
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [AgentCardHeaderComponent],
      providers: [
        { provide: ProviderAccountsStateService, useValue: fakeAccounts },
      ],
    });
    const fixture = TestBed.createComponent(AgentCardHeaderComponent);
    fixture.componentRef.setInput(
      'agent',
      lane({ cli: 'claude', accountProfileId: PROFILE }),
    );
    fixture.componentRef.setInput('elapsedDisplay', '1s');
    fixture.componentRef.setInput('isStopping', false);
    fixture.componentRef.setInput('isResuming', false);
    fixture.detectChanges();
    ready({ profileId: PROFILE, label: 'Work renamed' });
    fixture.detectChanges();
    expect(accountText(fixture.nativeElement as HTMLElement)).toBe(
      'Account: Work renamed',
    );
    ready();
    fixture.detectChanges();
    expect(accountText(fixture.nativeElement as HTMLElement)).toBe(
      'Removed account',
    );
  });
});
