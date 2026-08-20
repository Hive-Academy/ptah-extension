/**
 * `harness-sync` DI registration.
 *
 * Pre-conditions: `TOKENS.LOGGER` (vscode-core) is registered.
 *
 * The caller supplies the target list, the source resolver and the CLI
 * detector. None is defaulted, and that is the point:
 *
 * - **Targets** are host policy. A host that cannot spawn rival CLIs registers
 *   `[claudeTargetFactory]` and nothing else.
 * - **The source resolver** is where the plugin loader lives, which differs per
 *   host container. Passing it in keeps `harness-sync` free of any dependency
 *   on `agent-sdk` — see `sources/harness-source.port.ts`.
 * - **The detector** adapts whatever the host already knows about installed
 *   CLIs. It is a port for the same reason: `CliDetectionService` lives in
 *   `cli-agent-runtime`, which now depends on THIS lib for its MCP install
 *   surface, so the dependency must not run both ways.
 */

import type { DependencyContainer } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { HarnessManifestBuilder } from '../manifest/harness-manifest.builder';
import { ManagedManifestStore } from '../manifest-store/managed-manifest';
import { HarnessReconcilerService } from '../reconciler/harness-reconciler.service';
import {
  NO_CLI_DETECTOR,
  type IHarnessCliDetector,
  type IHarnessSourceResolver,
} from '../sources/harness-source.port';
import {
  NO_USER_LAYER_REFRESH,
  type IUserLayerRefresher,
} from '../sources/user-layer-refresher.port';
import { HarnessPropagationService } from '../propagation/harness-propagation.service';
import {
  HarnessPreflightService,
  type HarnessPreflightDeps,
} from '../preflight/harness-preflight.service';
import {
  HarnessGitignoreWriter,
  type HarnessGitignoreDeps,
} from '../gitignore/gitignore-writer';
import { HarnessStateStore } from '../gitignore/harness-state-store';
import { AgentSyncGate } from '../state/agent-sync-gate';
import { ClaudeTarget } from '../targets/claude-target';
import type { IHarnessTarget } from '../targets/harness-target.port';
import {
  createAntigravityTarget,
  createCodexTarget,
  createCopilotTarget,
  createCursorTarget,
  createVscodeMcpTarget,
  type RivalTargetDeps,
} from '../targets/rival-targets';
import { HARNESS_SYNC_TOKENS } from './tokens';

/**
 * Everything a target factory may need. One shape for all of them so a host
 * lists factories without knowing which ones use which dependency.
 */
export type HarnessTargetFactory = (deps: RivalTargetDeps) => IHarnessTarget;

export interface HarnessSyncRegistrationOptions {
  /**
   * Factories, not instances, so every target shares the one manifest store the
   * reconciler uses — co-ownership between Codex and Antigravity depends on it.
   */
  targets: HarnessTargetFactory[];
  sourceResolver: IHarnessSourceResolver;
  /** Defaults to "nothing installed", which skips every rival target (E17). */
  cliDetector?: IHarnessCliDetector;
  /**
   * Mirror + `reconcileAll` over the user layer. Host-supplied because it needs
   * the plugin loader, the content download service and the workspace provider
   * (see `IUserLayerRefresher`). Omitting it degrades propagation to
   * "reconcile the layer as it stands", never to a failure.
   */
  userLayerRefresher?: IUserLayerRefresher;
  /** Session-start preflight tuning; every field has a working default. */
  preflight?: HarnessPreflightDeps;
  /**
   * `.gitignore` managed block (E23). Host-supplied only to carry the
   * `harness.manageGitignore` reader — omitting it leaves the block on, which
   * is the default.
   */
  gitignore?: HarnessGitignoreDeps;
}

/** Factory for the always-on Claude target. */
export function claudeTargetFactory(deps: RivalTargetDeps): IHarnessTarget {
  return new ClaudeTarget(deps.manifestStore);
}

export {
  createAntigravityTarget as antigravityTargetFactory,
  createCodexTarget as codexTargetFactory,
  createCopilotTarget as copilotTargetFactory,
  createCursorTarget as cursorTargetFactory,
  createVscodeMcpTarget as vscodeMcpTargetFactory,
};

/**
 * Claude plus every rival surface — the list all three hosts register, because
 * a workspace is populated for the tools the USER has, not for the tool that
 * happens to be running Ptah. Undetected CLIs are skipped at reconcile time.
 */
export const ALL_HARNESS_TARGET_FACTORIES: HarnessTargetFactory[] = [
  claudeTargetFactory,
  createCodexTarget,
  createCopilotTarget,
  createCursorTarget,
  createAntigravityTarget,
  createVscodeMcpTarget,
];

export function registerHarnessSyncServices(
  container: DependencyContainer,
  logger: Logger,
  options: HarnessSyncRegistrationOptions,
): void {
  const manifestStore = new ManagedManifestStore((message, detail) =>
    logger.warn(message, toDetail(detail)),
  );
  const builder = new HarnessManifestBuilder();
  const detector = options.cliDetector ?? NO_CLI_DETECTOR;
  const targets = options.targets.map((factory) =>
    factory({ manifestStore, detector }),
  );

  container.register(HARNESS_SYNC_TOKENS.MANIFEST_STORE, {
    useValue: manifestStore,
  });
  container.register(HARNESS_SYNC_TOKENS.MANIFEST_BUILDER, {
    useValue: builder,
  });
  container.register(HARNESS_SYNC_TOKENS.SOURCE_RESOLVER, {
    useValue: options.sourceResolver,
  });
  container.register(HARNESS_SYNC_TOKENS.CLI_DETECTOR, { useValue: detector });
  for (const target of targets) {
    container.register(HARNESS_SYNC_TOKENS.TARGET, { useValue: target });
  }

  const reconcilerLogger = container.isRegistered(TOKENS.LOGGER)
    ? container.resolve<Logger>(TOKENS.LOGGER)
    : logger;
  // One state store behind both readers of `{ws}/.ptah/harness/state.json`.
  // Two instances would not corrupt anything — every write is atomic — but they
  // would warn about a malformed file twice and give a host two places to point
  // at a different path.
  const stateStore = new HarnessStateStore((message, detail) =>
    reconcilerLogger.warn(message, toDetail(detail)),
  );
  const gitignore = new HarnessGitignoreWriter(reconcilerLogger, {
    stateStore,
    ...(options.gitignore ?? {}),
  });
  container.register(HARNESS_SYNC_TOKENS.GITIGNORE, { useValue: gitignore });

  const agentSyncGate = new AgentSyncGate(manifestStore, stateStore);
  container.register(HARNESS_SYNC_TOKENS.AGENT_SYNC_GATE, {
    useValue: agentSyncGate,
  });

  const reconciler = new HarnessReconcilerService(
    reconcilerLogger,
    builder,
    manifestStore,
    options.sourceResolver,
    targets,
    gitignore,
    agentSyncGate,
  );
  container.register(HARNESS_SYNC_TOKENS.RECONCILER, { useValue: reconciler });

  const refresher = options.userLayerRefresher ?? NO_USER_LAYER_REFRESH;
  container.register(HARNESS_SYNC_TOKENS.USER_LAYER_REFRESHER, {
    useValue: refresher,
  });
  container.register(HARNESS_SYNC_TOKENS.PROPAGATION, {
    useValue: new HarnessPropagationService(
      reconcilerLogger,
      reconciler,
      refresher,
    ),
  });
  container.register(HARNESS_SYNC_TOKENS.PREFLIGHT, {
    useValue: new HarnessPreflightService(
      reconcilerLogger,
      reconciler,
      options.preflight ?? {},
    ),
  });

  logger.info('[harness-sync] services registered', {
    targets: targets.map((target) => target.id),
  });
}

/** `Logger.warn` takes a structured record; the store hands us `unknown`. */
function toDetail(detail: unknown): Record<string, unknown> | undefined {
  if (typeof detail === 'object' && detail !== null) {
    return detail as Record<string, unknown>;
  }
  return detail === undefined ? undefined : { detail };
}
