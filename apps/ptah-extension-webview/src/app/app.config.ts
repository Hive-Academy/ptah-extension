import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideZoneChangeDetection,
  ErrorHandler,
} from '@angular/core';
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
  SESSION_DATA_PROVIDER,
  WORKSPACE_COORDINATOR,
  WIZARD_VIEW_COMPONENT,
  ORCHESTRA_CANVAS_COMPONENT,
  HARNESS_BUILDER_COMPONENT,
  SETUP_HUB_COMPONENT,
  MARKETPLACE_COMPONENT,
  TRIBUNAL_COMPONENT,
  TASKS_VIEW_COMPONENT,
} from '@ptah-extension/core';
import {
  ChatMessageHandler,
  AgentMonitorMessageHandler,
  ChatStore,
  UpdateDialogService,
  WorkspaceCoordinatorService,
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
// Angular bootstrap lands straight on this component with a user waiting.
// `WizardViewComponent` therefore stays eagerly imported here, which keeps the
// wide barrel in the eager graph regardless of where the two services are
// imported from — a narrow barrel would move zero bytes. Same structural
// no-op as the dashboard barrel dropped in Batch 3.
import {
  WizardViewComponent,
  provideWizardInternalState,
  SetupWizardStateService,
} from '@ptah-extension/setup-wizard';
import {
  provideEditorInternalState,
  EditorService,
  GitStatusService,
} from '@ptah-extension/editor/services';
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
import { provideMarkdownRendering } from '@ptah-extension/markdown';
class WebviewErrorHandler implements ErrorHandler {
  public handleError(error: unknown): void {
    const isError = (e: unknown): e is { name: string; message?: string } => {
      return typeof e === 'object' && e !== null && 'name' in e;
    };
    if (
      isError(error) &&
      error.name === 'SecurityError' &&
      (error.message?.includes('pushState') ||
        error.message?.includes('replaceState'))
    ) {
      console.warn(
        'WebView: History API error detected - this should not occur with pure signal navigation',
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
    // EAGER on purpose (TASK_2026_187 Batch 4, R15). `ptah.setupAgents` is a VS
    // Code activation event that opens a new panel hardcoded to
    // `initialView: 'setup-wizard'`, so this component IS the launch surface for
    // that panel. Do not convert this to a loader — see the import note above.
    { provide: WIZARD_VIEW_COMPONENT, useValue: WizardViewComponent },
    // EAGER on purpose (TASK_2026_187). Deferring the canvas cost 50-70 ms of
    // Electron startup TTI, because ElectronShellComponent forces grid mode in
    // its constructor — the canvas IS the launch surface there, so there is no
    // path on which deferring it helps. Do not convert this to a loader.
    { provide: ORCHESTRA_CANVAS_COMPONENT, useValue: OrchestraCanvasComponent },
    // Deferred surfaces (TASK_2026_187). `useValue` with an arrow function —
    // NEVER `useFactory`, which would invoke the arrow at injection time and
    // start every import eagerly at bootstrap. LazyViewService.resolveWhen is
    // what decides when each arrow actually runs.
    // Both of these resolve out of @ptah-extension/harness-builder, so ONE lazy
    // chunk serves both views. That is expected — do not restructure to force two.
    {
      provide: HARNESS_BUILDER_COMPONENT,
      useValue: () =>
        import('@ptah-extension/harness-builder').then(
          (m) => m.HarnessBuilderViewComponent,
        ),
    },
    {
      provide: SETUP_HUB_COMPONENT,
      useValue: () =>
        import('@ptah-extension/harness-builder').then(
          (m) => m.SetupHubComponent,
        ),
    },
    {
      provide: MARKETPLACE_COMPONENT,
      useValue: () =>
        import('@ptah-extension/marketplace').then(
          (m) => m.MarketplaceHubComponent,
        ),
    },
    {
      provide: TRIBUNAL_COMPONENT,
      useValue: () =>
        import('@ptah-extension/tribunal-panel').then(
          (m) => m.TribunalPageComponent,
        ),
    },
    {
      provide: TASKS_VIEW_COMPONENT,
      useValue: () =>
        import('@ptah-extension/tasks-ui').then((m) => m.TasksViewComponent),
    },
    { provide: MESSAGE_HANDLERS, useExisting: TasksStore, multi: true },
    ...provideModelRefreshControl(),
    ...provideWizardInternalState(),
    ...provideEditorInternalState(),
    { provide: MESSAGE_HANDLERS, useExisting: EditorService, multi: true },
    { provide: MESSAGE_HANDLERS, useExisting: GitStatusService, multi: true },
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
    provideMonacoEditor({
      baseUrl: './assets/monaco/vs',
    }),
    provideMarkdownRendering({ extensions: 'full' }),
  ],
};
