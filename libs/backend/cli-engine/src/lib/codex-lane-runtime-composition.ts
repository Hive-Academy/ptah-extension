import { randomUUID } from 'node:crypto';
import { realpathSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, isAbsolute, join, resolve } from 'node:path';
import type { DependencyContainer } from 'tsyringe';
import {
  createCodexThreadIdentityStore,
  resolveCodexNativeBinaryPath,
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
  CodexAccountUsageClient,
  CodexParityGate,
  CodexRuntime,
  buildCodexExecutionProfile,
  findCodexExecutablePin,
  inspectCodexExecutable,
  registerCodexRuntime,
  resolveGatedCodexRuntime,
  type ApprovalSink,
  type CodexContext,
  type CodexExecutionProfile,
  type CodexExecutionProfileInput,
  type CodexParityPlatform,
  type CodexRuntimeRegistrationPorts,
  type CodexThreadIdentity,
} from '@ptah-extension/codex-runtime';
import type { Logger } from '@ptah-extension/vscode-core';

export interface CliCodexLaneInput {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly platform: CodexParityPlatform;
}

function canonical(path: string): string {
  if (!isAbsolute(path) || path.includes('\0')) throw new Error('Invalid Codex lane path');
  try {
    return realpathSync(path);
  } catch {
    // degradation-audit: optional-capability - a missing home is valid before login; retain its absolute path
    return resolve(path);
  }
}

function pathEntry(path: string): { kind: 'directory'; realpath: string } | { kind: 'missing' } {
  try {
    const realpath = realpathSync(path);
    return statSync(realpath).isDirectory() ? { kind: 'directory', realpath } : { kind: 'missing' };
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

/** The CLI and TUI share this gate-only lane routing boundary. */
export function resolveCliCodexLaneRuntime(
  scope: DependencyContainer,
  platform: CodexParityPlatform,
): CodexRuntime {
  return resolveGatedCodexRuntime(scope, 'lane', platform);
}

/** Bind before CliDetectionService can be resolved; create() performs no I/O. */
export function registerCliCodexLaneFactory(
  container: DependencyContainer,
  logger: Logger,
  input: CliCodexLaneInput = { env: process.env, platform: process },
): void {
  if (!new CodexParityGate().isEnabled('lane', input.platform)) return;

  let metadata: SessionMetadataStore | undefined;
  const getMetadata = (): SessionMetadataStore => metadata ??= container.resolve<SessionMetadataStore>(
    SDK_TOKENS.SDK_SESSION_METADATA_STORE,
  );
  let store: ReturnType<typeof createCodexThreadIdentityStore> | undefined;
  const getStore = (): ReturnType<typeof createCodexThreadIdentityStore> => store ??=
    createCodexThreadIdentityStore(getMetadata(), getMetadata(), 'lane');
  const home = async (): Promise<string> => {
    if (input.env['CODEX_HOME'] === '' ||
      (input.env['CODEX_HOME'] === undefined &&
        input.env['HOME'] === '' && !input.env['USERPROFILE']))
      throw new Error('Codex home is empty');
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
      const nativePath = resolveCodexNativeBinaryPath();
      if (explicitPath && (!nativePath || canonical(explicitPath) !== canonical(nativePath)))
        throw new Error('Codex executable does not match the host binary');
      const candidate = explicitPath ?? nativePath;
      if (!candidate) return undefined;
      const inspection = await inspectCodexExecutable(candidate, input.platform);
      if (basename(inspection.executablePath) !==
        (input.platform.platform === 'win32' ? 'codex.exe' : 'codex'))
        throw new Error('Codex executable path is not a native binary');
      const pin = findCodexExecutablePin(input.platform.platform, input.platform.arch);
      if (!pin) throw new Error('Reviewed Codex executable pin unavailable');
      return { path: inspection.executablePath, version: pin.pinnedVersion };
    },
  };
  const runtime: CodexLaneRuntimeProvider = {
    open: async (profile, resume, approvals, binaryPath) => {
      if (profile.consumer !== 'lane') throw new Error('Codex lane consumer required');
      return open(profile, resume, approvals, binaryPath);
    },
    openCatalog: async (binaryPath, selectedHome) => {
      const accountHome = selectedHome ?? await home();
      const cwd = canonical(tmpdir());
      const profile = buildCodexExecutionProfile({
        session: {
          contextId: randomUUID(), consumer: 'lane', normalizedHome: accountHome,
          providerId: 'codex', workspaceId: cwd, cwd,
          model: CODEX_LANE_DEFAULT_MODEL, permissionLevel: 'ask',
          lane: { suppressedTools: [], explicitFullAccess: false },
        },
        paths: paths(accountHome, cwd),
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
    const candidate = resolveCodexNativeBinaryPath();
    if (!candidate || canonical(candidate) !== canonical(binaryPath))
      throw new Error('Codex executable does not match the host binary');
    const inspection = await inspectCodexExecutable(binaryPath, input.platform);
    const pin = findCodexExecutablePin(input.platform.platform, input.platform.arch);
    if (!pin) throw new Error('Reviewed Codex executable pin unavailable');
    if (container.isRegistered(CODEX_RUNTIME_TOKENS.Runtime, true))
      throw new Error('Codex runtime must be owned by a lane scope');
    const scope = container.createChildContainer();
    let registered = false;
    let disposed: Promise<void> | undefined;
    const dispose = (): Promise<void> => disposed ??= (async () => {
      try {
        if (registered)
          await scope.resolve<CodexRuntime>(CODEX_RUNTIME_TOKENS.Runtime).close();
      } finally {
        try {
          if (registered)
            await scope.resolve<CodexAccountUsageClient | null>(CodexAccountUsageClient)?.close();
        } finally {
          await scope.dispose();
        }
      }
    })();
    try {
      const ports: CodexRuntimeRegistrationPorts = {
        executable: { resolvedPath: inspection.executablePath, expectedManifestRow: pin },
        binary: {
          ...input.platform, executablePath: inspection.executablePath,
          sha256: inspection.sha256, versionOutput: inspection.versionOutput,
        },
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
      const context = await resolveCliCodexLaneRuntime(scope, input.platform)
        .open(profile, resume);
      return ownedContext(context, dispose);
    } catch (error) {
      try {
        await dispose();
      } catch (disposeError) {
        // degradation-audit: reported - preserve the original open failure after logging cleanup failure
        logger.error('Failed to dispose Codex lane scope',
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
