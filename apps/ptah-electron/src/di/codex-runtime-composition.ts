import { createHash, randomUUID } from 'node:crypto';
import { trackElectronCodexBinding } from './codex-binding-registry';
import { createReadStream, realpathSync, statSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import {
  AUTH_PROVIDERS_TOKENS,
  type AuthManager,
} from '@ptah-extension/auth-providers';
import type { IAgentAdapter, SessionId } from '@ptah-extension/shared';
import {
  CHAT_TOKENS,
  createCodexChatHostPorts,
  createCodexRuntimeAdmission,
  createCodexChatEventCallbacks,
  createCodexSessionSettingsRecord,
  createLegacyCodexSessionSettings,
  type LegacyCodexSessionSettingsDeps,
  createNativeSessionControls,
  createLegacySessionControlPorts,
  type CodexChatHostPortsDeps,
  type CodexChatEventCallbacksDeps,
  type NativeSessionControlsDeps,
  type LegacySessionControlPortsDeps,
} from '@ptah-extension/rpc-handlers';
import type { DependencyContainer } from 'tsyringe';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
  SDK_TOKENS,
  createCodexThreadIdentityStore,
  type SessionMetadataStore,
  type SessionLifecycleManager,
  type CodexChatAdapterPorts,
  initializeSessionRuntimeIdentityLookup,
  resolveCodexNativeBinaryPath,
  type CodexChatScope,
} from '@ptah-extension/agent-sdk';
import {
  buildCodexExecutionProfile,
  findCodexExecutablePin,
  CODEX_RUNTIME_TOKENS,
  CodexAccountUsageClient,
  CodexParityGate,
  readCodexDevRouteOverride,
  registerCodexRuntime,
  type ApprovalSink,
  type CodexExecutableManifestRow,
  type CodexParityPlatform,
  type CodexRuntime,
  type CodexRuntimeRegistrationPorts,
} from '@ptah-extension/codex-runtime';

export interface ElectronCodexRoutingInput {
  readonly isPackaged: boolean;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly platform: CodexParityPlatform;
}

/** A capability hint only; opening a chat still uses resolveGatedCodexRuntime. */
export function createElectronCodexRouting(input: ElectronCodexRoutingInput) {
  const devRoute = readCodexDevRouteOverride({
    isPackaged: input.isPackaged,
    env: input.env,
  });
  const capabilities = Object.freeze({
    nativeCodex:
      new CodexParityGate().isEnabled('chat', input.platform) ||
      devRoute?.consumer === 'chat',
  });
  return Object.freeze({ devRoute, capabilities });
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
      throw new Error('Bundled Codex package root unavailable');
    directory = parent;
  }
}

/** No detected CLI fallback: Electron must spawn the bundled native executable. */
export function createElectronCodexExecutable(
  expectedManifestRow: CodexExecutableManifestRow,
  bundledRoot: string,
) {
  const detectedPath = resolveCodexNativeBinaryPath();
  if (!detectedPath) throw new Error('Bundled Codex executable unavailable');
  if (!isAbsolute(bundledRoot))
    throw new Error('Codex executable is outside the host bundle');
  const resolvedPath = realpathSync(detectedPath);
  const local = relative(realpathSync(bundledRoot), resolvedPath);
  // The shared resolver also probes global installations. They must not become
  // an Electron runtime fallback if the host's bundled package is absent.
  if (
    !local ||
    isAbsolute(local) ||
    local === '..' ||
    local.startsWith(`..${sep}`)
  ) {
    throw new Error('Codex executable is outside the host bundle');
  }
  return Object.freeze({ resolvedPath, expectedManifestRow });
}

const executeFile = promisify(execFile);
type VerifiedCodexBinary = Pick<
  CodexRuntimeRegistrationPorts['binary'],
  'executablePath' | 'sha256' | 'versionOutput'
>;
const binaryInspections = new Map<string, Promise<VerifiedCodexBinary>>();

/** Share concurrent opens and retain failures until the executable changes. */
export async function inspectElectronCodexBinary(
  executablePath: string,
  readVersion: (path: string) => Promise<string> = readCodexVersion,
): Promise<VerifiedCodexBinary> {
  const { size, mtimeMs } = await stat(executablePath);
  const key = JSON.stringify([executablePath, size, mtimeMs]);
  let pending = binaryInspections.get(key);
  if (!pending) {
    pending = (async () => {
      const hash = createHash('sha256');
      hash.setEncoding('hex');
      let sha256 = '';
      await pipeline(createReadStream(executablePath), hash, async (chunks) => {
        for await (const chunk of chunks) {
          const value: unknown = chunk;
          if (typeof value !== 'string')
            throw new Error('Codex executable digest unavailable');
          sha256 += value;
        }
      });
      const versionOutput = await readVersion(executablePath);
      return { executablePath, sha256, versionOutput };
    })();
    binaryInspections.set(key, pending);
  }
  return pending;
}

async function readCodexVersion(executablePath: string): Promise<string> {
  const { stdout } = await executeFile(executablePath, ['--version'], {
    encoding: 'utf8',
    timeout: 10000,
    windowsHide: true,
  });
  return stdout.trim();
}

export interface ElectronCodexScopeInput extends ElectronCodexRoutingInput {
  readonly parent: DependencyContainer;
  readonly ports: Omit<
    CodexRuntimeRegistrationPorts,
    'sink' | 'executable' | 'devRoute'
  >;
  readonly expectedManifestRow: CodexExecutableManifestRow;
  /** Absolute host-owned node_modules root (app.asar.unpacked when packaged). */
  readonly bundledRoot: string;
}

/**
 * Per-session registration, never a runtime on the parent. The adapter calls
 * dispose on failed opens as well as normal closure. Usage owns explicit-home
 * auth watchers through CodexAccountUsageClient and releases them on close.
 */
export function createElectronCodexScopeFactory(
  input: ElectronCodexScopeInput,
) {
  const routing = createElectronCodexRouting(input);
  return (sink: ApprovalSink): CodexChatScope => {
    if (!routing.capabilities.nativeCodex) {
      throw new Error('Native Codex chat is disabled');
    }
    // Resolve only on native open: an absent bundle must not fail host startup.
    // The adapter converts open failures into its coded runtime-failed error.
    const executable = createElectronCodexExecutable(
      input.expectedManifestRow,
      input.bundledRoot,
    );
    if (input.ports.binary.executablePath !== executable.resolvedPath) {
      throw new Error(
        'Codex binary identity does not describe bundled executable',
      );
    }
    // Reject before allocating a child: registration disallows inherited runtimes.
    if (input.parent.isRegistered(CODEX_RUNTIME_TOKENS.Runtime, true)) {
      throw new Error('Codex runtime must be owned by a session scope');
    }
    const container = input.parent.createChildContainer();
    try {
      registerCodexRuntime(container, {
        ...input.ports,
        executable,
        sink,
        devRoute: routing.devRoute,
      });
      // Lifecycle ownership is the only allowed use of the raw token. Resolving
      // here starts no process and ensures failed opens retain a closeable owner.
      const runtime = container.resolve<CodexRuntime>(
        CODEX_RUNTIME_TOKENS.Runtime,
      );
      const usage = container.resolve<CodexAccountUsageClient | null>(
        CodexAccountUsageClient,
      );
      let closing: Promise<void> | undefined;
      const close = async () => {
        try {
          await runtime.close();
        } finally {
          try {
            await usage?.close();
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

/** Await this before registering SESSION_RUNTIME_IDENTITY_LOOKUP as an instance. */
export async function createElectronCodexIdentityLookup(
  ...args: Parameters<typeof initializeSessionRuntimeIdentityLookup>
) {
  return await initializeSessionRuntimeIdentityLookup(...args);
}

export interface ElectronCodexBindingInput extends ElectronCodexRoutingInput {
  readonly bundledRoot: string;
  readonly scopeResolver: LegacyCodexSessionSettingsDeps['scopeResolver'];
  readonly settingsStore: NativeSessionControlsDeps['store'];
}

/** Bind the whole guarded surface before resolving either adapter. */
export async function bindElectronCodexChat(
  container: DependencyContainer,
  input: ElectronCodexBindingInput,
) {
  const logger = container.resolve<Logger>(TOKENS.LOGGER);
  const metadataStore = container.resolve<SessionMetadataStore>(
    SDK_TOKENS.SDK_SESSION_METADATA_STORE,
  );
  const lookup = await createElectronCodexIdentityLookup(metadataStore, logger);
  let releaseRecord: (() => void) | undefined;
  let untrack: (() => void) | undefined;
  try {
    const { scopeResolver, settingsStore } = input;
    const record = createCodexSessionSettingsRecord({
      identities: lookup,
      scopeResolver,
    });
    releaseRecord = () => record.dispose();
    const routing = createElectronCodexRouting(input);
    const store = createCodexThreadIdentityStore(lookup, metadataStore);
    const scopes = new Set<CodexChatScope>();
    let disposed = false;
    const lifecycle = () =>
      container.resolve<SessionLifecycleManager>(
        SDK_TOKENS.SDK_SESSION_LIFECYCLE_MANAGER,
      );
    const native = () =>
      container.resolve<NativeSessionControlsDeps['adapter']>(
        SDK_TOKENS.CODEX_CHAT_ADAPTER,
      );
    const legacy = () =>
      container.resolve<IAgentAdapter>(SDK_TOKENS.SDK_AGENT_ADAPTER);
    const tabs = new Map<SessionId, string>();
    const profiles = new Map<
      SessionId,
      Awaited<ReturnType<CodexChatAdapterPorts['profile']>>
    >();
    const preparedTabs = new WeakMap<
      Awaited<ReturnType<CodexChatAdapterPorts['profile']>>,
      string
    >();
    const tabId = (id: SessionId) =>
      tabs.get(id) ?? lifecycle().find(id)?.tabId ?? id;
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
      webviewManager: container.resolve<
        CodexChatHostPortsDeps['webviewManager']
      >(TOKENS.WEBVIEW_MANAGER),
    };
    let verified: {
      pin: CodexExecutableManifestRow;
      binary: CodexRuntimeRegistrationPorts['binary'];
    } | undefined;
    const verifyBinary = async () => {
      try {
        const pin = findCodexExecutablePin(
          input.platform.platform,
          input.platform.arch,
        );
        if (!pin)
          throw new Error('No reviewed Codex executable pin for this platform');
        const executable = createElectronCodexExecutable(pin, input.bundledRoot);
        const inspected = await inspectElectronCodexBinary(executable.resolvedPath);
        if (disposed) throw new Error('Native Codex chat is disabled');
        verified = { pin, binary: { ...input.platform, ...inspected } };
      } catch (error) {
        verified = undefined;
        logger.error(
          'Codex executable verification failed',
          error instanceof Error ? error : new Error('Codex verification failed'),
        );
        throw new Error('Codex executable verification failed');
      }
    };
    const createScope = (sink: ApprovalSink): CodexChatScope => {
      if (disposed || !routing.capabilities.nativeCodex)
        throw new Error('Native Codex chat is disabled');
      if (!verified) throw new Error('Codex executable verification unavailable');
      const { pin, binary } = verified;
      const scope = createElectronCodexScopeFactory({
        ...input,
        parent: container,
        expectedManifestRow: pin,
        ports: {
          binary,
          store,
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
    const ports = createCodexChatHostPorts({
      ...deps,
      logger,
      platform: input.platform,
      createScope,
      broadcaster,
      tabId,
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
      metadata: {
        save: (id, identity) =>
          lookup.updateCodexExecution(id, () => ({
            version: 1,
            runtime: 'codex-app-server',
            sessionId: id,
            providerId: identity.providerId,
            workspaceId: identity.workspaceId,
            codex: { normalizedHome: identity.normalizedHome },
          })),
      },
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
    const adapterPorts = {
      ...ports,
      profile: async (
        ...args: Parameters<CodexChatAdapterPorts['profile']>
      ) => {
        const prepared = await ports.profile(...args);
        await verifyBinary();
        const tab = args[0].tabId;
        if (tab) preparedTabs.set(prepared, tab);
        return prepared;
      },
      sessions: record.lifecycle,
    };
    const opened = record.lifecycle.opened;
    const closed = record.lifecycle.closed;
    record.lifecycle.opened = (id, prepared) => {
      opened(id, prepared);
      profiles.set(id, prepared);
      const tab = preparedTabs.get(prepared);
      if (tab) tabs.set(id, tab);
    };
    record.lifecycle.closed = (id) => {
      closed(id);
      profiles.delete(id);
      tabs.delete(id);
      lookup.releaseSession(id);
      controls.releaseSession?.(id);
    };
    const controls = createNativeSessionControls({
      store: settingsStore,
      settings: (id) => record.settings(id),
      broadcaster,
      tabId,
      adapter: {
        setSessionModel: (...args) => native().setSessionModel(...args),
        setSessionEffort: (...args) => native().setSessionEffort(...args),
        setSessionPermissionLevel: (...args) =>
          native().setSessionPermissionLevel(...args),
        interruptCurrentTurn: (...args) =>
          native().interruptCurrentTurn(...args),
        executeSlashCommand: (...args) => native().executeSlashCommand(...args),
        getSessionToken: (...args) => native().getSessionToken(...args),
        canSendFollowUp: (id) => native().canSendFollowUp(id),
      },
    });
    const legacyPorts = createLegacySessionControlPorts({
      store: settingsStore,
      broadcaster,
      tabId,
      adapter: {
        executeSlashCommand: (...args) => legacy().executeSlashCommand(...args),
      },
      sessions: { find: (id) => lifecycle().find(id) },
      lifecycle: {
        interruptCurrentTurn: (id) => lifecycle().interruptCurrentTurn(id),
      },
      modelResolver: {
        resolve: (...args) =>
          container
            .resolve<LegacySessionControlPortsDeps['modelResolver']>(
              AUTH_PROVIDERS_TOKENS.SDK_MODEL_RESOLVER,
            )
            .resolve(...args),
      },
      settings: createLegacyCodexSessionSettings({
        sessions: { find: (id) => lifecycle().find(id) },
        identities: lookup,
        scopeResolver,
        auth: {
          resolveActiveAuthForPath: (path) => container
            .resolve<AuthManager>(AUTH_PROVIDERS_TOKENS.SDK_AUTH_MANAGER)
            .resolveActiveAuthForPath(path),
        },
      }),
    });
    const admission = createCodexRuntimeAdmission(deps);
    let closing: Promise<void> | undefined;
    const binding = {
      ...routing,
      dispose: () =>
        (closing ??= (async () => {
          disposed = true;
          try {
            const results = await Promise.allSettled(
              [...scopes].map((scope) => Promise.resolve().then(() => scope.dispose())),
            );
            const failures = results.flatMap((result) =>
              result.status === 'rejected' ? [result.reason] : [],
            );
            if (failures.length)
              throw new AggregateError(failures, 'Codex scope shutdown failed');
          } finally {
            try {
              record.dispose();
            } finally {
              try {
                lookup.dispose();
              } finally {
                tabs.clear();
                profiles.clear();
                untrack?.();
              }
            }
          }
        })()),
    };
    untrack = trackElectronCodexBinding(binding);
    container.register(SDK_TOKENS.SESSION_RUNTIME_IDENTITY_LOOKUP, {
      useValue: lookup,
    });
    container.register(SDK_TOKENS.CODEX_CHAT_ADAPTER_PORTS, {
      useValue: adapterPorts,
    });
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
    return binding;
  } catch (error) {
    try {
      releaseRecord?.();
    } finally {
      lookup.dispose();
      untrack?.();
    }
    throw error;
  }
}
