import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
  ErrorHandler,
} from '@angular/core';
// Removed Material animations import - using pure VS Code design system
// REMOVED: Angular Router imports - incompatible with VS Code webviews

// Custom error handler for webview-specific issues
class WebviewErrorHandler implements ErrorHandler {
  handleError(error: any): void {
    // Check if it's a History API error in webview context (should not occur now)
    if (
      error &&
      error.name === 'SecurityError' &&
      (error.message?.includes('pushState') || error.message?.includes('replaceState'))
    ) {
      console.warn(
        'WebView: History API error detected - this should not occur with pure signal navigation',
        error.message,
      );
      return;
    }

    // Check for CSP violations and provide helpful guidance
    if (error && error.message?.includes('Content Security Policy')) {
      console.error('CSP Violation detected:', error.message);
      console.error('Solution: Remove inline styles and use external CSS classes only');
      return;
    }

    // Log other errors normally
    console.error('Angular Error:', error);
  }
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    { provide: ErrorHandler, useClass: WebviewErrorHandler },
  ],
};
