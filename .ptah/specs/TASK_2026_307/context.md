# Context

## Where this came from

TASK_2026_306 reviewed a 1200-line captured Electron dev-boot log and produced
eight defects. Seven were fixed there. This one was recorded as a follow-up
because it is in a different lib and on a different failure path from the boot
blocker, and fixing it inside that task would have widened it a second time.

## The defect

`workspace-indexer.service.ts:41`:

```ts
const MISSING_ENTRY_CODES: ReadonlySet<string> = new Set([
  // not-found family only
]);
```

and the guard that consumes it at `:63`:

```ts
if (typeof code === 'string' && MISSING_ENTRY_CODES.has(code)) {
  // absorbed — skip this entry, keep indexing
}
```

Anything not in the set propagates and takes the whole pass down. The doc
comment at `:156` states the intent plainly — _"Only the per-entry codes in
`MISSING_ENTRY_CODES` are absorbed"_ — so the contract is right and the set is
short.

## Why it matters on Windows specifically

`ENOENT` is the Unix-shaped assumption. On Windows the common cause of an
unreadable file is not absence but a lock:

| Cause                                     | Code observed |
| ----------------------------------------- | ------------- |
| File open in another process (editor, AV) | `EPERM`       |
| File being written right now              | `EBUSY`       |
| Directory permissions                     | `EACCES`      |

Ptah's primary desktop target is Windows, and the workspace being indexed is by
definition the one the user has open in an editor. The failure is transient,
which makes it worse: the index empties, the next pass succeeds, and nothing
correlates the two.

## The precedent to copy

`libs/backend/harness-sync/src/lib/quarantine/quarantine.ts` already solved this
correctly. `RETRYABLE_ERROR_CODES` covers `EBUSY`, `EPERM`, `EACCES` and
`ENOTEMPTY`, `withWindowsRetry` retries them, and a failure is scoped to one
path rather than the run. That file is the reference implementation; the indexer
is the one that was never updated.

## Scope

- Add `EPERM` and `EBUSY` to `MISSING_ENTRY_CODES`.
- Decide on `EACCES` — it is in the quarantine set and the argument for
  including it is the same.
- Decide retry vs skip. A read-only indexing pass can arguably just skip, but
  the quarantine precedent retries and the two should not disagree without a
  stated reason.
- A spec that proves one entry failing with `EPERM` does not reduce the indexed
  count of the others. Mutation-test it: the spec must go red if the code is
  removed from the set.

## Out of scope

The quarantine/repair path. It is already correct and must not be touched.
