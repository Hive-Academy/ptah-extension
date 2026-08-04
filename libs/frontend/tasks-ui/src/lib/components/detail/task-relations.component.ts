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
  TaskMetadataPatchSchema,
  type TaskGraph,
  type TaskMetadataPatch,
  type TaskSpecSummary,
} from '@ptah-extension/shared';
import {
  TASK_RELATION_GROUP_ORIGIN,
  TASK_RELATION_ORIGIN_NOTES,
  taskRelationHeading,
  type TaskRelationGroup,
  type TaskRelationOrigin,
} from '../../task-presentation';
import type { TaskMetadataWrite } from './task-metadata-write';

/**
 * The frontmatter array each authored relation group replaces.
 *
 * `blocks` and `duplicated_by` are absent because there is no key on THIS
 * carrier that could hold them — they are derived views of somebody else's
 * array. Being explicit about what that does and does not buy, because the two
 * halves are separately load-bearing and neither is redundant:
 *
 *  - **What the type gives you.** `Partial<Record<…>>` makes the lookup return
 *    `undefined` for those two groups, and `onRemove` returns early on
 *    `undefined`. So a removal cannot be BUILT for them: there is no field name
 *    to put in the patch. This holds no matter what the caller passes.
 *  - **What the type does NOT give you.** It says nothing about `related`,
 *    which is a `mixed` group — it has a key here, and both of its halves would
 *    find it. On its own the type would let the DERIVED half of `related` be
 *    removed, which would replace this task's `relates_to` with an array
 *    filtered on an id it never declared. That is a real write to the wrong
 *    file, not a no-op.
 *  - **What closes it.** `removableField` is populated only when
 *    `origin === 'authored'`, computed per rendered group. That is what makes
 *    the derived half of `related` non-removable, and it is the only thing that
 *    does.
 *
 * Both are needed. Delete the `origin` check and `related:derived` becomes
 * removable; delete an entry from this map and nothing catches it.
 */
const AUTHORED_RELATION_FIELD: Partial<
  Record<TaskRelationGroup, 'dependsOn' | 'duplicates' | 'relatesTo'>
> = {
  blocked_by: 'dependsOn',
  duplicates: 'duplicates',
  related: 'relatesTo',
};

/** The relation kinds the add control can author, in rendered order. */
const RELATION_ADD_KINDS = [
  'blocked_by',
  'blocks',
  'duplicates',
  'related',
] as const;
type RelationAddKind = (typeof RELATION_ADD_KINDS)[number];

/** What the add control's `<select>` reads for each kind. */
const RELATION_ADD_LABELS: Record<RelationAddKind, string> = {
  blocked_by: 'is blocked by',
  blocks: 'blocks',
  duplicates: 'duplicates',
  related: 'relates to',
};

/**
 * A full-replacement patch for one relation array.
 *
 * Written as a switch rather than a computed key: `{ [field]: ids }` with a
 * union-typed key widens to an index signature, which no longer type-checks
 * against {@link TaskMetadataPatch} — the field names would stop being verified
 * at exactly the point they matter.
 */
function relationPatch(
  field: 'dependsOn' | 'duplicates' | 'relatesTo',
  ids: readonly string[],
): TaskMetadataPatch {
  const value = [...ids];
  switch (field) {
    case 'dependsOn':
      return { dependsOn: value };
    case 'duplicates':
      return { duplicates: value };
    case 'relatesTo':
      return { relatesTo: value };
  }
}

/** One rendered relation edge. */
export interface TaskRelationEntry {
  /** The task on the other end of the edge. Rendered as text, never as markup. */
  readonly id: string;
  /**
   * Whether this edge can be opened from here.
   *
   * Always true on the real board — every id in a rendered group came out of
   * the graph and therefore names a task that exists. It is false only when no
   * graph was supplied, and then {@link reason} says so out loud rather than
   * leaving a control that does nothing when pressed (FR-B4.9).
   */
  readonly navigable: boolean;
  /** Why the entry cannot be opened. Empty when {@link navigable}. */
  readonly reason: string;
}

/** One rendered group: a heading, an origin sentence, and its edges. */
export interface TaskRelationGroupView {
  /** Stable key — the group id, suffixed for the two halves of `related`. */
  readonly key: string;
  readonly group: TaskRelationGroup;
  readonly label: string;
  readonly origin: TaskRelationOrigin;
  readonly note: string;
  readonly entries: readonly TaskRelationEntry[];
  /**
   * The frontmatter array a removal from this group would replace, or
   * `undefined` when this group's edges are not this task's to remove.
   *
   * Derived groups always leave it `undefined`: their entries are another
   * task's authored data, and the only honest way to change them is to open
   * that task — which is exactly what the group's note already says.
   */
  readonly removableField?: 'dependsOn' | 'duplicates' | 'relatesTo';
}

/**
 * Read-only relation groups for the task detail panel (FR-B4.9).
 *
 * ## Five groups, one authored side each
 *
 * | Group | Source | Origin |
 * |---|---|---|
 * | Blocked by | this task's `depends_on` | authored |
 * | Blocks | `graph.blocks` — the inverse of everyone else's `depends_on` | derived |
 * | Duplicates | this task's `duplicates` | authored |
 * | Duplicated by | `graph.duplicatedBy` | derived |
 * | Related | `graph.related` — split into the half this task authored and the half it did not | mixed |
 *
 * There is no `blocks:` frontmatter key and there never will be: an inverse key
 * is a second authored side that can disagree with the first, on two different
 * files, with no way to tell which one is right.
 *
 * ## Authored versus derived is carried by TEXT
 *
 * Every group states, in a sentence, which carrier owns its edges. `related` is
 * therefore rendered as TWO homogeneous groups rather than one mixed list, so a
 * reader never has to infer ownership from a border style. Style reinforces the
 * sentence; it never carries the meaning on its own (NFR-12).
 *
 * ## Every rendered entry resolves
 *
 * Groups are built from the graph, which only ever contains ids that name a
 * readable task. A `relates_to` entry pointing at a folder that does not exist
 * is deliberately NOT rendered here: it would be a control that navigates
 * nowhere. It is reported instead as a `dangling_relation` validation warning,
 * which is where a broken pointer belongs.
 *
 * ## This component issues no write
 *
 * It emits requests. `TasksStore.applyMetadata` is the only thing that writes,
 * and `tasks:updateMetadata` is the only method it calls. Nothing here touches
 * the RPC service, so a rendered-but-untouched panel is provably write-free.
 *
 * ## Authored edges are removable HERE; derived edges are not
 *
 * A remove control appears on an entry only when this task's own frontmatter
 * holds it — `depends_on`, `duplicates`, and the half of `relates_to` this task
 * declared. The derived groups get none, because the array is somebody else's;
 * their note already says to open that task.
 *
 * Removal replaces the WHOLE array with one filtered by value, so a repeated
 * entry goes in one action. The list is de-duplicated for display (FR-B4.8), so
 * one chip stands for every copy of that id and removing it has to mean all of
 * them — leaving a stale copy behind after the user removed the only control
 * that named it would be worse than either alternative.
 *
 * ## FR-B4.3 — "this task blocks X" writes X, and only X
 *
 * There is no `blocks:` frontmatter key and there never will be. Declaring that
 * B blocks A is therefore a write to **A**: `dependsOn: [...A.dependsOn, B.id]`.
 * One file, one conflict domain. It needs A's current array, so A has to be on
 * the board; when it is not, the control says so instead of guessing at an
 * array it cannot see.
 */
@Component({
  selector: 'ptah-task-relations',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (groups().length > 0 || editable()) {
      <div class="flex flex-col gap-2" data-testid="task-relations">
        @for (group of groups(); track group.key) {
          <div
            class="flex flex-col gap-1"
            [attr.data-testid]="'task-relations-group-' + group.key"
          >
            <div class="flex items-baseline gap-1.5">
              <span class="text-xs text-base-content/50">{{
                group.label
              }}</span>
              <span class="text-[10px] text-base-content/40 tabular-nums">
                {{ group.entries.length }}
              </span>
            </div>
            <!-- The origin sentence is load-bearing for FR-B4.9: it is the
                 only place that says which carrier owns the edge. It is
                 therefore held to the same 4.5:1 the chips are — 5.01:1 at its
                 worst across the four audited themes, at 12px. -->
            <p class="text-xs leading-tight text-base-content/80">
              {{ group.note }}
            </p>
            <div class="flex flex-wrap items-center gap-1">
              @for (entry of group.entries; track entry.id) {
                <span class="inline-flex items-center gap-0.5">
                  <button
                    type="button"
                    class="badge badge-sm font-mono"
                    data-testid="task-relation-chip"
                    [class.badge-outline]="group.origin === 'authored'"
                    [class.badge-ghost]="group.origin === 'derived'"
                    [class.border-dashed]="group.origin === 'derived'"
                    [class.border]="group.origin === 'derived'"
                    [disabled]="!entry.navigable"
                    [title]="entryTitle(group, entry)"
                    [attr.aria-label]="entryTitle(group, entry)"
                    (click)="openTask.emit(entry.id)"
                  >
                    {{ entry.id }}
                  </button>
                  @if (editable() && group.removableField) {
                    <button
                      type="button"
                      class="btn btn-ghost btn-xs btn-square opacity-60 hover:opacity-100"
                      data-testid="task-relation-remove"
                      [disabled]="busy()"
                      [title]="removeTitle(group, entry)"
                      [attr.aria-label]="removeTitle(group, entry)"
                      (click)="onRemove(group, entry.id)"
                    >
                      <lucide-angular [img]="XIcon" class="w-3 h-3" />
                    </button>
                  }
                </span>
              }
            </div>
          </div>
        }

        <!-- One add control for every kind, so a relation can be declared even
             when its group has no entries yet and therefore does not render. -->
        @if (editable()) {
          <div class="flex flex-col gap-1" data-testid="task-relations-add">
            <span
              class="text-xs text-base-content/50"
              id="task-relation-add-label"
            >
              Declare a relation
            </span>
            <div class="flex flex-wrap items-center gap-1">
              <span class="text-xs text-base-content/60">This task</span>
              <select
                class="select select-xs select-bordered"
                aria-label="Relation kind"
                data-testid="task-relations-add-kind"
                [disabled]="busy()"
                (change)="onAddKind($event)"
              >
                @for (kind of addKinds; track kind) {
                  <option [value]="kind" [selected]="kind === addKind()">
                    {{ addKindLabel(kind) }}
                  </option>
                }
              </select>
              <input
                type="text"
                class="input input-xs input-bordered flex-1 min-w-0 font-mono"
                list="task-relation-completions"
                placeholder="Task folder name"
                aria-labelledby="task-relation-add-label"
                data-testid="task-relations-add-input"
                [disabled]="busy()"
                [value]="addDraft()"
                (input)="onAddDraft($event)"
                (keydown.enter)="onAdd()"
              />
              <datalist id="task-relation-completions">
                @for (option of addCompletions(); track option) {
                  <option [value]="option"></option>
                }
              </datalist>
              <button
                type="button"
                class="btn btn-xs"
                data-testid="task-relations-add-submit"
                [disabled]="busy() || !canAdd()"
                (click)="onAdd()"
              >
                Add
              </button>
            </div>
            @if (addError(); as message) {
              <p
                class="text-xs text-error"
                data-testid="task-relations-add-error"
              >
                {{ message }}
              </p>
            }
          </div>
        }
      </div>
    }
  `,
})
export class TaskRelationsComponent {
  public readonly task = input.required<TaskSpecSummary>();
  /**
   * The derived board graph. `null` degrades to authored-only groups whose
   * entries are disabled with a stated reason — never a control that silently
   * does nothing.
   */
  public readonly graph = input<TaskGraph | null>(null);

  /**
   * Show the write affordances. Off by default, so a host that only wants the
   * read view — and every existing caller — gets exactly what it had.
   */
  public readonly editable = input(false);

  /** Set while a write is outstanding, to keep a second one from being queued. */
  public readonly busy = input(false);

  /** The task the user asked to open. A read; nothing here writes. */
  public readonly openTask = output<string>();

  /** A requested carrier write. The host decides when and how to issue it. */
  public readonly apply = output<TaskMetadataWrite>();

  private static readonly NO_GRAPH_REASON =
    'The board index is not available here, so this task cannot be opened from the relation list.';

  protected readonly XIcon = X;
  protected readonly addKinds = RELATION_ADD_KINDS;

  protected readonly addKind = signal<RelationAddKind>('blocked_by');
  protected readonly addDraft = signal('');
  protected readonly addError = signal<string | null>(null);

  protected readonly canAdd = computed(() => this.addDraft().trim().length > 0);

  /** Every board task except this one — no relation may name its own task. */
  protected readonly addCompletions = computed<readonly string[]>(() => {
    const graph = this.graph();
    if (graph === null) return [];
    const self = this.task().id;
    return [...graph.byId.keys()].filter((id) => id !== self);
  });

  protected readonly groups = computed<readonly TaskRelationGroupView[]>(() => {
    const task = this.task();
    const graph = this.graph();
    const views: TaskRelationGroupView[] = [];

    // Authored entries are filtered against the graph so a dangling pointer
    // never becomes a control. Without a graph there is nothing to filter
    // against, so the entries are shown and disabled instead of hidden — the
    // author's data is still the truth, we just cannot act on it here.
    const resolves = (id: string): boolean =>
      graph === null || graph.byId.has(id);

    /**
     * @param half required only for a `mixed` group; for every other group the
     * origin comes from {@link TASK_RELATION_GROUP_ORIGIN}, so the constant and
     * the render cannot drift apart.
     */
    const push = (
      group: TaskRelationGroup,
      ids: readonly string[],
      half?: TaskRelationOrigin,
      keySuffix = '',
    ): void => {
      const declared = TASK_RELATION_GROUP_ORIGIN[group];
      const origin: TaskRelationOrigin =
        declared === 'mixed' ? (half ?? 'authored') : declared;

      // De-duplicate BEFORE keying. The derived buckets arrive de-duplicated
      // (`buildTaskGraph` inserts through `addUnique`) but the authored arrays
      // do NOT: the parser assigns its validated array straight through, and
      // FR-B4.8 requires a repeated entry to survive in the file. So
      // `depends_on: [X, X]` with a resolvable X reaches here as two entries
      // that would render under one track key — the same NG0955 defect the
      // validation-issue list carried, one file over. FR-B4.8 also states the
      // repeat is de-duplicated for DISPLAY, which is exactly this line.
      const entries = [...new Set(ids)]
        .filter(resolves)
        .map((id) => this.toEntry(id, graph));
      if (entries.length === 0) return;
      views.push({
        key: group + keySuffix,
        group,
        label: taskRelationHeading(group, origin),
        origin,
        note: TASK_RELATION_ORIGIN_NOTES[origin],
        entries,
        // Only an AUTHORED edge names an array on this carrier. The lookup is
        // partial by design, so a group with no key here can never gain a
        // remove control by accident.
        removableField:
          origin === 'authored' ? AUTHORED_RELATION_FIELD[group] : undefined,
      });
    };

    push('blocked_by', task.dependsOn);
    push('blocks', graph?.blocks.get(task.id) ?? []);
    push('duplicates', task.duplicates);
    push('duplicated_by', graph?.duplicatedBy.get(task.id) ?? []);

    // `related` is symmetric in the graph but authored on one side only. The
    // split is decided by exact membership in THIS task's own array rather than
    // by the graph's authored-first ordering, so a mutually-declared pair reads
    // as authored on both sides — which it is.
    const relatedIds = graph?.related.get(task.id) ?? task.relatesTo;
    const authoredHere = new Set(task.relatesTo);
    push(
      'related',
      relatedIds.filter((id) => authoredHere.has(id)),
      'authored',
      ':authored',
    );
    push(
      'related',
      relatedIds.filter((id) => !authoredHere.has(id)),
      'derived',
      ':derived',
    );

    return views;
  });

  protected entryTitle(
    group: TaskRelationGroupView,
    entry: TaskRelationEntry,
  ): string {
    if (!entry.navigable) return entry.reason;
    return group.origin === 'authored'
      ? `Open ${entry.id}. This edge is declared in this task's frontmatter.`
      : `Open ${entry.id}, which declares this edge.`;
  }

  protected removeTitle(
    group: TaskRelationGroupView,
    entry: TaskRelationEntry,
  ): string {
    return `Remove ${entry.id} from this task's ${group.label.toLowerCase()} list. Only this task's carrier is written.`;
  }

  protected addKindLabel(kind: RelationAddKind): string {
    return RELATION_ADD_LABELS[kind];
  }

  protected onAddKind(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    if ((RELATION_ADD_KINDS as readonly string[]).includes(value)) {
      this.addKind.set(value as RelationAddKind);
    }
    this.addError.set(null);
  }

  protected onAddDraft(event: Event): void {
    this.addDraft.set((event.target as HTMLInputElement).value);
    this.addError.set(null);
  }

  /**
   * Drop one id from an authored array and emit the whole remaining array.
   *
   * Filtered by VALUE: the display collapses a repeated entry into one chip
   * (FR-B4.8), so the chip the user pressed stands for every copy of that id.
   */
  protected onRemove(group: TaskRelationGroupView, id: string): void {
    const field = group.removableField;
    if (this.busy() || field === undefined) return;
    const next = this.task()[field].filter((held) => held !== id);
    this.emit(this.task().id, relationPatch(field, next), this.addError);
  }

  /**
   * Declare a relation.
   *
   * Three of the four kinds append to an array on THIS carrier. `blocks` is the
   * exception and the reason {@link TaskMetadataWrite} carries a task id: it
   * appends this task to the OTHER task's `depends_on`, because that is where
   * the edge is authored and there is no inverse key to write instead.
   */
  protected onAdd(): void {
    if (this.busy()) return;
    const ref = this.addDraft().trim();
    if (ref.length === 0) return;

    const task = this.task();
    if (ref === task.id) {
      this.addError.set('A task cannot declare a relation to itself.');
      return;
    }

    const kind = this.addKind();
    if (kind === 'blocks') {
      this.addBlocks(task, ref);
      return;
    }

    const field = AUTHORED_RELATION_FIELD[kind];
    // Unreachable: every non-`blocks` kind has an entry. Narrowing, not a guard.
    if (field === undefined) return;
    const held = task[field];
    if (held.includes(ref)) {
      this.addError.set(`This task already declares ${ref} in that list.`);
      return;
    }
    if (
      this.emit(task.id, relationPatch(field, [...held, ref]), this.addError)
    ) {
      this.addDraft.set('');
    }
  }

  /**
   * "This task blocks `ref`" — a write to `ref`'s carrier, never to this one.
   *
   * `ref`'s current `depends_on` is needed to compute the full replacement, so
   * `ref` has to be a task the board can see. When it is not, that is stated
   * rather than worked around: appending to an array we cannot read would mean
   * sending `[thisTask.id]` and silently discarding whatever `ref` already
   * declared.
   */
  private addBlocks(task: TaskSpecSummary, ref: string): void {
    const other = this.graph()?.byId.get(ref);
    if (!other) {
      this.addError.set(
        `${ref} is not on the board, so its dependencies cannot be edited from here. There is no blocks: key — this edge is declared by ${ref}.`,
      );
      return;
    }
    if (other.dependsOn.includes(task.id)) {
      this.addError.set(`${ref} already depends on this task.`);
      return;
    }
    if (
      this.emit(
        ref,
        { dependsOn: [...other.dependsOn, task.id] },
        this.addError,
      )
    ) {
      this.addDraft.set('');
    }
  }

  /**
   * Validate against the shared schema and emit.
   *
   * On failure the schema's own first issue message is surfaced VERBATIM and
   * nothing is emitted — a task reference that is not a single path segment is
   * refused with the same sentence every other boundary uses.
   */
  private emit(
    taskId: string,
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
    this.apply.emit({ taskId, patch });
    return true;
  }

  private toEntry(id: string, graph: TaskGraph | null): TaskRelationEntry {
    return graph === null
      ? {
          id,
          navigable: false,
          reason: TaskRelationsComponent.NO_GRAPH_REASON,
        }
      : { id, navigable: true, reason: '' };
  }
}
