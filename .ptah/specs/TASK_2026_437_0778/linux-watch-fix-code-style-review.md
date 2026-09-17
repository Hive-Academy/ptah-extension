# Code Style Review — Linux Watcher Fix (`TASK_2026_437_0778`)

Created-directory reconciliation + full native rebuilds in the out-of-process watch host;
removal of the test-only `worker_threads` transport from the Electron host entry and its spec.

Reviewed uncommitted on disk in `D:\projects\ptah-437` (worktree, not `ptah-extension`). Read-only:
no source edited, no nx/test run; `npx eslint` run on every changed/new source file below (clean,
no output). Batch 16 files (`libs/backend/vscode-core/**`, `libs/backend/agent-sdk/**`, the three
apps' `container.smoke.spec.ts`) and the unrelated `skill-synthesis` diff in the same working tree
are out of scope and not reviewed.

## Summary

| Metric          | Value                                                                   |
| --------------- | ----------------------------------------------------------------------- |
| Overall score   | 7/10                                                                    |
| Assessment      | NEEDS_REVISION                                                          |
| Blocking issues | 0                                                                       |
| Serious issues  | 2                                                                       |
| Minor issues    | 2                                                                       |
| Files reviewed  | 12 (8 modified, 2 created, 3 CLAUDE.md, 1 spec update read for context) |

## Five style questions

### 1. What breaks in six months?

`WorkspaceWatchHostCore` (`libs/backend/platform-core/src/workspace-watch/workspace-watch-host-core.ts`)
grew from 734 to 903 lines in this diff alone (`git diff --stat`: +207/-38), the third consecutive
batch to grow this exact file past its own previously-flagged ceiling. Batch 8's review named
`computeNativeIgnore` (host-core.ts:732-789, unchanged by this diff) as the one piece of this class
that passes the facade-rule's "no dependency on the class's timers, retry state or engine handle"
test, and explicitly said: "flagged so the next addition to this file … is a trigger to extract
`computeNativeIgnore`'s block rather than growing the class further in place." This batch is that
next addition — full-rebuild scheduling (`requestRebuild`, host-core.ts:636-657), the reconciler
wiring (`onDiscovered`, `resumeReconciliationIfCalm`, host-core.ts:607-630) and the new
`rebuildRequested`/`rebuildReason`/`overflowOnSettle` fields on `RootWatch` — and the file was grown
in place again, with the flagged extraction still not done. See Serious-1.

### 2. What would a new team member misread?

A reader who compares `created-directory-reconciler.ts`'s CLAUDE.md bullet
(`platform-core/CLAUDE.md:90-101`) against `workspace-watch-batch-relay.ts`'s bullet
(`platform-core/CLAUDE.md:119`, "`WorkspaceWatchBatchRelay` (**internal**)") would reasonably expect
the same "(internal)" marker wherever a class is deliberately kept out of the public barrel — every
other bullet in that section describes a symbol `src/index.ts` actually exports. `CreatedDirectoryReconciler`
gets no such marker, yet the class itself, `CREATED_DIRECTORY_RECONCILER_DEFAULTS`,
`CreatedDirectoryReconcilerOptions`, `CreatedDirectoryEvent` and `CreatedDirectoryIncompleteReason`
are absent from `platform-core/src/index.ts` (only the two structural types
`WorkspaceWatchDirectoryEntry`/`WorkspaceWatchListDirectory` are re-exported, `index.ts:185-188`). A
reader who wants to unit-test or reuse `CreatedDirectoryReconciler` from outside this lib would try
the public barrel first, find nothing, and have no doc telling them that is intentional. See Serious-2.

### 3. What does this cost to maintain?

The Linux-only `readdir` implementation now lives directly in `platform-core`
(`workspace-watch-host-boot.ts:64-73`, `workspaceWatchListDirectoryFor`), a real Node `fs/promises`
call, not an interface. This is consistent with existing precedent, not a new cost: the lib's own
CLAUDE.md already documents three "logic-light" concrete services using Node `fs`/`https` directly
(`PtahFileSettingsManager`, `ContentDownloadService`, `AgentPackDownloadService`), and the boundary
this lib actually enforces is against _Electron/VS Code/Node-IPC_ imports — not against Node
built-ins generally, which every host-based adapter runs under (Electron main via `utilityProcess`,
CLI via `child_process.fork`; neither is a browser or `vscode`-API context). The `platform` parameter
(not `process.platform` read internally) keeps the function pure and testable, matching the pattern
`created-directory-reconciler.ts` itself uses for its own injected `listDirectory`. The three call
sites (Electron entry, Electron in-process hatch, CLI entry) each spend one identical line —
`workspaceWatchListDirectoryFor(process.platform)` — calling into the shared function; that is the
correct, bounded amount of duplication for a hexagonal boundary each adapter must cross itself.

### 4. Where is this inconsistent with the rest of the repository?

Two places, both scored below: the file-size trigger the previous two reviews explicitly set and
this batch tripped without acting on it (Serious-1), and the internal/public marking asymmetry
between `CreatedDirectoryReconciler` and its sibling `WorkspaceWatchBatchRelay` (Serious-2).
Everything else checked — `platform-core` purity, `toWorkspaceWatchPathKey`'s relocation, naming,
Zod/`export type` discipline, the three CLAUDE.md updates, the `worker_threads` removal — matches
established convention; see Pattern compliance.

### 5. What would you have done differently?

I would have used this batch's own admission — the docstring's new "Re-subscribe versus rebuild"
section (host-core.ts:33-46) is long precisely because a genuinely separate concern (deciding
_when_ a root needs releasing-then-resubscribing versus overlap-then-swap, and paying out the debt
in `overflowOnSettle`) now lives inline — as the moment to pull that decision and its four `RootWatch`
fields into a small collaborator the class calls, the same shape `CreatedDirectoryReconciler` itself
already demonstrates for the reconciliation concern. I would also have added the "(internal)" marker
to the `created-directory-reconciler.ts` CLAUDE.md bullet the moment the executor decided not to
export the class, rather than leaving the doc silent on the decision.

## Serious issues

### `WorkspaceWatchHostCore` crossed the trigger the last two reviews set for extracting `computeNativeIgnore`

- File: `libs/backend/platform-core/src/workspace-watch/workspace-watch-host-core.ts` (903 lines,
  was 734 before this diff)
- Problem: Batch 8's review (`b8-code-style-review.md:56-61`) scored this exact concern Serious and
  gave an explicit, named condition for revisiting it: "flagged so the next addition to this file (a
  new native-ignore channel, a new retry policy) is a trigger to extract `computeNativeIgnore`'s
  block." Batch 9's review (`b9-code-style-review.md:22-37`) restated the same open item under Q1.
  This diff adds exactly the kind of thing that condition named — a new retry/recovery policy (full
  rebuild vs. overlapping re-subscribe, `rebuildRequested`/`rebuildReason`/`overflowOnSettle`,
  `requestRebuild`, host-core.ts:636-657) plus a second new subsystem wired through it
  (`CreatedDirectoryReconciler`, `onDiscovered`/`resumeReconciliationIfCalm`, host-core.ts:607-630) —
  and grew the file by 169 lines without extracting the piece both prior reviews already named as
  ready to go (`computeNativeIgnore` + `isSafeGlobName`/`caseInsensitiveGlobName`/`compilesAsGlob`,
  host-core.ts:732-789 and 873-903, ~90 lines, confirmed unchanged by this diff — still passes the
  facade rule's "no dependency on the class's timers, retry state or engine handle" test that the new
  rebuild/reconciler code fails (both read and write `root.active`, `root.subscribers`,
  `ensureNative`, matching the state-coupled verdict the delta reviews already reached for the
  Electron adapter's equivalent recovery code, so extracting _that_ code would still be wrong — this
  finding is only about the one piece that was already cleared for extraction and wasn't taken).
- Tradeoff: 903 lines is still short of the repo's "past 1000 means a deliberate look" line, and nothing
  about the new logic is incorrect or misplaced — it is state-coupled to the class the same way the
  Electron adapter's degraded-recovery code was found to be, so this is not a case for inventing a new
  split of the new code. The issue is narrower: a small, already-identified, already-clean extraction
  was deferred a third time while the file kept growing around it.
- Recommendation: extract `computeNativeIgnore` and its three pure helpers into a small collaborator
  (e.g. `NativeIgnoreSetPlanner`, taking the subscribers' `WorkspaceWatchOptions` plus the root key
  and returning the sorted ignore list) injected into `WorkspaceWatchHostCore` the way
  `CreatedDirectoryReconciler` already is. This removes ~90 lines from the class body without
  touching any of the state-coupled code this batch added, and stops deferring a fix two reviews have
  already scoped and approved.

### `CreatedDirectoryReconciler` is undocumented as internal while not being public

- File: `libs/backend/platform-core/CLAUDE.md:90-101` vs. `libs/backend/platform-core/src/index.ts`
  (no export of `CreatedDirectoryReconciler`, `CREATED_DIRECTORY_RECONCILER_DEFAULTS`,
  `CreatedDirectoryReconcilerOptions`, `CreatedDirectoryEvent`, `CreatedDirectoryIncompleteReason`;
  only `WorkspaceWatchDirectoryEntry`/`WorkspaceWatchListDirectory`, `index.ts:185-188`)
- Problem: this lib's own established convention marks a class deliberately excluded from the public
  barrel with "(internal)" in its CLAUDE.md bullet — `workspace-watch-batch-relay.ts` does exactly
  this (`platform-core/CLAUDE.md:119`), and the Batch 9 review confirmed that marker matches the code
  ("genuinely internal (not in the public barrel; `CLAUDE.md` calls it out as such)"). Every other
  bullet in the same Internal Structure list describes an exported symbol. `created-directory-reconciler.ts`'s
  bullet (CLAUDE.md:90-101) carries no such marker, so it reads as documenting a public symbol the
  same way `WorkspaceWatchHostCore`'s bullet does — but the class is not exported.
- Tradeoff: keeping the class non-public is a defensible choice (only `workspace-watch-host-core.ts`
  constructs it, the same shape `WorkspaceWatchBatchRelay` has relative to `WorkspaceWatchSupervisor`),
  so this is a doc-only gap, not a wiring defect — no consumer is broken today. Left as-is, the next
  editor either adds a redundant second export path when one already existed by convention, or wastes
  time via the barrel searching for a class the doc implies should be there.
- Recommendation: add "(internal)" to the `created-directory-reconciler.ts` bullet
  (CLAUDE.md:90), matching `workspace-watch-batch-relay.ts`'s bullet exactly, or export the class +
  its options/defaults types from `index.ts` if a consumer outside this file is anticipated. Either is
  fine; the silence is the defect.

## Minor issues

- `libs/backend/platform-electron/src/workspace-watch/workspace-watch-host.entry.spec.ts` (334
  lines) replaces its `Worker`-based transport test with a `ChildHostProcess` harness in the same
  diff that removes the `worker_threads` branch from the entry itself — correct and necessary, but
  this file is outside the task brief's stated file list; flagged only so the delta review, if one
  follows, treats it as in-scope rather than an untracked change.
- `libs/backend/platform-core/src/workspace-watch/created-directory-reconciler.ts:479-482`
  (`parentKeyOf`) special-cases a key with no `/` by returning `key.slice(0, index + 1)` when
  `lastIndexOf('/')` is `-1` or `0` — `index + 1` is `0` in the `-1` case, so the function returns an
  empty string for a key with no separator at all (only reachable for a malformed root, since every
  real key is an absolute path). Not a bug given the guard `key === this.rootKey` short-circuits the
  one caller before the root itself is looked up this way, but the branch reads as intentional only
  because of that caller-side invariant, which is not stated in a comment at `parentKeyOf` itself.
  Worth a one-line comment; not required.

## File-by-file

### `libs/backend/platform-core/src/workspace-watch/created-directory-reconciler.ts` (490 lines, new)

Score 9/10 — 0 blocking, 0 serious, 1 minor (`parentKeyOf` edge case, above). No `fs`/`node:` import:
`listDirectory` and `clock` are both injected (`CreatedDirectoryReconcilerOptions`, :96-114), so the
class is pure and OS-independent, exactly matching `WorkspaceChangeCoalescer`'s and
`WorkspaceWatchHostCore`'s existing shape in this lib. `ignoreMatcher()` mirrors the engine's own
ignore semantics rather than re-deriving them from `WorkspaceWatchOptions` — correctly scoped to what
the core already computed (`nativeIgnore: () => root.active?.ignore ?? []`, host-core.ts:430), not a
second exclusion authority. Generation counter (`this.generation`) correctly invalidates in-flight
listings after `clear()`/`dispose()`, verified by the dedicated spec's dispose tests.

### `libs/backend/platform-core/src/workspace-watch/created-directory-reconciler.spec.ts` (263 lines, new)

Score 9/10 — colocated with its source, same `ManualClock` shape as `workspace-watch-host-core.spec.ts`'s
own (duplicated deterministic-clock harness, but each is small, spec-local, and the established
pattern in this lib — see the Batch 9 delta review's identical verdict on spec-local fake clocks).
Covers burst listing, native-ignore skipping (absolute + glob), lost-watch confirmation, delete during
tracking, limit-exceeded, suspend/resume, mid-pass suspend, Windows separator joining, and dispose
mid-flight. No gap found against the class's own documented behaviour.

### `libs/backend/platform-core/src/workspace-watch/workspace-watch-host-core.ts` (903 lines)

Score 6/10 — 0 blocking, 1 serious (Serious-1, deferred extraction), 0 minor. The new logic itself is
correct and well-tested (`workspace-watch-host-core.spec.ts` adds a full `created-directory
reconciliation` describe block, :598-940, exercising the reconciler wiring end-to-end including
storm suspend/resume and rebuild gap-limiting). `toWorkspaceWatchPathKey`'s old in-file definition
(previously exported from here) is removed cleanly and re-imported from `workspace-watch-protocol.ts`
— confirmed no duplicate definition remains anywhere in `libs/backend` (grep), and the public export
still resolves through `index.ts` from the new location, so no consumer-visible break.

### `libs/backend/platform-core/src/workspace-watch/workspace-watch-host-boot.ts` (119 lines)

Score 8/10 — `workspaceWatchListDirectoryFor(platform)` takes its platform as a parameter rather than
reading `process.platform` itself, keeping the function pure and testable; the direct `readdir` use
is consistent with this lib's existing "logic-light service may use Node `fs`/`https` directly"
precedent (three services already do), and the OS-platform branching here is a different axis from
the CLI/Electron/VS Code adapter boundary the lib's Boundaries section actually polices. No finding.

### `libs/backend/platform-core/src/workspace-watch/workspace-watch-protocol.ts` (305 lines)

Score 9/10 — `toWorkspaceWatchPathKey` relocated here (from `workspace-watch-host-core.ts`) is the
right call: `created-directory-reconciler.ts` needs the same key function and importing it from
`workspace-watch-host-core.ts` would create host-core → reconciler → host-core, since host-core
already imports the reconciler. Moving the shared primitive to `workspace-watch-protocol.ts` — which
neither file otherwise depends on the other through — breaks the cycle at its only clean point. New
`native-rebuilt` notice code added to `WORKSPACE_WATCH_NOTICE_CODES` alongside the existing
`native-resubscribed`, matching that array's naming shape exactly.

### `libs/backend/platform-core/src/interfaces/workspace-watcher.interface.ts` (185 lines)

Score 9/10 — the degraded-mode guarantee list gains a new bullet for the Linux reconciliation window
("about 100 ms … about 2 s after the loss, or up to 10 s when that root was rebuilt just before",
:163-168) whose numbers were checked against the actual defaults
(`CREATED_DIRECTORY_RECONCILER_DEFAULTS.settleMs` 100 + `.confirmMs` 1000 +
`WORKSPACE_WATCH_HOST_DEFAULTS.rebuildDebounceMs` 1000 ≈ 2 s; `.rebuildMinGapMs` 10 000 matches the
"up to 10 s" case) and match exactly. No doc/behaviour mismatch of the kind Batch 8 found.

### `libs/backend/platform-core/src/index.ts`

Score 8/10 — `export type { WorkspaceWatchDirectoryEntry, WorkspaceWatchListDirectory }` (:185-188)
and the `workspaceWatchListDirectoryFor` value export (:190-193) are correctly typed
(`export type` vs. value split preserved throughout the diff); see Serious-2 for the one gap (the
reconciler class itself, deliberately or not, has no export).

### `libs/backend/platform-electron/src/workspace-watch/workspace-watch-host.entry.ts` /

`libs/backend/platform-cli/src/workspace-watch/workspace-watch-host.entry.ts`

Score 9/10 each — the `worker_threads` branch (and its `import { parentPort as workerThreadsParentPort }
from 'node:worker_threads'`) is fully removed from the Electron entry, its guard string updated to
match (and still pinned by `apps/ptah-electron/src/config/esm-bundle-gate.spec.ts:332-333`, confirmed
identical text), and the CLI entry's fork-only shape is unchanged apart from the one new
`listDirectory` line. Both call `workspaceWatchListDirectoryFor(process.platform)` with the identical
one-line comment — accepted, bounded duplication per Q3 above, not a shared-helper opportunity (each
line is the one place a hexagonal boundary is crossed).

### `libs/backend/platform-electron/src/workspace-watch/in-process-workspace-watch-host.ts`

Score 9/10 — the `PTAH_WATCH_HOST=0` hatch picks up `listDirectory` the same way the real entry does,
keeping the hatch's promise ("same core, same protocol") intact for the new capability too.

### `libs/backend/platform-core/CLAUDE.md`, `libs/backend/platform-electron/CLAUDE.md`, `libs/backend/platform-cli/CLAUDE.md`

Score 8/10 (as a set) — all three read consistent with the code verified above line-for-line: the
rebuild-vs-resubscribe distinction, the reconciler's behaviour and limits, the `native-rebuilt` notice,
and the `worker_threads` removal's reasoning (SIGABRT on Linux, "Module did not self-register" on a
second Worker) are stated identically across all three files where the same fact is repeated. One
point off for the Serious-2 gap (missing "(internal)" marker on the new bullet).

## Pattern compliance

| Repository rule or nearby convention                                                | Status                                              | Evidence                                                                                                                                                                                                                                                               |
| ----------------------------------------------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| platform-core: no Electron / VS Code / Node-IPC import                              | PASS                                                | `created-directory-reconciler.ts`, `workspace-watch-host-core.ts` import only `picomatch`, local types; `workspace-watch-host-boot.ts` imports `node:fs/promises` only, matching the lib's existing Node-builtin precedent                                             |
| Transport-agnostic logic shared by 2+ adapters lives in platform-core, I/O injected | PASS (reconciler) / PARTIAL (host-boot's `readdir`) | `CreatedDirectoryReconciler` takes `listDirectory` as data; `workspaceWatchListDirectoryFor` supplies the one real Linux implementation directly rather than an adapter-supplied one — consistent with the file-settings/content-download precedent, not a new pattern |
| platform-cli / platform-electron do not import each other                           | PASS                                                | both entries import only `@ptah-extension/platform-core`                                                                                                                                                                                                               |
| `catch (error: unknown)`                                                            | PASS                                                | every catch sampled (`created-directory-reconciler.ts:336`, `:457`, host-core.ts throughout)                                                                                                                                                                           |
| `export type` for type-only re-exports                                              | PASS                                                | `index.ts:185-188`, `:220-233`                                                                                                                                                                                                                                         |
| No duplicate definition after a relocation                                          | PASS                                                | `toWorkspaceWatchPathKey` single-defined in `workspace-watch-protocol.ts`, grep confirms                                                                                                                                                                               |
| Internal (non-barrel) class marked "(internal)" in CLAUDE.md                        | FAIL                                                | `created-directory-reconciler.ts` bullet, `platform-core/CLAUDE.md:90-101` (Serious-2)                                                                                                                                                                                 |
| File size vs. 700-line soft ceiling, with a stated extraction trigger honoured      | FAIL                                                | `workspace-watch-host-core.ts` 903 lines; the extraction two prior reviews scoped was not done when its own named trigger occurred (Serious-1)                                                                                                                         |
| CLAUDE.md accuracy across all three touched libs                                    | PASS                                                | verified line-for-line against code (File-by-file above)                                                                                                                                                                                                               |
| `worker_threads` transport fully removed, guard strings still matched               | PASS                                                | entry + spec + `esm-bundle-gate.spec.ts:332-333` all consistent                                                                                                                                                                                                        |

## Maintenance debt

- Introduced: one new port collaborator (`CreatedDirectoryReconciler`, ~500 lines incl. spec) closing
  a real Linux data-loss gap; a rebuild-vs-resubscribe policy inside the existing host core (no new
  file); removal of a transport branch and its test coverage.
- Retired: the `worker_threads` transport and its dedicated `Worker`-based spec block (replaced by an
  equivalent `child_process.fork` harness, not a coverage loss).
- Net: additive capability with a documentation gap (Serious-2) and a deferred, previously-scoped
  extraction (Serious-1) that now has two reviews' worth of prior art pointing at exactly what to do.

## Verdict

- Recommendation: REVISE
- Confidence: HIGH
- Key concern: the two prior reviews already identified `computeNativeIgnore` as safe, clean, and
  ready to extract, and named this batch's kind of change as the trigger to do it; the file grew past
  it a third time instead.
- What a 10/10 version would do differently:
  1. Extract `computeNativeIgnore` + its three helpers into a `NativeIgnoreSetPlanner`-style
     collaborator, injected the way `CreatedDirectoryReconciler` already is (Serious-1).
  2. Mark `created-directory-reconciler.ts`'s CLAUDE.md bullet "(internal)" to match
     `workspace-watch-batch-relay.ts`'s, or export the class if an outside consumer is anticipated
     (Serious-2).
  3. A one-line comment on `parentKeyOf`'s no-separator branch, and a note that
     `workspace-watch-host.entry.spec.ts`'s `ChildHostProcess` rewrite, while correct, sits outside
     the stated file list for this batch (both Minor, non-blocking).

## Delta review (review fixes)

Scope: the two Serious findings and the one Minor from the base review, plus a structural read of
every new symbol this round touched (`onWatchesLost`, `reportUnreadable`/`directory-unreadable`, the
port-doc rewording, the reconciler's ignore-verification comment, spec reorganization). Read on disk
in `D:\projects\ptah-437` (uncommitted); no source edited, no tests run; `npx eslint` clean on every
file below. Batch 16 files (`vscode-core`, `agent-sdk`, `skill-synthesis`, `cli-engine/container.ts`,
the three apps' `container.smoke.spec.ts`) out of scope, per the coordinator's note.

### Required fixes — verified

- **Serious-1 (deferred `computeNativeIgnore` extraction)** — moved verbatim to
  `libs/backend/platform-core/src/workspace-watch/native-ignore-set-planner.ts` as
  `planNativeIgnoreSet` (:50), with its three helpers (`isSafeGlobName`, `caseInsensitiveGlobName`,
  `compilesAsGlob`, :111-141) and a new dedicated `native-ignore-set-planner.spec.ts` (4 tests: empty
  input, subtree-form + never-`.git` + nested-root-under-root, cross-subscriber intersection with
  case-insensitive segment comparison, detected-roots gated on every subscriber's
  `nestedRepoDetection`). `workspace-watch-host-core.ts` calls it at :461 with the same three inputs
  the old private method read from `root` (`rootKey`, `[...root.subscribers.values()]`,
  `root.detectedNestedRoots`) and is otherwise unchanged at the call site. The host core is back down
  to 817 lines (was 903; -86 net, after also absorbing this round's new `onWatchesLost` logic) —
  confirms the extraction actually reduced the file rather than being offset by unrelated growth. The
  host-core spec's old cross-subscriber-intersection tests are gone from
  `workspace-watch-host-core.spec.ts` and reappear, same assertions, in
  `native-ignore-set-planner.spec.ts` — a genuine test relocation, not a coverage loss with new
  duplicate tests bolted on. **FIXED**, cleanly.
- **Serious-2 (missing "(internal)" markers)** — both new bullets in
  `platform-core/CLAUDE.md` now carry it: "`native-ignore-set-planner.ts` — `planNativeIgnoreSet`
  (internal)" (:93) and "`created-directory-reconciler.ts` — `CreatedDirectoryReconciler` (internal)"
  (:97), matching `workspace-watch-batch-relay.ts`'s existing marker exactly. Confirmed against the
  code: neither `planNativeIgnoreSet`/`NativeIgnoreSetInput`/`NativeIgnoreSubscriber` nor
  `CreatedDirectoryReconciler`/its options/defaults types appear in `platform-core/src/index.ts` (grep
  empty for the planner; the reconciler's export list is unchanged from the base review, still only
  the two structural types). The marker now matches the wiring. **FIXED.**
- **Minor (`parentKeyOf` doc)** — `created-directory-reconciler.ts:521-524` now carries a doc comment
  stating the mapping (`/a/b` → `/a`; `/a` → `/`; a key with no `/` → `''`) and explicitly naming the
  no-separator case as unreachable in practice and why (every key comes from an absolute path, and
  `observe` never looks the root's own parent up this way). Matches the recommendation exactly.
  **FIXED.**

### New code this round

**`onWatchesLost` (:646) — correctly named, and a real behavioural strengthening documented
consistently everywhere it needed to be.** The method composes `lostEvents` (immediate `overflow` to
every subscriber) with `requestRebuild` (the debounced, gap-limited rebuild), replacing what was
previously a bare `this.requestRebuild(...)` call from both call sites (the reconciler's
`onIncomplete` callback wired in `createRoot`, and `resumeReconciliationIfCalm`). Naming matches the
sibling state-transition methods exactly (`onNativeSubscribed`, `onNativeSubscribeFailed`,
`onDiscovered`, `onNestedRepoRoot` — all `on<PastParticiple>` for "something happened, react"). The
new immediate-overflow behaviour is a logic change, not a style one, but the style-relevant question —
is it documented everywhere a reader would look? — checks out: the port doc
(`workspace-watcher.interface.ts:163-171`) now states the two-`overflow` sequence with timing that
matches this file's own constants (100 ms settle + ~1 s confirm ≈ "about 1 s after the directory's
children were listed" for the first `overflow`, then `rebuildDebounceMs` 1 s / `rebuildMinGapMs` 10 s
for "about 1 s later, or up to 10 s"), and the CLAUDE.md bullet (`platform-core/CLAUDE.md:85-87`,
"every loss is ALSO signalled when detected … so no consumer trusts a stale view while the rebuild
waits") states the same fact a third way. All three read as one consistent contract. The method's own
doc comment (:636-645) additionally explains the one subtle interaction — a storm-exit
`onWatchesLost` call runs inside the coalescer's `exited` hook, before the coalescer's own exit
`overflow`, so the two fold into one batch rather than two — which is exactly the kind of ordering
fact a reader would otherwise have to trace through both files to find. **No finding.**

**`reportUnreadable`/`onUnreadable`/`directory-unreadable` — naming and rate-limiting both
consistent.** `reportUnreadable` (`created-directory-reconciler.ts:365-375`) rate-limits to once per
`unreadableReportIntervalMs` per reconciler instance (i.e. per root, since one reconciler is
per-root) — the same shape as the host core's own `failureSignalled` "once per failure streak"
pattern, just time-boxed instead of streak-boxed, which is the right choice here since an unreadable
directory is a standing condition, not a one-off failure. `directory-unreadable` fits the existing
`WORKSPACE_WATCH_NOTICE_CODES` naming shape (`storm-entered`, `native-rebuilt`, kebab-case
subject-state pairs) exactly. Callback wiring (`onUnreadable?.(path, code)`, optional per
`CreatedDirectoryReconcilerOptions`) matches the reconciler's other optional-callback shape, and the
core's own call site (`onUnreadable: (path, code) => this.postNotice('directory-unreadable', ...)`,
host-core.ts:432-433) reads as a direct, unsurprising translation. EACCES/EPERM are the only two codes
that trigger it (:358-359) — correctly distinct from the silent ENOTDIR/ENOENT branch just above,
since those two really mean "nothing was lost" while EACCES/EPERM mean "something might be, and this
host can't see it." **No finding.**

**Port doc wording (`workspace-watcher.interface.ts:163-175`) — accurate, and the new duplicate-create
bullet (:172-174) is the right thing to add now, not scope creep.** `onDiscovered`'s coalescer push
and the engine's own later report of the same path are two independent `coalescer.push()` calls for
one real change; nothing in this round suppresses the second one (correctly — the engine's report is
authoritative and cheaper to keep than to cross-reference against reconciler state at push time). The
new bullet states the resulting behaviour plainly ("the same `create` may be delivered twice … treat
`create` as this path may now exist") rather than leaving a reader to discover it from the two call
sites. This closes a doc gap the previous round's behaviour already had (`onDiscovered` pushing
independently of the engine's own report was already true before this round), which is the right
thing to fix alongside the other doc work in this same pass. **No finding.**

**The ignore-semantics verification comment (`created-directory-reconciler.ts:470-484`) — belongs in
code, not CLAUDE.md, and matches this repo's own precedent for exactly this kind of claim.** The
comment records a measured verification against the real `@parcel/watcher` 2.5.6 binary (46/46 created
paths agreed between the mirrored matcher and the engine's actual ignore decision) directly above the
method it backs (`ignoreMatcher()`). This is the same shape as `workspace-watch-host-core.ts`'s own
module doc, which states its rebuild-vs-resubscribe measurement inline ("measured on Linux: 16 of 800
writes under lost watches still lost after an overlapping re-subscribe, 0 after a full one") rather
than in a CLAUDE.md file, and the same shape `platform-electron/CLAUDE.md` uses for the
`worker_threads` SIGABRT measurement. Moving it to CLAUDE.md would separate the claim from the code
whose correctness it justifies and whose future changes (an engine upgrade) should re-trigger it — the
comment already says "re-check it when the engine is upgraded," which only makes sense pinned to the
method, not a project-level doc a reader would not think to open when bumping a dependency. **Keep in
code; no finding.** (CLAUDE.md's own bullet for this file, :97-110, already carries the summary a
doc-level reader needs — the EACCES/EPERM handling, the notice, the limits — without repeating the
46/46 figure, which is the right division of detail between the two documents.)

**Spec organization — clean split, no duplication reintroduced.** `native-ignore-set-planner.spec.ts`
colocates with its source, matching every other extracted collaborator in this folder
(`created-directory-reconciler.spec.ts`; `workspace-watch-batch-relay` tested inside
`workspace-watch-supervisor.spec.ts` per the Batch 9 review). `workspace-watch-host-core.spec.ts`'s
"native ignore set" describe block now holds exactly one test (the integration-level
"re-subscribes natively when a new subscriber narrows the intersection", :275-302) — the host-level
behaviour of calling the planner and reacting to a changed result — while the planner's own
input/output cases live solely in its dedicated spec. This is the correct division: host-core tests
"does the class use the plan correctly," the planner spec tests "is the plan correct." No test
appears in both files.

**`workspace-watch-host-core.ts` at 817 lines (was 903) — the fix earns its line count back, and the
new `onWatchesLost` wiring stays inline correctly.** The new lines this round (`onWatchesLost`'s
~15-line body plus its two call-site changes) are state-coupled to `root.active`/`root.subscribers`/
`ensureNative` the same way the surrounding rebuild logic already was — they extend an existing
state-coupled concern rather than introducing a second nameable one, so no further extraction is owed
for them. The one extraction this file owed (`computeNativeIgnore`) is now paid off; nothing else in
the class currently clears the facade rule's bar.

### Guard string (not required, evidence-based recommendation)

**Leave `'workspace-watch-host.entry.ts must be run as a worker (no Electron parentPort and no IPC
channel)'` as it is.** The literal transport list in the parenthetical is already accurate for the
current, `worker_threads`-free entry (it never mentions `worker_threads`, and hasn't since the earlier
round that removed the transport). The leading phrase "must be run as a worker" is not describing the
`worker_threads` API specifically — it is the fixed opening every entry in `WORKER_ENTRY_GUARDS` uses
regardless of its actual transport (`integrity-worker.ts`, `embedder-worker.ts`, `voice-worker.ts`, the
state-storage worker, and this host all share it), matching the file's own category framing one
paragraph above the map: `-host` targets are grouped with `-worker` targets deliberately ("like the
workers, it is spawned bare, fails fast on a transport guard, and has no 'run standalone' contract of
its own"), and `WORKER_TARGET_SUFFIX = /-(worker|host)$/` treats them as one family on purpose.
Rewording only this one guard string to say "must be run as a host" would break that family
resemblance for no reader benefit — the parenthetical is what actually tells a reader which
transports are acceptable, and it is correct. Changing it would also touch two files in lockstep (the
literal string here and its pinned copy in `esm-bundle-gate.spec.ts:333`) for a purely cosmetic gain.

**Do fix the adjacent descriptive comment in `esm-bundle-gate.spec.ts` (not pinned by any assertion,
so free to edit without touching the guard map).** Lines 305-308 still read: "workspace-watch-host.entry.ts
follows the same shape: it probes **the same two transports** plus a `child_process.fork` IPC channel
before loading `@parcel/watcher`" — "the same two transports" refers back to "`process.parentPort`
(Electron utilityProcess) and `node:worker_threads`' `parentPort`" two sentences earlier, describing
`integrity-worker.ts`/`embedder-worker.ts`. That was accurate when this entry had three transports
(Electron, `worker_threads`, fork); now that `worker_threads` is gone, the entry probes only two
transports total (Electron parentPort, fork), and this sentence still describes a third that no
longer exists. Minor, not required before commit (it is a comment, not an assertion, and the guard
string itself and the tests both already reflect the removal correctly), but worth one line:
"workspace-watch-host.entry.ts probes an Electron `parentPort` or a `child_process.fork` IPC channel
before loading `@parcel/watcher`, and throws synchronously when neither is present."

### Delta verdict

- **Recommendation: APPROVE.** All three required fixes (two Serious, one Minor) are verified correct
  and complete on disk. No blocking or serious issues in the new `onWatchesLost` wiring, the
  unreadable-directory reporting, the port-doc updates, or the spec reorganization.
- **Confidence: HIGH.**
- **Remaining, both non-blocking and neither required before this batch commits:**
  1. Minor — `apps/ptah-electron/src/config/esm-bundle-gate.spec.ts:305-308`: the descriptive comment
     above `WORKER_ENTRY_GUARDS` still says the host entry probes "the same two transports" as the
     `worker_threads`-based workers plus a fork channel (three total); it only probes two now
     (Electron parentPort, fork). Not pinned by any assertion — safe to correct without touching the
     guard-string map.
  2. Process note, not a code fix — this review file itself will fail `npx prettier --check` until
     the team-leader's commit-time `nx format:write` runs, per the same precedent the Batch 8/9 delta
     reviews already recorded.
