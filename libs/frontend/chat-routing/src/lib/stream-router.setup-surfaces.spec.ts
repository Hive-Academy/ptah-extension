/**
 * Prompt routing across EVERY Setup Hub workflow (TASK_2026_317).
 *
 * The reported bug was "New Project questions land on an unrelated canvas
 * tile", but the user's read was broader: it happens "with all the workflows in
 * our setup page". So this suite enumerates the four surface shapes the Setup
 * Hub can put on screen and pins what each one must do with a prompt. They are
 * genuinely different shapes, not four copies of one:
 *
 *   | Setup Hub card      | host                    | claim | surface        |
 *   | ------------------- | ----------------------- | ----- | -------------- |
 *   | New Project         | HarnessWorkflowService  | yes   | interactive    |
 *   | AI Team Builder     | HarnessWorkflowService  | yes   | interactive    |
 *   | Workspace Analysis  | SetupWizardStateService | no    | background     |
 *   | Tribunal            | TribunalRunService      | yes   | never adapted  |
 *
 * Tribunal is the trap: it claims its CONDUCTOR TAB's id against a `SurfaceId`
 * it never registers an adapter for — the claim is a marker, and the conductor
 * is a normal chat tab that must keep routing as one. Any "is it claimed?"
 * check that skips the interactive gate hides the conductor's own prompts.
 *
 * The wizard is the other end: its phases run `bypassPermissions` with no
 * `canUseTool`, so they cannot raise a prompt at all — and if one ever appears,
 * auto-answering it is the correct full-auto behaviour, not a regression.
 */

import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import {
  SurfaceId,
  TabId,
  TabManagerService,
  TabSessionBinding,
  type ClaudeSessionId,
  type ClosedTabEvent,
} from '@ptah-extension/chat-state';
import {
  AgentMonitorStore,
  BackgroundAgentStore,
  BatchedUpdateService,
  ExecutionTreeBuilderService,
  PermissionHandlerService,
  StreamingHandlerService,
} from '@ptah-extension/chat-streaming';
import {
  createEmptyStreamingState,
  type StreamingState,
} from '@ptah-extension/chat-types';
import type { PermissionRequest } from '@ptah-extension/shared';
import { StreamRouter } from './stream-router.service';
import { StreamingSurfaceRegistry } from './streaming-surface-registry.service';
import { WorkflowSessionClaimService } from './workflow-session-claim.service';

const REAL_SESSION = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa' as ClaudeSessionId;
const OTHER_SESSION = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb' as ClaudeSessionId;

function makeQuestion(overrides: {
  id: string;
  sessionId?: string;
  tabId?: string;
}) {
  return {
    question: 'pick one',
    options: [
      { value: 'a', label: 'A' },
      { value: 'b', label: 'B' },
    ],
    ...overrides,
  };
}

function makePermission(
  overrides: Partial<PermissionRequest> = {},
): PermissionRequest {
  return {
    id: 'perm-1',
    toolName: 'Bash',
    toolInput: {},
    toolUseId: 'tool-1',
    timestamp: 1,
    description: 'Run a command',
    timeoutAt: 0,
    ...overrides,
  } as PermissionRequest;
}

function makeTabManagerMock() {
  const tabs = signal<{ id: string; claudeSessionId: string | null }[]>([]);
  const closedTab = signal<ClosedTabEvent | null>(null);
  const activeTabId = signal<string | null>(null);
  return {
    tabs: tabs.asReadonly(),
    closedTab: closedTab.asReadonly(),
    activeTabId: activeTabId.asReadonly(),
    _setActiveTabId: (id: string | null) => activeTabId.set(id),
  };
}

function makePermissionHandlerMock() {
  const questionTargets = new Map<string, readonly string[]>();
  const promptTargets = new Map<string, readonly string[]>();
  const questionResponses: { id: string }[] = [];
  const promptResponses: { id: string; decision: string }[] = [];
  return {
    attachPromptTargets: jest.fn((id: string, ids: readonly string[]) => {
      if (ids.length > 0) promptTargets.set(id, [...ids]);
    }),
    targetTabsFor: jest.fn((id: string) => promptTargets.get(id) ?? []),
    cancelPrompt: jest.fn(),
    handlePermissionResponse: jest.fn(
      (r: { id: string; decision: string }) => void promptResponses.push(r),
    ),
    attachQuestionTargets: jest.fn((id: string, ids: readonly string[]) => {
      if (ids.length > 0) questionTargets.set(id, [...ids]);
    }),
    questionTargetTabsFor: jest.fn(
      (id: string) => questionTargets.get(id) ?? [],
    ),
    clearQuestionTargets: jest.fn(
      (id: string) => void questionTargets.delete(id),
    ),
    cancelQuestion: jest.fn(),
    handleQuestionResponse: jest.fn(
      (r: { id: string }) => void questionResponses.push(r),
    ),
    questionRequests: signal<unknown[]>([]).asReadonly(),
    decisionPulse: signal(null).asReadonly(),
    _questionTargets: questionTargets,
    _promptTargets: promptTargets,
    _questionResponses: questionResponses,
    _promptResponses: promptResponses,
  };
}

describe('StreamRouter — prompt routing across every Setup Hub workflow', () => {
  let router: StreamRouter;
  let binding: TabSessionBinding;
  let surfaceRegistry: StreamingSurfaceRegistry;
  let claims: WorkflowSessionClaimService;
  let permissionHandler: ReturnType<typeof makePermissionHandlerMock>;
  let tabManager: ReturnType<typeof makeTabManagerMock>;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    tabManager = makeTabManagerMock();
    permissionHandler = makePermissionHandlerMock();
    warnSpy = jest.spyOn(console, 'warn').mockImplementation();

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: TabManagerService, useValue: tabManager },
        {
          provide: StreamingHandlerService,
          useValue: { cleanupSessionDeduplication: jest.fn() },
        },
        {
          provide: AgentMonitorStore,
          useValue: {
            clearSessionAgents: jest.fn(),
            forceClearSessionAgents: jest.fn(),
          },
        },
        {
          provide: BackgroundAgentStore,
          useValue: { clearSession: jest.fn() },
        },
        {
          provide: BatchedUpdateService,
          useValue: { clearPendingUpdates: jest.fn() },
        },
        {
          provide: ExecutionTreeBuilderService,
          useValue: {
            clearForTab: jest.fn(),
            clearForSession: jest.fn(),
            clearCache: jest.fn(),
          },
        },
        { provide: PermissionHandlerService, useValue: permissionHandler },
      ],
    });

    router = TestBed.inject(StreamRouter);
    binding = TestBed.inject(TabSessionBinding);
    surfaceRegistry = TestBed.inject(StreamingSurfaceRegistry);
    claims = TestBed.inject(WorkflowSessionClaimService);
    TestBed.tick();
  });

  afterEach(() => warnSpy.mockRestore());

  /** Register a surface adapter the way a host would. */
  function registerSurface(interactive: boolean): SurfaceId {
    const surfaceId = SurfaceId.create();
    let state: StreamingState = createEmptyStreamingState();
    surfaceRegistry.register(
      surfaceId,
      () => state,
      (next) => {
        state = next;
      },
      { interactive },
    );
    return surfaceId;
  }

  /**
   * What `HarnessWorkflowService.startWorkflow` does: mint a correlation id
   * that is NOT a tab, claim it against an interactive surface, bind the
   * surface. Shared verbatim by New Project and AI Team Builder — they differ
   * only by the `mode` string and the seed prompt.
   */
  function startHarnessWorkflow(): {
    correlationId: string;
    surfaceId: SurfaceId;
  } {
    const correlationId = TabId.create() as string;
    const surfaceId = registerSurface(true);
    claims.claim(correlationId, surfaceId);
    router.onSurfaceCreated(surfaceId);
    return { correlationId, surfaceId };
  }

  // ── the two interactive workflows ────────────────────────────────────────

  describe.each(['New Project', 'AI Team Builder'] as const)(
    '%s (harness workflow surface)',
    (card) => {
      it('routes a question raised BEFORE the SDK session id exists', () => {
        const { correlationId, surfaceId } = startHarnessWorkflow();

        // Pre-`init`: the backend has nothing but the correlation id, so it
        // stamps it on both fields.
        router.routeQuestionPrompt(
          makeQuestion({
            id: `q-${card}-pre`,
            tabId: correlationId,
            sessionId: correlationId,
          }),
        );

        expect(permissionHandler._questionTargets.get(`q-${card}-pre`)).toEqual(
          [surfaceId],
        );
        expect(permissionHandler.handleQuestionResponse).not.toHaveBeenCalled();
      });

      it('routes a question raised AFTER session:id-resolved', () => {
        const { correlationId, surfaceId } = startHarnessWorkflow();
        // `ChatMessageHandler.handleSessionIdResolved` re-binds the surface.
        router.onSurfaceCreated(surfaceId, REAL_SESSION);

        router.routeQuestionPrompt(
          makeQuestion({
            id: `q-${card}-post`,
            tabId: correlationId,
            sessionId: REAL_SESSION as unknown as string,
          }),
        );

        expect(
          permissionHandler._questionTargets.get(`q-${card}-post`),
        ).toEqual([surfaceId]);
      });

      it('routes a permission prompt the same way', () => {
        const { correlationId, surfaceId } = startHarnessWorkflow();

        router.routePermissionPrompt(
          makePermission({
            id: `p-${card}`,
            tabId: correlationId,
            sessionId: correlationId,
          }),
        );

        expect(permissionHandler._promptTargets.get(`p-${card}`)).toEqual([
          surfaceId,
        ]);
        expect(
          permissionHandler.handlePermissionResponse,
        ).not.toHaveBeenCalled();
      });

      it('survives the reload path — new correlation id, question still carrying the old one', () => {
        // `rehydrate()` mints a FRESH correlation id and binds the surface to
        // the persisted session; the backend's outstanding question still
        // carries the id from before the reload. The session lookup is what
        // has to carry it, which is why the real id on the prompt matters.
        const staleCorrelationId = TabId.create() as string;
        const surfaceId = registerSurface(true);
        claims.claim(TabId.create() as string, surfaceId); // fresh id
        router.onSurfaceCreated(surfaceId, REAL_SESSION);

        router.routeQuestionPrompt(
          makeQuestion({
            id: `q-${card}-reload`,
            tabId: staleCorrelationId,
            sessionId: REAL_SESSION as unknown as string,
          }),
        );

        expect(
          permissionHandler._questionTargets.get(`q-${card}-reload`),
        ).toEqual([surfaceId]);
      });

      it('does not leak onto a chat tab bound to a different session', () => {
        const { correlationId, surfaceId } = startHarnessWorkflow();
        const strangerTab = TabId.create();
        router.onTabCreated(strangerTab, OTHER_SESSION);

        router.routeQuestionPrompt(
          makeQuestion({
            id: `q-${card}-isolation`,
            tabId: correlationId,
            sessionId: correlationId,
          }),
        );

        expect(
          permissionHandler._questionTargets.get(`q-${card}-isolation`),
        ).toEqual([surfaceId]);
        expect(
          permissionHandler._questionTargets.get(`q-${card}-isolation`),
        ).not.toContain(strangerTab as string);
      });
    },
  );

  // ── Workspace Analysis (setup wizard) ────────────────────────────────────

  describe('Workspace Analysis (setup wizard phase surface)', () => {
    /** `SetupWizardStateService.registerPhaseSurface` — no claim, background. */
    function registerPhaseSurface(): SurfaceId {
      const surfaceId = registerSurface(false);
      router.onSurfaceCreated(surfaceId, REAL_SESSION);
      return surfaceId;
    }

    it('keeps auto-answering questions — the phase runs full-auto with no card', () => {
      registerPhaseSurface();

      router.routeQuestionPrompt(
        makeQuestion({
          id: 'q-wizard',
          sessionId: REAL_SESSION as unknown as string,
        }),
      );

      expect(permissionHandler.attachQuestionTargets).not.toHaveBeenCalled();
      expect(permissionHandler.handleQuestionResponse).toHaveBeenCalledWith({
        id: 'q-wizard',
        answers: {},
      });
    });

    it('keeps auto-denying permissions', () => {
      registerPhaseSurface();

      router.routePermissionPrompt(
        makePermission({
          id: 'p-wizard',
          sessionId: REAL_SESSION as unknown as string,
        }),
      );

      expect(permissionHandler.attachPromptTargets).not.toHaveBeenCalled();
      expect(permissionHandler.handlePermissionResponse).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'p-wizard', decision: 'deny' }),
      );
    });

    it('a stray claim on a background surface does not make it a prompt target', () => {
      const surfaceId = registerPhaseSurface();
      const correlationId = TabId.create() as string;
      claims.claim(correlationId, surfaceId);

      router.routeQuestionPrompt(
        makeQuestion({
          id: 'q-wizard-claimed',
          tabId: correlationId,
          sessionId: REAL_SESSION as unknown as string,
        }),
      );

      expect(permissionHandler.attachQuestionTargets).not.toHaveBeenCalled();
      expect(permissionHandler.handleQuestionResponse).toHaveBeenCalledWith({
        id: 'q-wizard-claimed',
        answers: {},
      });
    });
  });

  // ── Tribunal ─────────────────────────────────────────────────────────────

  describe('Tribunal (conductor tab claimed against an unregistered surface)', () => {
    /** `TribunalRunService.prepare` — a REAL tab, claimed, surface never adapted. */
    function prepareTribunal(): { conductorTab: TabId; surfaceId: SurfaceId } {
      const conductorTab = TabId.create();
      const surfaceId = SurfaceId.create(); // deliberately never registered
      claims.claim(conductorTab as string, surfaceId);
      router.onTabCreated(conductorTab, REAL_SESSION);
      return { conductorTab, surfaceId };
    }

    it('routes the conductor’s question to its TAB, not to the claimed surface', () => {
      const { conductorTab } = prepareTribunal();

      const targets = router.routeQuestionPrompt(
        makeQuestion({
          id: 'q-tribunal',
          tabId: conductorTab as string,
          sessionId: REAL_SESSION as unknown as string,
        }),
      );

      expect(targets).toEqual([conductorTab]);
      expect(permissionHandler._questionTargets.get('q-tribunal')).toEqual([
        conductorTab,
      ]);
    });

    it('routes the conductor’s permission prompt to its TAB', () => {
      const { conductorTab } = prepareTribunal();

      const targets = router.routePermissionPrompt(
        makePermission({
          id: 'p-tribunal',
          tabId: conductorTab as string,
          sessionId: REAL_SESSION as unknown as string,
        }),
      );

      expect(targets).toEqual([conductorTab]);
      expect(permissionHandler.handlePermissionResponse).not.toHaveBeenCalled();
    });

    it('is NOT reported as owned by an interactive surface — the chat-view fallback must stay live for it', () => {
      const { conductorTab } = prepareTribunal();

      expect(
        router.interactiveSurfaceOwning({
          tabId: conductorTab as string,
          sessionId: REAL_SESSION as unknown as string,
        }),
      ).toBeNull();
    });
  });

  // ── cross-talk ───────────────────────────────────────────────────────────

  describe('two workflows live at once', () => {
    it('a harness question and a tribunal question each reach their own owner', () => {
      const { correlationId, surfaceId } = startHarnessWorkflow();
      const conductorTab = TabId.create();
      claims.claim(conductorTab as string, SurfaceId.create());
      router.onTabCreated(conductorTab, OTHER_SESSION);

      router.routeQuestionPrompt(
        makeQuestion({
          id: 'q-harness',
          tabId: correlationId,
          sessionId: correlationId,
        }),
      );
      router.routeQuestionPrompt(
        makeQuestion({
          id: 'q-conductor',
          tabId: conductorTab as string,
          sessionId: OTHER_SESSION as unknown as string,
        }),
      );

      expect(permissionHandler._questionTargets.get('q-harness')).toEqual([
        surfaceId,
      ]);
      expect(permissionHandler._questionTargets.get('q-conductor')).toEqual([
        conductorTab,
      ]);
    });

    it('a released claim stops routing to the dead surface', () => {
      const { correlationId, surfaceId } = startHarnessWorkflow();
      // `dispose()` releases the claim and closes the surface.
      claims.release(correlationId);
      router.onSurfaceClosed(surfaceId);

      router.routeQuestionPrompt(
        makeQuestion({
          id: 'q-after-dispose',
          tabId: correlationId,
          sessionId: correlationId,
        }),
      );

      expect(permissionHandler.attachQuestionTargets).not.toHaveBeenCalled();
      expect(binding.conversationForSurface(surfaceId)).toBeNull();
    });
  });
});
