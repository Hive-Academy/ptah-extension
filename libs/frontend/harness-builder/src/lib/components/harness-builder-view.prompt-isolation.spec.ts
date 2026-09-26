/**
 * HarnessBuilderViewComponent — prompt isolation spec (TASK_2026_494 Batch 18).
 *
 * Verifies that permission requests and user questions rendered by the harness
 * view are strictly isolated to the harness surface's own `surfaceId`:
 *   1. A prompt targeted at another surface id does not render in the harness view
 *   2. A prompt targeted at the harness's own surface id does render
 *   3. A null surface id shows no prompts
 */

import {
  Component,
  EventEmitter,
  Input,
  Output,
  signal,
  ChangeDetectionStrategy,
  type WritableSignal,
} from '@angular/core';

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
  type SurfaceId,
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
  ModelStateService,
  VSCodeService,
} from '@ptah-extension/core';
import { SessionStatsSummaryComponent } from '@ptah-extension/chat-ui';
import type {
  AskUserQuestionRequest,
  HarnessConfig,
  PermissionRequest,
} from '@ptah-extension/shared';
import { HarnessBuilderStateService } from '../services/harness-builder-state.service';
import { HarnessRpcService } from '../services/harness-rpc.service';
import { HarnessWorkflowService } from '../services/harness-workflow.service';
import { HarnessBuilderViewComponent } from './harness-builder-view.component';

@Component({
  selector: 'ptah-execution-node',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.Eager,
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
  changeDetection: ChangeDetectionStrategy.Eager,
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
  changeDetection: ChangeDetectionStrategy.Eager,
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
  changeDetection: ChangeDetectionStrategy.Eager,
  template: '',
})
class StubHarnessConfigPreviewComponent {}

interface SurfacePromptsProbe {
  surfacePermissions: () => readonly PermissionRequest[];
  surfaceQuestions: () => readonly AskUserQuestionRequest[];
}

function makePermissionRequest(
  overrides: Partial<PermissionRequest> = {},
): PermissionRequest {
  return {
    id: 'perm-1',
    toolName: 'Bash',
    toolUseId: 'tool-1',
    sessionId: 'sess-1',
    timestamp: Date.now(),
    ...overrides,
  } as PermissionRequest;
}

function makeQuestionRequest(
  overrides: Partial<AskUserQuestionRequest> = {},
): AskUserQuestionRequest {
  return {
    id: 'q-1',
    toolUseId: 'tool-1',
    sessionId: 'sess-1',
    timestamp: Date.now(),
    timeoutAt: 0,
    question: 'Select an option',
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

function makeWorkflowStub(surfaceIdSignal: WritableSignal<SurfaceId | null>): Record<string, unknown> {
  return {
    surfaceId: surfaceIdSignal.asReadonly(),
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

describe('HarnessBuilderViewComponent — prompt isolation (TASK_2026_494 Batch 18)', () => {
  const HARNESS_SURFACE_ID = 'surface-harness-1' as SurfaceId;
  const OTHER_SURFACE_ID = 'surface-apps-2' as SurfaceId;

  let fixture: ComponentFixture<HarnessBuilderViewComponent>;
  let permissions: PermissionHandlerService;
  let surfaceIdSignal: WritableSignal<SurfaceId | null>;

  beforeEach(async () => {
    surfaceIdSignal = signal<SurfaceId | null>(HARNESS_SURFACE_ID);

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
        {
          provide: HarnessWorkflowService,
          useValue: makeWorkflowStub(surfaceIdSignal),
        },
        {
          provide: HarnessRpcService,
          useValue: {
            initialize: jest.fn().mockResolvedValue({}),
            workflowPrompt: jest.fn().mockResolvedValue({ prompt: '' }),
            apply: jest.fn().mockResolvedValue({}),
          },
        },
        {
          provide: AppStateManager,
          useValue: {
            consumeHarnessWorkflowRequest: jest.fn(() => null),
            setCurrentView: jest.fn(),
          },
        },
        {
          provide: ExecutionTreeBuilderService,
          useValue: { buildTree: jest.fn(() => []) },
        },
        {
          provide: ModelStateService,
          useValue: { availableModels: signal([]) },
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
          SessionStatsSummaryComponent,
        ],
      },
    });

    permissions = TestBed.inject(PermissionHandlerService);
    fixture = TestBed.createComponent(HarnessBuilderViewComponent);

    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  function probe(): SurfacePromptsProbe {
    return fixture.componentInstance as unknown as SurfacePromptsProbe;
  }

  function permissionCards(): StubPermissionRequestCardComponent[] {
    return fixture.debugElement
      .queryAll(By.directive(StubPermissionRequestCardComponent))
      .map((de) => de.componentInstance as StubPermissionRequestCardComponent);
  }

  function questionCards(): StubQuestionCardComponent[] {
    return fixture.debugElement
      .queryAll(By.directive(StubQuestionCardComponent))
      .map((de) => de.componentInstance as StubQuestionCardComponent);
  }

  describe('permission prompts', () => {
    it('does not render a permission prompt targeted at another surface id', () => {
      const permOther = makePermissionRequest({ id: 'perm-other' });
      permissions.handlePermissionRequest(permOther);
      permissions.attachPromptTargets('perm-other', [OTHER_SURFACE_ID]);
      fixture.detectChanges();

      expect(probe().surfacePermissions()).toEqual([]);
      expect(permissionCards()).toHaveLength(0);
    });

    it('renders a permission prompt targeted at the harness own surface id', () => {
      const permOwn = makePermissionRequest({ id: 'perm-own' });
      permissions.handlePermissionRequest(permOwn);
      permissions.attachPromptTargets('perm-own', [HARNESS_SURFACE_ID]);
      fixture.detectChanges();

      expect(probe().surfacePermissions()).toEqual([permOwn]);
      const cards = permissionCards();
      expect(cards).toHaveLength(1);
      expect(cards[0].request).toBe(permOwn);
    });

    it('shows no permission prompts when surfaceId is null', () => {
      surfaceIdSignal.set(null);
      const perm = makePermissionRequest({ id: 'perm-null-check' });
      permissions.handlePermissionRequest(perm);
      permissions.attachPromptTargets('perm-null-check', [HARNESS_SURFACE_ID]);
      fixture.detectChanges();

      expect(probe().surfacePermissions()).toEqual([]);
      expect(permissionCards()).toHaveLength(0);
    });

    it('does not render a permission prompt targeted at both the harness surface id and a live tab id', () => {
      const permMixed = makePermissionRequest({ id: 'perm-harness-and-tab' });
      permissions.handlePermissionRequest(permMixed);
      permissions.attachPromptTargets('perm-harness-and-tab', [
        HARNESS_SURFACE_ID,
        'tab-live',
      ]);
      fixture.detectChanges();

      expect(probe().surfacePermissions()).toEqual([]);
      expect(permissionCards()).toHaveLength(0);
    });
  });

  describe('question prompts', () => {
    it('does not render a question prompt targeted at another surface id', () => {
      const questionOther = makeQuestionRequest({ id: 'q-other' });
      permissions.handleQuestionRequest(questionOther);
      permissions.attachQuestionTargets('q-other', [OTHER_SURFACE_ID]);
      fixture.detectChanges();

      expect(probe().surfaceQuestions()).toEqual([]);
      expect(questionCards()).toHaveLength(0);
    });

    it('renders a question prompt targeted at the harness own surface id', () => {
      const questionOwn = makeQuestionRequest({ id: 'q-own' });
      permissions.handleQuestionRequest(questionOwn);
      permissions.attachQuestionTargets('q-own', [HARNESS_SURFACE_ID]);
      fixture.detectChanges();

      expect(probe().surfaceQuestions()).toEqual([questionOwn]);
      const cards = questionCards();
      expect(cards).toHaveLength(1);
      expect(cards[0].request).toBe(questionOwn);
    });

    it('shows no question prompts when surfaceId is null', () => {
      surfaceIdSignal.set(null);
      const question = makeQuestionRequest({ id: 'q-null-check' });
      permissions.handleQuestionRequest(question);
      permissions.attachQuestionTargets('q-null-check', [HARNESS_SURFACE_ID]);
      fixture.detectChanges();

      expect(probe().surfaceQuestions()).toEqual([]);
      expect(questionCards()).toHaveLength(0);
    });

    it('does not render a question prompt targeted at both the harness surface id and a live tab id', () => {
      const questionMixed = makeQuestionRequest({ id: 'q-harness-and-tab' });
      permissions.handleQuestionRequest(questionMixed);
      permissions.attachQuestionTargets('q-harness-and-tab', [
        HARNESS_SURFACE_ID,
        'tab-live',
      ]);
      fixture.detectChanges();

      expect(probe().surfaceQuestions()).toEqual([]);
      expect(questionCards()).toHaveLength(0);
    });
  });

  describe('mixed prompt pools and surfaceId transitions', () => {
    it('isolates harness prompts from other surface prompts in a mixed pool', () => {
      const permOwn = makePermissionRequest({ id: 'perm-mixed-own' });
      const permOther = makePermissionRequest({ id: 'perm-mixed-other' });
      permissions.handlePermissionRequest(permOwn);
      permissions.handlePermissionRequest(permOther);
      permissions.attachPromptTargets('perm-mixed-own', [HARNESS_SURFACE_ID]);
      permissions.attachPromptTargets('perm-mixed-other', [OTHER_SURFACE_ID]);

      const qOwn = makeQuestionRequest({ id: 'q-mixed-own' });
      const qOther = makeQuestionRequest({ id: 'q-mixed-other' });
      permissions.handleQuestionRequest(qOwn);
      permissions.handleQuestionRequest(qOther);
      permissions.attachQuestionTargets('q-mixed-own', [HARNESS_SURFACE_ID]);
      permissions.attachQuestionTargets('q-mixed-other', [OTHER_SURFACE_ID]);

      fixture.detectChanges();

      expect(probe().surfacePermissions()).toEqual([permOwn]);
      expect(permissionCards().map((c) => c.request.id)).toEqual(['perm-mixed-own']);

      expect(probe().surfaceQuestions()).toEqual([qOwn]);
      expect(questionCards().map((c) => c.request.id)).toEqual(['q-mixed-own']);
    });

    it('reveals prompts when surfaceId becomes non-null and hides them when reset to null', () => {
      surfaceIdSignal.set(null);
      const perm = makePermissionRequest({ id: 'perm-dyn' });
      const question = makeQuestionRequest({ id: 'q-dyn' });
      permissions.handlePermissionRequest(perm);
      permissions.handleQuestionRequest(question);
      permissions.attachPromptTargets('perm-dyn', [HARNESS_SURFACE_ID]);
      permissions.attachQuestionTargets('q-dyn', [HARNESS_SURFACE_ID]);
      fixture.detectChanges();

      expect(probe().surfacePermissions()).toEqual([]);
      expect(probe().surfaceQuestions()).toEqual([]);
      expect(permissionCards()).toHaveLength(0);
      expect(questionCards()).toHaveLength(0);

      // Transition to active harness surface
      surfaceIdSignal.set(HARNESS_SURFACE_ID);
      fixture.detectChanges();

      expect(probe().surfacePermissions()).toEqual([perm]);
      expect(probe().surfaceQuestions()).toEqual([question]);
      expect(permissionCards()).toHaveLength(1);
      expect(questionCards()).toHaveLength(1);

      // Transition back to null (workflow closed/aborted)
      surfaceIdSignal.set(null);
      fixture.detectChanges();

      expect(probe().surfacePermissions()).toEqual([]);
      expect(probe().surfaceQuestions()).toEqual([]);
      expect(permissionCards()).toHaveLength(0);
      expect(questionCards()).toHaveLength(0);
    });
  });

  describe('delayed routing-target attachment (reactivity regression)', () => {
    it('recomputes and renders a permission prompt when targets are attached after initial render', () => {
      const perm = makePermissionRequest({ id: 'perm-delayed' });
      permissions.handlePermissionRequest(perm);

      // Render once before routing targets are resolved
      fixture.detectChanges();
      expect(probe().surfacePermissions()).toEqual([]);
      expect(permissionCards()).toHaveLength(0);

      // StreamRouter resolves target later and attaches targets (which bumps routingTargetRevision)
      permissions.attachPromptTargets('perm-delayed', [HARNESS_SURFACE_ID]);
      fixture.detectChanges();

      expect(probe().surfacePermissions()).toEqual([perm]);
      expect(permissionCards()).toHaveLength(1);
      expect(permissionCards()[0].request).toBe(perm);
    });

    it('recomputes and renders a question prompt when targets are attached after initial render', () => {
      const question = makeQuestionRequest({ id: 'q-delayed' });
      permissions.handleQuestionRequest(question);

      // Render once before routing targets are resolved
      fixture.detectChanges();
      expect(probe().surfaceQuestions()).toEqual([]);
      expect(questionCards()).toHaveLength(0);

      // StreamRouter resolves target later and attaches targets (which bumps routingTargetRevision)
      permissions.attachQuestionTargets('q-delayed', [HARNESS_SURFACE_ID]);
      fixture.detectChanges();

      expect(probe().surfaceQuestions()).toEqual([question]);
      expect(questionCards()).toHaveLength(1);
      expect(questionCards()[0].request).toBe(question);
    });
  });
});
