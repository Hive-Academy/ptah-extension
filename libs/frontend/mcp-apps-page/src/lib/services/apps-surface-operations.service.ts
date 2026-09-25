import {
  DestroyRef,
  Injectable,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { ClaudeRpcService } from '@ptah-extension/core';
import type {
  SurfaceActionInvoke,
  SurfaceActionUiState,
  SurfaceInputCommit,
  SurfaceInteractionState,
} from '@ptah-extension/declarative-dashboard';
import {
  checkDraftValue,
  collectSurfaceInputs,
} from '@ptah-extension/shared/mcp-apps-contracts/surface';
import type { SurfaceSelection } from '@ptah-extension/shared/mcp-apps-contracts/surface';
import type { AppsSurfaceEntry } from '../state/apps-surface-reducer';
import { createSurfaceOperationId } from '../state/surface-operation-id';
import { AppsSessionService } from './apps-session.service';
import { AppsSubmitFlow, type AppsSubmitHost } from './apps-submit-flow';
import {
  AppsSurfaceLanes,
  hostSelectionOf,
  selectionKey,
  type AppsLaneHost,
  type AppsSelectionOverride,
} from './apps-surface-lanes';
import type { AppsUserBubble } from './apps-workspace-slice';

/**
 * `AppsSurfaceOperations` — the UI-mutation facade of the Apps page
 * (implementation-plan.md:514-615, Rules 1-4; Req 6.x).
 *
 * Root-provided in the lazy Apps lib. It turns renderer events into
 * mutations and holds the page-local interaction state the renderer shows:
 * - `change` / `select` go to the routing id's `AppsSurfaceLanes` (one send
 *   queue per surface; `surface:change`, `surface:select`);
 * - `submit` goes to the routing id's `AppsSubmitFlow` (`surface:action`,
 *   polling);
 * - `interaction(surfaceId)` merges the slice's Rule 4 overlays with the
 *   local selection override, issues and action states.
 *
 * It never calls `chat:*` and never writes a materialized revision: every
 * revision write goes through `AppsSessionService` hooks (`updateOverlays`,
 * `expectSurfaceRevision`, `requestSurfaceRead`). An effect on the active
 * slice re-pumps waiting lanes when an echo or a read lands, clears covered
 * selections and wakes a waiting submit. The same effect releases every
 * routing id no slice owns any more (`AppsSessionService.ownedRoutingIds`):
 * a discarded conversation, a failed start, or a removed workspace, active
 * or not. The session never depends on this facade.
 *
 * Public methods never throw; `console.warn` never carries a payload value.
 */

/** Page-local interaction state of one surface. */
export interface AppsSurfaceUiState {
  readonly selection: AppsSelectionOverride | null;
  readonly selectionUnsynced: boolean;
  /** Req 6.6 `role="status"` notice; null when none. */
  readonly notice: string | null;
  /** Component id → messages (change notices and submit issues). */
  readonly issues: ReadonlyMap<string, readonly string[]>;
  readonly actions: ReadonlyMap<string, SurfaceActionUiState>;
}

const EMPTY_UI: AppsSurfaceUiState = {
  selection: null,
  selectionUnsynced: false,
  notice: null,
  issues: new Map(),
  actions: new Map(),
};

interface RoutingRecord {
  readonly lanes: AppsSurfaceLanes;
  readonly flow: AppsSubmitFlow;
}

const WARN_PREFIX = '[AppsSurfaceOperations]';

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown error';
}

/** `map` without `key`; the same instance when `key` is absent. */
function withoutKey<V>(
  map: ReadonlyMap<string, V>,
  key: string,
): ReadonlyMap<string, V> {
  if (!map.has(key)) return map;
  const next = new Map(map);
  next.delete(key);
  return next;
}

@Injectable({ providedIn: 'root' })
export class AppsSurfaceOperations {
  private readonly rpc = inject(ClaudeRpcService);
  private readonly session = inject(AppsSessionService);

  private readonly records = new Map<string, RoutingRecord>();

  /** Routing id → surface id → page-local interaction state. */
  private readonly _ui = signal<
    ReadonlyMap<string, ReadonlyMap<string, AppsSurfaceUiState>>
  >(new Map());
  /** Routing id → "Submitted: …" bubbles of host-started turns. */
  private readonly _submitted = signal<
    ReadonlyMap<string, readonly AppsUserBubble[]>
  >(new Map());

  /** "Submitted: {label}" bubbles of the active conversation (plan :601). */
  public readonly submittedBubbles = computed<readonly AppsUserBubble[]>(() => {
    const routingId = this.session.routingId();
    return routingId === null ? [] : (this._submitted().get(routingId) ?? []);
  });

  public constructor() {
    effect(() => {
      const owned = this.session.ownedRoutingIds();
      const routingId = this.session.routingId();
      this.session.surfaces();
      this.session.isProcessing();
      untracked(() => this.reconcile(owned, routingId));
    });
    inject(DestroyRef).onDestroy(() => {
      for (const routingId of [...this.records.keys()]) this.release(routingId);
    });
  }

  /** The renderer's `interaction` input for `surfaceId` of the active slice. */
  public interaction(surfaceId: string): SurfaceInteractionState {
    const routingId = this.session.routingId();
    const entry =
      routingId === null
        ? null
        : (this.session.surfaces().entries.get(surfaceId) ?? null);
    const ui =
      routingId === null
        ? EMPTY_UI
        : (this._ui().get(routingId)?.get(surfaceId) ?? EMPTY_UI);
    const override =
      routingId !== null &&
      ui.selection !== null &&
      this.isOverrideShown(routingId, surfaceId, ui.selection, entry)
        ? ui.selection
        : null;
    const pendingAction = [...ui.actions.values()].some(
      (state) => state.status === 'pending',
    );
    return {
      selection: override !== null ? override.value : hostSelectionOf(entry),
      selectionUnsynced: override !== null && ui.selectionUnsynced,
      pendingValues: entry?.overlays.pendingValues() ?? new Map(),
      issues: ui.issues,
      actions: ui.actions,
      submitDisabled: this.session.isProcessing() || pendingAction,
    };
  }

  /** The Req 6.6 notice of `surfaceId` in the active slice, or null. */
  public notice(surfaceId: string): string | null {
    const routingId = this.session.routingId();
    if (routingId === null) return null;
    return this._ui().get(routingId)?.get(surfaceId)?.notice ?? null;
  }

  /** The renderer's `inputCommit`: validate, overlay, queue, send. */
  public change(surfaceId: string, commit: SurfaceInputCommit): void {
    try {
      const routingId = this.session.routingId();
      if (routingId === null) return;
      const entry = this.entryFor(routingId, surfaceId);
      if (
        entry === null ||
        entry.renderable.status !== 'accepted' ||
        entry.renderable.content.contract !== 'dashboard-spec/2'
      )
        return;
      const input = collectSurfaceInputs(
        entry.renderable.content.surface.components,
      ).find((candidate) => candidate.id === commit.componentId);
      // An invalid draft sends nothing; the renderer already marks it.
      if (input === undefined || !checkDraftValue(input, commit.value).ok)
        return;
      this.setIssue(routingId, surfaceId, commit.componentId, null);
      this.recordFor(routingId).lanes.change(
        surfaceId,
        commit.componentId,
        input.path,
        commit.value,
        entry.materializedRevision,
      );
    } catch (error: unknown) {
      console.warn(`${WARN_PREFIX} change not queued: ${errorName(error)}`);
    }
  }

  /** The renderer's `selectionChange` (null clears): show, queue, send. */
  public select(surfaceId: string, selection: SurfaceSelection | null): void {
    try {
      const routingId = this.session.routingId();
      if (routingId === null) return;
      const entry = this.entryFor(routingId, surfaceId);
      if (entry === null) return;
      const operationId = createSurfaceOperationId();
      // The next user selection clears any unsynced mark.
      this.patchUi(routingId, surfaceId, (ui) => ({
        ...ui,
        selection: {
          value: selection,
          operationId,
          hostKey: selectionKey(hostSelectionOf(entry)),
          ackRevision: null,
        },
        selectionUnsynced: false,
        notice: null,
      }));
      this.recordFor(routingId).lanes.select(surfaceId, operationId, selection);
    } catch (error: unknown) {
      console.warn(`${WARN_PREFIX} selection not queued: ${errorName(error)}`);
    }
  }

  /** The renderer's `actionInvoke` for a `surface.submit` action. */
  public submit(surfaceId: string, invoke: SurfaceActionInvoke): void {
    try {
      const routingId = this.session.routingId();
      if (routingId === null) return;
      this.recordFor(routingId).flow.submit(surfaceId, invoke.actionId);
    } catch (error: unknown) {
      console.warn(`${WARN_PREFIX} submit not started: ${errorName(error)}`);
    }
  }

  /**
   * Releases everything held for `routingId`: queues, wait timers, the submit
   * flow (its poll timer) and every RPC in flight. Idempotent.
   */
  public release(routingId: string): void {
    try {
      const record = this.records.get(routingId);
      this.records.delete(routingId);
      record?.lanes.dispose();
      record?.flow.dispose();
      this._ui.update((all) => withoutKey(all, routingId));
      this._submitted.update((all) => withoutKey(all, routingId));
    } catch (error: unknown) {
      console.warn(`${WARN_PREFIX} release failed: ${errorName(error)}`);
    }
  }

  private reconcile(
    owned: ReadonlySet<string>,
    routingId: string | null,
  ): void {
    try {
      // Discarded, failed or removed with its workspace, shown or not.
      const held = new Set([
        ...this.records.keys(),
        ...this._ui().keys(),
        ...this._submitted().keys(),
      ]);
      for (const id of held) if (!owned.has(id)) this.release(id);
      if (routingId === null) return;
      this.reconcileUi(routingId);
      const record = this.records.get(routingId);
      record?.lanes.pumpAll();
      record?.flow.onStateChanged();
    } catch (error: unknown) {
      console.warn(`${WARN_PREFIX} reconcile failed: ${errorName(error)}`);
    }
  }

  /**
   * Drops the state of surfaces no longer held, and every selection override
   * the host's own selection now covers: the ack revision materialized, or a
   * pushed selection replaced the one the user saw (the unsynced mark clears).
   */
  private reconcileUi(routingId: string): void {
    const surfaces = this._ui().get(routingId);
    if (surfaces === undefined) return;
    let next: Map<string, AppsSurfaceUiState> | null = null;
    for (const [surfaceId, ui] of surfaces) {
      const entry = this.entryFor(routingId, surfaceId);
      const covered =
        ui.selection !== null &&
        !this.isOverrideShown(routingId, surfaceId, ui.selection, entry);
      if (entry !== null && !covered) continue;
      next ??= new Map(surfaces);
      if (entry === null) next.delete(surfaceId);
      else
        next.set(surfaceId, {
          ...ui,
          selection: null,
          selectionUnsynced: false,
          notice: null,
        });
    }
    if (next === null) return;
    const replaced = next;
    this._ui.update((all) => new Map(all).set(routingId, replaced));
  }

  private isOverrideShown(
    routingId: string,
    surfaceId: string,
    override: AppsSelectionOverride,
    entry: AppsSurfaceEntry | null,
  ): boolean {
    if (entry === null) return false;
    const lanes = this.records.get(routingId)?.lanes;
    if (lanes?.isPending(surfaceId, override.operationId) === true) return true;
    if (
      override.ackRevision !== null &&
      entry.materializedRevision >= override.ackRevision
    )
      return false;
    return selectionKey(hostSelectionOf(entry)) === override.hostKey;
  }

  /** The held entry of `surfaceId`, readable only while its slice is shown. */
  private entryFor(
    routingId: string,
    surfaceId: string,
  ): AppsSurfaceEntry | null {
    if (this.session.routingId() !== routingId) return null;
    return this.session.surfaces().entries.get(surfaceId) ?? null;
  }

  private recordFor(routingId: string): RoutingRecord {
    const existing = this.records.get(routingId);
    if (existing !== undefined) return existing;
    const lanes = new AppsSurfaceLanes(
      this.rpc,
      routingId,
      this.laneHost(routingId),
    );
    const flow = new AppsSubmitFlow(
      this.rpc,
      routingId,
      this.submitHost(routingId, lanes),
    );
    const record: RoutingRecord = { lanes, flow };
    this.records.set(routingId, record);
    return record;
  }

  private laneHost(routingId: string): AppsLaneHost {
    return {
      entry: (surfaceId) => this.entryFor(routingId, surfaceId),
      isShown: () => this.session.routingId() === routingId,
      updateOverlays: (surfaceId, update) =>
        this.session.updateOverlays(routingId, surfaceId, update),
      expectRevision: (surfaceId, revision) =>
        this.session.expectSurfaceRevision(routingId, surfaceId, revision),
      requestRead: () =>
        this.session.requestSurfaceRead(routingId, 'stale-revision'),
      setIssue: (surfaceId, componentId, message) =>
        this.setIssue(routingId, surfaceId, componentId, message),
      patchSelection: (surfaceId, operationId, update) =>
        this.patchUi(routingId, surfaceId, (ui) => {
          if (ui.selection?.operationId !== operationId) return ui;
          const selection = update(ui.selection);
          return selection === ui.selection ? ui : { ...ui, selection };
        }),
      markUnsynced: (surfaceId, operationId, notice) =>
        this.patchUi(routingId, surfaceId, (ui) =>
          ui.selection?.operationId !== operationId
            ? ui
            : { ...ui, selectionUnsynced: true, notice },
        ),
      settled: () => this.records.get(routingId)?.flow.onStateChanged(),
      isSubmitting: (surfaceId) =>
        this.records.get(routingId)?.flow.isSubmitting(surfaceId) ?? false,
    };
  }

  private submitHost(
    routingId: string,
    lanes: AppsSurfaceLanes,
  ): AppsSubmitHost {
    return {
      entry: (surfaceId) => this.entryFor(routingId, surfaceId),
      isProcessing: () =>
        this.session.routingId() !== routingId || this.session.isProcessing(),
      syncState: (surfaceId) => lanes.syncState(surfaceId),
      requestRead: () =>
        this.session.requestSurfaceRead(routingId, 'echo-missing'),
      expectRevision: (surfaceId, revision) =>
        lanes.expect(surfaceId, revision),
      setAction: (surfaceId, actionId, state) =>
        this.patchUi(routingId, surfaceId, (ui) => ({
          ...ui,
          actions: new Map(ui.actions).set(actionId, state),
        })),
      setIssues: (surfaceId, issues) =>
        this.patchUi(routingId, surfaceId, (ui) =>
          ui.issues.size === 0 && issues.size === 0 ? ui : { ...ui, issues },
        ),
      submitted: (text, sentAt) =>
        this._submitted.update((all) =>
          new Map(all).set(routingId, [
            ...(all.get(routingId) ?? []),
            { text, at: sentAt },
          ]),
        ),
      submitEnded: () => lanes.pumpAll(),
    };
  }

  private setIssue(
    routingId: string,
    surfaceId: string,
    componentId: string,
    message: string | null,
  ): void {
    this.patchUi(routingId, surfaceId, (ui) => {
      if (message === null && !ui.issues.has(componentId)) return ui;
      const issues = new Map(ui.issues);
      if (message === null) issues.delete(componentId);
      else issues.set(componentId, [message]);
      return { ...ui, issues };
    });
  }

  private patchUi(
    routingId: string,
    surfaceId: string,
    update: (ui: AppsSurfaceUiState) => AppsSurfaceUiState,
  ): void {
    this._ui.update((all) => {
      const surfaces = all.get(routingId);
      const current = surfaces?.get(surfaceId) ?? EMPTY_UI;
      const next = update(current);
      if (next === current) return all;
      return new Map(all).set(
        routingId,
        new Map(surfaces ?? []).set(surfaceId, next),
      );
    });
  }
}
