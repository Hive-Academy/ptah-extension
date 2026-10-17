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
import { CommandCenterStore } from '../model/command-center.store';
import { CommandCenterSessionCoordinator } from '../model/session-coordinator';
import { CommandSceneComponent } from '../scene/command-scene.component';
import { CommandOverlayComponent } from './command-overlay.component';
import { CommandPendingInputComponent } from './command-pending-input.component';
import { CommandSessionControlsComponent } from './command-session-controls.component';
import { CommandVoiceHudComponent } from './command-voice-hud.component';
import { CommandWorkListComponent } from './command-work-list.component';
import { CommandCenterPageController } from './command-center-page.controller';
import { CommandCenterTribunalTransport } from './command-center-tribunal.transport';
import { CommandCenterProjectionSource } from './command-center-projection.source';

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
    CommandSessionControlsComponent,
    CommandVoiceHudComponent,
    CommandWorkListComponent,
  ],
  providers: [
    CommandCenterStore,
    CommandCenterSessionCoordinator,
    CommandCenterTribunalTransport,
    CommandCenterProjectionSource,
    CommandCenterPageController,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    `
      :host {
        container-type: inline-size;
      }
      .layout {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 336px;
        grid-template-areas:
          'stage rail'
          'dock dock';
        grid-template-rows: clamp(420px, calc(100vh - 280px), 620px) auto;
        flex: 0 0 auto;
        gap: 16px;
        padding: 16px;
      }
      .stage-column {
        grid-area: stage;
        min-height: 0;
      }
      .dock {
        grid-area: dock;
      }
      .stage {
        position: relative;
        flex: 1 1 auto;
        min-height: 420px;
      }
      .rail {
        grid-area: rail;
        min-width: 0;
        min-height: 0;
        max-height: clamp(420px, calc(100vh - 280px), 620px);
        overflow-y: auto;
      }
      .work-list-region {
        min-height: 0;
        flex: none;
      }
      .work-list-region:focus-visible {
        outline: 2px solid currentColor;
        outline-offset: -2px;
      }
      .pending-cue {
        display: none;
      }
      @container (width >= 1280px) {
        .dock {
          flex-wrap: nowrap;
        }
      }
      @container (width < 720px) {
        .pending-cue {
          display: block;
        }
        .layout {
          display: flex;
          flex-direction: column;
        }
        .dock:has(ptah-command-voice-hud [role='status']) {
          order: -1;
        }
        .rail {
          max-height: none;
          overflow: visible;
        }
        .work-list-region {
          flex: none;
          max-height: 24rem;
          overflow-y: auto;
          overscroll-behavior: contain;
        }
        .stage {
          flex: none;
          min-height: 460px;
        }
      }
      @container (width < 480px) {
        .stage {
          min-height: 360px;
        }
      }
    `,
  ],
  template: `
    <header
      class="flex min-h-[72px] shrink-0 flex-wrap items-center justify-between gap-3 border-b border-base-300 px-4 py-2 text-base-content"
    >
      <div>
        <p
          class="text-xs font-semibold uppercase tracking-widest text-state-need"
        >
          Ptah / Engineering
        </p>
        <h1 class="text-xl font-semibold">Command Center</h1>
      </div>
      <div class="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
        @if (page.store.voiceError()?.kind === 'mic-denied') {
          <div
            class="flex items-center gap-2 rounded-lg border border-error px-2 text-sm text-base-content"
          >
            <span>Microphone access blocked</span>
            <button
              type="button"
              class="btn btn-ghost min-h-11 underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
              (click)="page.openVoiceSettings()"
            >
              Open Voice settings
            </button>
          </div>
        }
        <button
          type="button"
          class="inline-flex min-h-11 min-w-0 max-w-full items-center gap-2 rounded-full border border-base-300 bg-base-200 px-3 font-mono text-[11px] font-semibold text-base-content focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
          [title]="voiceChipAriaLabel()"
          [attr.aria-label]="voiceChipAriaLabel()"
          (click)="page.openVoiceSettings()"
        >
          <span
            class="size-2 shrink-0 rounded-full"
            [class.bg-success]="voiceChipReady()"
            [class.bg-warning]="!voiceChipReady()"
            aria-hidden="true"
          ></span>
          <span class="min-w-0 truncate">{{ voiceChipText() }}</span>
        </button>
        <span class="badge badge-outline min-h-8 !text-xs" role="status"
          >Session {{ page.store.sessionId()?.slice(0, 8) ?? 'new' }} ·
          {{ page.shownSessionStatus() }}</span
        >
        <button
          type="button"
          class="btn btn-ghost min-h-11 border border-base-content text-base-content focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
          (click)="page.openVoiceSettings()"
        >
          Voice settings
        </button>
      </div>
    </header>
    @if (page.store.pendingInput() || page.shownProposal()) {
      <button
        type="button"
        class="pending-cue mx-4 mt-2 min-h-11 rounded-lg border border-warning bg-base-200 px-3 text-left text-sm font-semibold text-base-content focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
        (click)="jumpToPendingCard()"
      >
        Question waiting · Show question
      </button>
    }
    <div class="layout">
      <div class="stage-column relative flex min-h-0 min-w-0 flex-col">
        @if (!page.canvasUnavailable()) {
          <main
            class="stage min-w-0 overflow-hidden rounded-xl border border-base-300 bg-base-200"
          >
            <ptah-command-scene
              #scene
              [projection]="page.projection()"
              [selectedId]="page.store.selectedId()"
              [theme]="page.store.theme()"
              [voiceState]="page.store.voiceState()"
              [inputLevel]="page.store.inputLevel()"
              [outputLevel]="page.store.outputLevel()"
              (selection)="page.store.select($event)"
              (hoveredNodeId)="page.hoveredNodeId.set($event)"
              (canvasUnavailable)="page.canvasUnavailable.set($event)"
            />
            <ptah-command-overlay
              #overlay
              [projection]="page.projection()"
              [visibleLabelIds]="visibleLabelIds()"
              [hoveredNodeId]="page.hoveredNodeId()"
              [selectedId]="page.store.selectedId()"
              [reducedMotion]="page.store.reducedMotion()"
              (focusWorkListRow)="focusWorkRow($event)"
            />
            <div class="pointer-events-none absolute left-5 top-5 z-10">
              <p
                class="text-xs font-semibold uppercase tracking-widest text-state-need"
              >
                Live orchestration
              </p>
              <p class="mt-1 text-xs text-base-content-muted">
                {{ page.shownSessionStatus() }} ·
                {{ page.projection().nodes.length }} nodes
              </p>
            </div>
            <p
              class="pointer-events-none absolute right-5 top-5 z-10 text-xs font-semibold tracking-widest text-base-content-muted"
            >
              01 / Voice command
            </p>
            <p
              class="pointer-events-none absolute bottom-5 left-5 right-5 z-10 text-xs uppercase tracking-wide text-base-content-muted"
            >
              Select a sphere for status
            </p>
          </main>
        }
        @if (page.store.toast(); as toast) {
          <div
            class="page-toast absolute right-4 top-16 z-20 alert max-w-md flex items-start gap-2 border border-base-300 border-l-4 bg-base-100 text-base-content shadow-lg"
            [class.border-l-error]="toast.tone === 'error'"
            [class.border-l-warning]="toast.tone === 'warning'"
            [class.border-l-success]="toast.tone === 'success'"
            [class.border-l-info]="toast.tone === 'info'"
            [attr.role]="toast.tone === 'error' ? 'alert' : 'status'"
          >
            <span
              aria-hidden="true"
              class="font-bold"
              [class.text-error]="toast.tone === 'error'"
              [class.text-warning]="toast.tone === 'warning'"
              [class.text-success]="toast.tone === 'success'"
              [class.text-info]="toast.tone === 'info'"
              >{{ toast.tone === 'error' ? '!' : '●' }}</span
            >
            <span class="min-w-0 flex-1 text-sm">{{ toast.message }}</span>
            @if (toast.action === 'retry-speech') {
              <button
                type="button"
                class="btn btn-sm text-base-content focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
                (click)="page.retrySpeech()"
              >
                Retry speech
              </button>
            }
            @if (toast.action === 'retry-decline') {
              <button
                type="button"
                class="btn btn-sm text-base-content focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
                (click)="page.retryInvalidDecline()"
              >
                Retry Decline
              </button>
            }
            <button
              type="button"
              class="btn btn-ghost btn-sm text-base-content focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
              aria-label="Dismiss notification"
              (click)="dismissToast()"
            >
              ×
            </button>
          </div>
        }
      </div>
      <div
        class="dock flex flex-wrap items-center gap-2 rounded-xl border border-base-300 bg-base-200 p-2"
        aria-label="Command dock"
      >
        <ptah-command-session-controls
          class="min-w-0 flex-[1_1_26rem]"
          [sessionStatus]="page.shownSessionStatus()"
          (newSession)="page.coordinator.newCommandCenter()"
          (requestStatus)="requestStatus()"
          (commandSubmit)="submitCommand($event)"
        />
        <ptah-command-voice-hud
          class="min-w-0 flex-[1_1_24rem]"
          [voiceState]="page.store.voiceState()"
          [provider]="page.store.provider()"
          [muted]="page.store.muted()"
          [voiceError]="page.store.voiceError()"
          [inputLevel]="page.store.inputLevel()"
          [turnAbortable]="page.turnAbortable()"
          (start)="page.startVoice()"
          (stop)="page.stopVoice()"
          (toggleMute)="page.toggleMuteVoice()"
          (interrupt)="page.interruptSpeech()"
          (openVoiceSettings)="page.openVoiceSettings()"
        />
      </div>
      <aside class="rail flex flex-col gap-3">
        @if (page.recordWriteFailure()) {
          <p role="status" class="rounded-lg border border-warning p-2">
            The session pointer could not be saved. You can continue using this
            session.
          </p>
        }
        @if (selectedNode(); as node) {
          <section
            class="rounded-xl border border-base-300 bg-base-200 p-4 text-base-content"
            aria-label="Selected work"
          >
            <p
              class="text-xs font-semibold uppercase tracking-wide text-base-content-muted"
            >
              Selected · {{ node.kind === 'root' ? 'Orchestrator' : node.kind }}
            </p>
            <h2 class="mt-2 text-lg font-semibold">{{ node.label }}</h2>
            <p class="mt-1 text-sm text-base-content-muted">
              {{
                node.kind === 'root'
                  ? 'Your command and delegated work live here.'
                  : 'Delegated work from this session.'
              }}
            </p>
            <span class="badge badge-outline mt-3">{{ node.state }}</span>
          </section>
        }
        <ptah-command-pending-input
          #pendingCard
          [pending]="page.store.pendingInput()"
          [proposal]="page.shownProposal()"
          [choices]="page.ordinaryChoices()"
          [timedOut]="page.rosterTimedOut()"
          [answerResult]="answerResult()"
          (confirm)="page.confirmProposal($event.proposalId)"
          (decline)="page.declineProposal($event)"
          (response)="answerPendingInput($event)"
        />
        @if (page.latestReply(); as reply) {
          <p
            class="rounded-lg border border-base-300 p-3 text-sm whitespace-pre-wrap"
          >
            {{ reply }}
          </p>
        }
        <div
          class="work-list-region"
          tabindex="0"
          role="region"
          aria-label="Delegated work list"
        >
          <ptah-command-work-list
            [projection]="page.projection()"
            [selectedId]="page.store.selectedId()"
            (selection)="page.store.select($event)"
          />
        </div>
      </aside>
    </div>
  `,
})
export class CommandCenterPageComponent {
  public readonly page = inject(CommandCenterPageController);
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
  private readonly scene = viewChild(CommandSceneComponent);
  private readonly controls = viewChild(CommandSessionControlsComponent);
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
      if (await this.page.sendCommand(text)) this.controls()?.clearDraft(text);
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
        if (!(await this.page.open())) return;
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
      this.overlay()?.closeCard();
      void this.page.exit();
    });
    afterEveryRender(() => {
      this.measureOverlay();
      this.scrollToNewPendingCard();
    });
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
