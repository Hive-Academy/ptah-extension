/**
 * Shared RPC handler DI registrations.
 *
 * Each app (VS Code extension, Electron, CLI) used to inline these four
 * `container.register(..., { useFactory })` blocks in its phase file. After
 * `PLATFORM_TOKENS.DI_CONTAINER` was introduced, every constructor argument is
 * `@inject`-decorated, so the factories collapse to plain
 * `registerSingleton` calls. Consolidating them here eliminates the drift
 * window that caused the Sentry NODE-NESTJS-3X bug (SetupRpcHandlers wired
 * with the wrong slot-3 token across three apps).
 */

import type { DependencyContainer } from 'tsyringe';

import {
  SetupRpcHandlers,
  WizardGenerationRpcHandlers,
  EnhancedPromptsRpcHandlers,
  LlmRpcHandlers,
  SessionLifecycleNotifier,
  GitChangeSetRpcHandlers,
} from './handlers';
import { ConnectionCheckRecorder } from './utils/connection-check-recorder';
import { TurnChangeSetRecorder } from './chat/change-set/turn-change-set-recorder.service';
import { TurnChangeSetStore } from './chat/change-set/turn-change-set.store';

/**
 * Register the shared RPC handler classes that every app wires the same way,
 * plus the turn-event listeners (`SessionLifecycleNotifier`,
 * `TurnChangeSetRecorder`) and the change-set store the recorder and
 * `GitChangeSetRpcHandlers` share. A single registration site keeps every app
 * in lockstep.
 *
 * Call exactly once per container, after the dependencies these handlers
 * inject (LOGGER, RPC_HANDLER, MODEL_SETTINGS, SDK_PLUGIN_LOADER,
 * WORKSPACE_PROVIDER, SENTRY_SERVICE, PLATFORM_COMMANDS,
 * SDK_ENHANCED_PROMPTS_SERVICE, LICENSE_SERVICE, SAVE_DIALOG_PROVIDER,
 * WORKSPACE_STATE_STORAGE and PLATFORM_TOKENS.DI_CONTAINER) have been
 * registered.
 *
 * Note: this does NOT eagerly resolve the two listeners. Both require
 * `TOKENS.WEBVIEW_MANAGER`, which is registered at different points in each
 * host (vscode-core's phase-2 in the extension, bootstrap.ts after
 * `ElectronDIContainer.setup` in Electron, container construction in the
 * CLI). Each host must call {@link activateSessionLifecycleNotifier} once
 * WEBVIEW_MANAGER is wired — otherwise neither subscribes to turn events.
 */
export function registerSharedRpcHandlers(
  container: DependencyContainer,
): void {
  container.registerSingleton(SetupRpcHandlers);
  container.registerSingleton(WizardGenerationRpcHandlers);
  container.registerSingleton(EnhancedPromptsRpcHandlers);
  container.registerSingleton(LlmRpcHandlers);
  container.registerSingleton(SessionLifecycleNotifier);
  // Not a handler: the one in-memory store of connection checks that
  // AuthRpcHandlers (writer + route reader) and ProviderRpcHandlers (custom
  // entry test) must share. A second instance would hide their records.
  container.registerSingleton(ConnectionCheckRecorder);
  container.registerSingleton(TurnChangeSetStore);
  container.registerSingleton(TurnChangeSetRecorder);
  container.registerSingleton(GitChangeSetRpcHandlers);
}

/**
 * Eagerly resolve {@link SessionLifecycleNotifier} and
 * {@link TurnChangeSetRecorder} so their constructors subscribe to turn
 * events immediately. Call exactly once per container, after both
 * {@link registerSharedRpcHandlers} and the host's `TOKENS.WEBVIEW_MANAGER`
 * and `TOKENS.GIT_INFO_SERVICE` registrations have run.
 */
export function activateSessionLifecycleNotifier(
  container: DependencyContainer,
): void {
  container.resolve(SessionLifecycleNotifier);
  container.resolve(TurnChangeSetRecorder);
}
