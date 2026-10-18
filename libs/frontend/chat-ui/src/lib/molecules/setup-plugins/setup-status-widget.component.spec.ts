import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TabManagerService } from '@ptah-extension/chat-state';
import { ClaudeRpcService, SurfaceRouterService } from '@ptah-extension/core';
import type { SetupGenerationWorkflow } from '@ptah-extension/shared';
import { GenerationWorkflowLauncherService } from '../../services/generation-workflow-launcher.service';
import { SetupStatusWidgetComponent } from './setup-status-widget.component';

describe('SetupStatusWidgetComponent', () => {
  const owners = new Map<SetupGenerationWorkflow, string>();
  const tabs = {
    activeWorkspacePath: '/workspace',
    findWorkflowTab: jest.fn(
      (path: string, workflow: SetupGenerationWorkflow) =>
        path === '/workspace' && owners.has(workflow)
          ? { id: owners.get(workflow) }
          : null,
    ),
    getWorkspaceTabs: jest.fn(() => []),
    createWorkflowTabForWorkspace: jest.fn(
      (path: string, workflow: SetupGenerationWorkflow) => {
        const id = `${workflow}-tab`;
        owners.set(workflow, id);
        return id;
      },
    ),
    switchTab: jest.fn(),
  };
  const router = { navigateToSurface: jest.fn() };
  const rpc = {
    call: jest.fn(async (method: string) => ({
      data:
        method === 'setup-status:get-status'
          ? {
              isConfigured: false,
              agentCount: 0,
              ruleCount: 0,
              lastUpdated: null,
              hasClaudeConfig: false,
            }
          : { success: true },
      isSuccess: () => true,
    })),
  };

  let fixture: ComponentFixture<SetupStatusWidgetComponent>;
  let launcher: GenerationWorkflowLauncherService;

  const click = async (label: string): Promise<void> => {
    const buttons = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
    );
    const button = buttons.find((item) => item.textContent?.includes(label));
    expect(button).toBeDefined();
    button?.click();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    owners.clear();
    tabs.activeWorkspacePath = '/workspace';
    router.navigateToSurface.mockResolvedValue('navigated');
    TestBed.configureTestingModule({
      imports: [SetupStatusWidgetComponent],
      providers: [
        GenerationWorkflowLauncherService,
        { provide: ClaudeRpcService, useValue: rpc },
        { provide: TabManagerService, useValue: tabs },
        { provide: SurfaceRouterService, useValue: router },
      ],
    });
    launcher = TestBed.inject(GenerationWorkflowLauncherService);
    fixture = TestBed.createComponent(SetupStatusWidgetComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it.each([
    ['Generate agents', 'setup-agent-generation'],
    ['Project guidance', 'setup-project-prompt'],
  ] as const)('opens %s in the active workspace', async (label, workflow) => {
    await click(label);

    expect(tabs.createWorkflowTabForWorkspace).toHaveBeenCalledWith(
      '/workspace',
      workflow,
      expect.any(String),
      undefined,
    );
    expect(router.navigateToSurface).toHaveBeenCalledWith('setup-wizard', [
      'generation',
      workflow,
      `${workflow}-tab`,
    ]);
    expect(tabs.switchTab).toHaveBeenCalledWith(`${workflow}-tab`);
    expect(launcher.consumeOrigin(`${workflow}-tab`)).toBe('independent-start');
    expect(rpc.call).not.toHaveBeenCalledWith(
      'setup-wizard:launch',
      expect.anything(),
      expect.anything(),
    );
  });

  it('focuses an existing workflow tab on a second click', async () => {
    await click('Generate agents');
    await click('Generate agents');

    expect(tabs.createWorkflowTabForWorkspace).toHaveBeenCalledTimes(1);
    expect(tabs.switchTab).toHaveBeenCalledTimes(2);
    expect(tabs.switchTab).toHaveBeenLastCalledWith(
      'setup-agent-generation-tab',
    );
  });

  it('keeps agent and guidance owners separate', async () => {
    await click('Generate agents');
    await click('Project guidance');

    expect(tabs.createWorkflowTabForWorkspace).toHaveBeenCalledTimes(2);
    expect(owners.size).toBe(2);
  });

  it('shows safe copy after a failed generation launch', async () => {
    router.navigateToSurface.mockResolvedValue('failed');
    await click('Generate agents');

    expect(fixture.nativeElement.textContent).toContain(
      'Could not open generation. Please try again.',
    );
  });

  it('does not show an error after cancellation', async () => {
    router.navigateToSurface.mockResolvedValue('cancelled');
    await click('Project guidance');

    expect(fixture.componentInstance.error()).toBeNull();
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('[role="alert"]'),
    ).toBeNull();
  });

  it('keeps the original analysis wizard action', async () => {
    await click('Configure');

    expect(rpc.call).toHaveBeenCalledWith(
      'setup-wizard:launch',
      {},
      { timeout: 5000 },
    );
    expect(tabs.createWorkflowTabForWorkspace).not.toHaveBeenCalled();
  });
});
