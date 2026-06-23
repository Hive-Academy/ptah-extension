import * as vscode from 'vscode';
import {
  type Logger,
  type LicenseService,
  type LicenseStatus,
  type RpcVerificationResult,
  TOKENS,
  SentryService,
  PREVIOUS_USER_CONTEXT_KEY,
} from '@ptah-extension/vscode-core';
import { fixPath } from '@ptah-extension/cli-agent-runtime';
import { registerVscodeSettings } from '@ptah-extension/platform-vscode';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import {
  SETTINGS_TOKENS,
  type MigrationRunner,
  type IActiveWorkspaceSource,
} from '@ptah-extension/settings-core';
import { DIContainer } from '../di/container';
import { handleLicenseBlocking } from './license-gate';

export interface BootstrapResult {
  logger: Logger;
  licenseStatus: LicenseStatus;
  authInitialized: boolean;
  /** True if license was invalid and blocking path was taken — caller should return. */
  blocked: boolean;
  /** RPC registration verification result — undefined when blocked. */
  rpcVerification?: RpcVerificationResult;
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
  fixPath();
  DIContainer.setupMinimal(context);
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
  // E2E-only license seed. VS Code runs extension-test instances with
  // in-memory storage, so the e2e runner cannot seed state.vscdb from
  // outside — the seed must happen here, before verifyLicense(). Gated on
  // ExtensionMode.Test (only set when VS Code is launched with
  // extensionTestsPath, which a regular install can never be) AND the
  // PTAH_E2E env flag set by the e2e runner. Seeding previousUserContext
  // makes verifyLicense() take the documented community path with zero
  // network calls, unblocking the full activation chain under test.
  if (
    context.extensionMode === vscode.ExtensionMode.Test &&
    process.env['PTAH_E2E'] === '1'
  ) {
    await context.globalState.update(PREVIOUS_USER_CONTEXT_KEY, {
      reason: 'expired',
      persistedAt: Date.now(),
      user: { email: 'e2e@ptah.local', firstName: null, lastName: null },
    });
  }
  const licenseService = DIContainer.resolve<LicenseService>(
    TOKENS.LICENSE_SERVICE,
  );
  const licenseStatus: LicenseStatus = await licenseService.verifyLicense();
  if (!licenseStatus.valid) {
    await handleLicenseBlocking(context, licenseService, licenseStatus);
    return {
      logger: DIContainer.resolve<Logger>(TOKENS.LOGGER),
      licenseStatus,
      authInitialized: false,
      blocked: true,
    };
  }
  DIContainer.setup(context);
  try {
    const diContainer = DIContainer.getContainer();
    const wsProvider = diContainer.resolve<IWorkspaceProvider>(
      PLATFORM_TOKENS.WORKSPACE_PROVIDER,
    );
    const activeWorkspaceSource: IActiveWorkspaceSource = {
      getActivePath: () => wsProvider.getWorkspaceRoot(),
      onDidChange: (cb) => wsProvider.onDidChangeWorkspaceFolders(cb),
    };
    diContainer.register(SETTINGS_TOKENS.ACTIVE_WORKSPACE_SOURCE, {
      useValue: activeWorkspaceSource,
    });
    registerVscodeSettings(diContainer, vscode, context);
    const migrationRunner = DIContainer.resolve<MigrationRunner>(
      SETTINGS_TOKENS.MIGRATION_RUNNER,
    );
    await migrationRunner.runMigrations();
    console.log('[Ptah VS Code] Settings registered and migrations applied');
  } catch (settingsError) {
    console.warn(
      '[Ptah VS Code] Settings registration / migration failed (non-fatal):',
      settingsError instanceof Error
        ? settingsError.message
        : String(settingsError),
    );
  }
  const logger = DIContainer.resolve<Logger>(TOKENS.LOGGER);
  logger.info('Activating Ptah extension (licensed user)...', {
    tier: licenseStatus.tier,
    valid: licenseStatus.valid,
  });
  const rpcMethodRegistration = DIContainer.resolve(
    TOKENS.RPC_METHOD_REGISTRATION_SERVICE,
  ) as { registerAll: () => RpcVerificationResult };
  const rpcVerification = rpcMethodRegistration.registerAll();
  const agentDiscovery = DIContainer.resolve(
    TOKENS.AGENT_DISCOVERY_SERVICE,
  ) as { initializeWatchers: () => void };
  const commandDiscovery = DIContainer.resolve(
    TOKENS.COMMAND_DISCOVERY_SERVICE,
  ) as { initializeWatchers: () => void };
  agentDiscovery.initializeWatchers();
  commandDiscovery.initializeWatchers();
  logger.info('Autocomplete discovery watchers initialized (2 services)');
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
    agentAdapter.preloadSdk().catch((err) => {
      logger.warn('SDK preload failed (will retry on first use)', {
        error: err instanceof Error ? err.message : String(err),
      });
    });
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
    rpcVerification,
  };
}
