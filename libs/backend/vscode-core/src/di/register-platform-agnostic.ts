/**
 * VS Code Core — Platform-Agnostic DI Registration
 *
 * Registers vscode-core services that have ZERO runtime vscode dependency.
 * Safe to call from non-VS-Code hosts (Electron, tests, TUI).
 *
 * COMPILER-ENFORCEABLE BOUNDARY:
 *   This file must NOT import `vscode` at runtime. Only `import type` is
 *   permitted. Any runtime `vscode` import here breaks the Electron build.
 */

import type { DependencyContainer } from 'tsyringe';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { Logger } from '../logging/logger';
import { TOKENS } from './tokens';
import { RpcHandler } from '../messaging/rpc-handler';
import { MessageValidatorService } from '../validation/message-validator.service';
import { SubagentRegistryService } from '../services/subagent-registry.service';
import { FeatureGateService } from '../services/feature-gate.service';
import { LicenseService } from '../services/license.service';
import { AuthSecretsService } from '../services/auth-secrets.service';
import { SentryService } from '../services/sentry.service';
import { SentryTracerAdapter } from '../services/sentry-tracer.adapter';
import { NullSessionAttachmentGuard } from '../services/null-session-attachment-guard';

export interface PlatformAgnosticRegistrationOptions {
  /**
   * When true, LicenseService, AuthSecretsService, and SentryService are registered.
   * Callers that have custom shims for these (e.g., test harnesses) can pass false
   * and register their own. Default: true.
   */
  includeLicensingAndAuth?: boolean;
}

/**
 * Registers vscode-core services that have ZERO runtime vscode dependency.
 *
 * This helper is safe to call from non-VS-Code hosts (Electron, tests, TUI).
 * It does NOT register:
 *   - Anything that imports vscode at runtime (OutputManager, Logger, ErrorHandler,
 *     ConfigManager, CommandManager, WebviewManager, StatusBarManager,
 *     FileSystemManager, WebviewMessageHandlerService, PreferencesStorageService)
 *   - Logger or OutputManager — these are platform-specific and the host is
 *     expected to register adapters before calling this function.
 *
 * Prerequisites: TOKENS.LOGGER must be registered (for the diagnostic log line).
 * LicenseService, AuthSecretsService, and SentryService resolve their dependencies
 * lazily (singleton + `import type` for vscode), so registration order relative
 * to EXTENSION_CONTEXT / CONFIG_MANAGER shims does not matter — those shims must
 * simply be registered before the first call to `container.resolve(TOKENS.LICENSE_SERVICE)`.
 */
export function registerVsCodeCorePlatformAgnostic(
  container: DependencyContainer,
  logger: Logger,
  options: PlatformAgnosticRegistrationOptions = {},
): void {
  const { includeLicensingAndAuth = true } = options;
  container.registerSingleton(TOKENS.RPC_HANDLER, RpcHandler);
  container.registerSingleton(
    TOKENS.MESSAGE_VALIDATOR,
    MessageValidatorService,
  );
  container.registerSingleton(
    TOKENS.SUBAGENT_REGISTRY_SERVICE,
    SubagentRegistryService,
  );

  container.registerSingleton(TOKENS.FEATURE_GATE_SERVICE, FeatureGateService);

  // Null-object default for the webview-resume contention guard. The Electron
  // host overrides this with the gateway's AttachedSessionRegistry (last
  // registration wins); the VS Code host keeps this no-op so the shared chat
  // RPC handler can inject the token unconditionally without crashing.
  if (!container.isRegistered(PLATFORM_TOKENS.SESSION_ATTACHMENT_GUARD)) {
    container.registerSingleton(
      PLATFORM_TOKENS.SESSION_ATTACHMENT_GUARD,
      NullSessionAttachmentGuard,
    );
  }

  if (includeLicensingAndAuth) {
    container.registerSingleton(TOKENS.SENTRY_SERVICE, SentryService);
    if (!container.isRegistered(PLATFORM_TOKENS.TRACER)) {
      container.registerSingleton(PLATFORM_TOKENS.TRACER, SentryTracerAdapter);
    }
    container.registerSingleton(TOKENS.LICENSE_SERVICE, LicenseService);
    container.registerSingleton(
      TOKENS.AUTH_SECRETS_SERVICE,
      AuthSecretsService,
    );
  }

  logger.info('[VS Code Core] Platform-agnostic services registered', {
    services: [
      'RPC_HANDLER',
      'MESSAGE_VALIDATOR',
      'SUBAGENT_REGISTRY_SERVICE',
      'FEATURE_GATE_SERVICE',
      ...(includeLicensingAndAuth
        ? [
            'SENTRY_SERVICE',
            'PLATFORM_TOKENS.TRACER',
            'LICENSE_SERVICE',
            'AUTH_SECRETS_SERVICE',
          ]
        : []),
    ],
  });
}
