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
  CodexRuntime,
  buildCodexExecutionProfile,
  type ApprovalSink,
  type CodexContext,
  type CodexExecutionProfile,
  type CodexExecutionProfileInput,
  type CodexSelection,
  type CodexSelectionSnapshotPort,
  type CodexRuntimeRegistrationPorts,
  type CodexThreadIdentity,
} from '@ptah-extension/codex-runtime';
import { PLATFORM_TOKENS, type IWorkspaceProvider } from '@ptah-extension/platform-core';
import type { Logger } from '@ptah-extension/vscode-core';
import { createElectronCodexScopeFactory } from './codex-runtime-composition';

export interface ElectronCodexLaneInput {
  readonly isPackaged: boolean;
  readonly resourcesPath: string;
  readonly appPath: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly platform: { readonly platform: string; readonly arch: string };
}

export function isElectronCodexLaneAdmitted(
  _input: Pick<ElectronCodexLaneInput, 'isPackaged' | 'platform'>,
): boolean {
  return true;
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
  const selectionSnapshot = (): CodexSelectionSnapshotPort =>
    container.resolve<CodexSelectionSnapshotPort>(CODEX_RUNTIME_TOKENS.SelectionSnapshot);
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
            providerId: 'codex', workspaceId: cwd,
            ...(options.model ? { model: options.model } : {}),
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
      const selection = await selectionSnapshot().selectForOpen();
      const selected = selection.selected;
      if (explicitPath && canonical(explicitPath) !== selected.path)
        throw new Error('Codex executable does not match the selected executable');
      return { ...selected, selection };
    },
  };
  const runtime: CodexLaneRuntimeProvider = {
    open: async (profile, resume, approvals, binaryPath, selection) => {
      if (profile.consumer !== 'lane') throw new Error('Codex lane consumer required');
      return open(profile, resume, approvals, binaryPath, selection);
    },
    openCatalog: async (binaryPath, selectedHome, selection) => {
      const accountHome = selectedHome ?? await home();
      const catalogCwd = canonical(tmpdir());
      const profile = buildCodexExecutionProfile({
        session: {
          contextId: randomUUID(), consumer: 'lane', normalizedHome: accountHome,
          providerId: 'codex', workspaceId: catalogCwd, cwd: catalogCwd,
          model: undefined, permissionLevel: 'ask',
          lane: { suppressedTools: [], explicitFullAccess: false },
        },
        paths: paths(accountHome, catalogCwd),
      });
      const decline: ApprovalSink = { request: async () => 'decline' };
      return open(profile, undefined, decline, binaryPath, selection);
    },
    openFallback: async (profile, resume, approvals, binaryPath, method, selection) => {
      const snapshot = selectionSnapshot();
      const failed = selection?.selected;
      if (!failed || failed.path !== binaryPath || failed.source !== 'installed')
        throw new Error('Codex installed executable is not active');
      const fallback = await snapshot.activateFallback(failed, method);
      const selectedFallback: CodexSelectionSnapshotPort = {
        selectForOpen: async () => ({ selected: fallback }),
        current: () => fallback,
        markUnsupported: (failed, method) => snapshot.markUnsupported(failed, method),
        activateFallback: (selected, missingMethod) =>
          snapshot.activateFallback(selected, missingMethod),
      };
      return open(profile, resume, approvals, fallback.path, { selected: fallback }, selectedFallback);
    },
  };
  async function open(
    profile: CodexExecutionProfile,
    resume: CodexThreadIdentity | undefined,
    approvals: ApprovalSink,
    binaryPath: string,
    selection?: CodexSelection,
    runtimeSnapshot: CodexSelectionSnapshotPort = selectionSnapshot(),
  ): Promise<CodexContext> {
    const openedSelection = selection ?? await runtimeSnapshot.selectForOpen();
    if (openedSelection.selected.path !== binaryPath)
      throw new Error('Codex executable does not match the selected executable');
    const boundSnapshot: CodexSelectionSnapshotPort = {
      selectForOpen: async () => openedSelection,
      current: () => openedSelection.selected,
      markUnsupported: (failed, method) => runtimeSnapshot.markUnsupported(failed, method),
      activateFallback: (failed, method) => runtimeSnapshot.activateFallback(failed, method),
    };
    const ports: Omit<CodexRuntimeRegistrationPorts, 'sink'> = {
      selectionSnapshot: boundSnapshot,
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
      ...input, parent: container, ports,
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
  // One preflight per host, so its WRITE_DAC cache outlives each per-spawn adapter.
  const writeDac = new CodexLaneWriteDacPreflight(logger);
  const factory: CodexAdapterFactory = {
    create: () => new CodexAppServerLaneAdapter(runtime, profiles, identities, logger,
      binary, undefined, home, writers, writeDac),
  };
  container.register(CLI_AGENT_RUNTIME_TOKENS.CODEX_ADAPTER_FACTORY, { useValue: factory });
  prewarmCodexLaneWriteDac(container, writeDac, input);
}

/**
 * Probe each open workspace folder in the background on Windows, so the first
 * Codex lane there reads a cached WRITE_DAC result. Electron restores its
 * workspace after DI, so folder changes are probed as well.
 */
function prewarmCodexLaneWriteDac(
  container: DependencyContainer,
  preflight: Pick<CodexLaneWriteDacPreflight, 'prewarm'>,
  input: Pick<ElectronCodexLaneInput, 'platform'>,
): void {
  if (input.platform.platform !== 'win32' ||
    !container.isRegistered(PLATFORM_TOKENS.WORKSPACE_PROVIDER, true)) return;
  const workspace = container.resolve<IWorkspaceProvider>(PLATFORM_TOKENS.WORKSPACE_PROVIDER);
  const warm = (): void => {
    for (const folder of workspace.getWorkspaceFolders()) {
      if (isAbsolute(folder) && !folder.includes('\0')) preflight.prewarm(canonical(folder));
    }
  };
  warm();
  workspace.onDidChangeWorkspaceFolders(warm);
}

export function resolveElectronCodexLaneRuntime(
  scope: DependencyContainer,
  _input: Pick<ElectronCodexLaneInput, 'isPackaged' | 'platform'>,
): CodexRuntime {
  return scope.resolve<CodexRuntime>(CODEX_RUNTIME_TOKENS.Runtime);
}
