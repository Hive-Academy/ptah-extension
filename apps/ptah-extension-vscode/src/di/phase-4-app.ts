/**
 * Phase 4 — App-level services (storage adapters, webview support, command handlers)
 *
 * Extracted from `container.ts` as part of TASK_2025_291 Wave C1, Step 2a.
 * Corresponds to the original file's Phase 3 / 4 / 5 blocks.
 *
 * These services are truly app-level:
 *   - Storage adapters wrap VS Code's `workspaceState` / `globalState` directly.
 *   - `WebviewHtmlGenerator` requires the `ExtensionContext` captured via closure
 *     so that the `.vsix` bundled asset paths can be resolved lazily when a
 *     webview is created.
 *   - `LicenseCommands` is the command-palette entry point registered late so
 *     that all dependencies (LicenseService, WebviewManager, etc.) are available.
 */

import type { DependencyContainer } from 'tsyringe';
import * as vscode from 'vscode';

import { TOKENS } from '@ptah-extension/vscode-core';

import { WebviewEventQueue } from '../services/webview-event-queue';
import { AngularWebviewProvider } from '../providers/angular-webview.provider';
import { WebviewHtmlGenerator } from '../services/webview-html-generator';
import { LicenseCommands } from '../commands/license-commands';

export function registerPhase4App(
  container: DependencyContainer,
  context: vscode.ExtensionContext,
): void {
  // ========================================
  // PHASE 3: Storage Adapters
  // ========================================
  // Storage adapter over VS Code's workspaceState. The `get` wrapper resolves
  // the `undefined`-handling quirk of `workspaceState.get<T>(key)` which does
  // not respect the `defaultValue` parameter signature cleanly.
  const storageAdapter = {
    get: <T>(key: string, defaultValue?: T): T | undefined => {
      const value = context.workspaceState.get<T>(key);
      return value !== undefined ? value : defaultValue;
    },
    set: async <T>(key: string, value: T): Promise<void> => {
      await context.workspaceState.update(key, value);
    },
  };
  container.register(TOKENS.STORAGE_SERVICE, { useValue: storageAdapter });

  // Global state adapter (pricing cache uses globalState for cross-workspace persistence).
  container.register(TOKENS.GLOBAL_STATE, { useValue: context.globalState });

  // ========================================
  // PHASE 4: Webview Support Services
  // ========================================
  container.registerSingleton(TOKENS.WEBVIEW_EVENT_QUEUE, WebviewEventQueue);

  // WebviewHtmlGenerator — used by AngularWebviewProvider and SetupWizardService.
  // Registered as factory because it requires `ExtensionContext` which is not
  // itself injectable (it's a value, not a service). Context is captured via
  // closure so the factory can be called at any time after registration.
  container.register(TOKENS.WEBVIEW_HTML_GENERATOR, {
    useFactory: () => new WebviewHtmlGenerator(context),
  });

  container.registerSingleton(
    TOKENS.ANGULAR_WEBVIEW_PROVIDER,
    AngularWebviewProvider,
  );

  // ========================================
  // PHASE 5: Command Handlers (TASK_2025_075)
  // ========================================
  container.registerSingleton(TOKENS.LICENSE_COMMANDS, LicenseCommands);
}
