import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TabManagerService } from '@ptah-extension/chat-state';
import type { SetupGenerationRunState } from '@ptah-extension/shared';
import { GenerationWorkflowStore } from '../services/generation-workflow.store';
import { GuidanceGenerationStore } from '../services/guidance-generation.store';
import { WizardRpcService } from '../services/wizard-rpc.service';
import { GenerationGuidancePageComponent } from './generation-guidance-page.component';

describe('GenerationGuidancePageComponent', () => {
  it('shows one primary action for empty, saved, and active states', () => {
    const saved = signal<{
      generatedAt: string | null;
      enabled: boolean;
      cacheValid: boolean;
    } | null>(null);
    const active = signal(false);
    TestBed.configureTestingModule({
      imports: [GenerationGuidancePageComponent],
      providers: [
        {
          provide: GenerationWorkflowStore,
          useValue: {
            state: () => (active() ? 'running' : 'idle'),
            isBound: active,
            rejection: () => null,
            chatTurnRejection: () => null,
            startGuidance: jest.fn(),
            regenerateGuidance: jest.fn(),
          },
        },
        {
          provide: GuidanceGenerationStore,
          useValue: {
            status: () => 'idle',
            source: () => null,
            snapshot: () => null,
            result: saved,
            run: () => null,
            content: () => null,
            actionFailed: () => false,
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(GenerationGuidancePageComponent);
    const primaryLabels = () => {
      fixture.detectChanges();
      return [
        ...(fixture.nativeElement as HTMLElement).querySelectorAll(
          '.btn-primary',
        ),
      ].map((button) => button.textContent?.trim());
    };
    expect(primaryLabels()).toEqual(['Generate guidance']);
    saved.set({ generatedAt: null, enabled: true, cacheValid: true });
    expect(primaryLabels()).toEqual(['Regenerate guidance']);
    active.set(true);
    expect(primaryLabels()).toEqual(['Regenerate guidance']);
  });
  it.each([
    [
      { reason: 'blocked', ownerTabId: 'private-tab' },
      null,
      null,
      'This run is active in another tab.',
    ],
    [{ reason: 'workspace-mismatch' }, null, null, 'Switch to this workspace'],
    [null, 'private host text', null, 'Finish this chat reply first.'],
  ])(
    'shows safe guidance feedback for %p',
    (rejection, busy, error, expected) => {
      const refreshWorkflow = jest.fn();
      const refreshGuidance = jest.fn();
      TestBed.configureTestingModule({
        imports: [GenerationGuidancePageComponent],
        providers: [
          {
            provide: GenerationWorkflowStore,
            useValue: {
              state: () => 'idle',
              isBound: () => false,
              rejection: () => rejection,
              chatTurnRejection: () => busy,
              startError: () => error,
              startGuidance: jest.fn(),
              regenerateGuidance: jest.fn(),
              refresh: refreshWorkflow,
            },
          },
          {
            provide: GuidanceGenerationStore,
            useValue: {
              status: () => 'unknown',
              source: () => null,
              snapshot: () => null,
              result: () => null,
              run: () => null,
              content: () => null,
              actionFailed: () => false,
              refresh: refreshGuidance,
            },
          },
        ],
      });
      const fixture = TestBed.createComponent(GenerationGuidancePageComponent);
      fixture.detectChanges();
      const root = fixture.nativeElement as HTMLElement;
      expect(root.textContent).toContain(expected);
      expect(root.textContent).not.toContain('private');
      [...root.querySelectorAll('button')]
        .find((button) => button.textContent?.includes('Check again'))
        ?.click();
      expect(refreshWorkflow).toHaveBeenCalledTimes(1);
      expect(refreshGuidance).toHaveBeenCalledTimes(1);
    },
  );
  it('shows push-driven run state, exact Stop action and escaped saved content', () => {
    const state = signal<'running' | 'completed'>('running');
    const stop = jest.fn();
    TestBed.configureTestingModule({
      imports: [GenerationGuidancePageComponent],
      providers: [
        {
          provide: GenerationWorkflowStore,
          useValue: {
            state,
            isBound: () => state() === 'running',
            stop,
            startGuidance: jest.fn(),
            regenerateGuidance: jest.fn(),
            refresh: jest.fn(),
            rejection: () => null,
            chatTurnRejection: () => null,
            startError: () => null,
          },
        },
        {
          provide: GuidanceGenerationStore,
          useValue: {
            status: () => 'completed',
            source: () => 'Verified latest analysis',
            snapshot: () => null,
            result: () => null,
            run: () => null,
            content: () => '<script>alert(1)</script>',
            actionFailed: () => false,
            setEnabled: jest.fn(),
            refreshCommitted: jest.fn(),
            loadContent: jest.fn(),
            download: jest.fn(),
            refresh: jest.fn(),
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(GenerationGuidancePageComponent);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('Verified latest analysis');
    expect(root.textContent).toContain('Generating project guidance');
    expect(root.querySelector('script')).toBeNull();
    expect(root.textContent).toContain('<script>alert(1)</script>');
    [...root.querySelectorAll('button')]
      .find((button) => button.textContent?.includes('Stop generation'))
      ?.click();
    expect(stop).toHaveBeenCalledTimes(1);
    state.set('completed');
    fixture.detectChanges();
    expect(root.textContent).toContain('Project guidance saved');
  });

  it('uses generic guidance rejection copy when the host cannot identify a model failure', () => {
    TestBed.configureTestingModule({
      imports: [GenerationGuidancePageComponent],
      providers: [
        {
          provide: GenerationWorkflowStore,
          useValue: {
            state: () => 'idle',
            isBound: () => false,
            rejection: () => ({ reason: 'not-running' }),
            chatTurnRejection: () => null,
            startError: () => 'private model error',
            startGuidance: jest.fn(),
            refresh: jest.fn(),
          },
        },
        {
          provide: GuidanceGenerationStore,
          useValue: {
            status: () => 'idle',
            source: () => null,
            snapshot: () => null,
            result: () => null,
            run: () => null,
            content: () => null,
            actionFailed: () => false,
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(GenerationGuidancePageComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain(
      'Project guidance could not start',
    );
    expect(fixture.nativeElement.textContent).not.toContain('selected model');
    expect(fixture.nativeElement.textContent).not.toContain('private');
  });

  it('follows the latest workflow run through failure, Retry, and a new run after reload', async () => {
    const binding = {
      tabId: 'own',
      workspacePath: '/ws',
      workflow: 'setup-project-prompt' as const,
    };
    const source = {
      kind: 'workspace-discovery' as const,
      reason: 'missing' as const,
    };
    const makeRun = (
      runId: string,
      status: SetupGenerationRunState['status'],
      provider: string,
      model: string,
      committedState?: SetupGenerationRunState['committedState'],
    ): SetupGenerationRunState => ({
      binding: { ...binding, runId },
      status,
      source,
      effectiveProvider: provider,
      effectiveModel: model,
      committedState,
    });
    let current: SetupGenerationRunState | null = null;
    let next = makeRun('first', 'running', 'anthropic', 'old');
    const rpc = {
      getBoundRunState: jest.fn().mockImplementation(async () => current),
      startBoundGuidance: jest.fn().mockImplementation(async () => {
        current = next;
        return {
          accepted: {
            runId: next.binding.runId,
            status: 'starting',
            source,
            effectiveProvider: next.effectiveProvider,
            effectiveModel: next.effectiveModel,
          },
        };
      }),
      getEnhancedPromptsStatus: jest.fn().mockResolvedValue({
        hasGeneratedPrompt: true,
        generatedAt: '2026-10-18',
        enabled: true,
        cacheValid: true,
      }),
    };
    TestBed.configureTestingModule({
      imports: [GenerationGuidancePageComponent],
      providers: [
        GenerationWorkflowStore,
        GuidanceGenerationStore,
        { provide: WizardRpcService, useValue: rpc },
        {
          provide: TabManagerService,
          useValue: {
            findTabByIdAcrossWorkspaces: () => ({
              workspacePath: '/ws',
              tab: {
                status: 'loaded',
                streamingState: null,
                queuedContent: null,
                queuedOptions: null,
              },
            }),
            isTabStreaming: () => false,
          },
        },
      ],
    });
    const workflow = TestBed.inject(GenerationWorkflowStore);
    const guidance = TestBed.inject(GuidanceGenerationStore);
    const fixture = TestBed.createComponent(GenerationGuidancePageComponent);
    workflow.bind(binding);
    guidance.bind(binding);
    await workflow.startGuidance();
    if (workflow.run()) guidance.adopt(workflow.run()!, true);
    current = makeRun('first', 'failed', 'anthropic', 'old');
    await workflow.refresh();
    guidance.adopt(workflow.run()!, true);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'Guidance was not saved',
    );
    next = makeRun('second', 'running', 'openai', 'new');
    await workflow.startGuidance();
    guidance.adopt(workflow.run()!, true);
    current = makeRun('second', 'completed', 'openai', 'new', 'committed');
    await workflow.refresh();
    guidance.adopt(workflow.run()!, true);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'Project guidance saved',
    );
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'openai',
    );
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('new');
    workflow.unbind();
    guidance.unbind();
    current = null;
    workflow.bind(binding);
    guidance.bind(binding);
    next = makeRun('third', 'running', 'anthropic', 'fresh');
    await workflow.startGuidance();
    guidance.adopt(workflow.run()!, true);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'fresh',
    );
    expect(guidance.snapshot()?.runId).toBe('third');
  });
});
