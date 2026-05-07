import * as vscode from 'vscode';
import {
  type Logger,
  type LicenseService,
  type LicenseStatus,
  TOKENS,
  SentryService,
} from '@ptah-extension/vscode-core';
import { fixPath } from '@ptah-extension/agent-sdk';
import {
  PERSISTENCE_TOKENS,
  type SqliteConnectionService,
} from '@ptah-extension/persistence-sqlite';
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
 * Phase 1 of VS Code activation (TASK_2025_291 Wave C1).
 *
 * Covers:
 * - Step 1: minimal DI setup for license check
 * - Step 1b: Sentry initialization
 * - Step 2: license verification (blocking — returns `{ blocked: true }` if invalid)
 * - Step 3: full DI setup for licensed users
 * - Step 4: logger resolution + RPC method registration + autocomplete discovery watchers
 * - Step 7: agent adapter initialization + SDK preload (fire-and-forget)
 */
export async function bootstrapVscode(
  context: vscode.ExtensionContext,
): Promise<BootstrapResult> {
  // STEP 0: Repair process.env.PATH on Linux/macOS when VS Code was
  // launched from a GUI launcher (Activities, dock, Finder, Spotlight).
  // GUI-launched processes do not source ~/.bashrc / ~/.zshrc, so npm
  // global bin (~/.nvm/.../bin, ~/.npm-global/bin, …) is missing from
  // PATH and CLI detection (Gemini, Codex, Copilot, Cursor) reports
  // every CLI as "Not Found". Must run before DI/CLI registry creation.
  // No-op on Windows.
  fixPath();

  // ========================================
  // STEP 1: MINIMAL DI SETUP FOR LICENSE CHECK (TASK_2025_121)
  // ========================================
  // Initialize minimal DI container with only license-related services
  // This allows license verification before full service initialization
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

  // ========================================
  // STEP 2: LICENSE VERIFICATION (BLOCKING)
  // ========================================
  // CRITICAL: License verification MUST happen BEFORE full service init
  // If license is invalid, block extension and show license UI
  const licenseService = DIContainer.resolve<LicenseService>(
    TOKENS.LICENSE_SERVICE,
  );
  const licenseStatus: LicenseStatus = await licenseService.verifyLicense();

  // TASK_2025_128: Freemium model - Community tier has valid: true
  // This check only blocks users with explicitly expired/revoked licenses (payment failures)
  // Community users (no license key) have valid: true and bypass this block
  if (!licenseStatus.valid) {
    // BLOCK EXTENSION - Only for revoked/payment-failed licenses
    // Handle blocking flow (show UI, register minimal commands)
    await handleLicenseBlocking(context, licenseService, licenseStatus);

    // Return blocked=true so caller exits activation early.
    // `logger` is not yet resolved (full DI not set up), so we return a placeholder
    // resolved from the minimal container — the caller will not use it when blocked.
    return {
      // Logger is available via minimal DI as well (registered in Phase 1 infra)
      logger: DIContainer.resolve<Logger>(TOKENS.LOGGER),
      licenseStatus,
      authInitialized: false,
      blocked: true,
    };
  }

  // Community and Pro users both reach here

  // ========================================
  // STEP 3: FULL DI SETUP (Licensed users only)
  // ========================================
  DIContainer.setup(context);

  // ========================================
  // STEP 3.1: OPEN SQLITE + RUN MIGRATIONS (TASK_2026_HERMES Track 1)
  // ========================================
  // The connection is registered in Phase 2.55 but lazy-opened here so
  // openAndMigrate() failures (missing better-sqlite3 native build,
  // disk full, etc.) are non-fatal — memory curator simply stays disabled.
  let sqliteConnection: SqliteConnectionService | null = null;
  try {
    if (DIContainer.isRegistered(PERSISTENCE_TOKENS.SQLITE_CONNECTION)) {
      console.log('[Ptah VS Code] Resolving SQLite connection service...');
      sqliteConnection = DIContainer.resolve<SqliteConnectionService>(
        PERSISTENCE_TOKENS.SQLITE_CONNECTION,
      );
      console.log(
        '[Ptah VS Code] SQLite connection service resolved, calling openAndMigrate()...',
      );
      await sqliteConnection.openAndMigrate();
      console.log(
        '[Ptah VS Code] SQLite connection opened + migrated successfully',
      );
    } else {
      console.warn(
        '[Ptah VS Code] PERSISTENCE_TOKENS.SQLITE_CONNECTION not registered, skipping',
      );
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : '';
    console.error(
      '[Ptah VS Code] SQLite openAndMigrate FAILED (non-fatal):',
      errorMessage,
    );
    console.error('[Ptah VS Code] Error stack:', errorStack);
    sqliteConnection = null;
  }

  // ========================================
  // STEP 3.5: MIGRATE FILE-BASED SETTINGS (TASK_2025_247)

  // Get logger from DI container
  const logger = DIContainer.resolve<Logger>(TOKENS.LOGGER);
  logger.info('Activating Ptah extension (licensed user)...', {
    tier: licenseStatus.tier,
    valid: licenseStatus.valid,
  });

  // Register RPC Methods (Phase 2 - TASK_2025_021)
  // Extracted to RpcMethodRegistrationService for clean separation
  const rpcMethodRegistration = DIContainer.resolve(
    TOKENS.RPC_METHOD_REGISTRATION_SERVICE,
  ) as { registerAll: () => void };
  rpcMethodRegistration.registerAll();

  // Initialize autocomplete discovery watchers (TASK_2025_019 Phase 2)
  // NOTE: MCP discovery service was planned but never implemented - only agent and command discovery exist
  const agentDiscovery = DIContainer.resolve(
    TOKENS.AGENT_DISCOVERY_SERVICE,
  ) as { initializeWatchers: () => void };
  const commandDiscovery = DIContainer.resolve(
    TOKENS.COMMAND_DISCOVERY_SERVICE,
  ) as { initializeWatchers: () => void };
  agentDiscovery.initializeWatchers();
  commandDiscovery.initializeWatchers();
  logger.info('Autocomplete discovery watchers initialized (2 services)');

  // Step 7: Initialize agent adapter (SDK-only, resolves via TOKENS.AGENT_ADAPTER)
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
