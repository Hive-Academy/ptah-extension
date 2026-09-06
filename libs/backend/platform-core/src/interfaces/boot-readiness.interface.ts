/**
 * IBootReadinessProvider — port for "how far has this host's boot got?".
 *
 * The state itself lives in the Electron host's `BootCoordinator`, a plain
 * object in `apps/ptah-electron/src/activation/`. The RPC handler that answers
 * `boot:getReadiness` lives in `rpc-handlers`, which is runtime-agnostic and
 * therefore cannot import the app. This port is the seam between the two.
 *
 * **Read-only and synchronous on purpose.** One method, no transitions and no
 * subscription: the push channel (`boot:readinessChanged`) is separate and
 * host-owned, because only a host knows how to reach its renderer. Being
 * synchronous means a handler can answer without awaiting anything, so the
 * probe cannot itself be delayed by the boot it is reporting on.
 *
 * Every host answers. `vscode-core` registers `NullBootReadinessProvider`
 * ("always ready") when nothing else has, so the VS Code and CLI hosts — which
 * have no staged boot — return a correct answer for free and no host can
 * present an unregistered token.
 */
import type { BootReadinessChangedPayload } from '@ptah-extension/shared';

export interface IBootReadinessProvider {
  /**
   * The current boot snapshot. Same shape as the `boot:readinessChanged` push,
   * deliberately: a renderer that missed the push reads exactly what a listener
   * would have received, so one consumer path handles both.
   *
   * Implementations must not throw and must not do I/O.
   */
  getReadiness(): BootReadinessChangedPayload;
}
