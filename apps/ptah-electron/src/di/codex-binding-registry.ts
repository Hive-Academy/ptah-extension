/**
 * Live Electron Codex chat bindings, kept apart from the composition module so
 * shutdown can drain them without importing the rpc-handlers surface.
 */
export interface ElectronCodexBindingHandle {
  dispose(): Promise<void>;
}

const bindings = new Set<ElectronCodexBindingHandle>();

export function trackElectronCodexBinding(
  binding: ElectronCodexBindingHandle,
): () => void {
  bindings.add(binding);
  return () => {
    bindings.delete(binding);
  };
}

export function hasElectronCodexBindings(): boolean {
  return bindings.size > 0;
}

export async function disposeElectronCodexBindings(): Promise<void> {
  const results = await Promise.allSettled(
    [...bindings].map((binding) => Promise.resolve().then(() => binding.dispose())),
  );
  const failures = results.flatMap((result) =>
    result.status === 'rejected' ? [result.reason] : [],
  );
  if (failures.length)
    throw new AggregateError(failures, 'Electron Codex shutdown failed');
}
