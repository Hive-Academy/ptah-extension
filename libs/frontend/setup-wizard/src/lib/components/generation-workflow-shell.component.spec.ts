import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { convertToParamMap } from '@angular/router';
import { TabManagerService } from '@ptah-extension/chat-state';
import { GenerationWorkflowLauncherService } from '@ptah-extension/chat-ui';
import { SurfaceRouterService } from '@ptah-extension/core';
import type { SetupGenerationRunState } from '@ptah-extension/shared';
import { GenerationWorkflowStore } from '../services/generation-workflow.store';
import { AgentGenerationStore } from '../services/agent-generation.store';
import { GenerationHandoffStore } from '../services/generation-handoff.store';
import { GuidanceGenerationStore } from '../services/guidance-generation.store';
import { GenerationWorkflowShellComponent } from './generation-workflow-shell.component';

describe('GenerationWorkflowShellComponent', () => {
  it('docks a 336px sidebar beside full-height chat, then opens an inert-chat sheet with Stop at narrow host widths', () => {
    const active = signal(false);
    const stop = jest.fn();
    const params = convertToParamMap({
      tabId: 'guidance',
      workflow: 'setup-project-prompt',
    });
    TestBed.configureTestingModule({
      providers: [
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: new BehaviorSubject(params),
            snapshot: { paramMap: params },
          },
        },
        {
          provide: TabManagerService,
          useValue: {
            tabs: signal([]),
            activeWorkspacePath$: signal('/ws'),
            getWorkspaceTabs: () => [
              { id: 'guidance', workflow: 'setup-project-prompt' },
            ],
          },
        },
        {
          provide: GenerationWorkflowLauncherService,
          useValue: { consumeOrigin: jest.fn() },
        },
        {
          provide: GenerationWorkflowStore,
          useValue: {
            bind: jest.fn(),
            unbind: jest.fn(),
            stop,
            state: () => (active() ? 'running' : 'idle'),
            isBound: active,
            run: () => null,
            acceptedRun: () => null,
          },
        },
        { provide: AgentGenerationStore, useValue: { error: () => false } },
        { provide: GenerationHandoffStore, useValue: { pending: () => null } },
        {
          provide: GuidanceGenerationStore,
          useValue: {
            bind: jest.fn(),
            unbind: jest.fn(),
            status: () => 'idle',
            run: () => null,
          },
        },
      ],
    });
    TestBed.overrideComponent(GenerationWorkflowShellComponent, {
      set: { imports: [], schemas: [NO_ERRORS_SCHEMA] },
    });
    const fixture = TestBed.createComponent(GenerationWorkflowShellComponent);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const sidebar = root.querySelector('#wizard-sidebar') as HTMLElement;
    const chat = root.querySelector('ptah-session-embed') as HTMLElement;
    expect(sidebar.style.width).toBe('336px');
    expect(chat.classList.contains('flex-1')).toBe(true);
    expect(root.querySelector('[aria-controls="wizard-sidebar"]')).toBeNull();
    fixture.componentInstance.hostWidth.set(400);
    fixture.detectChanges();
    const peek = root.querySelector<HTMLButtonElement>(
      '[aria-controls="wizard-sidebar"]',
    );
    expect(peek).not.toBeNull();
    expect(sidebar.classList.contains('hidden')).toBe(true);
    expect(chat.hasAttribute('inert')).toBe(false);
    peek?.click();
    fixture.detectChanges();
    expect(sidebar.classList.contains('hidden')).toBe(false);
    expect(chat.hasAttribute('inert')).toBe(true);
    expect(chat.getAttribute('aria-hidden')).toBe('true');
    active.set(true);
    fixture.detectChanges();
    const stopButton = root.querySelector<HTMLButtonElement>(
      '[aria-label="Stop generation"]',
    );
    expect(stopButton).not.toBeNull();
    stopButton?.click();
    expect(stop).toHaveBeenCalledTimes(1);
    root.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    fixture.detectChanges();
    expect(chat.hasAttribute('inert')).toBe(false);
    expect(document.activeElement).toBe(peek);
    active.set(false);
    fixture.detectChanges();
    expect(root.querySelector('[aria-label="Stop generation"]')).toBeNull();
    fixture.destroy();
  });
  const navigateToSurface = jest.fn().mockResolvedValue('navigated');
  beforeEach(() =>
    TestBed.configureTestingModule({
      providers: [
        { provide: SurfaceRouterService, useValue: { navigateToSurface } },
      ],
    }),
  );
  it('consumes the launch intent when a guidance tab binds', () => {
    const consumeOrigin = jest.fn().mockReturnValue('independent-start');
    const bindGuidance = jest.fn();
    const refreshGuidance = jest.fn();
    const adoptGuidance = jest.fn();
    const guidanceRun = signal<SetupGenerationRunState | null>(null);
    TestBed.configureTestingModule({
      providers: [
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: new BehaviorSubject(
              convertToParamMap({
                tabId: 'guidance',
                workflow: 'setup-project-prompt',
              }),
            ),
            snapshot: {
              paramMap: convertToParamMap({
                tabId: 'guidance',
                workflow: 'setup-project-prompt',
              }),
            },
          },
        },
        {
          provide: TabManagerService,
          useValue: {
            tabs: signal([]),
            activeWorkspacePath$: signal('/ws'),
            getWorkspaceTabs: () => [
              { id: 'guidance', workflow: 'setup-project-prompt' },
            ],
          },
        },
        {
          provide: GenerationWorkflowLauncherService,
          useValue: { consumeOrigin },
        },
        {
          provide: GenerationWorkflowStore,
          useValue: {
            bind: jest.fn(),
            unbind: jest.fn(),
            run: guidanceRun,
            acceptedRun: signal(null),
          },
        },
        { provide: AgentGenerationStore, useValue: { discover: jest.fn() } },
        {
          provide: GenerationHandoffStore,
          useValue: { pending: signal(null) },
        },
        {
          provide: GuidanceGenerationStore,
          useValue: {
            bind: bindGuidance,
            unbind: jest.fn(),
            refresh: refreshGuidance,
            adopt: adoptGuidance,
          },
        },
      ],
    });
    TestBed.overrideComponent(GenerationWorkflowShellComponent, {
      set: { template: '<p>guidance</p>', imports: [] },
    });
    const fixture = TestBed.createComponent(GenerationWorkflowShellComponent);
    fixture.detectChanges();
    expect(consumeOrigin).toHaveBeenCalledWith('guidance');
    expect(bindGuidance).toHaveBeenCalledWith({
      tabId: 'guidance',
      workspacePath: '/ws',
      workflow: 'setup-project-prompt',
    });
    const run = {
      binding: {
        tabId: 'guidance',
        workspacePath: '/ws',
        workflow: 'setup-project-prompt' as const,
        runId: 'r1',
      },
      status: 'completed' as const,
      source: {
        kind: 'workspace-discovery' as const,
        reason: 'missing' as const,
      },
      effectiveProvider: 'unknown',
      effectiveModel: 'unknown',
    };
    guidanceRun.set(run);
    fixture.detectChanges();
    expect(adoptGuidance).toHaveBeenCalledTimes(1);
    expect(adoptGuidance).toHaveBeenCalledWith(run, false);
    expect(refreshGuidance).toHaveBeenCalledTimes(1);
    fixture.destroy();
  });
  it('labels not-attempted propagation without implying denied consent', () => {
    const label =
      GenerationWorkflowShellComponent.prototype.propagationConsentLabel;
    expect(label('not-attempted', 'not-granted')).toBe('not attempted');
    expect(label('completed', 'granted')).toBe('granted');
  });
  beforeEach(() =>
    TestBed.configureTestingModule({
      providers: [
        {
          provide: GenerationWorkflowLauncherService,
          useValue: { consumeOrigin: () => null },
        },
      ],
    }),
  );

  it('schedules combined guidance once after a verified terminal result', () => {
    const acceptedRun = signal<{ runId: string; revision: number } | null>(
      null,
    );
    const run = signal(
      null as null | {
        binding: {
          tabId: string;
          workspacePath: string;
          workflow: 'setup-agent-generation';
          runId: string;
        };
        status: 'completed';
        result: {
          counts: { total: number };
          agentOutcomes: never[];
          rejectedSections: number;
          tailoredSections: number;
          propagation: { status: 'completed'; consent: 'granted' };
        };
      },
    );
    const schedule = jest.fn();
    const pending = signal<{
      agentTabId: string;
      guidanceStartDeadline: number;
    } | null>(null);
    const skip = jest.fn();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: new BehaviorSubject(
              convertToParamMap({
                tabId: 'tab',
                workflow: 'setup-agent-generation',
              }),
            ),
            snapshot: {
              paramMap: convertToParamMap({
                tabId: 'tab',
                workflow: 'setup-agent-generation',
              }),
            },
          },
        },
        {
          provide: TabManagerService,
          useValue: {
            tabs: signal([]),
            activeWorkspacePath$: signal('/ws'),
            getWorkspaceTabs: () => [
              { id: 'tab', workflow: 'setup-agent-generation' },
            ],
          },
        },
        {
          provide: GenerationWorkflowStore,
          useValue: {
            bind: jest.fn(),
            unbind: jest.fn(),
            run,
            acceptedRun,
            state: () => 'completed',
            isBound: () => false,
          },
        },
        {
          provide: AgentGenerationStore,
          useValue: { discover: jest.fn(), checkGuidance: jest.fn() },
        },
        {
          provide: GenerationHandoffStore,
          useValue: { pending, schedule, skip, outcome: () => 'idle' },
        },
        {
          provide: GenerationWorkflowLauncherService,
          useValue: { consumeOrigin: () => 'analysis-result-continue' },
        },
      ],
    });
    TestBed.overrideComponent(GenerationWorkflowShellComponent, {
      set: { template: '<p>shell</p>', imports: [] },
    });
    const fixture = TestBed.createComponent(GenerationWorkflowShellComponent);
    fixture.detectChanges();
    const completed = {
      binding: {
        tabId: 'tab',
        workspacePath: '/ws',
        workflow: 'setup-agent-generation' as const,
        runId: 'old',
      },
      status: 'completed' as const,
      result: {
        counts: { total: 1 },
        agentOutcomes: [] as never[],
        rejectedSections: 0,
        tailoredSections: 0,
        propagation: {
          status: 'completed' as const,
          consent: 'granted' as const,
        },
      },
    };
    run.set(completed);
    fixture.detectChanges();
    expect(schedule).not.toHaveBeenCalled();
    acceptedRun.set({ runId: 'run', revision: 1 });
    run.set({
      binding: {
        tabId: 'tab',
        workspacePath: '/ws',
        workflow: 'setup-agent-generation',
        runId: 'run',
      },
      status: 'completed',
      result: {
        counts: { total: 1 },
        agentOutcomes: [],
        rejectedSections: 0,
        tailoredSections: 0,
        propagation: { status: 'completed', consent: 'granted' },
      },
    });
    fixture.detectChanges();
    fixture.detectChanges();
    expect(schedule).toHaveBeenCalledTimes(1);
    pending.set({
      agentTabId: 'tab',
      guidanceStartDeadline: Date.now() + 5_000,
    });
    fixture.detectChanges();
    expect(fixture.componentInstance.remainingSeconds()).toBeLessThanOrEqual(5);
    expect(schedule).toHaveBeenCalledWith('tab', '/ws');
    acceptedRun.set({ runId: 'second', revision: 2 });
    run.set({
      ...completed,
      binding: { ...completed.binding, runId: 'second' },
    });
    fixture.detectChanges();
    expect(schedule).toHaveBeenCalledTimes(1);
    fixture.destroy();
    expect(skip).not.toHaveBeenCalled();
  });
  it('rejects a tab with a mismatched workflow before embedding chat', () => {
    navigateToSurface.mockClear();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: AgentGenerationStore,
          useValue: {
            discover: jest.fn(),
            checkGuidance: jest.fn(),
            guidanceStatus: () => 'unknown',
            checkpoint: () => null,
            resumable: () => null,
            loading: () => false,
            error: () => false,
          },
        },
        {
          provide: GenerationHandoffStore,
          useValue: { pending: () => null, outcome: () => 'idle' },
        },
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: new BehaviorSubject(
              convertToParamMap({
                tabId: 'tab',
                workflow: 'setup-agent-generation',
              }),
            ),
            snapshot: {
              paramMap: {
                get: (key: string) =>
                  key === 'tabId' ? 'tab' : 'setup-agent-generation',
              },
            },
          },
        },
        {
          provide: TabManagerService,
          useValue: {
            tabs: signal([]),
            activeWorkspacePath$: signal('/ws'),
            getWorkspaceTabs: () => [
              { id: 'tab', workflow: 'setup-project-prompt' },
            ],
          },
        },
        {
          provide: GenerationWorkflowStore,
          useValue: {
            bind: jest.fn(),
            unbind: jest.fn(),
            state: () => 'idle',
            isBound: () => false,
            binding: () => null,
            run: () => null,
            acceptedRun: () => null,
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(GenerationWorkflowShellComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('unavailable');
    expect(
      fixture.nativeElement.querySelector('ptah-session-embed'),
    ).toBeNull();
    const back = [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll('button'),
    ].find((button) => button.textContent?.includes('Back to chat'));
    expect(back).toBeDefined();
    back?.click();
    expect(navigateToSurface).toHaveBeenCalledWith('chat');
  });

  it('binds only the current workspace and wires quiet Stop and guarded Send', () => {
    const tabs = signal([{ id: 'tab', workflow: 'setup-agent-generation' }]);
    const workspace = signal('/ws');
    const bind = jest.fn();
    const unbind = jest.fn();
    const stop = jest.fn();
    let bound = true;
    TestBed.configureTestingModule({
      providers: [
        {
          provide: AgentGenerationStore,
          useValue: {
            discover: jest.fn(),
            checkGuidance: jest.fn(),
            guidanceStatus: () => 'unknown',
            checkpoint: () => null,
            resumable: () => null,
            loading: () => false,
            error: () => false,
          },
        },
        {
          provide: GenerationHandoffStore,
          useValue: { pending: () => null, outcome: () => 'idle' },
        },
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: new BehaviorSubject(
              convertToParamMap({
                tabId: 'tab',
                workflow: 'setup-agent-generation',
              }),
            ),
            snapshot: {
              paramMap: {
                get: (key: string) =>
                  key === 'tabId' ? 'tab' : 'setup-agent-generation',
              },
            },
          },
        },
        {
          provide: TabManagerService,
          useValue: {
            tabs,
            activeWorkspacePath$: workspace,
            getWorkspaceTabs: (path: string) => (path === '/ws' ? tabs() : []),
          },
        },
        {
          provide: GenerationWorkflowStore,
          useValue: {
            bind,
            unbind,
            stop,
            state: () => 'quiet',
            isBound: () => bound,
            run: () => null,
            acceptedRun: () => null,
          },
        },
      ],
    });
    TestBed.overrideComponent(GenerationWorkflowShellComponent, {
      set: { template: '<p>shell</p>', imports: [] },
    });
    const fixture = TestBed.createComponent(GenerationWorkflowShellComponent);
    fixture.detectChanges();
    const shell = fixture.componentInstance;
    expect(bind).toHaveBeenCalledWith({
      tabId: 'tab',
      workspacePath: '/ws',
      workflow: 'setup-agent-generation',
    });
    expect(shell.startGuard()).toContain('Finish or stop generation');
    expect(shell.stopHandler('tab')).toBe('handled');
    expect(stop).toHaveBeenCalledTimes(1);
    expect(shell.stopHandler('other')).toBe('not-handled');
    bound = false;
    expect(shell.startGuard()).toBeNull();
    expect(shell.stopHandler('tab')).toBe('not-handled');
    workspace.set('/other');
    fixture.detectChanges();
    expect(unbind).toHaveBeenCalled();
    expect(shell.binding()).toBeNull();
  });

  it('rebinds one shell instance when route tab and workflow params change', () => {
    const params = new BehaviorSubject(
      convertToParamMap({
        tabId: 'agent-tab',
        workflow: 'setup-agent-generation',
      }),
    );
    const tabs = signal([
      { id: 'agent-tab', workflow: 'setup-agent-generation' },
      { id: 'guidance-tab', workflow: 'setup-project-prompt' },
    ]);
    const bind = jest.fn();
    const unbind = jest.fn();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: AgentGenerationStore,
          useValue: {
            discover: jest.fn(),
            checkGuidance: jest.fn(),
            guidanceStatus: () => 'unknown',
            checkpoint: () => null,
            resumable: () => null,
            loading: () => false,
            error: () => false,
          },
        },
        {
          provide: GenerationHandoffStore,
          useValue: { pending: () => null, outcome: () => 'idle' },
        },
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: params,
            snapshot: { paramMap: params.value },
          },
        },
        {
          provide: TabManagerService,
          useValue: {
            tabs,
            activeWorkspacePath$: signal('/ws'),
            getWorkspaceTabs: () => tabs(),
          },
        },
        {
          provide: GenerationWorkflowStore,
          useValue: {
            bind,
            unbind,
            state: () => 'idle',
            isBound: () => false,
            run: () => null,
            acceptedRun: () => null,
          },
        },
      ],
    });
    TestBed.overrideComponent(GenerationWorkflowShellComponent, {
      set: { template: '<p>shell</p>', imports: [] },
    });
    const fixture = TestBed.createComponent(GenerationWorkflowShellComponent);
    fixture.detectChanges();
    expect(fixture.componentInstance.binding()?.tabId).toBe('agent-tab');
    params.next(
      convertToParamMap({
        tabId: 'guidance-tab',
        workflow: 'setup-project-prompt',
      }),
    );
    fixture.detectChanges();
    expect(fixture.componentInstance.binding()).toEqual({
      tabId: 'guidance-tab',
      workspacePath: '/ws',
      workflow: 'setup-project-prompt',
    });
    expect(bind).toHaveBeenLastCalledWith({
      tabId: 'guidance-tab',
      workspacePath: '/ws',
      workflow: 'setup-project-prompt',
    });
    expect(unbind).not.toHaveBeenCalled();
  });
});
