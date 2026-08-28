# Context

## What the user reported

"Most of the work is done on large monorepos with deep libraries and
architecture and we shouldn't have a laggy editor that intervenes with the main
process or degrades performance."

Surfaced by the boot probe built for TASK_2026_331: `editor:getFileTree` was
issued at 9563 ms and had not answered 65 seconds later on this repo. It
answered normally on a smaller project (10.7 s and 21.9 s on property-hub), so
the cost scales with the tree.

## Measurement (2026-08-28)

Replicating `buildFileTree`'s exact algorithm — sequential recursion,
`TREE_HIDDEN_DIRS` applied — against two real workspaces:

| Workspace      | dirs read | entries | walk    | payload  |
| -------------- | --------- | ------- | ------- | -------- |
| ptah-extension | 10738     | 69487   | 3945 ms | 10.91 MB |
| property-hub   | 1731      | 10328   | 591 ms  | 1.49 MB  |

Cost by depth, on ptah-extension:

| depth | dirs read | walk    | payload  |
| ----- | --------- | ------- | -------- |
| 1     | 1         | 10 ms   | 0.01 MB  |
| 2     | 25        | 4 ms    | 0.03 MB  |
| 3     | 120       | 21 ms   | 0.34 MB  |
| 4     | 998       | 104 ms  | 0.96 MB  |
| 6     | 10738     | 1071 ms | 10.91 MB |

Sequential vs parallel siblings at depth 6: 1071 ms -> 349 ms.

## Diagnosis

Three compounding causes, in order of impact.

1. **The default depth is 6.** That materializes 69487 entries the user will
   never look at. A file explorer paints the root's children collapsed. Depth 2
   is a 360x payload reduction and a 430x reduction in directory reads.
2. **Sibling recursion is sequential.** `buildFileTree` awaits each child
   directory inside a `for` loop, so 10738 reads happen one at a time. Under
   contention with the post-window boot — SQLite migration, harness reconcile,
   session import and the file-index build all doing disk I/O on the same event
   loop — a few ms per read is what turns 4 s into more than 65 s.
3. **No cap.** Nothing bounds the response, so a pathological tree has no
   backstop.

## Why the fix is safe

The lazy path already exists and is already used at the depth-6 boundary today.
A directory at the boundary returns `{ needsLoad: true, children: [] }`, and
`EditorWorkspaceHelper.loadDirectoryChildren` fetches it through
`editor:getDirectoryChildren` on expand. `mergeLoadedSubtrees` carries
already-loaded subtrees across a reload, so lowering the depth moves the
boundary closer and changes nothing else.

`node_modules` and `dist` were NOT the problem — `TREE_HIDDEN_DIRS` already
excludes them at every depth. An earlier assumption that the walk descended into
`node_modules` was wrong.

## Result (measured after the fix, same method as before)

| Workspace      | dirs read   | walk             | payload           |
| -------------- | ----------- | ---------------- | ----------------- |
| ptah-extension | 10738 -> 25 | 3945 ms -> 12 ms | 10.91 MB -> 28 KB |
| property-hub   | 1731 -> 27  | 591 ms -> 6 ms   | 1.49 MB -> 50 KB  |

429x fewer directory reads and a 399x smaller payload on this repo.

## What shipped

1. `FILE_TREE_INITIAL_DEPTH = 2`, replacing the inline `6`. The constant carries
   the per-depth measurement table so the next person can see what raising it
   costs.
2. `buildFileTree` fans siblings out with `Promise.all` instead of awaiting each
   child inside the loop. Result order is unchanged — `Promise.all` preserves
   input order and the sort still runs before the fan-out.

Nothing else changed. `TREE_HIDDEN_DIRS` filtering, the explicit-access
asymmetry, `getDirectoryChildren` and `mergeLoadedSubtrees` are all untouched.

## Tests

`editor-file-tree-cost.spec.ts` asserts COUNTS and ORDERING, never timings — a
wall-clock assertion on a directory walk is a flake generator, and the two
things that regressed here are countable.

- Read count does not grow with tree depth: 5 reads at fixture depths 3, 6 and
  10 alike. This is the defect's signature — cost scaling with the tree rather
  than with the level being shown.
- The depth-2 boundary is where it should be: the root's children carry real
  listings, their children carry `needsLoad: true`.
- Siblings are genuinely concurrent: the in-flight read count reaches the full
  fanout. The sequential form cannot exceed 1 by construction, whatever the
  fanout, so this test cannot pass on the old code.
- Result order is unchanged.
- `getDirectoryChildren` still returns the same shape, so expanding feels the
  same at every level.

Verified failing before the change: 5 of the 6 new cases failed against the
unfixed handler. The sixth is the `getDirectoryChildren` guard, which was
already correct and is there to catch the fix over-reaching.
