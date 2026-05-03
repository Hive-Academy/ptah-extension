/**
 * VS Code Core — Platform-Agnostic DI Registration (TASK_2025_291, Wave C1)
 *
 * Registers vscode-core services that have ZERO runtime vscode dependency.
 * Safe to call from non-VS-Code hosts (Electron, tests, TUI).
 *
 * COMPILER-ENFORCEABLE BOUNDARY:
 *   This file must NOT import `vscode` at runtime. Only `import type` is
 *   permitted. Any runtime `vscode` import here breaks the Electron build.
 */

import type { DependencyContainer } from 'tsyringe';
import type { Logger } from '../logging/logger';
import { TOKENS } from './tokens';

// Platform-agnostic vscode-core services (verified: no vscode runtime import)
import { RpcHandler } from '../messaging/rpc-handler';
import { MessageValidatorService } from '../validation/message-validator.service';
import { SubagentRegistryService } from '../services/subagent-registry.service';
import { FeatureGateService } from '../services/feature-gate.service';
import { LicenseService } from '../services/license.service';
import { AuthSecretsService } from '../services/auth-secrets.service';
import { SentryService } from '../services/sentry.service';

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

  // Core platform-agnostic infrastructure
  container.registerSingleton(TOKENS.RPC_HANDLER, RpcHandler);
  container.registerSingleton(
    TOKENS.MESSAGE_VALIDATOR,
    MessageValidatorService,
  );

  // TODO(C1 step 2): remove guard once app containers stop double-registering
  // SUBAGENT_REGISTRY_SERVICE. Currently registered by both:
  //   - apps/ptah-extension-vscode/src/di/container.ts Phase 1.5.1
  //   - apps/ptah-electron/src/di/container.ts (unguarded)
  // Step 2 of Wave C1 removes those duplicates.
  if (!container.isRegistered(TOKENS.SUBAGENT_REGISTRY_SERVICE)) {
    container.registerSingleton(
      TOKENS.SUBAGENT_REGISTRY_SERVICE,
      SubagentRegistryService,
    );
  }

  container.registerSingleton(TOKENS.FEATURE_GATE_SERVICE, FeatureGateService);

  if (includeLicensingAndAuth) {
    // All three use `import type` for vscode — no runtime dependency.
    // Guarded because VS Code's setupMinimal() pre-registers SENTRY_SERVICE and
    // LICENSE_SERVICE before setup() (and thus before registerVsCodeCoreServices)
    // runs. Electron's container.ts also registers these independently today; the
    // guards make the helper idempotent for that transitional window.
    if (!container.isRegistered(TOKENS.SENTRY_SERVICE)) {
      container.registerSingleton(TOKENS.SENTRY_SERVICE, SentryService);
    }
    if (!container.isRegistered(TOKENS.LICENSE_SERVICE)) {
      container.registerSingleton(TOKENS.LICENSE_SERVICE, LicenseService);
    }
    if (!container.isRegistered(TOKENS.AUTH_SECRETS_SERVICE)) {
      container.registerSingleton(
        TOKENS.AUTH_SECRETS_SERVICE,
        AuthSecretsService,
      );
    }
  }

  logger.info('[VS Code Core] Platform-agnostic services registered', {
    services: [
      'RPC_HANDLER',
      'MESSAGE_VALIDATOR',
      'SUBAGENT_REGISTRY_SERVICE',
      'FEATURE_GATE_SERVICE',
      ...(includeLicensingAndAuth
        ? ['SENTRY_SERVICE', 'LICENSE_SERVICE', 'AUTH_SECRETS_SERVICE']
        : []),
    ],
  });
}
