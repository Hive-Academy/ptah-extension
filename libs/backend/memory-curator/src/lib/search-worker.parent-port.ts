/**
 * Entry guard for `search-worker.ts`, imported FIRST so it evaluates before
 * any heavy module: run bare (no Electron utility process), the bundle throws
 * this one error at once. No `electron` import — Electron provides
 * `process.parentPort` in a utility process, and its `message` events wrap the
 * payload as `{ data }`.
 */
export interface ElectronParentPortLike {
  on(event: 'message', listener: (event: { data: unknown }) => void): void;
  postMessage(message: unknown): void;
}

function isParentPort(value: unknown): value is ElectronParentPortLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    'on' in value &&
    typeof value.on === 'function' &&
    'postMessage' in value &&
    typeof value.postMessage === 'function'
  );
}

function resolveParentPort(): ElectronParentPortLike {
  const candidate: unknown = 'parentPort' in process ? process.parentPort : undefined;
  if (!isParentPort(candidate)) {
    throw new Error('search-worker.ts must be run as an Electron utilityProcess (no parentPort)');
  }
  return candidate;
}

export const searchWorkerParentPort: ElectronParentPortLike = resolveParentPort();
