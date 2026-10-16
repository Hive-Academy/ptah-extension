import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  input,
  signal,
  computed,
  viewChild,
} from '@angular/core';
import { SessionEmbedComponent } from '@ptah-extension/chat';
import { CanvasStore } from '../canvas.store';
import { CanvasDetailService } from './canvas-detail.service';
import { freezeSessionOverrides } from '../canvas-session-overrides';

@Component({
  selector: 'ptah-canvas-detail-transcript',
  standalone: true,
  imports: [SessionEmbedComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block h-full min-h-0 relative', tabindex: '-1' },
  template: `<ptah-session-embed
      [tabId]="tabId()"
      [contentVisible]="visible()"
      [focused]="paneFocused()"
      [minContentWidth]="minContentWidth()"
      [startGuard]="startGuard"
      [cardActions]="cardActions"
      [retainRailTranscript]="true"
    />
    <div
      role="status"
      aria-live="polite"
      class="pointer-events-none absolute inset-x-0 top-2 z-10 flex justify-center"
    >
      @for (seq of noticeKeys(); track seq) {
        <span
          class="rounded-md bg-base-200 px-3 py-1 text-sm text-base-content shadow"
          >{{ agentNotice() }}</span
        >
      }
    </div>`,
})
export class CanvasDetailTranscriptComponent {
  private readonly canvasStore = inject(CanvasStore);
  private readonly detail = inject(CanvasDetailService, { optional: true });
  private readonly destroyRef = inject(DestroyRef);
  private noticeTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly noticeSequence = signal(0);
  readonly agentNotice = signal('');
  readonly noticeKeys = computed(() =>
    this.agentNotice() ? [this.noticeSequence()] : [],
  );
  readonly tabId = input.required<string>();
  readonly visible = input(true);
  readonly paneFocused = input(true);
  readonly splitDisplayed = input(false);
  readonly minContentWidth = computed(() =>
    this.splitDisplayed() ? 360 : null,
  );
  readonly startGuard = () => this.canvasStore.startBlockReason(this.tabId());
  readonly cardActions = {
    openLane: (key: string) => {
      if (this.detail?.open(this.tabId(), key) === true) {
        this.clearAgentNotice();
      } else {
        this.showUnavailableNotice();
      }
    },
    openSession: () => this.detail?.open(this.tabId(), 'orchestrator'),
  };
  private readonly embed = viewChild.required(SessionEmbedComponent);
  get childInjector() {
    return this.embed().childInjector;
  }

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
    this.noticeSequence.update((sequence) => sequence + 1);
    this.agentNotice.set('This agent is not available yet.');
    this.noticeTimer = setTimeout(() => this.clearAgentNotice(), 4000);
  }
}
