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
  HIDE_AGENT_SIDEBAR,
  SESSION_CONTEXT,
  SESSION_FOCUSED,
  SESSION_START_GUARD,
  SESSION_VISIBLE,
  TabManagerService,
} from '@ptah-extension/chat';
import { SURFACE_ACTIVE } from '@ptah-extension/core';
import { CanvasStore } from '../canvas.store';
import { freezeSessionOverrides } from '../canvas-session-overrides';

@Component({
  selector: 'ptah-canvas-detail-transcript',
  standalone: true,
  imports: [NgComponentOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block h-full min-h-0' },
  template: `<ng-container
    *ngComponentOutlet="chatView; environmentInjector: childInjector"
  />`,
})
export class CanvasDetailTranscriptComponent implements OnDestroy {
  private readonly parentInjector = inject(EnvironmentInjector);
  private readonly tabManager = inject(TabManagerService);
  private readonly canvasStore = inject(CanvasStore);
  readonly tabId = input.required<string>();
  readonly chatView = ChatViewComponent;
  private readonly tabIdSignal = computed<string | null>(() => this.tabId());
  private readonly active = inject(SURFACE_ACTIVE, { optional: true }) ?? signal(true);
  readonly childInjector = createEnvironmentInjector(
    [
      { provide: SESSION_CONTEXT, useValue: this.tabIdSignal },
      { provide: SESSION_VISIBLE, useValue: this.active },
      { provide: SESSION_FOCUSED, useValue: this.active },
      {
        provide: SESSION_START_GUARD,
        useValue: () => this.canvasStore.startBlockReason(this.tabId()),
      },
      { provide: SURFACE_ACTIVE, useValue: this.active },
      { provide: HIDE_AGENT_SIDEBAR, useValue: true },
    ],
    this.parentInjector,
  );
  private readonly registration = effect((onCleanup) => {
    const id = this.tabId();
    if (!this.active()) return;
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
