import { tmpdir } from 'node:os';
import { SessionId, type AuthEnv } from '@ptah-extension/shared';
import type { Logger } from '@ptah-extension/vscode-core';
import type {
  ClaudeAccountRoute,
  ClaudeAccountNamedRoute,
  ClaudeCertifiedLaunchContext,
} from '@ptah-extension/auth-providers-tokens';
import {
  ClaudeCertifiedLaunchRefusal,
  assertCertifiedLaunch,
  buildFlagSettingsArg,
  buildSafeEnv,
  buildSessionName,
  certifiedNamedEnv,
  deriveWorkspaceLabel,
  type ClaudeActualLaunch,
  type Options,
  type SdkPermissionHandler,
} from '@ptah-extension/agent-sdk';
// Type-only: a value import would load agent-generation and its ESM-only
// workspace-intelligence chain into every registry spec.
import type { PtahSpawnAssembly } from '../ptah-cli/helpers/ptah-cli-spawn-options.service';
import { blankToUndefined } from '../ptah-cli/helpers/ptah-cli-registry.utils';
import { stripAnsiCodes } from '../cli-agents/cli-adapters/cli-adapter.utils';
import { classifyCliStderr } from '../cli-agents/cli-adapters/cli-stderr-severity';
import type { ISdkProcessSpawner } from '../spawn/sdk-process-spawner.port';

/**
 * Child env for a lane. Ambient lanes keep the safe env. A named lane gets the
 * certified env only: no safe-env or auth-env entry reaches it, and a named
 * route without a certified launch throws `identity-unproved`.
 */
export function buildClaudeLaneEnv(
  authEnv: AuthEnv,
  accountRoute?: ClaudeAccountRoute,
  launch?: ClaudeCertifiedLaunchContext,
): Record<string, string | undefined> {
  if (accountRoute?.kind === 'named')
    return certifiedNamedEnv(accountRoute, launch);
  return buildSafeEnv(authEnv);
}

/** The launch values an SDK child would start with, as the certified check reads them. */
export function claudeActualLaunch(options: Options): ClaudeActualLaunch {
  const settings = options.settings;
  return {
    executablePath: options.pathToClaudeCodeExecutable,
    env: options.env ?? {},
    cwd: options.cwd,
    settingSources: options.settingSources,
    flagSettings:
      settings === undefined || typeof settings === 'string'
        ? settings
        : JSON.stringify(settings),
    managedSettings: options.managedSettings,
    extraArgs: options.extraArgs,
  };
}

/**
 * Control-only bootstrap; no workspace, role, resume, hooks or task material.
 * The executable is the certified one: it is the CLI JS path only on a
 * direct-execution installation, and the installation path otherwise.
 * Throws `ClaudeCertifiedLaunchRefusal` unless the options match the certified
 * launch in `bootstrap` mode.
 */
export function buildClaudeLaneBootstrapOptions(
  accountRoute: ClaudeAccountNamedRoute,
  launch: ClaudeCertifiedLaunchContext | undefined,
  abortController: AbortController,
  processSpawner: ISdkProcessSpawner,
): Options {
  if (!launch) throw new ClaudeCertifiedLaunchRefusal('identity-unproved');
  const options: Options = {
    cwd: tmpdir(),
    abortController,
    pathToClaudeCodeExecutable: launch.executable.sdkExecutablePath,
    env: buildClaudeLaneEnv({}, accountRoute, launch),
    systemPrompt: '',
    settingSources: [],
    tools: [],
    mcpServers: {},
    strictMcpConfig: true,
    persistSession: false,
    maxTurns: 1,
    canUseTool: async () => ({
      behavior: 'deny',
      message: 'Account admission pending.',
    }),
    spawnClaudeCodeProcess: (spawnOptions) =>
      processSpawner.spawn(spawnOptions, {}),
  };
  assertCertifiedLaunch(launch, claudeActualLaunch(options), 'bootstrap');
  return options;
}

export interface ClaudeSdkLaneOptionsInput {
  assembly: PtahSpawnAssembly;
  authEnv: AuthEnv;
  accountRoute?: ClaudeAccountRoute;
  /** Certified launch of a named route; a named route without it throws. */
  launch?: ClaudeCertifiedLaunchContext;
  abortController: AbortController;
  model: string;
  effort?: Options['effort'];
  cwd: string;
  agentName: string;
  agentId?: string;
  routingId: string;
  resumeSessionId?: string;
  parentSessionId?: string;
  cliAgentResolver?: () => string | undefined;
  permissionHandler: Pick<
    SdkPermissionHandler,
    'getPermissionLevel' | 'createCallback'
  >;
  logger: Logger;
  processSpawner: ISdkProcessSpawner;
  /** Ambient executable; a named lane uses the certified one instead. */
  executable?: string;
}

/** Complete effective options for both configured and native Claude lanes. */
export function buildClaudeSdkLaneOptions(
  input: ClaudeSdkLaneOptionsInput,
): Options {
  const {
    assembly,
    authEnv,
    accountRoute,
    launch,
    abortController,
    model,
    effort,
    cwd,
    agentName,
    agentId,
    routingId,
    resumeSessionId,
    parentSessionId,
    cliAgentResolver,
    permissionHandler,
    logger,
    processSpawner,
    executable,
  } = input;
  // First: a named route without a certified launch throws here, before any
  // other option is assembled.
  const env = buildClaudeLaneEnv(authEnv, accountRoute, launch);
  const certified = accountRoute?.kind === 'named' ? launch : undefined;
  const handleChildStderr = (data: string) => {
    if (accountRoute?.kind === 'named') {
      logger.debug('[ClaudeLane] Child diagnostic received.');
      return;
    }
    const isError = classifyCliStderr(stripAnsiCodes(data).trim()) === 'error';
    const message = `[PtahCliRegistry] Agent "${agentName}" stderr: ${data}`;
    if (isError) {
      logger.warn(message);
    } else {
      logger.debug(message);
    }
  };

  const extraArgs: Record<string, string | null> = {
    'replay-user-messages': null,
  };
  const sessionName = buildSessionName({
    role: agentName,
    workspaceLabel: deriveWorkspaceLabel(cwd),
    uniqueSuffix: (agentId ?? '').slice(0, 6),
  });
  if (sessionName) {
    extraArgs['name'] = sessionName;
  } else if (agentId) {
    logger.warn(
      '[PtahCliRegistry] Could not compose a session name — spawning without ' +
        '--name, so the CLI derives one',
      { agentConfigId: routingId },
    );
  } else {
    logger.debug(
      '[PtahCliRegistry] No reserved agent id for this spawn — the CLI ' +
        'derives the session name',
      { agentConfigId: routingId },
    );
  }

  return {
    abortController,
    model,
    effort: effort || undefined,
    cwd: certified ? certified.cwd : cwd,
    systemPrompt:
      assembly.systemPromptMode === 'standalone' && assembly.systemPromptContent
        ? assembly.systemPromptContent
        : {
            type: 'preset' as const,
            preset: 'claude_code' as const,
            append: assembly.systemPromptContent,
          },
    tools: {
      type: 'preset' as const,
      preset: 'claude_code' as const,
    },
    // Claude built-ins off unless opted in (TASK_2026_853). An SDK option, so
    // it holds on ambient, named and proxied routes and on either policy path.
    disallowedTools: [...assembly.builtinPolicy.disallowedTools],
    mcpServers: assembly.mcpServers,
    settings: buildFlagSettingsArg(
      { outputStyleName: assembly.outputStyleName },
      'accept',
      logger,
      assembly.autoCompact,
      assembly.capabilityFlags,
    ),
    ...assembly.capabilityIsolation,
    extraArgs,
    ...resolveClaudeLanePermissionOptions(
      permissionHandler,
      logger,
      blankToUndefined(resumeSessionId) ??
        blankToUndefined(parentSessionId) ??
        routingId,
      cliAgentResolver,
    ),
    settingSources: certified
      ? [...certified.settingSources]
      : (['user', 'project', 'local'] as const),
    includePartialMessages: true,
    persistSession: true,
    ...(resumeSessionId && { resume: resumeSessionId }),
    env,
    stderr: handleChildStderr,
    spawnClaudeCodeProcess: (spawnOptions) =>
      processSpawner.spawn(spawnOptions, {
        onStderr: handleChildStderr,
      }),
    hooks: assembly.hooks,
    pathToClaudeCodeExecutable: certified
      ? certified.executable.sdkExecutablePath
      : executable,
  };
}

export function resolveClaudeLanePermissionOptions(
  permissionHandler: Pick<
    SdkPermissionHandler,
    'getPermissionLevel' | 'createCallback'
  >,
  logger: Logger,
  routingId: string,
  cliAgentResolver?: () => string | undefined,
): {
  permissionMode: Options['permissionMode'];
  canUseTool?: ReturnType<SdkPermissionHandler['createCallback']>;
  allowDangerouslySkipPermissions?: boolean;
} {
  const level = permissionHandler.getPermissionLevel();
  const LEVEL_TO_SDK_MODE: Record<
    string,
    NonNullable<Options['permissionMode']>
  > = {
    yolo: 'bypassPermissions',
    'auto-edit': 'acceptEdits',
    ask: 'default',
    plan: 'plan',
  };

  const sdkMode = LEVEL_TO_SDK_MODE[level] ?? 'default';

  if (sdkMode === 'bypassPermissions') {
    logger.info(
      '[PtahCliRegistry] YOLO mode: using bypassPermissions for subagent',
    );
    return {
      permissionMode: sdkMode,
      allowDangerouslySkipPermissions: true,
    };
  }

  // Two wrong branches used to live here. A non-UUID routing id (`''` from a
  // caller that minted an empty parent session) collapsed to `undefined`,
  // which makes the request unroutable and auto-denies every tool prompt on
  // timeout; anything else non-UUID (the `ptah-cli:${id}` fallback) reached
  // `SessionId.from`, which THROWS — taking the whole spawn down. Parse once,
  // keep the raw id as the routing hint so out-of-band observers can still
  // match the prompt, and say out loud when there is no routable surface.
  const routableSessionId = SessionId.safeParse(routingId) ?? undefined;
  if (!routableSessionId) {
    logger.warn(
      `[PtahCliRegistry] Spawned agent has no routable session id — tool prompts reach the agent monitor panel only, and auto-deny on timeout if that panel is not listening`,
      { routingHint: routingId, sdkMode, level },
    );
  }
  logger.info(
    `[PtahCliRegistry] Permission mode for subagent: ${sdkMode} (level: ${level})`,
    { sessionId: routableSessionId ?? null, hasCanUseTool: true },
  );
  return {
    permissionMode: sdkMode,
    canUseTool: permissionHandler.createCallback(
      routableSessionId,
      cliAgentResolver,
      undefined,
      undefined,
      routingId,
    ),
  };
}
