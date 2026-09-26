# Batch 11 report: intake, reducer, system prompt

Task 11.1. Executor: frontend-developer. No git command was run.

## Files created

- `D:\projects\ptah-extension\.claude-worktrees\feat-task-494-apps-page-98c5a1802772\libs\frontend\mcp-apps-page\src\lib\state\apps-surface-intake.ts`
- `D:\projects\ptah-extension\.claude-worktrees\feat-task-494-apps-page-98c5a1802772\libs\frontend\mcp-apps-page\src\lib\state\apps-surface-intake.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\feat-task-494-apps-page-98c5a1802772\libs\frontend\mcp-apps-page\src\lib\state\apps-surface-reducer.ts`
- `D:\projects\ptah-extension\.claude-worktrees\feat-task-494-apps-page-98c5a1802772\libs\frontend\mcp-apps-page\src\lib\state\apps-surface-reducer.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\feat-task-494-apps-page-98c5a1802772\libs\frontend\mcp-apps-page\src\lib\apps-system-prompt.ts`
- `D:\projects\ptah-extension\.claude-worktrees\feat-task-494-apps-page-98c5a1802772\libs\frontend\mcp-apps-page\src\lib\apps-system-prompt.spec.ts`

No other file was modified. The Batch 10 files `apps-operation-overlays.ts` and `surface-operation-id.ts` and
`src/index.ts` are untouched.

## Public surface (for Batches 12 and 13)

- Intake: `guardSurfacePush(raw)`, `guardSurfaceReadResult(raw)`, `acceptSurfaceView(view)`, `countJsonBytes(value)`,
  type `AppsRenderable`.
- Reducer: `createAppsSurfaceState()`, `applySurfacePush(state, raw)`, `applySurfaceRead(state, raw, readSeq)`,
  `surfaceReadSeq(state)` (capture it when the read is SENT), `updateSurfaceOverlays(state, surfaceId, update)`,
  `APPS_EVICTED_NOTICE`, `APPS_TOMBSTONE_LIMIT`, types `AppsSurfaceEntry`, `AppsSurfaceState`, `AppsReduceResult`,
  `AppsReduceOutcome`, `AppsSurfaceNotice`.
- Both reducer entry points take `unknown` and run the structural guard themselves. A guard failure returns
  outcome `malformed` and the same state object.
- `AppsSurfaceEntry` = `{ surfaceId, materializedRevision, renderable, lastAppliedSeq, overlays: AppsOperationOverlays,
  viewState: SurfaceViewState }`.
- `APPS_SYSTEM_PROMPT` constant.

## Contracts confirmed against source

- `SurfaceUpdatedPayload` (`libs/shared/src/lib/types/messages/payload-map.ts:249-264`), `SurfaceReadResult`
  (`libs/shared/src/lib/types/rpc/rpc-surface.types.ts:90-96`), `SurfaceChange`, `SurfaceStateView`, `SurfaceContent`
  (`libs/shared/src/mcp-apps-contracts/surface.types.ts:187-243`).
- `SURFACE_LIMITS.maxSurfaceIdLength` 128, `maxPatchOps` 100, `maxSurfaceBytes` 256 KiB, and
  `SURFACE_STORE_LIMITS.maxSurfacesPerRoutingId` 8 (`surface-catalog.ts:84-133`).
- `validateSurfaceDocument(doc, countBytes)` (`surface.validator.ts:617`), `validateDashboardSpec(input, countBytes)`
  (`dashboard-spec.validator.ts:182`), `applySurfaceOps` (`surface-patch.ts:258`), `checkSurfaceSelection`
  (`surface-patch.ts:371`) and `SurfaceSelectionSchema`, all exported from the subpaths the plan names.
- The renderer types `SurfaceViewState` and `SurfaceInteractionState` come from `@ptah-extension/declarative-dashboard`.
- The tool names `ptah_surface_update`, `ptah_surface_get_state` and `ptah_dashboard_propose_spec` match
  `mcp-core/surface-tools.ts` and `dashboard-propose-spec.tool.ts:32`.

## Quality requirements

| Requirement | How it is met |
| --- | --- |
| Pure, never throws | No DI, timers or module state. Every transition returns a new state or the same object. The validators and `applySurfaceOps` fail closed. `acceptSurfaceView` also catches `error: unknown` (spec "never throws on a throwing getter"). |
| Zod-free structural guard | `guardSurfacePush` checks each field with `typeof` and `Number.isSafeInteger`. It checks `routingId` (non-empty string); `surfaceId` (1 to `maxSurfaceIdLength` characters); `revision` (a non-negative safe integer); `origin` (one of three values); the optional `toolCallId` and `operationId` (strings when present); `change.kind`; and, for a snapshot, `state.surfaceId` and `state.revision` equal the payload values and `state.content` is an object. For ops, `fromRevision` is a safe integer and `ops` is an array of at most `maxPatchOps` objects. For a delete, `reason` is `agent-deleted` or `evicted`. Zod is used only in `acceptSurfaceView`, through the contract validators and `SurfaceSelectionSchema`. |
| Whole document re-validated after snapshot and ops, fail-closed | A snapshot goes through `acceptSurfaceView`. After ops, `applyOps` ALWAYS re-runs `acceptSurfaceView` on the post-ops content (one validation per applied push, plan Quality). A rejection becomes `{ status: 'rejected', reason }`, which the renderer shows as the text fallback. |
| Selection cleared, surface kept | `acceptSelection` runs `SurfaceSelectionSchema.safeParse`, then `checkSurfaceSelection`. Either failure returns `selection: null`; the surface status stays `accepted`. |
| `console.warn` without payload values | Warnings name only the failing field (`dropped surface push: invalid change.ops`), a fixed phrase, or `error.name`. Specs plant the value `SECRET` in the rejected fields and assert that no warn argument contains it. |
| Rule 2: only a push or read advances the revision | `materializedRevision` is written only in `applySnapshot`, `applyOps` and `applySurfaceRead`. |
| Rule 1: an RPC ack is never materialized | `updateSurfaceOverlays` only replaces `overlays`, then calls `retireSettledUpTo(materializedRevision)`. It never writes the revision (spec "case 1"). |
| `applyRead` never lowers a revision and keeps entries pushed after the read | A view at or below `materializedRevision` is ignored. An absent entry is removed only when `lastAppliedSeq <= readSeq`. |
| Overlay reuse (Batch 10) | A push calls `retireSettledUpTo(revision)`. A read calls `retireSettledUpTo(resulting materializedRevision)`; see Deviation 2. |

## Spec pins

`apps-surface-intake.spec.ts`:

- The guard accepts: "accepts a snapshot, ops and deleted push".
- The guard rejects: "rejects %s and warns without payload values", with 18 cases.
- Read-result guard: "accepts found and not-found"; "rejects the whole result when one view is unusable".
- v2 accepted: "acceptSurfaceView, v2 > accepts a valid document".
- v2 rejected:
  - unknown version: "rejects an unknown schemaVersion";
  - size limit: "accepts exactly maxSurfaceBytes and rejects one byte more" (exact-byte builder, reason names the
    limit);
  - malformed: "rejects malformed content: %s" (5 cases), and "never throws on a throwing getter".
- v1 accepted: "acceptSurfaceView, v1 > accepts a valid spec".
- v1 rejected:
  - unknown version: "rejects an unknown catalogVersion";
  - size limit: "accepts exactly maxSpecBytes and rejects one byte more" (`makeDashboardSpecOfExactBytes`);
  - malformed: "rejects a malformed spec".
- Selection: "keeps a selection that resolves against the content"; "clears an out-of-range selection without
  rejecting the surface"; "clears a malformed selection without rejecting the surface".

`apps-surface-reducer.spec.ts`:

- Snapshot replaces atomically and resets view state: "replaces the document atomically and resets view state from the
  pushed state". Also "discards a snapshot at or below the materialized revision" and "advances the revision on a
  rejected document and shows the fallback without a read".
- Ops apply only from a matching `fromRevision`: "applies ops only from a matching fromRevision and keeps view state";
  "discards ops at or below the materialized revision".
- Ops failure returns `needsRead`: "returns needsRead when the ops cannot be applied".
- Re-validation failure after ops falls back: "falls back to the text view when the post-ops document fails
  re-validation".
- Gap returns `needsRead`: "returns needsRead on a fromRevision gap and changes nothing".
- Eviction at an EQUAL revision is terminal and tombstoned: "applies an eviction at an EQUAL revision as terminal and
  leaves a tombstone". The same spec also pins that a late snapshot or ops at the tombstone is `tombstoned`.
- A later snapshot above the tombstone recreates: "recreates the surface from a later snapshot above the tombstone".
- Agent delete: "removes the surface on an agent delete and activates the next most recent".
- A 9th surface returns `needsRead`: "accepts a 9th surface and asks for a read". Also "keeps the surfaces with the
  highest revisions when a read reports more than the bound".
- `applyRead`:
  - "never lowers a materialized revision";
  - "keeps entries pushed after the read was sent and removes the rest";
  - "removes only entries older than the read on not-found";
  - "does not revive a tombstoned surface from an older view";
  - "replaces a held surface from a newer view and keeps its view state".
- Reconciliation cases 1-5:
  - "case 1: result before echo; the ack is never materialized and the echo retires the overlay";
  - "case 2: echo before result; the result only settles and retires";
  - "case 3: a non-conflicting agent write between base and commit is a gap, and the read replaces the view";
  - "case 4: a newer push, then an older result or read, never moves the revision back";
  - "case 4: a stale read keeps a settled overlay whose ack is above what it materializes";
  - "case 5: a lost echo is recovered by the read, which retires the settled overlay". The 1,500 ms timer half
    belongs to Batch 12.
  - Also "keeps a pending overlay across a read".

`apps-system-prompt.spec.ts`:

- "names the %s tool", for all three tools.
- "does not carry the pushed dashboard-selection context".
- Also "tells the agent to read state instead of asking the user to paste it" and "describes forms, selection and
  host-formatted submits".

## Deviations from the plan

1. **Ops on a rejected surface returns `needsRead`, not discard** (plan:434). The host applied those ops to its own
   copy, so the document after the ops can differ from the one this page rejected. The plan's "no read" reason for a
   rejected snapshot ("re-reading returns the same document") does not hold here. Discarding would also leave the
   surface stuck on the fallback. The read cannot loop, because `applySurfaceRead` never asks for another read.
2. **A read retires settled overlays up to the resulting materialized revision.** It does not call
   `retireAllSettled()`. The brief said "a read calls retireAllSettled". The two differ only for a read that is OLDER
   than an acknowledged commit, which is reconciliation case 4 ("the same holds for a stale `surface:read` answer").
   In that case `retireAllSettled` would drop the user's committed value and show the stale host value until the echo
   arrives. With `retireSettledUpTo`, that overlay stays until the echo or a newer read reaches its ack revision.
   Every other read, including case 5, behaves the same either way. `retireAllSettled` in Batch 10 is unchanged and
   still available. Pinned by "case 4: a stale read keeps a settled overlay...".
3. **The `readSeq` semantics are made explicit.** `surfaceReadSeq(state)` returns the slice `seq` when the read is
   SENT. An absent entry is removed when `lastAppliedSeq <= readSeq`, meaning nothing was applied to it after the
   send. This is the plan's intent; its literal `<` assumed an off-by-one definition of `readSeq`.
4. **Additions the plan implies but does not name:**
   - `guardSurfaceReadResult`. A read result crosses the same boundary as a push. One unusable view rejects the whole
     result, because skipping that view would delete a surface the host still holds.
   - `updateSurfaceOverlays`. This is the only write path to an entry's overlays. It retires at once any settled
     overlay that the materialized revision already covers (case 2).
   - `APPS_TOMBSTONE_LIMIT` (64, oldest first). It bounds the tombstone map for a long-lived root service.
   - `AppsSurfaceNotice` for the eviction notice.
5. **Tombstone value.** The tombstone is `max(delete revision, held materializedRevision, previous tombstone)`, not the
   bare delete revision. For the documented cases the result is the same. It also guards against a reordered delete
   below the held revision.
6. **View state on read.** A read that replaces a held surface keeps its `viewState`, which holds sort, page and
   drafts. A read is a recovery (lost echo, gap), not an agent replace. A surface first seen through a read starts
   empty. A snapshot always resets it.

## Out-of-scope observations

- `acceptSurfaceView` passes `lastSubmit` through after a plain object check only. No exported contract validator
  exists for `SurfaceSubmitRecord`. Batch 15 must bind its fields as text, as it does for every other host value.

## Verification

Command, run from the worktree root:
`npx nx run-many -t lint,typecheck,test -p @ptah-extension/mcp-apps-page --skip-nx-cache`

- With `--output-style=static`: Test Suites 5 passed of 5; Tests 97 passed of 97 (Batch 10: 22; this batch: 75).
  Lint reported no errors or warnings.
- Last 10 lines of the default output:

```
 NX   Successfully ran targets lint, typecheck, test for project @ptah-extension/mcp-apps-page


Output of 3 successful tasks were not shown. Run with --verbose or --output-style=static to see it.

  Run duration:      7.8s
  Cache:             Skipped (--skip-nx-cache)
  Critical path:     6.2s (1 task)
  Recoverable time:  1.5s (20% of the run)
```
