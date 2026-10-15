import {
  AfterViewChecked,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
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
        height: calc(100% - 72px);
      }
      .rail {
        overflow-y: auto;
      }
      @container (width < 720px) {
        .layout {
          display: flex;
          flex-direction: column;
          overflow-y: auto;
        }
        .rail {
          overflow: visible;
        }
      }
    `,
  ],
  template: `
    <header class="flex h-[72px] items-center px-4 text-lg font-semibold">
      Command Center
    </header>
    <div class="layout">
      @if (!page.canvasUnavailable()) {
        <main class="relative min-h-[320px] min-w-0">
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
        </main>
      }
      <aside class="rail flex flex-col gap-3 p-3">
        @if (page.recordWriteFailure()) {
          <p role="status" class="rounded-lg border border-warning p-2">
            The session pointer could not be saved. You can continue using this
            session.
          </p>
        }
        @if (page.store.toast(); as toast) {
          <p role="status" class="rounded-lg p-2">{{ toast.message }}</p>
          @if (toast.message.includes('Speech playback failed')) {
            <button
              type="button"
              class="btn btn-sm"
              (click)="page.retrySpeech()"
            >
              Retry speech
            </button>
          }
        }
        <ptah-command-voice-hud
          [voiceState]="page.store.voiceState()"
          [provider]="page.store.provider()"
          [muted]="page.store.muted()"
          (start)="page.startVoice()"
          (stop)="page.stopVoice()"
          (toggleMute)="page.toggleMuteVoice()"
        />
        <ptah-command-pending-input
          [pending]="page.store.pendingInput()"
          [proposal]="page.pendingProposal()"
          (confirm)="page.confirmProposal($event.proposalId)"
          (decline)="page.declineProposal($event)"
          (response)="
            page.store.pendingInput()?.kind === 'approval'
              ? page.answerPermission($event.id, $event.answer)
              : page.answerOrdinaryQuestion($event.id, $event.answer)
          "
        />
        @if (page.latestReply(); as reply) {
          <p
            class="rounded-lg border border-base-300 p-3 text-sm whitespace-pre-wrap"
          >
            {{ reply }}
          </p>
        }
        <ptah-command-work-list
          [projection]="page.projection()"
          [selectedId]="page.store.selectedId()"
          (selection)="page.store.select($event)"
        />
        <ptah-command-session-controls
          [sessionStatus]="page.store.sessionStatus()"
          (resumeSession)="page.open()"
          (newSession)="page.coordinator.newCommandCenter()"
          (requestStatus)="page.coordinator.sendStatusTurn('Status')"
          (commandSubmit)="page.sendCommand($event)"
        />
      </aside>
    </div>
  `,
})
export class CommandCenterPageComponent implements AfterViewChecked {
  public readonly page = inject(CommandCenterPageController);
  private readonly destroyRef = inject(DestroyRef);
  private readonly scene = viewChild(CommandSceneComponent);
  private readonly overlay = viewChild(CommandOverlayComponent);
  private readonly workList = viewChild(CommandWorkListComponent);
  private measuredProjection: ReturnType<
    CommandCenterPageController['projection']
  > | null = null;
  private measuredAnchorId: string | null = null;

  public constructor() {
    void this.page.open();
    this.destroyRef.onDestroy(() => {
      this.overlay()?.pinnedNodeId.set(null);
      this.overlay()?.activeNodeId.set(null);
      void this.page.exit();
    });
  }

  public ngAfterViewChecked(): void {
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
    list?.activeIndex.set(index);
    const row = document.querySelectorAll<HTMLElement>(
      '[aria-label="All session work"] button',
    )[index];
    row?.focus();
  }
}
