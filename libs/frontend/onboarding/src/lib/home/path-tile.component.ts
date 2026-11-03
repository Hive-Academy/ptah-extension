import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { ArrowRight, LucideAngularModule, type LucideIconData } from 'lucide-angular';
import type { OnboardingStepLink } from '../shell/onboarding-step-link';

let nextTileId = 0;

/**
 * One Home path tile: icon tile, title link, description, projected details
 * (checklist, status chips, secondary links) and the call-to-action line.
 *
 * The title is the link and its accessible name; its `::after` stretches over
 * the whole tile so the tile is clickable. Projected interactive content must
 * sit above it (`relative z-10`).
 *
 * States: `loading` renders a skeleton; a `disabledReason` removes the link
 * and shows the reason inline instead of the call to action.
 */
@Component({
  selector: 'ptah-onboarding-path-tile',
  standalone: true,
  imports: [RouterLink, LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    @if (loading()) {
      <div
        class="flex h-full min-h-40 animate-pulse flex-col gap-3 rounded-2xl border border-base-300 bg-base-200 p-5 motion-reduce:animate-none"
        data-glass-surface="chrome"
        data-testid="onboarding-path-tile-skeleton"
        aria-hidden="true"
      >
        <span class="size-12 rounded-xl bg-base-300"></span>
        <span class="h-5 w-1/2 rounded bg-base-300"></span>
        <span class="h-4 w-5/6 rounded bg-base-300"></span>
      </div>
    } @else {
      <article
        class="relative flex h-full flex-col gap-2.5 rounded-2xl border p-5 transition-colors focus-within:ring-2 focus-within:ring-primary motion-reduce:transition-none"
        [class]="surfaceClass()"
        data-glass-surface="chrome"
        [attr.aria-disabled]="disabledReason() ? 'true' : null"
        [attr.data-testid]="'onboarding-path-' + testId()"
      >
        <span
          class="grid size-12 place-items-center rounded-xl border"
          [class]="iconTileClass()"
          data-glass-surface="tile"
          aria-hidden="true"
        >
          <lucide-angular [img]="icon()" class="size-[1.6rem]" aria-hidden="true" />
        </span>
        <h2 class="text-lg font-semibold leading-snug">
          @if (disabledReason()) {
            {{ title() }}
          } @else {
            <a
              class="outline-none after:absolute after:inset-0 after:rounded-2xl after:content-['']"
              [routerLink]="link().commands"
              [queryParams]="link().queryParams"
              [attr.aria-describedby]="descriptionId"
              [attr.data-testid]="'onboarding-path-link-' + testId()"
              >{{ title() }}</a
            >
          }
        </h2>
        <p [id]="descriptionId" class="text-sm text-base-content-muted">
          {{ description() }}
        </p>
        <ng-content />
        @if (disabledReason(); as reason) {
          <p
            class="mt-auto text-sm font-medium text-state-need"
            [attr.data-testid]="'onboarding-path-disabled-' + testId()"
          >
            {{ reason }}
          </p>
        } @else {
          <span
            class="mt-auto inline-flex items-center gap-1.5 text-sm font-semibold"
            aria-hidden="true"
          >
            {{ callToAction() }}
            <lucide-angular [img]="arrowIcon" class="size-4" aria-hidden="true" />
          </span>
        }
      </article>
    }
  `,
})
export class OnboardingPathTileComponent {
  /** Stable id fragment for selectors (`analyze`, `new-project`, ...). */
  readonly testId = input.required<string>();
  readonly title = input.required<string>();
  readonly description = input.required<string>();
  readonly icon = input.required<LucideIconData>();
  readonly callToAction = input.required<string>();
  readonly link = input.required<OnboardingStepLink>();
  /** The recommended path: gold accent border and icon tile. */
  readonly primary = input(false);
  readonly loading = input(false);
  /** Why the path cannot start now; `null` when it can. */
  readonly disabledReason = input<string | null>(null);

  protected readonly arrowIcon = ArrowRight;
  protected readonly descriptionId = `onboarding-path-desc-${++nextTileId}`;

  protected readonly surfaceClass = computed(() => {
    if (this.disabledReason()) {
      return 'border-base-300 bg-base-200 cursor-not-allowed';
    }
    return this.primary()
      ? 'border-secondary/50 bg-secondary/[0.06] hover:border-secondary/70'
      : 'border-base-300 bg-base-200 hover:border-base-content/30 hover:bg-base-300/40';
  });

  protected readonly iconTileClass = computed(() =>
    this.primary()
      ? 'border-secondary/55 bg-secondary/20'
      : 'border-base-300 bg-base-300/60',
  );
}
