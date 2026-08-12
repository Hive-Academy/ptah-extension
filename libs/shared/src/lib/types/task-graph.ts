/**
 * Derived task graph (TASK_2026_181) — parentage, inverse relations, label
 * union, colour hash.
 *
 * ## Why this module is zero-dependency
 *
 * The backend scanner and the `tasks-ui` board must agree, exactly, on what a
 * task's children are and which parent claims were honoured. Two
 * implementations that agree today diverge the first time one of them is
 * patched, and the divergence shows up as a board that disagrees with the
 * index for reasons no one can reproduce. So there is ONE implementation, it
 * lives in `libs/shared` (the only bridge between the two sides), and it
 * imports nothing but this folder's own types.
 *
 * ## Nothing here can produce a write
 *
 * `children` is read out of `effectiveParent`, which is read out of each
 * CHILD's frontmatter. A parent's carrier is therefore provably never touched
 * when a child appears, is re-parented, or is deleted (FR-B3.2). That property
 * is structural, not a convention: this module has no filesystem access of any
 * kind and takes plain data in and returns plain data out.
 *
 * ## `parent` is an opaque key here
 *
 * The declared `parent` value is treated as an opaque map key. It is NOT
 * re-validated as a path segment — that already happened at the parse boundary
 * (`isSinglePathSegment` in `task-frontmatter.ts`), which is the only place
 * that sees the raw file and the only place a structurally unsafe value is
 * cleared. Re-implementing the check here would create a second guard that can
 * drift from the first.
 */
import type { TaskSpecSummary, TaskValidationIssue } from './task-spec.types';

/**
 * Child counts for one parent task.
 *
 * `open` is derived rather than counted so the four numbers can never
 * disagree: `open === total - done - cancelled` by construction.
 */
export interface TaskChildRollup {
  readonly total: number;
  readonly done: number;
  readonly cancelled: number;
  readonly open: number;
}

/**
 * The whole derived index. Every field is recomputed from the summaries on
 * every build — **nothing here is persisted**, has a column, a frontmatter key
 * or a settings entry. Deleting the index database loses none of it.
 */
export interface TaskGraph {
  /** Every included task, keyed by id. The membership test for every relation. */
  readonly byId: ReadonlyMap<string, TaskSpecSummary>;
  /** Parent id → child ids, id-sorted. Only parents that HAVE children appear. */
  readonly children: ReadonlyMap<string, readonly string[]>;
  /** Parent id → child counts. Same key set as {@link children}. */
  readonly rollup: ReadonlyMap<string, TaskChildRollup>;
  /**
   * Child id → the parent claim that was actually HONOURED.
   *
   * A task whose claim was rejected (cycle, dangling, or two levels deep) is
   * simply absent — it still carries its declared `parent` and a validation
   * issue explaining why the claim was not honoured, and it still appears on
   * the board.
   */
  readonly effectiveParent: ReadonlyMap<string, string>;
  /**
   * Inverse of `dependsOn`: id → the tasks that declare a dependency on it.
   *
   * There is no `blocks:` frontmatter key and there never will be — an inverse
   * key would be a second authored side that can disagree with the first, on
   * two different files, with no way to tell which one is right (D3).
   */
  readonly blocks: ReadonlyMap<string, readonly string[]>;
  /** Inverse of `duplicates`: id → the tasks that declare it a duplicate. */
  readonly duplicatedBy: ReadonlyMap<string, readonly string[]>;
  /**
   * Symmetric closure of `relates_to`, computed from ONE authored side.
   *
   * Authored entries (this task's own array) come first, in authored order;
   * derived entries (someone else's array naming this task) follow, id-sorted.
   * The board relies on that split to tell an entry it may remove here from one
   * it must navigate to in order to remove (FR-B4.9).
   */
  readonly related: ReadonlyMap<string, readonly string[]>;
  /**
   * Every distinct label in the workspace, as canonical display text.
   *
   * De-duplicated on {@link labelKey} with first-seen winning, so `Licensing`
   * and `licensing ` collapse to a single entry rendered the way its first
   * author typed it. Deterministic: tasks are visited id-sorted and labels in
   * authored order, so filesystem iteration order cannot change the result.
   * This IS the completion source — there is no label registry file.
   */
  readonly knownLabels: readonly string[];
  /** Every distinct non-empty `executor`, first-seen order over id-sorted tasks. */
  readonly knownExecutors: readonly string[];
  /**
   * id → the entries of its `dependsOn` that resolve to a task which is neither
   * `done` nor `cancelled`.
   *
   * A dependency naming nothing is NOT counted here: it is already reported as
   * `dangling_depends_on`, and calling a typo an unmet dependency would state a
   * blocking relationship the author never established. Only ids with at least
   * one unmet dependency appear.
   */
  readonly unmetDependencies: ReadonlyMap<string, readonly string[]>;
}

/** `labels` match case- and whitespace-insensitively; this is that key. */
export function labelKey(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * FNV-1a, 32-bit. Chosen because it is four lines, has no dependencies, and is
 * bit-for-bit identical in the extension host and the webview — a chip that
 * changes colour when the same board is opened in the other host would read as
 * a bug in the data.
 *
 * `Math.imul` is load-bearing: a plain `*` overflows into a double past 2^53
 * and silently stops being FNV-1a.
 */
function fnv1a32(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Stable palette slot for a label.
 *
 * Hashed over {@link labelKey}, so `Licensing` and `licensing ` are one label
 * with ONE colour (R9). Nothing about the assignment is persisted, and colour
 * is never the sole carrier of meaning — every chip renders its text.
 *
 * @param paletteSize the number of slots available. A non-positive or
 * non-integer size yields `0` rather than `NaN`, because a presentation-layer
 * mistake must not put `undefined` into a class binding.
 */
export function labelColorIndex(raw: string, paletteSize: number): number {
  if (!Number.isInteger(paletteSize) || paletteSize <= 0) return 0;
  return fnv1a32(labelKey(raw)) % paletteSize;
}

// ---------------------------------------------------------------------------
// Parentage
// ---------------------------------------------------------------------------

const WHITE = 0;
const GREY = 1;
const BLACK = 2;

interface ParentageAnalysis {
  /** Honoured parent claims only. */
  readonly effectiveParent: ReadonlyMap<string, string>;
  /** id → the ONE parent issue for that task, when its claim was rejected. */
  readonly issues: ReadonlyMap<string, TaskValidationIssue>;
}

/**
 * Pass 1 (three-colour marking) + pass 2 (precedence table), both iterative.
 *
 * ## Pass 1 — why this terminates on ANY input
 *
 * `parent` is single-valued, so the parent relation is a functional graph
 * (out-degree ≤ 1) and the walk from any node is a single chain. Colours move
 * only WHITE → GREY → BLACK, never backwards. The inner `while` advances only
 * onto a WHITE node and immediately colours it GREY, so across the ENTIRE
 * algorithm the inner loop can execute at most once per task. A cycle of
 * length 1 (self-parent), 2, 3 or 200 halts in the pass that first enters it,
 * because the second visit to its entry node finds GREY, not WHITE.
 *
 * There is therefore no depth cap here, and one must not be added. A cap does
 * not prove termination; it hides the absence of a proof, and it silently
 * mis-reports any legitimate structure deeper than the cap.
 *
 * ## Pass 2 — the precedence table
 *
 * | Condition | Issue | Effective parent |
 * |---|---|---|
 * | no `parent` key | — | none |
 * | on a cycle (incl. self-parent) | `parent_cycle` | none |
 * | `parent` not in `byId` | `dangling_parent` | none |
 * | the parent ITSELF declares a parent in `byId` | `parent_depth_exceeded` | none |
 * | otherwise | — | `parent` |
 *
 * `parent_depth_exceeded` lands on the CHILD making the two-level claim, not on
 * the ancestor: the ancestor did nothing wrong, and a warning on a task the
 * author did not edit is a warning they cannot act on. Both tasks stay on the
 * board in every row of that table (NFR-11).
 */
function analyzeParentage(
  byId: ReadonlyMap<string, TaskSpecSummary>,
  sortedIds: readonly string[],
): ParentageAnalysis {
  // ── Pass 1: mark every task that sits on a parent cycle ───────────────────
  const colour = new Map<string, number>();
  const onCycle = new Set<string>();

  const declaredParent = (id: string): string | undefined =>
    byId.get(id)?.parent;

  for (const id of sortedIds) {
    if ((colour.get(id) ?? WHITE) !== WHITE) continue;

    // The chain currently being walked, in order. An explicit array — the
    // recursive form of this algorithm blows the stack on a long chain, and a
    // deep task tree is user data, not a bug.
    const walk: string[] = [];
    let cur: string | undefined = id;
    while (
      cur !== undefined &&
      byId.has(cur) &&
      (colour.get(cur) ?? WHITE) === WHITE
    ) {
      colour.set(cur, GREY);
      walk.push(cur);
      cur = declaredParent(cur);
    }

    // GREY can only mean "on the walk we are in the middle of" — every walk
    // blackens all of its members before the next one starts. So a GREY hit is
    // a cycle, and everything from that node to the end of the walk is on it.
    if (cur !== undefined && colour.get(cur) === GREY) {
      const entry = walk.indexOf(cur);
      for (let i = entry; i >= 0 && i < walk.length; i++) {
        onCycle.add(walk[i]);
      }
    }

    for (const node of walk) colour.set(node, BLACK);
  }

  // ── Pass 2: apply the precedence table ────────────────────────────────────
  const effectiveParent = new Map<string, string>();
  const issues = new Map<string, TaskValidationIssue>();

  for (const id of sortedIds) {
    const task = byId.get(id);
    const parent = task?.parent;
    if (task === undefined || parent === undefined) continue;

    if (onCycle.has(id)) {
      issues.set(id, {
        field: 'parent',
        code: 'parent_cycle',
        message:
          parent === id
            ? `parent '${parent}' is this task itself; the claim is not honoured.`
            : `parent '${parent}' closes a loop back onto '${id}'; the claim is not honoured.`,
        ref: parent,
      });
      continue;
    }

    const parentTask = byId.get(parent);
    if (parentTask === undefined) {
      issues.set(id, {
        field: 'parent',
        code: 'dangling_parent',
        message: `parent '${parent}' does not resolve to a readable task; the claim is not honoured.`,
        ref: parent,
      });
      continue;
    }

    // Parentage is ONE level deep by design. The grandparent must itself
    // RESOLVE for this to be a two-level claim: if the parent's own parent is
    // dangling then the parent is effectively standalone and this child's
    // claim is a perfectly ordinary one-level claim.
    const grandparent = parentTask.parent;
    if (grandparent !== undefined && byId.has(grandparent)) {
      issues.set(id, {
        field: 'parent',
        code: 'parent_depth_exceeded',
        message: `parent '${parent}' is itself a child of '${grandparent}'; parentage is one level deep, so the claim is not honoured.`,
        ref: parent,
      });
      continue;
    }

    effectiveParent.set(id, parent);
  }

  return { effectiveParent, issues };
}

// ---------------------------------------------------------------------------
// buildTaskGraph
// ---------------------------------------------------------------------------

/** Append `value` to `key`'s list, de-duplicating on insert. */
function addUnique(
  map: Map<string, string[]>,
  key: string,
  value: string,
): void {
  const bucket = map.get(key);
  if (bucket === undefined) {
    map.set(key, [value]);
    return;
  }
  if (!bucket.includes(value)) bucket.push(value);
}

/**
 * Derive the whole graph from a set of task summaries. Pure, O(N) in the number
 * of tasks and their declared relations, and free of any I/O.
 *
 * Duplicate ids in the input cannot happen (an id IS a folder name) but are
 * handled deterministically anyway: the first occurrence wins and every pass
 * reads `byId`, so a duplicate can never be counted twice.
 */
export function buildTaskGraph(tasks: readonly TaskSpecSummary[]): TaskGraph {
  const byId = new Map<string, TaskSpecSummary>();
  for (const task of tasks) {
    if (!byId.has(task.id)) byId.set(task.id, task);
  }

  // Every pass iterates this ONE order so the output cannot depend on the order
  // the filesystem happened to hand the folders back in.
  const sortedIds = [...byId.keys()].sort();

  const { effectiveParent } = analyzeParentage(byId, sortedIds);

  // ── children + rollup ─────────────────────────────────────────────────────
  const children = new Map<string, string[]>();
  for (const id of sortedIds) {
    const parent = effectiveParent.get(id);
    if (parent === undefined) continue;
    const bucket = children.get(parent);
    if (bucket === undefined) children.set(parent, [id]);
    else bucket.push(id);
  }
  // `sortedIds` drives the insertion order above, so each bucket is already
  // id-sorted; no second sort is needed and none is done.

  const rollup = new Map<string, TaskChildRollup>();
  for (const [parent, childIds] of children) {
    let done = 0;
    let cancelled = 0;
    for (const childId of childIds) {
      const status = byId.get(childId)?.status;
      if (status === 'done') done++;
      else if (status === 'cancelled') cancelled++;
    }
    rollup.set(parent, {
      total: childIds.length,
      done,
      cancelled,
      open: childIds.length - done - cancelled,
    });
  }

  // ── inverse relations: ONE pass, no traversal ─────────────────────────────
  //
  // No traversal means no cycle can arise here at all, whatever the data says.
  // Self-edges are filtered (the parser already reported them as
  // `dangling_relation`) and every bucket is de-duplicated on insert, so a
  // relation declared twice in one array produces one entry.
  const blocks = new Map<string, string[]>();
  const duplicatedBy = new Map<string, string[]>();
  const related = new Map<string, string[]>();
  const unmetDependencies = new Map<string, string[]>();

  // Authored `relates_to` first, in authored order — the derived half is
  // appended in the second loop, which is what lets the board tell an entry it
  // can remove here from one it has to navigate to.
  for (const id of sortedIds) {
    const task = byId.get(id);
    if (task === undefined) continue;
    for (const other of task.relatesTo) {
      if (other === id || !byId.has(other)) continue;
      addUnique(related, id, other);
    }
  }

  for (const id of sortedIds) {
    const task = byId.get(id);
    if (task === undefined) continue;

    for (const dependency of task.dependsOn) {
      if (dependency === id) continue;
      const target = byId.get(dependency);
      if (target === undefined) continue;
      addUnique(blocks, dependency, id);
      if (target.status !== 'done' && target.status !== 'cancelled') {
        addUnique(unmetDependencies, id, dependency);
      }
    }

    for (const duplicate of task.duplicates) {
      if (duplicate === id || !byId.has(duplicate)) continue;
      addUnique(duplicatedBy, duplicate, id);
    }

    for (const other of task.relatesTo) {
      if (other === id || !byId.has(other)) continue;
      // The symmetric half. `addUnique` makes a mutually-authored pair
      // idempotent, so both files declaring each other reads the same as one.
      addUnique(related, other, id);
    }
  }

  // ── label union + executor union ──────────────────────────────────────────
  const labelsByKey = new Map<string, string>();
  const executors = new Set<string>();
  for (const id of sortedIds) {
    const task = byId.get(id);
    if (task === undefined) continue;
    for (const label of task.labels) {
      const key = labelKey(label);
      if (key.length === 0) continue;
      if (!labelsByKey.has(key)) labelsByKey.set(key, label);
    }
    const executor = task.executor?.trim();
    if (executor !== undefined && executor.length > 0) executors.add(executor);
  }

  return {
    byId,
    children,
    rollup,
    effectiveParent,
    blocks,
    duplicatedBy,
    related,
    knownLabels: [...labelsByKey.values()],
    knownExecutors: [...executors],
    unmetDependencies,
  };
}

// ---------------------------------------------------------------------------
// deriveCrossFileIssues
// ---------------------------------------------------------------------------

/**
 * The validation issues that need a view of the WHOLE scanned set.
 *
 * Exactly four codes, and they are exactly the four the doctor reports
 * read-only: `parent_cycle`, `dangling_parent`, `parent_depth_exceeded`,
 * `dangling_relation`. Nothing in here can be decided from a single file, which
 * is why `parseTaskFile` cannot produce them on its own.
 *
 * ## Overlap with the parser is expected, and callers must de-duplicate
 *
 * A caller that already passed `knownFolders` to `parseTaskFile` (the scanner
 * does; a single-file reparse cannot) has ALREADY been told about the
 * self-parent case, dangling parents and dangling relations. This function
 * reports them anyway, because a caller WITHOUT that view — the doctor, an MCP
 * `get` — has been told nothing and must get the complete picture from one
 * call. Merging callers de-duplicate on `(code, field)`; see
 * `TaskScannerService.scan`.
 *
 * The two rows that are genuinely new in every case are the multi-node form of
 * `parent_cycle` and `parent_depth_exceeded`.
 *
 * Only tasks with at least one issue appear in the result.
 */
export function deriveCrossFileIssues(
  tasks: readonly TaskSpecSummary[],
): ReadonlyMap<string, readonly TaskValidationIssue[]> {
  const byId = new Map<string, TaskSpecSummary>();
  for (const task of tasks) {
    if (!byId.has(task.id)) byId.set(task.id, task);
  }
  const sortedIds = [...byId.keys()].sort();

  const { issues: parentIssues } = analyzeParentage(byId, sortedIds);

  const result = new Map<string, TaskValidationIssue[]>();
  const push = (id: string, issue: TaskValidationIssue): void => {
    const bucket = result.get(id);
    if (bucket === undefined) result.set(id, [issue]);
    else bucket.push(issue);
  };

  for (const id of sortedIds) {
    const task = byId.get(id);
    if (task === undefined) continue;

    const parentIssue = parentIssues.get(id);
    if (parentIssue !== undefined) push(id, parentIssue);

    // `duplicates` and `relates_to` behave identically and are reported under
    // their YAML key, matching what the parser puts in `field` — the scanner's
    // `(code, field)` de-duplication depends on the two agreeing.
    for (const [yamlKey, entries] of [
      ['duplicates', task.duplicates],
      ['relates_to', task.relatesTo],
    ] as const) {
      for (const entry of entries) {
        if (entry === id) {
          push(id, {
            field: yamlKey,
            code: 'dangling_relation',
            message: `${yamlKey} entry '${entry}' refers to this task itself.`,
            ref: entry,
          });
          continue;
        }
        if (!byId.has(entry)) {
          push(id, {
            field: yamlKey,
            code: 'dangling_relation',
            // Deliberately narrower than the parser's wording. The parser can
            // only ask whether a FOLDER of that name exists; this pass knows
            // whether that folder produced a readable task, so it can name the
            // case the parser is structurally blind to — a folder that is right
            // there on disk but whose carrier failed to parse.
            message: `${yamlKey} entry '${entry}' does not resolve to a task with a readable carrier.`,
            ref: entry,
          });
        }
      }
    }
  }

  return result;
}
