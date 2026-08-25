import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  ArrowRight,
  CloudOff,
  Inbox,
  LucideAngularModule,
  type LucideIconData,
} from 'lucide-angular';

import { EmptyState, StatusBadge } from '@ptah-web/panel-ui';
import type { HubSectionStatus } from '@ptah-contracts/community';

/**
 * HubSectionCard — the card chrome every hub section shares, and the ONE place
 * the three section statuses are turned into something a member can read.
 *
 * ⚠️ `'empty'` AND `'unavailable'` MUST NOT LOOK THE SAME (R6.3, R6.4). "You
 * have no unread topics" and "the forum is down" are different facts. A member
 * who is shown the first when the second is true concludes the product is
 * abandoned; a member shown the second when the first is true goes looking for
 * an outage that is not happening. So `'unavailable'` gets its own icon, its
 * own copy, and a warning chip in the header, while `'empty'` stays calm.
 *
 * Neither state omits the section — that is the specific failure R6.3 names.
 * A hub that hides its empty cards silently shrinks as a member's data thins
 * out, and they never learn the section exists.
 *
 * Private to `libs/web/members` for now. Under plan §5.3's rule a primitive
 * earns a place in `@ptah-web/panel-ui` when a SECOND panel actually renders
 * it; the admin dashboard has no sectioned aggregate view, so promoting this
 * would be the speculative extraction that rule exists to stop. Extracted here
 * rather than repeated inline because four sections need it, which is past the
 * Rule of Three.
 */
@Component({
  selector: 'ptah-hub-section-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [EmptyState, StatusBadge, LucideAngularModule, RouterLink],
  template: `
    <section
      class="flex h-full flex-col rounded-xl border border-hairline bg-base-200"
      [attr.aria-labelledby]="headingId()"
    >
      <header
        class="flex items-center justify-between gap-2 border-b border-hairline px-4 py-3"
      >
        <h2
          [id]="headingId()"
          class="text-[11px] font-semibold uppercase tracking-wider text-base-content-muted"
        >
          {{ title() }}
        </h2>

        @if (status() === 'unavailable') {
          <ptah-status-badge variant="warning" label="Unavailable" size="xs" />
        } @else if (link(); as target) {
          <a
            [routerLink]="target"
            class="group flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-primary transition-colors hover:text-primary-focus"
          >
            {{ linkLabel() }}
            <lucide-angular
              [img]="ArrowRightIcon"
              class="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5"
              aria-hidden="true"
            />
          </a>
        }
      </header>

      <div class="flex-1 p-4">
        @if (status() === 'ok') {
          <ng-content />
        } @else if (status() === 'unavailable') {
          <ptah-empty-state
            [icon]="CloudOffIcon"
            [message]="unavailableMessage()"
            hint="This one section could not be loaded. Everything else on this page is up to date."
          />
        } @else {
          <ptah-empty-state
            [icon]="emptyIcon()"
            [message]="emptyMessage()"
            [hint]="emptyHint()"
          />
        }
      </div>
    </section>
  `,
})
export class HubSectionCard {
  public readonly title = input.required<string>();
  public readonly status = input.required<HubSectionStatus>();

  /** Shown for `'empty'` — what there is genuinely none of. */
  public readonly emptyMessage = input<string>('Nothing here yet.');
  public readonly emptyHint = input<string | null>(null);
  public readonly emptyIcon = input<LucideIconData>(Inbox);

  /** Shown for `'unavailable'` — names the dependency, not the member. */
  public readonly unavailableMessage = input<string>(
    'This section is temporarily unavailable.',
  );

  /** Optional "view all" target. Hidden while the section is unavailable. */
  public readonly link = input<string | null>(null);
  public readonly linkLabel = input<string>('View all');

  protected readonly ArrowRightIcon = ArrowRight;
  protected readonly CloudOffIcon = CloudOff;

  /** Stable per-instance id so `aria-labelledby` resolves with several cards. */
  protected readonly headingId = computed(
    () => `hub-section-${slugify(this.title())}`,
  );
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}
