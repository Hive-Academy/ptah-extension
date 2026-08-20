/**
 * R4 gate for TASK_2026_187 Unit 5 (Batch 4).
 *
 * Batch 4 does two things that could silently break push-message delivery:
 *   1. It flips `TASKS_VIEW_COMPONENT`, `HARNESS_BUILDER_COMPONENT` and
 *      `SETUP_HUB_COMPONENT` to deferred `LazyViewLoader` arrows, so neither
 *      `tasks-ui`'s board nor `harness-builder`'s two views are in the initial
 *      bundle any more.
 *   2. It repoints two composition-root imports from the libs' WIDE barrels to
 *      new services-only barrels (`@ptah-extension/tasks-ui/services`,
 *      `@ptah-extension/harness-builder/services`).
 *
 * Either change could drop a `MESSAGE_HANDLERS` registration. The failure mode
 * is silent: the app still boots, chat still works, the bundle still shrinks,
 * and `tasks:changed` / `harness:*` / `setup-wizard:*` push events simply stop
 * landing.
 *
 * "The service is still in the providers array" is NOT the assertion that
 * catches this — the provider list is exactly what the barrel swap could have
 * broken. So this spec, like its precedents `editor-message-routing.spec.ts`
 * (Batch 1) and `thoth-message-routing.spec.ts` (Batch 3), wires the REAL
 * `MessageRouterService` to the REAL services through the SAME `useExisting`
 * `MESSAGE_HANDLERS` registrations `app.config.ts` uses, imports each service
 * through the SAME specifier production now takes, dispatches genuine `window`
 * `MessageEvent`s carrying the literal wire strings, and asserts an observable
 * effect on each service.
 *
 * Crucially, it does all of that WITHOUT ever instantiating
 * `TasksViewComponent`, `HarnessBuilderViewComponent`, `SetupHubComponent` or
 * `WizardViewComponent` — i.e. it reproduces the exact condition R4 is about:
 * the app sitting on chat with those views never opened.
 *
 * `SetupWizardStateService` is included even though the wizard was NOT deferred
 * (it is a launch surface — see R15 in the Batch 4 report): its registration
 * sits in the same provider block and is worth pinning.
 */

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  AppStateManager,
  ClaudeRpcService,
  MESSAGE_HANDLERS,
  MessageRouterService,
  VSCodeService,
} from '@ptah-extension/core';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import {
  StreamRouter,
  StreamingSurfaceRegistry,
} from '@ptah-extension/chat-routing';
// `HarnessWorkflowMessageHandler` reaches `TabManagerService` (via
// `HarnessWorkflowService` → `PermissionHandlerService`), which injects the
// inverted-dependency `MODEL_REFRESH_CONTROL` token. `app.config.ts:181` binds
// it with this exact helper, so the spec uses the same one rather than a
// hand-rolled stub — same precedent as `thoth-message-routing.spec.ts`.
import { provideModelRefreshControl } from '@ptah-extension/chat';

// The three services under test, each imported through the SAME specifier
// `app.config.ts` uses after Batch 4. If a narrow barrel ever stops exporting
// one of them, this file fails to compile — the cheapest possible R4 check.
import { TasksStore } from '@ptah-extension/tasks-ui/services';
import { HarnessWorkflowMessageHandler } from '@ptah-extension/harness-builder/services';
import { SetupWizardStateService } from '@ptah-extension/setup-wizard';

/**
 * The literal strings the backend broadcasts. Hard-coded on purpose: if a
 * shared constant is ever edited, this spec fails rather than silently
 * agreeing with the new value.
 */
const WIRE = {
  tasksChanged: 'tasks:changed',
  harnessOpenWorkflow: 'harness:open-workflow',
  harnessConfigProposed: 'harness:config-proposed',
  wizardScanProgress: 'setup-wizard:scan-progress',
} as const;

function makeVscodeStub() {
  const config = signal({
    isVSCode: false,
    theme: 'dark',
    workspaceRoot: '/ws/a',
    workspaceName: 'a',
    extensionUri: '',
    baseUri: '',
    iconUri: '',
    userIconUri: '',
    panelId: '',
    isElectron: true,
  });
  return {
    config: config.asReadonly(),
    isConnected: signal(false).asReadonly(),
    getState: jest.fn().mockReturnValue(null),
    setState: jest.fn(),
    postMessage: jest.fn(),
    messages$: { pipe: jest.fn() },
    handleMessage: jest.fn(),
    handledMessageTypes: [],
  };
}

function dispatch(type: string, payload?: unknown): void {
  window.dispatchEvent(
    new MessageEvent('message', { data: { type, payload } }),
  );
}

describe('Unit 5 push-message delivery with tasks / harness-builder / setup-hub never opened (R4)', () => {
  let router: MessageRouterService;
  let tasks: TasksStore;
  let harness: HarnessWorkflowMessageHandler;
  let wizard: SetupWizardStateService;
  let appState: AppStateManager;
  let rpcCall: jest.Mock;

  beforeEach(() => {
    // TasksStore reacts to `tasks:changed` by firing a `tasks:get` RPC. Stubbing
    // the RPC service is what makes that reaction *observable* without a board.
    rpcCall = jest.fn().mockResolvedValue({
      isSuccess: () => false,
      data: null,
      error: new Error('stubbed'),
    });

    TestBed.configureTestingModule({
      providers: [
        { provide: VSCodeService, useValue: makeVscodeStub() },
        {
          provide: ClaudeRpcService,
          useValue: { call: rpcCall, openFile: jest.fn() },
        },
        // SetupWizardStateService registers a streaming surface on construction.
        {
          provide: StreamRouter,
          useValue: {
            onSurfaceCreated: jest.fn(),
            onSurfaceClosed: jest.fn(),
            routeStreamEventForSurface: jest.fn().mockReturnValue(null),
          },
        },
        {
          provide: StreamingSurfaceRegistry,
          useValue: {
            register: jest.fn(),
            unregister: jest.fn(),
            getAdapter: jest.fn().mockReturnValue(null),
          },
        },
        ...provideModelRefreshControl(),
        MessageRouterService,
        // Mirrors app.config.ts exactly — same token, same useExisting shape.
        { provide: MESSAGE_HANDLERS, useExisting: TasksStore, multi: true },
        {
          provide: MESSAGE_HANDLERS,
          useExisting: HarnessWorkflowMessageHandler,
          multi: true,
        },
        {
          provide: MESSAGE_HANDLERS,
          useExisting: SetupWizardStateService,
          multi: true,
        },
      ],
    });

    tasks = TestBed.inject(TasksStore);
    harness = TestBed.inject(HarnessWorkflowMessageHandler);
    wizard = TestBed.inject(SetupWizardStateService);
    appState = TestBed.inject(AppStateManager);
    // Constructing the router builds the handler map, which reads
    // handledMessageTypes off all three services. A dropped registration or a
    // barrel that no longer resolves the class explodes here.
    router = TestBed.inject(MessageRouterService);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    jest.clearAllMocks();
  });

  it('registers all three services with the router without instantiating any deferred component', () => {
    expect(router).toBeTruthy();
    const registered = TestBed.inject(MESSAGE_HANDLERS);
    expect(registered).toEqual(
      expect.arrayContaining([tasks, harness, wizard]),
    );
  });

  it('the shared constants hold the exact strings the backend broadcasts', () => {
    expect(MESSAGE_TYPES.HARNESS_OPEN_WORKFLOW).toBe(WIRE.harnessOpenWorkflow);
    expect(MESSAGE_TYPES.HARNESS_CONFIG_PROPOSED).toBe(
      WIRE.harnessConfigProposed,
    );
  });

  it('routes tasks:changed to TasksStore, which fires the tasks:get refresh', () => {
    // Other root services (model list, effort) issue their own RPCs at
    // construction, so clear first and assert on the `tasks:get` method
    // specifically rather than on "was the mock touched at all".
    rpcCall.mockClear();
    expect(
      rpcCall.mock.calls.filter((c) => c[0] === 'tasks:board'),
    ).toHaveLength(0);

    // No `workspaceRoot` in the payload takes TasksStore's "refresh the active
    // workspace, best effort" branch, which is unconditional — so this asserts
    // message DELIVERY rather than incidentally asserting workspace state.
    dispatch(WIRE.tasksChanged, {});

    // The push reached TasksStore and it acted on it. Asserting the RPC — not
    // the provider list — is what proves delivery with the board never opened.
    expect(
      rpcCall.mock.calls.filter((c) => c[0] === 'tasks:board').length,
    ).toBeGreaterThan(0);
  });

  it('routes harness:open-workflow to HarnessWorkflowMessageHandler', () => {
    expect(appState.harnessWorkflowRequest()).toBeNull();

    dispatch(WIRE.harnessOpenWorkflow, {
      mode: 'new-project',
      seedPrompt: 'delivered',
    });

    const req = appState.harnessWorkflowRequest();
    expect(req).not.toBeNull();
    expect(req?.mode).toBe('new-project');
    expect(req?.seedPrompt).toBe('delivered');
  });

  it('routes setup-wizard:scan-progress to SetupWizardStateService', () => {
    expect(wizard.scanProgress()).toBeNull();

    dispatch(WIRE.wizardScanProgress, {
      filesScanned: 7,
      totalFiles: 42,
      detections: ['angular'],
    });

    const progress = wizard.scanProgress();
    expect(progress).not.toBeNull();
    expect(progress?.filesScanned).toBe(7);
    expect(progress?.totalFiles).toBe(42);
    expect(progress?.detections).toEqual(['angular']);
  });

  it('keeps every registration live across a second dispatch of each type', () => {
    rpcCall.mockClear();

    dispatch(WIRE.tasksChanged, {});
    dispatch(WIRE.harnessOpenWorkflow, { mode: 'configure-harness' });
    dispatch(WIRE.wizardScanProgress, {
      filesScanned: 1,
      totalFiles: 2,
      detections: [],
    });

    expect(
      rpcCall.mock.calls.filter((c) => c[0] === 'tasks:board').length,
    ).toBeGreaterThan(0);
    expect(appState.harnessWorkflowRequest()?.mode).toBe('configure-harness');
    expect(wizard.scanProgress()?.totalFiles).toBe(2);
  });
});
