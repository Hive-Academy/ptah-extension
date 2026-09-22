import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideZoneChangeDetection,
  ErrorHandler,
} from '@angular/core';
import { PlatformLocation } from '@angular/common';
import {
  provideRouter,
  withComponentInputBinding,
  withDisabledInitialNavigation,
} from '@angular/router';
import { provideMonacoEditor } from 'ngx-monaco-editor-v2';
import {
  VSCodeService,
  provideVSCodeService,
  provideMessageRouter,
  MESSAGE_HANDLERS,
  ClaudeRpcService,
  AutopilotStateService,
  AppStateManager,
  ElectronLayoutService,
  BootStatusService,
  BackOfficeActivityService,
  MemoryPlatformLocation,
  SESSION_DATA_PROVIDER,
  WORKSPACE_COORDINATOR,
  ORCHESTRA_CANVAS_COMPONENT,
  FILE_LINK_OPENER,
} from '@ptah-extension/core';
import { appRoutes } from './app.routes';
import {
  ChatMessageHandler,
  AgentMonitorMessageHandler,
  ChatStore,
  UpdateDialogService,
  WorkspaceCoordinatorService,
  FileLinkRouterService,
  VoiceDownloadProgressService,
  VoiceProviderErrorService,
  provideModelRefreshControl,
} from '@ptah-extension/chat';
import { WorkspaceIndexingService } from '@ptah-extension/workspace-indexing';
// NOTE: intentionally the WIDE barrel, and there is deliberately no
// `@ptah-extension/setup-wizard/services` barrel (TASK_2026_187 R6/R15).
// The setup wizard is a LAUNCH SURFACE: `onCommand:ptah.setupAgents`
// (apps/ptah-extension-vscode/package.json:41) opens a dedicated webview panel
// whose HTML hardcodes `initialView: 'setup-wizard'`
// (agent-generation/.../wizard/webview-lifecycle.service.ts:153), so a fresh
// Angular bootstrap lands straight on that component with a user waiting.
// `app.routes.ts` therefore binds it with a static `component:` and keeps the
// wide barrel in the eager graph regardless of where the two services below
// are imported from — a narrow barrel would move zero bytes. Same structural
// no-op as the dashboard barrel dropped in Batch 3.
import {
  provideWizardInternalState,
  SetupWizardStateService,
} from '@ptah-extension/setup-wizard';
import {
  DiffTabsService,
  GitBranchesService,
  GitStatusService,
  WorktreeService,
} from '@ptah-extension/git-ui';
import { OrchestraCanvasComponent } from '@ptah-extension/canvas';
import { GatewayStateService } from '@ptah-extension/messaging-gateway-ui/services';
import { SkillSynthesisLiveService } from '@ptah-extension/skill-synthesis-ui/services';
// NOTE: intentionally the WIDE barrel. A narrow `@ptah-extension/dashboard/services`
// barrel was built and measured for this import and moved 0 bytes
// (dashboard: 35.7 kB -> 35.8 kB), because `DashboardGridComponent` stays eager
// via `AppShellComponent.imports` — the analytics view is startup-reachable
// (`ptah.openDashboard`) so it is deliberately NOT deferred. Dead scaffolding
// dropped per TASK_2026_187 R6.
import { ThothStatusService } from '@ptah-extension/dashboard';
import { HarnessWorkflowMessageHandler } from '@ptah-extension/harness-builder/services';
// NARROW barrel on purpose. `MARKETPLACE_COMPONENT` below is deferred, so
// importing `HarnessHealthStore` from the wide barrel would pull the whole
// marketplace hub back into the eager graph just to register one push handler.
import { HarnessHealthStore } from '@ptah-extension/marketplace/services';
import { TasksStore } from '@ptah-extension/tasks-ui/services';
import { VecEmbedderRecoveryService } from '@ptah-extension/memory-curator-ui/services';
import {
  MARKDOWN_FILE_LINK_HANDLER,
  provideMarkdownFileLinks,
  provideMarkdownRendering,
} from '@ptah-extension/markdown';
class WebviewErrorHandler implements ErrorHandler {
  public handleError(error: unknown): void {
    const isError = (e: unknown): e is { name: string; message?: string } => {
      return typeof e === 'object' && e !== null && 'name' in e;
    };
    // Kept as a tripwire, not as a workaround. Nothing in this application
    // reaches the History API any more: `MemoryPlatformLocation` is bound at
    // the `PlatformLocation` seam below, and `Location` forwards every state
    // change to it. A `SecurityError` naming pushState/replaceState therefore
    // means a third-party dependency called `history` directly — worth a
    // warning and worth not crashing the webview over, but it is no longer an
    // expected condition.
    if (
      isError(error) &&
      error.name === 'SecurityError' &&
      (error.message?.includes('pushState') ||
        error.message?.includes('replaceState'))
    ) {
      console.warn(
        'WebView: History API error detected — the app routes through MemoryPlatformLocation, so this came from outside it',
        error.message,
      );
      return;
    }
    if (isError(error) && error.message?.includes('Content Security Policy')) {
      console.error('CSP Violation detected:', error.message);
      console.error(
        'Solution: Remove inline styles and use external CSS classes only',
      );
      return;
    }
    console.error('Angular Error:', error);
  }
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({ eventCoalescing: true }),
    { provide: ErrorHandler, useClass: WebviewErrorHandler },
    // THE ROUTER'S HOST SEAM — this provider is what makes routing possible in
    // both hosts, and it is load-bearing.
    //
    // `BrowserPlatformLocation.pushState` forwards straight to
    // `history.pushState` with no guard, and `withHashLocation()` is not an
    // escape from it (`HashLocationStrategy.pushState` calls
    // `platformLocation.pushState` too and never assigns `location.hash`). The
    // Electron renderer loads through `mainWindow.loadFile(...)` and the HTML
    // specification rejects a changed `file:` pathname, so a real
    // `PlatformLocation` can raise a `SecurityError` there.
    // `MemoryPlatformLocation` holds the logical URL, the state and the pop
    // subscriptions itself and touches `window.history` nowhere.
    //
    // Binding it HERE, at the application injector, shadows the platform-level
    // `PlatformLocation` provider for `Location`, `PathLocationStrategy` and
    // the Router alike. Do not move it into a route's `providers`, which those
    // root services would never see.
    { provide: PlatformLocation, useClass: MemoryPlatformLocation },
    // `withDisabledInitialNavigation()` is equally load-bearing: without it the
    // Router resolves the empty URL before `App.handleInitialView` has read
    // `window.ptahConfig.initialView`, and a panel opened on `setup-wizard`
    // paints chat first. `App.handleInitialView` performs the one initial
    // navigation.
    provideRouter(
      appRoutes,
      withComponentInputBinding(),
      withDisabledInitialNavigation(),
    ),
    provideVSCodeService(),
    provideMessageRouter(),
    { provide: MESSAGE_HANDLERS, useExisting: VSCodeService, multi: true },
    { provide: MESSAGE_HANDLERS, useExisting: ClaudeRpcService, multi: true },
    {
      provide: MESSAGE_HANDLERS,
      useExisting: AutopilotStateService,
      multi: true,
    },
    { provide: MESSAGE_HANDLERS, useExisting: AppStateManager, multi: true },
    { provide: MESSAGE_HANDLERS, useExisting: ChatMessageHandler, multi: true },
    {
      provide: MESSAGE_HANDLERS,
      useExisting: AgentMonitorMessageHandler,
      multi: true,
    },
    { provide: SESSION_DATA_PROVIDER, useExisting: ChatStore },
    {
      provide: WORKSPACE_COORDINATOR,
      useExisting: WorkspaceCoordinatorService,
    },
    // One router behind both ports. `useExisting` (NOT `useClass`) is
    // load-bearing: two instances would mean a tool-call chip and an agent
    // markdown link could resolve context differently, and the second would
    // hold its own git-ui module cache.
    { provide: FILE_LINK_OPENER, useExisting: FileLinkRouterService },
    { provide: MARKDOWN_FILE_LINK_HANDLER, useExisting: FileLinkRouterService },
    // EAGER on purpose (TASK_2026_187). Deferring the canvas cost 50-70 ms of
    // Electron startup TTI, because ElectronShellComponent forces grid mode in
    // its constructor — the canvas IS the launch surface there, so there is no
    // path on which deferring it helps. Do not convert this to a loader, and
    // do not turn it into a route: the canvas is kept mounted behind
    // `[class.hidden]` so `CanvasStore` survives navigation (batch 3 replaces
    // that with a `RouteReuseStrategy`).
    { provide: ORCHESTRA_CANVAS_COMPONENT, useValue: OrchestraCanvasComponent },
    { provide: MESSAGE_HANDLERS, useExisting: TasksStore, multi: true },
    ...provideModelRefreshControl(),
    ...provideWizardInternalState(),
    { provide: MESSAGE_HANDLERS, useExisting: GitStatusService, multi: true },
    { provide: MESSAGE_HANDLERS, useExisting: GitBranchesService, multi: true },
    { provide: MESSAGE_HANDLERS, useExisting: WorktreeService, multi: true },
    { provide: MESSAGE_HANDLERS, useExisting: DiffTabsService, multi: true },
    {
      provide: MESSAGE_HANDLERS,
      useExisting: ElectronLayoutService,
      multi: true,
    },
    {
      provide: MESSAGE_HANDLERS,
      useExisting: WorkspaceIndexingService,
      multi: true,
    },
    {
      provide: MESSAGE_HANDLERS,
      useExisting: GatewayStateService,
      multi: true,
    },
    {
      provide: MESSAGE_HANDLERS,
      useExisting: SkillSynthesisLiveService,
      multi: true,
    },
    {
      provide: MESSAGE_HANDLERS,
      useExisting: VoiceDownloadProgressService,
      multi: true,
    },
    {
      provide: MESSAGE_HANDLERS,
      useExisting: VoiceProviderErrorService,
      multi: true,
    },
    {
      provide: MESSAGE_HANDLERS,
      useExisting: ThothStatusService,
      multi: true,
    },
    {
      provide: MESSAGE_HANDLERS,
      useExisting: UpdateDialogService,
      multi: true,
    },
    {
      provide: MESSAGE_HANDLERS,
      useExisting: VecEmbedderRecoveryService,
      multi: true,
    },
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
    // Registered even though the Marketplace surface is lazy: the reconciler
    // pushes `harness:healthChanged` from activation and session-start passes,
    // which happen long before anyone opens the hub. Handled here, the badge is
    // right on first paint instead of one refresh behind.
    {
      provide: MESSAGE_HANDLERS,
      useExisting: HarnessHealthStore,
      multi: true,
    },
    // Boot readiness (TASK_2026_380). Registered for BOTH hosts on purpose:
    // the service defaults to `ready`, so the VS Code webview — which never
    // receives `boot:readinessChanged` — is unaffected by construction.
    { provide: MESSAGE_HANDLERS, useExisting: BootStatusService, multi: true },
    {
      provide: MESSAGE_HANDLERS,
      useExisting: BackOfficeActivityService,
      multi: true,
    },
    provideMonacoEditor({
      baseUrl: './assets/monaco/vs',
    }),
    provideMarkdownRendering({ extensions: 'full' }),
    // Installs the document-level file-link listener. It acts only inside a
    // container carrying `data-ptah-file-links`, so non-agent markdown (task
    // detail, settings, release notes) keeps plain browser link behaviour.
    provideMarkdownFileLinks(),
  ],
};
