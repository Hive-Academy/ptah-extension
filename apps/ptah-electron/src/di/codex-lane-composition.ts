import { randomUUID } from 'node:crypto';
import { realpathSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import type { DependencyContainer } from 'tsyringe';
import {
  createCodexThreadIdentityStore,
  SDK_TOKENS,
  type SessionMetadataStore,
} from '@ptah-extension/agent-sdk';
import {
  CLI_AGENT_RUNTIME_TOKENS,
  CODEX_LANE_DEFAULT_MODEL,
  CodexAppServerLaneAdapter,
  type CodexAdapterFactory,
  type CodexLaneBinaryProbe,
  type CodexLaneIdentityStore,
  type CodexLaneProfileResolver,
  type CodexLaneRuntimeProvider,
} from '@ptah-extension/cli-agent-runtime';
import {
  CODEX_RUNTIME_TOKENS,
  CodexRuntime,
  CodexParityGate,
  buildCodexExecutionProfile,
  findCodexExecutablePin,
  resolveGatedCodexRuntime,
  type ApprovalSink,
  type CodexContext,
  type CodexExecutionProfile,
  type CodexExecutionProfileInput,
  type CodexRuntimeRegistrationPorts,
  type CodexThreadIdentity,
} from '@ptah-extension/codex-runtime';
import type { Logger } from '@ptah-extension/vscode-core';
import {
  createElectronCodexExecutable, createElectronCodexScopeFactory,
  inspectElectronCodexBinary, resolveElectronCodexBundledRoot,
} from './codex-runtime-composition';

export interface ElectronCodexLaneInput {
  readonly isPackaged: boolean;
  readonly resourcesPath: string;
  readonly appPath: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly platform: { readonly platform: string; readonly arch: string };
}

function canonical(path: string): string {
  if (!isAbsolute(path) || path.includes('\0')) throw new Error('Invalid Codex lane path');
  try {
    return realpathSync(path);
  } catch {
    // degradation-audit: optional-capability - a missing home is valid before login; the lexical absolute path remains its identity
    return resolve(path);
  }
}

function pathEntry(path: string): { kind: 'directory'; realpath: string } | { kind: 'missing' } {
  try {
    const realpath = realpathSync(path);
    return statSync(realpath).isDirectory() ? { kind: 'directory', realpath } : { kind: 'missing' };
  } catch {
    // degradation-audit: optional-capability - the profile builder receives an explicit missing path and refuses unsafe aliases
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

function ownedContext(context: CodexContext, dispose: () => Promise<void>): CodexContext {
  let closing: Promise<void> | undefined;
  return {
    get identity() { return context.identity; },
    get turnPermissionLevel() { return context.turnPermissionLevel; },
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

/** Register a lazy factory. Creating or selecting the adapter performs no I/O. */
export function registerElectronCodexLaneFactory(
  container: DependencyContainer,
  logger: Logger,
  input: ElectronCodexLaneInput,
): void {
  // Phase 2 only binds the factory. Resolve storage on first use after the
  // remaining host services have been composed.
  let metadata: SessionMetadataStore | undefined;
  const getMetadata = (): SessionMetadataStore => metadata ??= container.resolve<SessionMetadataStore>(
    SDK_TOKENS.SDK_SESSION_METADATA_STORE,
  );
  let store: ReturnType<typeof createCodexThreadIdentityStore> | undefined;
  const getStore = (): ReturnType<typeof createCodexThreadIdentityStore> => store ??=
    createCodexThreadIdentityStore(getMetadata(), getMetadata(), 'lane');
  const home = async (): Promise<string> => {
    if (input.env['CODEX_HOME'] === '') throw new Error('Codex home is empty');
    return canonical(input.env['CODEX_HOME'] ?? join(
      input.env['HOME'] || input.env['USERPROFILE'] || homedir(), '.codex',
    ));
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
        ? await identities.readByThreadId(options.resumeSessionId) : undefined;
      const budgets = options.laneBudgets ?? {
        autoCompactTokens: 120000, toolOutputTokenLimit: 2500, webSearch: true,
      };
      return {
        lane: {
          permissionLevel: 'ask',
          identity: {
            contextId: prior?.contextId ?? randomUUID(), normalizedHome: selectedHome,
            providerId: 'codex', workspaceId: cwd, model: options.model || '',
          },
          config: {
            variant, workingDirectory: cwd,
            autoCompactTokens: budgets.autoCompactTokens,
            toolOutputTokenLimit: budgets.toolOutputTokenLimit,
            webSearch: budgets.webSearch, userMcpServerNames: [],
          },
        },
        paths: paths(selectedHome, cwd),
      };
    },
  };
  const binary: CodexLaneBinaryProbe = {
    resolve: async (explicitPath) => {
      const pin = findCodexExecutablePin(input.platform.platform, input.platform.arch);
      if (!pin) throw new Error('Reviewed Codex executable pin unavailable');
      const bundledRoot = resolveElectronCodexBundledRoot(input);
      const executable = createElectronCodexExecutable(pin, bundledRoot);
      if (explicitPath && canonical(explicitPath) !== executable.resolvedPath)
        throw new Error('Codex executable does not match the host bundle');
      await inspectElectronCodexBinary(executable.resolvedPath, undefined, input.platform);
      return { path: executable.resolvedPath, version: pin.pinnedVersion };
    },
  };
  const runtime: CodexLaneRuntimeProvider = {
    open: async (profile, resume, approvals, binaryPath) => {
      if (profile.consumer !== 'lane') throw new Error('Codex lane consumer required');
      return open(profile, resume, approvals, binaryPath);
    },
    openCatalog: async (binaryPath, selectedHome) => {
      const accountHome = selectedHome ?? await home();
      const catalogCwd = canonical(tmpdir());
      const profile = buildCodexExecutionProfile({
        session: {
          contextId: randomUUID(), consumer: 'lane', normalizedHome: accountHome,
          providerId: 'codex', workspaceId: catalogCwd, cwd: catalogCwd,
          model: CODEX_LANE_DEFAULT_MODEL, permissionLevel: 'ask',
          lane: { suppressedTools: [], explicitFullAccess: false },
        },
        paths: paths(accountHome, catalogCwd),
      });
      const decline: ApprovalSink = { request: async () => 'decline' };
      return open(profile, undefined, decline, binaryPath);
    },
  };
  async function open(
    profile: CodexExecutionProfile,
    resume: CodexThreadIdentity | undefined,
    approvals: ApprovalSink,
    binaryPath: string,
  ): Promise<CodexContext> {
    const pin = findCodexExecutablePin(input.platform.platform, input.platform.arch);
    if (!pin) throw new Error('Reviewed Codex executable pin unavailable');
    const bundledRoot = resolveElectronCodexBundledRoot(input);
    const executable = createElectronCodexExecutable(pin, bundledRoot);
    if (binaryPath !== executable.resolvedPath)
      throw new Error('Codex executable does not match the host bundle');
    const inspected = await inspectElectronCodexBinary(binaryPath, undefined, input.platform);
    const ports: Omit<CodexRuntimeRegistrationPorts, 'sink' | 'executable' | 'devRoute'> = {
      binary: { ...input.platform, ...inspected },
      store: getStore(),
      spawner: container.resolve<CodexRuntimeRegistrationPorts['spawner']>(SDK_TOKENS.SDK_PROCESS_SPAWNER),
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
      usage: null,
      requestUserInput: async (request, signal) => {
        await approvals.request(request, signal);
        return {};
      },
    };
    const scope = createElectronCodexScopeFactory({
      ...input, parent: container, bundledRoot, expectedManifestRow: pin, ports,
    }, 'lane')(approvals);
    try {
      const context = await resolveElectronCodexLaneRuntime(scope.container, input)
        .open(profile, resume);
      return ownedContext(context, scope.dispose);
    } catch (error) {
      await scope.dispose();
      throw error;
    }
  }
  const writers = CodexAppServerLaneAdapter.createWriterRegistry();
  const factory: CodexAdapterFactory = {
    create: () => new CodexAppServerLaneAdapter(runtime, profiles, identities, logger,
      binary, undefined, home, writers),
  };
  if (!input.isPackaged || new CodexParityGate().isEnabled('lane', input.platform))
    container.register(CLI_AGENT_RUNTIME_TOKENS.CODEX_ADAPTER_FACTORY, { useValue: factory });
}

/** D27's only lane routing boundary; the raw token is a dev default only. */
export function resolveElectronCodexLaneRuntime(
  scope: DependencyContainer,
  input: Pick<ElectronCodexLaneInput, 'isPackaged' | 'platform'>,
): CodexRuntime {
  if (new CodexParityGate().isEnabled('lane', input.platform))
    return resolveGatedCodexRuntime(scope, 'lane', input.platform);
  if (!input.isPackaged)
    return scope.resolve<CodexRuntime>(CODEX_RUNTIME_TOKENS.Runtime);
  throw new Error('Codex lane production routing disabled by parity gate');
}
