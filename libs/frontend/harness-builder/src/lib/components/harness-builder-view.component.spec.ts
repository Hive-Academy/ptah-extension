/**
 * HarnessBuilderViewComponent — surface question routing regression (TASK_2026_263).
 *
 * The view's `surfaceQuestions` computed filters the shared
 * `PermissionHandlerService.questionRequests()` pool down to the questions that
 * belong to THIS surface. It previously used `hasSurfaceTargets`, which reads
 * the PERMISSION target map (`_promptTargetTabs`). Question targets live in a
 * DIFFERENT map (`_questionTargetTabs`), so the permission predicate always
 * answered `false` for a question id and the question card never rendered — the
 * agent then blocked on `awaitQuestionResponse` (which runs with `timeoutAt: 0`,
 * i.e. no timeout) until the backend's idle auto-pick fired.
 *
 * These specs drive the REAL `PermissionHandlerService` (only its two
 * collaborators are stubbed) and render the REAL component template, so they pin
 * the wiring end to end:
 *   1. surface-targeted question  -> included + `ptah-question-card` in the DOM
 *   2. live-tab-targeted question -> excluded (belongs to a chat tab)
 *   3. targets attached on the PERMISSION map only -> excluded (cross-wire guard)
 */

import { Component, EventEmitter, Input, Output, signal } from '@angular/core';

// `@ptah-extension/chat` transitively pulls in `ngx-markdown` -> `marked`, which
// ships ESM-only and dies in Jest's CJS loader. Same stub pattern as
// libs/frontend/chat/src/lib/components/organisms/message-bubble.component.spec.ts.
// Nothing returned here is ever compiled by Angular — these symbols only sit in
// the decorator metadata of chat components this spec never renders.
jest.mock('ngx-markdown', () => {
  class MarkdownModule {}
  class MarkdownComponent {}
  class MarkdownService {}

  return {
    MarkdownModule,
    MarkdownComponent,
    MarkdownService,
    provideMarkdown: () => [],
    MARKED_OPTIONS: 'MARKED_OPTIONS',
    CLIPBOARD_OPTIONS: 'CLIPBOARD_OPTIONS',
    MARKED_EXTENSIONS: 'MARKED_EXTENSIONS',
    MERMAID_OPTIONS: 'MERMAID_OPTIONS',
    SANITIZE: 'SANITIZE',
  };
});

import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule } from 'lucide-angular';
import {
  TabManagerService,
  type SurfaceSessionStats,
} from '@ptah-extension/chat-state';
import {
  ExecutionTreeBuilderService,
  PermissionHandlerService,
} from '@ptah-extension/chat-streaming';
import {
  createEmptyStreamingState,
  type StreamingState,
} from '@ptah-extension/chat-types';
import {
  AppStateManager,
  VSCodeService,
  WebviewNavigationService,
} from '@ptah-extension/core';
import type {
  AskUserQuestionRequest,
  HarnessConfig,
  PermissionRequest,
} from '@ptah-extension/shared';
import { HarnessBuilderStateService } from '../services/harness-builder-state.service';
import { HarnessRpcService } from '../services/harness-rpc.service';
import { HarnessWorkflowService } from '../services/harness-workflow.service';
import { HarnessBuilderViewComponent } from './harness-builder-view.component';

// ---------------------------------------------------------------------------
// Lightweight stand-ins for the child components. The real cards come from
// `@ptah-extension/chat` and drag in the whole chat DI graph; the selectors,
// inputs and outputs below are the only part of their contract this view uses.
// `errorOnUnknownElements` / `errorOnUnknownProperties` are enabled in
// test-setup.ts, so drift in a selector or input name fails the spec loudly.
//
// The legacy `@Input()` / `@Output()` decorators below are deliberate, not an
// oversight. Rewriting them to `input()` / `output()` was verified (repeatedly)
// to make the `jest.mock('ngx-markdown')` above stop taking effect, after which
// the real ESM module loads and Jest dies parsing `marked`. Hence the
// `prefer-signals` suppressions — these are throwaway test doubles, not app code.
// ---------------------------------------------------------------------------

@Component({
  selector: 'ptah-execution-node',
  standalone: true,
  template: '',
})
class StubExecutionNodeComponent {
  // eslint-disable-next-line @angular-eslint/prefer-signals
  @Input() public node: unknown;
  // eslint-disable-next-line @angular-eslint/prefer-signals
  @Input() public isStreaming = false;
}

@Component({
  selector: 'ptah-permission-request-card',
  standalone: true,
  template: '',
})
class StubPermissionRequestCardComponent {
  // eslint-disable-next-line @angular-eslint/prefer-signals
  @Input() public request!: PermissionRequest;
  @Output() public responded = new EventEmitter<unknown>();
}

@Component({
  selector: 'ptah-question-card',
  standalone: true,
  template: '',
})
class StubQuestionCardComponent {
  // eslint-disable-next-line @angular-eslint/prefer-signals
  @Input() public request!: AskUserQuestionRequest;
  @Output() public answered = new EventEmitter<unknown>();
}

@Component({
  selector: 'ptah-harness-config-preview',
  standalone: true,
  template: '',
})
class StubHarnessConfigPreviewComponent {}

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

/** `surfaceQuestions` is `protected`; read it through a narrow typed view. */
interface SurfaceQuestionsProbe {
  surfaceQuestions: () => readonly AskUserQuestionRequest[];
}

function makeQuestionRequest(
  overrides: Partial<AskUserQuestionRequest> = {},
): AskUserQuestionRequest {
  return {
    id: 'q-1',
    toolUseId: 'tool-1',
    sessionId: 'sess-1',
    timestamp: Date.now(),
    // `timeoutAt: 0` mirrors the backend's no-timeout question contract and
    // keeps the service's expiry effect from reaping the request mid-render.
    timeoutAt: 0,
    question: 'Which stack?',
    options: [],
    ...overrides,
  } as AskUserQuestionRequest;
}

function makeStateStub(): Record<string, unknown> {
  return {
    isLoading: signal(false),
    error: signal<string | null>(null),
    hasInitialized: signal(false),
    config: signal<Partial<HarnessConfig>>({}),
    configSummary: signal('No configuration yet'),
    isConfigComplete: signal(false),
    workspaceContext: signal<{ projectName: string } | null>(null),
    workspaceSwitchedDuringBuild: signal(false),
    pinnedWorkspaceRoot: signal<string | null>(null),
    streamingState: signal<StreamingState>(createEmptyStreamingState()),
    initialize: jest.fn(),
    reset: jest.fn(),
  };
}

function makeWorkflowStub(): Record<string, unknown> {
  return {
    userBubbles: signal<{ text: string }[]>([]),
    viewMode: signal('configure-harness'),
    isActive: signal(false),
    isProcessing: signal(false),
    resumedFromReload: signal(false),
    error: signal<string | null>(null),
    sessionStats: signal<SurfaceSessionStats | null>(null),
    setViewMode: jest.fn(),
    setUserBubbles: jest.fn(),
    addUserBubble: jest.fn(),
    startWorkflow: jest.fn().mockResolvedValue(undefined),
    sendMessage: jest.fn().mockResolvedValue(undefined),
    abort: jest.fn().mockResolvedValue(undefined),
    abortAndDispose: jest.fn().mockResolvedValue(undefined),
    dispose: jest.fn(),
    setError: jest.fn(),
    clearError: jest.fn(),
  };
}

describe('HarnessBuilderViewComponent — surface question routing (TASK_2026_263)', () => {
  let fixture: ComponentFixture<HarnessBuilderViewComponent>;
  let permissions: PermissionHandlerService;

  beforeEach(async () => {
    const tabManagerStub = {
      activeTabId: signal<string | null>('tab-live'),
      activeTabMessages: signal<unknown[]>([]),
      activeTabStreamingState: signal<StreamingState | null>(null),
      tabs: signal<{ id: string }[]>([{ id: 'tab-live' }]),
    } as unknown as TabManagerService;

    TestBed.configureTestingModule({
      imports: [HarnessBuilderViewComponent],
      providers: [
        PermissionHandlerService,
        { provide: TabManagerService, useValue: tabManagerStub },
        {
          provide: VSCodeService,
          useValue: { postMessage: jest.fn() } as unknown as VSCodeService,
        },
        { provide: HarnessBuilderStateService, useValue: makeStateStub() },
        { provide: HarnessWorkflowService, useValue: makeWorkflowStub() },
        {
          provide: HarnessRpcService,
          useValue: {
            initialize: jest.fn().mockResolvedValue({}),
            workflowPrompt: jest.fn().mockResolvedValue({ prompt: '' }),
            apply: jest.fn().mockResolvedValue({}),
          },
        },
        {
          provide: WebviewNavigationService,
          useValue: { navigateToView: jest.fn() },
        },
        {
          provide: AppStateManager,
          useValue: { consumeHarnessWorkflowRequest: jest.fn(() => null) },
        },
        {
          provide: ExecutionTreeBuilderService,
          useValue: { buildTree: jest.fn(() => []) },
        },
      ],
    });

    TestBed.overrideComponent(HarnessBuilderViewComponent, {
      set: {
        imports: [
          LucideAngularModule,
          FormsModule,
          StubExecutionNodeComponent,
          StubPermissionRequestCardComponent,
          StubQuestionCardComponent,
          StubHarnessConfigPreviewComponent,
        ],
      },
    });

    permissions = TestBed.inject(PermissionHandlerService);
    fixture = TestBed.createComponent(HarnessBuilderViewComponent);

    // ngOnInit kicks off the async `harness:initialize` RPC. The transcript —
    // and therefore the surface-question block — only renders in the
    // non-initializing branch, so let that promise settle first.
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  function probe(): SurfaceQuestionsProbe {
    return fixture.componentInstance as unknown as SurfaceQuestionsProbe;
  }

  function questionCards(): StubQuestionCardComponent[] {
    return fixture.debugElement
      .queryAll(By.directive(StubQuestionCardComponent))
      .map((de) => de.componentInstance as StubQuestionCardComponent);
  }

  it('renders the transcript (not the initializing spinner) once init resolves', () => {
    expect(
      fixture.nativeElement.querySelector(
        '[aria-label="Conversation transcript"]',
      ),
    ).not.toBeNull();
  });

  it('includes a question targeted at a SURFACE id and renders its card', () => {
    const question = makeQuestionRequest({ id: 'q-surface' });
    permissions.handleQuestionRequest(question);
    permissions.attachQuestionTargets('q-surface', ['surface-harness-1']);
    fixture.detectChanges();

    expect(probe().surfaceQuestions()).toEqual([question]);

    const cards = questionCards();
    expect(cards).toHaveLength(1);
    expect(cards[0].request).toBe(question);
  });

  it('excludes a question targeted at a LIVE TAB id (belongs to the chat view)', () => {
    permissions.handleQuestionRequest(makeQuestionRequest({ id: 'q-tab' }));
    permissions.attachQuestionTargets('q-tab', ['tab-live']);
    fixture.detectChanges();

    expect(probe().surfaceQuestions()).toEqual([]);
    expect(questionCards()).toHaveLength(0);
  });

  it('excludes a question whose targets were attached on the PERMISSION map only', () => {
    // The cross-wire guard, and the exact shape of the original bug: the two
    // target maps are distinct, so a surface predicate that reads the wrong one
    // can never agree with the map that actually owns the id.
    permissions.handleQuestionRequest(
      makeQuestionRequest({ id: 'q-crosswired' }),
    );
    permissions.attachPromptTargets('q-crosswired', ['surface-harness-1']);
    fixture.detectChanges();

    expect(permissions.hasSurfaceTargets('q-crosswired')).toBe(true);
    expect(permissions.hasSurfaceQuestionTargets('q-crosswired')).toBe(false);
    expect(probe().surfaceQuestions()).toEqual([]);
    expect(questionCards()).toHaveLength(0);
  });

  it('excludes a question with no attached targets at all', () => {
    permissions.handleQuestionRequest(makeQuestionRequest({ id: 'q-orphan' }));
    fixture.detectChanges();

    expect(probe().surfaceQuestions()).toEqual([]);
    expect(questionCards()).toHaveLength(0);
  });

  it('keeps surface questions separate from tab questions in a mixed pool', () => {
    const surfaceQuestion = makeQuestionRequest({ id: 'q-mine' });
    permissions.handleQuestionRequest(surfaceQuestion);
    permissions.attachQuestionTargets('q-mine', ['surface-harness-1']);

    permissions.handleQuestionRequest(makeQuestionRequest({ id: 'q-theirs' }));
    permissions.attachQuestionTargets('q-theirs', ['tab-live']);

    permissions.handleQuestionRequest(makeQuestionRequest({ id: 'q-mixed' }));
    permissions.attachQuestionTargets('q-mixed', [
      'surface-harness-1',
      'tab-live',
    ]);

    fixture.detectChanges();

    expect(probe().surfaceQuestions()).toEqual([surfaceQuestion]);
    expect(questionCards().map((c) => c.request.id)).toEqual(['q-mine']);
  });

  it('drops the card once the surface question is answered', () => {
    permissions.handleQuestionRequest(makeQuestionRequest({ id: 'q-answer' }));
    permissions.attachQuestionTargets('q-answer', ['surface-harness-1']);
    fixture.detectChanges();
    expect(questionCards()).toHaveLength(1);

    questionCards()[0].answered.emit({ id: 'q-answer', answers: {} });
    fixture.detectChanges();

    expect(probe().surfaceQuestions()).toEqual([]);
    expect(questionCards()).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Stop / Start over / error alert
  // -------------------------------------------------------------------------

  /** Signal-backed handles on the workflow stub, for driving view state. */
  interface WorkflowStubHandle {
    isActive: ReturnType<typeof signal<boolean>>;
    isProcessing: ReturnType<typeof signal<boolean>>;
    error: ReturnType<typeof signal<string | null>>;
    abort: jest.Mock;
    abortAndDispose: jest.Mock;
    dispose: jest.Mock;
    clearError: jest.Mock;
  }

  function workflowStub(): WorkflowStubHandle {
    return TestBed.inject(
      HarnessWorkflowService,
    ) as unknown as WorkflowStubHandle;
  }

  function click(testId: string): void {
    const el = fixture.nativeElement.querySelector(
      `[data-testid="${testId}"]`,
    ) as HTMLElement | null;
    if (!el) throw new Error(`No element with data-testid="${testId}"`);
    el.click();
    fixture.detectChanges();
  }

  it('hides the Stop button while nothing is running', () => {
    expect(
      fixture.nativeElement.querySelector('[data-testid="workflow-stop"]'),
    ).toBeNull();
  });

  it('Stop aborts the backend session and keeps the workflow', async () => {
    const workflow = workflowStub();
    workflow.isProcessing.set(true);
    fixture.detectChanges();

    click('workflow-stop');
    await fixture.whenStable();

    expect(workflow.abort).toHaveBeenCalledTimes(1);
    // Stopping is not discarding — the transcript and the claim must survive.
    expect(workflow.dispose).not.toHaveBeenCalled();
    expect(workflow.abortAndDispose).not.toHaveBeenCalled();
  });

  it('Start over aborts the run before tearing the workflow down', async () => {
    const workflow = workflowStub();
    workflow.isActive.set(true);
    workflow.isProcessing.set(true);
    fixture.detectChanges();

    click('workflow-start-over');
    click('workflow-start-over-confirm');
    await fixture.whenStable();

    // `dispose()` alone left the agent running with no surface listening.
    expect(workflow.abortAndDispose).toHaveBeenCalledTimes(1);
  });

  it('renders the workflow error alert and dismisses it', () => {
    const workflow = workflowStub();
    expect(
      fixture.nativeElement.querySelector('[data-testid="workflow-error"]'),
    ).toBeNull();

    workflow.error.set('chat:start failed: no provider configured');
    fixture.detectChanges();

    const alert = fixture.nativeElement.querySelector(
      '[data-testid="workflow-error"]',
    ) as HTMLElement;
    expect(alert).not.toBeNull();
    expect(alert.textContent).toContain('no provider configured');

    click('workflow-error-dismiss');
    expect(workflow.clearError).toHaveBeenCalledTimes(1);
  });
});
