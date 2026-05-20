/**
 * Phase 4 — App-level services (storage adapters, webview support, command handlers)
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
  container.register(TOKENS.GLOBAL_STATE, { useValue: context.globalState });
  container.registerSingleton(TOKENS.WEBVIEW_EVENT_QUEUE, WebviewEventQueue);
  container.register(TOKENS.WEBVIEW_HTML_GENERATOR, {
    useFactory: () => new WebviewHtmlGenerator(context),
  });

  container.registerSingleton(
    TOKENS.ANGULAR_WEBVIEW_PROVIDER,
    AngularWebviewProvider,
  );
  container.registerSingleton(TOKENS.LICENSE_COMMANDS, LicenseCommands);
}
