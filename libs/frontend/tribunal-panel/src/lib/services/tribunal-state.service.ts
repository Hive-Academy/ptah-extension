import { Injectable, computed, inject, signal } from '@angular/core';
import { AgentMonitorStore } from '@ptah-extension/chat-streaming';
import type { MonitoredAgent } from '@ptah-extension/chat-streaming';
import {
  ConversationRegistry,
  SurfaceId,
  TabId,
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

@Injectable({ providedIn: 'root' })
export class TribunalStateService {
  private readonly agentMonitor = inject(AgentMonitorStore);
  private readonly tabSessionBinding = inject(TabSessionBinding);
  private readonly conversationRegistry = inject(ConversationRegistry);
  private readonly claims = inject(WorkflowSessionClaimService);

  private readonly _tiles = signal<readonly TribunalTile[]>([]);
  private readonly _move = signal<TribunalMove>('council');
  private readonly _lanes = signal<readonly VendorLane[]>([]);
  private readonly _surfaceId = signal<SurfaceId | null>(null);
  private readonly _correlationId = signal<string | null>(null);

  readonly tiles = this._tiles.asReadonly();
  readonly move = this._move.asReadonly();
  readonly lanes = this._lanes.asReadonly();
  readonly surfaceId = this._surfaceId.asReadonly();
  readonly correlationId = this._correlationId.asReadonly();
  readonly tribunalSessionId = computed<string | null>(() => {
    const tabId = this._correlationId();
    return tabId ? this.resolveTribunalSessionId(tabId) : null;
  });

  readonly vendorTileCount = computed(
    () => this._tiles().filter((t) => t.kind === 'vendor').length,
  );

  readonly laneBindings = computed<ReadonlyMap<string, MonitoredAgent | null>>(
    () => {
      const sessionId = this.tribunalSessionId();
      const lanes = this._lanes();
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
    this._tiles.set(tiles);
  }

  setMove(move: TribunalMove): void {
    this._move.set(move);
  }

  setLanes(lanes: readonly VendorLane[]): void {
    this._lanes.set(lanes.slice(0, TRIBUNAL_MAX_VENDOR_TILES));
  }

  setSurfaceId(surfaceId: SurfaceId | null): void {
    this._surfaceId.set(surfaceId);
  }

  setCorrelationId(correlationId: string | null): void {
    this._correlationId.set(correlationId);
  }

  addTile(tile: TribunalTile): boolean {
    if (
      tile.kind === 'vendor' &&
      this.vendorTileCount() >= TRIBUNAL_MAX_VENDOR_TILES
    ) {
      return false;
    }
    this._tiles.update((prev) => [...prev, tile]);
    return true;
  }

  replaceTile(tileId: string, next: TribunalTile): void {
    this._tiles.update((prev) =>
      prev.map((t) => (t.tileId === tileId ? next : t)),
    );
  }

  removeTile(tileId: string): void {
    this._tiles.update((prev) => prev.filter((t) => t.tileId !== tileId));
  }

  clearTiles(): void {
    this._tiles.set([]);
  }

  reset(): void {
    this._tiles.set([]);
    this._lanes.set([]);
    this._surfaceId.set(null);
    this._correlationId.set(null);
  }

  endRun(): void {
    const correlationId = this._correlationId();
    if (correlationId) {
      this.claims.release(correlationId);
    }
    this.reset();
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
