/**
 * Entry guard for `tree-sitter-worker.ts`, imported FIRST so it evaluates
 * before the engine: run bare (no Electron utility process), the bundle
 * throws this one error at once. No `electron` import: Electron provides
 * `process.parentPort` in a utility process, and its `message` events wrap
 * the payload as `{ data }`.
 */
export interface TreeSitterParentPort {
  on(event: 'message', listener: (event: { data: unknown }) => void): void;
  postMessage(message: unknown): void;
}

function isParentPort(value: unknown): value is TreeSitterParentPort {
  return (
    typeof value === 'object' &&
    value !== null &&
    'on' in value &&
    typeof value.on === 'function' &&
    'postMessage' in value &&
    typeof value.postMessage === 'function'
  );
}

function resolveParentPort(): TreeSitterParentPort {
  const candidate: unknown =
    'parentPort' in process ? process.parentPort : undefined;
  if (!isParentPort(candidate)) {
    throw new Error(
      'tree-sitter-worker.ts must be run as an Electron utilityProcess (no parentPort)',
    );
  }
  return candidate;
}

export const treeSitterWorkerParentPort: TreeSitterParentPort =
  resolveParentPort();
