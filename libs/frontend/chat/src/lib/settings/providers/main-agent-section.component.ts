import { ChangeDetectionStrategy, Component, computed, inject, output } from '@angular/core';
import { ChevronDown, LucideAngularModule } from 'lucide-angular';
import {
  ProvidersSettingsStateService, type ProvidersEffectiveRoute, type ProvidersSettingsSection,
} from '@ptah-extension/core';

type MainAgentTone = 'success' | 'warning' | 'neutral';

/** Header status pill: "Operational" exactly when the main route is loaded and `ready`. */
export function routeStatus(route: ProvidersSettingsSection<ProvidersEffectiveRoute>): { readonly tone: MainAgentTone; readonly text: string } {
  if (route.status === 'error') return { tone: 'warning', text: 'Route unavailable' };
  if (route.status !== 'ready' || !route.data) return { tone: 'neutral', text: 'Checking…' };
  return route.data.ready ? { tone: 'success', text: 'Operational' } : { tone: 'warning', text: 'Needs attention' };
}

const PILL: Readonly<Record<MainAgentTone, string>> = {
  success: 'border-success/30 bg-success/10',
  warning: 'border-warning/30 bg-warning/10',
  neutral: 'border-base-300 bg-base-100',
};
const DOT: Readonly<Record<MainAgentTone, string>> = {
  success: 'bg-success', warning: 'bg-warning', neutral: 'bg-base-content-muted',
};
const FOCUS =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content';
/** Reassign is stretched over the whole block: the block is one target. */
const REASSIGN = `btn btn-primary btn-sm shrink-0 gap-1.5 after:absolute after:inset-0 after:rounded-lg after:content-[''] ${FOCUS}`;

/**
 * The Main agent block at the top of the Providers tab's first card (above Connections, on the same card) (design-spec §3, user layout correction): the provider,
 * model and effort of the next request, its status ("Active", D16 scope badges) and the route's status
 * ("Operational"). Reads `ProvidersSettingsStateService` directly.
 *
 * The page owns and projects the D16 badges (`[main-agent-badges]`), the Main Agent popover (`[main-agent-popover]`,
 * anchored at the block's bottom-left edge) and its own read errors / clear review (default slot, under the block).
 * "Reassign" is the block's one real `<button>`, stretched over the whole block (`after:inset-0`), so the block is one
 * keyboard-operable target without nesting interactive elements; the badge buttons sit above the stretch (`z-10`).
 * Colour sits on dots and pills; all text stays base-content (deviation 6).
 */
@Component({
  selector: 'ptah-main-agent-section',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- The block only: the page puts it and Connections on one card. It lifts while it holds a popover (role="dialog"),
         like the card itself, so the Connections block under it never paints over the panel. -->
    <section class="flex flex-col gap-3 has-[[role=dialog]]:relative has-[[role=dialog]]:z-30" aria-labelledby="main-agent-heading"
      data-testid="main-agent-section">
      <!-- has-[[role=dialog]]:z-30: the block holding an open popover (a scope badge's, or the Main Agent one; both are
           role="dialog") stays above the stretched action and the badges (Batch 28).
           The class must not contain "popover": the light theme styles every [class*='popover'] (styles.css). -->
      <div class="relative flex flex-col gap-3 has-[[role=dialog]]:z-30" data-testid="routing-node-main-agent"
        [attr.aria-busy]="main().state === 'loading'">
        <!-- Head (Batch 52.6): the title, then the status and the projected layer badges in the same wrapping row (a badge
             that does not fit moves, whole, to the next line), and the route status at the end. -->
        <div class="flex flex-wrap items-center gap-x-1.5 gap-y-1">
          <div class="mr-auto flex shrink-0 items-center gap-1.5">
            <span [class]="'h-2 w-2 shrink-0 rounded-full ' + mainDot()" aria-hidden="true"></span>
            <h2 id="main-agent-heading" class="whitespace-nowrap text-base font-semibold leading-5 text-base-content"
              data-testid="routing-node-title">Main agent</h2>
          </div>
          <!-- Every badge button rises above the stretched action (z-10) and keeps its own click. -->
          <div class="contents [&_button]:relative [&_button]:z-10" data-testid="routing-node-badges">
            <span class="badge badge-sm shrink-0 whitespace-nowrap border-base-300 bg-base-200 text-xs font-medium text-base-content"
              data-testid="routing-node-status">{{ main().status }}</span>
            <ng-content select="[main-agent-badges]" />
          </div>
          <span role="status" [class]="'flex shrink-0 items-center gap-1 rounded border px-2.5 py-0.5 text-xs font-medium text-base-content ' + pill()"
            data-testid="main-agent-route-status">
            <span [class]="'h-1.5 w-1.5 rounded-full ' + statusDot()" aria-hidden="true"></span>{{ status().text }}
          </span>
        </div>

        <div class="flex flex-wrap items-center gap-x-6 gap-y-2">
          <!-- The values keep at least 16rem before Reassign wraps under them, so a value never breaks mid-word. -->
          <div class="min-w-0 flex-[1_1_16rem] text-xs text-base-content">
            @switch (main().state) {
              @case ('loading') {
                <div class="space-y-1.5" data-testid="routing-node-skeleton">
                  <span class="skeleton block h-3.5 w-3/4"></span>
                  <span class="skeleton block h-3.5 w-1/2"></span>
                </div>
              }
              @case ('error') {
                <div class="relative z-10 flex flex-wrap items-center gap-2 text-xs text-base-content" role="alert" data-testid="routing-node-error">
                  <span>Main-agent route unavailable.</span>
                  <button type="button" [class]="'btn btn-ghost btn-sm px-2 text-base-content underline ' + focusRing"
                    (click)="state.refreshRoute()" data-testid="routing-node-retry">Retry</button>
                </div>
              }
              @default {
                @if (main().provider; as provider) {
                  <!-- Label + value start on one line (prototype); the whole value is always shown (Batch 28b). The provider
                       wraps between words only (no min-w-0); a long model id may break inside its own column. -->
                  <p class="flex min-w-0 items-baseline gap-x-1.5" data-testid="routing-main-provider-row">
                    <span class="shrink-0 text-xs font-medium text-base-content-muted">Provider:</span>
                    <span class="break-words text-base font-semibold text-base-content" data-testid="routing-main-provider">{{ provider }}</span>
                  </p>
                  <p class="mt-0.5 flex min-w-0 items-baseline gap-x-1.5" data-testid="routing-main-model-row">
                    <span class="shrink-0 text-xs font-medium text-base-content-muted">Model:</span>
                    <span class="min-w-0 break-words font-mono text-sm font-medium text-base-content" data-testid="routing-main-model">{{ main().model }}</span>
                  </p>
                } @else {
                  <p class="text-base-content">Choose a provider to start the main agent.</p>
                }
              }
            }
          </div>
          <div class="ml-auto flex items-center gap-3 text-xs text-base-content-muted">
            <span class="min-w-0" data-testid="routing-node-footer">{{ main().footer }}</span>
            <button type="button" aria-label="Reassign the main agent: its provider, model and effort" (click)="reassignRequested.emit()"
              [class]="reassignClass"
              data-testid="routing-node-action">
              Reassign
              <lucide-angular [img]="ChevronDownIcon" class="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
        <!-- Anchor for the Main Agent popover (placement bottom-start = the block's bottom-left edge). -->
        <div class="absolute bottom-0 left-0 h-0 w-0"><ng-content select="[main-agent-popover]" /></div>
      </div>
      <ng-content />
    </section>
  `,
})
export class MainAgentSectionComponent {
  protected readonly ChevronDownIcon = ChevronDown;
  protected readonly focusRing = FOCUS;
  protected readonly reassignClass = REASSIGN;
  protected readonly state = inject(ProvidersSettingsStateService);

  /** "Reassign": the page opens the Main Agent popover. */
  readonly reassignRequested = output<void>();

  protected readonly status = computed(() => routeStatus(this.state.route()));
  protected readonly pill = computed(() => PILL[this.status().tone]);
  protected readonly statusDot = computed(() => DOT[this.status().tone]);
  protected readonly mainDot = computed(() => DOT[this.main().tone]);

  protected readonly main = computed(() => {
    const route = this.state.route(), effort = this.state.effort();
    const state = route.status === 'error' ? 'error' : route.status === 'ready' && route.data ? 'ready' : 'loading';
    const data = route.data;
    const driver = data && data.driverProviderId && data.route !== 'unresolved' ? data.driverProviderId : null;
    const model = !data ? '' : data.resolvedModel.kind === 'model' ? data.resolvedModel.id
      : data.resolvedModel.kind === 'tier' ? `${data.resolvedModel.tier} tier` : 'Default (chosen by Claude)';
    const effortText = effort.status === 'ready' ? effort.data?.effort ?? 'Provider default' : '…';
    const tone: MainAgentTone = !driver ? 'neutral' : data?.ready ? 'success' : 'warning';
    const provider = driver
      ? (this.state.connections().data?.find((entry) => entry.id === driver)?.name ?? driver)
      : null;
    return {
      state, tone, model, provider,
      status: !driver ? 'Not set' : data?.ready ? 'Active' : 'Needs attention',
      footer: `Effort: ${effortText}`,
    };
  });
}
