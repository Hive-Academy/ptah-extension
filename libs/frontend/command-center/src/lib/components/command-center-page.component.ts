import {
  afterEveryRender,
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  effect,
  inject,
  Injector,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { ArtifactStore, DisplayDockState } from '@ptah-extension/chat';
import { VSCodeService } from '@ptah-extension/core';
import {
  sessionContextCue,
  SessionStatsSummaryComponent,
} from '@ptah-extension/chat-ui';
import type { SessionStatsEntry } from '@ptah-extension/shared';
import {
  CommandCenterStore,
  type CommandCaption,
  type CommandWorkNode,
} from '../model/command-center.store';
import { CommandCenterSessionCoordinator } from '../model/session-coordinator';
import { CommandSceneComponent } from '../scene/command-scene.component';
import { CommandOverlayComponent } from './command-overlay.component';
import { CommandPendingInputComponent } from './command-pending-input.component';
import { CommandDockComponent } from './command-dock.component';
import { CommandCenterHeaderComponent } from './command-center-header.component';
import { CommandWorkListComponent } from './command-work-list.component';
import { CommandCenterPageController } from './command-center-page.controller';
import { CommandCenterProjectionSource } from './command-center-projection.source';
import { CommandCenterStartComponent } from './command-center-start.component';
import {
  CommandNodeDetailComponent,
  type CommandChildStats,
} from './command-node-detail.component';
import { CommandSessionStatsComponent } from './command-session-stats.component';
import { CommandCaptionStripComponent } from './command-caption-strip.component';
import {
  CommandRailTabsComponent,
  railPanelId,
  railTabId,
  type CommandRailTab,
} from './command-rail-tabs.component';
import {
  CommandLivePanelComponent,
  type CommandLiveTarget,
} from './command-live-panel.component';
import { CommandRailDisplayComponent } from './command-rail-display.component';
import {
  isUserDisplayOpen,
  type DisplayDockView,
} from './command-rail-display-cue';

/** Scene space kept clear for a one-line stage caption (spec section 4). */
const CAPTION_RESERVE_PX = 72;

@Component({
  selector: 'ptah-command-center-page',
  standalone: true,
  host: {
    class: 'flex h-full min-h-0 flex-col overflow-x-hidden overflow-y-auto',
  },
  imports: [
    CommandSceneComponent,
    CommandOverlayComponent,
    CommandPendingInputComponent,
    CommandDockComponent,
    CommandCenterHeaderComponent,
    CommandWorkListComponent,
    CommandCenterStartComponent,
    CommandNodeDetailComponent,
    CommandSessionStatsComponent,
    CommandCaptionStripComponent,
    CommandRailTabsComponent,
    CommandLivePanelComponent,
    CommandRailDisplayComponent,
    SessionStatsSummaryComponent,
  ],
  providers: [
    CommandCenterStore,
    CommandCenterSessionCoordinator,
    CommandCenterProjectionSource,
    CommandCenterPageController,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './command-center-page.component.html',
  styleUrl: './command-center-page.component.css',
})
export class CommandCenterPageComponent {
  public readonly page = inject(CommandCenterPageController);
  public readonly currentStats = computed(
    () =>
      this.page.tabs
        .tabs()
        .find((tab) => tab.id === this.page.coordinator.currentTabId())
        ?.sessionStats ?? null,
  );
  public readonly rootStats = computed(
    () =>
      this.page.tabs
        .tabs()
        .find((tab) => tab.id === this.page.store.markedTabId())
        ?.sessionStats ?? null,
  );
  public readonly childStats = computed<Record<string, CommandChildStats>>(
    () => {
      const tabs = new Map(
        this.page.tabs.tabs().map((tab) => [tab.id as string, tab]),
      );
      const result: Record<string, CommandChildStats> = {};
      for (const node of this.page.projection().nodes) {
        if (!node.tabId || node.kind === 'root') continue;
        const snapshot: SessionStatsEntry | null =
          tabs.get(node.tabId)?.sessionStats ?? null;
        if (!snapshot) continue;
        const stats: CommandChildStats = {
          ...(!snapshot.provisional || snapshot.messageCount > 0
            ? { messages: snapshot.messageCount }
            : {}),
          provisional: snapshot.provisional,
          ...(typeof snapshot.tokenCount === 'number' &&
          Number.isFinite(snapshot.tokenCount)
            ? { tokens: snapshot.tokenCount }
            : {}),
          ...(typeof snapshot.totalCost === 'number' &&
          Number.isFinite(snapshot.totalCost)
            ? { costUsd: snapshot.totalCost }
            : {}),
        };
        result[node.id] = stats;
      }
      return result;
    },
  );
  public readonly contextCue = computed(() => {
    const rootId = this.page.store.markedTabId();
    const root = this.page.tabs.tabs().find((tab) => tab.id === rootId);
    return sessionContextCue(root?.liveModelStats ?? null);
  });
  public readonly contextWarning = computed(
    () => this.contextCue().known && (this.contextCue().percent ?? 0) >= 70,
  );
  public readonly stageCounts = computed(() => {
    let running = 0;
    let waiting = 0;
    for (const node of this.page.projection().nodes) {
      if (node.kind === 'root') continue;
      if (node.state === 'running') running++;
      if (node.state === 'awaiting input') waiting++;
    }
    return { running, waiting };
  });
  public readonly voiceChipReady = computed(
    () =>
      this.page.store.provider().transcription &&
      this.page.store.provider().synthesis,
  );
  public readonly voiceChipText = computed(() => {
    const { stt, tts } = this.page.store.provider();
    if (!stt || !tts) return 'Voice unavailable';
    return stt.providerId === tts.providerId
      ? `${stt.providerLabel} · ${stt.modelLabel} / ${tts.modelLabel}`
      : `${stt.providerLabel} STT · ${tts.providerLabel} TTS · ${stt.modelLabel} / ${tts.modelLabel}`;
  });
  public readonly voiceChipAriaLabel = computed(() => {
    const { stt, tts } = this.page.store.provider();
    if (!stt || !tts) return 'Voice unavailable. Open voice settings';
    return `Voice: speech-to-text ${stt.providerLabel} ${stt.modelLabel}, ${stt.status.toLowerCase()}; text-to-speech ${tts.providerLabel} ${tts.modelLabel}, ${tts.status.toLowerCase()}. Open voice settings`;
  });
  public readonly answerResult = signal<{
    id: string;
    accepted: boolean;
  } | null>(null);
  public readonly selectedNode = computed(() => {
    const nodes = this.page.projection().nodes;
    return (
      nodes.find((node) => node.id === this.page.store.selectedId()) ??
      nodes.find((node) => node.kind === 'root') ??
      null
    );
  });

  public readonly captionReserve = CAPTION_RESERVE_PX;
  public readonly activeTab = signal<CommandRailTab>('live');
  protected readonly tabId = railTabId;
  protected readonly panelId = railPanelId;
  private readonly artifactStore = inject(ArtifactStore);
  /** Electron shell panes are already chrome cards; nested chrome would double the glass. */
  protected readonly isElectron = inject(VSCodeService).isElectron;
  /**
   * One display dock for the page (Electron only, like ChatView's own): the
   * Live embed's transcript feeds it and the rail's Display tab shows it.
   */
  protected readonly displayDock: DisplayDockState | null = this.isElectron
    ? new DisplayDockState()
    : null;

  /**
   * The Live tab follows the selection up to the nearest node with its own
   * chat tab: a live child streams its tab, everything else (root, SDK and
   * CLI agents) streams the root tab, where their cards and
   * inline bubbles appear. A target whose tab is not open in the
   * `TabManagerService` (a persisted or finished child) has no live tab.
   */
  public readonly liveTarget = computed<CommandLiveTarget>(() => {
    const openTabIds = new Set<string>(
      this.page.tabs.tabs().map((tab) => tab.id),
    );
    const openTab = (id: string | null | undefined): string | null =>
      id && openTabIds.has(id) ? id : null;
    const rootTabId = openTab(this.page.store.markedTabId());
    const nodes = this.page.projection().nodes;
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const selected = byId.get(this.page.store.selectedId() ?? '') ?? null;
    const root = nodes.find((node) => node.kind === 'root') ?? null;
    let current: CommandWorkNode | null = selected;
    const seen = new Set<string>();
    while (current && current.kind !== 'root' && !seen.has(current.id)) {
      seen.add(current.id);
      if (current.kind === 'child') {
        const tabId = openTab(current.tabId);
        return {
          tabId,
          state: current.state,
          summary: tabId ? null : (current.task ?? null),
        };
      }
      current = current.parentId ? (byId.get(current.parentId) ?? null) : null;
    }
    return {
      tabId: rootTabId,
      state: rootTabId ? (root?.state ?? null) : null,
      summary: null,
    };
  });

  public readonly liveTab = computed(() => {
    const id = this.liveTarget().tabId;
    return id
      ? (this.page.tabs.tabs().find((tab) => tab.id === id) ?? null)
      : null;
  });

  /**
   * The Live embed stays content-visible under the Display tab: its
   * transcript is what feeds the dock that tab shows. The panel itself is
   * still hidden there.
   */
  public readonly liveContentVisible = computed(
    () => this.activeTab() === 'live' || this.activeTab() === 'display',
  );

  /** Surfaces and artifacts published for the target since Display was last shown. */
  private readonly unseenDisplays = signal(0);
  /**
   * The Display tab's badge. With a dock: the target's unseen displays.
   * Without one (VS Code): the target's artifact count.
   */
  public readonly displayCount = computed(() => {
    if (this.displayDock) return this.unseenDisplays();
    const id = this.liveTarget().tabId;
    return id ? (this.artifactStore.records()[id]?.length ?? 0) : 0;
  });
  public readonly displayCountUnit = this.displayDock ? 'new' : 'items';
  private seenDisplays: { tabId: string | null; total: number } = {
    tabId: null,
    total: 0,
  };
  private lastDockView: DisplayDockView | null = null;
  private knownTabIds: ReadonlySet<string> = new Set();

  /** Spoken or heard words first; otherwise a muted hint for the hovered or selected sphere. */
  public readonly stageCaption = computed<CommandCaption | null>(() => {
    const caption = this.page.store.caption();
    if (caption) return caption;
    const id = this.page.hoveredNodeId() ?? this.page.store.selectedId();
    const node = id
      ? this.page.projection().nodes.find((item) => item.id === id)
      : undefined;
    if (!node) return null;
    return {
      role: 'status',
      text: `Selected: ${node.label} · ${node.state}`,
      seq: 0,
    };
  });

  /** A session card asked for an agent: select the sphere whose id or tab carries that key. */
  public openLane(key: string): void {
    const node = this.page
      .projection()
      .nodes.find(
        (item) =>
          item.id === key || item.tabId === key || item.id.endsWith(`:${key}`),
      );
    if (node) this.page.store.select(node.id);
  }

  public dismissToast(): void {
    this.page.store.setToast(null);
  }

  public answerPendingInput(response: { id: string; answer: string }): void {
    const accepted =
      this.page.store.pendingInput()?.kind === 'approval'
        ? this.page.answerPermission(response.id, response.answer)
        : this.page.answerOrdinaryQuestion(response.id, response.answer);
    this.answerResult.set({ id: response.id, accepted });
  }
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly scene = viewChild<CommandSceneComponent>('scene');
  protected readonly overflow = computed(() => ({
    completed: this.scene()?.layout().overflowCompleted ?? 0,
    other: this.scene()?.layout().overflowOther ?? 0,
  }));
  private readonly dock = viewChild(CommandDockComponent);
  private readonly statsBand = viewChild<ElementRef<HTMLElement>>('statsBand');
  public readonly statsBandHeight = signal(72);
  private bandObserver: ResizeObserver | null = null;
  private observedBand: HTMLElement | null = null;
  private submitting = false;
  public readonly visibleLabelIds = computed(
    () =>
      this.scene()
        ?.layout()
        .nodes.filter((node) => node.labelRect !== null)
        .map((node) => node.node.id) ?? [],
  );
  private readonly overlay = viewChild(CommandOverlayComponent);
  private readonly workList = viewChild(CommandWorkListComponent);
  private readonly pendingCard = viewChild<string, ElementRef<HTMLElement>>(
    'pendingCard',
    { read: ElementRef },
  );
  private lastPendingKey: string | null = null;
  private measuredProjection: ReturnType<
    CommandCenterPageController['projection']
  > | null = null;
  private measuredAnchorId: string | null = null;

  public async submitCommand(text: string): Promise<void> {
    // The draft stays until the send resolves, so a second Enter must not send it twice.
    if (this.submitting) return;
    this.submitting = true;
    try {
      if (await this.page.sendCommand(text)) this.dock()?.clearDraft(text);
    } catch {
      // degradation-audit: reported — a thrown send gets the fixed-text toast; the draft stays for a retry
      this.page.store.setToast({
        message: 'Could not send the Command Center message.',
        tone: 'error',
      });
    } finally {
      this.submitting = false;
    }
  }

  public async requestStatus(): Promise<void> {
    try {
      if (
        this.page.store.workspace() !== this.page.tabs.activeWorkspacePath ||
        !this.page.store.markedTabId()
      ) {
        if (
          !(await this.page.open()) &&
          !this.page.coordinator.newCommandCenter()
        )
          return;
      }
      if (this.page.store.workspace() !== this.page.tabs.activeWorkspacePath)
        return;
      await this.page.coordinator.sendStatusTurn('Status');
    } catch {
      this.page.store.setSessionStatus('error');
      this.page.store.setToast({
        message: 'Could not open the Command Center session.',
        tone: 'error',
      });
    }
  }

  public constructor() {
    effect((onCleanup) => {
      const toast = this.page.store.toast();
      if (!toast || toast.tone === 'error') return;
      const timeout = setTimeout(() => {
        if (this.page.store.toast() === toast) this.dismissToast();
      }, 5000);
      onCleanup(() => clearTimeout(timeout));
    });
    void this.page.open().catch(() => {
      this.page.store.setSessionStatus('error');
      this.page.store.setToast({
        message: 'Could not open the Command Center session.',
        tone: 'error',
      });
    });
    this.destroyRef.onDestroy(() => {
      this.bandObserver?.disconnect();
      this.overlay()?.closeCard();
      void this.page.exit();
    });
    afterEveryRender(() => {
      this.observeStatsBand();
      this.measureOverlay();
      this.scrollToNewPendingCard();
    });
    if (this.displayDock) this.wireDisplayDock(this.displayDock);
  }

  /**
   * The rail's side of the shared dock: a user open in the Live transcript
   * shows the Display tab; the Display tab keeps the target's dock open (the
   * rail never closes it); a closed chat tab's dock state is released.
   */
  private wireDisplayDock(dock: DisplayDockState): void {
    effect(() => {
      const tabId = this.liveTarget().tabId;
      const next: DisplayDockView | null = tabId
        ? {
            tabId,
            state: dock.tab(tabId),
            fullscreenArtifactId: dock.fullscreenArtifact(tabId),
          }
        : null;
      const previous = this.lastDockView;
      this.lastDockView = next;
      if (previous && next && isUserDisplayOpen(previous, next)) {
        untracked(() => this.activeTab.set('display'));
      }
    });
    effect(() => {
      const tabId = this.liveTarget().tabId;
      if (!tabId || this.activeTab() !== 'display') return;
      const state = dock.tab(tabId);
      if (!state.open || state.newCount > 0) untracked(() => dock.open(tabId));
    });
    effect(() => {
      const tabId = this.liveTarget().tabId;
      // Each published surface advances surfaceRevision once; artifacts are counted directly.
      const total = tabId
        ? dock.tab(tabId).surfaceRevision +
          (this.artifactStore.records()[tabId]?.length ?? 0)
        : 0;
      const seen = this.seenDisplays;
      this.seenDisplays = { tabId, total };
      if (this.activeTab() === 'display' || seen.tabId !== tabId) {
        untracked(() => this.unseenDisplays.set(0));
      } else if (total > seen.total) {
        untracked(() => this.unseenDisplays.update((n) => n + total - seen.total));
      }
    });
    effect(() => {
      const ids = new Set<string>(
        this.page.tabs.tabs().map((tab) => tab.id),
      );
      const closed = [...this.knownTabIds].filter((id) => !ids.has(id));
      this.knownTabIds = ids;
      // tabs() lists only the active workspace; a tab open elsewhere keeps its state.
      untracked(() =>
        closed
          .filter((id) => !this.page.tabs.findTabByIdAcrossWorkspaces(id))
          .forEach((id) => dock.forgetTab(id)),
      );
    });
  }

  private observeStatsBand(): void {
    const band = this.statsBand()?.nativeElement ?? null;
    if (band === this.observedBand || typeof ResizeObserver === 'undefined') return;
    if (!this.bandObserver) {
      this.bandObserver = new ResizeObserver((entries) => {
        const entry = entries.find((candidate) => candidate.target === this.observedBand);
        if (!entry) return;
        const height = entry.borderBoxSize?.[0]?.blockSize ??
          (entry.target instanceof HTMLElement ? entry.target.getBoundingClientRect().height : 0);
        if (height > 0 && Number.isFinite(height)) this.statsBandHeight.set(height);
      });
    }
    if (this.observedBand) this.bandObserver.unobserve(this.observedBand);
    this.observedBand = band;
    if (band) this.bandObserver.observe(band);
  }

  private scrollToNewPendingCard(): void {
    const key = this.page.store.pendingInput()?.id ?? null;
    if (key === this.lastPendingKey) return;
    this.lastPendingKey = key;
    if (key)
      this.pendingCard()?.nativeElement.scrollIntoView?.({ block: 'nearest' });
  }

  public jumpToPendingCard(): void {
    this.pendingCard()?.nativeElement.scrollIntoView?.({ block: 'start' });
  }

  private measureOverlay(): void {
    const scene = this.scene();
    const overlay = this.overlay();
    if (!scene || !overlay) return;
    const projection = this.page.projection();
    if (projection !== this.measuredProjection) {
      this.measuredProjection = projection;
      scene.setOverlayLabels(overlay.getOverlayLabels());
    }
    const activeId = overlay.activeNodeId();
    if (activeId !== this.measuredAnchorId) {
      this.measuredAnchorId = activeId;
      scene.setCardAnchor(overlay.getCardAnchor(), activeId);
    }
  }

  /** The overlay's "show in list" moves to the Work tab first, then focuses the row once it renders. */
  public focusWorkRow(id: string): void {
    if (this.activeTab() !== 'work') {
      this.activeTab.set('work');
      afterNextRender(() => this.focusWorkRow(id), {
        injector: this.injector,
      });
      return;
    }
    const list = this.workList();
    const index =
      list?.projection().nodes.findIndex((node) => node.id === id) ?? -1;
    if (index < 0) return;
    list?.focusRow(index);
  }
}
