import {
  Injectable,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { AgentMonitorStore } from '@ptah-extension/chat-streaming';
import type { MonitoredAgent } from '@ptah-extension/chat-streaming';
import {
  ConversationRegistry,
  SurfaceId,
  TabId,
  TabManagerService,
  TabSessionBinding,
} from '@ptah-extension/chat-state';
import { WorkflowSessionClaimService } from '@ptah-extension/chat-routing';
import type { TileLayout } from '@ptah-extension/canvas';
import type {
  TribunalMove,
  TribunalTile,
  VendorLane,
} from '../types/tribunal-ui.types';

export const TRIBUNAL_MAX_VENDOR_TILES = 8;

/**
 * Sentinel active-slice key used before any real workspace path has arrived
 * from {@link TabManagerService} (app bootstrap, or the single-workspace VS
 * Code webview). A run convened during this window lives under the sentinel and
 * is migrated onto the first real path so it is never orphaned.
 */
const IMPLICIT_WORKSPACE_PATH = '__tribunal_implicit__';

/**
 * The full Tribunal run state for a single workspace. One slice per workspace
 * lives in the partition map; the public signals read from the ACTIVE slice so
 * switching workspaces instantly swaps the visible run (or the empty state).
 */
interface TribunalSlice {
  readonly tiles: readonly TribunalTile[];
  readonly move: TribunalMove;
  readonly lanes: readonly VendorLane[];
  readonly surfaceId: SurfaceId | null;
  readonly correlationId: string | null;
}

const EMPTY_SLICE: TribunalSlice = {
  tiles: [],
  move: 'council',
  lanes: [],
  surfaceId: null,
  correlationId: null,
};

/**
 * laneId prefix for a panelist tile synthesized from a spawned agent that has
 * no pre-built lane (the conductor spawned it mid-run, beyond the chosen panel).
 * Keyed by the agent id so reconciliation is idempotent across roster ticks.
 */
const DYNAMIC_LANE_PREFIX = 'tribunal-agent#';

@Injectable({ providedIn: 'root' })
export class TribunalStateService {
  private readonly agentMonitor = inject(AgentMonitorStore);
  private readonly tabSessionBinding = inject(TabSessionBinding);
  private readonly conversationRegistry = inject(ConversationRegistry);
  private readonly claims = inject(WorkflowSessionClaimService);
  private readonly tabManager = inject(TabManagerService);

  /** Per-workspace run slices. Keyed by workspace path (or the sentinel). */
  private readonly _slices = signal<ReadonlyMap<string, TribunalSlice>>(
    new Map(),
  );
  /** The workspace whose slice the public signals currently expose. */
  private readonly _activeWorkspacePath = signal<string>(
    IMPLICIT_WORKSPACE_PATH,
  );

  /** Last workspace-removal `seq` processed by the cleanup effect, so each
   *  append-only `removedWorkspace$` emission deletes its slice exactly once. */
  private _lastRemovedWorkspaceSeq = 0;

  /** The active workspace's run slice (empty when it has no staged run). */
  private readonly activeSlice = computed<TribunalSlice>(
    () => this._slices().get(this._activeWorkspacePath()) ?? EMPTY_SLICE,
  );

  readonly tiles = computed<readonly TribunalTile[]>(
    () => this.activeSlice().tiles,
  );
  readonly move = computed<TribunalMove>(() => this.activeSlice().move);
  readonly lanes = computed<readonly VendorLane[]>(
    () => this.activeSlice().lanes,
  );
  readonly surfaceId = computed<SurfaceId | null>(
    () => this.activeSlice().surfaceId,
  );
  readonly correlationId = computed<string | null>(
    () => this.activeSlice().correlationId,
  );
  readonly tribunalSessionId = computed<string | null>(() => {
    const tabId = this.correlationId();
    return tabId ? this.resolveTribunalSessionId(tabId) : null;
  });

  readonly vendorTileCount = computed(
    () => this.tiles().filter((t) => t.kind === 'vendor').length,
  );

  constructor() {
    // Seed eagerly so a run staged before the first effect flush lands in the
    // right workspace slice from the outset (avoids a bootstrap migration).
    this._activeWorkspacePath.set(
      this.tabManager.activeWorkspacePath ?? IMPLICIT_WORKSPACE_PATH,
    );

    // Keep the active-slice pointer synced with the workspace TabManager owns.
    // Switching flips which slice the public signals expose; the target slice
    // is retained in the map, so an in-flight run reappears instantly on return
    // and a workspace with no run shows the empty state.
    effect(() => {
      const path =
        this.tabManager.activeWorkspacePath$() ?? IMPLICIT_WORKSPACE_PATH;
      untracked(() => this.setActiveWorkspace(path));
    });

    // A removed workspace's run is dead — drop its slice. `removedWorkspace$`
    // is append-only (never cleared): we track our own last-seen `seq` and act
    // on each removal exactly once, so cleanup can never be skipped because
    // another consumer (e.g. OrchestraCanvasComponent) observed it first.
    effect(() => {
      const removed = this.tabManager.removedWorkspace$();
      if (removed && removed.seq > this._lastRemovedWorkspaceSeq) {
        this._lastRemovedWorkspaceSeq = removed.seq;
        untracked(() => this.deleteSlice(removed.path));
      }
    });

    // Late panelists: the conductor can spawn more agents AFTER the run started
    // (the user asks mid-run), beyond the pre-built lanes. Track the agent
    // roster (and the active run's late-resolved session) and surface each
    // unbound child of a run's conductor session as its own tile. Each new tile
    // is written into ITS run's workspace slice — so a background spawn lands in
    // the right slice even while another workspace is active — never blindly the
    // active one.
    effect(() => {
      this.agentMonitor.agents();
      this.tribunalSessionId();
      untracked(() => this.reconcileRunTiles());
    });
  }

  readonly laneBindings = computed<ReadonlyMap<string, MonitoredAgent | null>>(
    () => {
      const sessionId = this.tribunalSessionId();
      const lanes = this.lanes();
      const result = new Map<string, MonitoredAgent | null>();
      if (!sessionId) {
        for (const lane of lanes) {
          result.set(lane.laneId, null);
        }
        return result;
      }
      const agents = this.agentMonitor.agentsForSession(sessionId);
      const claimed = new Set<string>();
      for (const lane of lanes) {
        const match = this.matchLaneToAgent(lane, agents, claimed);
        if (match) {
          claimed.add(match.agentId);
        }
        result.set(lane.laneId, match ?? null);
      }
      return result;
    },
  );

  buildTilesForRun(lanes: readonly VendorLane[]): void {
    const capped = lanes.slice(0, TRIBUNAL_MAX_VENDOR_TILES);
    const tiles: TribunalTile[] = capped.map((lane, index) => ({
      tileId: lane.laneId,
      kind: 'vendor',
      laneId: lane.laneId,
      position: this.slotFor(index),
    }));
    this.updateActiveSlice((slice) => ({ ...slice, tiles }));
  }

  setMove(move: TribunalMove): void {
    this.updateActiveSlice((slice) => ({ ...slice, move }));
  }

  setLanes(lanes: readonly VendorLane[]): void {
    const capped = lanes.slice(0, TRIBUNAL_MAX_VENDOR_TILES);
    this.updateActiveSlice((slice) => ({ ...slice, lanes: capped }));
  }

  setSurfaceId(surfaceId: SurfaceId | null): void {
    this.updateActiveSlice((slice) => ({ ...slice, surfaceId }));
  }

  setCorrelationId(correlationId: string | null): void {
    this.updateActiveSlice((slice) => ({ ...slice, correlationId }));
  }

  addTile(tile: TribunalTile): boolean {
    if (
      tile.kind === 'vendor' &&
      this.vendorTileCount() >= TRIBUNAL_MAX_VENDOR_TILES
    ) {
      return false;
    }
    this.updateActiveSlice((slice) => ({
      ...slice,
      tiles: [...slice.tiles, tile],
    }));
    return true;
  }

  replaceTile(tileId: string, next: TribunalTile): void {
    this.updateActiveSlice((slice) => ({
      ...slice,
      tiles: slice.tiles.map((t) => (t.tileId === tileId ? next : t)),
    }));
  }

  updateTilePosition(tileId: string, position: TileLayout): void {
    this.updateActiveSlice((slice) => ({
      ...slice,
      tiles: slice.tiles.map((t) =>
        t.tileId === tileId ? { ...t, position } : t,
      ),
    }));
  }

  removeTile(tileId: string): void {
    this.updateActiveSlice((slice) => ({
      ...slice,
      tiles: slice.tiles.filter((t) => t.tileId !== tileId),
    }));
  }

  clearTiles(): void {
    this.updateActiveSlice((slice) => ({ ...slice, tiles: [] }));
  }

  reset(): void {
    this.updateActiveSlice(() => EMPTY_SLICE);
  }

  endRun(): void {
    const correlationId = this.correlationId();
    if (correlationId) {
      this.claims.release(correlationId);
    }
    this.reset();
  }

  /** Apply a mutation to the active workspace's slice, seeding it if absent. */
  private updateActiveSlice(
    mutate: (slice: TribunalSlice) => TribunalSlice,
  ): void {
    const key = this._activeWorkspacePath();
    this._slices.update((map) => {
      const current = map.get(key) ?? EMPTY_SLICE;
      const next = mutate(current);
      if (next === current) return map;
      return new Map(map).set(key, next);
    });
  }

  /**
   * Apply a mutation to a SPECIFIC workspace's slice (no-op if it has no slice).
   * Used by late-panelist reconciliation to write a new tile into the run's own
   * workspace, which may not be the active one when a background run spawns.
   */
  private updateSliceFor(
    path: string,
    mutate: (slice: TribunalSlice) => TribunalSlice,
  ): void {
    this._slices.update((map) => {
      const current = map.get(path);
      if (!current) return map;
      const next = mutate(current);
      if (next === current) return map;
      return new Map(map).set(path, next);
    });
  }

  /**
   * Reconcile every workspace slice that holds a run against its conductor's
   * live agent roster, adding a panelist tile for each spawned child session
   * not already bound to a lane. Idempotent: re-emitted rosters and status
   * ticks add nothing because dynamic lanes carry the agent id.
   */
  private reconcileRunTiles(): void {
    for (const [path, slice] of this._slices()) {
      const next = this.reconcileSlice(slice);
      if (next) {
        this.updateSliceFor(path, () => next);
      }
    }
  }

  /**
   * Return an updated slice with tiles/lanes added for late-spawned agents, or
   * null when nothing changes (no run, unresolved session, or every agent is
   * already represented / the vendor-tile cap is reached).
   */
  private reconcileSlice(slice: TribunalSlice): TribunalSlice | null {
    if (!slice.correlationId) return null;
    const sessionId = this.resolveTribunalSessionId(slice.correlationId);
    if (!sessionId) return null;

    const agents = this.agentMonitor.agentsForSession(sessionId);
    if (agents.length === 0) return null;

    // Agents already represented by an existing lane (pre-built or dynamic).
    const bound = new Set<string>();
    const claimed = new Set<string>();
    for (const lane of slice.lanes) {
      const match = this.matchLaneToAgent(lane, agents, claimed);
      if (match) {
        claimed.add(match.agentId);
        bound.add(match.agentId);
      }
    }

    const lanes = [...slice.lanes];
    const tiles = [...slice.tiles];
    let vendorCount = tiles.filter((t) => t.kind === 'vendor').length;
    let added = false;

    for (const agent of agents) {
      if (bound.has(agent.agentId)) continue;
      if (vendorCount >= TRIBUNAL_MAX_VENDOR_TILES) break;
      const laneId = `${DYNAMIC_LANE_PREFIX}${agent.agentId}`;
      if (lanes.some((l) => l.laneId === laneId)) continue;
      lanes.push(this.laneFromAgent(laneId, agent));
      tiles.push({
        tileId: laneId,
        kind: 'vendor',
        laneId,
        position: this.slotFor(vendorCount),
      });
      vendorCount += 1;
      added = true;
    }

    return added ? { ...slice, lanes, tiles } : null;
  }

  /** Synthesize a vendor lane from a spawned agent so its tile renders a card. */
  private laneFromAgent(laneId: string, agent: MonitoredAgent): VendorLane {
    return {
      laneId,
      family: agent.cli,
      displayName: agent.displayName ?? agent.cli,
      cli: agent.cli,
      agentId: agent.agentId,
      ...(agent.model ? { model: agent.model } : {}),
      ...(agent.ptahCliId ? { ptahCliId: agent.ptahCliId } : {}),
    };
  }

  /**
   * Point the public signals at `path`'s slice. On the first transition off the
   * bootstrap sentinel, migrate a run staged there onto the real path so a run
   * convened before the workspace path arrived is not orphaned.
   */
  private setActiveWorkspace(path: string): void {
    const prev = this._activeWorkspacePath();
    if (prev === path) return;
    if (prev === IMPLICIT_WORKSPACE_PATH && path !== IMPLICIT_WORKSPACE_PATH) {
      const implicit = this._slices().get(IMPLICIT_WORKSPACE_PATH);
      const hasRun =
        implicit !== undefined &&
        (implicit.correlationId !== null || implicit.tiles.length > 0);
      if (hasRun && !this._slices().has(path)) {
        this._slices.update((map) => {
          const next = new Map(map);
          next.set(path, implicit);
          next.delete(IMPLICIT_WORKSPACE_PATH);
          return next;
        });
      }
    }
    this._activeWorkspacePath.set(path);
  }

  /** Drop a workspace's slice entirely (workspace removed from the layout). */
  private deleteSlice(path: string): void {
    if (!this._slices().has(path)) return;
    this._slices.update((map) => {
      const next = new Map(map);
      next.delete(path);
      return next;
    });
  }

  resolveTribunalSessionId(tabId: string): string | null {
    const parsedTabId = TabId.safeParse(tabId);
    if (!parsedTabId) return null;
    const convId = this.tabSessionBinding.conversationFor(parsedTabId);
    if (!convId) return null;
    const record = this.conversationRegistry.getRecord(convId);
    if (!record || record.sessions.length === 0) return null;
    return record.sessions[record.sessions.length - 1];
  }

  private matchLaneToAgent(
    lane: VendorLane,
    agents: readonly MonitoredAgent[],
    claimed: ReadonlySet<string>,
  ): MonitoredAgent | null {
    const byTag = agents.find(
      (a) => !claimed.has(a.agentId) && this.laneTagOf(a) === lane.laneId,
    );
    if (byTag) return byTag;

    if (lane.agentId) {
      const byId = agents.find(
        (a) => !claimed.has(a.agentId) && a.agentId === lane.agentId,
      );
      if (byId) return byId;
    }

    return (
      agents.find(
        (a) =>
          !claimed.has(a.agentId) &&
          a.cli === lane.cli &&
          a.displayName === lane.displayName &&
          a.model === lane.model,
      ) ?? null
    );
  }

  private laneTagOf(agent: MonitoredAgent): string | null {
    const match = agent.task.match(/\[tribunal:([^\]]+)\]/);
    return match ? match[1].trim() : null;
  }

  private slotFor(index: number): TileLayout {
    const columns = 3;
    return {
      x: (index % columns) * 4,
      y: Math.floor(index / columns) * 6,
      w: 4,
      h: 6,
    };
  }
}
