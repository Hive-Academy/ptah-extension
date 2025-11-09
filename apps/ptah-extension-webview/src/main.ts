// CRITICAL: Import Zone.js FIRST before any Angular imports
// Zone.js is required for provideZoneChangeDetection() to work
import 'zone.js';

import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { environment } from './environments/environment';

// Type declaration for window globals injected by VS Code
declare global {
  interface Window {
    vscode?: unknown;
    ptahConfig?: unknown;
    ptahPreviousState?: unknown;
  }
}

/**
 * Initialize Mock Environment for Browser Testing
 *
 * When running in development mode (ng serve), this sets up a complete
 * mock of the VS Code API that exactly mirrors the extension's message protocol.
 *
 * The mock system:
 * - Responds to all message types the extension handles
 * - Simulates realistic streaming responses
 * - Maintains session state
 * - Provides mock provider management
 * - Works seamlessly without any code changes in components
 */
async function initializeMockEnvironment(): Promise<void> {
  if (environment.useMockApi && !window.vscode) {
    console.log('=================================================');
    console.log('🎭 MOCK ENVIRONMENT INITIALIZATION');
    console.log('=================================================');
    console.log('Running in browser development mode');
    console.log('Mock API will simulate VS Code extension behavior');
    console.log('=================================================');

    // Dynamically import mock API to avoid including it in production bundle
    const { createMockVSCodeApi } = await import('./mock/mock-vscode-api');

    // Initialize mock VS Code API
    window.vscode = createMockVSCodeApi();

    // Initialize mock configuration
    window.ptahConfig = {
      isVSCode: false,
      theme: 'dark',
      workspaceRoot: '/mock/workspace',
      workspaceName: 'mock-project',
      extensionUri: '',
      baseUri: '',
      iconUri: '/assets/ptah-icon.svg',
    };

    console.log('✅ Mock environment initialized successfully');
    console.log('=================================================');
  }
}

// Initialize environment before bootstrapping
initializeMockEnvironment().then(() => {
  console.log('=== PTAH WEBVIEW BOOTSTRAP STARTING ===');
  console.log('Window globals:', {
    hasVscode: !!window.vscode,
    hasPtahConfig: !!window.ptahConfig,
    mode: window.vscode
      ? environment.useMockApi
        ? 'Browser (Mock API)'
        : 'VS Code Extension'
      : 'Development',
  });

  bootstrapApplication(App, appConfig)
    .then(() => {
      console.log('=== PTAH WEBVIEW BOOTSTRAP COMPLETE ===');
    })
    .catch((err) => {
      console.error('=== PTAH WEBVIEW BOOTSTRAP FAILED ===', err);
    });
});
