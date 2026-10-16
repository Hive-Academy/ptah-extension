import {
  afterEveryRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
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
        display: block;
        height: 100%;
        container-type: inline-size;
      }
      .layout {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 336px;
        gap: 16px;
        padding: 16px;
        min-height: calc(100% - 72px);
      }
      .stage {
        position: relative;
        height: max(600px, calc(100vh - 246px));
        min-height: 600px;
      }
      .rail {
        min-width: 0;
        height: calc(max(600px, 100vh - 246px) + 150px);
        overflow: hidden;
      }
      .work-list-region {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
      }
      @container (width < 720px) {
        .layout {
          display: flex;
          flex-direction: column;
        }
        .stage {
          height: 460px;
          min-height: 460px;
        }
        .work-list-region {
          overflow-y: visible;
        }
        .rail {
          height: auto;
          overflow: visible;
        }
      }
      @container (width < 480px) {
        .stage {
          height: 360px;
          min-height: 360px;
        }
      }
    `,
  ],
  template: `
    <header
      class="flex min-h-[72px] flex-wrap items-center justify-between gap-3 border-b border-base-300 px-4 py-2 text-base-content"
    >
      <div>
        <p
          class="text-xs font-semibold uppercase tracking-widest text-state-need"
        >
          Ptah / Engineering
        </p>
        <h1 class="text-xl font-semibold">Command Center</h1>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <span class="badge badge-outline min-h-8" role="status"
          >Session {{ page.store.sessionId()?.slice(0, 8) ?? 'new' }} ·
          {{ page.store.sessionStatus() }}</span
        >
        <button
          type="button"
          class="btn btn-ghost min-h-11 border border-base-content text-base-content focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-warning"
          (click)="page.openVoiceSettings()"
        >
          Voice settings
        </button>
      </div>
    </header>
    <div class="layout">
      <div class="flex min-w-0 flex-col gap-3">
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
                {{ page.store.sessionStatus() }} ·
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
              Drag to tilt orbits · Select a sphere for status
            </p>
          </main>
        }
        <div
          class="flex flex-wrap items-center gap-3 rounded-xl border border-base-300 bg-base-200 p-3"
          aria-label="Command dock"
        >
          <ptah-command-voice-hud
            class="min-w-0 flex-1"
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
          <ptah-command-session-controls
            class="min-w-0 flex-1"
            [sessionStatus]="page.store.sessionStatus()"
            (newSession)="page.coordinator.newCommandCenter()"
            (requestStatus)="page.coordinator.sendStatusTurn('Status')"
            (commandSubmit)="page.sendCommand($event)"
          />
        </div>
      </div>
      <aside class="rail relative flex flex-col gap-3">
        @if (page.recordWriteFailure()) {
          <p role="status" class="rounded-lg border border-warning p-2">
            The session pointer could not be saved. You can continue using this
            session.
          </p>
        }
        @if (page.store.toast(); as toast) {
          <div class="absolute inset-x-0 top-0 z-30 p-2">
            <div
              class="alert flex items-start gap-2 border shadow-lg"
              [class.alert-error]="toast.tone === 'error'"
              [class.alert-warning]="toast.tone === 'warning'"
              [class.alert-success]="toast.tone === 'success'"
              [class.alert-info]="toast.tone === 'info'"
              [attr.role]="toast.tone === 'error' ? 'alert' : 'status'"
            >
              <span aria-hidden="true" class="font-bold">{{
                toast.tone === 'error' ? '!' : '●'
              }}</span>
              <span class="min-w-0 flex-1 text-sm">{{ toast.message }}</span>
              @if (toast.action === 'retry-speech') {
                <button
                  type="button"
                  class="btn btn-sm"
                  (click)="page.retrySpeech()"
                >
                  Retry speech
                </button>
              }
              <button
                type="button"
                class="btn btn-ghost btn-sm"
                aria-label="Dismiss notification"
                (click)="dismissToast()"
              >
                ×
              </button>
            </div>
          </div>
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
        <div class="work-list-region">
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
  private readonly overlay = viewChild(CommandOverlayComponent);
  private readonly workList = viewChild(CommandWorkListComponent);
  private measuredProjection: ReturnType<
    CommandCenterPageController['projection']
  > | null = null;
  private measuredAnchorId: string | null = null;

  public constructor() {
    effect((onCleanup) => {
      const toast = this.page.store.toast();
      if (!toast || toast.tone === 'error') return;
      const timeout = setTimeout(() => {
        if (this.page.store.toast() === toast) this.dismissToast();
      }, 5000);
      onCleanup(() => clearTimeout(timeout));
    });
    void this.page.open();
    this.destroyRef.onDestroy(() => {
      this.overlay()?.closeCard();
      void this.page.exit();
    });
    afterEveryRender(() => this.measureOverlay());
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
