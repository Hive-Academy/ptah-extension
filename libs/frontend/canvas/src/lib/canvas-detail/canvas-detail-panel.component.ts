import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  input,
} from '@angular/core';
import { TabManagerService } from '@ptah-extension/chat';
import { CanvasDetailService } from './canvas-detail.service';
import { CanvasDetailTranscriptComponent } from './canvas-detail-transcript.component';
import { CanvasSessionDetailsComponent } from './canvas-session-details.component';

@Component({
  selector: 'ptah-canvas-detail-panel',
  standalone: true,
  imports: [CanvasDetailTranscriptComponent, CanvasSessionDetailsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block h-full min-h-0' },
  template: `
    <section
      class="detail relative grid grid-rows-[auto_minmax(0,1fr)] h-full min-h-0 rounded-box border border-primary/50 bg-base-100"
      role="region"
      aria-label="Session detail"
    >
      <header
        class="flex items-center gap-3 min-w-0 px-3 py-2 border-b border-base-300 bg-base-200"
      >
        <h2 class="font-semibold text-sm truncate flex-1">{{ title() }}</h2>
        <span class="badge badge-sm badge-ghost">{{ status() }}</span>
        <button
          class="btn btn-ghost btn-xs"
          type="button"
          aria-label="Close session detail"
          (click)="detail.close()"
        >
          ✕
        </button>
      </header>
      <div class="grid min-h-0 grid-cols-1 md:grid-cols-[minmax(0,1fr)_300px]">
        <div class="flex flex-col min-h-0 min-w-0">
          <nav
            aria-label="Session lanes"
            class="border-b border-base-300 min-h-9"
          >
            <ng-content select="[ptahCanvasLaneTabs]" />
          </nav>
          <div class="flex-1 min-h-0 overflow-hidden">
            @if (detail.laneKey() === 'orchestrator') {
              <ptah-canvas-detail-transcript [tabId]="tabId()" />
            } @else {
              <ng-content select="[ptahCanvasLaneView]" />
            }
          </div>
        </div>
        <ptah-canvas-session-details
          class="border-l border-base-300 max-md:max-h-48"
          [tabId]="tabId()"
        />
      </div>
    </section>
  `,
  styles: [
    `
      .detail::before {
        content: '';
        position: absolute;
        z-index: 1;
        top: -7px;
        left: var(--ptah-notch-pct, 50%);
        width: 12px;
        height: 12px;
        transform: translateX(-50%) rotate(45deg);
        background: inherit;
        border-top: inherit;
        border-left: inherit;
      }
    `,
  ],
})
export class CanvasDetailPanelComponent {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly tabs = inject(TabManagerService);
  readonly detail = inject(CanvasDetailService);
  readonly tabId = input.required<string>();
  private readonly tab = computed(() =>
    this.tabs.tabs().find((tab) => tab.id === this.tabId()),
  );
  readonly title = computed(
    () =>
      this.tab()?.title ||
      this.tab()?.name ||
      `Tab ${this.tabId().slice(0, 8)}`,
  );
  readonly status = computed(() => this.tab()?.status ?? 'Unknown');

  constructor() {
    afterNextRender(() =>
      this.host.nativeElement.scrollIntoView?.({ block: 'nearest' }),
    );
  }
}
