import {
  afterEveryRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { sessionContextCue } from '@ptah-extension/chat-ui';
import type { SessionStatsEntry } from '@ptah-extension/shared';
import { CommandCenterStore } from '../model/command-center.store';
import { CommandCenterSessionCoordinator } from '../model/session-coordinator';
import { CommandSceneComponent } from '../scene/command-scene.component';
import { CommandOverlayComponent } from './command-overlay.component';
import { CommandPendingInputComponent } from './command-pending-input.component';
import { CommandDockComponent } from './command-dock.component';
import { CommandCenterHeaderComponent } from './command-center-header.component';
import { CommandWorkListComponent } from './command-work-list.component';
import { CommandCenterPageController } from './command-center-page.controller';
import { CommandCenterTribunalTransport } from './command-center-tribunal.transport';
import { CommandCenterProjectionSource } from './command-center-projection.source';
import { CommandCenterStartComponent } from './command-center-start.component';
import {
  CommandNodeDetailComponent,
  type CommandChildStats,
  type CommandPhaseCount,
  phaseCountOf,
} from './command-node-detail.component';
import { CommandSessionStatsComponent } from './command-session-stats.component';

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
  ],
  providers: [
    CommandCenterStore,
    CommandCenterSessionCoordinator,
    CommandCenterTribunalTransport,
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
  public phaseCount(nodeId: string): CommandPhaseCount | null {
    return phaseCountOf(this.page.projection().nodes, nodeId);
  }
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
      if (node.kind === 'root' || node.kind === 'phase') continue;
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
    const inputId = this.page.store.pendingInput()?.id;
    const proposalId = this.page.shownProposal()?.proposalId;
    const key =
      inputId || proposalId ? `${inputId ?? ''}:${proposalId ?? ''}` : null;
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

  public focusWorkRow(id: string): void {
    const list = this.workList();
    const index =
      list?.projection().nodes.findIndex((node) => node.id === id) ?? -1;
    if (index < 0) return;
    list?.focusRow(index);
  }
}
