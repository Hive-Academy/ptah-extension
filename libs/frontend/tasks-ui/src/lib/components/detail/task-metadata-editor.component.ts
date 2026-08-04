import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import { LucideAngularModule, X } from 'lucide-angular';
import {
  TASK_ESTIMATES,
  TaskMetadataPatchSchema,
  labelKey,
  type TaskEstimate,
  type TaskMetadataPatch,
  type TaskSpecSummary,
} from '@ptah-extension/shared';
import { TASK_ESTIMATE_LABELS, labelChipClass } from '../../task-presentation';
import type { TaskMetadataWrite } from './task-metadata-write';

/**
 * Metadata editor for the task detail panel: labels, estimate, parent.
 *
 * ## It emits a patch; it never writes
 *
 * Every control computes a FULL-REPLACEMENT patch from the task it already
 * holds and emits it. `TasksStore.applyMetadata` is the only thing that issues
 * a write, and `tasks:updateMetadata` is the only method it issues. Nothing
 * here touches the RPC service, so a rendered-but-untouched editor is provably
 * write-free.
 *
 * ## The limits are imported, never restated
 *
 * The three label limits (no newline, ≤ 32 characters, ≤ 12 per task) and the
 * single-path-segment rule for a parent reference live in
 * `TaskMetadataPatchSchema` in `libs/shared` and nowhere else. This component
 * runs that schema over the candidate patch and renders the resulting issue
 * message VERBATIM. A local copy of "32" here would be a second source of truth
 * that drifts the first time either side moves — and it would drift silently,
 * because the two would only disagree at the boundary case nobody tests by hand.
 *
 * The store re-runs the same schema before the RPC (it is the funnel every
 * later batch reuses); the two cannot disagree because they are the same object.
 *
 * ## A pre-existing over-long label blocks OTHER label edits, on purpose
 *
 * The read boundary deliberately accepts a hand-authored 40-character label and
 * reports it as a warning, so the task still reaches the board. The write
 * boundary rejects it. A full-replacement `labels` array therefore fails while
 * that label is still in it — including when the user was removing a DIFFERENT
 * label. The verbatim message names the actual rule, and removing the offending
 * label itself still succeeds (that array no longer contains it), so the state
 * is recoverable by the obvious action. Papering over it here would mean
 * silently rewriting a value the author typed into a file with no undo.
 *
 * ## Untrusted text (BR-10 / NFR-4)
 *
 * Labels, task ids and every message rendered here reach the DOM through
 * `{{ interpolation }}` only. Nothing is passed to `[innerHTML]`, routed
 * through the markdown block, or interpolated into a path, glob or `RegExp`.
 */
@Component({
  selector: 'ptah-task-metadata-editor',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-3" data-testid="task-metadata-editor">
      <!-- Labels ------------------------------------------------------------->
      <div class="flex flex-col gap-1">
        <span class="text-xs text-base-content/50" id="task-label-editor-label">
          Labels
        </span>

        @if (labels().length > 0) {
          <!-- track $index: the authored array arrives from the parser
               UN-de-duplicated (FR-B4.8 keeps a repeat in the file), so the
               label text is not a unique key. Removal is by index for the same
               reason — see onRemoveLabel. -->
          <div class="flex flex-wrap gap-1" data-testid="task-editor-labels">
            @for (label of labels(); track $index) {
              <span
                class="badge badge-sm border font-normal max-w-full gap-1"
                [class]="chipClass(label)"
                [title]="label"
              >
                <span class="truncate">{{ label }}</span>
                <button
                  type="button"
                  class="opacity-60 hover:opacity-100 shrink-0"
                  data-testid="task-editor-label-remove"
                  [disabled]="busy()"
                  [attr.aria-label]="'Remove label ' + label"
                  (click)="onRemoveLabel($index)"
                >
                  <lucide-angular [img]="XIcon" class="w-3 h-3" />
                </button>
              </span>
            }
          </div>
        }

        <div class="flex gap-1">
          <input
            type="text"
            class="input input-xs input-bordered flex-1 min-w-0"
            list="task-label-completions"
            placeholder="Add a label"
            aria-labelledby="task-label-editor-label"
            data-testid="task-editor-label-input"
            [disabled]="busy()"
            [value]="labelDraft()"
            (input)="onLabelDraft($event)"
            (keydown.enter)="onAddLabel()"
          />
          <datalist id="task-label-completions">
            @for (option of labelCompletions(); track option) {
              <option [value]="option"></option>
            }
          </datalist>
          <button
            type="button"
            class="btn btn-xs"
            data-testid="task-editor-label-add"
            [disabled]="busy() || !canAddLabel()"
            (click)="onAddLabel()"
          >
            Add
          </button>
        </div>

        @if (labelError(); as message) {
          <p class="text-xs text-error" data-testid="task-editor-label-error">
            {{ message }}
          </p>
        }
      </div>

      <!-- Estimate ----------------------------------------------------------->
      <label class="flex flex-col gap-1">
        <span class="text-xs text-base-content/50">Estimate</span>
        <!-- Selection is expressed per-option rather than as [value] on the
             select: the options come from an @for, whose embedded views are
             created AFTER the host element's own bindings run, so a [value]
             binding would be applied against an empty option list on first
             render and silently fall back to "No estimate". -->
        <select
          class="select select-xs select-bordered"
          data-testid="task-editor-estimate"
          [disabled]="busy()"
          (change)="onEstimate($event)"
        >
          <option value="" [selected]="!task().estimate">No estimate</option>
          @for (estimate of estimates; track estimate) {
            <option
              [value]="estimate"
              [selected]="estimate === task().estimate"
            >
              {{ estimate }} — {{ estimateLabel(estimate) }}
            </option>
          }
        </select>
        @if (estimateError(); as message) {
          <span
            class="text-xs text-error"
            data-testid="task-editor-estimate-error"
          >
            {{ message }}
          </span>
        }
      </label>

      <!-- Parent ------------------------------------------------------------->
      <div class="flex flex-col gap-1">
        <span
          class="text-xs text-base-content/50"
          id="task-parent-editor-label"
        >
          Parent
        </span>
        <div class="flex gap-1">
          <input
            type="text"
            class="input input-xs input-bordered flex-1 min-w-0 font-mono"
            list="task-parent-completions"
            placeholder="Task folder name"
            aria-labelledby="task-parent-editor-label"
            data-testid="task-editor-parent-input"
            [disabled]="busy()"
            [value]="parentDraft()"
            (input)="onParentDraft($event)"
            (keydown.enter)="onSetParent()"
          />
          <datalist id="task-parent-completions">
            @for (option of parentCompletions(); track option) {
              <option [value]="option"></option>
            }
          </datalist>
          <button
            type="button"
            class="btn btn-xs"
            data-testid="task-editor-parent-set"
            [disabled]="busy() || !canSetParent()"
            (click)="onSetParent()"
          >
            Set
          </button>
          @if (task().parent) {
            <button
              type="button"
              class="btn btn-xs btn-ghost"
              data-testid="task-editor-parent-clear"
              [disabled]="busy()"
              (click)="onClearParent()"
            >
              Clear
            </button>
          }
        </div>
        @if (parentError(); as message) {
          <p class="text-xs text-error" data-testid="task-editor-parent-error">
            {{ message }}
          </p>
        }
      </div>
    </div>
  `,
})
export class TaskMetadataEditorComponent {
  public readonly task = input.required<TaskSpecSummary>();

  /**
   * The workspace label union, as canonical display text. Completion source and
   * nothing more — there is no label registry file and no persisted list, so a
   * label vanishes from this list the moment the last carrier stops naming it.
   */
  public readonly knownLabels = input<readonly string[]>([]);

  /** Board-visible task ids, for parent completion. */
  public readonly knownTaskIds = input<readonly string[]>([]);

  /** Set while a write for this task is outstanding. */
  public readonly busy = input(false);

  /** A requested carrier write. The host decides when and how to issue it. */
  public readonly apply = output<TaskMetadataWrite>();

  protected readonly estimates = TASK_ESTIMATES;
  protected readonly XIcon = X;

  // One error sink per field. A message rendered under the wrong heading names
  // a field the user did not touch, which is worse than no message: it sends
  // them to correct something that is not wrong.
  protected readonly labelDraft = signal('');
  protected readonly labelError = signal<string | null>(null);
  protected readonly estimateError = signal<string | null>(null);
  protected readonly parentDraft = signal('');
  protected readonly parentError = signal<string | null>(null);

  protected readonly labels = computed<readonly string[]>(
    () => this.task().labels,
  );

  protected readonly canAddLabel = computed(
    () => this.labelDraft().trim().length > 0,
  );
  protected readonly canSetParent = computed(
    () => this.parentDraft().trim().length > 0,
  );

  /**
   * Completions minus the labels this task already carries, matched on the
   * shared {@link labelKey} — so `Licensing` is not offered to a task that
   * already has `licensing `. Offering a label that would be refused as a
   * duplicate is a control that cannot work.
   */
  protected readonly labelCompletions = computed<readonly string[]>(() => {
    const held = new Set(this.task().labels.map(labelKey));
    return this.knownLabels().filter((label) => !held.has(labelKey(label)));
  });

  /** Every board task except this one — a task cannot be its own parent. */
  protected readonly parentCompletions = computed<readonly string[]>(() => {
    const self = this.task().id;
    return this.knownTaskIds().filter((id) => id !== self);
  });

  protected chipClass(label: string): string {
    return labelChipClass(label);
  }

  protected estimateLabel(estimate: TaskEstimate): string {
    return TASK_ESTIMATE_LABELS[estimate];
  }

  protected onLabelDraft(event: Event): void {
    this.labelDraft.set((event.target as HTMLInputElement).value);
    this.labelError.set(null);
  }

  protected onParentDraft(event: Event): void {
    this.parentDraft.set((event.target as HTMLInputElement).value);
    this.parentError.set(null);
  }

  /**
   * Append one label and emit the whole array.
   *
   * The draft is trimmed before it is validated. That is a normalization of a
   * value being AUTHORED right now, not of data already on disk — nothing here
   * rewrites an existing padded label, which would be an unasked-for edit to a
   * file with no undo.
   */
  protected onAddLabel(): void {
    if (this.busy()) return;
    const value = this.labelDraft().trim();
    if (value.length === 0) return;

    const task = this.task();
    if (task.labels.some((held) => labelKey(held) === labelKey(value))) {
      this.labelError.set('This task already carries that label.');
      return;
    }

    if (this.emit({ labels: [...task.labels, value] }, this.labelError)) {
      this.labelDraft.set('');
    }
  }

  /**
   * Drop the label at one position.
   *
   * By INDEX, not by value: a repeated label survives in the file (FR-B4.8), so
   * removing "the licensing chip" has to mean the chip the user pressed rather
   * than every copy of it. `[]` removes the key entirely.
   */
  protected onRemoveLabel(index: number): void {
    if (this.busy()) return;
    const next = this.task().labels.filter((_, at) => at !== index);
    this.emit({ labels: next }, this.labelError);
  }

  protected onEstimate(event: Event): void {
    if (this.busy()) return;
    const raw = (event.target as HTMLSelectElement).value;
    const next = raw === '' ? null : (raw as TaskEstimate);
    // A no-op patch still rewrites the carrier and refreshes `updated`. The
    // schema refuses an empty patch; this refuses an unchanged one.
    if ((this.task().estimate ?? null) === next) return;
    // Its OWN sink. Unreachable today — the value comes from a <select> built
    // from TASK_ESTIMATES — but a message routed to `labelError` would render
    // under the Labels heading, describing a field the user did not touch.
    this.emit({ estimate: next }, this.estimateError);
  }

  protected onSetParent(): void {
    if (this.busy()) return;
    const value = this.parentDraft().trim();
    if (value.length === 0) return;

    const task = this.task();
    if (value === task.id) {
      this.parentError.set('A task cannot be its own parent.');
      return;
    }
    if (value === task.parent) {
      this.parentError.set(`That is already this task's parent.`);
      return;
    }

    if (this.emit({ parent: value }, this.parentError)) {
      this.parentDraft.set('');
    }
  }

  protected onClearParent(): void {
    if (this.busy() || !this.task().parent) return;
    this.emit({ parent: null }, this.parentError);
  }

  /**
   * Validate a candidate patch against the shared schema and emit it.
   *
   * On failure the schema's own first issue message is written to `sink`
   * verbatim and NOTHING is emitted — the wording a user reads is the wording
   * the write boundary enforces, character for character.
   */
  private emit(
    patch: TaskMetadataPatch,
    sink: { set: (value: string | null) => void },
  ): boolean {
    const parsed = TaskMetadataPatchSchema.safeParse(patch);
    if (!parsed.success) {
      sink.set(
        parsed.error.issues[0]?.message ?? 'The requested change is not valid.',
      );
      return false;
    }
    sink.set(null);
    this.apply.emit({ taskId: this.task().id, patch });
    return true;
  }
}
