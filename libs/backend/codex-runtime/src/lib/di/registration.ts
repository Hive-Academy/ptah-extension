import { instanceCachingFactory, type DependencyContainer } from 'tsyringe';
import { normalizeCodexHomeKey } from '../codex-home-path';
import { CodexAccountUsageClient } from '../codex-account-usage-client';
import { CodexAppServerProcess } from '../codex-app-server-process';
import { codexDevRouteCovers, type CodexDevRouteOverride } from '../codex-dev-route';
import type { CodexHomeAuthReader } from '../codex-home-auth-reader';
import {
  CodexParityGate,
  type CodexParityConsumer,
  type CodexParityPlatform,
} from '../codex-parity-gate';
import { CodexRuntime } from '../codex-runtime';
import type { CodexRuntimeOptions } from '../codex-context';
import type { CodexRuntimeLogger } from '../codex-runtime-ports';
import type { CodexExecutionProfile } from '../codex-runtime.types';
import { CODEX_RUNTIME_TOKENS } from './tokens';

export interface CodexRuntimeRegistrationPorts extends CodexRuntimeOptions {
  /** Development-only chat and gateway routing; omission keeps every consumer gated. */
  readonly devRoute?: CodexDevRouteOverride | null;
  /** Null explicitly omits account usage support for this host. */
  readonly usage: {
    readonly auth: CodexHomeAuthReader;
    /** Composition supplies the complete usage profile for this normalized home. */
    readonly profileForHome: (home: string) => CodexExecutionProfile;
  } | null;
}

/** Register once per host-owned container. The owner closes runtime and usage on exit.
 * Call close() explicitly on resolved runtime/client; tsyringe dispose() does not call it.
 * No process starts here. Composition supplies resolved ports; no service locator is used.
 * Hosts must use resolveGatedCodexRuntime before routing; this registration enables no route.
 */
export function registerCodexRuntime(
  container: DependencyContainer,
  ports: CodexRuntimeRegistrationPorts,
): void {
  if (container.isRegistered(CODEX_RUNTIME_TOKENS.Runtime, true)) {
    throw new Error('Codex runtime already registered');
  }
  container.register(CODEX_RUNTIME_TOKENS.ExecutableSource, {
    useValue: ports.executable,
  });
  container.register(CODEX_RUNTIME_TOKENS.ApprovalSink, {
    useValue: ports.sink,
  });
  container.register(CODEX_RUNTIME_TOKENS.ThreadIdentityStore, {
    useValue: ports.store,
  });
  container.register(CODEX_RUNTIME_TOKENS.Clock, { useValue: ports.clock });
  container.register(CODEX_RUNTIME_TOKENS.Logger, { useValue: ports.logger });
  const devRoute = ports.devRoute ?? null;
  if (devRoute === null) {
    container.register(CODEX_RUNTIME_TOKENS.DevRouteOverride, {
      useFactory: () => null,
    });
  } else {
    container.register(CODEX_RUNTIME_TOKENS.DevRouteOverride, {
      useValue: devRoute,
    });
  }
  container.register(CODEX_RUNTIME_TOKENS.Runtime, {
    useFactory: instanceCachingFactory(() => new CodexRuntime(ports)),
  });
  container.register(CODEX_RUNTIME_TOKENS.ParityGate, {
    useFactory: instanceCachingFactory(() => new CodexParityGate()),
  });
  container.register(CodexParityGate, {
    useToken: CODEX_RUNTIME_TOKENS.ParityGate,
  });

  const usage = ports.usage;
  if (usage === null) {
    container.register(CODEX_RUNTIME_TOKENS.HomeAuthReader, {
      useFactory: () => null,
    });
    container.register<CodexAccountUsageClient | null>(
      CodexAccountUsageClient,
      { useFactory: () => null },
    );
    return;
  }
  container.register(CODEX_RUNTIME_TOKENS.HomeAuthReader, {
    useValue: usage.auth,
  });
  container.register(CodexAccountUsageClient, {
    useFactory: instanceCachingFactory(() =>
      CodexAccountUsageClient.fromProfiles(
        usage.auth,
        (home) =>
          usage.profileForHome(normalizeCodexHomeKey(home, process.platform)),
        (profile, handlers) =>
          new CodexAppServerProcess(
            ports.spawner,
            ports.executable,
            ports.binary,
            profile,
            handlers,
          ),
        () => ports.clock.now(),
      ),
    ),
  });
}

const devRouteWarnedConsumers = new WeakMap<DependencyContainer, Set<CodexParityConsumer>>();

/** Routing boundary: the raw Runtime token is for lifecycle ownership and tests only. */
export function resolveGatedCodexRuntime(
  container: DependencyContainer,
  consumer: CodexParityConsumer,
  platform: CodexParityPlatform,
): CodexRuntime {
  const gate = container.resolve<CodexParityGate>(
    CODEX_RUNTIME_TOKENS.ParityGate,
  );
  if (!gate.isEnabled(consumer, platform)) {
    const devRoute = container.resolve<CodexDevRouteOverride | null>(
      CODEX_RUNTIME_TOKENS.DevRouteOverride,
    );
    if (!codexDevRouteCovers(devRoute, consumer)) {
      throw new Error('Codex production routing disabled by parity gate');
    }
    let warnedConsumers = devRouteWarnedConsumers.get(container);
    if (!warnedConsumers) {
      warnedConsumers = new Set<CodexParityConsumer>();
      devRouteWarnedConsumers.set(container, warnedConsumers);
    }
    if (!warnedConsumers.has(consumer)) {
      container.resolve<CodexRuntimeLogger>(CODEX_RUNTIME_TOKENS.Logger).warn(
        `PTAH_CODEX_RUNTIME_DEV enables development-only Codex ${consumer} routing; production parity gate remains disabled`,
      );
      warnedConsumers.add(consumer);
    }
  }
  return container.resolve<CodexRuntime>(CODEX_RUNTIME_TOKENS.Runtime);
}
