/**
 * Entry guard for `wal-checkpoint-worker.ts`, imported FIRST so it evaluates
 * before anything else: run bare (no Electron utility process), the bundle
 * throws this one error at once. No `electron` import — Electron provides
 * `process.parentPort` in a utility process, and its `message` events wrap the
 * payload as `{ data }`.
 */
export interface WalCheckpointParentPort {
  on(event: 'message', listener: (event: { data: unknown }) => void): void;
  postMessage(message: unknown): void;
}

function isParentPort(value: unknown): value is WalCheckpointParentPort {
  return (
    typeof value === 'object' &&
    value !== null &&
    'on' in value &&
    typeof value.on === 'function' &&
    'postMessage' in value &&
    typeof value.postMessage === 'function'
  );
}

function resolveParentPort(): WalCheckpointParentPort {
  const candidate: unknown = Reflect.get(process, 'parentPort');
  if (!isParentPort(candidate)) {
    throw new Error(
      'wal-checkpoint-worker.ts must be run as an Electron utilityProcess (no parentPort)',
    );
  }
  return candidate;
}

export const walCheckpointParentPort: WalCheckpointParentPort =
  resolveParentPort();
