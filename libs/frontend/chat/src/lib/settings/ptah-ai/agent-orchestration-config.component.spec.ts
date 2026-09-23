import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  AppStateManager,
  ClaudeRpcService,
  ProvidersSettingsStateService,
  RpcResult,
} from '@ptah-extension/core';
import type { AgentOrchestrationConfig } from '@ptah-extension/shared';
import { AgentOrchestrationConfigComponent } from './agent-orchestration-config.component';

/** TASK_2026_534 R2.7 — dead or blind controls on the Agent Orchestration tab. */
describe('AgentOrchestrationConfigComponent', () => {
  let fixture: ComponentFixture<AgentOrchestrationConfigComponent>;
  let element: HTMLElement;
  let config: AgentOrchestrationConfig;
  const call = jest.fn();
  const appState = { requestSettingsTab: jest.fn(), setCurrentView: jest.fn() };

  beforeEach(async () => {
    config = {
      detectedClis: [
        { cli: 'codex', installed: true, version: '1.0.0' },
        { cli: 'copilot', installed: true, version: '2.0.0' },
      ],
      preferredAgentOrder: [],
      disabledClis: [],
      maxConcurrentAgents: 3,
      copilotAutoApprove: false,
    } as unknown as AgentOrchestrationConfig;
    call.mockReset();
    call.mockImplementation(async (method: string) =>
      method === 'agent:getConfig' ? new RpcResult(true, config) : new RpcResult(true, { success: true }),
    );
    await TestBed.configureTestingModule({
      imports: [AgentOrchestrationConfigComponent],
      providers: [
        { provide: ClaudeRpcService, useValue: { call } },
        { provide: AppStateManager, useValue: appState },
        {
          provide: ProvidersSettingsStateService,
          useValue: { refreshCliAgents: jest.fn(), refreshCliModels: jest.fn() },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(AgentOrchestrationConfigComponent);
    element = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });
  afterEach(() => TestBed.resetTestingModule());

  function copilotToggle(): HTMLInputElement | null {
    return element.querySelector<HTMLInputElement>('[data-testid="copilot-auto-approve"]');
  }

  it('renders no Codex auto-approve control (the host ignores codexAutoApprove)', () => {
    const text = element.textContent ?? '';
    expect(text).not.toMatch(/codex automatic approval/i);
    expect(element.querySelectorAll('[data-testid="copilot-auto-approve"]')).toHaveLength(1);
  });

  it('binds the Copilot auto-approve toggle to the saved value and writes the flipped value', async () => {
    const toggle = copilotToggle();
    expect(toggle?.type).toBe('checkbox');
    expect(toggle?.classList.contains('toggle')).toBe(true);
    expect(toggle?.checked).toBe(false);
    toggle?.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(call).toHaveBeenCalledWith('agent:setConfig', { copilotAutoApprove: true });
    expect(copilotToggle()?.checked).toBe(true);
  });

  // Review #2: agent:setConfig reports persistence failure as {success:false}
  // INSIDE a successful envelope (agent-rpc.handlers.ts catch branch).
  it.each([
    ['a {success:false} payload in a successful envelope', async () => new RpcResult(true, { success: false, error: 'EACCES' })],
    ['a failed envelope', async () => new RpcResult(false, undefined, 'failed')],
    ['a rejected call', async () => { throw new Error('transport closed'); }],
  ])('rolls back and shows an error after %s', async (_label, setConfig) => {
    call.mockImplementation(async (method: string) =>
      method === 'agent:setConfig' ? setConfig() : new RpcResult(true, config),
    );
    copilotToggle()?.click();
    await fixture.whenStable();
    fixture.detectChanges();
    // Saved value (read back) is still false: the toggle and state show false.
    expect(copilotToggle()?.checked).toBe(false);
    expect(fixture.componentInstance.agentConfig()?.copilotAutoApprove).toBe(false);
    expect(element.querySelector('[data-testid="copilot-auto-approve-error"]')?.textContent).toContain(
      'Could not save Copilot auto-approve',
    );
    expect(copilotToggle()?.disabled).toBe(false);
  });

  it('trusts the read-back when an uncertain write did persist', async () => {
    call.mockImplementation(async (method: string) => {
      if (method === 'agent:setConfig') throw new Error('response lost');
      return new RpcResult(true, { ...config, copilotAutoApprove: true });
    });
    copilotToggle()?.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(copilotToggle()?.checked).toBe(true);
    expect(element.querySelector('[data-testid="copilot-auto-approve-error"]')).toBeNull();
  });

  it('disables the toggle while a write is in flight', async () => {
    let release!: (value: RpcResult<unknown>) => void;
    call.mockImplementation((method: string) =>
      method === 'agent:setConfig'
        ? new Promise((resolve) => { release = resolve; })
        : Promise.resolve(new RpcResult(true, config)),
    );
    copilotToggle()?.click();
    fixture.detectChanges();
    expect(copilotToggle()?.disabled).toBe(true);
    release(new RpcResult(true, { success: true }));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(copilotToggle()?.disabled).toBe(false);
    expect(copilotToggle()?.checked).toBe(true);
  });

  it('has no expand chevron or click-to-expand row, and no drag grip', () => {
    expect(element.querySelector('.cursor-pointer')).toBeNull();
    expect(element.querySelector('.rotate-90')).toBeNull();
    expect(element.innerHTML).not.toMatch(/grip/i);
    // Reordering arrows stay.
    expect(element.querySelectorAll('button[aria-label="Move up"]').length).toBeGreaterThan(0);
  });

  it('routes "Manage provider, model and credentials" to the Providers CLI agents section', () => {
    const manage = Array.from(element.querySelectorAll('button')).find((node) =>
      node.textContent?.includes('Manage provider, model and credentials in Providers'),
    );
    manage?.click();
    expect(appState.requestSettingsTab).toHaveBeenCalledWith({ tab: 'providers', section: 'cli-agents' });
    expect(appState.setCurrentView).toHaveBeenCalledWith('settings');
  });
});
