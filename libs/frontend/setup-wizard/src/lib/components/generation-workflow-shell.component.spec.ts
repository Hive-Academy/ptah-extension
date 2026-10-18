import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { signal } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { convertToParamMap } from '@angular/router';
import { TabManagerService } from '@ptah-extension/chat-state';
import { GenerationWorkflowLauncherService } from '@ptah-extension/chat-ui';
import { GenerationWorkflowStore } from '../services/generation-workflow.store';
import { AgentGenerationStore } from '../services/agent-generation.store';
import { GenerationHandoffStore } from '../services/generation-handoff.store';
import { GenerationWorkflowShellComponent } from './generation-workflow-shell.component';

describe('GenerationWorkflowShellComponent', () => {
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
          useValue: { pending: () => null, schedule, outcome: () => 'idle' },
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
    expect(schedule).toHaveBeenCalledWith('tab', '/ws');
  });
  it('rejects a tab with a mismatched workflow before embedding chat', () => {
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
