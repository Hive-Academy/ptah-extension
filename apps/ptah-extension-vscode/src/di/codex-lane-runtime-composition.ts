import { randomUUID } from 'node:crypto';
import { realpathSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import type { DependencyContainer } from 'tsyringe';
import { createCodexThreadIdentityStore, resolveCodexNativeBinaryPath, SDK_TOKENS,
  type SessionMetadataStore } from '@ptah-extension/agent-sdk';
import { CLI_AGENT_RUNTIME_TOKENS, CODEX_LANE_DEFAULT_MODEL, CodexAppServerLaneAdapter,
  type CodexAdapterFactory, type CodexLaneBinaryProbe, type CodexLaneIdentityStore,
  type CodexLaneProfileResolver, type CodexLaneRuntimeProvider } from '@ptah-extension/cli-agent-runtime';
import { CODEX_RUNTIME_TOKENS, CodexRuntime, CodexParityGate, CodexExecutableInspectionError,
  buildCodexExecutionProfile, findCodexExecutablePin, inspectCodexExecutable,
  registerCodexRuntime, resolveGatedCodexRuntime,
  type ApprovalSink, type CodexContext, type CodexExecutionProfile,
  type CodexExecutionProfileInput, type CodexRuntimeRegistrationPorts,
  type CodexThreadIdentity } from '@ptah-extension/codex-runtime';
import type { Logger } from '@ptah-extension/vscode-core';

export interface VsCodeCodexLaneInput {
  readonly isDevelopment: boolean;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly platform: { readonly platform: string; readonly arch: string };
}

function canonical(path: string): string {
  if (!isAbsolute(path) || path.includes('\0')) throw new Error('Invalid Codex lane path');
  try { return realpathSync(path); } catch {
    // degradation-audit: optional-capability - a missing home is valid before login
    return resolve(path);
  }
}

function pathEntry(path: string): { kind: 'directory'; realpath: string } | { kind: 'missing' } {
  try {
    const realpath = realpathSync(path);
    return statSync(realpath).isDirectory() ? { kind: 'directory', realpath } : { kind: 'missing' };
  } catch {
    // degradation-audit: optional-capability - the profile builder checks missing paths
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

/** Resolve and inspect the host binary only when a lane needs it. */
export async function inspectVsCodeCodexBinary(input: VsCodeCodexLaneInput) {
  const candidate = resolveCodexNativeBinaryPath();
  if (!candidate) throw new CodexExecutableInspectionError(
    'Native Codex executable unavailable', 'codex-executable-missing',
  );
  const inspected = await inspectCodexExecutable(candidate, input.platform);
  const pin = findCodexExecutablePin(input.platform.platform, input.platform.arch);
  if (!pin) throw new CodexExecutableInspectionError(
    'Reviewed Codex executable pin unavailable', 'codex-pin-unavailable',
  );
  return { ...inspected, pin };
}

/** D27's only lane routing boundary. A raw runtime is a development default only. */
export function resolveVsCodeCodexLaneRuntime(
  scope: DependencyContainer,
  input: Pick<VsCodeCodexLaneInput, 'isDevelopment' | 'platform'>,
): CodexRuntime {
  if (new CodexParityGate().isEnabled('lane', input.platform))
    return resolveGatedCodexRuntime(scope, 'lane', input.platform);
  if (input.isDevelopment)
    return scope.resolve<CodexRuntime>(CODEX_RUNTIME_TOKENS.Runtime);
  throw new Error('Codex lane production routing disabled by parity gate');
}

/** Phase 2 binds a lazy factory; creating or detecting an adapter spawns nothing. */
export function registerVsCodeCodexLaneFactory(
  container: DependencyContainer, logger: Logger, input: VsCodeCodexLaneInput,
): void {
  if (!input.isDevelopment && !new CodexParityGate().isEnabled('lane', input.platform)) return;
  let metadata: SessionMetadataStore | undefined;
  const getMetadata = (): SessionMetadataStore => metadata ??= container.resolve<SessionMetadataStore>(
    SDK_TOKENS.SDK_SESSION_METADATA_STORE,
  );
  let store: ReturnType<typeof createCodexThreadIdentityStore> | undefined;
  const getStore = (): ReturnType<typeof createCodexThreadIdentityStore> => store ??=
    createCodexThreadIdentityStore(getMetadata(), getMetadata(), 'lane');
  const home = async (): Promise<string> => {
    if (input.env['CODEX_HOME'] === '') throw new Error('Codex home is empty');
    if (input.env['CODEX_HOME'] === undefined && input.env['HOME'] === '' &&
      !input.env['USERPROFILE']) throw new Error('Codex home is empty');
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
      const inspected = await inspectVsCodeCodexBinary(input);
      if (explicitPath && canonical(explicitPath) !== inspected.executablePath)
        throw new Error('Codex executable does not match the host pin');
      return { path: inspected.executablePath, version: inspected.pin.pinnedVersion };
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
    profile: CodexExecutionProfile, resume: CodexThreadIdentity | undefined,
    approvals: ApprovalSink, binaryPath: string,
  ): Promise<CodexContext> {
    const inspected = await inspectVsCodeCodexBinary(input);
    if (binaryPath !== inspected.executablePath)
      throw new Error('Codex executable does not match the host pin');
    const ports: CodexRuntimeRegistrationPorts = {
      executable: { resolvedPath: inspected.executablePath, expectedManifestRow: inspected.pin },
      binary: { ...input.platform, executablePath: inspected.executablePath,
        sha256: inspected.sha256, versionOutput: inspected.versionOutput },
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
        debug: (message, data) => logger.debug(message, data),
        info: (message, data) => logger.info(message, data),
        warn: (message, data) => logger.warn(message, data),
        error: (message, data) => logger.error(message, data),
      },
      sink: approvals,
      usage: null,
      requestUserInput: async (request, signal) => {
        await approvals.request(request, signal);
        return {};
      },
    };
    if (container.isRegistered(CODEX_RUNTIME_TOKENS.Runtime, true))
      throw new Error('Codex runtime must be owned by a lane scope');
    const scope = container.createChildContainer();
    let registered = false;
    let closing: Promise<void> | undefined;
    const dispose = async (): Promise<void> => {
      if (!closing) closing = (async () => {
        try {
          if (registered) await scope.resolve<CodexRuntime>(CODEX_RUNTIME_TOKENS.Runtime).close();
        } finally {
          await scope.dispose();
        }
      })();
      return closing;
    };
    try {
      registerCodexRuntime(scope, ports);
      registered = true;
      const context = await resolveVsCodeCodexLaneRuntime(scope, input).open(profile, resume);
      return ownedContext(context, dispose);
    } catch (error) {
      try {
        await dispose();
      } catch (disposeError) {
        // degradation-audit: reported - preserve the original open failure after logging cleanup failure
        logger.error('Failed to dispose Codex lane scope after open failure',
          disposeError instanceof Error ? disposeError : new Error(String(disposeError)));
      }
      throw error;
    }
  }
  const factory: CodexAdapterFactory = {
    create: () => new CodexAppServerLaneAdapter(runtime, profiles, identities, logger,
      binary, undefined, home),
  };
  container.register(CLI_AGENT_RUNTIME_TOKENS.CODEX_ADAPTER_FACTORY, { useValue: factory });
}
