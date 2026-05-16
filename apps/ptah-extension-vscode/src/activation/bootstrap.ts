import * as vscode from 'vscode';
import {
  type Logger,
  type LicenseService,
  type LicenseStatus,
  TOKENS,
  SentryService,
} from '@ptah-extension/vscode-core';
import { fixPath } from '@ptah-extension/agent-sdk';
import { registerVscodeSettings } from '@ptah-extension/platform-vscode';
import {
  SETTINGS_TOKENS,
  type MigrationRunner,
} from '@ptah-extension/settings-core';
import { DIContainer } from '../di/container';
import { handleLicenseBlocking } from './license-gate';

export interface BootstrapResult {
  logger: Logger;
  licenseStatus: LicenseStatus;
  authInitialized: boolean;
  /** True if license was invalid and blocking path was taken — caller should return. */
  blocked: boolean;
}

/**
 * Bootstraps the VS Code extension: minimal DI for the license gate,
 * Sentry initialization, blocking license verification (returns
 * `{ blocked: true }` when invalid), full DI setup for licensed users,
 * RPC method registration, autocomplete discovery watchers, and
 * fire-and-forget agent adapter initialization + SDK preload.
 */
export async function bootstrapVscode(
  context: vscode.ExtensionContext,
): Promise<BootstrapResult> {
  // Repair process.env.PATH on Linux/macOS when VS Code was launched from a
  // GUI launcher (Activities, dock, Finder, Spotlight). GUI-launched processes
  // do not source ~/.bashrc / ~/.zshrc, so npm global bin
  // (~/.nvm/.../bin, ~/.npm-global/bin, …) is missing from PATH and CLI
  // detection (Gemini, Codex, Copilot, Cursor) reports every CLI as "Not
  // Found". Must run before DI/CLI registry creation. No-op on Windows.
  fixPath();

  // Initialize minimal DI container with only license-related services so
  // license verification can run before full service initialization.
  DIContainer.setupMinimal(context);

  // Initialize Sentry — DSN is injected at build time via esbuild define.
  // Production builds contain the real DSN; development builds get an empty
  // string so no events are sent during local development.
  const sentryService = DIContainer.resolve<SentryService>(
    TOKENS.SENTRY_SERVICE,
  );
  const sentryDsn = typeof __SENTRY_DSN__ !== 'undefined' ? __SENTRY_DSN__ : '';
  if (sentryDsn) {
    const isDev = context.extensionMode === vscode.ExtensionMode.Development;
    sentryService.initialize({
      dsn: sentryDsn,
      environment: isDev ? 'development' : 'production',
      release: context.extension.packageJSON['version'] as string,
      platform: 'vscode',
      extensionVersion: context.extension.packageJSON['version'] as string,
    });
  }

  // License verification (blocking): must happen before full service init.
  // If the license is invalid, block extension and show license UI.
  const licenseService = DIContainer.resolve<LicenseService>(
    TOKENS.LICENSE_SERVICE,
  );
  const licenseStatus: LicenseStatus = await licenseService.verifyLicense();

  // Freemium model: Community tier has valid: true. This check only blocks
  // users with explicitly expired/revoked licenses (payment failures);
  // community users (no license key) have valid: true and bypass this block.
  if (!licenseStatus.valid) {
    // BLOCK EXTENSION - Only for revoked/payment-failed licenses
    // Handle blocking flow (show UI, register minimal commands)
    await handleLicenseBlocking(context, licenseService, licenseStatus);

    // Return blocked=true so caller exits activation early.
    // `logger` is not yet resolved (full DI not set up), so we return a placeholder
    // resolved from the minimal container — the caller will not use it when blocked.
    return {
      // Logger is available via minimal DI as well.
      logger: DIContainer.resolve<Logger>(TOKENS.LOGGER),
      licenseStatus,
      authInitialized: false,
      blocked: true,
    };
  }

  // Community and Pro users both reach here

  // Full DI setup (licensed users only).
  DIContainer.setup(context);

  // ========================================
  // UNIFIED SETTINGS REGISTRATION + MIGRATION
  // ========================================
  // registerVscodeSettings wires SETTINGS_TOKENS (SETTINGS_STORE, all 9
  // repository tokens, MIGRATION_RUNNER) into the container.
  //
  // runMigrations() MUST run before any service resolves MODEL_SETTINGS or
  // REASONING_SETTINGS. Services are registered lazily (factory/singleton)
  // and first resolved when agentAdapter.initialize() is called below, so
  // running the migration here satisfies the ordering constraint.
  //
  // DIContainer.setup() is synchronous; bootstrapVscode() is async, so we
  // can safely await here without making the phase chain async.
  try {
    const diContainer = DIContainer.getContainer();
    registerVscodeSettings(diContainer, vscode, context);
    const migrationRunner = DIContainer.resolve<MigrationRunner>(
      SETTINGS_TOKENS.MIGRATION_RUNNER,
    );
    await migrationRunner.runMigrations();
    console.log('[Ptah VS Code] Settings registered and migrations applied');
  } catch (settingsError) {
    // Non-fatal: log and continue. Worst case, provider-scoped settings fall
    // back to defaults rather than user-persisted values.
    console.warn(
      '[Ptah VS Code] Settings registration / migration failed (non-fatal):',
      settingsError instanceof Error
        ? settingsError.message
        : String(settingsError),
    );
  }

  // ========================================
  // STEP 3.1: SQLite — NOT OPENED IN VS CODE
  // ========================================
  // SQLite-backed services (memory curator, cron scheduler, messaging
  // gateway, skill synthesis) are Electron-only by design. See the matching
  // skip block in di/phase-2-libraries.ts and the ELECTRON_ONLY_METHODS list
  // in services/rpc/rpc-method-registration.service.ts. The VS Code VSIX
  // ships as a single cross-platform package and intentionally does not
  // carry the `better-sqlite3` / `sqlite-vec` native binaries.

  // Get logger from DI container
  const logger = DIContainer.resolve<Logger>(TOKENS.LOGGER);
  logger.info('Activating Ptah extension (licensed user)...', {
    tier: licenseStatus.tier,
    valid: licenseStatus.valid,
  });

  // Register RPC Methods via RpcMethodRegistrationService.
  const rpcMethodRegistration = DIContainer.resolve(
    TOKENS.RPC_METHOD_REGISTRATION_SERVICE,
  ) as { registerAll: () => void };
  rpcMethodRegistration.registerAll();

  // Initialize autocomplete discovery watchers.
  // NOTE: MCP discovery service was planned but never implemented — only agent and command discovery exist.
  const agentDiscovery = DIContainer.resolve(
    TOKENS.AGENT_DISCOVERY_SERVICE,
  ) as { initializeWatchers: () => void };
  const commandDiscovery = DIContainer.resolve(
    TOKENS.COMMAND_DISCOVERY_SERVICE,
  ) as { initializeWatchers: () => void };
  agentDiscovery.initializeWatchers();
  commandDiscovery.initializeWatchers();
  logger.info('Autocomplete discovery watchers initialized (2 services)');

  // Initialize agent adapter (SDK-only, resolves via TOKENS.AGENT_ADAPTER).
  const agentAdapter = DIContainer.resolve(TOKENS.AGENT_ADAPTER) as {
    initialize: () => Promise<boolean>;
    preloadSdk: () => Promise<void>;
    prewarm: () => Promise<void>;
  };
  const authInitialized = await agentAdapter.initialize();

  if (!authInitialized) {
    logger.info(
      'SDK authentication not configured - users can configure in Ptah Settings',
    );
  } else {
    logger.info('Agent adapters initialized successfully');

    // Pre-load SDKs in background (non-blocking) to speed up first chat
    // This shifts ~100-200ms import cost from first user interaction to activation
    agentAdapter.preloadSdk().catch((err) => {
      logger.warn('SDK preload failed (will retry on first use)', {
        error: err instanceof Error ? err.message : String(err),
      });
    });

    // Pre-warm the SDK CLI subprocess via SDK startup() (Claude Agent SDK
    // ≥ 0.2.111). Fire-and-forget — failure is benign, the first real
    // query() will spawn on demand. Do NOT await: would slow activation.
    agentAdapter.prewarm().catch((err) => {
      logger.warn('SDK prewarm failed (will resolve on first query)', {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  return {
    logger,
    licenseStatus,
    authInitialized,
    blocked: false,
  };
}
