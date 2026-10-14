import { NgComponentOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
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
  host: { class: 'block h-full min-h-0', tabindex: '-1' },
  template: `<ng-container
    *ngComponentOutlet="chatView; environmentInjector: childInjector"
  />`,
})
export class CanvasDetailTranscriptComponent implements OnDestroy {
  private readonly parentInjector = inject(EnvironmentInjector);
  private readonly coordinator = inject(RailTranscriptRetentionCoordinator, { optional: true });
  private readonly tabManager = inject(TabManagerService);
  private readonly canvasStore = inject(CanvasStore);
  private readonly detail = inject(CanvasDetailService, { optional: true });
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
          openLane: (key: string) => this.detail?.selectLaneFor(this.tabId(), key),
          openSession: () => this.detail?.selectLaneFor(this.tabId(), 'orchestrator'),
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

  ngOnDestroy(): void {
    this.childInjector.destroy();
  }
}
