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

import { instanceCachingFactory, type DependencyContainer } from 'tsyringe';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { Logger } from '../logging/logger';
import { TOKENS } from './tokens';
import { RpcHandler } from '../messaging/rpc-handler';
import { MessageValidatorService } from '../validation/message-validator.service';
import { SubagentRegistryService } from '../services/subagent-registry.service';
import { LicenseService } from '../services/license.service';
import { AuthSecretsService } from '../services/auth-secrets.service';
import { SentryService } from '../services/sentry.service';
import { SentryTracerAdapter } from '../services/sentry-tracer.adapter';
import { NullSessionAttachmentGuard } from '../services/null-session-attachment-guard';
import { NullBootReadinessProvider } from '../services/null-boot-readiness';
import { EventLoopMonitor } from '../diagnostics/event-loop-monitor';
import { CpuProfileCapture } from '../diagnostics/cpu-profile-capture';
import { DegradationReporter } from '../logging/degradation-reporter';

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

  // Null-object default for the boot readiness probe. The Electron host
  // registers its coordinator-backed adapter first (bootstrap.ts), so this
  // guard leaves that binding alone; VS Code and the CLI get "always ready",
  // which is the truthful answer for a host with no staged boot.
  if (!container.isRegistered(PLATFORM_TOKENS.BOOT_READINESS)) {
    container.registerSingleton(
      PLATFORM_TOKENS.BOOT_READINESS,
      NullBootReadinessProvider,
    );
  }

  // Hang diagnostics (TASK_2026_323). Constructed lazily and, critically, NOT
  // started here: registration is not the right moment to begin sampling,
  // because each host wants coverage to start at a different point in its boot
  // (Electron arms it BEFORE the heavy wiring, since that wiring is itself a
  // suspect). `armDiagnostics` is the call that turns them on.
  container.registerSingleton(TOKENS.EVENT_LOOP_MONITOR, EventLoopMonitor);
  container.registerSingleton(TOKENS.CPU_PROFILE_CAPTURE, CpuProfileCapture);

  // Degradation counting (TASK_2026_383). Registered here rather than in the
  // VS Code-only `register.ts` because the reporter has zero vscode surface and
  // its first consumers are the Electron boot summary and the CLI — a binding
  // behind `registerVsCodeCoreServices` would be invisible to both.
  //
  // `instanceCachingFactory` rather than `registerSingleton`: the reporter is
  // constructed with the CONTAINER (it resolves the webview manager lazily, per
  // report, so a manager registered after boot is still found), which a
  // decorator-injected constructor cannot express. A bare `useFactory` would
  // re-run on every resolve and hand each caller its own empty tally.
  if (!container.isRegistered(TOKENS.DEGRADATION_REPORTER)) {
    container.register(TOKENS.DEGRADATION_REPORTER, {
      useFactory: instanceCachingFactory((c) => new DegradationReporter(c)),
    });
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
      'EVENT_LOOP_MONITOR',
      'CPU_PROFILE_CAPTURE',
      'DEGRADATION_REPORTER',
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
