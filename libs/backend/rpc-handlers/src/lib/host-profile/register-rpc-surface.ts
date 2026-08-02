/**
 * registerRpcSurface — the single RPC composition engine.
 *
 * Given a container and a {@link HostProfile} it:
 *   1. installs null implementations for switched-off subsystems,
 *   2. resolves and registers every manifest entry the profile satisfies,
 *   3. wires the SDK / agent-event / session-metadata bridges,
 *   4. derives the excluded-method set from manifest x profile,
 *   5. runs `verifyAndReportRpcRegistration` against it.
 *
 * Hosts contain no RPC logic — only their profile.
 */

import type { DependencyContainer } from 'tsyringe';
import { RPC_METHOD_NAMES } from '@ptah-extension/shared';
import { TOKENS } from '@ptah-extension/vscode-core';
import type {
  Logger,
  RpcHandler,
  RpcVerificationResult,
} from '@ptah-extension/vscode-core';
import {
  wireSdkCallbacks,
  wireAgentEventListeners,
} from '@ptah-extension/cli-agent-runtime';
import { wireSessionMetadataEvents } from '@ptah-extension/agent-sdk';
import {
  MEMORY_CONTRACT_TOKENS,
  NullMemoryLister,
  NullMemoryReader,
  NullSymbolSink,
} from '@ptah-extension/memory-contracts';

import { ChatRpcHandlers } from '../handlers';
import { verifyAndReportRpcRegistration } from '../verify-and-report';
import { satisfies } from './capabilities';
import type { HostProfile } from './host-profile';
import {
  RPC_HANDLER_MANIFEST,
  assertManifestInvariants,
  type RpcHandlerCtor,
  type RpcHandlerManifestEntry,
} from './manifest';

/** What the engine registered, for logging and per-host surface specs. */
export interface RpcSurface {
  /** Methods this host serves, sorted. */
  readonly registered: readonly string[];
  /** Methods excluded because the profile switched their entry off, sorted. */
  readonly excluded: readonly string[];
}

/**
 * Derive the method partition for a profile without touching a container.
 * Exported so each host's surface spec can assert its baseline statically.
 */
export function deriveRpcSurface(profile: HostProfile): RpcSurface {
  const registered: string[] = [];
  const excluded: string[] = [];
  for (const entry of RPC_HANDLER_MANIFEST) {
    const target = satisfies(profile.capabilities, entry.requires)
      ? registered
      : excluded;
    target.push(...entry.methods);
  }
  return {
    registered: registered.sort(),
    excluded: excluded.sort(),
  };
}

export function registerRpcSurface(
  container: DependencyContainer,
  profile: HostProfile,
): RpcVerificationResult {
  const logger = container.resolve<Logger>(TOKENS.LOGGER);
  const rpcHandler = container.resolve<RpcHandler>(TOKENS.RPC_HANDLER);
  const tag = `[${profile.host} RPC]`;

  if (isDevelopment()) {
    assertManifestInvariants(RPC_METHOD_NAMES);
  }

  installNullImplementations(container, profile);
  registerHandlers(container, profile, logger, tag);
  wireBridges(container, profile, logger);

  const { excluded } = deriveRpcSurface(profile);
  const verification = verifyAndReportRpcRegistration({
    rpcHandler,
    logger,
    container,
    sentryToken: TOKENS.SENTRY_SERVICE,
    platform: profile.platform,
    excluded,
    assertInDevelopment: profile.assertOnDrift,
  });

  logger.info(`${tag} RPC surface registered`, {
    methods: rpcHandler.getRegisteredMethods(),
    excludedCount: excluded.length,
  });

  return verification;
}

/**
 * Resolve each satisfied manifest entry's handler and call `register()`.
 * A class serving several entries registers once.
 *
 * Failure semantics follow the Electron reference implementation: a
 * library-owned handler that cannot register is a build-graph bug and throws,
 * while a host-owned handler is tolerated with a warning — verification
 * immediately afterwards turns the resulting gap into drift output.
 */
function registerHandlers(
  container: DependencyContainer,
  profile: HostProfile,
  logger: Logger,
  tag: string,
): void {
  const hostHandlers = profile.hostHandlers as Readonly<
    Record<string, RpcHandlerCtor | undefined>
  >;
  const seen = new Set<RpcHandlerCtor>();

  for (const entry of RPC_HANDLER_MANIFEST as readonly RpcHandlerManifestEntry[]) {
    const enabled = satisfies(profile.capabilities, entry.requires);
    const supplied = hostHandlers[entry.key];

    if (!enabled) {
      if (supplied) {
        throw new Error(
          `${tag} profile supplies a handler for '${entry.key}' but the ` +
            `capabilities it requires (${entry.requires.join(', ')}) are off`,
        );
      }
      continue;
    }

    const Ctor = entry.handler ?? supplied;
    if (!Ctor) {
      throw new Error(
        `${tag} manifest entry '${entry.key}' is enabled but no handler is ` +
          `available — add it to the profile's hostHandlers`,
      );
    }
    if (seen.has(Ctor)) continue;
    seen.add(Ctor);

    if (entry.handler) {
      container.resolve(Ctor).register();
      continue;
    }

    try {
      container.resolve(Ctor).register();
    } catch (error: unknown) {
      logger.warn(`${tag} failed to register host handler '${entry.key}'`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/**
 * Register no-op memory contracts when the host has no memory subsystem, so
 * always-on consumers (`MemoryPromptInjector`, `CodeSymbolIndexerService`)
 * still resolve. Idempotent — a host that registered real implementations
 * earlier keeps them.
 */
function installNullImplementations(
  container: DependencyContainer,
  profile: HostProfile,
): void {
  if (profile.capabilities.memory) return;

  if (!container.isRegistered(MEMORY_CONTRACT_TOKENS.MEMORY_READER)) {
    container.register(MEMORY_CONTRACT_TOKENS.MEMORY_READER, {
      useValue: NullMemoryReader,
    });
  }
  if (!container.isRegistered(MEMORY_CONTRACT_TOKENS.MEMORY_LISTER)) {
    container.register(MEMORY_CONTRACT_TOKENS.MEMORY_LISTER, {
      useValue: NullMemoryLister,
    });
  }
  if (!container.isRegistered(MEMORY_CONTRACT_TOKENS.SYMBOL_SINK)) {
    container.register(MEMORY_CONTRACT_TOKENS.SYMBOL_SINK, {
      useValue: NullSymbolSink,
    });
  }
}

function wireBridges(
  container: DependencyContainer,
  profile: HostProfile,
  logger: Logger,
): void {
  const { wiring, platform } = profile;
  const getSdkSessionId = wiring.sdkSessionIdLookup
    ? (ptahCliId: string) =>
        container.resolve(ChatRpcHandlers).getPtahCliSdkSessionId(ptahCliId)
    : undefined;

  wireSdkCallbacks(container, {
    logger,
    platform,
    options: {
      worktree: wiring.worktree,
      resolveWorktreePath: wiring.resolveWorktreePath,
      getSdkSessionId,
    },
  });

  wireAgentEventListeners(container, {
    logger,
    platform,
    options: {
      copilotPermission: wiring.copilotPermission,
      persistCliSession: wiring.persistCliSession,
      getSdkSessionId,
    },
  });

  if (wiring.sessionMetadataEvents) {
    wireSessionMetadataEvents(container, { logger, platform });
  }
}

function isDevelopment(): boolean {
  return process.env['NODE_ENV'] === 'development';
}
