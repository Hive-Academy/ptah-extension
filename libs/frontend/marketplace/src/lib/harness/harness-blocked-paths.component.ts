import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import type { HarnessBlockedDisclosure } from './harness-health.model';

/**
 * The blocked-paths disclosure: desired paths an unowned file already occupies.
 *
 * Exists to answer ONE question the panel could not previously answer — why
 * the harness reads short while nothing failed. A blocked path is filtered out
 * before the write plan is built (`claude-target.ts:189-194`), so it is counted
 * in `missing` and is structurally incapable of ever reaching `writeFailed`.
 * The captured cold start is `missing=13, writeFailed=0` forever, with no
 * surface anywhere saying why (`tmp/logs/coldstart-306.log:844`).
 *
 * ### The prose is the deliverable, not the list
 *
 * The path list is the cheap half. The sentence explaining a refusal-versus-a-
 * failure is what the acceptance criterion asks for, which is why the wording
 * below is deliberate rather than incidental:
 *
 *  - **It leads with MOVE and never says delete.** Provenance of these paths is
 *    UNKNOWN. `SkillJunctionService` linked skills and only copied commands, so
 *    it never wrote them; the candidates are the Claude Code SDK, the
 *    pre-TASK_2026_288 `npx skills add` path, and the user's own hand. Nothing
 *    proves any of them is Ptah's, so the card must not imply Ptah is owed the
 *    space. Move is reversible; delete is not. Same wording as the backend WARN
 *    this card sits beside, on purpose — a user comparing the two must not find
 *    two different instructions.
 *  - **It is disclosure only.** No repair button, no consent, no quarantine.
 *    Those are a separate, consent-gated operation; offering a one-click fix
 *    for a file we cannot prove is ours is the exact thing the missing
 *    ownership proof forbids.
 *
 * Paths are rendered through normal interpolation and never `[innerHTML]`.
 * They are filesystem paths from the user's own machine, but they arrive over
 * the wire from a host whose version is not pinned to this bundle's.
 *
 * Complexity Level: 1 — one input, no state, no output. Split from the badge
 * for the same reason `HarnessTargetRowComponent` is: a self-contained visual
 * block whose prose would otherwise be half the badge's template.
 */
@Component({
  selector: 'ptah-harness-blocked-paths',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="rounded-lg border border-warning/40 bg-warning/5 p-2 space-y-1.5"
      data-testid="harness-blocked"
      aria-label="Blocked harness paths"
    >
      <h4
        class="text-[11px] font-semibold text-warning"
        data-testid="harness-blocked-heading"
      >
        {{ heading() }}
      </h4>

      <p
        class="text-[10px] text-base-content-muted leading-relaxed"
        data-testid="harness-blocked-explanation"
      >
        Something Ptah does not own already sits there. Each one counts as
        missing because the artifact is not installed, and Ptah left it alone
        because it cannot prove it wrote what is already there. A path it
        refuses is never attempted, so a block never shows up as a write failure
        — that is how the harness reads short with nothing having failed.
      </p>

      @for (group of blocked().groups; track group.target) {
        <div [attr.data-testid]="'harness-blocked-' + group.target">
          <p class="text-[10px] font-medium text-base-content">
            {{ group.label }}
          </p>
          <ul class="space-y-0.5 mt-0.5">
            @for (path of group.paths; track path) {
              <li class="text-[10px] text-base-content-muted break-all">
                <code class="font-mono">{{ path }}</code>
              </li>
            }
          </ul>
        </div>
      }

      <p
        class="text-[10px] text-base-content-muted leading-relaxed"
        data-testid="harness-blocked-action"
      >
        Move the occupant aside — the file or directory at each path, or the
        conflicting key in each config file — {{ reconcileStep() }} Nothing here
        proves Ptah wrote these, so they may be your own work: keep what you
        move, and read it before you discard anything.
      </p>
    </section>
  `,
})
export class HarnessBlockedPathsComponent {
  /**
   * Always non-empty in practice — the parent renders this behind a
   * `count > 0` guard, because an empty-state box explaining a condition that
   * is not happening is chrome, not information.
   */
  public readonly blocked = input.required<HarnessBlockedDisclosure>();

  /**
   * The one clause of the action sentence that names WHERE the reconcile is.
   *
   * Everything else in that paragraph is fixed and must stay fixed — it leads
   * with MOVE, it says the occupant may be your own work, and it never says
   * delete. Only the middle clause varies, because it points at a control and
   * the control is not in the same place on every surface: inside the
   * Marketplace popover the Reconcile button is eight pixels below this
   * sentence, whereas the Dashboard harness card has no button at all and must
   * say where to go instead.
   *
   * An input rather than a second copy of the paragraph. A user comparing the
   * two surfaces — or either surface against the reconciler's WARN — must not
   * find three differently-worded instructions for one action, and a duplicated
   * string is a string that drifts. The default is the popover's wording, so a
   * caller that does not care gets exactly what Batch 7 shipped.
   *
   * Include the terminating period: this is a whole clause, not a fragment the
   * template punctuates.
   */
  public readonly reconcileStep = input<string>('then run Reconcile now.');

  /**
   * Built here rather than inline so the count and its noun cannot be split
   * across template whitespace — this string is the one number a reader
   * checks against the badge above it.
   */
  protected readonly heading = computed(() => {
    const count = this.blocked().count;
    return `${count} blocked ${count === 1 ? 'path' : 'paths'}`;
  });
}
