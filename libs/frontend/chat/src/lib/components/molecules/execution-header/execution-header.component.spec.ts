import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  AgentMonitorStore,
  type MonitoredAgent,
} from '@ptah-extension/chat-streaming';
import {
  ClaudeRpcService,
  ProviderAccountsStateService,
  type ProviderAccountsView,
} from '@ptah-extension/core';
import type { ProviderAccountsSnapshot } from '@ptah-extension/shared';
import { AgentCardComponent } from '../agent-card/agent-card.component';
import { ExecutionHeaderComponent } from './execution-header.component';

@Component({
  standalone: true,
  imports: [ExecutionHeaderComponent],
  template: `
    <ptah-execution-header kind="cli" label="Worked for 2s" [toolCount]="2"
      [live]="true" peek="Reading files"
      [extraMeta]="['12 tokens']" metaTone="warning" controlsId="lane-details">
      <span executionHeaderStats data-testid="stats">Context 4%</span>
      <button executionHeaderActions type="button" aria-label="Resume codex session">Resume</button>
      <p>Task: inspect files</p>
    </ptah-execution-header>
  `,
})
class HostComponent {}

describe('ExecutionHeaderComponent', () => {
  it('shows stats, peek, meta, a Details toggle and actions in one column row', () => {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;
    const row = root.querySelector<HTMLElement>('[data-test="execution-header-row"]')!;
    const toggle = root.querySelector<HTMLButtonElement>('[data-test="execution-header-details"]')!;
    const action = root.querySelector<HTMLButtonElement>('[executionHeaderActions]')!;
    expect(root.querySelector('ptah-execution-header')?.getAttribute('data-kind')).toBe('cli');
    // The bubble owns the turn label and its disclosure row; the header has neither.
    expect(root.querySelector('ptah-turn-disclosure-row')).toBeNull();
    expect(row.textContent).not.toContain('Worked for 2s');
    // In the main chat column.
    expect(row.parentElement?.classList.contains('mx-auto')).toBe(true);
    expect(row.contains(root.querySelector('[data-testid="stats"]'))).toBe(true);
    expect(row.contains(action)).toBe(true);
    expect(root.querySelector('[data-test="execution-header-peek"]')?.textContent).toBe('Reading files');
    const meta = root.querySelector('[data-test="execution-header-meta"]');
    expect(meta?.textContent).toBe('2 tools · 12 tokens');
    expect(meta?.className).toContain('!text-warning');
    expect(root.querySelector('[data-test="turn-disclosure-meta"]')).toBeNull();
    expect(toggle.getAttribute('aria-label')).toBe('Worked for 2s details');
    expect(toggle.getAttribute('aria-controls')).toBe('lane-details');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    // aria-controls always resolves to exactly one region (open or not).
    const regions = () =>
      root.querySelectorAll(`#${toggle.getAttribute('aria-controls')}[role="region"]`);
    expect(regions()).toHaveLength(1);
    expect((regions()[0] as HTMLElement).hidden).toBe(true);
    toggle.click();
    fixture.detectChanges();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(regions()).toHaveLength(1);
    expect((regions()[0] as HTMLElement).hidden).toBe(false);
    expect(root.querySelector('#lane-details')?.textContent).toContain('Task: inspect files');
    expect(root.querySelector('#lane-details')?.getAttribute('aria-label')).toBe('Worked for 2s details');
    toggle.click();
    fixture.detectChanges();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(regions()).toHaveLength(1);
    expect((regions()[0] as HTMLElement).hidden).toBe(true);
    // No account input, no account badge.
    expect(root.querySelector('[data-testid="lane-account"]')).toBeNull();
  });
});

/**
 * Electron's lane surfaces render the agent card flat, through this header
 * (D1): the lane account badge must show here too, resolved the same way as
 * the card header's.
 */
describe('ExecutionHeaderComponent — lane account in the flat agent card (U5)', () => {
  const PROFILE = 'profile_work_0001';
  const view = signal<Pick<ProviderAccountsView, 'status' | 'snapshot'>>({
    status: 'idle',
    snapshot: null,
  });

  function ready(...accounts: Array<{ profileId: string; label: string }>) {
    view.set({
      status: 'ready',
      snapshot: {
        accounts: accounts.map((a) => ({ ...a, provider: 'claude' })),
      } as unknown as ProviderAccountsSnapshot,
    });
  }

  function lane(overrides: Partial<MonitoredAgent> = {}): MonitoredAgent {
    return {
      agentId: 'agent-1',
      cli: 'claude',
      task: 'Do work',
      status: 'completed',
      startedAt: 0,
      completedAt: 1000,
      stdout: '',
      stderr: '',
      expanded: true,
      segments: [],
      streamEvents: [],
      streamRevision: 0,
      permissionQueue: [],
      ...overrides,
    };
  }

  function render(agent: MonitoredAgent): HTMLElement {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [AgentCardComponent],
      providers: [
        { provide: ProviderAccountsStateService, useValue: { state: () => view } },
        { provide: AgentMonitorStore, useValue: { tick: () => 0 } },
        { provide: ClaudeRpcService, useValue: {} },
      ],
    });
    const fixture = TestBed.createComponent(AgentCardComponent);
    fixture.componentRef.setInput('agent', agent);
    fixture.componentRef.setInput('presentation', 'flat');
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  function badge(el: HTMLElement): HTMLElement | null {
    return el.querySelector<HTMLElement>(
      'ptah-execution-header [data-test="execution-header-row"] [data-testid="lane-account"]',
    );
  }

  beforeEach(() => view.set({ status: 'idle', snapshot: null }));

  it('shows the named account label with the 10rem cap and title, never the profile ID', () => {
    const label = 'A very long account label for the work subscription';
    ready({ profileId: PROFILE, label });
    const el = render(lane({ accountProfileId: PROFILE }));
    const b = badge(el);
    expect(el.querySelector('ptah-agent-card-header')).toBeNull();
    expect(b?.textContent?.trim()).toBe(`Account: ${label}`);
    expect(b?.getAttribute('title')).toBe(`Account: ${label}`);
    expect(b?.classList).toContain('max-w-[10rem]');
    expect(b?.classList).toContain('badge');
    expect(b?.querySelector('.truncate')).not.toBeNull();
    expect(el.textContent).not.toContain(PROFILE);
  });

  it('shows "Default" for an ambient Claude lane', () => {
    const el = render(lane({ accountProfileId: null }));
    expect(badge(el)?.textContent?.trim()).toBe('Default');
  });

  it('shows "Removed account" when the loaded list no longer has the profile', () => {
    ready({ profileId: 'profile_other_0002', label: 'Personal' });
    const el = render(lane({ accountProfileId: PROFILE }));
    expect(badge(el)?.textContent?.trim()).toBe('Removed account');
    expect(el.textContent).not.toContain(PROFILE);
  });

  it('shows nothing for a non-Claude lane or a corrupt binding', () => {
    ready({ profileId: PROFILE, label: 'Work' });
    expect(badge(render(lane({ cli: 'codex' })))).toBeNull();
    expect(badge(render(lane({ accountProfileId: undefined })))).toBeNull();
  });
});
