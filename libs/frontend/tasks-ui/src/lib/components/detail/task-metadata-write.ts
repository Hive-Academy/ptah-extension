import type { TaskMetadataPatch } from '@ptah-extension/shared';

/**
 * One carrier write, as requested by a presentational detail-panel control.
 *
 * ## Why the target task is named rather than implied
 *
 * Almost every edit made from a task's panel writes that task's own carrier —
 * but not all of them. The "this task blocks X" affordance writes **X**, with
 * `dependsOn: [...X.dependsOn, thisTask.id]`, because `blocks` is a derived
 * view of somebody else's `depends_on` and there is no `blocks:` frontmatter
 * key to write instead (and there never will be: an inverse key is a second
 * authored side that can disagree with the first, on two files, with no way to
 * tell which is right).
 *
 * Carrying `taskId` on the event makes that one-file-per-write contract
 * explicit at every emit site, instead of leaving the host to assume the
 * currently-open task is always the target.
 *
 * ## The patch is a FULL REPLACEMENT
 *
 * The emitting control computes the whole array from the task it already holds
 * — `[...ids, added]` or `ids.filter(...)` — because the writer has no
 * read-modify-write semantics it could make atomic. `[]` / `null` remove the
 * key, except `dependsOn: []`, which is still written as `[]`.
 */
export interface TaskMetadataWrite {
  /** The task whose carrier is written. Not necessarily the open task. */
  readonly taskId: string;
  /** The full-replacement patch, already validated against the shared schema. */
  readonly patch: TaskMetadataPatch;
}
