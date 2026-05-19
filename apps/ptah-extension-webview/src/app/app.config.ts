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
} from '@ptah-extension/core';
import {
  ChatMessageHandler,
  AgentMonitorMessageHandler,
  ChatStore,
  UpdateBannerService,
  WorkspaceCoordinatorService,
  provideModelRefreshControl,
} from '@ptah-extension/chat';
import { WorkspaceIndexingService } from '@ptah-extension/workspace-indexing';
import {
  WizardViewComponent,
  provideWizardInternalState,
} from '@ptah-extension/setup-wizard';
import {
  provideEditorInternalState,
  EditorService,
} from '@ptah-extension/editor';
import { OrchestraCanvasComponent } from '@ptah-extension/canvas';
import { GatewayStateService } from '@ptah-extension/messaging-gateway-ui';
import {
  HarnessBuilderViewComponent,
  SetupHubComponent,
} from '@ptah-extension/harness-builder';
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
    { provide: ORCHESTRA_CANVAS_COMPONENT, useValue: OrchestraCanvasComponent },
    {
      provide: HARNESS_BUILDER_COMPONENT,
      useValue: HarnessBuilderViewComponent,
    },
    { provide: SETUP_HUB_COMPONENT, useValue: SetupHubComponent },
    ...provideModelRefreshControl(),
    ...provideWizardInternalState(),
    ...provideEditorInternalState(),
    { provide: MESSAGE_HANDLERS, useExisting: EditorService, multi: true },
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
      useExisting: UpdateBannerService,
      multi: true,
    },
    provideMonacoEditor({
      baseUrl: './assets/monaco/vs',
      onMonacoLoad: () => {
        const monacoVsUrl = new URL('./assets/monaco/vs', window.location.href)
          .href;
        const monacoSelf = self as typeof self & {
          MonacoEnvironment?: {
            getWorker: (moduleId: string, label: string) => Worker;
          };
        };
        monacoSelf.MonacoEnvironment = {
          getWorker: (_moduleId: string, _label: string) => {
            const workerUrl = `${monacoVsUrl}/base/worker/workerMain.js`;
            const js = `self.MonacoEnvironment = { baseUrl: '${monacoVsUrl}/' };\nimportScripts('${workerUrl}');`;
            const blob = new Blob([js], { type: 'application/javascript' });
            const blobUrl = URL.createObjectURL(blob);
            const worker = new Worker(blobUrl, { type: 'classic' as const });
            URL.revokeObjectURL(blobUrl);
            return worker;
          },
        };
      },
    }),
    provideMarkdownRendering({ extensions: 'full' }),
  ],
};
