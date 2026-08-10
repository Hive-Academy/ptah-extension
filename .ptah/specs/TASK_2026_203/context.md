# Context — File tree virtualization (B6)

## Origin

`TASK_2026_173` (Editor panel — git-diff correctness, measured performance, hunk stage/revert),
Batch 9 follow-up filing, Task 9.1. B6 was ruled out of scope from the task's inception: expanding a
large directory in the file tree renders every node with no windowing, but virtualizing the tree is a
self-contained project with its own keyboard-navigation, screen-reader-tree, scroll-restoration and
drag-and-drop surface — out of proportion to the rest of that task. B3 (Batch 4 of TASK_2026_173)
removed the sharper edge of the same problem class: the directory-indicator lookup that scanned every
changed file for every directory node on each git-status push, which was genuinely O(directories x
changed files).

## The M2 measurement (justification, quoted verbatim from `TASK_2026_173/measurements.md`)

### Baseline (pre-B3)

> **Reported figure (Jest)**: median = **3.034ms**, max = **5.161ms**, over 10 iterations.
> Samples (ms): `[5.161, 4.39, 3.946, 3.054, 3.014, 3.7, 3.014, 2.39, 2.211, 2.245]`.
>
> **Workload**: 300 `GitFileStatus` entries dispatched via a real `window` `message` event, against a
> real (non-mocked) `GitStatusService` instance wired to 100 real `FileTreeNodeComponent` fixtures (90
> file nodes across 10 synthetic directories + 10 directory nodes).
> **Sample count**: 10 iterations. **Method**: `performance.now()` wraps the dispatch +
> `fixture.detectChanges()` for all 100 fixtures + `TestBed.flushEffects()`.

### After — B3 `changedDirPrefixes`, captured 2026-08-10 (Batch 4)

Same harness, same workload (300 entries x 100 fixtures, 10 iterations), same machine.

| Execution          | median (ms) | max (ms) |
| ------------------ | ----------- | -------- |
| Baseline           | 3.034       | 5.161    |
| After, execution 1 | 2.605       | 5.265    |
| After, execution 2 | 3.512       | 7.236    |
| After, execution 3 | 3.658       | 7.725    |

> The M2 target (median >=80% below baseline, i.e. <=0.607ms) was **MISSED by a wide margin, and the
> three executions straddle the baseline, so the honest reading is that this harness shows NO
> measurable change at all.** Why: the harness total is dominated by Angular change detection over 100
> `FileTreeNodeComponent` fixtures, not by the directory-indicator scan. At 300 changed files x 10
> directory nodes the removed scan is ~3,000 `startsWith` calls — a fraction of a millisecond inside a
> ~3ms budget.

### Scaling evidence (the claim the median cannot carry — `perf-m2-indicator-scaling.spec.ts`)

| Files               | SHIPPED (100 dirs x 50 passes) | REFERENCE (pre-B3 scan, re-implemented) |
| ------------------- | ------------------------------ | --------------------------------------- |
| 300                 | 0.891ms / 0.925ms              | 36.8ms / 86.0ms                         |
| 3000                | 0.730ms / 0.608ms              | 141.8ms / 183.8ms                       |
| growth on 10x files | **0.82x / 0.66x** (flat)       | 3.86x / 2.14x                           |

> Absolute separation at the larger workload is **~194x** (0.73ms vs 141.8ms for the identical 5,000
> directory evaluations). SHIPPED is flat while REFERENCE is not.

## What the number actually says (honest read, per dispatch instruction)

1. **At the tested scale (300 changed files / 100 tree-node fixtures), post-B3 handling cost is ~2.6–3.7ms median — not slow.** The multiplicative-growth bottleneck B3 targeted (directory-indicator lookup scanning every changed file per directory) is now flat to 10x file growth and ~194x faster in absolute terms at 3000 files vs the pre-B3 scan.
2. **This does not prove the raw DOM-rendering concern behind B6 is resolved.** M2's harness exercises `GitStatusService` + 100 `FileTreeNodeComponent` fixtures reacting to a status push — it does not test what happens when a single directory is expanded to reveal thousands of nodes simultaneously mounted in the DOM with no windowing (Angular `@for` over the full list, not incremental status handling). That is a different mechanism than anything M2 measures.
3. **Conclusion**: the sharper edge of the "large directory is slow" concern (B3's target) is measurably fixed. No measurement in this task's harness set shows the file tree is currently slow at any tested scale. There is, however, no positive evidence either way for the unwindowed-DOM-rendering scenario specifically, because nothing measures it directly.

**Filed as a LOW-priority watch item accordingly** — not urgent, not proven unnecessary, downgraded from
its original framing precisely because B3 removed the piece that had a measured, quantified cost.

## Fix (if picked up)

Virtualize the file-tree list (e.g. CDK virtual scroll or an equivalent windowing primitive) for
directories above a size threshold (e.g. >200 visible nodes), preserving keyboard navigation,
screen-reader tree semantics (`role="tree"`/`role="treeitem"`), scroll-restoration on
collapse/re-expand, and the existing drag-and-drop affordance. This is real scope — do not treat it as
a one-line change; the M2 numbers above justify investigating, not necessarily implementing immediately.

## Source

`TASK_2026_173/batch-9-dispatch.md` §2 (Task 9.1); `TASK_2026_173/tasks.md` Task 9.1, DoD item 10;
`TASK_2026_173/measurements.md` §M2.
