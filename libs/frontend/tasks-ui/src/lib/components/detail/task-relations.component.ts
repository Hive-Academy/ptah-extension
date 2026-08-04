import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import type { TaskGraph, TaskSpecSummary } from '@ptah-extension/shared';
import {
  TASK_RELATION_GROUP_ORIGIN,
  TASK_RELATION_ORIGIN_NOTES,
  taskRelationHeading,
  type TaskRelationGroup,
  type TaskRelationOrigin,
} from '../../task-presentation';

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
 * It reads two inputs and emits an id to open. Write affordances arrive with
 * the metadata editor; nothing here mutates a carrier.
 */
@Component({
  selector: 'ptah-task-relations',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (groups().length > 0) {
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
            <div class="flex flex-wrap gap-1">
              @for (entry of group.entries; track entry.id) {
                <button
                  type="button"
                  class="badge badge-sm font-mono"
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
              }
            </div>
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

  /** The task the user asked to open. A read; nothing here writes. */
  public readonly openTask = output<string>();

  private static readonly NO_GRAPH_REASON =
    'The board index is not available here, so this task cannot be opened from the relation list.';

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
