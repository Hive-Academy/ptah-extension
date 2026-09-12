# Code Logic Review — `TASK_2026_426_8d43`

## Summary

| Metric              | Value         |
| ------------------- | ------------- |
| Overall score       | 7/10          |
| Assessment          | NEEDS_REVISION |
| Blocking issues     | 0             |
| Serious issues      | 2             |
| Moderate issues     | 3             |
| Failure modes found | 6             |

Scope examined in full: `user-layer-mirror.service.ts` (save path, both kind
variants, plus the reconcile and reap paths it must survive),
`user-layer-fs-ops.ts` (guard + snapshot helpers), `source-hash.ts`,
`skills-synthesis-rpc.schema.ts`, `skills-synthesis-rpc.handlers.ts`
(`registerSaveCloneBody`, `readCloneBody`, `agentScope`, `parseParams`),
`rpc.types.ts` + `rpc-skill-clone.types.ts` + `rpc-surface.spec.ts`
registrations, `app-state.service.ts` intent pair, `harness-target-row` /
`harness-health-badge`, `clone-action-gating.ts`, `clone-bulk-rebase.service.ts`,
`clone-bulk-toolbar`, `bulk-rebase-confirm`, `clone-body-editor`,
`clone-detail-drawer.component.ts`, `skill-clones-view.component.ts`,
`skill-clones-state.service.ts`, `skill-synthesis-rpc.service.ts`,
`skill-synthesis-tab.component.ts`.

Evidence run in this worktree: `typecheck` green for `core`, `marketplace`,
`skill-synthesis-ui` (3/3 projects); `@ptah-extension/skill-synthesis-ui:test`
green, 26 suites / 397 tests. Batch 5 has not run, so there is **no test today
that exercises a save followed by a reconcile** — the R3.8 verdict below is from
reading the control flow, not from evidence.

Why 7 and not 8: the sidecar rule at the heart of the task is implemented
exactly, on both variants, and the five registration sites are all present — but
the drawer can enter edit mode seeded with a *different clone's* body, which is
a wrong-content write that reports success. Why not 5: nothing here is
unvalidated, unlocked, unsnapshotted, or silently swallowed; the two remaining
data-safety gaps are one narrow UI race and one inherited reconciler rule, both
recoverable from the mandatory snapshot.

## Five logic questions

### 1. How does this fail silently?

- **The stale-body save (Serious 1).** `skill-clones-state.service.ts:105-119` —
  `loadDetail` sets `detailLoading` but does **not** clear `this.detail` before
  awaiting the RPC. So between clicking card B and B's detail landing,
  `detailBody()` still returns clone **A**'s body while `selected()` is already
  B. `canEditSelectedBody` (`skill-clones-view.component.ts:446-449`) tests only
  `body !== null`, and the drawer's Edit button
  (`clone-detail-drawer.component.ts:264-275`) is gated on `canEditBody() &&
  !editing()` and `[disabled]="busy()"` — **not** on `detailLoading()`, unlike
  the read-only render two branches below it (`:291-299`, which correctly shows
  "Loading body…"). A save in that window writes A's text into B's file and
  reports `Saved "B"` (`skill-clones-view.component.ts:684`).
- **Nowhere else.** Every other failure path I traced surfaces: the mirror is
  result-shaped and the handler maps `written: false` to `INVALID_PARAMS`
  (`skills-synthesis-rpc.handlers.ts:1356-1361`); `assertUnderUserLayer` throws
  into the generic catch which reports and rethrows a sanitised error
  (`:1372-1376`); `state.saveCloneBody` deliberately lets errors propagate
  (`skill-clones-state.service.ts:126-135`); the batch turns both failure
  channels into a named outcome (`clone-bulk-rebase.service.ts:113-127`).

### 2. What user action produces unexpected behaviour?

- Clicking a second clone card and pressing **Edit** before the detail resolves
  — question 1's scenario.
- Emptying the textarea and pressing **Save**: the button is not disabled on an
  empty draft (`clone-body-editor.component.ts:54-62`), so the Zod `.min(1)`
  (`skills-synthesis-rpc.schema.ts:417`) answers with the generic
  `Invalid parameters for skillSynthesis:saveCloneBody`
  (`skills-synthesis-rpc.handlers.ts:1898-1901`) rendered verbatim as a toast.
  Correct refusal, developer-facing wording.
- Applying an enhancement proposal to the clone whose editor is open: the view
  re-runs `loadDetail` (`skill-clones-view.component.ts:571-575`), `body()`
  changes, and `draft = linkedSignal(() => this.value())`
  (`clone-body-editor.component.ts:~100`) re-seeds, discarding what the user
  typed with no warning.
- Everything else behaved as specified. The diverged filter, the residual
  "(M in other kinds)" clause, the zero-eligible disabled control with its
  stated reason (`clone-bulk-toolbar.component.ts:113-121`) and the emptied-filter
  empty state (`skill-clones-view.component.ts:90-91`, `:460-464`) all hold.

### 3. What input data produces a wrong answer?

No crafted input reaches a path join. `parseParams(SkillSaveCloneBodyParamsSchema,
…)` is the **first statement** of the handler body, outside and before the `try`
(`skills-synthesis-rpc.handlers.ts:1334-1338`), and `SlugSchema`
(`skills-synthesis-rpc.schema.ts:326-334`) already rejects `..`, `/`, `\`, empty
and >128 chars via both a regex and a `.refine`. `join` happens only inside
`saveDirCloneBody` / `saveFileCloneBody` (`user-layer-mirror.service.ts:553`,
`:586`), after validation, and `assertUnderUserLayer` runs on every constructed
path before the existence probe (`:555-556`, `:588-589`) with
`writeTextAtomic` re-asserting it (`user-layer-fs-ops.ts:129-131`). A
non-string `body`, an out-of-set `kind` and `body: ''` are all rejected before
any `fs` call.

The one wrong-answer input is not adversarial: the text the editor happens to be
holding when the drawer has switched clones (question 1).

### 4. What happens when a dependency fails?

- **Mirror/registry absent (non-desktop):** `requireDesktop` →
  `PERSISTENCE_UNAVAILABLE` (`skills-synthesis-rpc.handlers.ts:1340-1341`).
- **Clone row present, file gone:** `written: false, reason: 'clone-missing'`,
  nothing created, no `mkdir` anywhere on this path
  (`user-layer-mirror.service.ts:558-566`, `:591-599`) — contrast
  `writeEnhancedSkill`, which does `mkdir` at `:630` and was correctly not
  reused.
- **Write throws mid-save:** the snapshot already exists (step order at
  `:568-569`, `:601-604`), `writeTextAtomic` renames only after a successful
  temp write (`user-layer-fs-ops.ts:137-141`), and the throw unwinds through
  `withSlugLock`'s `finally` (`:1429+`). No half-written clone file.
- **Boot reconcile holds the lock:** every reconcile branch wraps in
  `withSlugLock` (`user-layer-mirror.service.ts:1063`, `:1120`, `:1166`, `:1212`),
  and the save takes the same `${kind}/${slug}` lock at `:538`. A save issued
  during a boot reconcile queues; it cannot interleave. NFR Concurrency holds.
- **One transport failure inside the batch:** `rebaseOne` catches it, names the
  slug, and the loop continues (`clone-bulk-rebase.service.ts:113-127`);
  `running` clears in a `finally` (`:95-97`), so the surface cannot be left
  permanently disabled. R1.4 and R1.7 hold.
- **`reapDeletedUpstream` does not take the slug lock**
  (`user-layer-mirror.service.ts:457-470` → `orphan` sweep). A save racing a reap
  of the same slug is theoretically interleavable. Out of this task's scope
  (pre-existing, and reap only visits clones whose upstream is already gone), but
  worth naming so nobody reads the concurrency section as complete.

### 5. What is missing that the requirements never mentioned?

- **A guard on "the body input belongs to the selected clone".** No criterion
  asked for it, because R3.1 assumed a loaded body implies the *right* body.
  `canEditCloneBody(clone, body)` (`clone-action-gating.ts:144-149`) takes
  `clone` and ignores it entirely, which is where that guard would naturally
  live.
- **Any client-side minimum on the draft.** The backend rule (`.min(1)`) exists
  and nothing upstream mirrors it.
- **A named consequence for a sidecar-less clone that shadows an upstream
  source** — see Serious 2. The requirements state R3.8 unconditionally; the
  code satisfies it only for clones that have a sidecar.
- **Nothing calls `CloneBulkRebaseService.reset()`**
  (`clone-bulk-rebase.service.ts:100-104`). Harmless because the service is
  per-surface (`skill-clones-view.component.ts:116`) and `progress` is read
  through `bulk.running() ? … : null` (`:207`), but it is dead API.

## Failure modes

### Cross-clone body write during the detail load

- Trigger: drawer open on clone A with its body loaded; user clicks clone B's
  card and presses **Edit** before B's `skillSynthesis:getClone` resolves.
- Symptom: the editor is seeded with A's body under B's heading; **Save** writes
  A's content into B's file and toasts `Saved "B"`.
- Evidence: `skill-clones-state.service.ts:105-119`;
  `skill-clones-view.component.ts:446-449`, `:260`, `:684`;
  `clone-detail-drawer.component.ts:264-275` (Edit not gated on
  `detailLoading()`) versus `:291-299` (the render is).
- Current handling: none. `editing` does reset on a clone change
  (`clone-detail-drawer.component.ts:458-461`), which is why the draft cannot
  *follow* the user — but re-entering edit mode in the stale window is unguarded.
- Recommendation: add `&& !this.detailLoading()` to `canEditSelectedBody`
  (`skill-clones-view.component.ts:446`), or clear `this.detail` at the top of
  `loadDetail`. Prefer the first: clearing `detail` also blanks the drawer's
  metrics on every reopen.

### A saved body is lost on the second reconcile when the clone has no sidecar

- Trigger: a clone in `~/.ptah/user` with **no** `.origin` sidecar whose slug is
  also shipped by a plugin/synth/agent source; the user saves a body, then
  restarts twice.
- Symptom: restart 1 mints a sidecar whose `sourceHash` is the *user's* content;
  restart 2 sees `liveCloneHash === sidecar.sourceHash` and fast-forwards,
  replacing the saved body with upstream. Only the `.history` snapshot survives.
- Evidence: save correctly mints nothing
  (`user-layer-mirror.service.ts:572-575`, `:607-613`); the mint happens in
  `reconcileDirClone` / `reconcileFileClone` (`:1240-1249`, `:1302-1311`) via
  `reconcileMissingSidecar` (`:1598-1621`, `sourceHash = computeSourceHash(targetDir)`)
  and `reconcileMissingFileSidecar` (`:1869-1897`); the fast-forward fires at
  `:1260-1268` / `:1322-1329`.
- Current handling: none, and not introduced by this diff — this is the existing
  adopt-as-is rule, which already loses a hand-edit made under the same
  conditions. Changing it is explicitly out of scope
  (`task-description.md:81-83`).
- Recommendation: do not touch the reconciler here. Do (a) narrow the plan's
  unconditional R3.8 claim (`implementation-plan.md:356-372`) to "for a clone
  with a sidecar", and (b) make batch 5's R3.8 regression test state which case
  it covers, plus a second case asserting this known loss, so it is a recorded
  behaviour rather than a surprise. Carry it to `future-enhancements.md`.

### Generic INVALID_PARAMS toast on an empty body

- Trigger: user selects all in the textarea, deletes, presses Save.
- Symptom: toast reads `Invalid parameters for skillSynthesis:saveCloneBody`.
- Evidence: `clone-body-editor.component.ts:54-62` (Save disabled only while
  `saving()`); `skills-synthesis-rpc.schema.ts:417`;
  `skills-synthesis-rpc.handlers.ts:1898-1901`.
- Current handling: refused correctly, no write, snapshot not taken. Only the
  message is wrong for the audience.
- Recommendation: `[disabled]="saving() || draft().trim().length === 0"` and a
  one-line hint stating that a clone cannot be emptied from here.

### In-progress draft discarded by a background detail reload

- Trigger: editor open on clone X; the user applies an enhancement proposal for
  X from the preview drawer.
- Symptom: the textarea silently reverts to the newly written body; typed text
  is gone with no prompt.
- Evidence: `clone-body-editor.component.ts:~100`
  (`draft = linkedSignal(() => this.value())`);
  `skill-clones-view.component.ts:571-575`.
- Current handling: none. The re-seed is deliberate for the post-save reload
  (documented at the same line) and is correct for that case only.
- Recommendation: re-seed only when the incoming `value()` equals the submitted
  text, or hold a `dirty` flag and keep the draft when the user has typed.

### Edit offered for a clone whose file is no longer on disk

- Trigger: an orphaned or externally deleted clone still listed by
  `listClones`; user edits and saves.
- Symptom: `No cloned skill found for slug "x".` — a true statement that reads
  as a bug, after the user typed a full body.
- Evidence: `clone-action-gating.ts:144-149` ignores its `clone` argument;
  `skills-synthesis-rpc.handlers.ts:1356-1361`.
- Current handling: refused, nothing created. Correct, just late.
- Recommendation: use the `clone` argument — at minimum exclude
  `orphaned === true`, matching the rule `eligibleForBulkRebase` already applies.

### Bulk progress label overshoots on the final entry

- Trigger: last iteration of a batch.
- Symptom: none observable. `progress.done` reaches `total` and the label is
  `done + 1`, but the `_progress.set` and the `finally { _running.set(false) }`
  are synchronous with no await between them
  (`clone-bulk-rebase.service.ts:87-97`) and the label is gated on
  `bulk.running()` (`skill-clones-view.component.ts:207`), so no frame renders
  "16 of 15".
- Evidence: `clone-bulk-toolbar.component.ts:108-112`.
- Recommendation: none required. Recorded so a future reader does not "fix" the
  `+ 1`, which is correct for every non-final iteration.

## Blocking issues

None.

## Serious issues

### Edit mode can be seeded from the previously selected clone's body

- File: `libs/frontend/skill-synthesis-ui/src/lib/components/clones/skill-clones-view.component.ts:446-449`;
  `.../clones/clone-detail-drawer.component.ts:264-275`;
  `libs/frontend/skill-synthesis-ui/src/lib/services/skill-clones-state.service.ts:105-119`
- Scenario: click card B while A's detail is loaded, press Edit before B's
  detail resolves, press Save.
- Impact: clone B's file in `~/.ptah/user` is overwritten with clone A's
  content, and the UI reports success. Recoverable only through the drawer's
  "Revert to this" snapshot, which the user has no reason to look for because
  nothing said anything went wrong.
- Fix: `canEditSelectedBody = computed(() => !this.detailLoading() && c !== null
  && canEditCloneBody(c, this.detailBody()))`. One condition, one file.

### R3.8 does not hold for a sidecar-less clone that shadows an upstream source

- File: `libs/backend/agent-generation/src/lib/services/user-layer/user-layer-mirror.service.ts:1598-1621`
  and `:1869-1897` (the mint), `:1260-1268` and `:1322-1329` (the fast-forward);
  save path `:572-575`, `:607-613`
- Scenario: user-authored (sidecar-less) clone whose slug a plugin also ships →
  save → two application starts.
- Impact: the saved body is replaced by upstream on the second start. The save
  path itself is correct — not minting a sidecar is the right call
  (`origin-sidecar.types.ts:119-127`) — the loss comes from the reconciler's
  adopt-as-is rule for a missing sidecar.
- Fix: not a code change in this task; the reconciler is out of scope. Narrow
  the plan's R3.8 statement, and have batch 5 pin both the sidecar-ful case
  (survives) and this case (does not), so the limit is recorded rather than
  discovered.

## Moderate and minor issues

- **Moderate** — empty draft reaches the RPC and returns a developer-facing
  message: `clone-body-editor.component.ts:54-62`,
  `skills-synthesis-rpc.schema.ts:417`.
- **Moderate** — `draft` re-seeds from any `value()` change, discarding typed
  text: `clone-body-editor.component.ts:~100` with
  `skill-clones-view.component.ts:571-575`.
- **Moderate** — `canEditCloneBody` ignores its `clone` parameter, so the
  editor is offered for orphaned entries: `clone-action-gating.ts:144-149`.
- **Minor** — `reapDeletedUpstream` runs outside `withSlugLock`, unlike every
  reconcile branch: `user-layer-mirror.service.ts:457-470` vs `:1063`, `:1120`,
  `:1166`, `:1212`. Pre-existing.
- **Minor** — `CloneBulkRebaseService.reset()` has no caller:
  `clone-bulk-rebase.service.ts:100-104`.
- **Minor** — cards lock on `busySlug() === c.slug || bulk.running()`
  (`skill-clones-view.component.ts:233`) rather than `actionsLocked()`, so a
  card's Rebase button stays clickable during a body save. No second write is
  possible — the confirm button is disabled by `actionsLocked()` (`:330`) — so
  R1.7 still holds; the affordance is just briefly misleading.

## Data flow

Body save, end to end:

1. `CloneBodyEditorComponent` emits `save(draft)` — OK; textarea bound as text,
   never `[innerHTML]`.
2. Drawer `onBodySaved(m.clone, body)` records `submittedBody` and emits
   `{ clone, body }` (`clone-detail-drawer.component.ts:531-534`) — **GAP**:
   `m.clone` is the newly selected clone while `body()` may still be the
   previous one's (Serious 1).
3. View `onSaveBody` sets `bodySaving`, calls `state.saveCloneBody` — OK; locks
   the drawer and both confirmations through `actionsLocked()` (`:440-443`).
4. `SkillSynthesisRpcService.saveCloneBody` → `skillSynthesis:saveCloneBody` at
   `PROMOTE_MS`, non-success mapped to a thrown `Error`
   (`skill-synthesis-rpc.service.ts:520-534`) — OK.
5. Handler: Zod parse **before** anything else (`:1334-1338`) — OK, this is the
   first gate the NFR demands.
6. `requireDesktop` × 2, then `registry.getBySlug` existence check
   (`:1340-1349`) — OK, R3.7's first half.
7. `mirror.saveCloneBody({ kind, slug, body, workspaceRoot: agentScope() })`
   (`:1350-1355`) — OK; the same `agentScope()` `readCloneBody` uses
   (`:2027`), so read and write resolve the identical path.
8. `withSlugLock(kind, slug)` (`user-layer-mirror.service.ts:538`) — OK;
   serialises against reconcile, rebase, keep and enhance on the same slug.
9. `join` + `assertUnderUserLayer` on every constructed path (`:553-556`,
   `:586-589`) — OK, second gate.
10. Existence probe; absent → `written: false`, no `mkdir` (`:558-566`,
    `:591-599`) — OK, R3.7's second half.
11. Snapshot, unconditional, via `snapshotDirToHistory` (dir) /
    `snapshotFileToHistory` (file) (`:568`, `:601-603`) — OK, and both layouts
    are exactly the ones `listHistory` reads (`:708-716`), so the drawer's
    "Revert to this" can see them.
12. `writeTextAtomic` (temp + rename, re-asserts the guard) — OK.
13. `computeSourceHash` — OK; `.history/` and the sidecar are excluded
    (`source-hash.ts:52-57`), so the snapshot written one step earlier does not
    pollute the hash.
14. Sidecar: `if (existing) write { ...existing, currentContentHash }`
    (`:572-575`, `:607-613`) — OK. `sourceHash`, `diverged`,
    `pendingSourceHash`, `lastEnhancedAt`, `clonedAt`, `pluginId`, `version`,
    `historyDir`, `orphaned` are carried by spread and **never assigned** on
    either variant. No sidecar is minted when none exists, and the body write
    still succeeds. This is the task's central rule and it is implemented
    exactly.
15. No SQLite registry write — OK; `listClones` reads `diverged` /
    `pendingSourceHash` from the row and neither changed.
16. Handler maps `!written || historyTs === null` to `INVALID_PARAMS`, logs
    success, returns `{ kind, slug, historyTs }`; any other throw is reported and
    replaced by `toUserError` (`:1356-1376`) — OK, no raw filesystem string
    crosses the wire.
17. `state.saveCloneBody` reloads the detail (`skill-clones-state.service.ts:135`),
    the drawer leaves edit mode only when `body()` matches `submittedBody`
    (`clone-detail-drawer.component.ts:474-482`), the view refreshes the list —
    OK, R3.4 including the raised `historyCount`.

Reconcile after a save (the R3.8 question), for a clone **with** a sidecar:
`liveSourceHash !== sourceHash` → not a noop; `liveCloneHash !== sourceHash`
(the user changed the body) → `markDiverged*`, body untouched
(`user-layer-mirror.service.ts:1254-1276`, `:1316-1337`). **The code as written
would pass batch 5's R3.8 test.** For a clone with **no** sidecar, see Serious 2.

## Requirements fulfilment

| Requirement | Status | Gap |
| ----------- | ------ | --- |
| R1.1 bulk control present / disabled with reason | COMPLETE | `clone-bulk-toolbar.component.ts:52-70`, `:113-121` |
| R1.2 reuses the per-clone rebase path | COMPLETE | `clone-bulk-rebase.service.ts:114` calls the same `rpc.rebaseClone` |
| R1.3 confirmation names the count + consequence | COMPLETE | `bulk-rebase-confirm.component.ts:34-70`; `BULK_REBASE_EXPLANATION` composed from `REBASE_EXPLANATION` (`clone-action-gating.ts:84-87`) |
| R1.4 continue past a failure, name the slug | COMPLETE | `clone-bulk-rebase.service.ts:87-127`; toast at `skill-clones-view.component.ts:658-670` |
| R1.5 one refresh, count drops | COMPLETE | `skill-clones-view.component.ts:656`; count is `computed` off `state.clones()` |
| R1.6 orphaned excluded | COMPLETE | `clone-action-gating.ts:133` uses `orphaned !== true`, so `undefined` is INCLUDED |
| R1.7 conflicting controls disabled in flight | COMPLETE | `actionsLocked()` `:440-443`, applied at `:139`, `:257`, `:285`, `:330`; cards use a narrower predicate (Minor) |
| R2.1 diverged count rendered | COMPLETE | `clone-bulk-toolbar.component.ts:90-100` |
| R2.2 filter shows only `diverged: true` | COMPLETE | `skill-clones-view.component.ts:409-415` |
| R2.3 empty state, not a blank region | COMPLETE | `:90-91`, `:212-222`, `:460-464` |
| R2.4 report is an activatable named control | COMPLETE | `harness-target-row.component.ts:126-137` — a real `<button>` with an `aria-label` naming the destination |
| R2.5 opens Thoth → Skills, pre-filtered | COMPLETE | `app-state.service.ts:602-607`; consumed once at `skill-synthesis-tab.component.ts` ctor effect; passed down as `input()` to `:409` |
| R2.6 no unreachable destination in VS Code | COMPLETE | inert `<p>` in the `@else` (`harness-target-row.component.ts:138-149`), gated by `canOpenDivergedClones` ← `isElectron()` (`harness-health-badge.component.ts:211`, reactive because `VSCodeService.isElectron` reads `_config()`) |
| R3.1 edit affordance seeded with the current body | PARTIAL | seeds from `body()` without checking it belongs to the selected clone (Serious 1) |
| R3.2 one new RPC writes under `~/.ptah/user` | COMPLETE | five registration sites present: `rpc-skill-clone.types.ts`, `rpc.types.ts:1744` + `:3597`, `METHODS` `:266`, `rpc-surface.spec.ts:151` |
| R3.3 cancel writes nothing | COMPLETE | `cancelled` carries no payload; `cancelEditingBody` emits nothing (`clone-detail-drawer.component.ts:522-529`) |
| R3.4 re-read detail, `historyCount` +1 | COMPLETE | `skill-clones-state.service.ts:129-136`; the snapshot is what raises the count |
| R3.5 invalid slug / kind / body rejected, no write | COMPLETE | `skills-synthesis-rpc.schema.ts:414-418` reusing `SlugSchema` `:326-334`; parsed before any `join` |
| R3.6 out-of-layer write refused as an error | COMPLETE | `user-layer-fs-ops.ts:49-63` + the handler's report/rethrow `:1372-1376` |
| R3.7 unknown clone rejected, nothing created | COMPLETE | registry check `:1343-1349` and `written: false` `:1356-1361`; no `mkdir` on the save path |
| R3.8 survives the next reconcile | PARTIAL | holds for a clone with a sidecar; fails on the second reconcile for a sidecar-less clone shadowing an upstream (Serious 2) |
| R3.9 no edit affordance in VS Code | COMPLETE | the whole clones view renders the desktop notice when `!isElectron()` (`skill-clones-view.component.ts:118-127`) |
| NFR Security | COMPLETE | Zod first, `assertUnderUserLayer` second, `toUserError` on the way out |
| NFR Data safety | COMPLETE | snapshot precedes every overwrite, in both variants, in the layout `listHistory` reads |
| NFR Concurrency | COMPLETE | one `withSlugLock` covers save, rebase, keep and every reconcile branch |
| NFR Compatibility | COMPLETE | all five sites; `expected-absent.ts` untouched |

Implicit requirements not addressed: the selected-clone/body coherence guard,
and a client-side floor on the draft length.

## Edge cases

| Case | Handled | How | Concern |
| ---- | ------- | --- | ------- |
| Crafted slug (`../x`, `a/b`, `a\b`) | YES | `SlugSchema` regex + refine, before any `join` | none |
| `kind` outside the enum / non-string body | YES | `SkillCloneKindSchema`, `z.string()` | none |
| Empty body | YES | `.min(1)` rejects | generic error message (Moderate) |
| 1 MiB+ body | YES | `.max(1_048_576)` | none |
| Clone absent from disk | YES | `written: false`, nothing created | late, post-typing refusal (Minor) |
| Sidecar absent | YES | no sidecar minted, body still written | second reconcile can still eat it (Serious 2) |
| Save during a boot reconcile | YES | queues on `withSlugLock` | none |
| Save during a bulk rebase | YES | `actionsLocked()` disables the drawer and its Edit button | none |
| Double-submit of Save | YES | both editor buttons disabled while `saving()` | none |
| Save fails | YES | edit mode and draft survive (`submittedBody` never matches) | none |
| Clone switched mid-edit | YES | `editing` is a `linkedSignal` keyed on `clone` | re-entering edit in the load window is not (Serious 1) |
| Batch where entry 2 throws and entry 3 soft-fails | YES | all attempted, three outcomes, both slugs named | none |
| `orphaned: undefined` | YES | `!== true` includes it | none |
| Deep link consumed twice | YES | single consumer in the tab; the view takes a plain `input()` | none |
| Deep-link flag surviving a workspace switch | YES | standalone signal at `app-state.service.ts:280`, absent from `ViewSlice` and from `switchWorkspace` | none |
| Diverged filter left on with an empty set | YES | dedicated empty copy | none |

## Verdict

- Recommendation: REVISE
- Confidence: HIGH on the backend write path and the batch runner (read in full,
  cross-checked against the reconcile and reap paths); MEDIUM on R3.8, because
  no test exercises save-then-reconcile yet and batch 5 has not run.
- Top risk: the drawer can enter edit mode holding the previously selected
  clone's body, so one fast click sequence writes the wrong content into the
  right file and reports success.
- What a robust implementation would add: `!detailLoading()` in
  `canEditSelectedBody`; a disabled Save on an empty or unchanged draft with the
  reason stated; a dirty-aware `draft` that does not silently re-seed from a
  background reload; `canEditCloneBody` actually using its `clone` argument to
  exclude orphaned entries; and batch 5 asserting R3.8 twice — the sidecar-ful
  case that survives and the sidecar-less case that does not — so the limit is
  recorded instead of assumed away.
