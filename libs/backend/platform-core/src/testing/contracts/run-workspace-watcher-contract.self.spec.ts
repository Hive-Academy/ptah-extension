/**
 * Self-test: run the workspace-watcher contract against a minimal in-memory
 * adapter built exactly the way real adapters are — one
 * `WorkspaceChangeCoalescer` per subscription, fed raw events.
 *
 * If this spec fails, either the coalescer broke a guarantee of the port or
 * the contract asserts something no coalescer-backed adapter can meet. Fix
 * one side with the other in view: every adapter runs this suite.
 */

import type { IDisposable } from '../../types/platform.types';
import type {
  IWorkspaceWatcher,
  WorkspaceChangeKind,
  WorkspaceChangeListener,
  WorkspaceWatchOptions,
} from '../../interfaces/workspace-watcher.interface';
import { WorkspaceChangeCoalescer } from '../../utils/workspace-change-coalescer';
import { runWorkspaceWatcherContract } from './run-workspace-watcher-contract';

/** An in-memory "engine": every write or delete fans out to live coalescers. */
class InMemoryWorkspaceWatcher implements IWorkspaceWatcher {
  private readonly files = new Set<string>();
  private readonly coalescers = new Set<WorkspaceChangeCoalescer>();
  readonly listenerErrors: unknown[] = [];

  watch(
    root: string,
    options: WorkspaceWatchOptions,
    listener: WorkspaceChangeListener,
  ): IDisposable {
    const coalescer = new WorkspaceChangeCoalescer(root, options, listener, {
      onListenerError: (error: unknown) => this.listenerErrors.push(error),
    });
    this.coalescers.add(coalescer);
    return {
      dispose: () => {
        coalescer.dispose();
        this.coalescers.delete(coalescer);
      },
    };
  }

  write(path: string): void {
    const kind: WorkspaceChangeKind = this.files.has(path)
      ? 'update'
      : 'create';
    this.files.add(path);
    this.emit(path, kind);
  }

  delete(path: string): void {
    this.files.delete(path);
    this.emit(path, 'delete');
  }

  /** What a native error does to every subscription: one owed rescan. */
  fail(): void {
    for (const coalescer of this.coalescers) coalescer.signalOverflow();
  }

  private emit(path: string, kind: WorkspaceChangeKind): void {
    for (const coalescer of this.coalescers) coalescer.push(path, kind);
  }
}

let current: InMemoryWorkspaceWatcher;
let rootCounter = 0;

runWorkspaceWatcherContract(
  'WorkspaceChangeCoalescer in-memory adapter',
  {
    createWatcher: () => {
      current = new InMemoryWorkspaceWatcher();
      return current;
    },
    createRoot: () => `/contract-root-${++rootCounter}`,
    writeFile: (path) => current.write(path),
    deleteFile: (path) => current.delete(path),
    triggerOverflow: () => current.fail(),
    quietObservationMs: 400,
  },
  () => {
    // The contract's recorders never throw; a reported error is a real failure.
    expect(current.listenerErrors).toEqual([]);
  },
);
