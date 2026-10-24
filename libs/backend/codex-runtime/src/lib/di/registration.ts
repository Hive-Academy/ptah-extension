import type { DependencyContainer } from 'tsyringe';
import { CodexAccountUsageClient } from '../codex-account-usage-client';
import { CodexAppServerProcess } from '../codex-app-server-process';
import type { CodexHomeAuthReader } from '../codex-home-auth-reader';
import { CodexParityGate } from '../codex-parity-gate';
import { CodexRuntime, type CodexRuntimeOptions } from '../codex-runtime';
import type { CodexExecutionProfile } from '../codex-runtime.types';
import { CODEX_RUNTIME_TOKENS } from './tokens';

export interface CodexRuntimeRegistrationPorts extends CodexRuntimeOptions {
  /** Null explicitly omits account usage support for this host. */
  readonly usage: {
    readonly auth: CodexHomeAuthReader;
    /** Composition supplies the complete usage profile for this normalized home. */
    readonly profileForHome: (home: string) => CodexExecutionProfile;
  } | null;
}

/** Register once per host-owned container. The owner closes runtime and usage on exit.
 * No process starts here. Composition supplies resolved ports; no service locator is used.
 * Hosts must consult CodexParityGate before routing; this registration enables no route.
 */
export function registerCodexRuntime(
  container: DependencyContainer,
  ports: CodexRuntimeRegistrationPorts,
): void {
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
  container.register(CODEX_RUNTIME_TOKENS.Runtime, {
    useValue: new CodexRuntime(ports),
  });
  container.register(CodexParityGate, { useValue: new CodexParityGate() });

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
    useValue: new CodexAccountUsageClient(
      usage.auth,
      (home, handlers) => {
        const profile = usage.profileForHome(home);
        if (profile.consumer !== 'usage' || profile.normalizedHome !== home) {
          throw new Error('Codex usage profile identity mismatch');
        }
        return new CodexAppServerProcess(
          ports.spawner,
          ports.executable,
          ports.binary,
          profile,
          handlers,
        );
      },
      () => ports.clock.now(),
    ),
  });
}
