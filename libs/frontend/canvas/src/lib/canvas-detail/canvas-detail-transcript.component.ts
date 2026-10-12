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
} from '@angular/core';
import {
  ChatViewComponent,
  HIDE_AGENT_SIDEBAR,
  SESSION_CONTEXT,
  SESSION_FOCUSED,
  SESSION_VISIBLE,
  TabManagerService,
} from '@ptah-extension/chat';
import { SURFACE_ACTIVE } from '@ptah-extension/core';

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
  readonly tabId = input.required<string>();
  readonly chatView = ChatViewComponent;
  private readonly tabIdSignal = computed<string | null>(() => this.tabId());
  private readonly visible = signal(true);
  readonly childInjector = createEnvironmentInjector(
    [
      { provide: SESSION_CONTEXT, useValue: this.tabIdSignal },
      { provide: SESSION_VISIBLE, useValue: this.visible },
      { provide: SESSION_FOCUSED, useValue: this.visible },
      { provide: SURFACE_ACTIVE, useValue: this.visible },
      { provide: HIDE_AGENT_SIDEBAR, useValue: true },
    ],
    this.parentInjector,
  );
  private readonly registration = effect((onCleanup) => {
    const id = this.tabId();
    this.tabManager.registerVisibleTab(id);
    onCleanup(() => this.tabManager.unregisterVisibleTab(id));
  });

  ngOnDestroy(): void {
    this.childInjector.destroy();
  }
}
