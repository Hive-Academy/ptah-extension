import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type StatusCardTone = 'run' | 'need' | 'err' | 'done' | 'idle';

@Component({
  selector: 'ptah-status-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <section class="status-card relative overflow-hidden rounded-[22px] border border-base-300 bg-base-200 p-4 pl-5"
             data-glass-surface="content" [attr.data-tone]="tone()" [attr.aria-label]="label()">
      @if (busy()) {
        <div class="absolute inset-x-0 top-0 h-0.5 overflow-hidden" aria-hidden="true">
          <div class="status-progress h-full w-[45%] animate-pulse motion-reduce:animate-none"></div>
        </div>
      }
      <div class="flex items-start gap-3">
        <div class="status-icon grid size-9 shrink-0 place-items-center rounded-full border" aria-hidden="true">
          <ng-content select="[statusIcon]" />
        </div>
        <div class="min-w-0 flex-1">
          <div role="status" aria-live="polite" aria-atomic="true">
            <div class="text-base font-semibold leading-6 text-base-content"><ng-content select="[statusTitle]" /></div>
            <div class="text-sm leading-5 text-base-content-muted"><ng-content select="[statusSub]" /></div>
          </div>
          <div class="mt-1 font-mono text-xs text-base-content-muted"><ng-content select="[statusMeta]" /></div>
        </div>
      </div>
      <ng-content />
      <div class="mt-4 flex flex-wrap gap-2"><ng-content select="[statusActions]" /></div>
    </section>
  `,
  styles: [`
    .status-card { border-left: 4px solid var(--status-ink); }
    .status-card[data-tone='run'] { --status-ink: var(--state-ink-run); }
    .status-card[data-tone='need'] { --status-ink: var(--state-ink-need); }
    .status-card[data-tone='err'] { --status-ink: var(--state-ink-err); }
    .status-card[data-tone='done'] { --status-ink: var(--state-ink-done); }
    .status-card[data-tone='idle'] { --status-ink: var(--state-ink-idle); }
    .status-icon { color: var(--status-ink); background: color-mix(in oklab, var(--status-ink) 14%, oklch(var(--b2))); border-color: color-mix(in oklab, var(--status-ink) 45%, oklch(var(--b3))); }
    .status-progress { background: var(--status-ink); }
  `],
})
export class StatusCardComponent {
  readonly tone = input.required<StatusCardTone>();
  readonly label = input.required<string>();
  readonly busy = input(false);
}
