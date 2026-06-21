import { Injectable, computed, inject, signal } from '@angular/core';
import {
  AgentMonitorStore,
  ExecutionTreeBuilderService,
} from '@ptah-extension/chat-streaming';
import type { MonitoredAgent } from '@ptah-extension/chat-streaming';
import {
  ConversationRegistry,
  SurfaceId,
  TabSessionBinding,
} from '@ptah-extension/chat-state';
import type { ExecutionNode } from '@ptah-extension/shared';
import type { TileLayout } from '@ptah-extension/canvas';
import { TribunalSurfaceService } from './tribunal-surface.service';
import type {
  ForgeDiff,
  RaceScore,
  RaceScoreCriterion,
  TribunalMove,
  TribunalTile,
  VendorLane,
} from '../types/tribunal-ui.types';

export const TRIBUNAL_MAX_VENDOR_TILES = 8;

export type TribunalPhase =
  | 'idle'
  | 'fan'
  | 'critique'
  | 'verdict'
  | 'complete';

@Injectable()
export class TribunalStateService {
  private readonly agentMonitor = inject(AgentMonitorStore);
  private readonly tabSessionBinding = inject(TabSessionBinding);
  private readonly conversationRegistry = inject(ConversationRegistry);
  private readonly surface = inject(TribunalSurfaceService);
  private readonly treeBuilder = inject(ExecutionTreeBuilderService);

  private readonly _tiles = signal<readonly TribunalTile[]>([]);
  private readonly _move = signal<TribunalMove>('council');
  private readonly _lanes = signal<readonly VendorLane[]>([]);
  private readonly _surfaceId = signal<SurfaceId | null>(null);
  private readonly _sessionId = signal<string | null>(null);
  private readonly _phase = signal<TribunalPhase>('idle');

  readonly tiles = this._tiles.asReadonly();
  readonly move = this._move.asReadonly();
  readonly lanes = this._lanes.asReadonly();
  readonly surfaceId = this._surfaceId.asReadonly();
  readonly tribunalSessionId = this._sessionId.asReadonly();
  readonly phase = this._phase.asReadonly();

  readonly vendorTileCount = computed(
    () => this._tiles().filter((t) => t.kind === 'vendor').length,
  );

  readonly laneBindings = computed<ReadonlyMap<string, MonitoredAgent | null>>(
    () => {
      this.agentMonitor.tick();
      const sessionId = this._sessionId();
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

  readonly conductorText = computed<string>(() => {
    const state = this.surface.streamingState();
    if (state.events.size === 0) return '';
    const nodes = this.treeBuilder.buildTree(state, 'tribunal-conductor');
    return this.collectAssistantText(nodes).trim();
  });

  readonly forgeDiffs = computed<ReadonlyMap<string, ForgeDiff>>(() => {
    const lanes = this._lanes();
    const sections = this.parseVendorSections(this.conductorText());
    const result = new Map<string, ForgeDiff>();
    for (const lane of lanes) {
      const section = sections.get(this.normalizeHeading(lane.displayName));
      if (!section) continue;
      result.set(lane.laneId, {
        laneId: lane.laneId,
        summary: section.summary,
        diff: section.diff,
        reviewNotes: section.reviewNotes,
      });
    }
    return result;
  });

  readonly raceScores = computed<readonly RaceScore[]>(() =>
    this.parseScoreTable(this.conductorText()),
  );

  readonly derivedPhase = computed<TribunalPhase>(() => {
    const current = this._phase();
    if (current === 'idle') return current;
    const detected = this.detectPhaseFromText(this.conductorText());
    return this.maxPhase(current, detected);
  });

  advancePhaseFromStream(): void {
    const next = this.derivedPhase();
    if (next !== this._phase()) {
      this._phase.set(next);
    }
  }

  diffForLane(laneId: string): ForgeDiff | null {
    return this.forgeDiffs().get(laneId) ?? null;
  }

  buildTilesForRun(move: TribunalMove, lanes: readonly VendorLane[]): void {
    const capped = lanes.slice(0, TRIBUNAL_MAX_VENDOR_TILES);
    const tiles: TribunalTile[] = capped.map((lane, index) => ({
      tileId: lane.laneId,
      kind: 'vendor',
      laneId: lane.laneId,
      position: this.slotFor(index),
    }));
    tiles.push({
      tileId: 'tribunal-reserved',
      kind: this.reservedKindFor(move),
      position: this.slotFor(capped.length),
    });
    this._tiles.set(tiles);
  }

  markLaneDiffReady(laneId: string): void {
    this._tiles.update((prev) =>
      prev.map((tile) =>
        tile.laneId === laneId && tile.kind === 'vendor'
          ? { ...tile, kind: 'diff' }
          : tile,
      ),
    );
  }

  setMove(move: TribunalMove): void {
    this._move.set(move);
  }

  setLanes(lanes: readonly VendorLane[]): void {
    this._lanes.set(lanes.slice(0, TRIBUNAL_MAX_VENDOR_TILES));
  }

  setSurfaceId(surfaceId: SurfaceId | null): void {
    this._surfaceId.set(surfaceId);
    this._sessionId.set(
      surfaceId ? this.resolveTribunalSessionId(surfaceId) : null,
    );
  }

  refreshSessionId(): void {
    const surfaceId = this._surfaceId();
    this._sessionId.set(
      surfaceId ? this.resolveTribunalSessionId(surfaceId) : null,
    );
  }

  setPhase(phase: TribunalPhase): void {
    this._phase.set(phase);
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
    this._sessionId.set(null);
    this._phase.set('idle');
  }

  resolveTribunalSessionId(surfaceId: SurfaceId): string | null {
    const convId = this.tabSessionBinding.conversationForSurface(surfaceId);
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

  private reservedKindFor(move: TribunalMove): TribunalTile['kind'] {
    switch (move) {
      case 'race':
        return 'scorecard';
      case 'forge':
        return 'verdict';
      default:
        return 'verdict';
    }
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

  private collectAssistantText(nodes: readonly ExecutionNode[]): string {
    const parts: string[] = [];
    for (const node of nodes) {
      if (node.type === 'text' && node.content) {
        parts.push(node.content);
      }
      if (node.children.length > 0) {
        const childText = this.collectAssistantText(node.children);
        if (childText) parts.push(childText);
      }
    }
    return parts.join('\n\n');
  }

  private detectPhaseFromText(text: string): TribunalPhase {
    if (!text) return 'fan';
    const lower = text.toLowerCase();
    if (/(##+\s*verdict|final verdict|synthes|recommendation:)/.test(lower)) {
      return 'verdict';
    }
    if (/(##+\s*critique|cross-review|critiqu|peer review)/.test(lower)) {
      return 'critique';
    }
    return 'fan';
  }

  private maxPhase(a: TribunalPhase, b: TribunalPhase): TribunalPhase {
    const order: readonly TribunalPhase[] = [
      'idle',
      'fan',
      'critique',
      'verdict',
      'complete',
    ];
    return order.indexOf(a) >= order.indexOf(b) ? a : b;
  }

  private normalizeHeading(value: string): string {
    return value.trim().toLowerCase().replace(/\s+/g, ' ');
  }

  private parseVendorSections(
    text: string,
  ): ReadonlyMap<
    string,
    { summary: string; diff: string; reviewNotes: string }
  > {
    const result = new Map<
      string,
      { summary: string; diff: string; reviewNotes: string }
    >();
    if (!text) return result;
    const headingRe = /^#{1,4}\s+(.+?)\s*$/gm;
    const matches = [...text.matchAll(headingRe)];
    for (let i = 0; i < matches.length; i++) {
      const heading = matches[i][1];
      const start = (matches[i].index ?? 0) + matches[i][0].length;
      const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
      const body = text.slice(start, end).trim();
      const fence = body.match(/```[a-zA-Z]*\n([\s\S]*?)```/);
      const diff = fence ? fence[1].trim() : '';
      const summary = (fence ? body.slice(0, fence.index ?? 0) : body).trim();
      const reviewNotes = fence
        ? body.slice((fence.index ?? 0) + fence[0].length).trim()
        : '';
      result.set(this.normalizeHeading(heading), {
        summary,
        diff,
        reviewNotes,
      });
    }
    return result;
  }

  private parseScoreTable(text: string): readonly RaceScore[] {
    if (!text) return [];
    const lines = text.split('\n');
    let header: string[] | null = null;
    let rows: string[][] = [];
    let lastHeader: string[] | null = null;
    let lastRows: string[][] = [];
    for (const raw of lines) {
      const line = raw.trim();
      if (!line.startsWith('|') || !line.endsWith('|')) {
        if (header && rows.length > 0) {
          lastHeader = header;
          lastRows = rows;
        }
        header = null;
        rows = [];
        continue;
      }
      const cells = line
        .slice(1, -1)
        .split('|')
        .map((c) => c.trim());
      if (cells.every((c) => /^:?-{2,}:?$/.test(c) || c === '')) continue;
      if (!header) {
        header = cells;
        continue;
      }
      rows.push(cells);
    }
    if (header && rows.length > 0) {
      lastHeader = header;
      lastRows = rows;
    }
    if (!lastHeader || lastRows.length === 0) return [];

    const finalHeader = lastHeader;
    const finalRows = lastRows;
    const lower = finalHeader.map((h) => h.toLowerCase());
    const vendorIdx = lower.findIndex(
      (h) => h.includes('vendor') || h.includes('model') || h.includes('agent'),
    );
    const verifyIdx = lower.findIndex(
      (h) => h.includes('verify') || h.includes('pass'),
    );
    const rankIdx = lower.findIndex((h) => h.includes('rank'));
    const vendorColumn = vendorIdx >= 0 ? vendorIdx : 0;

    return finalRows.map((cells) => {
      const criteria: RaceScoreCriterion[] = [];
      for (let c = 0; c < finalHeader.length; c++) {
        if (c === vendorColumn || c === verifyIdx || c === rankIdx) continue;
        if (!finalHeader[c]) continue;
        criteria.push({ label: finalHeader[c], value: cells[c] ?? '' });
      }
      return {
        vendor: cells[vendorColumn] ?? '',
        criteria,
        verifyPassed: this.parseVerify(verifyIdx >= 0 ? cells[verifyIdx] : ''),
        rank: this.parseRank(rankIdx >= 0 ? cells[rankIdx] : ''),
      };
    });
  }

  private parseVerify(value: string | undefined): boolean | null {
    if (!value) return null;
    const v = value.trim().toLowerCase();
    if (!v || v === '—' || v === '-' || v === 'n/a') return null;
    if (/(pass|✓|✅|yes|true|ok)/.test(v)) return true;
    if (/(fail|✗|❌|no|false)/.test(v)) return false;
    return null;
  }

  private parseRank(value: string | undefined): number | null {
    if (!value) return null;
    const match = value.match(/\d+/);
    if (!match) return null;
    const n = Number.parseInt(match[0], 10);
    return Number.isFinite(n) ? n : null;
  }
}
