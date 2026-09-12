# Test Report - TASK_2026_426_8d43 (Batch 5)

## Scope

- User request: manage stuck diverged clones and edit a clone body from inside
  the app, instead of hand-editing files under `~/.ptah/user`.
- Criteria tested:
  - **R3.8** (`task-description.md:174-175`) — "When the write succeeds, the
    clone's sidecar bookkeeping shall leave the clone in a state the next
    reconcile does not revert: the saved body shall still be present in
    `~/.ptah/user` after a subsequent `HarnessReconcilerService` run."
    Proved end to end, save → moved upstream → reconcile, for all three clone
    kinds. **Conditional — see the boundary below.**
  - **R1.4** (`task-description.md:108-109`) — "When one clone in the batch
    fails, the system shall continue with the remainder and report a per-clone
    outcome; the batch shall not abort on the first failure, and the failed slug
    shall be named in the reported result." Proved at the user-visible level.
  - Supporting, from `implementation-plan.md` component 4's sidecar table: a
    save writes `currentContentHash` and leaves `sourceHash`, `diverged`,
    `pendingSourceHash` and `lastEnhancedAt` byte-identical.
  - Supporting, R3.7: a save against an absent clone creates nothing.
- Regressions covered: the defect the whole task was raised for — a reconciler
  reverting a user's edit at every application start. `saveCloneBody` writing
  `sourceHash` would arm the fast-forward branch
  (`user-layer-mirror.service.ts:1260` dir / `:1321` file); the new suite fails
  if anyone reintroduces that.
- Review findings covered: the `code-logic-review.md` finding that R3.8 does NOT
  hold for a sidecar-less clone. **Measured and confirmed**; pinned as two
  explicitly-titled `KNOWN LIMITATION` cases rather than reported as green.
- Deliberately not tested:
  - The pre-existing `agent-generation` timeout flakiness — out of scope per the
    batch brief; measured and characterised below, not fixed.
  - The sidecar-less reconciler rule itself — a pre-existing reconciler
    behaviour the task explicitly does not alter
    (`task-description.md:81-83`). Pinned as-is, not corrected.
  - `CloneBulkRebaseService` at the service level — already fully covered by
    batch 3's `clone-bulk-rebase.service.spec.ts` (all four of my brief's
    bullets are asserted there: 3-of-3 attempted at `:120`, per-clone outcomes
    at `:121-132`, both failures named at `:133`, `running` cleared after a
    synchronous throw at `:149-160`). Per `batches.md:939` — "extend rather than
    duplicate" — I extended the view level instead of re-spelling it.

## Suites

### `saveCloneBody + reconcile (R3.8)` — integration (real temporary filesystem)

- Requirement: R3.8, plus the component-4 sidecar contract.
- File: `D:/projects/ptah-extension/.claude-worktrees/skills-tab-clone-management-681582aee5c4/libs/backend/agent-generation/src/lib/services/user-layer/user-layer-save-reconcile.spec.ts`
  (new sibling spec; `user-layer-reconcile.spec.ts` is 543 lines and its
  `describe` owns reconcile-only fixtures, so a new file kept each test's IO
  small — the stated hazard mitigation.)
- Cases, 7:
  1. `skill` (directory kind) — save, move upstream, reconcile: body survives,
     `diverged: 1`, `fastForwarded: 0`, `pendingSourceHash` set, and the save's
     snapshot is returned by `listHistory` with `hasSkillMd: true`.
  2. `skill` sidecar contract — the four frozen fields compared as one JSON
     string before and after the save; `currentContentHash` changed and equals
     `computeSourceHash(cloneDir)`.
  3. `command` (flat-file kind) — same save/move/reconcile proof, plus
     `listHistory` reading the *other* snapshot layout
     (`<root>/.history/<slug>/<ts>/`).
  4. `agent` (flat-file kind, workspace-keyed root) — same proof plus the flat
     sidecar's four frozen fields.
  5. Boundary — a save against a clone that is not on disk returns
     `{ written: false, reason: 'clone-missing' }` and creates no directory.
  6. **`KNOWN LIMITATION — skill with NO sidecar`** — reconcile twice; asserts
     the mint on pass 1 and the fast-forward on pass 2.
  7. **`KNOWN LIMITATION — command with NO sidecar`** — the same for the
     separate flat-file mint function.
- **Anti-trivial-pass guard.** Every save/reconcile case routes its upstream
  edit through a `moveUpstream()` helper that recomputes the source hash and
  returns whether it actually differs from the sidecar's recorded `sourceHash`;
  each case asserts that flag is `true`. Without it, a fixture that failed to
  move the upstream would take `reconcile`'s `noop` branch, never reach the
  fast-forward decision, and pass for the wrong reason. Cases 1 and 3 also
  assert `noop: 0` directly.
- Timeout: `jest.setTimeout(30_000)` at file scope, per the inherited hazard.
  Measured runtime is ~2.4 s for the whole file, so the budget is headroom, not
  a crutch.

### `SkillClonesViewComponent — bulk rebase` — component integration (extended)

- Requirement: R1.4 reaching the user, and R1.7's release of the lock.
- File: `D:/projects/ptah-extension/.claude-worktrees/skills-tab-clone-management-681582aee5c4/libs/frontend/skill-synthesis-ui/src/lib/components/clones/skill-clones-view.component.spec.ts`
- Batch 4 already pinned a failure in the MIDDLE and at the END of a batch
  (`:683`). Two genuine gaps remained, and are what I added:
  1. `a failure on the FIRST entry does not abort the batch` — alpha throws,
     beta and delta still get called (asserted by nth-call), the toast reads
     `Rebased 2 of 3` and names `alpha`, `refreshClones` called exactly once
     after the batch.
  2. `releases the lock after a batch in which an entry threw` — every member
     rejects; afterwards `clones-bulk-rebase-btn` and `clones-refresh` are both
     re-enabled. Had `running` not cleared in its `finally`, the surface would
     be disabled until the tab was rebuilt — a failure mode no existing case
     covered, because batch 4's lock test resolves its promise successfully.

## Execution

All commands run from the worktree root.

- `npx jest --config jest.config.ts --verbose user-layer-save-reconcile`
  (in `libs/backend/agent-generation`) — **run twice**:
  - Run 1: `Tests: 7 passed, 7 total` — `Time: 2.362 s`
  - Run 2: `Tests: 7 passed, 7 total` — `Time: 2.371 s`
- `npx jest --config jest.config.ts skill-clones-view -t "bulk rebase"`
  (in `libs/frontend/skill-synthesis-ui`) — **run twice**:
  - Run 1: `Tests: 32 skipped, 9 passed, 41 total` — `Time: 9.727 s`
  - Run 2: `Tests: 32 skipped, 9 passed, 41 total` — `Time: 6.429 s`
  - 9 = batch 4's 7 plus my 2.
- `npx nx test @ptah-extension/agent-generation --skip-nx-cache` (project alone,
  twice): `Test Suites: 32 passed, 32 total` / `Tests: 977 passed, 977 total`
  both times. Baseline was 31 suites / 970 tests; the delta is exactly my file.
- `npx nx run-many -t typecheck -p @ptah-extension/agent-generation @ptah-extension/skill-synthesis-ui --skip-nx-cache`
  — `Running target typecheck for 2 projects` → `Successfully ran target typecheck for 2 projects`.
- `npx eslint <the two spec files>` — no output, 0 problems.
- **Batch verification command**, `npx nx run-many -t test -p @ptah-extension/shared @ptah-extension/rpc-handlers @ptah-extension/agent-generation @ptah-extension/core @ptah-extension/marketplace @ptah-extension/skill-synthesis-ui --skip-nx-cache`
  — header read `Running target test for 6 projects:` and listed all six, both
  times.
  - **Attempt 1 — FAILED, 2 tests:** shared 1375/1375, core 666/666,
    marketplace 241/241, skill-synthesis-ui 403/403, rpc-handlers 2741 passed
    (+31 skipped); `agent-generation` **2 failed / 975 passed of 977**. The two
    were `user-layer-rebase-origins.spec.ts › rebase / keep across every clone
    origin (E7) › a diverged SYNTH skill rebases from <skillsRoot>/<slug>` and
    `user-layer-activation-sequence.spec.ts › user-layer activation sequence
    (TASK_2026_261) › mirrorAll alone leaves skills, commands AND agents frozen
    after an upstream update`. **Neither is a file I authored or edited.**
  - **Attempt 2 — GREEN:** `Successfully ran target test for 6 projects`, with
    `agent-generation` at `977 passed, 977 total`. Same command, same tree.
- Failures: none attributable to this batch. The two above are the pre-existing,
  load-dependent `user-layer-*` timeout flakiness recorded in `batches.md:74-82`
  and `:838-855`. Evidence it is not mine: the same project is 977/977 when run
  alone (twice) and 977/977 on the second parallel run; the two failing suites
  are untouched by every batch of this task; and the team-leader's control run on
  a clean `main` checkout failed *more* tests (12) than this worktree. Test
  defect in the pre-existing suites, not a product defect, and out of scope here.
- Not executed: none.

## The R3.8 boundary — measured, and it confirms the logic review

The logic review's finding is **correct as described**, and I measured it rather
than taking it on trust. Both `KNOWN LIMITATION` cases pass with the assertions
written to match the observed outcome:

- **Sidecar present** — R3.8 holds. The save writes only
  `currentContentHash`, so `liveCloneHash !== sidecar.sourceHash`, the
  fast-forward branch is not reached, and `reconcile` reports
  `diverged: 1, fastForwarded: 0` with the saved body intact on disk.
- **Sidecar absent** — R3.8 does **not** hold, and it takes two reconcile
  passes to lose the edit:
  - Pass 1: `reconcileMissingSidecar`
    (`user-layer-mirror.service.ts:1598-1621`) /
    `reconcileMissingFileSidecar` (`:1869-1896`) mint a sidecar with
    `sourceHash = computeSourceHash(<the clone itself>)` — i.e. the hash of the
    **user's own saved body**, not the upstream's. The body survives this pass
    (`missingSidecar: 1`, `fastForwarded: 0`), and the test asserts
    `minted.sourceHash === computeSourceHash(cloneDir)` so the mechanism is
    pinned, not just its effect.
  - Pass 2: `liveCloneHash === sidecar.sourceHash` is now true, the clone reads
    as unmodified, and the fast-forward branch replaces it. Measured:
    `fastForwarded: 1`, `diverged: 0`, and the file on disk is
    `# v2 upstream` — **the saved body is gone.**

This is a pre-existing reconciler rule and is out of scope for this task per the
brief. It is pinned here so a green suite cannot be read as proof that editing a
sidecar-less clone is safe: both cases carry `KNOWN LIMITATION` in their own
titles, and the file's header comment states the boundary in the first thing a
reader sees.

Worth knowing how reachable it is in practice: a sidecar's absence is the marker
for "user-authored, hands off", and `saveCloneBody` correctly refuses to mint one
(asserted). The loss therefore needs a sidecar-less clone whose **slug shadows a
live upstream source of the same kind** — the reconciler only visits slugs it
finds upstream. That is narrow, but it is exactly the shape a user creates by
deleting a sidecar to stop Ptah managing a clone, which is plausible advice
someone could give themselves.

## Verdict

- Criteria proven:
  - **R3.8, for a clone with a sidecar** — all three kinds (`skill`, `agent`,
    `command`), save → moved upstream → reconcile, body intact and clone marked
    diverged rather than fast-forwarded, with the upstream move itself asserted
    to have happened.
  - The component-4 **sidecar contract** — `currentContentHash` is the only
    field a save changes, on both the directory and the flat-file layout.
  - The save's `.history` snapshot is readable through `listHistory` on **both**
    snapshot layouts.
  - **R3.7's no-create rule** for an absent clone.
  - **R1.4 at the user-visible level** — a failure on the first, a middle and
    the last member of a batch are all survived, every member is attempted, each
    failure is named in the summary toast, `refreshClones` runs exactly once,
    and the lock is released even when every member throws.
- Criteria not proven:
  - **R3.8 for a sidecar-less clone** — proven to be FALSE, by measurement. Not
    a defect introduced by this task; not fixable within its scope. A reader
    should treat R3.8 as holding only for clones that carry a sidecar.
- Risks a reader should know about:
  - The `agent-generation` `user-layer-*` timeout flakiness is real and still
    there. It failed 2 tests on one 6-project parallel run and 0 on the next,
    with the project 977/977 whenever run alone. My new suite has never failed
    (4 clean runs, ~2.4 s) and carries an explicit 30 s budget, but a CI job
    running these six projects in parallel will go red intermittently on
    somebody else's suites. `future-enhancements.md` already owns the fix (an
    explicit `jest.setTimeout` on the existing suites).
  - **Another agent was editing this worktree while I worked.** `git status`
    shows `libs/frontend/skill-synthesis-ui/src/lib/services/skill-clones-state.service.ts`
    and its spec modified, plus ~110 lines added to
    `skill-clones-view.component.spec.ts` above mine — a fix for logic-review
    finding 1 (a cross-clone body edit during a detail load). One of their tests
    was failing mid-flight on my first `skill-synthesis-ui` run and green on the
    next. **Batch 5 itself modified no production file**; the production change
    in `git diff --name-only` is theirs, not mine. Worth confirming before the
    batch is attributed.
