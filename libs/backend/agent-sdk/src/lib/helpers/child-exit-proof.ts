/**
 * Termination proof for a Claude CLI child seen through the SDK's
 * `spawnClaudeCodeProcess` seam, read inside its `exit` listener.
 *
 * A numeric exit status is proof. A signal-only `exit` (`code === null`) is
 * how Node reports a child ended by `kill()`, which is how the SDK and an abort
 * end every interactive run. It is proof only when the handle says it observed
 * the child's own exit (`exitObserved`). The off-thread spawner sets that for a
 * real worker `exit` message and for an inline child's `exit` event. It never
 * sets it for the signal-only exit it synthesizes after losing its worker,
 * where the child may still be running.
 */
export function isChildExitProved(child: object, code: number | null): boolean {
  if (typeof code === 'number') return true;
  return 'exitObserved' in child && child.exitObserved === true;
}

/**
 * The OS pid of a child returned by the spawn seam, once known: the
 * off-thread spawner's handles report it through `whenSpawned` (the worker
 * learns it after `spawn` returns). `null` when the child never started or the
 * handle exposes no pid.
 */
export async function spawnedChildPid(child: object): Promise<number | null> {
  let pid: unknown = 'pid' in child ? child.pid : undefined;
  if ('whenSpawned' in child && child.whenSpawned instanceof Promise) pid = await child.whenSpawned;
  return typeof pid === 'number' && Number.isSafeInteger(pid) && pid > 0 ? pid : null;
}
