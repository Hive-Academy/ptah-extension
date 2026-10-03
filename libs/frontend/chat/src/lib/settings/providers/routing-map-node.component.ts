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
 * badge buttons sit above the stretch (`relative z-10`, set on every button in the badge slot) and keep their own clicks.
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
    <!-- has-[[role=dialog]]:z-30: a node holding an open popover (a scope badge's, or the Main Agent one; both are
         role="dialog") rises above the other nodes' z-10 badge groups, so the popover is never painted over (Batch 28).
         The class must not contain "popover": the light theme styles every [class*='popover'] (styles.css). -->
    <div class="relative flex h-full min-h-[88px] flex-col justify-between gap-2 rounded-lg border border-base-300 bg-base-100 px-3.5 py-2.5 transition-colors hover:border-primary focus-within:border-primary has-[[role=dialog]]:z-30"
      [attr.data-testid]="'routing-node-' + nodeId()" [attr.aria-busy]="state() === 'loading'">
      <!-- Head (Batch 52.6; prototype: the title with "App override" / "Workspace override" beside it). The title is
           one line and never shrinks; the status pill and the projected badges follow it in the same wrapping row, so
           a badge that does not fit beside the title moves to the next line under it, whole, never truncated. The badge
           wrapper is display: contents, so its items are items of this row. -->
      <div class="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        <div class="mr-auto flex shrink-0 items-center gap-1.5">
          <span [class]="dotClass()" aria-hidden="true"></span>
          <h3 class="whitespace-nowrap text-xs font-bold uppercase leading-4 tracking-wide text-base-content" data-testid="routing-node-title">{{ title() }}</h3>
        </div>
        <!-- Every badge button rises above the stretched node action (z-10) and keeps its own click. -->
        <div class="contents [&_button]:relative [&_button]:z-10" data-testid="routing-node-badges">
          <!-- The dot's meaning in words (prototype header pill). -->
          <span class="shrink-0 whitespace-nowrap rounded bg-base-200 px-1.5 py-0.5 text-[11px] font-medium text-base-content"
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
