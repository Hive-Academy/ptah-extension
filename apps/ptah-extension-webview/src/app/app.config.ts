import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideZoneChangeDetection,
  ErrorHandler,
} from '@angular/core';
import { provideMarkdown } from 'ngx-markdown';
import { provideVSCodeService } from '@ptah-extension/core';
// Removed Material animations import - using pure VS Code design system
// REMOVED: Angular Router imports - incompatible with VS Code webviews

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
        error.message
      );
      return;
    }

    // Check for CSP violations and provide helpful guidance
    if (isError(error) && error.message?.includes('Content Security Policy')) {
      console.error('CSP Violation detected:', error.message);
      console.error(
        'Solution: Remove inline styles and use external CSS classes only'
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
    // This ensures message listener is set up BEFORE any components render
    provideVSCodeService(),
    // Markdown rendering for chat messages (required for ngx-markdown)
    provideMarkdown(),
  ],
};
