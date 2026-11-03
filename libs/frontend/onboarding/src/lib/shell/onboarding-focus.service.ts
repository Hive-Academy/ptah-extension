import { Injectable, Injector, afterNextRender, inject } from '@angular/core';

/**
 * Moves focus to the page heading after a route change.
 *
 * Each onboarding page renders one `h1` with `tabindex="-1"`. The shell calls
 * {@link focusHeading} when its outlet activates a page, so keyboard and screen
 * reader users start at the new page's title. Nothing else moves focus: async
 * updates (run progress, status chips) never call this.
 */
@Injectable({ providedIn: 'root' })
export class OnboardingFocusService {
  private readonly injector = inject(Injector);

  /** Focus the first `h1[tabindex="-1"]` inside `container` after it renders. */
  focusHeading(container: HTMLElement): void {
    afterNextRender(
      {
        write: () => {
          const heading = container.querySelector<HTMLElement>(
            'h1[tabindex="-1"]',
          );
          heading?.focus({ preventScroll: false });
        },
      },
      { injector: this.injector },
    );
  }
}
