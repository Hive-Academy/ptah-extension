import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { ChevronDown, ChevronRight, LucideAngularModule } from 'lucide-angular';

export type RoutingNodeTone = 'success' | 'info' | 'warning' | 'neutral';
export type RoutingNodeState = 'ready' | 'loading' | 'error';

const DOT: Readonly<Record<RoutingNodeTone, string>> = {
  success: 'bg-success',
  info: 'bg-info',
  warning: 'bg-warning',
  neutral: 'bg-base-content-muted',
};

/**
 * One work node of the routing map (design-spec §2.1/§3.1, prototype `.routing-work-node`): a status
 * dot always paired with visible status text, an uppercase title, a header slot (`[node-badges]`,
 * e.g. the Main Agent's D16 scope badges), the projected preview, and a footer with its action.
 *
 * The footer action is the node's one real `<button>`, stretched over the whole node (`after:inset-0`),
 * so the entire node is one keyboard-operable target without nesting interactive elements: header
 * badges sit above the stretch (`relative z-10`) and keep their own clicks.
 *
 * While its section loads the node shows a skeleton (`aria-busy`); a failed read shows fixed copy and
 * Retry instead of the preview, and the node action stays available.
 */
@Component({
  selector: 'ptah-routing-map-node',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="relative flex h-full min-h-[88px] flex-col justify-between gap-2 rounded-lg border border-base-300 bg-base-100 px-3.5 py-2.5 transition-colors hover:border-primary focus-within:border-primary"
      [attr.data-testid]="'routing-node-' + nodeId()" [attr.aria-busy]="state() === 'loading'">
      <div class="flex items-start justify-between gap-2">
        <div class="flex shrink-0 items-center gap-1.5">
          <span [class]="dotClass()" aria-hidden="true"></span>
          <h3 class="whitespace-nowrap text-xs font-bold uppercase tracking-wide text-base-content">{{ title() }}</h3>
        </div>
        <div class="relative z-10 flex min-w-0 flex-wrap items-center justify-end gap-1">
          <!-- The dot's meaning in words (prototype header pill). -->
          <span class="whitespace-nowrap rounded bg-base-200 px-1.5 py-0.5 text-[11px] font-medium text-base-content"
            data-testid="routing-node-status">{{ statusText() }}</span>
          <ng-content select="[node-badges]" />
        </div>
      </div>

      @switch (state()) {
        @case ('loading') {
          <div class="space-y-1.5" data-testid="routing-node-skeleton">
            <span class="skeleton block h-3.5 w-3/4"></span>
            <span class="skeleton block h-3.5 w-1/2"></span>
          </div>
        }
        @case ('error') {
          <div class="relative z-10 flex flex-wrap items-center gap-2 text-xs text-base-content" role="alert" data-testid="routing-node-error">
            <span>{{ errorText() }}</span>
            <button type="button" class="btn btn-ghost btn-xs min-h-6 text-base-content underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
              (click)="retryRequested.emit()" data-testid="routing-node-retry">Retry</button>
          </div>
        }
        @default {
          <div class="min-w-0 text-xs text-base-content"><ng-content /></div>
        }
      }

      <div class="flex items-center justify-between gap-2 border-t border-base-content/10 pt-1 text-[11px] text-base-content-muted">
        <span class="min-w-0" data-testid="routing-node-footer">{{ footer() }}</span>
        <button type="button" [attr.aria-label]="actionAriaLabel()" (click)="activated.emit()"
          class="inline-flex shrink-0 items-center gap-0.5 rounded font-medium text-base-content underline underline-offset-2 after:absolute after:inset-0 after:rounded-lg after:content-[''] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
          data-testid="routing-node-action">
          {{ actionLabel() }}
          <lucide-angular [img]="actionIcon() === 'down' ? ChevronDownIcon : ChevronRightIcon" class="h-3 w-3 text-base-content-muted" aria-hidden="true" />
        </button>
      </div>
      <!-- Anchor for a popover opened from this node (placement bottom-start = the node's bottom-left edge). -->
      <div class="absolute bottom-0 left-0 h-0 w-0"><ng-content select="[node-popover]" /></div>
    </div>
  `,
})
export class RoutingMapNodeComponent {
  protected readonly ChevronDownIcon = ChevronDown;
  protected readonly ChevronRightIcon = ChevronRight;

  /** `main-agent` | `background-roles` | `cli-agents`: the node's testid suffix. */
  readonly nodeId = input.required<string>();
  readonly title = input.required<string>();
  readonly tone = input<RoutingNodeTone>('neutral');
  /** Visible text paired with the dot: the dot never carries meaning alone. */
  readonly statusText = input.required<string>();
  readonly state = input<RoutingNodeState>('ready');
  readonly errorText = input('Could not load this section.');
  readonly footer = input('');
  readonly actionLabel = input.required<string>();
  /** Chevron: `down` opens something on this page, `right` goes to another tab (prototype). */
  readonly actionIcon = input<'down' | 'right'>('down');
  readonly actionAriaLabel = input.required<string>();

  readonly activated = output<void>();
  readonly retryRequested = output<void>();

  protected readonly dotClass = computed(() => `h-2 w-2 shrink-0 rounded-full ${DOT[this.tone()]}`);
}
