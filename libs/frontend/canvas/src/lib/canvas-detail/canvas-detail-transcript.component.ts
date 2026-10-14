import { NgComponentOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  EnvironmentInjector,
  OnDestroy,
  createEnvironmentInjector,
  inject,
  input,
  signal,
  computed,
  effect,
  untracked,
} from '@angular/core';
import {
  ChatViewComponent,
  RAIL_TRANSCRIPT_RETENTION,
  RAIL_MIN_CONTENT_WIDTH,
  RailTranscriptRetentionCoordinator,
  SESSION_CARD_ACTIONS,
  SESSION_CONTEXT,
  SESSION_FOCUSED,
  SESSION_START_GUARD,
  SESSION_VISIBLE,
  TabManagerService,
} from '@ptah-extension/chat';
import { SURFACE_ACTIVE } from '@ptah-extension/core';
import { CanvasStore } from '../canvas.store';
import { CanvasDetailService } from './canvas-detail.service';
import { freezeSessionOverrides } from '../canvas-session-overrides';

@Component({
  selector: 'ptah-canvas-detail-transcript',
  standalone: true,
  imports: [NgComponentOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block h-full min-h-0 relative', tabindex: '-1' },
  template: `<ng-container
    *ngComponentOutlet="chatView; environmentInjector: childInjector"
  /><div role="status" aria-live="polite" class="pointer-events-none absolute inset-x-0 top-2 z-10 flex justify-center">
    @for (seq of noticeKeys(); track seq) {
      <span class="rounded-md bg-base-200 px-3 py-1 text-sm text-base-content shadow">{{ agentNotice() }}</span>
    }
  </div>`,
})
export class CanvasDetailTranscriptComponent implements OnDestroy {
  private readonly parentInjector = inject(EnvironmentInjector);
  private readonly coordinator = inject(RailTranscriptRetentionCoordinator, { optional: true });
  private readonly tabManager = inject(TabManagerService);
  private readonly canvasStore = inject(CanvasStore);
  private readonly detail = inject(CanvasDetailService, { optional: true });
  private readonly destroyRef = inject(DestroyRef);
  private noticeTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly noticeSequence = signal(0);
  readonly agentNotice = signal('');
  readonly noticeKeys = computed(() => this.agentNotice() ? [this.noticeSequence()] : []);
  readonly tabId = input.required<string>();
  readonly visible = input(true);
  readonly paneFocused = input(true);
  readonly splitDisplayed = input(false);
  readonly chatView = ChatViewComponent;
  private readonly tabIdSignal = computed<string | null>(() => this.tabId());
  private readonly parentActive = inject(SURFACE_ACTIVE, { optional: true }) ?? signal(true);
  private readonly active = computed(() => this.parentActive() && this.visible());
  private readonly focused = computed(() => this.active() && this.paneFocused());
  private readonly minContentWidth = computed(() => this.splitDisplayed() ? 360 : null);
  readonly childInjector = createEnvironmentInjector(
    [
      { provide: SESSION_CONTEXT, useValue: this.tabIdSignal },
      { provide: SESSION_VISIBLE, useValue: this.active },
      { provide: SESSION_FOCUSED, useValue: this.focused },
      { provide: RAIL_MIN_CONTENT_WIDTH, useValue: this.minContentWidth },
      {
        provide: SESSION_START_GUARD,
        useValue: () => this.canvasStore.startBlockReason(this.tabId()),
      },
      { provide: SURFACE_ACTIVE, useValue: this.active },
      { provide: RAIL_TRANSCRIPT_RETENTION, useValue: true },
      ...(this.coordinator ? [{ provide: RailTranscriptRetentionCoordinator, useValue: this.coordinator }] : []),
      {
        provide: SESSION_CARD_ACTIONS,
        useValue: {
          openLane: (key: string) => {
            if (this.detail?.open(this.tabId(), key) === true) {
              this.clearAgentNotice();
            } else {
              this.showUnavailableNotice();
            }
          },
          openSession: () => this.detail?.open(this.tabId(), 'orchestrator'),
        },
      },
    ],
    this.parentInjector,
  );
  private readonly registration = effect((onCleanup) => {
    const id = this.tabId();
    if (!this.parentActive()) return;
    const registered = untracked(() => {
      if (this.tabManager.visibleTabIds().has(id)) return false;
      this.tabManager.registerVisibleTab(id);
      return true;
    });
    if (registered) {
      onCleanup(() => this.tabManager.unregisterVisibleTab(id));
    }
  });

  private readonly frozenOverrides = freezeSessionOverrides(this.tabId);

  constructor() {
    this.destroyRef.onDestroy(() => this.clearAgentNotice());
  }

  private clearAgentNotice(): void {
    clearTimeout(this.noticeTimer);
    this.noticeTimer = undefined;
    this.agentNotice.set('');
  }

  private showUnavailableNotice(): void {
    clearTimeout(this.noticeTimer);
    this.noticeSequence.update(sequence => sequence + 1);
    this.agentNotice.set('This agent is not available yet.');
    this.noticeTimer = setTimeout(() => this.clearAgentNotice(), 4000);
  }

  ngOnDestroy(): void {
    this.childInjector.destroy();
  }
}
