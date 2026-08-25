import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { LucideAngularModule, Sparkles } from 'lucide-angular';
import { ClaudeRpcService } from '@ptah-extension/core';
import { PluginBrowserModalComponent } from '@ptah-extension/chat-ui';
import type { HarnessGetSkillSelectionResult } from '@ptah-extension/shared';

/** Budget for the one read this card makes. A cached gate resolve plus one skills walk. */
const SKILL_SELECTION_READ_TIMEOUT_MS = 10_000;

/**
 * SkillSelectionCardComponent — a new project says it is propagating nothing.
 *
 * ### Why this exists (decision U2)
 *
 * A workspace that has never been asked which skills it wants starts as
 * `'selected'` with an empty allowlist, and that is the correct state: the two
 * alternatives were considered and rejected. Auto-selecting by workspace
 * analysis is more machinery that guesses, and a wrong guess is
 * indistinguishable from the bug this whole task exists to fix. Carrying the
 * previous workspace's selection over reproduces the original complaint exactly
 * whenever two projects use different stacks.
 *
 * What is left is silence — a project whose AI tools have no skills in them and
 * nothing anywhere saying why. This card is the "and says so" half of U2.
 *
 * ### It claims no fault, deliberately
 *
 * There is no amber, no `TriangleAlert`, no status badge and no count. Unlike
 * its neighbour `HarnessCardComponent`, which reports a genuine shortfall,
 * nothing here is wrong: `sources` is `ok`, every pass is clean, and the harness
 * holds exactly what the workspace asked for. The wording is "no skills selected
 * for this project yet" and never "degraded" — this is an unanswered question,
 * not a malfunction, and styling it as one would train the user to ignore the
 * card that does report malfunctions.
 *
 * That is the same reasoning that keeps unselected slugs out of `HarnessHealth`
 * entirely (task 4.3): an unselected skill is not `missing`, because `missing`
 * means "desired but not owned on disk" and an unselected slug is not desired.
 * This card is where that state becomes visible instead.
 *
 * ### One card, one control
 *
 * Following the precedent card exactly: the button opens the existing
 * **Configure Ptah Skills** modal and does nothing else. No RPC, no
 * pre-selection, no "select all" shortcut. The selection is made in one place,
 * by ticking boxes, and this card is not that place — a convenience here would
 * manufacture a choice the user did not make, which is precisely what U2
 * rejected.
 *
 * The modal is a SIBLING of the section rather than a child, so a spec asserting
 * "this card contains no checkboxes" keeps holding while the modal is open, and
 * so the modal outlives the card: a successful selection empties the condition
 * below and hides the section while the user is still looking at the picker.
 *
 * Complexity Level: 2 — one RPC read, one derived boolean, one piece of local
 * UI state. No store: this is the only consumer in the lib, and a `providedIn:
 * 'root'` service holding one read would be indirection with a single caller.
 */
@Component({
  selector: 'ptah-skill-selection-card',
  standalone: true,
  imports: [LucideAngularModule, PluginBrowserModalComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (needsSelection()) {
      <section
        class="card bg-base-200/40 border border-base-300 shadow-sm mt-2"
        data-testid="skill-selection-card"
        aria-label="Skills for this project"
      >
        <div class="card-body p-4 gap-3">
          <div class="flex items-start gap-4">
            <span
              class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"
            >
              <lucide-angular
                [img]="SparklesIcon"
                class="w-5 h-5"
                aria-hidden="true"
              ></lucide-angular>
            </span>

            <div class="flex flex-col gap-1 min-w-0">
              <h3 class="card-title text-base">
                No skills selected for this project yet
              </h3>
              <p class="text-xs text-base-content-muted leading-relaxed">
                Ptah keeps each project's skills separate, so a new one starts
                empty rather than inheriting the last one's. Pick what this
                project should hand to Claude, Codex, Copilot and Cursor.
              </p>
            </div>
          </div>

          <button
            class="btn btn-sm btn-primary btn-outline self-start"
            type="button"
            data-testid="skill-selection-card-choose"
            (click)="pickerOpen.set(true)"
          >
            Choose skills…
          </button>
        </div>
      </section>
    }

    @if (pickerOpen()) {
      <ptah-plugin-browser-modal [isOpen]="true" (closed)="onPickerClosed()" />
    }
  `,
})
export class SkillSelectionCardComponent implements OnInit {
  private readonly rpc = inject(ClaudeRpcService);

  protected readonly SparklesIcon = Sparkles;

  /** Whether the Configure Ptah Skills modal is mounted. */
  protected readonly pickerOpen = signal(false);

  /**
   * The last answer from `harness:get-skill-selection`, or `null` before one
   * arrives.
   *
   * `null` is also the answer for "no workspace open" and "this host predates
   * the gate", and all three render nothing. A card that appeared while the
   * question could not even be asked would be announcing a state Ptah has not
   * established.
   */
  private readonly selection = signal<HarnessGetSkillSelectionResult | null>(
    null,
  );

  /**
   * The one condition: this workspace propagates an allowlist, and the
   * allowlist is empty.
   *
   * `'all'` never shows the card — a workspace propagating everything, whether
   * the user chose that or the migration inferred it, is not waiting on an
   * answer. Nor does a `'selected'` workspace with even one slug: a deliberately
   * short list is a finished decision, and re-asking would make this the
   * permanent nag the design is trying to avoid.
   */
  protected readonly needsSelection = computed(() => {
    const current = this.selection();
    return (
      current !== null &&
      current.mode === 'selected' &&
      current.slugs.length === 0
    );
  });

  public ngOnInit(): void {
    void this.refresh();
  }

  /**
   * Re-read after the picker closes, on Cancel as well as on Save.
   *
   * The modal reports neither what was chosen nor whether anything was — its
   * `saved` output carries plugin ids, which are a different axis — so this card
   * asks the backend rather than inferring. One read on close is cheaper than
   * being wrong, and it is the only way a card that should now be gone actually
   * goes away without a reload.
   */
  protected onPickerClosed(): void {
    this.pickerOpen.set(false);
    void this.refresh();
  }

  /**
   * Read the current selection. Never throws and never surfaces an error.
   *
   * A failed read leaves the previous answer standing (or `null`, which hides
   * the card). This is an unanswered question, not a fault, so a transport
   * failure here has nothing to tell the user that would be worth an error
   * banner on their home screen.
   */
  private async refresh(): Promise<void> {
    try {
      const result = await this.rpc.call(
        'harness:get-skill-selection',
        {},
        { timeout: SKILL_SELECTION_READ_TIMEOUT_MS },
      );
      if (result.isSuccess() && result.data) {
        this.selection.set(result.data);
      }
    } catch (error: unknown) {
      console.warn('[SkillSelectionCard] could not read the skill selection', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
