import {
  createElectronCodexSessionState,
  createElectronCodexControls,
  createElectronCodexSessionLifecycle,
  createElectronCodexShutdownStore,
  createElectronCodexBindingHandle,
} from './codex-session-binding';
import { randomUUID } from 'node:crypto';
import { realpathSync, statSync } from 'node:fs';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type {
  IMcpCallerCredentials,
  IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import {
  codexSandboxModeSchema,
  DEFAULT_CODEX_SANDBOX_MODE,
  type SessionId,
} from '@ptah-extension/shared';
import {
  AUTH_PROVIDERS_TOKENS,
  CodexAccountUsageService,
  type PlanLimitLedgerService,
  type CodexHomeResolver,
} from '@ptah-extension/auth-providers';
import {
  CHAT_TOKENS,
  createCodexChatHostPorts,
  createCodexChatUserQuestions,
  createCodexRuntimeAdmission,
  createCodexChatEventCallbacks,
  createCodexSessionSettingsRecord,
  CodexSessionSettingsError,
  resolveSavedCodexPermissionLevel,
  type CodexChatHostPorts,
  type CodexChatHostPortsDeps,
  type CodexChatEventCallbacksDeps,
} from '@ptah-extension/rpc-handlers';
import type { DependencyContainer } from 'tsyringe';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
  SDK_TOKENS,
  type SdkPermissionHandler,
  createCodexThreadIdentityStore,
  createCodexChatMetadataPort,
  type SessionMetadataStore,
  type SessionMetadata,
  type NativeSessionHistoryPort,
  type CodexChatAdapterPorts,
  initializeSessionRuntimeIdentityLookup,
  resolveCodexNativeBinaryPath,
  type CodexChatScope,
  type RuntimeAdmissionPort,
} from '@ptah-extension/agent-sdk';
import {
  buildCodexExecutionProfile,
  normalizeCodexHomeKey,
  normalizeCodexWorkspaceKey,
  CODEX_RUNTIME_TOKENS,
  CodexAccountUsageClient,
  CodexSessionHistoryError,
  registerCodexRuntime,
  CodexSelectionSnapshot,
  createNodeCodexExecutableProbes,
  type ApprovalSink,
  type CodexSelectionSnapshotPort,
  type CodexRuntime,
  type CodexHistoryReader,
  type CodexSessionHistory,
  type CodexExecutionProfile,
  type CodexThreadIdentity,
  type CodexRuntimeRegistrationPorts,
} from '@ptah-extension/codex-runtime';

import type {
  ElectronCodexBinding,
  ElectronCodexBindingInput,
  ElectronCodexIdentityLookup,
  ElectronCodexRouting,
  ElectronCodexRoutingInput,
  ElectronCodexSessionControls,
  ElectronCodexSessionState,
  ElectronCodexSettingsRecord,
  ElectronCodexShutdownStore,
} from './codex-binding.types';

/** Native Codex is available to every Electron platform. */
export function createElectronCodexRouting(
  _input: ElectronCodexRoutingInput,
): ElectronCodexRouting {
  const capabilities = Object.freeze({
    nativeCodex: true,
    nativeCodexGateway: true,
  });
  return Object.freeze({ capabilities });
}

export interface ElectronCodexBundledRootInput {
  readonly isPackaged: boolean;
  readonly resourcesPath: string;
  readonly appPath: string;
}

/** Walk ancestors so both source launches and dist/apps/ptah-electron work. */
export function resolveElectronCodexBundledRoot(
  input: ElectronCodexBundledRootInput,
  isDirectory: (path: string) => boolean = (path) => {
    try {
      return statSync(path).isDirectory();
    } catch {
      // degradation-audit: optional-capability - a missing or unreadable candidate means "not a directory"; the walk tries the next ancestor
      return false;
    }
  },
): string {
  if (input.isPackaged)
    return join(input.resourcesPath, 'app.asar.unpacked', 'node_modules');
  let directory = resolve(input.appPath);
  while (true) {
    const candidate = join(directory, 'node_modules');
    if (isDirectory(candidate)) return candidate;
    const parent = dirname(directory);
    if (parent === directory)
      return join(resolve(input.appPath), 'node_modules');
    directory = parent;
  }
}

/** Resolve the host bundle only; installed candidates come from the shared probes. */
export function createElectronCodexBundledCandidate(
  bundledRoot: string,
): string | undefined {
  const detectedPath = resolveCodexNativeBinaryPath();
  if (!detectedPath) return undefined;
  if (!isAbsolute(bundledRoot))
    throw new Error('Codex executable is outside the host bundle');
  let resolvedPath: string;
  let local: string;
  try {
    resolvedPath = realpathSync(detectedPath);
    local = relative(realpathSync(bundledRoot), resolvedPath);
  } catch {
    // degradation-audit: reported - selector can use an installed candidate when the bundle is absent.
    return undefined;
  }
  // The shared resolver also probes global installations. They must not become
  // an Electron runtime fallback if the host's bundled package is absent.
  if (
    !local ||
    isAbsolute(local) ||
    local === '..' ||
    local.startsWith(`..${sep}`)
  ) {
    return undefined;
  }
  return resolvedPath;
}

export function createElectronCodexSelectionSnapshot(
  bundledRoot: string,
  logger: Logger,
): CodexSelectionSnapshotPort {
  const snapshot = new CodexSelectionSnapshot(
    createNodeCodexExecutableProbes(async () =>
      createElectronCodexBundledCandidate(bundledRoot),
    ),
  );
  let lastLoggedSelection: string | undefined;
  const logSelection = (
    selected: NonNullable<ReturnType<CodexSelectionSnapshotPort['current']>>,
  ) => {
    const key = JSON.stringify([
      selected.source,
      selected.version,
      selected.path,
    ]);
    const log =
      key === lastLoggedSelection
        ? logger.debug.bind(logger)
        : logger.info.bind(logger);
    lastLoggedSelection = key;
    log('Codex executable selected', {
      source: selected.source,
      version: selected.version,
      path: selected.path,
      reason: selected.reason,
    });
  };
  return {
    selectForOpen: async () => {
      const selection = await snapshot.selectForOpen();
      logSelection(selection.selected);
      return selection;
    },
    current: () => snapshot.current(),
    markUnsupported: (failed, method) =>
      snapshot.markUnsupported(failed, method),
    activateFallback: async (failed, method) => {
      const selected = await snapshot.activateFallback(failed, method);
      logSelection(selected);
      return selected;
    },
  };
}

type CodexRateLimitsUpdate = Parameters<
  CodexAccountUsageService['applyRateLimitsUpdated']
>[0];

export interface ElectronCodexScopeInput extends ElectronCodexRoutingInput {
  readonly parent: DependencyContainer;
  readonly ports: Omit<CodexRuntimeRegistrationPorts, 'sink'>;
  readonly sharedUsage?: { client: CodexAccountUsageClient | null };
  readonly usageNotifications?: {
    readonly onRateLimitsUpdated: (
      update: CodexRateLimitsUpdate,
    ) => Promise<void>;
    readonly onContextClosed: (contextId: string) => void;
    readonly onContextOpened?: (contextId: string) => void;
  };
}

/**
 * Per-session registration, never a runtime on the parent. The adapter calls
 * dispose on failed opens as well as normal closure. Usage owns explicit-home
 * auth watchers through CodexAccountUsageClient and releases them on close.
 */
export function createElectronCodexScopeFactory(
  input: ElectronCodexScopeInput,
  _consumer: 'chat' | 'lane' = 'chat',
) {
  return (sink: ApprovalSink): CodexChatScope => {
    // Reject before allocating a child: registration disallows inherited runtimes.
    if (input.parent.isRegistered(CODEX_RUNTIME_TOKENS.Runtime, true)) {
      throw new Error('Codex runtime must be owned by a session scope');
    }
    const container = input.parent.createChildContainer();
    try {
      registerCodexRuntime(container, {
        ...input.ports,
        usage: input.ports.usage
          ? { ...input.ports.usage, ...input.usageNotifications }
          : null,
        sink,
      });
      // Lifecycle ownership is the only allowed use of the raw token. Resolving
      // here starts no process and ensures failed opens retain a closeable owner.
      const runtime = container.resolve<CodexRuntime>(
        CODEX_RUNTIME_TOKENS.Runtime,
      );
      const usage = container.resolve<CodexAccountUsageClient | null>(
        CodexAccountUsageClient,
      );
      if (input.sharedUsage && usage && !input.sharedUsage.client) {
        input.parent
          .resolve<CodexAccountUsageService>(
            AUTH_PROVIDERS_TOKENS.SDK_CODEX_ACCOUNT_USAGE,
          )
          .attachCoreClient(usage);
        input.sharedUsage.client = usage;
      }
      let closing: Promise<void> | undefined;
      const close = async () => {
        try {
          await runtime.close();
        } finally {
          try {
            if (usage !== input.sharedUsage?.client) await usage?.close();
          } finally {
            await container.dispose();
          }
        }
      };
      return { container, dispose: () => (closing ??= close()) };
    } catch (error) {
      // The scope contract is synchronous; observe asynchronous cleanup failures.
      void Promise.resolve()
        .then(() => container.dispose())
        .catch((disposeError: unknown) => {
          // The runtime logger port takes flat metadata, not an Error object.
          input.ports.logger.error('Failed to dispose Codex child container', {
            errorName:
              disposeError instanceof Error ? disposeError.name : 'Error',
            errorMessage:
              disposeError instanceof Error
                ? disposeError.message
                : 'Codex cleanup failed',
          });
        });
      throw error;
    }
  };
}

interface BindingContext {
  readonly container: DependencyContainer;
  readonly input: ElectronCodexBindingInput;
  readonly logger: Logger;
  readonly metadataStore: SessionMetadataStore;
  readonly lookup: ElectronCodexIdentityLookup;
  readonly record: ElectronCodexSettingsRecord;
  readonly routing: ElectronCodexRouting;
  readonly store: ElectronCodexShutdownStore;
  readonly scopes: Set<CodexChatScope>;
  readonly state: ElectronCodexSessionState;
  disposed: boolean;
}

function createElectronCodexBindingContext(
  container: DependencyContainer,
  input: ElectronCodexBindingInput,
  logger: Logger,
  metadataStore: SessionMetadataStore,
  lookup: ElectronCodexIdentityLookup,
  record: ElectronCodexSettingsRecord,
): BindingContext {
  const routing = createElectronCodexRouting(input);
  return {
    container,
    input,
    logger,
    metadataStore,
    lookup,
    record,
    routing,
    store: createElectronCodexShutdownStore(
      createCodexThreadIdentityStore(lookup, metadataStore),
    ),
    scopes: new Set<CodexChatScope>(),
    disposed: false,
    state: createElectronCodexSessionState(container),
  };
}

interface HostDependencies {
  readonly deps: Pick<
    CodexChatHostPortsDeps,
    | 'resolver'
    | 'workspaceProvider'
    | 'platformInfo'
    | 'hostCapabilities'
    | 'webviewManager'
  >;
  readonly broadcaster: CodexChatHostPortsDeps['broadcaster'];
}

interface ScopePorts {
  createScope(sink: ApprovalSink): CodexChatScope;
  verifyBinary(): Promise<void>;
  closeSharedUsage(): Promise<void>;
}

function createElectronCodexHostDependencies(
  context: BindingContext,
): HostDependencies {
  const { container, routing } = context;
  const broadcaster: CodexChatHostPortsDeps['broadcaster'] = {
    streamEventsToWebview: (...args) =>
      container
        .resolve<CodexChatHostPortsDeps['broadcaster']>(
          CHAT_TOKENS.STREAM_BROADCASTER,
        )
        .streamEventsToWebview(...args),
  };
  const deps = {
    resolver: container.resolve<CodexChatHostPortsDeps['resolver']>(
      AUTH_PROVIDERS_TOKENS.SDK_WORKSPACE_PROVIDER_PROFILE_RESOLVER,
    ),
    workspaceProvider: container.resolve<
      CodexChatHostPortsDeps['workspaceProvider']
    >(PLATFORM_TOKENS.WORKSPACE_PROVIDER),
    platformInfo: container.resolve<CodexChatHostPortsDeps['platformInfo']>(
      PLATFORM_TOKENS.PLATFORM_INFO,
    ),
    hostCapabilities: routing.capabilities,
    webviewManager: container.resolve<CodexChatHostPortsDeps['webviewManager']>(
      TOKENS.WEBVIEW_MANAGER,
    ),
  };
  return { deps, broadcaster };
}

function createElectronCodexScopePorts(context: BindingContext): ScopePorts {
  const { container, input, logger, store, scopes } = context;
  const { profiles } = context.state;
  const sharedUsage: { client: CodexAccountUsageClient | null } = {
    client: null,
  };
  const usageService = () =>
    container.resolve<CodexAccountUsageService>(
      AUTH_PROVIDERS_TOKENS.SDK_CODEX_ACCOUNT_USAGE,
    );
  const verifyBinary = async () => {
    try {
      await input.selectionSnapshot.selectForOpen();
      if (context.disposed) throw new Error('Native Codex chat is disabled');
    } catch (error) {
      logger.error(
        'Codex executable verification failed',
        error instanceof Error ? error : new Error('Codex verification failed'),
      );
      throw new Error('Codex executable verification failed');
    }
  };
  const createScope = (sink: ApprovalSink): CodexChatScope => {
    if (context.disposed) throw new Error('Native Codex chat is disabled');
    const scope = createElectronCodexScopeFactory({
      ...input,
      parent: container,
      sharedUsage,
      usageNotifications: {
        onRateLimitsUpdated: async (update) => {
          const live = await usageService().applyRateLimitsUpdated(update);
          if (!live) return;
          const ledger = container.resolve<PlanLimitLedgerService>(
            AUTH_PROVIDERS_TOKENS.PLAN_LIMIT_LEDGER,
          );
          for (const window of live.windows)
            ledger.recordWindowEvidence(live.owner, window);
        },
        onContextClosed: (contextId) => {
          usageService().releaseRateLimitsContext(contextId);
        },
        onContextOpened: (contextId) => {
          usageService().openRateLimitsContext(contextId);
        },
      },
      ports: {
        selectionSnapshot: input.selectionSnapshot,
        store,
        requestUserInput: createCodexChatUserQuestions({
          permissionHandler: container.resolve<SdkPermissionHandler>(
            SDK_TOKENS.SDK_PERMISSION_HANDLER,
          ),
          tabId: context.state.tabId,
          logger,
        }),
        spawner: container.resolve<CodexRuntimeRegistrationPorts['spawner']>(
          SDK_TOKENS.SDK_PROCESS_SPAWNER,
        ),
        clock: {
          now: Date.now,
          setTimeout: (callback, delay) => {
            const timer = setTimeout(callback, delay);
            timer.unref();
            return { dispose: () => clearTimeout(timer) };
          },
        },
        logger: {
          debug: (message, metadata) => logger.debug(message, metadata),
          info: (message, metadata) => logger.info(message, metadata),
          warn: (message, metadata) => logger.warn(message, metadata),
          error: (message, metadata) => logger.error(message, metadata),
        },
        usage: {
          auth: container.resolve<
            NonNullable<CodexRuntimeRegistrationPorts['usage']>['auth']
          >(AUTH_PROVIDERS_TOKENS.SDK_CODEX_HOME_AUTH),
          profileForHome: (home) => {
            const prepared = [...profiles.values()].find(
              (entry) => entry.profile.normalizedHome === home,
            );
            if (!prepared)
              throw new Error('No live Codex session owns this usage home');
            const canonical = realpathSync(home);
            const cwd = realpathSync(prepared.profile.cwd);
            return buildCodexExecutionProfile({
              session: {
                contextId: randomUUID(),
                codexSandboxMode: codexSandboxModeSchema.parse(
                  container
                    .resolve<IWorkspaceProvider>(
                      PLATFORM_TOKENS.WORKSPACE_PROVIDER,
                    )
                    .getConfiguration(
                      'ptah',
                      'agentOrchestration.codexSandboxMode',
                      DEFAULT_CODEX_SANDBOX_MODE,
                    ),
                ),
                consumer: 'usage',
                normalizedHome: canonical,
                providerId: prepared.profile.providerId,
                workspaceId: prepared.profile.workspaceId,
                cwd,
                model: prepared.profile.model,
                permissionLevel: 'ask',
              },
              paths: {
                platform: process.platform === 'win32' ? 'win32' : 'posix',
                baseDirectory: canonical,
                entries: {
                  [canonical]: { kind: 'directory', realpath: canonical },
                  [cwd]: { kind: 'directory', realpath: cwd },
                },
              },
            });
          },
        },
      },
    })(sink);
    const owned: CodexChatScope = {
      container: scope.container,
      dispose: async () => {
        try {
          await scope.dispose();
        } finally {
          scopes.delete(owned);
        }
      },
    };
    scopes.add(owned);
    return owned;
  };
  const closeSharedUsage = async () => {
    const client = sharedUsage.client;
    if (!client) return;
    sharedUsage.client = null;
    usageService().detachCoreClient(client);
    await client.close();
  };
  return { createScope, verifyBinary, closeSharedUsage };
}

export type ElectronCodexHistoryErrorCode =
  | 'invalidIdentity'
  | 'homeMismatch'
  | 'binaryUnavailable'
  | 'threadNotFound'
  | 'timeout'
  | 'cancelled'
  | 'runtimeFailed'
  | 'pathUnavailable'
  | 'busy'
  | 'malformedPage';

/** Only fixed text crosses the RPC boundary. */
export class ElectronCodexHistoryError extends Error {
  constructor(readonly code: ElectronCodexHistoryErrorCode) {
    const messages: Record<ElectronCodexHistoryErrorCode, string> = {
      invalidIdentity: 'Saved Codex session identity is incomplete.',
      homeMismatch:
        'The saved Codex session belongs to a different Codex home.',
      binaryUnavailable: 'The Codex executable is unavailable.',
      threadNotFound: 'The saved Codex thread could not be found.',
      timeout: 'Reading Codex history timed out.',
      cancelled: 'Reading Codex history was cancelled.',
      runtimeFailed: 'Codex history could not be read.',
      pathUnavailable: 'The saved Codex home or workspace is unavailable.',
      busy: 'Too many Codex history reads are in progress.',
      malformedPage: 'Saved Codex history has an unsupported format.',
    };
    super(messages[code]);
    this.name = 'ElectronCodexHistoryError';
  }
}

export interface ElectronCodexHistoryDeps {
  readonly currentHome: () => string;
  readonly verifyBinary: () => Promise<void>;
  readonly createScope: (sink: ApprovalSink) => CodexChatScope;
  readonly resolveRuntime: (
    ...args: Parameters<NonNullable<CodexChatAdapterPorts['resolveRuntime']>>
  ) => Pick<CodexRuntime, 'open'> & Partial<CodexHistoryReader>;
  readonly liveProfiles: ElectronCodexSessionState['profiles'];
  readonly timeoutMs?: number;
  readonly logger: Pick<Logger, 'error'>;
}

type CodexHistoryTailBound = Parameters<
  CodexHistoryReader['readHistoryTail']
>[2];
type CodexHistoryTail = Awaited<
  ReturnType<CodexHistoryReader['readHistoryTail']>
>;

export interface ElectronCodexHistoryPort extends NativeSessionHistoryPort {
  readHistory(
    session: SessionMetadata,
    signal?: AbortSignal,
  ): Promise<CodexSessionHistory>;
  readHistoryTail(
    session: SessionMetadata,
    bound: CodexHistoryTailBound,
    signal?: AbortSignal,
  ): Promise<CodexHistoryTail>;
}

type ElectronCodexHistoryRuntime = ReturnType<
  ElectronCodexHistoryDeps['resolveRuntime']
>;

/** One runtime read; it throws `runtimeFailed` when the runtime lacks the method it needs. */
type ElectronCodexHistoryRead<T> = (
  runtime: ElectronCodexHistoryRuntime,
  profile: CodexExecutionProfile,
  resume: CodexThreadIdentity,
  signal: AbortSignal,
) => Promise<T>;

/** A history read owns a fresh scope, even after all chat scopes were lost on reload. */
export function createElectronCodexHistoryPort(
  deps: ElectronCodexHistoryDeps,
): ElectronCodexHistoryPort {
  // Shared by every read kind, so full and tail reads together stay at two.
  let activeReads = 0;
  const runHistoryRead = async <T>(
    session: SessionMetadata,
    signal: AbortSignal | undefined,
    read: ElectronCodexHistoryRead<T>,
  ): Promise<T> => {
    if (activeReads >= 2) throw new ElectronCodexHistoryError('busy');
    activeReads++;
    try {
      if (signal?.aborted) throw new ElectronCodexHistoryError('cancelled');
      const execution = session.codexExecution;
      if (
        !execution ||
        execution.runtime !== 'codex-app-server' ||
        execution.sessionId !== session.sessionId ||
        execution.providerId !== 'openai-codex'
      )
        throw new ElectronCodexHistoryError('invalidIdentity');
      const savedHome = normalizeCodexHomeKey(
        execution.codex.normalizedHome,
        process.platform,
      );
      const currentHome = normalizeCodexHomeKey(
        deps.currentHome(),
        process.platform,
      );
      if (savedHome !== currentHome)
        throw new ElectronCodexHistoryError('homeMismatch');
      const workspace = session.codexThread?.workspaceId ?? session.workspaceId;
      if (
        normalizeCodexWorkspaceKey(workspace, process.platform) !==
        execution.workspaceId
      )
        throw new ElectronCodexHistoryError('invalidIdentity');
      let homePath: string;
      let cwd: string;
      try {
        homePath = realpathSync(deps.currentHome());
        cwd = realpathSync(workspace);
      } catch {
        throw new ElectronCodexHistoryError('pathUnavailable');
      }
      const candidate = deps.liveProfiles.get(execution.sessionId)?.profile;
      const live =
        candidate?.normalizedHome === savedHome &&
        normalizeCodexWorkspaceKey(candidate.workspaceId, process.platform) ===
          execution.workspaceId
          ? candidate
          : undefined;
      // The read-only process also loads the unchanged config in CODEX_HOME.
      // When the live profile still exists, carry its explicit MCP references too.
      const profile = buildCodexExecutionProfile({
        session: {
          contextId: session.codexThread?.contextId ?? randomUUID(),
          codexSandboxMode:
            live?.codexSandboxMode ?? DEFAULT_CODEX_SANDBOX_MODE,
          consumer: 'chat',
          normalizedHome: savedHome,
          providerId: execution.providerId,
          workspaceId: workspace,
          cwd,
          model: live?.model ?? 'history-read',
          permissionLevel: live?.permissionLevel ?? 'ask',
          mcpServers:
            live?.mcpServers.map((server) =>
              server.transport === 'stdio'
                ? {
                    ...server,
                    args: [...server.args],
                    envReferences: { ...server.envReferences },
                  }
                : {
                    ...server,
                    headerReferences: { ...server.headerReferences },
                  },
            ) ?? [],
        },
        paths: {
          platform: process.platform === 'win32' ? 'win32' : 'posix',
          baseDirectory: cwd,
          entries: {
            [cwd]: { kind: 'directory', realpath: cwd },
            [savedHome]: { kind: 'directory', realpath: homePath },
          },
        },
      });
      const resume: CodexThreadIdentity = {
        threadId: execution.sessionId,
        contextId: profile.contextId,
        processGeneration: session.codexThread?.processGeneration ?? 1,
        normalizedHome: savedHome,
        workspaceId: workspace,
        providerId: execution.providerId,
        profileFingerprint:
          session.codexThread?.profileFingerprint ?? profile.profileFingerprint,
      };
      try {
        await deps.verifyBinary();
      } catch {
        throw new ElectronCodexHistoryError('binaryUnavailable');
      }
      if (signal?.aborted) throw new ElectronCodexHistoryError('cancelled');
      const scope = deps.createScope({ request: async () => 'decline' });
      const controller = new AbortController();
      let rejectCancellation: (error: ElectronCodexHistoryError) => void = () =>
        undefined;
      const cancelled = new Promise<never>((_resolve, reject) => {
        rejectCancellation = reject;
      });
      // A synchronous setup failure must not leave the cancellation promise unobserved.
      // degradation-audit: optional-capability — the race owns cancellation; this observer only prevents an unhandled rejection during setup.
      void cancelled.catch(() => undefined);
      const cancel = (code: 'cancelled' | 'timeout') => {
        rejectCancellation(new ElectronCodexHistoryError(code));
        controller.abort();
      };
      const onAbort = () => cancel('cancelled');
      signal?.addEventListener('abort', onAbort, { once: true });
      const timer = setTimeout(
        () => cancel('timeout'),
        deps.timeoutMs ?? 30_000,
      );
      timer.unref();
      try {
        if (signal?.aborted) throw new ElectronCodexHistoryError('cancelled');
        const runtime = deps.resolveRuntime(scope.container, 'chat');
        return await Promise.race([
          read(runtime, profile, resume, controller.signal),
          cancelled,
        ]);
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        controller.abort();
        try {
          await scope.dispose();
        } catch (error) {
          deps.logger.error(
            'Codex history scope disposal failed',
            error instanceof Error
              ? error
              : new Error('Codex history scope disposal failed'),
          );
        }
      }
    } catch (error) {
      if (error instanceof ElectronCodexHistoryError) throw error;
      if (error instanceof CodexSessionHistoryError) {
        if (error.code === 'threadNotFound')
          throw new ElectronCodexHistoryError('threadNotFound');
        if (error.code === 'homeMismatch')
          throw new ElectronCodexHistoryError('homeMismatch');
        // Keep the page defect separate: nativeHistoryRpcError maps this
        // code to HISTORY_MALFORMED instead of the generic HISTORY_FAILED.
        if (error.code === 'malformedPage')
          throw new ElectronCodexHistoryError('malformedPage');
        throw new ElectronCodexHistoryError('runtimeFailed');
      }
      throw new ElectronCodexHistoryError('runtimeFailed');
    } finally {
      activeReads--;
    }
  };
  return {
    readHistory: (session, signal) =>
      runHistoryRead(
        session,
        signal,
        (runtime, profile, resume, readSignal) => {
          if (typeof runtime.readHistory !== 'function')
            throw new ElectronCodexHistoryError('runtimeFailed');
          return runtime.readHistory(profile, resume, readSignal);
        },
      ),
    readHistoryTail: (session, bound, signal) =>
      runHistoryRead(
        session,
        signal,
        (runtime, profile, resume, readSignal) => {
          // A runtime built before tail reads existed still serves readHistory.
          if (typeof runtime.readHistoryTail !== 'function')
            throw new ElectronCodexHistoryError('runtimeFailed');
          return runtime.readHistoryTail(profile, resume, bound, readSignal);
        },
      ),
  };
}

export function createElectronCodexDriverGate(
  container: DependencyContainer,
): CodexChatAdapterPorts['driver'] {
  return {
    admit: (sessionId, admissionContext) =>
      container
        .resolve<{
          admitNative: CodexChatAdapterPorts['driver']['admit'];
        }>(CHAT_TOKENS.SESSION_DRIVER_LOCK_COORDINATOR)
        .admitNative(sessionId, admissionContext),
  };
}

function createElectronCodexAdapterPorts(
  context: BindingContext,
  host: HostDependencies,
  scope: ScopePorts,
  sessions: NonNullable<CodexChatAdapterPorts['sessions']>,
): CodexChatHostPorts & Pick<CodexChatAdapterPorts, 'driver'> {
  const { container, input, logger, metadataStore, store, lookup } = context;
  const { tabId, preparedTabs } = context.state;
  const { deps, broadcaster } = host;
  const { createScope, verifyBinary } = scope;
  const ports = createCodexChatHostPorts({
    ...deps,
    readSavedPermissionLevel: (workspacePath) =>
      resolveSavedCodexPermissionLevel(
        (name) => input.scopeResolver.readForPath(name, workspacePath, true),
        () => {
          throw new CodexSessionSettingsError('invalid-settings');
        },
      ),
    logger,
    createScope,
    broadcaster,
    tabId,
    mcpCredentials: container.isRegistered(
      PLATFORM_TOKENS.MCP_CALLER_CREDENTIALS,
      true,
    )
      ? container.resolve<IMcpCallerCredentials>(
          PLATFORM_TOKENS.MCP_CALLER_CREDENTIALS,
        )
      : undefined,
    info: {
      id: 'codex-app-server',
      name: 'Codex App Server',
      vendor: 'OpenAI',
      version: '1',
      description: 'Native Codex chat runtime',
      capabilities: {
        streaming: true,
        fileAttachments: true,
        contextManagement: true,
        sessionPersistence: true,
        multiTurn: true,
        codeGeneration: true,
        imageAnalysis: true,
        functionCalling: true,
      },
    },
    // The shared port keeps the native title and counts completed turns (8m-8).
    metadata: createCodexChatMetadataPort(lookup, metadataStore),
    approvals: {
      register: (...args) =>
        container
          .resolve<CodexChatAdapterPorts['approvals']>(
            SDK_TOKENS.SESSION_APPROVAL_ROUTER,
          )
          .register(...args),
      respond: (...args) =>
        container
          .resolve<CodexChatAdapterPorts['approvals']>(
            SDK_TOKENS.SESSION_APPROVAL_ROUTER,
          )
          .respond(...args),
      cancelPrompt: (...args) =>
        container
          .resolve<CodexChatAdapterPorts['approvals']>(
            SDK_TOKENS.SESSION_APPROVAL_ROUTER,
          )
          .cancelPrompt(...args),
    },
    promptLifecycle: {
      publish: (event) =>
        container
          .resolve<SdkPermissionHandler>(SDK_TOKENS.SDK_PERMISSION_HANDLER)
          .publishPromptLifecycle(event),
    },
    hostAttention: container.resolve<CodexChatHostPortsDeps['hostAttention']>(
      SDK_TOKENS.HOST_ATTENTION_COORDINATOR,
    ),
    readResumeIdentity: async (id) => {
      const row = await metadataStore.get(id);
      return row?.codexThread
        ? store.read(row.codexThread.contextId)
        : undefined;
    },
    callbacks: (id, turn) =>
      createCodexChatEventCallbacks({
        sessionId: id,
        tabId: tabId(id),
        turn,
        logger,
        webviewManager: deps.webviewManager,
        delivery: container.resolve<CodexChatEventCallbacksDeps['delivery']>(
          CHAT_TOKENS.STREAM_DELIVERY_COORDINATOR,
        ),
      }),
  });
  return {
    ...ports,
    resolveRuntime: (scope, _consumer) => {
      return scope.resolve<CodexRuntime>(CODEX_RUNTIME_TOKENS.Runtime);
    },
    profile: async (...args: Parameters<CodexChatAdapterPorts['profile']>) => {
      const prepared = await ports.profile(...args);
      const tab = args[0].tabId;
      if (tab) preparedTabs.set(prepared, tab);
      return prepared;
    },
    sessions: {
      opened: (id, prepared) => sessions.opened(id, prepared),
      closed: (id) => {
        const routingId = tabId(id);
        try {
          const credentials = container.isRegistered(
            PLATFORM_TOKENS.MCP_CALLER_CREDENTIALS,
            true,
          )
            ? container.resolve<IMcpCallerCredentials>(
                PLATFORM_TOKENS.MCP_CALLER_CREDENTIALS,
              )
            : undefined;
          credentials?.revokeSubject(id);
          if (routingId !== id) credentials?.revokeSubject(routingId);
        } finally {
          sessions.closed(id);
        }
      },
    },
    driver: createElectronCodexDriverGate(container),
  };
}

function registerElectronCodexBinding(
  context: BindingContext,
  adapterPorts: CodexChatHostPorts,
  admission: RuntimeAdmissionPort,
  sessionControls: ElectronCodexSessionControls,
  historyPort: NativeSessionHistoryPort,
) {
  const { container, lookup, routing } = context;
  const { controls, legacyPorts } = sessionControls;
  container.register(SDK_TOKENS.SESSION_RUNTIME_IDENTITY_LOOKUP, {
    useValue: lookup,
  });
  container.register<CodexChatHostPorts>(SDK_TOKENS.CODEX_CHAT_ADAPTER_PORTS, {
    useValue: adapterPorts,
  });
  container.register<(sessionId: string) => string | undefined>(
    CHAT_TOKENS.CODEX_SESSION_OWNER,
    {
      useValue: (sessionId) => context.state.tabs.get(sessionId as SessionId),
    },
  );
  container.register(SDK_TOKENS.RUNTIME_ADMISSION_PORT, {
    useValue: admission,
  });
  container.register(SDK_TOKENS.RUNTIME_HOST_CAPABILITIES, {
    useValue: routing.capabilities,
  });
  container.register(SDK_TOKENS.NATIVE_SESSION_CONTROLS, {
    useValue: controls,
  });
  container.register(SDK_TOKENS.LEGACY_SESSION_CONTROL_PORTS, {
    useValue: legacyPorts,
  });
  container.register(SDK_TOKENS.NATIVE_SESSION_HISTORY_PORT, {
    useValue: historyPort,
  });
}

/** Bind the whole guarded surface before resolving either adapter. */
export async function bindElectronCodexChat(
  container: DependencyContainer,
  input: ElectronCodexBindingInput,
): Promise<ElectronCodexBinding> {
  const logger = container.resolve<Logger>(TOKENS.LOGGER);
  const metadataStore = container.resolve<SessionMetadataStore>(
    SDK_TOKENS.SDK_SESSION_METADATA_STORE,
  );
  const lookup = await initializeSessionRuntimeIdentityLookup(
    metadataStore,
    logger,
  );
  let record: ElectronCodexSettingsRecord | undefined;
  let binding: ElectronCodexBinding | undefined;
  try {
    record = createCodexSessionSettingsRecord({
      identities: lookup,
      scopeResolver: input.scopeResolver,
    });
    const context = createElectronCodexBindingContext(
      container,
      input,
      logger,
      metadataStore,
      lookup,
      record,
    );
    const host = createElectronCodexHostDependencies(context);
    const scope = createElectronCodexScopePorts(context);
    const sessionControls = createElectronCodexControls(
      container,
      input,
      context.state,
      record,
      lookup,
      host.broadcaster,
    );
    const lifecycle = createElectronCodexSessionLifecycle(
      record,
      context.state,
      lookup,
      sessionControls.controls,
    );
    const adapterPorts = createElectronCodexAdapterPorts(
      context,
      host,
      scope,
      lifecycle,
    );
    const admission = createCodexRuntimeAdmission(host.deps);
    const baseBinding = createElectronCodexBindingHandle(context);
    binding = {
      ...baseBinding,
      dispose: async () => {
        try {
          await baseBinding.dispose();
        } finally {
          await scope.closeSharedUsage();
        }
      },
    };
    const historyPort = createElectronCodexHistoryPort({
      currentHome: () =>
        container.resolve<CodexHomeResolver>(
          AUTH_PROVIDERS_TOKENS.SDK_CODEX_HOME_RESOLVER,
        ).path,
      verifyBinary: scope.verifyBinary,
      createScope: scope.createScope,
      resolveRuntime: (child, consumer) => {
        if (!adapterPorts.resolveRuntime)
          throw new ElectronCodexHistoryError('runtimeFailed');
        return adapterPorts.resolveRuntime(child, consumer);
      },
      liveProfiles: context.state.profiles,
      logger,
    });
    registerElectronCodexBinding(
      context,
      adapterPorts,
      admission,
      sessionControls,
      historyPort,
    );
    return binding;
  } catch (error) {
    if (binding) {
      await binding.dispose();
    } else {
      try {
        record?.dispose();
      } finally {
        lookup.dispose();
      }
    }
    throw error;
  }
}
