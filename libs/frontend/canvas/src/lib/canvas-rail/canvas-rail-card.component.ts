import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  forwardRef,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import {
  CompactSessionCardComponent,
  SESSION_CARD_ACTIONS,
  SESSION_FORCED_CARD,
  TabManagerService,
  type SessionCardActions,
} from '@ptah-extension/chat';
import {
  COMPACT_RAIL_CARD_HEIGHT,
  type CompactRailDensity,
  type CompactRailState,
} from '@ptah-extension/chat-ui';
import { CanvasStore } from '../canvas.store';
import { CanvasDetailService } from '../canvas-detail/canvas-detail.service';
import { isIgnoredCardClick } from '../canvas-card-click';

@Component({
  // A native li keeps the rail's role=list semantics without a wrapper node.
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'li[ptah-canvas-rail-card]',
  standalone: true,
  imports: [CompactSessionCardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    {
      provide: SESSION_CARD_ACTIONS,
      useExisting: forwardRef(() => CanvasRailCardComponent),
    },
    { provide: SESSION_FORCED_CARD, useFactory: () => signal(true) },
  ],
  host: {
    'data-rail-card': '',
    '[attr.data-tab-id]': 'tabId()',
    '[attr.data-state]': 'state()',
    '[style.height.px]': 'collapsed() ? 56 : cardHeight()',
    class: 'block relative',
    '(click)': 'onClick($event)',
    '(keydown)': 'onKeydown($event)',
  },
  styles: [
    `
      :host {
        --rail-state-ink: var(--state-ink-idle, oklch(var(--bc)));
      }
      :host([data-state='running']) {
        --rail-state-ink: var(--state-ink-run, oklch(var(--in)));
      }
      :host([data-state='needs']) {
        --rail-state-ink: var(--state-ink-need, oklch(var(--wa)));
      }
      :host([data-state='error']) {
        --rail-state-ink: var(--state-ink-err, oklch(var(--er)));
      }
      :host([data-state='done']) {
        --rail-state-ink: var(--state-ink-done, oklch(var(--su)));
      }
      :host(:has(.rc-select:focus-visible)) {
        outline: 2px solid var(--ring, oklch(var(--bc)));
        outline-offset: 2px;
      }
    `,
  ],
  template: `
    @if (tab(); as current) {
      @if (collapsed()) {
        <ptah-compact-session-card
          style="display: none"
          aria-hidden="true"
          [tab]="current"
          variant="rail"
          [density]="density()"
          [focused]="false"
          [holdText]="holdText()"
          (railState)="onRailState($event)"
        />
        <button
          type="button"
          class="flex h-14 w-full items-center justify-center gap-1 rounded-lg border border-base-content/10 bg-base-200 text-xs"
          [attr.aria-label]="current.title + ', ' + state() + ', in focus'"
          [attr.aria-current]="focused() ? 'true' : null"
          [attr.title]="current.title + ', ' + state()"
          [tabIndex]="focused() ? 0 : -1"
          (click)="openSession()"
        >
          <span
            class="h-2 w-2 rounded-full"
            [style.background]="'var(--rail-state-ink)'"
          ></span
          >{{ index() }}
        </button>
      } @else {
        <ptah-compact-session-card
          [tab]="current"
          variant="rail"
          [density]="density()"
          [focused]="focused()"
          [holdText]="holdText()"
          (expandToFull)="openSession()"
          (railState)="onRailState($event)"
          (staleAction)="onStaleAction()"
          (lanesRequested)="lanesRequested.emit(tabId())"
        />
      }
    }
    <span class="sr-only" aria-live="polite">{{ announcement() }}</span>
  `,
})
export class CanvasRailCardComponent implements SessionCardActions {
  private readonly tabs = inject(TabManagerService);
  private readonly canvasStore = inject(CanvasStore);
  private readonly detail = inject(CanvasDetailService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly tabId = input.required<string>();
  readonly density = input<CompactRailDensity>('comfortable');
  readonly focused = input(false);
  readonly collapsed = input(false);
  readonly index = input(1);
  readonly holdText = input(false);
  readonly state = input<CompactRailState>('idle');
  readonly focusRequested = output<string>();
  readonly railState = output<CompactRailState>();
  readonly staleAction = output<string>();
  readonly lanesRequested = output<string>();
  readonly announcement = signal('');
  readonly cardHeight = computed(
    () => COMPACT_RAIL_CARD_HEIGHT[this.density()],
  );
  readonly tab = computed(
    () => this.tabs.findTabByIdAcrossWorkspaces(this.tabId())?.tab ?? null,
  );

  openLane(key: string): void {
    this.detail.open(this.tabId(), key);
  }
  openSession(): void {
    this.canvasStore.focusTile(this.tabId());
    this.focusRequested.emit(this.tabId());
  }
  onRailState(state: CompactRailState): void {
    this.railState.emit(state);
  }
  onStaleAction(): void {
    this.announcement.set(
      'This request has changed. Open the current request.',
    );
    this.staleAction.emit(this.tabId());
  }
  onClick(event: MouseEvent): void {
    if (!isIgnoredCardClick(event, this.host.nativeElement)) this.openSession();
  }
  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && event.target === this.host.nativeElement) {
      this.openSession();
      event.preventDefault();
    }
  }
}
