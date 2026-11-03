import { instanceCachingFactory, type DependencyContainer } from 'tsyringe';
import { normalizeCodexHomeKey } from '../codex-home-path';
import { CodexAccountUsageClient } from '../codex-account-usage-client';
import { CodexAppServerProcess } from '../codex-app-server-process';
import type { CodexHomeAuthReader } from '../codex-home-auth-reader';
import {
  CodexRuntime,
  type CodexRuntimeUsageNotifications,
} from '../codex-runtime';
import type { CodexRuntimeOptions } from '../codex-context';
import type { CodexExecutionProfile } from '../codex-runtime.types';
import { CODEX_RUNTIME_TOKENS } from './tokens';

export interface CodexRuntimeRegistrationPorts extends CodexRuntimeOptions {
  /** Null explicitly omits account usage support for this host. */
  readonly usage: (CodexRuntimeUsageNotifications & {
    readonly auth: CodexHomeAuthReader;
    /** Composition supplies the complete usage profile for this normalized home. */
    readonly profileForHome: (home: string) => CodexExecutionProfile;
  }) | null;
}

/** Register once per host-owned container. The owner closes runtime and usage on exit.
 * Call close() explicitly on resolved runtime/client; tsyringe dispose() does not call it.
 * No process starts here. Composition supplies resolved ports; no service locator is used.
 * Hosts resolve Runtime from their scoped container for routing.
 */
export function registerCodexRuntime(
  container: DependencyContainer,
  ports: CodexRuntimeRegistrationPorts,
): void {
  if (container.isRegistered(CODEX_RUNTIME_TOKENS.Runtime, true)) {
    throw new Error('Codex runtime already registered');
  }
  container.register(CODEX_RUNTIME_TOKENS.ExecutableSource, {
    useFactory: () => ports.selectionSnapshot.current(),
  });
  container.register(CODEX_RUNTIME_TOKENS.SelectionSnapshot, {
    useValue: ports.selectionSnapshot,
  });
  container.register(CODEX_RUNTIME_TOKENS.ApprovalSink, {
    useValue: ports.sink,
  });
  container.register(CODEX_RUNTIME_TOKENS.ThreadIdentityStore, {
    useValue: ports.store,
  });
  container.register(CODEX_RUNTIME_TOKENS.Clock, { useValue: ports.clock });
  container.register(CODEX_RUNTIME_TOKENS.Logger, { useValue: ports.logger });
  container.register(CODEX_RUNTIME_TOKENS.Runtime, {
    useFactory: instanceCachingFactory(() => new CodexRuntime(ports)),
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
            async () => (await ports.selectionSnapshot.selectForOpen()).selected,
            profile,
            handlers,
          ),
        () => ports.clock.now(),
      ),
    ),
  });
}
