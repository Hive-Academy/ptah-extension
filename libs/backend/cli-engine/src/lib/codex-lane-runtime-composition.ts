import { randomUUID } from 'node:crypto';
import { realpathSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import type { DependencyContainer } from 'tsyringe';
import {
  createCodexThreadIdentityStore,
  resolveCodexNativeBinaryPath,
  SDK_TOKENS,
  type SessionMetadataStore,
} from '@ptah-extension/agent-sdk';
import {
  CLI_AGENT_RUNTIME_TOKENS,
  CodexAppServerLaneAdapter,
  CodexLaneWriteDacPreflight,
  type CodexAdapterFactory,
  type CodexLaneBinaryProbe,
  type CodexLaneIdentityStore,
  type CodexLaneProfileResolver,
  type CodexLaneRuntimeProvider,
} from '@ptah-extension/cli-agent-runtime';
import {
  CODEX_RUNTIME_TOKENS,
  CodexAccountUsageClient,
  CodexSelectionSnapshot,
  createNodeCodexExecutableProbes,
  CodexRuntime,
  buildCodexExecutionProfile,
  registerCodexRuntime,
  type ApprovalSink,
  type CodexContext,
  type CodexExecutionProfile,
  type CodexExecutionProfileInput,
  type CodexMcpSecrets,
  type CodexSelection,
  type CodexSelectionSnapshotPort,
  type CodexRuntimeRegistrationPorts,
  type CodexThreadIdentity,
} from '@ptah-extension/codex-runtime';
import type { Logger } from '@ptah-extension/vscode-core';
import {
  PLATFORM_TOKENS,
  type IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import {
  codexSandboxModeSchema,
  DEFAULT_CODEX_SANDBOX_MODE,
} from '@ptah-extension/shared';

export interface CliCodexLaneInput {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly platform: { readonly platform: string; readonly arch: string };
}

function canonical(path: string): string {
  if (!isAbsolute(path) || path.includes('\0'))
    throw new Error('Invalid Codex lane path');
  try {
    return realpathSync(path);
  } catch {
    // degradation-audit: optional-capability - a missing home is valid before login; retain its absolute path
    return resolve(path);
  }
}

function pathEntry(
  path: string,
): { kind: 'directory'; realpath: string } | { kind: 'missing' } {
  try {
    const realpath = realpathSync(path);
    return statSync(realpath).isDirectory()
      ? { kind: 'directory', realpath }
      : { kind: 'missing' };
  } catch {
    // degradation-audit: optional-capability - profile validation handles the explicit missing path
    return { kind: 'missing' };
  }
}

function paths(home: string, cwd: string): CodexExecutionProfileInput['paths'] {
  return {
    platform: process.platform === 'win32' ? 'win32' : 'posix',
    baseDirectory: cwd,
    entries: { [home]: pathEntry(home), [cwd]: pathEntry(cwd) },
  };
}

function ownedContext(
  context: CodexContext,
  dispose: () => Promise<void>,
): CodexContext {
  let closing: Promise<void> | undefined;
  return {
    get identity() {
      return context.identity;
    },
    get turnPermissionLevel() {
      return context.turnPermissionLevel;
    },
    listModels: () => context.listModels(),
    events: (signal) => context.events(signal),
    startTurn: (input) => context.startTurn(input),
    steer: (input) => context.steer(input),
    interrupt: (turnId) => context.interrupt(turnId),
    updateNextTurn: (patch) => context.updateNextTurn(patch),
    compact: () => context.compact(),
    close: () => (closing ??= dispose()),
  };
}

/** The CLI and TUI share this lane routing boundary. */
export function resolveCliCodexLaneRuntime(
  scope: DependencyContainer,
  _platform: { readonly platform: string; readonly arch: string },
): CodexRuntime {
  return scope.resolve<CodexRuntime>(CODEX_RUNTIME_TOKENS.Runtime);
}

/** Bind before CliDetectionService can be resolved; create() performs no I/O. */
export function registerCliCodexLaneFactory(
  container: DependencyContainer,
  logger: Logger,
  input: CliCodexLaneInput = { env: process.env, platform: process },
): void {
  if (!container.isRegistered(CODEX_RUNTIME_TOKENS.SelectionSnapshot, true)) {
    const snapshot = new CodexSelectionSnapshot(
      createNodeCodexExecutableProbes(async () =>
        resolveCodexNativeBinaryPath(),
      ),
    );
    container.register(CODEX_RUNTIME_TOKENS.SelectionSnapshot, {
      useValue: snapshot,
    });
  }
  const selectionSnapshot = (): CodexSelectionSnapshotPort =>
    container.resolve<CodexSelectionSnapshotPort>(
      CODEX_RUNTIME_TOKENS.SelectionSnapshot,
    );

  let metadata: SessionMetadataStore | undefined;
  const getMetadata = (): SessionMetadataStore =>
    (metadata ??= container.resolve<SessionMetadataStore>(
      SDK_TOKENS.SDK_SESSION_METADATA_STORE,
    ));
  let store: ReturnType<typeof createCodexThreadIdentityStore> | undefined;
  const getStore = (): ReturnType<typeof createCodexThreadIdentityStore> =>
    (store ??= createCodexThreadIdentityStore(
      getMetadata(),
      getMetadata(),
      'lane',
    ));
  const home = async (): Promise<string> => {
    if (
      input.env['CODEX_HOME'] === '' ||
      (input.env['CODEX_HOME'] === undefined &&
        input.env['HOME'] === '' &&
        !input.env['USERPROFILE'])
    )
      throw new Error('Codex home is empty');
    return canonical(
      input.env['CODEX_HOME'] ??
        join(
          input.env['HOME'] || input.env['USERPROFILE'] || homedir(),
          '.codex',
        ),
    );
  };
  const identities: CodexLaneIdentityStore = {
    persist: (identity) => getStore().persist(identity),
    readByThreadId: async (threadId) => {
      const row = await getMetadata().get(threadId);
      if (row?.codexThread?.consumer !== 'lane') return undefined;
      const identity = await getStore().read(row.codexThread.contextId);
      return identity?.threadId === threadId ? identity : undefined;
    },
  };
  const profiles: CodexLaneProfileResolver = {
    resolve: async (options, variant) => {
      const selectedHome = await home();
      const cwd = canonical(options.workingDirectory);
      const prior = options.resumeSessionId
        ? await identities.readByThreadId(options.resumeSessionId)
        : undefined;
      const budgets = options.laneBudgets ?? {
        autoCompactTokens: 120000,
        toolOutputTokenLimit: 2500,
        webSearch: true,
      };
      return {
        lane: {
          codexSandboxMode: codexSandboxModeSchema.parse(
            container
              .resolve<IWorkspaceProvider>(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
              .getConfiguration(
                'ptah',
                'agentOrchestration.codexSandboxMode',
                DEFAULT_CODEX_SANDBOX_MODE,
              ),
          ),
          permissionLevel: 'ask',
          identity: {
            contextId: prior?.contextId ?? randomUUID(),
            normalizedHome: selectedHome,
            providerId: 'codex',
            workspaceId: cwd,
            ...(options.model ? { model: options.model } : {}),
          },
          config: {
            variant,
            workingDirectory: cwd,
            autoCompactTokens: budgets.autoCompactTokens,
            toolOutputTokenLimit: budgets.toolOutputTokenLimit,
            webSearch: budgets.webSearch,
            userMcpServerNames: [],
          },
        },
        paths: paths(selectedHome, cwd),
      };
    },
  };
  const binary: CodexLaneBinaryProbe = {
    resolve: async (explicitPath) => {
      const selection = await selectionSnapshot().selectForOpen();
      const selected = selection.selected;
      if (explicitPath && canonical(explicitPath) !== selected.path)
        throw new Error(
          'Codex executable does not match the selected executable',
        );
      return { ...selected, selection };
    },
  };
  const runtime: CodexLaneRuntimeProvider = {
    open: async (
      profile,
      resume,
      approvals,
      binaryPath,
      selection,
      secrets,
    ) => {
      if (profile.consumer !== 'lane')
        throw new Error('Codex lane consumer required');
      return open(profile, resume, approvals, binaryPath, selection, secrets);
    },
    openCatalog: async (binaryPath, selectedHome, selection) => {
      const accountHome = selectedHome ?? (await home());
      const cwd = canonical(tmpdir());
      const profile = buildCodexExecutionProfile({
        session: {
          codexSandboxMode: codexSandboxModeSchema.parse(
            container
              .resolve<IWorkspaceProvider>(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
              .getConfiguration(
                'ptah',
                'agentOrchestration.codexSandboxMode',
                DEFAULT_CODEX_SANDBOX_MODE,
              ),
          ),
          contextId: randomUUID(),
          consumer: 'lane',
          normalizedHome: accountHome,
          providerId: 'codex',
          workspaceId: cwd,
          cwd,
          model: undefined,
          permissionLevel: 'ask',
          lane: { suppressedTools: [], explicitFullAccess: false },
        },
        paths: paths(accountHome, cwd),
      });
      const decline: ApprovalSink = { request: async () => 'decline' };
      return open(profile, undefined, decline, binaryPath, selection);
    },
    openFallback: async (
      profile,
      resume,
      approvals,
      binaryPath,
      method,
      selection,
      secrets,
    ) => {
      const snapshot = selectionSnapshot();
      const failed = selection?.selected;
      if (
        !failed ||
        failed.path !== binaryPath ||
        failed.source !== 'installed'
      )
        throw new Error('Codex installed executable is not active');
      const fallback = await snapshot.activateFallback(failed, method);
      const selectedFallback: CodexSelectionSnapshotPort = {
        selectForOpen: async () => ({ selected: fallback }),
        current: () => fallback,
        markUnsupported: (failed, method) =>
          snapshot.markUnsupported(failed, method),
        activateFallback: (selected, missingMethod) =>
          snapshot.activateFallback(selected, missingMethod),
      };
      return open(
        profile,
        resume,
        approvals,
        fallback.path,
        { selected: fallback },
        secrets,
        selectedFallback,
      );
    },
  };
  async function open(
    profile: CodexExecutionProfile,
    resume: CodexThreadIdentity | undefined,
    approvals: ApprovalSink,
    binaryPath: string,
    selection: CodexSelection | undefined,
    secrets: CodexMcpSecrets = new Map(),
    runtimeSnapshot: CodexSelectionSnapshotPort = selectionSnapshot(),
  ): Promise<CodexContext> {
    const openedSelection =
      selection ?? (await runtimeSnapshot.selectForOpen());
    if (openedSelection.selected.path !== binaryPath)
      throw new Error(
        'Codex executable does not match the selected executable',
      );
    const boundSnapshot: CodexSelectionSnapshotPort = {
      selectForOpen: async () => openedSelection,
      current: () => openedSelection.selected,
      markUnsupported: (failed, method) =>
        runtimeSnapshot.markUnsupported(failed, method),
      activateFallback: (failed, method) =>
        runtimeSnapshot.activateFallback(failed, method),
    };
    if (container.isRegistered(CODEX_RUNTIME_TOKENS.Runtime, true))
      throw new Error('Codex runtime must be owned by a lane scope');
    const scope = container.createChildContainer();
    let registered = false;
    let disposed: Promise<void> | undefined;
    const dispose = (): Promise<void> =>
      (disposed ??= (async () => {
        try {
          if (registered)
            await scope
              .resolve<CodexRuntime>(CODEX_RUNTIME_TOKENS.Runtime)
              .close();
        } finally {
          try {
            if (registered)
              await scope
                .resolve<CodexAccountUsageClient | null>(
                  CodexAccountUsageClient,
                )
                ?.close();
          } finally {
            await scope.dispose();
          }
        }
      })());
    try {
      const ports: CodexRuntimeRegistrationPorts = {
        selectionSnapshot: boundSnapshot,
        store: getStore(),
        spawner: container.resolve<CodexRuntimeRegistrationPorts['spawner']>(
          SDK_TOKENS.SDK_PROCESS_SPAWNER,
        ),
        clock: {
          now: Date.now,
          setTimeout: (callback, delay) => {
            const timer = setTimeout(callback, delay);
            return { dispose: () => clearTimeout(timer) };
          },
        },
        logger: {
          debug: (message, data) => logger.debug(message, data),
          info: (message, data) => logger.info(message, data),
          warn: (message, data) => logger.warn(message, data),
          error: (message, data) => logger.error(message, data),
        },
        sink: approvals,
        requestUserInput: async (request, signal) => {
          await approvals.request({ ...request, toolName: undefined }, signal);
          return {};
        },
        usage: null,
      };
      registerCodexRuntime(scope, ports);
      registered = true;
      const context = await resolveCliCodexLaneRuntime(
        scope,
        input.platform,
      ).open(profile, resume, secrets);
      return ownedContext(context, dispose);
    } catch (error) {
      try {
        await dispose();
      } catch (disposeError) {
        // degradation-audit: reported - preserve the original open failure after logging cleanup failure
        logger.error(
          'Failed to dispose Codex lane scope',
          disposeError instanceof Error
            ? disposeError
            : new Error(String(disposeError)),
        );
      }
      throw error;
    }
  }
  const writers = CodexAppServerLaneAdapter.createWriterRegistry();
  // One preflight per host, so its WRITE_DAC cache outlives each per-spawn adapter.
  const writeDac = new CodexLaneWriteDacPreflight(logger);
  const factory: CodexAdapterFactory = {
    create: () =>
      new CodexAppServerLaneAdapter(
        runtime,
        profiles,
        identities,
        logger,
        binary,
        undefined,
        home,
        writers,
        writeDac,
      ),
  };
  container.register(CLI_AGENT_RUNTIME_TOKENS.CODEX_ADAPTER_FACTORY, {
    useValue: factory,
  });
}
