import {
  createElectronCodexSessionState,
  createElectronCodexControls,
  createElectronCodexSessionLifecycle,
  createElectronCodexShutdownStore,
  createElectronCodexBindingHandle,
} from './codex-session-binding';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, realpathSync, statSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import {
  AUTH_PROVIDERS_TOKENS,
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
  type CodexChatAdapterPorts,
  initializeSessionRuntimeIdentityLookup,
  resolveCodexNativeBinaryPath,
  type CodexChatScope,
  type RuntimeAdmissionPort,
} from '@ptah-extension/agent-sdk';
import {
  buildCodexExecutionProfile,
  findCodexExecutablePin,
  CODEX_RUNTIME_TOKENS,
  CodexAccountUsageClient,
  CodexParityGate,
  codexDevRouteCovers,
  readCodexDevRouteOverride,
  registerCodexRuntime,
  type ApprovalSink,
  type CodexExecutableManifestRow,
  type CodexParityPlatform,
  type CodexRuntime,
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

/** A capability hint only; opening a chat still uses resolveGatedCodexRuntime. */
export function createElectronCodexRouting(input: ElectronCodexRoutingInput): ElectronCodexRouting {
  const devRoute = readCodexDevRouteOverride({
    isPackaged: input.isPackaged,
    env: input.env,
  });
  const capabilities = Object.freeze({
    nativeCodex:
      new CodexParityGate().isEnabled('chat', input.platform) ||
      codexDevRouteCovers(devRoute, 'chat'),
    nativeCodexGateway:
      new CodexParityGate().isEnabled('gateway', input.platform) ||
      codexDevRouteCovers(devRoute, 'gateway'),
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

/** Share in-flight opens and cache successes; failed inspections can retry. */
export async function inspectElectronCodexBinary(
  executablePath: string,
  readVersion: (path: string) => Promise<string> = readCodexVersion,
  platform: CodexParityPlatform = process,
): Promise<VerifiedCodexBinary> {
  const pin = findCodexExecutablePin(platform.platform, platform.arch);
  if (!pin) throw Object.assign(new Error('No reviewed Codex executable pin for this platform'), {
    code: 'codex-pin-unavailable',
  });
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
      if (sha256 !== pin.binarySha256)
        throw Object.assign(new Error('Codex executable digest does not match the reviewed pin'), {
          code: 'codex-digest-mismatch',
        });
      const versionOutput = await readVersion(executablePath);
      return { executablePath, sha256, versionOutput };
    })().catch((error: unknown) => {
      binaryInspections.delete(key);
      throw error;
    });
    binaryInspections.set(key, pending);
  }
  const inspected = await pending;
  if (inspected.sha256 !== pin.binarySha256)
    throw Object.assign(new Error('Codex executable digest does not match the reviewed pin'), {
      code: 'codex-digest-mismatch',
    });
  return inspected;
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
  return {
    container,
    input,
    logger,
    metadataStore,
    lookup,
    record,
    routing: createElectronCodexRouting(input),
    store: createElectronCodexShutdownStore(createCodexThreadIdentityStore(lookup, metadataStore)),
    scopes: new Set<CodexChatScope>(),
    disposed: false,
    state: createElectronCodexSessionState(container),
  };
}

interface HostDependencies {
  readonly deps: Pick<CodexChatHostPortsDeps,
    'resolver' | 'workspaceProvider' | 'platformInfo' | 'hostCapabilities' | 'webviewManager'>;
  readonly broadcaster: CodexChatHostPortsDeps['broadcaster'];
}

interface ScopePorts {
  createScope(sink: ApprovalSink): CodexChatScope;
  verifyBinary(): Promise<void>;
}

function createElectronCodexHostDependencies(context: BindingContext): HostDependencies {
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
    webviewManager: container.resolve<
      CodexChatHostPortsDeps['webviewManager']
    >(TOKENS.WEBVIEW_MANAGER),
  };
  return { deps, broadcaster };
}

function createElectronCodexScopePorts(context: BindingContext): ScopePorts {
  const { container, input, logger, routing, store, scopes } = context;
  const { profiles } = context.state;
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
      const inspected = await inspectElectronCodexBinary(executable.resolvedPath, readCodexVersion, input.platform);
      if (context.disposed) throw new Error('Native Codex chat is disabled');
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
    if (context.disposed || !routing.capabilities.nativeCodex)
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
  return { createScope, verifyBinary };
}

function createElectronCodexAdapterPorts(
  context: BindingContext,
  host: HostDependencies,
  scope: ScopePorts,
  sessions: NonNullable<CodexChatAdapterPorts['sessions']>,
): CodexChatHostPorts {
  const { container, input, logger, metadataStore, store, lookup } = context;
  const { tabId, preparedTabs } = context.state;
  const { deps, broadcaster } = host;
  const { createScope, verifyBinary } = scope;
  const ports = createCodexChatHostPorts({
    ...deps,
    readSavedPermissionLevel: (workspacePath) =>
      resolveSavedCodexPermissionLevel(
        (name) => input.scopeResolver.readForPath(name, workspacePath, true),
        () => { throw new CodexSessionSettingsError('invalid-settings'); },
      ),
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
    // The shared port keeps the native title and counts completed turns (8m-8).
    metadata: createCodexChatMetadataPort(lookup),
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
  return {
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
    sessions,
  };
}

function registerElectronCodexBinding(
  context: BindingContext,
  adapterPorts: CodexChatHostPorts,
  admission: RuntimeAdmissionPort,
  sessionControls: ElectronCodexSessionControls,
) {
  const { container, lookup, routing } = context;
  const { controls, legacyPorts } = sessionControls;
  container.register(SDK_TOKENS.SESSION_RUNTIME_IDENTITY_LOOKUP, {
    useValue: lookup,
  });
  container.register<CodexChatHostPorts>(SDK_TOKENS.CODEX_CHAT_ADAPTER_PORTS, {
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
  const lookup = await initializeSessionRuntimeIdentityLookup(metadataStore, logger);
  let record: ElectronCodexSettingsRecord | undefined;
  let binding: ElectronCodexBinding | undefined;
  try {
    record = createCodexSessionSettingsRecord({
      identities: lookup,
      scopeResolver: input.scopeResolver,
    });
    const context = createElectronCodexBindingContext(
      container, input, logger, metadataStore, lookup, record,
    );
    const host = createElectronCodexHostDependencies(context);
    const scope = createElectronCodexScopePorts(context);
    const sessionControls = createElectronCodexControls(
      container, input, context.state, record, lookup, host.broadcaster,
    );
    const lifecycle = createElectronCodexSessionLifecycle(
      record, context.state, lookup, sessionControls.controls,
    );
    const adapterPorts = createElectronCodexAdapterPorts(
      context, host, scope, lifecycle,
    );
    const admission = createCodexRuntimeAdmission(host.deps);
    binding = createElectronCodexBindingHandle(context);
    registerElectronCodexBinding(context, adapterPorts, admission, sessionControls);
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
