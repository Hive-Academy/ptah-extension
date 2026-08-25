import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { LucideAngularModule, TriangleAlert } from 'lucide-angular';
import { HarnessHealthStore } from '@ptah-extension/marketplace/services';
import {
  HarnessBlockedPathsComponent,
  HarnessRepairDialogComponent,
  harnessBlockedPaths,
} from '@ptah-extension/marketplace/harness';

/**
 * HarnessCardComponent — the blocked-paths disclosure, on the home the user
 * actually lands on.
 *
 * ### Why this exists
 *
 * The same disclosure already renders inside the Marketplace harness badge's
 * popover, and until now that was its only mount point
 * (`plugins-surface.component.ts:70`, the sole `<ptah-harness-health-badge />`
 * in the repo). A shortfall explained only on a page the user may never open
 * is not explained. The reconciler's own WARN reaches the log, and a log line
 * cannot be clicked, so the Dashboard is the first surface where the number
 * and its explanation meet a reader.
 *
 * ### One derivation, three surfaces
 *
 * The blocked set is `missing ∩ foreign` and that intersection is computed in
 * exactly ONE place for the whole repo: `blockedTargetPaths` in
 * `@ptah-extension/shared` (`harness-sync.types.ts:338`). The reconciler's
 * boot WARN calls it, the popover calls it through
 * {@link harnessBlockedPaths}, and this card calls the same
 * {@link harnessBlockedPaths}. Nothing in `libs/frontend/dashboard` filters
 * `missing` against `foreign` itself, and nothing here may start to: the
 * function was moved out of `harness-sync` into `libs/shared` for the sole
 * purpose of making a second producer impossible, and three surfaces printing
 * three different counts for one condition is the failure that would make the
 * whole disclosure untrustworthy.
 *
 * The presentational half — {@link HarnessBlockedPathsComponent} — is
 * likewise imported, not re-implemented. Its prose about provenance is
 * load-bearing and must read identically wherever it appears.
 *
 * ### What it is, and what it is careful not to be (Task 11.2)
 *
 * Disclosure plus exactly ONE route. The card still makes no ownership claim
 * and captures no consent: its single button opens
 * {@link HarnessRepairDialogComponent} and does nothing else — no RPC, no
 * pre-selection, no "repair all", not even a count of what would be moved.
 * Provenance of these paths is unknown (`SkillJunctionService` LINKED skills
 * and only COPIED commands, so it never wrote them, and the candidates include
 * the user's own hand), so the claim is manufactured in one place, by ticking
 * boxes that arrive empty, and this card is not that place.
 *
 * The button was deliberately withheld until Batch 8 shipped
 * `harness:repairBlocked` and Batch 9 shipped the dialog. A control that opens
 * nothing is worse than no control, and the disclosure was worth shipping
 * without it.
 *
 * The dialog is rendered as a SIBLING of the card section rather than inside
 * it, which is what lets the "this card captures no consent" spec keep
 * asserting over the whole section while the dialog is open: the checkboxes
 * belong to the dialog's DOM, never to the card's. It also outlives the
 * section — a fully successful repair empties the blocked set and hides the
 * card, and the user still needs to read the per-path outcomes.
 *
 * ### Data
 *
 * No new RPC and no polling. `HarnessHealthStore` is registered in
 * `MESSAGE_HANDLERS` at bootstrap (`app.config.ts`), so the edge-triggered
 * `harness:healthChanged` push has already populated it by the time anything
 * renders — including pushes that arrived before this card was ever created.
 * The one pull below is the cold case only: no push has landed yet, which is
 * what happens when nothing about the harness changed at activation and the
 * backend therefore had nothing to broadcast.
 *
 * Complexity Level: 2 — one injected store, one derived view, one lifecycle
 * call, and one boolean of local state. The consent state deliberately is NOT
 * here: this component knows whether a dialog is mounted and nothing about
 * what is in it.
 */
@Component({
  selector: 'ptah-harness-card',
  standalone: true,
  imports: [
    LucideAngularModule,
    HarnessBlockedPathsComponent,
    HarnessRepairDialogComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (blocked().count > 0) {
      <section
        class="card bg-base-200/40 border border-warning/30 shadow-sm mt-2"
        data-testid="harness-card"
        aria-label="Harness blocked paths"
      >
        <div class="card-body p-4 gap-3">
          <div class="flex items-start gap-4">
            <span
              class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-warning/10 text-warning"
            >
              <lucide-angular
                [img]="AlertIcon"
                class="w-5 h-5"
                aria-hidden="true"
              ></lucide-angular>
            </span>

            <div class="flex flex-col gap-1 min-w-0">
              <h3 class="card-title text-base">Your harness is short</h3>
              <p class="text-xs text-base-content-muted">
                Some of what Ptah tried to install for your AI tools is not
                there, and nothing failed while installing it.
              </p>
            </div>
          </div>

          <ptah-harness-blocked-paths
            [blocked]="blocked()"
            [reconcileStep]="RECONCILE_STEP"
          />

          <button
            class="btn btn-sm btn-warning btn-outline self-start"
            type="button"
            data-testid="harness-card-repair"
            (click)="repairOpen.set(true)"
          >
            Move these aside…
          </button>
        </div>
      </section>
    }

    @if (repairOpen()) {
      <ptah-harness-repair-dialog
        [blocked]="blocked()"
        (closed)="repairOpen.set(false)"
      />
    }
  `,
})
export class HarnessCardComponent implements OnInit {
  private readonly store = inject(HarnessHealthStore);

  protected readonly AlertIcon = TriangleAlert;

  /**
   * Whether the consent dialog is mounted.
   *
   * An `@if` over a boolean rather than a persistent instance with an `open`
   * input, and that is load-bearing rather than stylistic: tearing the dialog
   * down on close is what guarantees decision U3's "nothing is ticked on open"
   * survives a RE-open after a partial repair. There is no selection to reset
   * because there is no dialog to hold one.
   */
  protected readonly repairOpen = signal(false);

  /**
   * The middle clause of the disclosure's action sentence, which names where
   * the user can act. Two routes, in the order of decreasing user control.
   *
   * Doing it by hand and reconciling still comes FIRST: it is the option that
   * requires no claim of ownership from anybody, and a user who is unsure whose
   * directory that is should take it. The dialog below is offered second, and
   * described as Ptah doing the move rather than as a fix, because that is all
   * it is — the same move, with the destination recorded.
   *
   * "the button below" is literal: the control sits directly under this
   * paragraph in the card body, so the sentence stays true on this surface.
   * The popover keeps its own wording (`then run Reconcile now.`), which is why
   * this is an input on the shared component rather than a second paragraph.
   */
  protected readonly RECONCILE_STEP =
    'then reconcile from Marketplace → Plugins, or let Ptah move it for you with the button below.';

  /**
   * The blocked set for the report the store already holds.
   *
   * Undetected targets are excluded, because {@link harnessBlockedPaths} does
   * that and this card must agree with the badge that shares it. An
   * uninstalled Codex is not a gap, so its paths are not a shortfall, and a
   * card announcing a shortfall the badge says does not exist is worse than
   * no card.
   */
  protected readonly blocked = computed(() =>
    harnessBlockedPaths(this.store.health()),
  );

  /**
   * Pull only if no report has arrived yet.
   *
   * Unconditional refresh would be wrong here in a way it is not on the
   * Marketplace badge: this card mounts at boot, on the home, every time — and
   * the push it shares a store with may already have delivered a newer report
   * than the backend's cache would answer with. Asking again would spend an
   * RPC round trip to re-learn what is already in the signal.
   */
  public ngOnInit(): void {
    if (this.store.health() === null) {
      void this.store.refresh();
    }
  }
}
