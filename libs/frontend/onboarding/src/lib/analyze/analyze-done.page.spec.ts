import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { TabManagerService } from '@ptah-extension/chat-state';
import { AppStateManager, VSCodeService } from '@ptah-extension/core';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import { WizardRpcService } from '@ptah-extension/setup-wizard';
import { OnboardingFlagService } from '../first-run/onboarding-flag.service';
import { AnalyzeDonePage } from './analyze-done.page';

const agent = { binding: { tabId: 'agent-tab', workspacePath: '/ws', workflow: 'setup-agent-generation', runId: 'agent-run' }, status: 'completed',
  source: { kind: 'workspace-discovery', reason: 'missing' }, effectiveProvider: 'unknown', effectiveModel: 'unknown',
  result: { counts: { total: 1, written: 1, unchanged: 0, failed: 0, skipped: 0, rejected: 0 } } };
const guidance = { ...agent, binding: { ...agent.binding, tabId: 'guidance-tab', workflow: 'setup-project-prompt', runId: 'guidance-run' } };

describe('AnalyzeDonePage', () => {
  const flags = { markCompleted: jest.fn() };
  const vscode = { postMessage: jest.fn(), config: () => ({ workspaceRoot: '/ws' }) };
  const appState = { setCurrentView: jest.fn() };
  const rpc = { getBoundRunState: jest.fn(), getEnhancedPromptsStatus: jest.fn() };
  const router = { navigate: jest.fn() };
  const tabs = { activeWorkspacePath: '/ws', findTabByIdAcrossWorkspaces: jest.fn(), getWorkspaceTabs: jest.fn() };
  beforeEach(() => {
    jest.clearAllMocks(); rpc.getBoundRunState.mockImplementation(async (binding) => binding.workflow === 'setup-agent-generation' ? agent : guidance);
    rpc.getEnhancedPromptsStatus.mockResolvedValue({ enabled: true });
    tabs.findTabByIdAcrossWorkspaces.mockImplementation((tabId) => ({ workspacePath: '/ws', tab: { id: tabId } }));
    TestBed.configureTestingModule({ providers: [provideRouter([]),
      { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({ gen: 'agent-tab', tab: 'guidance-tab' }) } } },
      { provide: Router, useValue: router }, { provide: TabManagerService, useValue: tabs },
      { provide: VSCodeService, useValue: vscode }, { provide: AppStateManager, useValue: appState }, { provide: WizardRpcService, useValue: rpc }, { provide: OnboardingFlagService, useValue: flags },
    ] });
  });
  afterEach(() => TestBed.resetTestingModule());
  it('sets completedAt and renders facts from two terminal runs', async () => {
    const fixture = TestBed.createComponent(AnalyzeDonePage); fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(flags.markCompleted).toHaveBeenCalledTimes(1);
    expect(element.querySelector('[data-testid="analyze-done-facts"]')?.textContent).toContain('1 written');
    expect(element.querySelector('[data-testid="analyze-done-facts"]')?.textContent).toContain('Project guidance: on (completed)');
  });
  it('posts SETUP_WIZARD_COMPLETE when Open chat is clicked', async () => {
    const fixture = TestBed.createComponent(AnalyzeDonePage); fixture.detectChanges(); await fixture.whenStable();
    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('[data-testid="done-open-chat"]')?.click();
    expect(vscode.postMessage).toHaveBeenCalledWith({ type: MESSAGE_TYPES.SETUP_WIZARD_COMPLETE });
    expect(appState.setCurrentView).toHaveBeenCalledWith('chat');
  });
  it('shows disabled saved guidance as off after a completed run', async () => {
    rpc.getEnhancedPromptsStatus.mockResolvedValue({ enabled: false });
    const fixture = TestBed.createComponent(AnalyzeDonePage); fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="analyze-done-facts"]')?.textContent).toContain('Project guidance: off (completed)');
  });
  it('offers Command center, Tribunal and Run again links', async () => {
    const fixture = TestBed.createComponent(AnalyzeDonePage); fixture.detectChanges(); await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    for (const [id, path] of [['done-command-center', '/command-center'], ['done-tribunal', '/chat'], ['done-run-again', '/onboarding']] as const) {
      element.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)?.click();
      expect(router.navigate).toHaveBeenCalledWith(expect.arrayContaining([path]));
    }
    expect(element.querySelector('[data-testid="done-tribunal"]')?.textContent).toContain('Ask the panel in chat');
    expect(appState.setCurrentView).toHaveBeenCalledWith('chat');
  });
});
