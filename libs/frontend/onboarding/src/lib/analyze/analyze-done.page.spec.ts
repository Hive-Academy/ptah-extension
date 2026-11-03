import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import {
  ActivatedRoute,
  Router,
  RouterLink,
  type ParamMap,
  convertToParamMap,
  provideRouter,
} from '@angular/router';
import { TabManagerService } from '@ptah-extension/chat-state';
import { AppStateManager, VSCodeService } from '@ptah-extension/core';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import {
  SetupWizardStateService,
  WizardRpcService,
} from '@ptah-extension/setup-wizard';
import { BehaviorSubject } from 'rxjs';
import { OnboardingFlagService } from '../first-run/onboarding-flag.service';
import { AnalyzeDonePage } from './analyze-done.page';

const agent = {
  binding: {
    tabId: 'agent-tab',
    workspacePath: '/ws',
    workflow: 'setup-agent-generation',
    runId: 'agent-run',
  },
  status: 'completed',
  source: { kind: 'workspace-discovery', reason: 'missing' },
  effectiveProvider: 'unknown',
  effectiveModel: 'unknown',
  result: {
    counts: {
      total: 1,
      written: 1,
      unchanged: 0,
      failed: 0,
      skipped: 0,
      rejected: 0,
    },
  },
};
const guidance = {
  ...agent,
  binding: {
    ...agent.binding,
    tabId: 'guidance-tab',
    workflow: 'setup-project-prompt',
    runId: 'guidance-run',
  },
};

describe('AnalyzeDonePage', () => {
  const flags = { markCompleted: jest.fn() };
  const vscode = {
    postMessage: jest.fn(),
    config: () => ({ workspaceRoot: '/ws' }),
    isElectron: true,
  };
  const appState = {
    setCurrentView: jest.fn(),
    openSkillsDivergedClones: jest.fn(),
  };
  const rpc = {
    getBoundRunState: jest.fn(),
    getEnhancedPromptsStatus: jest.fn(),
  };
  const router = { navigate: jest.fn() };
  const tabs = {
    activeWorkspacePath: '/ws',
    findTabByIdAcrossWorkspaces: jest.fn(),
    getWorkspaceTabs: jest.fn(),
  };
  const completionData = signal<unknown>(null);
  let queryParams: BehaviorSubject<ParamMap>;
  beforeEach(() => {
    jest.clearAllMocks();
    completionData.set(null);
    queryParams = new BehaviorSubject(
      convertToParamMap({ gen: 'agent-tab', tab: 'guidance-tab' }),
    );
    vscode.isElectron = true;
    rpc.getBoundRunState.mockImplementation(async (binding) =>
      binding.workflow === 'setup-agent-generation' ? agent : guidance,
    );
    rpc.getEnhancedPromptsStatus.mockResolvedValue({ enabled: true });
    tabs.findTabByIdAcrossWorkspaces.mockImplementation((tabId) => ({
      workspacePath: '/ws',
      tab: { id: tabId },
    }));
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            queryParamMap: queryParams.asObservable(),
          },
        },
        { provide: Router, useValue: router },
        { provide: TabManagerService, useValue: tabs },
        { provide: VSCodeService, useValue: vscode },
        { provide: AppStateManager, useValue: appState },
        { provide: WizardRpcService, useValue: rpc },
        { provide: SetupWizardStateService, useValue: { completionData } },
        { provide: OnboardingFlagService, useValue: flags },
      ],
    });
  });
  afterEach(() => TestBed.resetTestingModule());
  it('sets completedAt and renders facts from two terminal runs', async () => {
    const fixture = TestBed.createComponent(AnalyzeDonePage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(flags.markCompleted).toHaveBeenCalledTimes(1);
    expect(
      element.querySelector('[data-testid="analyze-done-facts"]')?.textContent,
    ).toContain('1 written');
    expect(
      element.querySelector('[data-testid="analyze-done-facts"]')?.textContent,
    ).toContain('Project guidance: on (completed)');
  });
  it('posts SETUP_WIZARD_COMPLETE when Open chat is clicked', async () => {
    const fixture = TestBed.createComponent(AnalyzeDonePage);
    fixture.detectChanges();
    await fixture.whenStable();
    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('[data-testid="done-open-chat"]')
      ?.click();
    expect(vscode.postMessage).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.SETUP_WIZARD_COMPLETE,
    });
    expect(appState.setCurrentView).toHaveBeenCalledWith('chat');
  });
  it('shows disabled saved guidance as off after a completed run', async () => {
    rpc.getEnhancedPromptsStatus.mockResolvedValue({ enabled: false });
    const fixture = TestBed.createComponent(AnalyzeDonePage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(
      (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="analyze-done-facts"]',
      )?.textContent,
    ).toContain('Project guidance: off (completed)');
  });
  it('offers Command center, Tribunal and Run again links', async () => {
    const fixture = TestBed.createComponent(AnalyzeDonePage);
    fixture.detectChanges();
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    for (const [id, path] of [
      ['done-command-center', '/command-center'],
      ['done-tribunal', '/chat'],
      ['done-run-again', '/onboarding'],
    ] as const) {
      element
        .querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)
        ?.click();
      expect(router.navigate).toHaveBeenCalledWith(
        expect.arrayContaining([path]),
      );
    }
    expect(
      element.querySelector('[data-testid="done-tribunal"]')?.textContent,
    ).toContain('Get a second opinion in chat');
    expect(
      element.querySelector('[data-testid="done-run-again"]')?.textContent,
    ).toContain('Run setup again');
    expect(appState.setCurrentView).toHaveBeenCalledWith('chat');
  });
  it('marks Done complete and links failed agent facts back to Generate agents', async () => {
    rpc.getBoundRunState.mockImplementation(async (binding) =>
      binding.workflow === 'setup-agent-generation'
        ? {
            ...agent,
            result: { counts: { ...agent.result.counts, failed: 1 } },
          }
        : guidance,
    );
    const fixture = TestBed.createComponent(AnalyzeDonePage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(
      element
        .querySelector('li[data-state="current-complete"]')
        ?.getAttribute('aria-current'),
    ).toBe('step');
    expect(
      element.querySelector('li[data-state="current-complete"]')?.textContent,
    ).toContain('Done');
    expect(
      element.querySelector(
        '[data-testid="analyze-done-facts"] .text-state-need',
      )?.textContent,
    ).toContain('1 failed');
    const reviewLink = fixture.debugElement.query(
      By.css('[data-testid="done-review-agents"]'),
    );
    expect(reviewLink.nativeElement.textContent).toContain(
      'Review failed agents',
    );
    expect(reviewLink.injector.get(RouterLink).queryParams).toEqual({
      tab: 'agent-tab',
    });
  });
  const outcomes = [
    {
      agentId: 'writer',
      fileName: 'writer.md',
      status: 'written',
      rejectedSections: 0,
      tailoredSections: 1,
    },
    {
      agentId: 'keeper',
      fileName: 'keeper.md',
      status: 'kept',
      rejectedSections: 0,
      tailoredSections: 0,
    },
    {
      agentId: 'broken',
      fileName: 'broken.md',
      status: 'failed',
      error: 'secret backend stack trace',
      rejectedSections: 0,
      tailoredSections: 0,
    },
  ];
  const target = {
    harnessRoot: '/ws',
    openedFolder: '/ws',
    chosen: 'harness-root',
    openedIsHarnessRoot: true,
  };
  function resultWithOutcomes(libraryPass: 'failed' | 'updated' = 'updated') {
    return {
      ...agent,
      result: {
        ...agent.result,
        agentOutcomes: outcomes,
        target,
        libraryPass,
        libraryDiverged: ['writer'],
      },
    };
  }
  it('renders five outcome counters, per-file results, safe failure copy and diverged Library copies', async () => {
    rpc.getBoundRunState.mockImplementation(async (binding) =>
      binding.workflow === 'setup-agent-generation'
        ? resultWithOutcomes()
        : guidance,
    );
    const fixture = TestBed.createComponent(AnalyzeDonePage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const summary = element.querySelector(
      '[data-testid="done-agent-outcomes"]',
    );
    expect(summary?.querySelectorAll('[data-outcome]')).toHaveLength(5);
    expect(summary?.textContent).toContain('Kept (your file)');
    expect(summary?.textContent).toContain('Changed since preview (kept)');
    expect(summary?.textContent).toContain('writer.md');
    expect(summary?.textContent).toContain('keeper.md');
    expect(summary?.textContent).toContain('broken.md');
    expect(
      summary?.querySelector('[data-testid="outcome-failure"]')?.textContent,
    ).not.toContain('secret backend stack trace');
    expect(
      summary?.querySelector('[data-testid="outcome-diverged"]')?.textContent,
    ).toContain('writer');
    [...(summary?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
      .find((button) => button.textContent?.includes('Open the Library'))
      ?.click();
    expect(appState.openSkillsDivergedClones).toHaveBeenCalledTimes(1);
  });
  it('shows grade expectation for a written result and stale notice only after a failed Library pass', async () => {
    rpc.getBoundRunState.mockImplementation(async (binding) =>
      binding.workflow === 'setup-agent-generation'
        ? resultWithOutcomes('failed')
        : guidance,
    );
    const fixture = TestBed.createComponent(AnalyzeDonePage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    let element = fixture.nativeElement as HTMLElement;
    expect(
      element.querySelector('[data-testid="grade-expectation"]')?.textContent,
    ).toContain('About grades');
    expect(
      element.querySelector('[data-testid="library-stale-notice"]')
        ?.textContent,
    ).toContain('next refresh');
    rpc.getBoundRunState.mockImplementation(async (binding) =>
      binding.workflow === 'setup-agent-generation'
        ? resultWithOutcomes('updated')
        : guidance,
    );
    queryParams.next(
      convertToParamMap({ gen: 'agent-tab', tab: 'guidance-tab' }),
    );
    await fixture.whenStable();
    fixture.detectChanges();
    element = fixture.nativeElement as HTMLElement;
    expect(
      element.querySelector('[data-testid="library-stale-notice"]'),
    ).toBeNull();
  });
  it('shows loading until a late result arrives and fetches both runs in parallel', async () => {
    let resolveAgent!: (value: typeof agent) => void;
    const lateAgent = new Promise<typeof agent>((resolve) => {
      resolveAgent = resolve;
    });
    rpc.getBoundRunState.mockImplementation((binding) =>
      binding.workflow === 'setup-agent-generation'
        ? lateAgent
        : Promise.resolve(guidance),
    );
    const fixture = TestBed.createComponent(AnalyzeDonePage);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain(
      'Loading agent results',
    );
    expect(fixture.nativeElement.textContent).not.toContain(
      'skipped or is unavailable',
    );
    expect(rpc.getBoundRunState).toHaveBeenCalledTimes(2);
    resolveAgent(agent);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Setup Complete!');
    expect(fixture.nativeElement.textContent).not.toContain(
      'Loading agent results',
    );
  });
  it('distinguishes missing, running, failed lookup and mismatched tab', async () => {
    const states = [
      { run: null, copy: 'skipped or is unavailable' },
      { run: { ...agent, status: 'running' }, copy: 'still running' },
    ];
    for (const state of states) {
      rpc.getBoundRunState.mockImplementation(async (binding) =>
        binding.workflow === 'setup-agent-generation' ? state.run : guidance,
      );
      const fixture = TestBed.createComponent(AnalyzeDonePage);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain(state.copy);
      fixture.destroy();
    }
    rpc.getBoundRunState.mockImplementation(async (binding) => {
      if (binding.workflow === 'setup-agent-generation')
        throw new Error('lookup');
      return guidance;
    });
    const failed = TestBed.createComponent(AnalyzeDonePage);
    failed.detectChanges();
    await failed.whenStable();
    failed.detectChanges();
    expect(failed.nativeElement.textContent).toContain(
      'Could not load agent results',
    );
    failed.destroy();
    tabs.findTabByIdAcrossWorkspaces.mockImplementation((tabId) => ({
      workspacePath: tabId === 'agent-tab' ? '/other' : '/ws',
      tab: { id: tabId },
    }));
    const mismatched = TestBed.createComponent(AnalyzeDonePage);
    mismatched.detectChanges();
    await mismatched.whenStable();
    mismatched.detectChanges();
    expect(mismatched.nativeElement.textContent).toContain(
      'different tab or workspace',
    );
  });
  it('shows complete partial counts and a warning for a rejected outcome with zero failed count', async () => {
    rpc.getBoundRunState.mockImplementation(async (binding) =>
      binding.workflow === 'setup-agent-generation'
        ? {
            ...agent,
            result: {
              ...agent.result,
              counts: {
                ...agent.result.counts,
                failed: 0,
                kept: 1,
                changedSincePreview: 1,
              },
              agentOutcomes: [{ ...outcomes[0], status: 'rejected' }],
            },
          }
        : guidance,
    );
    const fixture = TestBed.createComponent(AnalyzeDonePage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain(
      'Setup Finished With Errors',
    );
    expect(fixture.nativeElement.textContent).toContain(
      'Agents: needs attention',
    );
    expect(
      fixture.nativeElement.querySelector('[data-testid="done-review-agents"]'),
    ).not.toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('0 failed');
    fixture.destroy();
    rpc.getBoundRunState.mockImplementation(async (binding) =>
      binding.workflow === 'setup-agent-generation'
        ? {
            ...agent,
            result: {
              ...agent.result,
              counts: {
                ...agent.result.counts,
                kept: 1,
                changedSincePreview: 1,
              },
            },
          }
        : guidance,
    );
    const partial = TestBed.createComponent(AnalyzeDonePage);
    partial.detectChanges();
    await partial.whenStable();
    partial.detectChanges();
    expect(partial.nativeElement.textContent).toContain('1 kept');
    expect(partial.nativeElement.textContent).toContain(
      '1 changed since preview',
    );
  });
  it('restores rejected sections, Enhanced, failure header and quick start', async () => {
    rpc.getBoundRunState.mockImplementation(async (binding) =>
      binding.workflow === 'setup-agent-generation'
        ? {
            ...resultWithOutcomes(),
            result: {
              ...resultWithOutcomes().result,
              rejectedSections: 2,
              enhancedPromptsUsed: true,
            },
          }
        : guidance,
    );
    const fixture = TestBed.createComponent(AnalyzeDonePage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(
      element.querySelector('[data-testid="done-rejected-sections"]')
        ?.textContent,
    ).toContain('2 sections rejected');
    expect(
      element.querySelector('[data-testid="done-enhanced"]')?.textContent,
    ).toContain('Enhanced');
    expect(
      element.querySelector('[data-testid="done-outcome-header"]')?.textContent,
    ).toContain('Setup Finished With Errors');
    expect(
      element.querySelector('[data-testid="done-quick-start"]')?.textContent,
    ).toContain('/orchestrate Add user authentication');
  });
  it('shows opened-folder notice and hides Library copy outside Electron or without a target', async () => {
    rpc.getBoundRunState.mockImplementation(async (binding) =>
      binding.workflow === 'setup-agent-generation'
        ? {
            ...resultWithOutcomes('failed'),
            result: {
              ...resultWithOutcomes('failed').result,
              target: {
                ...target,
                chosen: 'opened-folder',
                openedFolder: '/opened',
                openedIsHarnessRoot: false,
              },
            },
          }
        : guidance,
    );
    const opened = TestBed.createComponent(AnalyzeDonePage);
    opened.detectChanges();
    await opened.whenStable();
    opened.detectChanges();
    expect(opened.nativeElement.textContent).toContain('These agents are in');
    expect(opened.nativeElement.textContent).toContain('/opened');
    opened.destroy();
    vscode.isElectron = false;
    rpc.getBoundRunState.mockImplementation(async (binding) =>
      binding.workflow === 'setup-agent-generation'
        ? resultWithOutcomes('failed')
        : guidance,
    );
    const nonElectron = TestBed.createComponent(AnalyzeDonePage);
    nonElectron.detectChanges();
    await nonElectron.whenStable();
    nonElectron.detectChanges();
    expect(
      nonElectron.nativeElement.querySelector(
        '[data-testid="library-stale-notice"]',
      ),
    ).toBeNull();
    expect(
      nonElectron.nativeElement.querySelector(
        '[data-testid="grade-expectation"]',
      ),
    ).toBeNull();
    nonElectron.destroy();
    vscode.isElectron = true;
    rpc.getBoundRunState.mockImplementation(async (binding) =>
      binding.workflow === 'setup-agent-generation'
        ? {
            ...resultWithOutcomes('failed'),
            result: {
              ...resultWithOutcomes('failed').result,
              target: undefined,
            },
          }
        : guidance,
    );
    const noTarget = TestBed.createComponent(AnalyzeDonePage);
    noTarget.detectChanges();
    await noTarget.whenStable();
    noTarget.detectChanges();
    expect(
      noTarget.nativeElement.querySelector(
        '[data-testid="library-stale-notice"]',
      ),
    ).toBeNull();
    expect(
      noTarget.nativeElement.querySelector('[data-testid="grade-expectation"]'),
    ).toBeNull();
  });
  it('shows a message for empty agent outcomes', async () => {
    rpc.getBoundRunState.mockImplementation(async (binding) =>
      binding.workflow === 'setup-agent-generation'
        ? {
            ...resultWithOutcomes(),
            result: { ...resultWithOutcomes().result, agentOutcomes: [] },
          }
        : guidance,
    );
    const fixture = TestBed.createComponent(AnalyzeDonePage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain(
      'Nothing new was written',
    );
  });
  it.each([
    ['cancelled', 'Setup Cancelled'],
    ['timed-out', 'Setup Timed Out'],
  ])('shows a safe %s header and review link', async (status, heading) => {
    rpc.getBoundRunState.mockImplementation(async (binding) =>
      binding.workflow === 'setup-agent-generation'
        ? { ...agent, status, result: { ...agent.result, success: false } }
        : guidance,
    );
    const fixture = TestBed.createComponent(AnalyzeDonePage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(
      element.querySelector('[data-testid="done-outcome-header"]')?.textContent,
    ).toContain(heading);
    expect(element.textContent).not.toContain('Some agents were not generated');
    expect(
      element.querySelector('[data-testid="done-review-agents"]')?.textContent,
    ).toContain('Review agent run');
    expect(
      element.querySelector('[data-testid="done-agents-warning"]'),
    ).not.toBeNull();
    expect(element.querySelector('h1')?.textContent).toContain(
      'Review workspace setup',
    );
    expect(element.textContent).not.toContain("You're ready to work");
    expect(element.textContent).not.toContain('workspace setup is complete');
  });
  it('shows the ready heading when agent generation was skipped', async () => {
    rpc.getBoundRunState.mockImplementation(async (binding) =>
      binding.workflow === 'setup-agent-generation' ? null : guidance,
    );
    const fixture = TestBed.createComponent(AnalyzeDonePage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('h1')?.textContent).toContain(
      "You're ready to work",
    );
    expect(element.textContent).not.toContain('Review the agent run');
  });
  it('shows a safe failure reason with no outcome facts', async () => {
    rpc.getBoundRunState.mockImplementation(async (binding) =>
      binding.workflow === 'setup-agent-generation'
        ? { ...agent, status: 'failed', result: undefined }
        : guidance,
    );
    const fixture = TestBed.createComponent(AnalyzeDonePage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(
      element.querySelector('[data-testid="done-run-failure-reason"]')
        ?.textContent,
    ).toContain('Agent generation failed');
    expect(
      element.querySelector('[data-testid="done-review-agents"]'),
    ).not.toBeNull();
    expect(element.querySelector('h1')?.textContent).toContain(
      'Review workspace setup',
    );
    expect(element.textContent).not.toContain('workspace setup is complete');
  });
  it('restores count and safe generation errors from the matching completion payload', async () => {
    const run = resultWithOutcomes();
    rpc.getBoundRunState.mockImplementation(async (binding) =>
      binding.workflow === 'setup-agent-generation' ? run : guidance,
    );
    completionData.set({
      result: run.result,
      errors: ['EACCES /private/provider-stack'],
    });
    const fixture = TestBed.createComponent(AnalyzeDonePage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(
      element.querySelector('[data-testid="done-agent-count"]')?.textContent,
    ).toContain('(3)');
    const errorList = element.querySelector(
      '[data-testid="done-generation-errors"]',
    );
    expect(errorList?.querySelectorAll('li')).toHaveLength(1);
    expect(errorList?.textContent).not.toContain('/private/provider-stack');
    expect(errorList?.textContent).not.toContain('EACCES');
  });
  it('renders safe bound-result errors when the host supplies them', async () => {
    rpc.getBoundRunState.mockImplementation(async (binding) =>
      binding.workflow === 'setup-agent-generation'
        ? {
            ...resultWithOutcomes(),
            result: {
              ...resultWithOutcomes().result,
              errors: ['EACCES /private/agent.md'],
            },
          }
        : guidance,
    );
    const fixture = TestBed.createComponent(AnalyzeDonePage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const errors = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="done-generation-errors"]',
    );
    expect(errors?.querySelectorAll('li')).toHaveLength(1);
    expect(errors?.textContent).not.toContain('/private/agent.md');
  });
  it('restores workflow types, Pro Tips and all example commands', async () => {
    const fixture = TestBed.createComponent(AnalyzeDonePage);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const workflows = element.querySelector(
      '[data-testid="done-workflow-types"]',
    )?.parentElement?.textContent;
    for (const type of [
      'FEATURE',
      'BUGFIX',
      'REFACTORING',
      'DOCS',
      'RESEARCH',
      'DEVOPS',
    ])
      expect(workflows).toContain(type);
    const tips = element.querySelector('[data-testid="done-pro-tips"]')
      ?.parentElement?.textContent;
    expect(tips).toContain('@agent-name');
    expect(tips).toContain('.ptah/specs/');
    const examples = element.querySelector(
      '[data-testid="done-example-commands"]',
    )?.parentElement?.textContent;
    for (const command of [
      '/orchestrate Fix login form validation',
      '/orchestrate Refactor UserService',
      '/orchestrate Create API docs',
      '/orchestrate TASK_2025_XXX',
      '# Resumes from checkpoint',
    ])
      expect(examples).toContain(command);
  });
  it('shows Enhanced and output directory without outcome rows', async () => {
    rpc.getBoundRunState.mockImplementation(async (binding) =>
      binding.workflow === 'setup-agent-generation'
        ? {
            ...agent,
            result: { ...agent.result, target, enhancedPromptsUsed: true },
          }
        : guidance,
    );
    const fixture = TestBed.createComponent(AnalyzeDonePage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(
      element.querySelector('[data-testid="done-enhanced"]'),
    ).not.toBeNull();
    expect(
      element.querySelector('[data-testid="done-agent-count"]')?.textContent,
    ).toContain('(1)');
    expect(
      element.querySelector('[data-testid="done-output-directory"]')
        ?.textContent,
    ).toContain('/ws');
  });
  it('shows the empty message when every outcome was skipped', async () => {
    rpc.getBoundRunState.mockImplementation(async (binding) =>
      binding.workflow === 'setup-agent-generation'
        ? {
            ...resultWithOutcomes(),
            result: {
              ...resultWithOutcomes().result,
              agentOutcomes: [{ ...outcomes[0], status: 'skipped' }],
            },
          }
        : guidance,
    );
    const fixture = TestBed.createComponent(AnalyzeDonePage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(
      (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="done-no-outcomes"]',
      )?.textContent,
    ).toContain('Nothing new was written');
    expect(
      (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="done-agent-count"]',
      )?.textContent,
    ).toContain('(0)');
  });
  it('reloads changed query params and ignores stale lookups', async () => {
    let resolveOld!: (value: typeof agent) => void;
    const oldLookup = new Promise<typeof agent>((resolve) => {
      resolveOld = resolve;
    });
    rpc.getBoundRunState.mockImplementation((binding) => {
      if (binding.tabId === 'agent-tab') return oldLookup;
      if (binding.tabId === 'new-agent-tab')
        return Promise.resolve({
          ...agent,
          binding: { ...agent.binding, tabId: 'new-agent-tab' },
          status: 'cancelled',
        });
      return Promise.resolve(guidance);
    });
    const fixture = TestBed.createComponent(AnalyzeDonePage);
    fixture.detectChanges();
    queryParams.next(
      convertToParamMap({ gen: 'new-agent-tab', tab: 'guidance-tab' }),
    );
    await fixture.whenStable();
    fixture.detectChanges();
    expect(
      (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="done-outcome-header"]',
      )?.textContent,
    ).toContain('Setup Cancelled');
    const link = fixture.debugElement.query(
      By.css('[data-testid="done-review-agents"]'),
    );
    expect(link.injector.get(RouterLink).queryParams).toEqual({
      tab: 'new-agent-tab',
    });
    resolveOld(agent);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(
      (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="done-outcome-header"]',
      )?.textContent,
    ).toContain('Setup Cancelled');
  });
});
