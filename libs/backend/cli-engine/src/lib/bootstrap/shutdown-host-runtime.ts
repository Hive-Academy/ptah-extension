/**
 * Host-runtime teardown — end the OS-level resources a `ptah` process owns.
 *
 * Two subsystems hold things the operating system will not reclaim for us when
 * the event loop is abandoned:
 *
 *   1. `AgentProcessManager` — spawned CLI agent subprocesses. They are
 *      children of this process, and `process.exit` orphans anything still
 *      live. A completed continuation-capable agent holds its subprocess open
 *      on purpose, so nothing else ends it.
 *   2. `PtahCliRegistry` — the Anthropic-compatible proxy leases each ptah-cli
 *      agent talks through. Every lease is a listening socket.
 *
 * **Agents first, then proxies.** An agent subprocess speaks to its provider
 * *through* the proxy; ending the proxy first strands a live child on a dead
 * endpoint, where it will either hang or spew connection errors while it is
 * being killed anyway. This is the same order `apps/ptah-electron` uses on
 * `will-quit`.
 *
 * Each half is guarded by `isRegistered` and wrapped in its own `try/catch`, so
 * a failure in one cannot stop the other and a bootstrap that never registered
 * a subsystem (`mode: 'minimal'` registers neither) pays nothing and warns
 * about nothing.
 */

import type { DependencyContainer } from 'tsyringe';

/**
 * `TOKENS.AGENT_PROCESS_MANAGER` from `@ptah-extension/vscode-core`, resolved
 * by `Symbol.for` to keep this module dependency-light — the same rationale as
 * the token constants in `with-engine.ts`.
 */
const AGENT_PROCESS_MANAGER_TOKEN = Symbol.for('AgentProcessManager');

/**
 * `CLI_AGENT_RUNTIME_TOKENS.SDK_PTAH_CLI_REGISTRY` from
 * `@ptah-extension/cli-agent-runtime`, resolved by `Symbol.for` for the same
 * reason as {@link AGENT_PROCESS_MANAGER_TOKEN}.
 */
const PTAH_CLI_REGISTRY_TOKEN = Symbol.for('SdkPtahCliRegistry');

/**
 * The slice of `DependencyContainer` this module uses. Narrow on purpose:
 * every caller here is a teardown path, and several of them run against
 * partial test doubles that implement nothing else.
 */
type ContainerLike = Pick<DependencyContainer, 'resolve' | 'isRegistered'>;

/** Both subsystems expose the same teardown verb; only the return type differs. */
interface DisposableSubsystem {
  disposeAll(): void | Promise<void>;
}

/**
 * Resolve `token` and call `disposeAll()` on it. Never throws.
 *
 * The `isRegistered` guard sits INSIDE the `try`, not in front of it. This runs
 * on teardown paths that include the one turning an SDK init failure into
 * `sdk_init_failed`, and a container double that lacks `isRegistered` must not
 * convert that into a `TypeError` (pinned by `with-engine.spec.ts`).
 *
 * `await` covers both shapes: `AgentProcessManager.disposeAll()` is async,
 * `PtahCliRegistry.disposeAll()` is synchronous, and awaiting a non-promise is
 * a no-op tick.
 */
async function disposeSubsystem(
  container: ContainerLike,
  token: symbol,
  label: string,
): Promise<void> {
  try {
    if (
      typeof container.isRegistered !== 'function' ||
      !container.isRegistered(token)
    ) {
      return;
    }
    await container.resolve<DisposableSubsystem>(token).disposeAll();
  } catch (error: unknown) {
    // Reported on stderr rather than through the logger: this also runs from
    // signal handlers, mid-teardown, where the logger lives in the very
    // container being torn down. A teardown failure must not change the exit
    // code the caller already chose.
    process.stderr.write(
      `[ptah] ${label} disposal failed: ${
        error instanceof Error ? error.message : String(error)
      }\n`,
    );
  }
}

/**
 * End every tracked CLI agent's subprocess. Never throws. No-op when the CLI
 * agent runtime was never registered (`mode: 'minimal'`) or the container is
 * absent.
 */
export async function shutdownAgentProcesses(
  container: ContainerLike | undefined,
): Promise<void> {
  if (!container) return;
  await disposeSubsystem(
    container,
    AGENT_PROCESS_MANAGER_TOKEN,
    'agent process',
  );
}

/**
 * Stop every ptah-cli proxy lease — the current lease of each agent AND the
 * superseded leases still waiting on a holder, both of which own a listening
 * socket. Never throws.
 */
export async function shutdownPtahCliProxies(
  container: ContainerLike | undefined,
): Promise<void> {
  if (!container) return;
  await disposeSubsystem(container, PTAH_CLI_REGISTRY_TOKEN, 'ptah-cli proxy');
}

/**
 * The whole host-runtime teardown, in the one order that is safe: agent
 * subprocesses, then the proxies they were speaking through.
 *
 * Never throws, and never short-circuits — if the agent half rejects, its
 * rejection is absorbed by {@link disposeSubsystem} and the proxy half still
 * runs.
 */
export async function shutdownHostRuntime(
  container: ContainerLike | undefined,
): Promise<void> {
  await shutdownAgentProcesses(container);
  await shutdownPtahCliProxies(container);
}
