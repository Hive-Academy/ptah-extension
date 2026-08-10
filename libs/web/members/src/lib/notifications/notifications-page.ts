import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { AlertTriangle, Bell, LucideAngularModule } from 'lucide-angular';

import type { MemberNotification } from '@ptah-contracts/community';
import { EmptyState, SelectionToolbar } from '@ptah-web/panel-ui';

import { MemberNotificationsStore } from '../state/member-notifications.store';

/**
 * NotificationsPage — `/members/notifications` (R10.3, R10.4, R9.7, NFR-P5,
 * NFR-S2).
 *
 * ── 🔴 IT OWNS NO STATE AND NO COUNT ───────────────────────────────────────
 * Everything reactive here comes from {@link MemberNotificationsStore}: the
 * rows, the loading flag, the error, the paging and the unread count. This page
 * reads and commands; it never holds a second copy. R9.3's prohibition is
 * about the badge, but the reasoning generalises — the moment a page keeps its
 * own `unreadCount` the nav and the inbox disagree, and the one that is wrong
 * is whichever was updated last.
 *
 * ⚠️ IT DOES NOT READ `store.unreadCount()`. `member-nav-badge.spec.ts`
 * asserts, structurally, that exactly ONE file in `libs/web/members` reads it,
 * and that file is `member-layout.ts`. This page shows an inbox; the badge
 * shows a count; the count has one reader.
 *
 * ── 🔴 `bodyPreview` IS AN ESCAPED TEXT NODE (NFR-S2, B14 ground truth 4) ──
 * It is an excerpt of MEMBER-AUTHORED MARKDOWN that the contract states is NOT
 * SANITIZED — its own docblock: *"A short plain-text excerpt. Never HTML — this
 * string is not sanitized."* Measured live, the real value came back as
 * `**Grace here** — a real reply…` with the asterisks intact. It is rendered
 * with interpolation and NOTHING ELSE: no `<ptah-markdown-block>`, no
 * `[innerHTML]`, no `bypassSecurityTrustHtml`. `markdown-chokepoint.spec.ts`'s
 * importer list stays at SIX.
 *
 * The asterisks therefore SHOW. That is correct and deliberate: an excerpt of
 * markdown is a teaser, not a rendering, and the alternative — introducing a
 * seventh renderer for a one-line preview of unsanitized text — is the exact
 * trade NFR-S2 refuses.
 *
 * ── 🔴 READ ON OPEN ONLY — NEVER ON SCROLL, NEVER ON VIEW (ASSUMPTION-28) ──
 * R10.3 says *"opening one SHALL navigate to the source and mark it read"* and
 * says nothing about visibility. A read-on-view implementation empties the
 * inbox for a member who merely glanced at it, and it is unfalsifiable from the
 * server side — the row is read and nobody can say whether anyone read it.
 * Bulk mark-read is the explicit alternative and it is `SelectionToolbar`'s job
 * (R9.7). There is no `IntersectionObserver` on this page and there must not be.
 *
 * ── THE UNREAD MARKER IS DRIVEN BY `readAt === null` AND NOTHING ELSE ──────
 * Not by a local "seen" set, not by selection, not by position in the list. One
 * field decides, so the visual state and the server state cannot disagree.
 *
 * ── PAGING IS THE SERVER'S ─────────────────────────────────────────────────
 * The page renders the server's ECHOED `page`/`pageSize`/`total`/`hasMore` and
 * never hard-codes 25. Measured live: an unparameterised request came back
 * `{"page":1,"pageSize":25,…}`, so the default is learned, not assumed.
 *
 * NFR-U2/U3: tokens only, `/60` or stronger for anything a member must read,
 * `/40` never on text. No `border-base-300` — `base-300` is a FILL.
 */
@Component({
  selector: 'ptah-notifications-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LucideAngularModule, EmptyState, SelectionToolbar],
  template: `
    <div class="flex flex-col gap-6">
      <header class="flex flex-col gap-1">
        <h1
          class="text-2xl font-bold tracking-tight text-base-content sm:text-3xl"
        >
          Notifications
        </h1>
        <p class="text-sm text-base-content/60">
          Replies to your threads and answers to your questions, newest first.
        </p>
      </header>

      <!--
        R9.7 — REUSED FROM panel-ui, NOT RE-IMPLEMENTED. It hides itself
        entirely at a count of 0, so there is no branch here.
      -->
      <ptah-selection-toolbar
        [count]="selected().size"
        itemNoun="notification"
        (cleared)="clearSelection()"
      >
        <!--
          Disabled only while the write is OUTSTANDING. The selection survives
          the round trip now, so without this the member could submit the same
          rows twice while the first request is still in the air.
        -->
        <button
          type="button"
          class="btn btn-primary btn-sm normal-case"
          [disabled]="marking()"
          [attr.aria-busy]="marking() ? 'true' : null"
          (click)="markSelectedRead()"
        >
          Mark read
        </button>
      </ptah-selection-toolbar>

      <section aria-label="Notifications">
        <!--
          error → loading → empty → list, the same four-cell discipline the
          packs and courses surfaces use. An inbox that says "you are all
          caught up" after a 500 is telling a member nothing happened when
          something may well have.
        -->
        @if (error(); as message) {
          <div
            class="rounded-xl border border-hairline bg-base-200 p-6 text-center"
            role="alert"
          >
            <lucide-angular
              [img]="AlertTriangleIcon"
              class="mx-auto h-8 w-8 text-warning"
              aria-hidden="true"
            />
            <p class="mt-3 text-sm text-base-content">{{ message }}</p>
            <button
              type="button"
              class="btn btn-primary btn-sm mt-4 normal-case"
              (click)="reload()"
            >
              Try again
            </button>
          </div>
        } @else if (loading()) {
          <div class="flex flex-col gap-3" aria-busy="true" aria-live="polite">
            <span class="sr-only">Loading your notifications</span>
            @for (row of skeletonRows; track row) {
              <div class="h-20 animate-pulse rounded-xl bg-base-200"></div>
            }
          </div>
        } @else if (items().length === 0) {
          <div class="rounded-xl border border-hairline bg-base-200">
            <ptah-empty-state
              [icon]="BellIcon"
              message="You have no notifications yet."
              hint="Replies to your threads and answers to your questions appear here."
            />
          </div>
        } @else {
          <ul class="flex flex-col gap-2">
            @for (item of items(); track item.id) {
              <li
                class="flex items-start gap-3 rounded-xl border border-hairline p-3 transition-colors hover:bg-surface-high"
                [class.bg-base-200]="item.readAt !== null"
                [class.bg-base-100]="item.readAt === null"
                [attr.data-notification-id]="item.id"
                [attr.data-unread]="item.readAt === null"
              >
                <input
                  type="checkbox"
                  class="checkbox checkbox-sm mt-1"
                  [attr.aria-label]="'Select: ' + item.title"
                  [attr.data-select-id]="item.id"
                  [checked]="selected().has(item.id)"
                  (change)="toggleSelection(item.id)"
                />

                <button
                  type="button"
                  class="flex flex-1 flex-col items-start gap-1 text-left"
                  [attr.data-open-id]="item.id"
                  (click)="open(item)"
                >
                  <span class="flex items-center gap-2">
                    @if (item.readAt === null) {
                      <!--
                        The unread dot is decorative; the state is also carried
                        in the accessible name below, so a screen-reader user
                        is not relying on a coloured circle.
                      -->
                      <span
                        class="h-2 w-2 shrink-0 rounded-full bg-primary"
                        aria-hidden="true"
                      ></span>
                    }
                    <span
                      class="text-sm text-base-content"
                      [class.font-semibold]="item.readAt === null"
                    >
                      {{ item.title }}
                    </span>
                    <span class="sr-only">{{
                      item.readAt === null ? '(unread)' : '(read)'
                    }}</span>
                  </span>

                  @if (item.actorName; as actor) {
                    <span class="text-xs text-base-content/60">
                      from {{ actor }}
                    </span>
                  }

                  @if (item.bodyPreview; as preview) {
                    <!--
                      NFR-S2 — INTERPOLATION ONLY. This is member-authored
                      markdown the contract says is NOT sanitized. Any markup
                      in it shows as characters, which is the point.
                    -->
                    <span
                      class="line-clamp-2 text-sm text-base-content/80"
                      [attr.data-body-preview]="item.id"
                    >
                      {{ preview }}
                    </span>
                  }
                </button>
              </li>
            }
          </ul>

          @if (pageLabel(); as label) {
            <p class="mt-4 text-xs text-base-content/60" data-page-label>
              {{ label }}
            </p>
          }
        }
      </section>
    </div>
  `,
})
export class NotificationsPage {
  /**
   * ⚠️ INJECTED, NOT PROVIDED HERE. The store is provided at the `/members`
   * route level so ONE instance serves the nav badge and this page (RISK-AM,
   * R9.3). Adding it to this component's `providers` would give the page its
   * own instance — its own count, its own poll — and the badge would then be
   * reading a different object than the one the member just acted on.
   */
  private readonly store = inject(MemberNotificationsStore);

  protected readonly AlertTriangleIcon = AlertTriangle;
  protected readonly BellIcon = Bell;
  protected readonly skeletonRows = [0, 1, 2];

  protected readonly items = this.store.items;
  protected readonly loading = this.store.loading;
  protected readonly error = this.store.error;

  /**
   * The selected ids.
   *
   * ⚠️ A `Set` OF IDS, NOT OF ROWS. The rows are replaced wholesale on every
   * refresh (and on every optimistic mark-read), so a selection holding object
   * references would silently empty itself each time the poll landed.
   */
  private readonly _selected = signal<ReadonlySet<string>>(new Set());
  protected readonly selected = this._selected.asReadonly();

  /**
   * Whether a bulk mark-read is outstanding.
   *
   * ⚠️ IT GATES THE BUTTON, NOT THE ROWS. The member may keep ticking boxes
   * while the write is in the air — those ticks are theirs and are not part of
   * the request that is already gone.
   */
  private readonly _marking = signal(false);
  protected readonly marking = this._marking.asReadonly();

  /**
   * "Showing 11–20 of 30", from the SERVER's echoed paging. Never hard-coded.
   *
   * ⚠️ THE UPPER BOUND COMES FROM THE ROWS ACTUALLY RENDERED, NOT FROM
   * `page * pageSize`. Those two differ whenever the server returns a SHORT
   * page — a last page, or a page thinned by a concurrent delete — and the
   * arithmetic version then claims rows that are not on screen. It is a caption
   * describing what the member is looking at, so it is derived from what the
   * member is looking at.
   */
  protected readonly pageLabel = computed<string | null>(() => {
    const paging = this.store.page();
    const shown = this.items().length;
    if (paging === null || paging.total === 0 || shown === 0) return null;

    const first = (paging.page - 1) * paging.pageSize + 1;
    const last = first + shown - 1;

    return `Showing ${first}–${last} of ${paging.total}`;
  });

  public constructor() {
    this.store.refresh();
  }

  /**
   * Opening a notification: mark read, then navigate (R10.3).
   *
   * ⚠️ THE STORE DOES BOTH, INCLUDING THE ROUTE CHECK. This page does not
   * inspect `item.route` and must not — RISK-AO's guard has exactly one home,
   * and a page that navigated itself would be a second door into the same
   * open-redirect hole.
   */
  protected open(item: MemberNotification): void {
    this.store.openRoute(item);
  }

  protected toggleSelection(id: string): void {
    const next = new Set(this._selected());
    if (!next.delete(id)) next.add(id);
    this._selected.set(next);
  }

  protected clearSelection(): void {
    this._selected.set(new Set());
  }

  /**
   * Drops exactly the ids a settled write covered.
   *
   * ⚠️ NOT `clearSelection()`. The member can tick more rows while the request
   * is in flight, and those ticks are a NEW selection the completed write knew
   * nothing about — clearing wholesale would silently throw them away.
   */
  private deselect(ids: readonly string[]): void {
    const next = new Set(this._selected());
    for (const id of ids) next.delete(id);
    this._selected.set(next);
  }

  /**
   * Bulk mark-read (R9.7) — acts on the SELECTION and nothing else.
   *
   * ⚠️ THE STORE DECIDES HOW MANY REQUESTS THAT COSTS, NOT THIS PAGE. It sends
   * the selection to `POST notifications/read`, which marks exactly the named
   * rows in ONE request, and keeps using `read-all` for the case where the
   * selection is PROVABLY the whole inbox. See `markSelectedRead`'s docblock:
   * there is no "mark unread", so over-marking is irreversible and the guard
   * stays even though the bulk endpoint would now cover both.
   *
   * ── 🔴 THE SELECTION IS DROPPED ON SUCCESS, KEPT ON FAILURE ───────────────
   * It used to be cleared synchronously on click, before the write had resolved
   * anything. The store rolls the rows and the count back on a `500` — but the
   * checkboxes were already unticked and the toolbar already hidden by then, so
   * the member watched the rows silently un-strike-through with NO CONTROL LEFT
   * TO RETRY FROM and had to re-select from scratch. Keeping the selection
   * until the server has actually taken it is what makes the failure
   * recoverable in one click.
   */
  protected markSelectedRead(): void {
    if (this._marking()) return;

    // Captured BEFORE the write, because the member may tick more rows while
    // it is in flight and only these ones were submitted.
    const submitted = [...this.selected()];

    this._marking.set(true);
    this.store.markSelectedRead(submitted, (succeeded) => {
      this._marking.set(false);
      if (succeeded) this.deselect(submitted);
    });
  }

  protected reload(): void {
    this.store.refresh();
  }
}
