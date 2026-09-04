import * as vscode from 'vscode';
import {
  type Logger,
  type LicenseService,
  type LicenseStatus,
  type RpcVerificationResult,
  type DiagnosticsHandle,
  TOKENS,
  SentryService,
  PREVIOUS_USER_CONTEXT_KEY,
  armDiagnostics,
} from '@ptah-extension/vscode-core';
import { fixPath } from '@ptah-extension/cli-agent-runtime';
import { registerVscodeSettings } from '@ptah-extension/platform-vscode';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import {
  SETTINGS_TOKENS,
  type CustomProviderStore,
  type MigrationRunner,
  type IActiveWorkspaceSource,
} from '@ptah-extension/settings-core';
import { registerRpcSurface } from '@ptah-extension/rpc-handlers';
import type { CommandManager } from '@ptah-extension/vscode-core';
import { DIContainer } from '../di/container';
import { registerSetupAgentsCommand } from '../commands/setup-agents-command';
import { registerCaptureCpuProfileCommand } from '../commands/capture-cpu-profile-command';
import { createVscodeRpcHostProfile } from '../rpc-host-profile';

export interface BootstrapResult {
  logger: Logger;
  licenseStatus: LicenseStatus;
  authInitialized: boolean;
  /** RPC registration verification result. */
  rpcVerification?: RpcVerificationResult;
  /** Event-loop monitor + CPU profile capture; disposed in `deactivate()`. */
  diagnostics: DiagnosticsHandle;
}

/**
 * Bootstraps the VS Code extension: minimal DI, Sentry initialization,
 * membership status resolution (non-blocking), full DI setup, RPC method
 * registration, autocomplete discovery watchers, and fire-and-forget agent
 * adapter initialization + SDK preload. Activation always proceeds — Ptah's
 * local features are available to everyone regardless of membership state.
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
    // Publish user-defined providers to the shared registry cache BEFORE
    // anything resolves a provider by id — until this runs,
    // getAnthropicProvider() knows only the built-ins.
    const customProviders = DIContainer.resolve<CustomProviderStore>(
      SETTINGS_TOKENS.CUSTOM_PROVIDER_STORE,
    );
    const { entries, dropped } = customProviders.load();
    if (dropped.length > 0) {
      console.warn(
        `[Ptah VS Code] Dropped ${dropped.length} malformed custom provider entr${
          dropped.length === 1 ? 'y' : 'ies'
        }`,
      );
    }
    console.log(
      `[Ptah VS Code] Settings registered and migrations applied (${entries.length} custom providers)`,
    );
  } catch (settingsError) {
    console.warn(
      '[Ptah VS Code] Settings registration / migration failed (non-fatal):',
      settingsError instanceof Error
        ? settingsError.message
        : String(settingsError),
    );
  }
  const logger = DIContainer.resolve<Logger>(TOKENS.LOGGER);
  logger.info('Activating Ptah extension...', {
    tier: licenseStatus.tier,
    valid: licenseStatus.valid,
  });
  const rootContainer = DIContainer.getContainer();

  // Armed as early as the logger allows. The extension host is shared with
  // every other extension in the window, so a block here is not only Ptah's
  // problem — and `wireRuntimeVscode` / `registerPostInit` still lie ahead.
  // `context.logUri` is the directory VS Code already reserves for this
  // extension's logs, which is where a user asked for a profile would look.
  const diagnostics = armDiagnostics({
    container: rootContainer,
    logsPath: context.logUri.fsPath,
  });

  const commandManager = DIContainer.resolve<CommandManager>(
    TOKENS.COMMAND_MANAGER,
  );
  registerSetupAgentsCommand(rootContainer, commandManager, logger);
  registerCaptureCpuProfileCommand(commandManager, diagnostics, logger);
  const rpcVerification = registerRpcSurface(
    rootContainer,
    createVscodeRpcHostProfile(logger),
  );
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
  }

  return {
    logger,
    licenseStatus,
    authInitialized,
    rpcVerification,
    diagnostics,
  };
}
