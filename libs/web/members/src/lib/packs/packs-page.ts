import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  AlertTriangle,
  ExternalLink,
  Info,
  LucideAngularModule,
  Package,
} from 'lucide-angular';

import type { MemberPack } from '@ptah-contracts/community';
import { EmptyState, TagChip } from '@ptah-web/panel-ui';

import { describeLoadFailure } from '../learning/courses-page';
import {
  MemberPacksApiService,
  accessNoteFor,
} from '../services/member-packs-api.service';

/**
 * PacksPage — `/members/packs` (R5.1, R5.5, R5.7, R9.7, NFR-U1–U4).
 *
 * ── 🔴 THE ACCESS NOTE RENDERS ABOVE THE REPOSITORY LINK, ALWAYS (R5.5) ────
 * THIS IS THE WHOLE REASON THE FIELD EXISTS. R5.5 says the member must be told
 * how access is granted *"in advance"* — so a GitHub 404 is not the first
 * signal they lack it. Placement is therefore LOAD-BEARING, NOT COSMETIC: a
 * note rendered under the link is read after the member has already followed it
 * and been refused, which is exactly the experience the requirement was written
 * to remove. `packs-page.spec.ts` asserts DOM ORDER, not mere presence, because
 * "the text is on the page somewhere" is true of the broken version too.
 *
 * A pack with a null `accessNote` still gets a line — one shared constant,
 * `DEFAULT_ACCESS_NOTE` (ASSUMPTION-27). Every pack in this workspace has the
 * column null on day one, so a template that rendered nothing for null would
 * leave a blank gap at precisely the spot R5.5 exists to fill, on every row.
 *
 * ── 🔴 FOUR DISTINCT RENDERS, BRANCHED error → loading → empty → list ──────
 * (RISK-AQ.) "We could not load your packs" and "No packs are available to you
 * yet" MEAN DIFFERENT THINGS and are the same blank screen if the page branches
 * on `items.length` first. The first says our request failed; the second says
 * the server answered and `memberVisible` is false everywhere. B13 proved this
 * is the failure that actually ships, so the order here is deliberate and the
 * spec asserts each cell BY ITS COPY.
 *
 * ── ⚠️ NOTHING HERE IMPLIES PTAH GRANTS ACCESS (R5.7) ──────────────────────
 * No "Request access" button, no entitlement check, no gate, no lock icon. Ptah
 * serves no pack content and provisions no GitHub access; this surface is a
 * DISCOVERY AND LINK-DELIVERY CHANNEL and nothing more. A control that looked
 * like it could grant access would be the product claiming a capability it does
 * not have — and would generate support load nobody can resolve.
 *
 * ── ONE FLAT LIST, NOT GROUPED BY COHORT (ASSUMPTION-25) ───────────────────
 * A-1: `cohortName` is a DISPLAY LABEL that grants and revokes nothing, and the
 * server filters on `memberVisible` alone — measured live, a member holding
 * ZERO cohort assignments receives the pack labelled "Founding Members".
 * Grouping by the label would render it as STRUCTURE and re-create, visually,
 * exactly the access illusion A-1 exists to refuse. It renders as a `TagChip`
 * beside the pack's own tags, at the same weight as them.
 *
 * ── NO MARKDOWN RENDERER LIVES ON THIS PAGE (NFR-S2, PRE-4) ────────────────
 * `description` and `accessNote` are admin-authored plain prose with no
 * markdown affordance in the admin form, and the contract names neither
 * `bodyMarkdown`. Both are ESCAPED TEXT NODES. The chokepoint importer list
 * stays at SIX.
 *
 * ── NO PAGINATION, NO SEARCH, NO TAG FILTER, NO DETAIL PAGE ───────────────
 * The endpoint is unpaged by contract (`MemberPack[]`, no `@Query()`) over a
 * table plan §1.2 describes as "tens of rows, always read in full". There is no
 * detail page because the list already carries everything there is: R5.7 means
 * Ptah serves no pack content, so a detail route would be a page showing the
 * same six fields with more clicks.
 *
 * NFR-U2/U3: `base-100`/`base-200` surfaces, `border-hairline` boundaries,
 * `bg-surface-high` hover, `base-content/60` for muted text — and `/40`
 * NOWHERE, on anything a member has to read (B13's F-1 was a real 3.2:1 WCAG
 * AA failure of exactly that shape). No `border-base-300`; `base-300` is a
 * FILL. The Task 4.7 lint rule polices `libs/web/members/**`.
 */
@Component({
  selector: 'ptah-packs-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LucideAngularModule, EmptyState, TagChip],
  template: `
    <div class="flex flex-col gap-6">
      <header class="flex flex-col gap-1">
        <h1
          class="text-2xl font-bold tracking-tight text-base-content sm:text-3xl"
        >
          Packs
        </h1>
        <p class="text-sm text-base-content/60">
          Starter repositories published to Builders members. Access is
          administered on GitHub.
        </p>
      </header>

      <section aria-label="Packs">
        <!--
          🔴 RISK-AQ — THE BRANCH ORDER IS THE FEATURE.
          error → loading → empty → list. Testing the row COUNT first collapses
          "we failed" into "there are none", which is the same blank screen
          carrying the opposite meaning.
          (No backticks in this template's comments — the template is itself a
          backtick literal, and one inside a comment silently terminates it.)
        -->
        @if (errorMessage(); as message) {
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
            <span class="sr-only">Loading your packs</span>
            @for (row of skeletonRows; track row) {
              <div class="h-36 animate-pulse rounded-xl bg-base-200"></div>
            }
          </div>
        } @else if (packs().length === 0) {
          <div class="rounded-xl border border-hairline bg-base-200">
            <ptah-empty-state
              [icon]="PackageIcon"
              message="No packs are available to you yet."
              hint="Packs appear here as soon as they are published. Nothing is missing from your account."
            />
          </div>
        } @else {
          <ul class="grid gap-4 sm:grid-cols-2">
            @for (pack of packs(); track pack.id) {
              <li
                class="flex h-full flex-col gap-3 rounded-xl border border-hairline bg-base-200 p-4"
                [attr.data-pack-slug]="pack.slug"
              >
                <h2 class="text-base font-semibold text-base-content">
                  {{ pack.title }}
                </h2>

                <p class="text-sm text-base-content/60">
                  {{ pack.description }}
                </p>

                @if (pack.cohortName || pack.tags.length) {
                  <!--
                    ASSUMPTION-25 — cohortName is a CHIP BESIDE the pack's own
                    tags, at the same weight. A-1: it is a display label that
                    grants and revokes nothing, so it must not read as
                    structure.
                  -->
                  <ul class="flex flex-wrap items-center gap-1.5">
                    @if (pack.cohortName; as cohort) {
                      <li>
                        <ptah-tag-chip [label]="cohort" variant="neutral" />
                      </li>
                    }
                    @for (tag of pack.tags; track tag) {
                      <li><ptah-tag-chip [label]="tag" /></li>
                    }
                  </ul>
                }

                <!--
                  🔴 R5.5 — THE ACCESS NOTE, ABOVE THE LINK, ON EVERY PACK.
                  It sits before the anchor in DOM order deliberately: told "in
                  advance" is the requirement. Never null-rendered — a pack with
                  no note takes the one shared default sentence.
                -->
                <p
                  class="mt-auto flex items-start gap-2 rounded-lg bg-base-100 p-3 text-sm text-base-content/80"
                  [attr.data-access-note]="pack.slug"
                >
                  <lucide-angular
                    [img]="InfoIcon"
                    class="mt-0.5 h-4 w-4 shrink-0 text-info"
                    aria-hidden="true"
                  />
                  <span>{{ accessNote(pack) }}</span>
                </p>

                <!--
                  The accessible name carries the PACK TITLE. A page of links
                  all reading "Open repository" is unusable on a screen reader,
                  which reads them out of context in a link list.
                -->
                <a
                  class="btn btn-sm btn-primary w-fit normal-case"
                  [href]="pack.repoUrl"
                  [attr.aria-label]="
                    'Open the ' + pack.title + ' repository on GitHub'
                  "
                  [attr.data-repo-link]="pack.slug"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <lucide-angular
                    [img]="ExternalLinkIcon"
                    class="h-4 w-4"
                    aria-hidden="true"
                  />
                  Open repository
                </a>
              </li>
            }
          </ul>
        }
      </section>
    </div>
  `,
})
export class PacksPage {
  private readonly api = inject(MemberPacksApiService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly AlertTriangleIcon = AlertTriangle;
  protected readonly ExternalLinkIcon = ExternalLink;
  protected readonly InfoIcon = Info;
  protected readonly PackageIcon = Package;
  protected readonly skeletonRows = [0, 1];

  private readonly _packs = signal<readonly MemberPack[] | null>(null);

  protected readonly loading = signal(true);
  protected readonly errorMessage = signal<string | null>(null);

  /** In the ORDER THE SERVER RETURNED THEM (alphabetical by title, R5.1). */
  protected readonly packs = computed<readonly MemberPack[]>(
    () => this._packs() ?? [],
  );

  public constructor() {
    this.load();
  }

  /**
   * The line above the link.
   *
   * ⚠️ IT DELEGATES TO `accessNoteFor`, WHICH LIVES BESIDE THE SERVICE. One
   * place decides what "no access note" reads as, so the sentence cannot drift
   * between this page and any later surface that shows a pack.
   */
  protected accessNote(pack: MemberPack): string {
    return accessNoteFor(pack);
  }

  protected reload(): void {
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    this.errorMessage.set(null);

    this.api
      .list()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (packs) => {
          this._packs.set(packs);
          this.loading.set(false);
        },
        error: (error: unknown) => {
          this.loading.set(false);
          // ⚠️ CLEARED, so a failed retry cannot leave stale rows sitting under
          // an error banner (B7.1's My Threads rule).
          this._packs.set(null);
          this.errorMessage.set(
            describeLoadFailure(error, 'We could not load your packs.'),
          );
        },
      });
  }
}
