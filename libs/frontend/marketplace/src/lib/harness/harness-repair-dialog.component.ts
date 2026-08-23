import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { LucideAngularModule, FolderInput, X } from 'lucide-angular';
import type {
  HarnessRepairBlockedPath,
  HarnessRepairOutcome,
  HarnessRepairPathResult,
  HarnessTargetId,
} from '@ptah-extension/shared';
import type { HarnessBlockedDisclosure } from './harness-health.model';
import { HarnessHealthStore } from './harness-health.store';

/** One tickable row: a blocked path plus the target it belongs to. */
interface RepairCandidate {
  /** Stable identity for the selection set. Two targets can block the same relPath. */
  key: string;
  target: HarnessTargetId;
  targetLabel: string;
  relPath: string;
}

/**
 * Plain-language outcome for every value of {@link HarnessRepairOutcome}.
 *
 * Exhaustive by type, so a seventh outcome added to the wire contract fails to
 * compile here rather than rendering an empty cell. Each string says what
 * happened to the USER'S content, because that is the only thing they were
 * asked to risk — "the pass did not write" is Ptah's problem; "your directory
 * is in the quarantine folder and nowhere else" is theirs.
 */
const OUTCOME_TEXT: Readonly<Record<HarnessRepairOutcome, string>> = {
  repaired: "Moved aside. Ptah's copy is installed at the path.",
  restored:
    'Moved aside, but Ptah did not install its copy, so your content was put back where it was. Still blocked.',
  'move-failed':
    'Could not be moved. Your content is untouched and nothing was written at this path.',
  'restore-failed':
    'Moved aside, Ptah did not install its copy, and your content could not be put back. It is in the quarantine folder named below and nowhere else.',
  'not-blocked': 'No longer blocked, so Ptah refused it and left it untouched.',
  'not-a-path':
    'A server key inside a config file you also write, not a file. There is nothing to move aside, so this one does not apply.',
};

/**
 * HarnessRepairDialogComponent — where consent to touch a blocked path is
 * actually manufactured.
 *
 * ### What this dialog is authorising
 *
 * Every safety property the backend built is downstream of this surface being
 * honest. `harness:repairBlocked` re-derives the blocked set server-side and
 * refuses anything outside it, but it cannot know whether the user meant to
 * tick what they ticked. The provenance of these paths is genuinely UNKNOWN:
 * `SkillJunctionService` LINKED skills and only COPIED commands, so it never
 * wrote them; the candidates are the Claude Code SDK, the pre-TASK_2026_288
 * `npx skills add` path, and the user's own hand. Nothing proves any of them is
 * Ptah's. The dialog therefore says so, in those words, above the list.
 *
 * ### Three properties, and where each one lives
 *
 *  1. **Nothing is ticked on open** (decision U3). Structural, not a reset
 *     call: {@link selection} initialises empty and the host mounts this
 *     component behind an `@if`, so every open — including a re-open after a
 *     partial repair — is a fresh instance. There is no code path that could
 *     pre-tick a row, which is stronger than a code path that un-ticks them.
 *     A "Select all" affordance exists, but it is a button the user presses;
 *     that is the entire distinction U3 draws.
 *  2. **Only ticked paths are sent.** {@link selected} is derived by filtering
 *     the CURRENT {@link candidates} — the live blocked set — against the
 *     selection, rather than by reading the selection out directly. So a key
 *     that was ticked and has since left the blocked set (a push landed, or
 *     another window reconciled) cannot be sent, and nothing that was never in
 *     the blocked set can be constructed at all. The request is built from the
 *     rendered rows, so it cannot name a path the user was not shown.
 *  3. **An empty selection sends nothing.** Confirm is disabled, the handler
 *     returns early, and {@link HarnessHealthStore.repairBlocked} refuses an
 *     empty list before it reaches the wire. Three layers because a consent RPC
 *     that fires when consent was withheld is the one failure that makes the
 *     rest of the design decorative.
 *
 * ### Wording
 *
 * Leads with MOVE and never says delete, matching the disclosure it opens from
 * and the reconciler's WARN — a user comparing the three must not find three
 * different instructions. It names the quarantine destination BEFORE the user
 * consents, because "where does my directory go" is not an after-the-fact
 * detail. It states that the quarantine is never emptied and never expires
 * (decision U4), and it offers no affordance to empty it: a button
 * contradicting the documented promise is worse than no button.
 *
 * ### What it does not re-implement
 *
 * A blocked MCP fragment key (`.mcp.json#github`) is refused by the backend as
 * `not-a-path`. This dialog does NOT filter those out client-side. The
 * predicate lives in `harness-sync` and cannot be imported here, and copying it
 * would put a second definition of "is this a file" on the far side of the
 * wire — the same duplication rule that keeps `missing ∩ foreign` in
 * `@ptah-extension/shared`. The row is offered, the backend refuses it, and the
 * refusal is rendered in plain language. Nothing is moved either way.
 *
 * Complexity Level: 3 — one selection set, one call, two view phases (choose,
 * then outcomes). Kept as one component rather than a container/presentational
 * pair: the state IS the consent, and splitting it would put the set that
 * decides what gets sent one hop away from the checkboxes that build it.
 */
@Component({
  selector: 'ptah-harness-repair-dialog',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog
      class="modal modal-open"
      data-testid="harness-repair"
      aria-modal="true"
      aria-labelledby="harness-repair-title"
      (keydown.escape)="close()"
    >
      <div class="modal-box max-w-2xl">
        <!-- Header -->
        <div class="flex items-start justify-between gap-3 mb-3">
          <div class="flex items-start gap-3 min-w-0">
            <div
              class="w-10 h-10 rounded-lg bg-warning/10 border border-warning/20 flex items-center justify-center shrink-0"
            >
              <lucide-angular
                [img]="FolderInputIcon"
                class="w-5 h-5 text-warning"
                aria-hidden="true"
              />
            </div>
            <div class="min-w-0">
              <h3
                id="harness-repair-title"
                class="text-sm font-semibold text-base-content"
              >
                Move blocked paths aside
              </h3>
              <p class="text-[11px] text-base-content-muted mt-0.5">
                {{ subtitle() }}
              </p>
            </div>
          </div>
          <button
            class="btn btn-sm btn-circle btn-ghost shrink-0"
            type="button"
            data-testid="harness-repair-close"
            [disabled]="busy()"
            (click)="close()"
            aria-label="Close without moving anything"
          >
            <lucide-angular [img]="XIcon" class="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        <div class="max-h-[55vh] overflow-y-auto space-y-3 pr-1">
          <!-- The honest framing: this is why consent is being asked for. -->
          <div
            class="rounded-lg border border-warning/40 bg-warning/10 p-2.5"
            data-testid="harness-repair-provenance"
          >
            <p class="text-[11px] text-base-content leading-relaxed">
              Ptah cannot prove it created these directories. It has no record
              of writing them, and the things that could have — your AI tool, an
              older installer, or you — are indistinguishable from here. So
              nothing is ticked for you, and Ptah touches only what you tick.
            </p>
          </div>

          <p
            class="text-[11px] text-base-content-muted leading-relaxed"
            data-testid="harness-repair-action"
          >
            Move the occupant aside and Ptah installs its own copy in the space
            it leaves. Everything you tick is moved into a
            <code class="font-mono">{{ QUARANTINE_DIR_NAME }}</code> folder
            beside it — so
            <code class="font-mono">{{ QUARANTINE_EXAMPLE.from }}</code> becomes
            <code class="font-mono">{{ QUARANTINE_EXAMPLE.to }}</code> — intact,
            under its own name and the time it was moved. Ptah never empties
            that folder and nothing in it expires: what goes there stays until
            you deal with it yourself. Nothing here proves Ptah wrote these, so
            they may be your own work: read it before you discard anything.
          </p>

          @if (phase() === 'choose') {
            @if (candidates().length === 0) {
              <p
                class="text-[11px] text-base-content-muted"
                data-testid="harness-repair-none"
              >
                Nothing is blocked any more. There is nothing here to move.
              </p>
            } @else {
              <div class="flex items-center justify-between gap-2">
                <span
                  class="text-[11px] text-base-content-muted"
                  data-testid="harness-repair-count"
                >
                  {{ selected().length }} of {{ candidates().length }} selected
                </span>
                <button
                  class="btn btn-ghost btn-xs"
                  type="button"
                  data-testid="harness-repair-select-all"
                  [disabled]="busy()"
                  (click)="toggleAll()"
                >
                  {{ allSelected() ? 'Clear selection' : 'Select all' }}
                </button>
              </div>

              <ul class="space-y-1">
                @for (candidate of candidates(); track candidate.key) {
                  <li>
                    <label
                      class="flex items-start gap-2 rounded-lg border border-base-300 bg-base-200/40 p-2 cursor-pointer"
                      [attr.data-testid]="'harness-repair-row'"
                      [attr.data-path]="candidate.key"
                    >
                      <input
                        class="checkbox checkbox-xs mt-0.5 shrink-0"
                        type="checkbox"
                        data-testid="harness-repair-checkbox"
                        [attr.data-path]="candidate.key"
                        [checked]="isSelected(candidate.key)"
                        [disabled]="busy()"
                        (change)="toggle(candidate.key)"
                      />
                      <span class="min-w-0">
                        <span
                          class="block text-[10px] text-base-content-muted"
                          >{{ candidate.targetLabel }}</span
                        >
                        <code
                          class="block text-[11px] font-mono break-all text-base-content"
                          >{{ candidate.relPath }}</code
                        >
                      </span>
                    </label>
                  </li>
                }
              </ul>
            }
          } @else {
            <!-- Per-path outcomes. One row per path the user consented to. -->
            <ul class="space-y-1" data-testid="harness-repair-results">
              @for (result of results(); track $index) {
                <li
                  class="rounded-lg border border-base-300 bg-base-200/40 p-2 space-y-0.5"
                  [attr.data-testid]="'harness-repair-result'"
                  [attr.data-outcome]="result.outcome"
                >
                  <code class="block text-[11px] font-mono break-all">{{
                    result.relPath
                  }}</code>
                  <p class="text-[10px] text-base-content-muted">
                    {{ outcomeText(result.outcome) }}
                  </p>
                  @if (result.quarantinePath) {
                    <p
                      class="text-[10px] text-base-content-muted break-all"
                      data-testid="harness-repair-result-quarantine"
                    >
                      Your content is at
                      <code class="font-mono">{{ result.quarantinePath }}</code>
                    </p>
                  }
                  @if (result.reason) {
                    <p class="text-[10px] text-base-content-muted">
                      {{ result.reason }}
                    </p>
                  }
                </li>
              }
            </ul>
          }

          @if (store.error(); as errorMessage) {
            <div
              class="alert alert-error alert-sm py-1 px-2"
              role="alert"
              data-testid="harness-repair-error"
            >
              <span class="text-xs">{{ errorMessage }}</span>
            </div>
          }
        </div>

        <div class="modal-action mt-3">
          <button
            class="btn btn-ghost btn-sm"
            type="button"
            data-testid="harness-repair-cancel"
            [disabled]="busy()"
            (click)="close()"
          >
            {{ phase() === 'choose' ? 'Cancel' : 'Close' }}
          </button>
          @if (phase() === 'choose') {
            <button
              class="btn btn-warning btn-sm"
              type="button"
              data-testid="harness-repair-confirm"
              [disabled]="!canConfirm()"
              (click)="confirm()"
            >
              @if (busy()) {
                <span class="loading loading-spinner loading-xs"></span>
                Moving…
              } @else {
                {{ confirmLabel() }}
              }
            </button>
          }
        </div>
      </div>
    </dialog>
  `,
  styles: [
    `
      :host {
        display: contents;
      }
    `,
  ],
})
export class HarnessRepairDialogComponent {
  /**
   * The live blocked set, from {@link harnessBlockedPaths}.
   *
   * A signal input rather than a snapshot taken on open, on purpose: it is what
   * makes property 2 hold. If a `harness:healthChanged` push lands while this
   * dialog is open, the rows the user can send shrink with it.
   */
  public readonly blocked = input.required<HarnessBlockedDisclosure>();

  /** The user is done. The host tears this component down. */
  public readonly closed = output<void>();

  protected readonly store = inject(HarnessHealthStore);

  protected readonly FolderInputIcon = FolderInput;
  protected readonly XIcon = X;

  /**
   * The destination, named before the user consents rather than after.
   *
   * A NAME plus a worked example, not a single absolute path, because the
   * quarantine is a SIBLING of the occupant (`quarantineDirFor` is
   * `join(dirname(occupant), QUARANTINE_DIR_NAME)`) — so a blocked
   * `.codex/prompts/x` and a blocked `.claude/skills/y` land in two different
   * folders and any one literal here would be wrong for the other. The rule and
   * one instance of it is the honest way to say that in a sentence.
   *
   * The per-path destination is not re-derived client-side. The exact
   * `quarantinePath` comes back in the outcome for every path that moved,
   * including every failure after the move, so the user is told where their
   * content actually went by the code that actually put it there.
   */
  protected readonly QUARANTINE_DIR_NAME = '.ptah-quarantine';
  protected readonly QUARANTINE_EXAMPLE = {
    from: '.claude/skills/orchestration',
    to: '.claude/skills/.ptah-quarantine/orchestration-20260823T141530123',
  } as const;

  /**
   * Ticked rows, by {@link RepairCandidate.key}.
   *
   * Starts empty and there is no code that seeds it — see property 1 in the
   * class docblock. Held as a `Set` in a signal and replaced rather than
   * mutated, so `computed` downstream actually re-runs.
   */
  private readonly selection = signal<ReadonlySet<string>>(new Set<string>());

  /** Per-path outcomes of the one call, or `null` before it has been made. */
  protected readonly results = signal<
    readonly HarnessRepairPathResult[] | null
  >(null);

  /** `choose` until the call returns; `report` afterwards. */
  protected readonly phase = computed<'choose' | 'report'>(() =>
    this.results() === null ? 'choose' : 'report',
  );

  /** True while `harness:repairBlocked` is in flight. */
  protected readonly busy = computed(() => this.store.repairing());

  /**
   * Every blocked path as a tickable row, flattened across targets.
   *
   * The key carries the target because two targets can legitimately block the
   * same workspace-relative path, and a selection keyed on `relPath` alone
   * would tick both from one click.
   */
  protected readonly candidates = computed<readonly RepairCandidate[]>(() =>
    this.blocked().groups.flatMap((group) =>
      group.paths.map((relPath) => ({
        key: `${group.target}::${relPath}`,
        target: group.target,
        targetLabel: group.label,
        relPath,
      })),
    ),
  );

  /**
   * The rows that are both currently blocked AND ticked — the exact set that
   * gets sent.
   *
   * Derived from {@link candidates} rather than from {@link selection}, which
   * is what makes it impossible to send a path outside the blocked set: the
   * only way a `HarnessRepairBlockedPath` is ever constructed here is from a
   * row that is being rendered.
   */
  protected readonly selected = computed<readonly RepairCandidate[]>(() => {
    const ticked = this.selection();
    return this.candidates().filter((candidate) => ticked.has(candidate.key));
  });

  /** Confirm is live only with a non-empty selection and no call in flight. */
  protected readonly canConfirm = computed(
    () => this.selected().length > 0 && !this.busy(),
  );

  /** True when every rendered row is ticked, so the toggle reads honestly. */
  protected readonly allSelected = computed(() => {
    const total = this.candidates().length;
    return total > 0 && this.selected().length === total;
  });

  protected readonly subtitle = computed(() => {
    const total = this.candidates().length;
    return `${total} ${total === 1 ? 'path is' : 'paths are'} occupied by something Ptah does not own. Tick only the ones you are sure it should take over.`;
  });

  /** Counts the selection so the button never promises more than it will do. */
  protected readonly confirmLabel = computed(() => {
    const count = this.selected().length;
    return count === 0
      ? 'Move aside and install'
      : `Move ${count} aside and install`;
  });

  protected isSelected(key: string): boolean {
    return this.selection().has(key);
  }

  protected outcomeText(outcome: HarnessRepairOutcome): string {
    return OUTCOME_TEXT[outcome];
  }

  protected toggle(key: string): void {
    const next = new Set(this.selection());
    if (!next.delete(key)) {
      next.add(key);
    }
    this.selection.set(next);
  }

  /**
   * Tick or clear every rendered row.
   *
   * Permitted by U3 precisely because it is a press: the objection was never to
   * a user selecting thirteen paths at once, it was to a dialog that arrives
   * with thirteen paths already claimed on their behalf.
   */
  protected toggleAll(): void {
    this.selection.set(
      this.allSelected()
        ? new Set<string>()
        : new Set(this.candidates().map((candidate) => candidate.key)),
    );
  }

  /**
   * Send exactly the ticked paths.
   *
   * The early return is not redundant with the disabled button: a disabled
   * attribute is a rendering, and this method is the thing that actually
   * decides. The store refuses an empty list as well — the three checks exist
   * because "consent was withheld" and "consent was given" must not produce the
   * same network behaviour under any of them failing.
   */
  protected async confirm(): Promise<void> {
    const paths: HarnessRepairBlockedPath[] = this.selected().map(
      (candidate) => ({
        target: candidate.target,
        relPath: candidate.relPath,
      }),
    );
    if (paths.length === 0) {
      return;
    }
    const result = await this.store.repairBlocked(paths);
    if (result !== null) {
      this.results.set(result.paths);
    }
  }

  protected close(): void {
    this.closed.emit();
  }
}
