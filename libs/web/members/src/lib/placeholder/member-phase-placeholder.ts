import { ChangeDetectionStrategy, Component, computed } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { inject } from '@angular/core';
import { Compass } from 'lucide-angular';

import { EmptyState } from '@ptah-web/panel-ui';

/**
 * Route data every placeholder route supplies. Declared here rather than
 * inline in the route table so a typo becomes a compile error.
 */
export interface MemberPlaceholderData {
  /** Human name of the surface this route will eventually render. */
  surface: string;
  /** The delivery phase that replaces this placeholder with the real page. */
  phase: 2 | 3 | 4 | 5;
  /** One line describing what the finished surface does. */
  summary: string;
}

/**
 * MemberPhasePlaceholder — the honest stand-in for a member route whose
 * surface lands in a later phase.
 *
 * ⚠️ THE ROUTE TABLE IS DECLARED IN FULL IN PHASE 1 ON PURPOSE (R9.4, RK-11).
 * `members.routes.spec.ts` asserts there is no `:model` catch-all, and that
 * assertion is only meaningful against the finished tree — declaring routes
 * phase by phase would mean the rule is unenforced for four of the five phases,
 * which is exactly when a catch-all gets added "temporarily".
 *
 * ONE component serves all eleven pending routes rather than eleven near-identical
 * files. The routes differ only in the three fields of
 * {@link MemberPlaceholderData}, so eleven copies would be eleven places to
 * update the day the shared treatment changes, and the Rule of Three says
 * extract at the third occurrence, not defer to the eleventh. Each later
 * frontend batch swaps its own route's `loadComponent` to the real page and
 * deletes its `data` block; the last one to do so deletes this file.
 */
@Component({
  selector: 'ptah-member-phase-placeholder',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [EmptyState],
  template: `
    <section class="mx-auto max-w-3xl" [attr.aria-label]="surface()">
      <h2 class="text-2xl font-semibold text-base-content">{{ surface() }}</h2>
      <div class="mt-4 rounded-xl border border-hairline bg-base-200">
        <ptah-empty-state
          [icon]="CompassIcon"
          [message]="summary()"
          [hint]="hint()"
        />
      </div>
    </section>
  `,
})
export class MemberPhasePlaceholder {
  protected readonly CompassIcon = Compass;

  private readonly routeData = toSignal(inject(ActivatedRoute).data, {
    initialValue: {} as Record<string, unknown>,
  });

  private readonly data = computed<MemberPlaceholderData>(() => {
    const raw = this.routeData() as Partial<MemberPlaceholderData>;
    return {
      surface: raw.surface ?? 'This surface',
      phase: raw.phase ?? 5,
      summary: raw.summary ?? 'Not available yet.',
    };
  });

  protected readonly surface = computed(() => this.data().surface);
  protected readonly summary = computed(() => this.data().summary);

  /**
   * Says WHEN, not just "coming soon". A member who paid for the cohort is
   * owed the schedule, and a date-free "coming soon" reads as abandonment.
   */
  protected readonly hint = computed(
    () => `Ships in phase ${this.data().phase} of the Builders platform build.`,
  );
}
