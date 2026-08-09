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
  UpdateBannerService,
  WorkspaceCoordinatorService,
  VoiceDownloadProgressService,
  VoiceProviderErrorService,
  provideModelRefreshControl,
} from '@ptah-extension/chat';
import { WorkspaceIndexingService } from '@ptah-extension/workspace-indexing';
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
import { GatewayStateService } from '@ptah-extension/messaging-gateway-ui';
import { SkillSynthesisLiveService } from '@ptah-extension/skill-synthesis-ui';
import { ThothStatusService } from '@ptah-extension/dashboard';
import {
  HarnessBuilderViewComponent,
  SetupHubComponent,
  HarnessWorkflowMessageHandler,
} from '@ptah-extension/harness-builder';
import { TasksViewComponent, TasksStore } from '@ptah-extension/tasks-ui';
import { VecEmbedderRecoveryService } from '@ptah-extension/memory-curator-ui';
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
    {
      provide: HARNESS_BUILDER_COMPONENT,
      useValue: HarnessBuilderViewComponent,
    },
    { provide: SETUP_HUB_COMPONENT, useValue: SetupHubComponent },
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
    { provide: TASKS_VIEW_COMPONENT, useValue: TasksViewComponent },
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
      useExisting: UpdateBannerService,
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
    provideMonacoEditor({
      baseUrl: './assets/monaco/vs',
    }),
    provideMarkdownRendering({ extensions: 'full' }),
  ],
};
