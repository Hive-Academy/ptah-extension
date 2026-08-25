# Batch 8 — R2-D backend: consent-gated repair with quarantine

**Task**: TASK_2026_306 · **Branch**: `ak/boot-blocker-quota-gate` · **Status**: implemented, verified, **NOT committed**
**Executor**: `backend-developer` (sub-agent) · **Date**: 2026-08-23
**Revision 2** — addresses the review's F1, F2, F3 and m1–m3. Changes from revision 1 are marked **[R2]**.

---

## 1. What shipped, in one paragraph

`harness:repairBlocked` takes a per-path consent set, re-derives the blocked set
server-side and refuses anything outside it, **moves** each consented occupant
into `.claude/skills/.ptah-quarantine/<name>-<timestamp>` and proves the move
from both ends, then runs one ordinary full reconcile pass to write the managed
copies. A path the pass did not write gets its occupant back; if the restore
itself fails, the error names the quarantine path. Nothing is ever overwritten
in place, nothing unconsented is touched, and one failing path never aborts the
rest. `harness-sync/CLAUDE.md`'s quarantine section now describes real code —
with the consent **dialog** still marked `PLANNED (Batch 9)`, because it is.

---

## 2. The design decision that makes the safety argument hold

**The write is the reconciler's, not a second writer of its own.**

This is the load-bearing choice, and it is what turns the required invariant _"a
failed move means no write happens at that path"_ from a branch somebody has to
remember into a structural property:

> An occupant still in place is still unowned. `ClaudeTarget.planEntry` returns
> `'foreign'`, and `claude-target.ts:189-194` does `scanned.push(relPath);
continue;` **before** `plan.writes` is built. The path never enters the write
> plan at all.

**The refusal that caused the defect is the same refusal that makes the repair
safe.** There is no code in the repair service that says "if the move failed,
skip the write" — there is nothing to skip, by construction. Mutation M2 confirms
the property is nevertheless pinned by eleven spec cases, so a later contributor
who adds a private writer will break a test rather than a user's directory.

The corollary is the ordering: **all moves complete before `propagate()` is
called at all.** That is observed rather than argued — a spec wraps the
propagation service and snapshots the disk at the instant it is entered. M8
(write before move) kills it.

### **[R2]** There is now no `rm` on the repair path at all

Revision 1's `restoreFromQuarantine` deleted whatever sat on the destination
before moving the original back, justified by _"the repair emptied it moments
earlier under the workspace lock, and the only writer since was the
reconciler."_ **The review was right that this justification is false.**
`moveOccupants` releases the lock before `propagate` runs — deliberately, since
holding it would deadlock the pass — so the restore window was not exclusive,
and the comment described an exclusivity the design explicitly surrenders.

Of the three options offered, **the preferred one was taken and the third was
also taken**:

- **Rename-into-place (adopted).** The obstruction is now **moved aside** into
  the quarantine as `<name>.superseded-<timestamp>`, exactly as the original
  occupant was, and reported to the caller as `supersededPath`. This is not
  merely the smaller change — it is the _consistent_ one: a batch whose entire
  premise is that these paths hold content of unknown provenance should not
  contain a delete, and now it does not.
- **Lock the restore (adopted as well).** `settle` re-takes
  `serializePerWorkspace` + `acquireWorkspaceLock` for the restore phase. The
  write pass has completed and released by then, so this nests nothing. It
  narrows the window rather than being the thing that makes the operation safe —
  which is the right relationship, since the previous design had it the other
  way round.
- **Docblock-only (rejected).** It was the floor, and both better options were
  available at a combined cost of ~35 lines.

`grep -n "rm(" quarantine.ts blocked-repair.service.ts` now returns **exactly one
hit**: `quarantine.ts:234`, the second half of the cross-volume `EXDEV` fallback,
which deletes only what it has already copied. Pinned by the new mutation **M10**.

One consequence, recorded rather than smoothed over: a restore that had to
displace something leaves _two_ entries in the quarantine, and a failed move
under a lying filesystem can leave a stray copy there. Neither is cleaned up.
Deleting them would put an `rm` back on the repair path for cosmetics, and a
duplicate inside the undo store is the harmless direction to be wrong in.

### Locking

`moveOccupants` and `settle` each take the lock for their own phase and release
before the pass between them. `HarnessReconcilerService.reconcile` takes the same
in-process queue and the same file lock, so spanning them would deadlock.
Nothing is lost by the gap: a concurrent reconcile that slips in finds the paths
vacant and writes exactly what the repair was about to ask for.

### The read-only pre-check is deliberately asymmetric with the write pass

The blocked set comes from `reconciler.verify()` (no lock, no user-layer
refresh); the write goes through `propagation.propagate()` (which refreshes
first). A refresh could only ever **remove** a path from the blocked set, and
refusing a path that turns out not to be blocked is the safe direction to be
wrong in. Recorded in the source so a reader does not "fix" the asymmetry.

### **[R2]** m1 — the repair's actual blast radius

Step 4 is `propagate(workspaceRoot, 'harness:repairBlocked', { mode: 'full' })`,
and a full pass is **not** narrowed to the consented paths. It reconciles every
target and every desired artifact. Concretely, a repair of one blocked skill can
also:

- write any other managed path that has drifted since the last pass;
- **overwrite a hand-edited managed copy** and report it in
  `overwrittenLocalEdit` — for a file the user never mentioned in the dialog;
- reap a manifest-owned artifact whose source has disappeared;
- update `.gitignore`'s managed block and the per-target manifests.

**No unowned content is touched by any of that** — every one of those actions is
bounded by the manifest or by the desired state, which is the E9 rule the whole
lib rests on. And the identical pass runs at every activation, every workspace
change and every `harness:reconcile`, so the repair adds no exposure that a user
does not already have several times a day. But revision 1 argued the full pass
_purely_ as a safety mechanism ("the write is the reconciler's") and never stated
its width. It is stated now: **the repair is per-path in what it MOVES and
workspace-wide in what it WRITES.** Narrowing the pass with `targets:` was
considered and rejected — `targets` restricts by target, not by path, so it
cannot express "only this skill", and a bespoke narrow writer is precisely the
second writer §2 exists to avoid.

---

## 3. The four settled decisions, as implemented

| #      | Decision                                                                                  | Where it lives                                                                                                                                                                                   | State                                                         |
| ------ | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| **U1** | Build the repair, consent-gated                                                           | `lib/repair/blocked-repair.service.ts` + `harness:repairBlocked`                                                                                                                                 | shipped                                                       |
| **U2** | `.claude/skills/.ptah-quarantine/<name>-<timestamp>`, same-volume, documented ignore rule | `lib/quarantine/quarantine.ts`; ignore rule at `ClaudeTarget.scanTargetDirs`, `WorkspaceHarnessTarget.scanForeignDirs`, `IGNORED_ENTRY_NAMES`                                                    | shipped                                                       |
| **U3** | Per-path consent, defaulting to nothing                                                   | `HarnessRepairBlockedParams.paths` — no `all`, no target-wide filter, no bulk entry point; empty list is a total no-op. **[R2]** now `.strict()`, so a bulk key is rejected rather than stripped | **backend shipped; the DIALOG is Batch 9 and does not exist** |
| **U4** | Never cleaned up automatically                                                            | No TTL, no sweep, no purge-on-boot, no UI affordance. Even a provably-empty quarantine directory after a restore is left alone, so no cleanup path exists to generalise                          | shipped                                                       |

**Same-volume is by construction, not by convention**: the quarantine directory
is a sibling of the occupant inside its own parent, so `rename` is an atomic
metadata operation. The `EXDEV` fallback exists anyway (a directory can be a
mount point) and copies **before** it deletes — the same ordering as the in-repo
precedent at `skills-sh-legacy-adoption.ts:120-127`.

**Timestamp collision-safety is two defences**: UTC compact to the millisecond
(`alpha-20260823T141530123`), plus a `-2`, `-3` … suffix loop for a residual
collision — the suffix rather than a re-rolled clock, because the timestamp is
what a human reads to find their directory again.

---

## 4. Files

### New

| File                                                                      | Lines | What                                                                                                                                     |
| ------------------------------------------------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `libs/backend/harness-sync/src/lib/quarantine/quarantine.ts`              | 253   | `QUARANTINE_DIR_NAME`, `isQuarantineEntry`, `quarantineDirFor`, `formatQuarantineTimestamp`, `moveToQuarantine`, `restoreFromQuarantine` |
| `libs/backend/harness-sync/src/lib/repair/blocked-repair.service.ts`      | 404   | `HarnessBlockedRepairService`                                                                                                            |
| `libs/backend/harness-sync/src/lib/quarantine/quarantine.spec.ts`         | —     | 14 cases                                                                                                                                 |
| `libs/backend/harness-sync/src/lib/repair/blocked-repair.service.spec.ts` | —     | 18 cases                                                                                                                                 |

### Modified

| File                                                            | Change                                                                                                   |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `libs/backend/harness-sync/src/lib/targets/claude-target.ts`    | `isQuarantineEntry` skip in `scanTargetDirs` (+ import)                                                  |
| `libs/backend/harness-sync/src/lib/targets/workspace-target.ts` | Same skip in `scanForeignDirs` (+ import); **[R2]** two raw NUL bytes → ` `                               |
| `libs/backend/harness-sync/src/lib/hash/content-hash.ts`        | `QUARANTINE_DIR_NAME` in `IGNORED_ENTRY_NAMES`; **[R2]** one raw NUL byte → ` `                           |
| `libs/backend/harness-sync/src/lib/di/tokens.ts`                | `BLOCKED_REPAIR` token                                                                                   |
| `libs/backend/harness-sync/src/lib/di/register.ts`              | Registers the repair service for every host                                                              |
| `libs/backend/harness-sync/src/index.ts`                        | Exports the repair + quarantine surface                                                                  |
| `libs/backend/harness-sync/CLAUDE.md`                           | Quarantine section; **[R2]** Consent row `PLANNED (Batch 9)`, heading qualified, no-`rm` paragraph added |
| `libs/shared/src/lib/types/harness-sync.types.ts`               | `HarnessRepairBlockedPath/Params/Result`, `HarnessRepairOutcome`, `HarnessRepairPathResult`              |
| `libs/shared/src/lib/types/rpc.types.ts`                        | `harness:repairBlocked` in the registry + `RPC_METHOD_NAMES`                                             |
| `libs/backend/rpc-handlers/.../harness-rpc.schema.ts`           | `HarnessRepairBlockedParamsSchema`; **[R2]** `.strict()` at both levels                                  |
| `libs/backend/rpc-handlers/.../harness-rpc.handlers.ts`         | `METHODS` entry + `registerRepairBlocked`                                                                |
| `libs/backend/rpc-handlers/.../harness-health-rpc.service.ts`   | `repairBlocked` delegate + injected repair service                                                       |
| Two existing spec files                                         | 13 new cases; every edit an addition except one widened import (§6)                                      |

**No frontend files were touched.** Batches 7 and 11's uncommitted work in
`libs/frontend/**` (plus the `eslint.config.mjs` and `tsconfig.base.json` edits
that came with a new secondary entry point) is untouched by this batch.

### **[R2]** m3 — authorised out-of-batch fix: the NUL bytes

`content-hash.ts` and `workspace-target.ts` each contained **literal NUL bytes**
in source, used as string separators (`DIGEST_SEPARATOR`,
`transformer.relPathFor(…)`). `grep`/`rg` classify a file containing a NUL as
binary and silently skip it, so both files were invisible to every content
search that did not pass `-a`.

That is pre-existing — recorded in Batch 5, hit again in Batch 11's review, and
hit a third time here: verifying invariant 6 (the quarantine exclusion rule)
required `grep -a`, because **`workspace-target.ts` is one of the two files that
carries the rule.** Three investigations, and it now actively hides this batch's
own work.

Fixed by replacing the three raw bytes with the escape `' '` — byte-for-byte
identical at runtime, and the files are now plain text. Verified:

```
$ grep -rn "isQuarantineEntry" libs/backend/harness-sync/src/lib/targets/ libs/backend/harness-sync/src/lib/hash/
claude-target.ts:53    import { isQuarantineEntry } from '../quarantine/quarantine';
claude-target.ts:548           if (isQuarantineEntry(entry)) continue;
workspace-target.ts:54  import { isQuarantineEntry } from '../quarantine/quarantine';
workspace-target.ts:612        if (isQuarantineEntry(name)) continue;
content-hash.ts:38      * see it call `isQuarantineEntry` directly; …
```

— no `-a`, all four sites visible. **Declared here as a deliberate out-of-batch
fix so it is not a surprise in the diff.** It touches no behaviour and is covered
by the 242 pre-existing `harness-sync` cases, which still pass unchanged.

---

## 5. Requirements → evidence

| Requirement                                                     | Where                                                                                                                     | Spec that pins it                                                                                                                                                                                                                    |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Never overwrite in place                                        | The write is the reconciler's; the occupant is moved first                                                                | `repairs the consented path: original quarantined intact, managed copy in its place`                                                                                                                                                 |
| Verify the move, then write                                     | `assertMoved`, **both ends, both now pinned [R2]**                                                                        | `the occupant is in QUARANTINE, and its path VACANT, before the write pass is even called`; `REJECTS when rename resolves but the occupant is still in place`; `REJECTS when rename resolves but nothing arrives at the destination` |
| Failed move ⇒ no write, occupant untouched                      | Structural (§2)                                                                                                           | `a FAILED move means no write at that path — and the other paths still repair`; **[R2]** `a rename that RESOLVES WITHOUT MOVING is caught, and nothing is written at that path`                                                      |
| Never touch an unconsented path                                 | Only `consented` is iterated                                                                                              | `never touches a blocked path the user did NOT consent to`                                                                                                                                                                           |
| Per-path consent, defaulting to nothing                         | `paths` only; empty = total no-op; **[R2]** `.strict()`                                                                   | `an EMPTY selection runs no pass at all…`; `has no bulk shape at all: an "all" flag is REJECTED, not quietly stripped`; `rejects an unknown key on an individual path entry too`                                                     |
| Reuse `blockedTargetPaths` from `@ptah-extension/shared:338`    | `blockedByTarget()` imports it from `@ptah-extension/shared`; `harness-sync/src/index.ts:199` still does not re-export it | `starts from the captured shape: three blocked paths…`                                                                                                                                                                               |
| `EPERM`/`EBUSY` handled; one path never aborts the rest         | Every per-path step in its own `try`; all fs ops through `withWindowsRetry` (`EBUSY`/`EPERM`/`EACCES`/`ENOTEMPTY`)        | `a FAILED move means no write at that path — and the other paths still repair`                                                                                                                                                       |
| Quarantine never scanned or reconciled                          | Two scan sites + `IGNORED_ENTRY_NAMES`                                                                                    | `a populated quarantine changes NOTHING about health…`; `a full reconcile never reaps, rewrites or reports the quarantine`                                                                                                           |
| Restore on failed write, or name the quarantine path            | `settle` / `restoreOne`, **[R2]** under the lock and with no `rm`                                                         | 3 restore cases incl. `NAMES the quarantine path when the write failed AND the restore failed`; **[R2]** `MOVES a half-finished managed copy aside rather than deleting it`                                                          |
| Idempotent                                                      | A repaired path is manifest-owned, hence not blocked                                                                      | `is idempotent: a second call on a repaired path is refused, not a second quarantine entry`                                                                                                                                          |
| Declined consent ⇒ byte-identical                               | Two early returns, and no pass runs                                                                                       | `an EMPTY selection…`; `every consented path failing to move runs no pass and changes nothing`                                                                                                                                       |
| Partial selection                                               | Per-path                                                                                                                  | `repairs a partial selection and leaves every unselected blocked path exactly as it was`                                                                                                                                             |
| `missing` reduced by the repaired count, `writeFailed=0`        | —                                                                                                                         | `a subsequent reconcile reports 'missing' reduced by exactly the repaired count, writeFailed still 0`                                                                                                                                |
| Zod at the RPC boundary; paths outside the blocked set rejected | Schema (shape) + service (authorization)                                                                                  | 9 schema cases + `refuses a path that is not in the blocked set`                                                                                                                                                                     |
| Unreachable from activation reconcile                           | Dependency runs repair → reconciler; the token has one holder                                                             | Structural — see F3 in §8                                                                                                                                                                                                            |

### The MCP refusal

`blockedTargetPaths` can return an MCP fragment key (`.vscode/mcp.json#wanted`).
Those are refused with `not-a-path`: a server key inside a config file the user
also writes is not a file, and there is nothing to move aside. Repairing one
would mean editing the user's config — a different operation with a different
consent question. Pinned by `refuses a blocked MCP server key`.

---

## 6. Verification — actual output

Every number below is from a `--skip-nx-cache` run on this tree, after all
revision-2 changes and after every mutation was reverted (verified: zero `MUT`
markers remain in any source file).

### Tests

```
[harness-sync]  Test Suites: 36 passed, 36 total   Tests: 274 passed, 274 total
[rpc-handlers]  Test Suites: 87 passed, 87 total   Tests: 31 skipped, 2423 passed, 2454 total
[shared]        Test Suites: 43 passed, 43 total   Tests: 1101 passed, 1101 total
```

**Baseline proof for `harness-sync`**, with the two new spec files excluded:

```
Test Suites: 34 passed, 34 total   Tests: 242 passed, 242 total
```

242 → 274 is **+32**, matching the two new files exactly. All 34 pre-existing
suites still pass **with** the quarantine ignore rule, both scan changes and the
NUL-byte fix in place. `rpc-handlers` 2410 → 2423 is **+13**. `shared` unchanged
(types only).

### Lint

```
nx run-many -t lint -p harness-sync,rpc-handlers,shared
✖ 19 problems (0 errors, 19 warnings)   →  Successfully ran target lint for 3 projects
```

All 19 are pre-existing kinds; one is on a file this batch touches and is
recorded as F1 in §8. Zero warnings in either new file.

### Typecheck / Build

```
nx run-many -t typecheck -p harness-sync,rpc-handlers,shared                     → Successfully, 3 projects
nx run-many -t build -p harness-sync,rpc-handlers,shared,
                        ptah-electron,ptah-extension-vscode                       → Successfully, 5 projects and 31 tasks
```

### Spec integrity

`git diff -U0 -- '*.spec.ts'` contains **exactly one removed line**:

```
-import { NewProjectIntakeSchema } from './harness-rpc.schema';
```

— an import widened to a two-name block. Every other spec edit is an addition.
**Zero assertions weakened, zero cases deleted.** The
`harness-health-rpc.service.spec.ts` changes are a compile-forced constructor
widening (one new injected dependency) plus the new `describe` block.

Two revision-2 spec edits **changed** existing assertions, and both are
strengthenings the review asked for, recorded explicitly:

- `clears a half-finished managed copy off the path first` →
  `MOVES a half-finished managed copy aside rather than deleting it`. Renamed
  and extended because the behaviour changed under F2; it now also asserts the
  obstruction survives at a named `supersededPath`.
- `…an "all" flag is stripped, never honoured` → `…is REJECTED, not quietly
stripped`, under m2's `.strict()`.

### Spec count

`grep -c "^\s*it("` on the new files; `git diff -U0 | grep -c "^+\s*it("` on the extended ones.

| File                                                                        | `it(` blocks |
| --------------------------------------------------------------------------- | ------------ |
| `quarantine.spec.ts`                                                        | 14           |
| `blocked-repair.service.spec.ts`                                            | 18           |
| `harness-health-rpc.service.spec.ts` (new `harness:repairBlocked` block)    | 4            |
| `harness-rpc.schema.spec.ts` (new `HarnessRepairBlockedParamsSchema` block) | 9            |
| **Total**                                                                   | **45**       |

No `it.each`, so 45 `it(` blocks = 45 Jest cases. (Revision 1 had 41; +2 for F1's
two lying-filesystem cases, +1 for m2's per-entry strict case, +1 for F1's
repair-level case.)

---

## 7. Mutation testing — the fail/pass split, per mutation

**Eleven** mutations, each applied to source and run against the **32 cases in
the two new `harness-sync` spec files**. Baseline: **32 passed, 0 failed**.

| #       | Mutation                                                                             | Result                                                                    | Killed by                                                                                                             |
| ------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **M1**  | Remove the quarantine ignore rule from both scan sites **and** `IGNORED_ENTRY_NAMES` | **2 failed / 30 passed**                                                  | the two quarantine-invisibility cases                                                                                 |
| **M2**  | Overwrite in place: `rm -rf` the occupant instead of moving it                       | **11 failed / 21 passed**                                                 | the whole never-destroy family — discriminator D1, the most heavily pinned property in the batch                      |
| **M3**  | Drop the blocked-set gate: accept every requested path                               | **2 failed / 30 passed**                                                  | `refuses a path that is not in the blocked set`, `is idempotent`                                                      |
| **M4**  | Remove the empty-selection early return                                              | **1 failed / 31 passed**                                                  | `an EMPTY selection runs no pass at all…`                                                                             |
| **M5**  | Remove the restore branch: leave the path empty when the write did not land          | **3 failed / 29 passed**                                                  | the three restore cases                                                                                               |
| **M6**  | Strip the quarantine path from the `restore-failed` report                           | **1 failed / 31 passed**                                                  | `NAMES the quarantine path when the write failed AND the restore failed`                                              |
| **M7**  | Remove `assertMoved`'s **source-side** check                                         | **2 failed / 30 passed** — **[R2] now killed; it survived in revision 1** | `REJECTS when rename resolves but the occupant is still in place`; `a rename that RESOLVES WITHOUT MOVING is caught…` |
| **M7b** | Remove `assertMoved`'s **destination-side** check                                    | **1 failed / 31 passed** — **[R2] new**                                   | `REJECTS when rename resolves but nothing arrives at the destination`                                                 |
| **M8**  | Invert the ordering: run the write pass **before** the moves                         | **2 failed / 30 passed**                                                  | the ordering case + the rename-lie case                                                                               |
| **M9**  | Let one failing move abort the whole batch                                           | **3 failed / 29 passed**                                                  | the two move-failure cases + the rename-lie case                                                                      |
| **M10** | **[R2] new** — restore DELETES the obstruction instead of displacing it              | **1 failed / 31 passed**                                                  | `MOVES a half-finished managed copy aside rather than deleting it`                                                    |

**All eleven are now killed. Nothing survives.**

### **[R2]** F1 — how M7 was closed, and why it needed two lies

The ruling was _"unfalsifiable by the current fixture, NOT inherently"_, and that
is exactly right. The fix is an injected `rename` in the spec's module mock,
default-off and delegating to the real one, so no other case in either file
changes behaviour.

The first attempt used a **no-op** `rename` — resolve, move nothing. **It did not
kill M7**, and the reason is worth recording: with the source still present _and
the destination absent_, `assertMoved`'s destination check fires first and the
source-side check is never reached. The stub therefore has to **copy** rather
than do nothing, so the destination genuinely appears and the source genuinely
survives — which is also the more faithful model of the failure being guarded
against (a silently-failing overlay where the write half lands and the unlink
half does not).

That in turn left M7b — the destination-side half — surviving for the mirror-image
reason. A second lie mode (`renameVanishesFor`: remove the source, create
nothing) reaches it. Both halves of `assertMoved` are now pinned by one case
each, and neither production line changed.

### Recorded from revision 1: what M4's survival actually revealed

M4 survived its first run, and the review asked for the right conclusion rather
than the patch. It is this: **the empty-selection early return is a PRECISION
guard, not a safety guard.** Byte-identity on decline was already structurally
true without it — the second guard (`accepted.length === 0`) returns the same
shape, and `verify()` over a converged tree writes nothing. What the early return
buys is that a decline costs _no directory walk at all_, and that is a real
property worth keeping and worth pinning; it is simply not the property the spec
title implied. The spec now asserts on the **calls** (`verify` and `propagate`
are never reached) as well as the bytes, and M4 dies.

---

## 8. Findings and judgement calls

**F1 (minor) — `harness-rpc.handlers.ts` crosses the soft line ceiling by more
than it did.** ESLint counted **734** lines before this batch and **749** after
(verified by stashing that one file and re-linting). Warn-level, and the file is
a registration facade: a `METHODS` tuple plus one-line `wire` delegates. The
batch's ~15 lines are one `METHODS` entry, one `register*` call and one delegate
with its docblock. Per the repo's own guidance ("a contract barrel can be long
and correct"), the work went into `HarnessHealthRpcService` (318 lines) rather
than here. **Not split** — splitting a registration facade to buy back a
warn-level line count would be the fragment sprawl the facade rule exists to
prevent.

**F2 (informational, citation corrected) — the runtime half of the dual
registration came free.** `harness:` is already in `ALLOWED_METHOD_PREFIXES`, so
only the compile-time half in `rpc.types.ts` was new. **The anchor in the task
text has drifted: it is `libs/backend/vscode-core/src/messaging/rpc-handler.ts:70`,
not `:46`.** Verified by reading the file; `:70` is the `'harness:'` entry and
`:40` is where the array is declared. The source comment in
`harness-rpc.handlers.ts` cites `:70`. **Both halves were checked, one was
already satisfied** — this is not a skipped step. `vscode-core` was not modified.

**F3 (design, deliberate) — "unreachable from activation" is enforced by the
dependency direction, not by a flag.** `HarnessBlockedRepairService` depends on
the reconciler and the propagation service; none of them knows it exists. There
is no `if (isActivation) return`, because there is no path that could reach the
check. `HARNESS_SYNC_TOKENS.BLOCKED_REPAIR` has exactly one holder in the repo:
`HarnessHealthRpcService`. Confirm with `grep -r BLOCKED_REPAIR`.

**F4 (deliberate) — nothing in the quarantine is ever cleaned up.** U4 read
strictly: a restore leaves the (possibly empty) quarantine directory, a displaced
obstruction stays as `<name>.superseded-<ts>`, and a failed move under a lying
filesystem leaves its stray copy. Removing any of them would establish a cleanup
path someone later generalises into a sweep, and would reintroduce the `rm` F2
just removed. Pinned by `leaves the (now empty) quarantine directory behind`.

**F5 (deliberate) — the repair returns a re-observed health when any restore
happened.** Restoring puts occupants back, making the write pass's own report
stale for those paths. `reobserve()` runs one more read-only `verify()`. When
every moved path repaired, the pass's own health is returned unchanged and no
extra walk is paid.

**F6 (informational) — `IGNORED_ENTRY_NAMES` gained a member.** Strictly, the two
target scan sites suffice: a quarantine only ever lands inside a target
directory. The set entry makes "never scanned as a **source** either" structural
rather than incidental (`HarnessManifestBuilder.listSkillSlugs` and
`listMarkdownFiles` both filter through it). No spec asserted the set's exact
contents (checked), and all 34 pre-existing suites still pass.

**F7 [R2] (docs) — the `SHIPPED` marker is now split.** The heading reads
`BACKEND SHIPPED (Batch 8), consent UI PLANNED (Batch 9)`, and the Consent row is
marked `PLANNED (Batch 9) — there is no dialog`, distinguishing the shipped
backend half (a per-path RPC with no bulk shape) from the unstarted surface. This
is the same defect as Batch 6's F-C, reintroduced by the flip and now fixed the
same way.

---

## 9. Not done, and why

- **No frontend.** Batch 9 owns the dialog. The RPC returns per-path outcomes
  including the quarantine destination, which is what that batch needs.
- **No commit.** Team-leader commits after MODE 2 review.
- **`tasks.md` not edited.** It shows as modified in `git status`; that change is
  not this batch's.
- **No manual cold-start verification.** "A real cold start after a partial
  repair shows `missing` reduced by exactly the repaired count and `writeFailed`
  still 0" is proven at spec level against a real temp workspace, a real
  reconciler and real targets, but has **not** been run against a live Electron
  boot — and the RPC has no caller until Batch 9 lands.

---

## 10. What the reviewer should check first

1. **`grep -n "rm(" quarantine.ts blocked-repair.service.ts` returns exactly one
   hit**, and it is the `EXDEV` fallback deleting what it just copied. That is
   F2's whole claim, and M10 is its mutation.
2. **The ordering spec is real, not decorative.** It snapshots the disk from
   inside the propagation call. M8 is its mutation.
3. **The two `rename` lies differ on purpose** — copy-not-move reaches the
   source-side check, vanish reaches the destination-side one. Swapping either
   for a no-op silently un-pins a half; §7 explains why.
4. **`refuse()` is the only authorization gate**, and it re-derives from
   `verify()` rather than trusting the caller. M3 is its mutation.
5. **No second writer.** `grep` the repair service for `copyDirectory`,
   `writeFile`, `cp` — none. Its only fs calls are the move and the restore, both
   in `quarantine.ts`.
6. **§2's blast-radius paragraph** is the honest statement m1 asked for: per-path
   in what it moves, workspace-wide in what it writes.
