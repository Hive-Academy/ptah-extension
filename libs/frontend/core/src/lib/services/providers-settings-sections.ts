import { computed, signal, type Signal, type WritableSignal } from '@angular/core';
import type {
  RpcMethodName,
  RpcMethodParams,
  RpcMethodResult,
} from '@ptah-extension/shared';
import type { ClaudeRpcService } from './claude-rpc.service';
import type { EffortSettingsChangeService } from './effort-settings-change.service';
import type { ProvidersSettingsSection } from './providers-settings.types';
import type { WorkspaceScopeService } from './workspace-scope.service';

/**
 * Section plumbing of the Providers settings state: one store per read, scoped to the workspace
 * it was read in, with a generation that discards superseded reads. Each function takes its
 * dependencies explicitly, so the facade and its collaborators share one implementation.
 */

export const SECTION_LOAD_ERROR = 'Could not load this section. Retry.';

export interface SectionStore<T> {
  readonly value: WritableSignal<ProvidersSettingsSection<T>>;
  /** Incremented per read; a read publishes only while it is still the latest. */
  generation: number;
  /** Workspace the value was read in. A view hides a value from another workspace. */
  scopeKey: string;
}
type WorkspaceScope = Pick<WorkspaceScopeService, 'scopeKey'>;
type EffortChanges = Pick<EffortSettingsChangeService, 'pending' | 'revision'>;
type RpcCaller = Pick<ClaudeRpcService, 'call'>;

export function createSectionStore<T>(): SectionStore<T> {
  return {
    value: signal<ProvidersSettingsSection<T>>({
      status: 'unloaded',
      data: null,
      error: null,
    }),
    generation: 0,
    scopeKey: '',
  };
}

/** Read-only view of a store; a value read in another workspace shows as `unloaded`. */
export function sectionView<T>(
  store: SectionStore<T>,
  workspace: WorkspaceScope,
): Signal<ProvidersSettingsSection<T>> {
  return computed<ProvidersSettingsSection<T>>(() => {
    const state = store.value();
    return store.scopeKey === workspace.scopeKey()
      ? state
      : { status: 'unloaded', data: null, error: null };
  });
}

/**
 * View of a value that an effort change can make stale: while a change is pending, or when the
 * value was read before the latest change (`readRevision`), it shows as `loading` with no data.
 * A failed read never keeps its previous data.
 */
export function effortFreshSectionView<T>(
  store: SectionStore<T>,
  readRevision: () => number,
  workspace: WorkspaceScope,
  effortChanges: EffortChanges,
): Signal<ProvidersSettingsSection<T>> {
  const scoped = sectionView(store, workspace);
  return computed<ProvidersSettingsSection<T>>(() => {
    const state = scoped();
    if (state.status === 'unloaded') return state;
    if (effortChanges.pending() || readRevision() !== effortChanges.revision()) {
      return { status: 'loading', data: null, error: null };
    }
    return state.status === 'ready' ? state : { ...state, data: null };
  });
}

/**
 * Loads a store. Previous data of the same workspace stays visible while loading and after a
 * failure. A superseded read, or one that finishes after a workspace switch, publishes nothing.
 * The failure itself never enters state: only the fixed retry text does.
 */
export async function readSection<T>(
  store: SectionStore<T>,
  workspace: WorkspaceScope,
  request: () => Promise<T>,
): Promise<void> {
  const generation = ++store.generation;
  const scopeKey = workspace.scopeKey();
  const previous = store.scopeKey === scopeKey ? store.value().data : null;
  store.scopeKey = scopeKey;
  store.value.set({ status: 'loading', data: previous, error: null });
  try {
    const data = await request();
    if (generation === store.generation && scopeKey === workspace.scopeKey())
      store.value.set({ status: 'ready', data, error: null });
  } catch (error: unknown) {
    void error;
    if (generation === store.generation && scopeKey === workspace.scopeKey())
      store.value.set({ status: 'error', data: previous, error: SECTION_LOAD_ERROR });
  }
}

/**
 * Calls an RPC and returns its data. A failed call throws a fixed message, so host error text
 * (which can carry a credential) never reaches a caller.
 */
export async function requireRpcData<T extends RpcMethodName>(
  rpc: RpcCaller,
  method: T,
  params: RpcMethodParams<T>,
  timeout?: number,
): Promise<RpcMethodResult<T>> {
  const result = await rpc.call(method, params, timeout ? { timeout } : undefined);
  if (!result.isSuccess()) throw new Error('Settings request failed');
  return result.data;
}
