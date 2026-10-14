import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { TabManagerService, parseLaneKey } from '@ptah-extension/chat';
import { AgentMonitorStore, BackgroundAgentStore } from '@ptah-extension/chat-streaming';
import { CanvasStore } from '../canvas.store';

/** State shared by the board, its cards and the single detail overlay. */
@Injectable()
export class CanvasDetailService {
  private readonly canvasStore = inject(CanvasStore);
  private readonly tabManager = inject(TabManagerService);
  private readonly monitor = inject(AgentMonitorStore);
  private readonly background = inject(BackgroundAgentStore);
  private readonly destroyRef = inject(DestroyRef);
  private readonly _detailTabId = signal<string | null>(null);
  private readonly _laneKeys = signal<ReadonlyMap<string, string>>(new Map());
  private listeningForClose = false;

  readonly detailTabId = this._detailTabId.asReadonly();
  readonly laneKey = computed(() => this.laneKeyFor(this.detailTabId() ?? ''));

  laneKeyFor(tabId: string): string {
    return this._laneKeys().get(tabId) ?? 'orchestrator';
  }

  selectLaneFor(tabId: string, key: string): void {
    if (!this.canvasStore.tiles().some((tile) => tile.tabId === tabId)) return;
    if (key !== 'orchestrator' && !parseLaneKey(key)) return;
    if (this.laneKeyFor(tabId) === key) return;
    if (!this.listeningForClose) {
      this.listeningForClose = true;
      const unsubscribe = this.tabManager.onTabClosed((closed) => {
        if (!closed || closed.kind === 'reset') return;
        this._laneKeys.update((current) => {
          if (!current.has(closed.tabId)) return current;
          const next = new Map(current);
          next.delete(closed.tabId);
          return next;
        });
      });
      this.destroyRef.onDestroy(unsubscribe);
    }
    this._laneKeys.update((current) => new Map(current).set(tabId, key));
  }

  open(tabId: string, laneKey = 'orchestrator'): boolean {
    if (!this.canvasStore.tiles().some((tile) => tile.tabId === tabId)) return false;
    if (laneKey !== 'orchestrator') {
      const parsed = parseLaneKey(laneKey);
      const sessionId = this.tabManager.findTabByIdAcrossWorkspaces(tabId)?.tab.claudeSessionId;
      if (!parsed || !sessionId) return false;
      const subagent = [...this.monitor.subagents().values()].some((agent) =>
        agent.parentSessionId === sessionId && agent.parentToolUseId === parsed.id &&
        (parsed.kind === 'background' ? agent.status === 'background' : parsed.kind === 'subagent'),
      );
      const exists = parsed.kind === 'cli'
        ? this.monitor.agents().some((agent) => agent.parentSessionId === sessionId && agent.agentId === parsed.id)
        : subagent || (parsed.kind === 'background' && this.background.agents().some((agent) =>
            agent.sessionId === sessionId && agent.toolCallId === parsed.id));
      if (!exists) return false;
    }
    this.canvasStore.focusTile(tabId);
    this.selectLaneFor(tabId, laneKey);
    this._detailTabId.set(null);
    return true;
  }

  selectLane(laneKey: string): void {
    const tabId = this._detailTabId();
    if (tabId) this.open(tabId, laneKey);
  }

  close(): void {
    this._detailTabId.set(null);
  }

}
