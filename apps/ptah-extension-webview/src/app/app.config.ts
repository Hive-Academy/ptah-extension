import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideZoneChangeDetection,
  ErrorHandler,
} from '@angular/core';
import { provideMarkdown, MARKED_EXTENSIONS, SANITIZE } from 'ngx-markdown';
import { provideMonacoEditor } from 'ngx-monaco-editor-v2';
import DOMPurify from 'dompurify';
import {
  provideVSCodeService,
  provideMessageRouter,
  MESSAGE_HANDLERS,
  ClaudeRpcService,
  AutopilotStateService,
  AppStateManager,
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
  WorkspaceCoordinatorService,
} from '@ptah-extension/chat';
import { WizardViewComponent } from '@ptah-extension/setup-wizard';
import { OrchestraCanvasComponent } from '@ptah-extension/canvas';
import {
  HarnessBuilderViewComponent,
  SetupHubComponent,
} from '@ptah-extension/harness-builder';
import { getMarkedExtensions } from './marked-extensions';
// Removed Material animations import - using pure VS Code design system
// REMOVED: Angular Router imports - incompatible with VS Code webviews

/**
 * Permissive DOMPurify sanitizer for AI-generated markdown content.
 *
 * Blocks only actual XSS vectors (script injection, event handlers, javascript: URIs)
 * while preserving all legitimate HTML that AI agents commonly produce:
 * - Code blocks, tables, lists, headings, links, images
 * - SVG diagrams, details/summary, kbd, abbr, mark
 * - data-* attributes, class, id, style (safe subset)
 * - Custom elements from marked extensions (callout cards, code headers, etc.)
 */
function createPermissiveSanitizer(): (html: string) => string {
  return (html: string) =>
    DOMPurify.sanitize(html, {
      // Block dangerous tags only — allow everything else
      FORBID_TAGS: [
        'script',
        'iframe',
        'object',
        'embed',
        'form',
        'input',
        'textarea',
        'select',
        'button',
      ],
      // Block event handlers and dangerous attributes only
      FORBID_ATTR: [
        'onerror',
        'onload',
        'onclick',
        'onmouseover',
        'onfocus',
        'onblur',
        'onsubmit',
        'onchange',
        'oninput',
        'onkeydown',
        'onkeyup',
        'onkeypress',
      ],
      // Allow data-* attributes (used by marked extensions)
      ALLOW_DATA_ATTR: true,
      // Allow ARIA attributes for accessibility
      ALLOW_ARIA_ATTR: true,
      // Allow safe URI protocols
      ALLOWED_URI_REGEXP:
        /^(?:(?:https?|mailto|tel|data):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
    });
}

// Custom error handler for webview-specific issues
class WebviewErrorHandler implements ErrorHandler {
  public handleError(error: unknown): void {
    // Type guard for error objects with name and message
    const isError = (e: unknown): e is { name: string; message?: string } => {
      return typeof e === 'object' && e !== null && 'name' in e;
    };

    // Check if it's a History API error in webview context (should not occur now)
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

    // Check for CSP violations and provide helpful guidance
    if (isError(error) && error.message?.includes('Content Security Policy')) {
      console.error('CSP Violation detected:', error.message);
      console.error(
        'Solution: Remove inline styles and use external CSS classes only',
      );
      return;
    }

    // Log other errors normally
    console.error('Angular Error:', error);
  }
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // SWITCHED TO ZONE-BASED: Using Zone.js for automatic change detection
    // This will automatically trigger change detection for async operations,
    // window.addEventListener, setTimeout, etc.
    provideZoneChangeDetection({ eventCoalescing: true }),
    { provide: ErrorHandler, useClass: WebviewErrorHandler },
    // CRITICAL: Eager initialization of VSCodeService before app starts
    provideVSCodeService(),
    // Message routing: handler registration pattern (replaces VSCodeService routing)
    provideMessageRouter(),
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
    // Session data provider: breaks circular dependency between dashboard and chat.
    // ChatStore is already providedIn: 'root', so useExisting reuses the singleton.
    { provide: SESSION_DATA_PROVIDER, useExisting: ChatStore },
    // Workspace coordinator: breaks circular dependency between core and chat/editor.
    // WorkspaceCoordinatorService orchestrates TabManager + Editor during workspace ops.
    {
      provide: WORKSPACE_COORDINATOR,
      useExisting: WorkspaceCoordinatorService,
    },
    // Wizard view component: breaks circular dependency between chat and setup-wizard.
    // AppShellComponent renders this via NgComponentOutlet instead of importing directly.
    { provide: WIZARD_VIEW_COMPONENT, useValue: WizardViewComponent },
    // Orchestra canvas component: breaks circular dependency between chat and canvas.
    // canvas imports TabManagerService from chat, so chat cannot import canvas directly.
    { provide: ORCHESTRA_CANVAS_COMPONENT, useValue: OrchestraCanvasComponent },
    // Harness builder component: breaks circular dependency between chat and harness-builder.
    {
      provide: HARNESS_BUILDER_COMPONENT,
      useValue: HarnessBuilderViewComponent,
    },
    // Setup hub component: breaks circular dependency between chat and harness-builder.
    { provide: SETUP_HUB_COMPONENT, useValue: SetupHubComponent },
    // Monaco editor for Electron code editing panel
    provideMonacoEditor({
      baseUrl: './assets/monaco/vs',
      onMonacoLoad: () => {
        // Fix Monaco web workers for Electron's file:// protocol.
        // Workers need absolute file:/// URLs; relative file:// URLs fail importScripts.
        const monacoVsUrl = new URL('./assets/monaco/vs', window.location.href)
          .href;
        (self as any).MonacoEnvironment = {
          getWorkerUrl: (_moduleId: string, _label: string) => {
            const workerUrl = `${monacoVsUrl}/base/worker/workerMain.js`;
            const js = `self.MonacoEnvironment = { baseUrl: '${monacoVsUrl}/' };\nimportScripts('${workerUrl}');`;
            return (
              'data:text/javascript;charset=utf-8,' + encodeURIComponent(js)
            );
          },
        };
      },
    }),
    // Markdown rendering for chat messages (required for ngx-markdown)
    // Includes custom extensions for callout cards and collapsible code blocks
    provideMarkdown({
      sanitize: { provide: SANITIZE, useFactory: createPermissiveSanitizer },
      markedExtensions: getMarkedExtensions().map((ext) => ({
        provide: MARKED_EXTENSIONS,
        useValue: ext,
        multi: true,
      })),
    }),
  ],
};
