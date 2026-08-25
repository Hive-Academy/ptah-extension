# Batch 8 Dispatch — D2 Hunk Stage / Revert

**TASK_2026_173** · dispatched 2026-08-10 · gate commit `c6d2758da`
**This file is the executor's source of truth.** Where it disagrees with `tasks.md` Tasks 8.1–8.7,
**this file wins** — every line number in those task bodies is stale and is corrected in §2.

**Shape**: 7 tasks · three sequential passes · **ONE commit**

| Pass | Executor             | Tasks     | Surface                                             |
| ---- | -------------------- | --------- | --------------------------------------------------- |
| 8A   | `backend-developer`  | 8.1 – 8.4 | `libs/shared`, `vscode-core`, `rpc-handlers`        |
| 8B   | `frontend-developer` | 8.5 – 8.6 | `libs/frontend/editor` (diff view + diff-split svc) |
| 8C   | `senior-tester`      | 8.7       | real-repository proof                               |

**Do not commit between passes.** A half-landed write path is worse than none: 8A without 8B ships
an unreachable `git:applyHunks`; 8B without 8C ships an unproven one. One commit lands after 8C.

---

## 0. READ THIS BEFORE WRITING A LINE

**This batch derives a patch from the diff on screen and applies it to the user's git index or
working tree.**

- The **index** holds work the user is about to commit.
- The **working tree** holds work that may exist **nowhere else** — not in a commit, not on a
  remote, not in a stash.
- **Corruption here is not recoverable by undo.** There is no Ctrl+Z for `git apply --cached`
  against the wrong pre-image, and no reflog entry for a worktree file overwritten by `git apply -R`.

This is the only batch in TASK_2026_173 that writes to the user's repository at all. Batches 0–7
read git, render git, and measure git. This one mutates it.

Treat every guard on the write path as load-bearing, and see §4: **you must prove each one can
fail.**

### The gate that let this batch start

Batch 8 was blocked on **SEQ-2** — Batch 2's A1–A4 criteria independently verified, not merely
implemented. **That gate is now SATISFIED** (`seq-2-verification.md`, A1–A4 all verified against the
current tree). It was **failed first and closed second**: the first pass returned NOT SATISFIED on
A2 AC5 as unproven, and it was closed by tracing `openTabs` rather than by asserting it.

**What the cleared gate means**: the diff you derive patches from is trustworthy — the comparison is
the one the user selected, a failed git read is not rendered as "new file, all additions", and the
tab is not showing an arbitrarily old snapshot.

**What it does not mean**: it does not make a bad patch recoverable. The four failure modes in the
SEQ-2 block of `tasks.md` describe why the gate existed. They are still the reasons this code is
dangerous.

---

## 1. Standing constraints (non-negotiable)

1. **Another session is working TASK_2026_177 on this branch and commits mid-flight.** It did so
   **three times during Batch 7**, and twice more during the SEQ-2 commit itself (`457c8880d`,
   `265f134d9` landed while the pre-commit hook ran). Expect `HEAD` to move under you.
2. **Never `git add -A`, never `git add .`, never `git commit -a`.** Stage the explicit file list,
   whole files only, by path.
3. **The index may already hold that session's staged work.** Do not `git reset`, do not `git stash`,
   do not `git checkout --`. If you find staged content you did not create, **leave it and report it**.
4. **`--no-verify` is forbidden.** If the pre-commit hook fails, **stop and report**. Note the hook
   runs a full electron `validate-deps` build and **takes well over two minutes** — budget for it and
   do not mistake a timeout for a failure.
5. **NFR-9 scope discipline.** Work confined to the file list in §2. A failure originating outside
   this task's scope is **reported and the batch stopped**, never fixed opportunistically.
6. **Out of scope, already filed, do not fix here**: `closeSplit`'s `stopPropagation`
   (`editor-panel.component.ts:724`, Batch 9 item 7), the empty-state `role="list"` violation
   (`source-control-panel.component.ts:143`, `:203`, Batch 9 item 5), the `(focusin)` split-pane
   focus gap (Batch 9 item 6), the two inaccessible modals (`editor-panel.component.ts:469`, `:502`,
   Batch 9 item 11). All four sit within arm's reach of where you will work. **File-not-fix binds.**
7. **CLI agent delegation is DISABLED** (user decision, Checkpoint 0.1, `tasks.md:7`). Every executor
   is a sub-agent.

---

## 2. CORRECTED CITATIONS — every line number in Tasks 8.1–8.7 is stale

`editor-panel.component.ts` was rewritten by Batches 4, 6 **and** 7; `editor-diff-split.ts` by
Batch 7; `diff-view.component.ts` by Batch 6. Backend files moved too — `git-info.service.ts` grew
`readBlob`, `diffFile` and `computeSnapshotToken` in Batch 2, displacing everything below them by
~400 lines.

**Five batches running have each found drift. Assume more.** Re-verify every anchor below against the
tree before you edit; if one has moved again, correct it in your report rather than editing blind.

### 2.1 Backend — `libs/backend/vscode-core/src/services/git-info.service.ts`

| What                    | `tasks.md` says | **Current tree** | Note                                                                        |
| ----------------------- | --------------- | ---------------- | --------------------------------------------------------------------------- |
| `validatePathSegment`   | `:450-461`      | **`:852-863`**   | Task 8.4 step 1. Private; call sites `:443`, `:503`, `:582`, `:583`, `:844` |
| `readBlob`              | `:498-550`      | **`:503-550`**   | Classification ladder; unchanged since July                                 |
| `diffFile`              | `:574-629`      | **`:574-684`**   | Body extends past the cited end into the catch                              |
| `computeSnapshotToken`  | not cited       | **`:791-815`**   | **See §2.6 — the most important anchor in this batch**                      |
| `parseFileStatus`       | `:988-1010`     | **`:1372`**      | N3 `origPath`, landed Batch 2                                               |
| `execGitBuffer` wrapper | not cited       | **`:1312-1317`** | Private wrapper over the util                                               |
| `createHash` import     | —               | `:9`             | Already imported; do not re-import                                          |

### 2.2 Backend — `libs/backend/rpc-handlers/src/lib/handlers/git-rpc.handlers.ts`

| What                       | `tasks.md` says | **Current tree**                        |
| -------------------------- | --------------- | --------------------------------------- |
| `resolveRoot` (Task 8.4/2) | `:162-186`      | **`:168-192`** (doc `:168-176`)         |
| `isRegisteredFolder`       | not cited       | **`:194-201`**                          |
| `METHODS` tuple            | not cited       | **`:91-109`** (`'git:diffFile'` `:101`) |
| `git:diffFile` handler     | not cited       | **`:482-549`** — copy its shape         |

`git:applyHunks` goes in the `METHODS` tuple at `:91-109` and gets a handler modelled on the
`git:diffFile` block at `:482-549` (note its `resolveRoot` call at `:509` and its sanitized reject
log at `:535`).

### 2.3 Backend — schema, types, exec

| What                                         | **Current tree**                                                                    |
| -------------------------------------------- | ----------------------------------------------------------------------------------- |
| `git-rpc.schema.ts` — comparison enum        | `:16`                                                                               |
| `git-rpc.schema.ts` — params schema          | `:18-30`, parse helper `:32`                                                        |
| `rpc-git.types.ts` — `GitReadErrorCode`      | `:235`                                                                              |
| `rpc-git.types.ts` — `DiffSideRef`           | `:259`                                                                              |
| `rpc-git.types.ts` — `GitDiffFileParams`     | `:273`                                                                              |
| `rpc-git.types.ts` — **`GitDiffFileResult`** | **`:282-296`** (`originalRef` `:288`, `modifiedRef` `:289`, `snapshotToken` `:295`) |
| `exec-git.ts` — `ExecGitOptions.stdin`       | `:28-35`                                                                            |
| `exec-git.ts` — stdin write/close            | **`:136-147`**                                                                      |

**`git apply -` is already invocable.** N2 landed in Batch 2: `stdin` is written then closed at
`:145`, and closed immediately at `:147` when absent. `exec-git.spec.ts:159-181` already proves both
the string and `Buffer` paths. **Do not re-harden `execGit`** — it is done.

### 2.4 Frontend — `libs/frontend/editor/src/lib/diff-view/diff-view.component.ts` (Task 8.5)

| What                                                | **Current tree**                                           |
| --------------------------------------------------- | ---------------------------------------------------------- |
| `DIFF_LAYOUT_SETTING_KEY`                           | `:46`                                                      |
| **Diff header bar** (layout toggle, `aria-pressed`) | **`:147-157`** — the roving-tabindex hunk list mounts here |
| Error overlay (`data-testid="diff-error-overlay"`)  | `:203-231`                                                 |
| Binary branch                                       | `:232`                                                     |
| `diffTab` input                                     | `:267`                                                     |
| `monacoApi` field                                   | `:299`                                                     |
| `isBinary` computed                                 | `:364`                                                     |
| `gitError` / `gitErrorDetail`                       | `:407` / `:413`                                            |
| `createEditor`                                      | `:494`                                                     |
| **`readOnly: true`**                                | **`:506`**                                                 |
| **`renderMarginRevertIcon: false`**                 | **`:510`**                                                 |
| Layout toggle handler                               | `:720-730`                                                 |

**`readOnly: true` (`:506`) and `renderMarginRevertIcon: false` (`:510`) STAY. The modified pane
never becomes writable.** That is what makes D2 AC11 structurally true instead of a promise, and it
is the reason Monaco's own revert arrow is disabled — it edits a Monaco buffer, not git. Batch 3
carries an explicit comment at `:502-505` saying these are permanent. Leave it.

### 2.5 Frontend — `editor-diff-split.ts` (Task 8.6) and the watcher

| What                                        | `tasks.md` says | **Current tree** |
| ------------------------------------------- | --------------- | ---------------- |
| `openDiff`                                  | `:23-96`        | **`:96`**        |
| `refreshAllDiffTabs`                        | not cited       | **`:197`**       |
| `refreshDiffTab`                            | not cited       | **`:213`**       |
| `requestDiff` (the one RPC call site)       | not cited       | **`:472`**       |
| `toDiffState`                               | not cited       | **`:492`**       |
| `applyFreshDiff`                            | not cited       | **`:580`**       |
| `patchDiff`                                 | not cited       | **`:602`**       |
| `git-watcher.service.ts` `.git/index` watch | `:151-153`      | **`:167-169`**   |

**Post-apply refresh (AC8) already exists — reuse it, do not build a second one.**
`refreshDiffTab` (`:213`) is the batch-2 revalidation path, `patchDiff` (`:602`) is the
non-flickering field patch, and the `.git/index` watcher at `:167-169` already pushes
`git:status-update` on every index write. Electron gets refresh for free; VS Code and CLI have no
watcher, so **refresh explicitly on the RPC response in all hosts** and let the watcher push be
idempotent (`refreshDiffTab` already bails on an in-flight key).

### 2.6 ⚠️ The anchor that matters most — `computeSnapshotToken` at `:791-815`

Task 8.4 step 4 says "recompute the snapshot **exactly as `git:diffFile` does**". There is a private
method that does exactly this, and it is not cited anywhere in `tasks.md`:

- `computeSnapshotToken` — **`git-info.service.ts:791-815`**
- Called by `diffFile` at **`:639`** (success) and **`:673`** (both-sides-failed)
- sha256 over **length-prefixed** fields: `comparison`, `originalPath`, `path`, both
  `describeRef(...)`, both `describeBlob(...)` — length-prefixing exists so no rearrangement of
  paths or content can collide

**Call this method. Do not reimplement the hash.** A second implementation that drifts by one field
makes every staleness check pass when it should fail — which is **AC6, the single most important
criterion in D2**, silently defeated. Reuse is not a style preference here; it is the correctness
mechanism. Likewise **Risk A-5: do not cache the token.** A cached token defeats AC6 entirely.

---

## 3. Task 8.1 is a DELIBERATE second touch of `GitDiffFileResult` — not scope drift

Task 8.1 adds `patch: string | null` and `hunks: GitHunkRef[]` to `GitDiffFileResult`
(`rpc-git.types.ts:282-296`), which Batch 2 already touched.

**This is risk V-4 / Open Question #3, adopted deliberately and recorded in advance.**

- The addition is **additive and non-breaking** — every existing consumer of `GitDiffFileResult`
  compiles and behaves unchanged.
- **SEQ-1 constrains the _tab-key scheme_, not this interface.** The tab-key scheme was changed
  exactly once, in Batch 2 pass 2B, and this batch does not touch it.
- It was scoped here on purpose, to keep the keystone batch tight rather than to smuggle D2 fields
  into a batch that could not test them.

**Reviewer: do not flag this as scope drift.** It is `tasks.md` risk **V-4**, dispositioned before
Batch 2 was written. Executor: say so plainly in your report so the point does not need relitigating.

---

## 4. Non-vacuous proof is the standard — break it, watch it fail, restore it

**A guard that reads as sensible and catches nothing is worse than no guard**, because it converts an
unprotected path into one everybody believes is protected.

**This task has already produced exactly that.** Batch 7's permanent regression guard proved a
property of `CodeEditorComponent` in isolation, hand-wired, and never touched
`editor-panel.component.ts` — where the binding a future engineer would actually change lives. The
reviewer reintroduced the literal hazard at the real site and the shipped suite stayed **259/259
green**. It was caught and fixed in-batch, and the fixed guards fail **exactly 2 of 262** under the
reintroduced hazard.

The method that caught it is the standard for this batch. It has now worked twice more: Batch 7's
second round, and the SEQ-2 verifier's **five** mutation probes (`seq-2-verification.md` §"Non-vacuity").

### The required procedure, per guard

1. Write the guard and its test.
2. **Reintroduce the exact hazard the guard exists to stop** — as a temporary edit to the product
   file, not to a hand-rolled harness.
3. **Run the suite. Confirm it fails, and confirm _which_ tests fail and how many.** "Something went
   red" is not evidence; a guard that fails the whole suite is as uninformative as one that fails
   none.
4. Revert. Re-run. Confirm green.
5. **`git status --porcelain` on every touched product file — confirm clean.**
6. Record all of it in the report: the mutation, the failure message, the count, the restore.

### Guards on the write path that MUST each be proven able to fail (8C owns this)

| #   | Guard                                   | Hazard to reintroduce                                   | Criterion |
| --- | --------------------------------------- | ------------------------------------------------------- | --------- |
| 1   | **Snapshot staleness refusal**          | Accept the client's `snapshotToken` without recomputing | **AC6**   |
| 2   | **Server-side recompute**               | Cache the token instead of recomputing (Risk A-5)       | **AC6**   |
| 3   | **Atomic rollback**                     | Skip the `--check` dry run / skip the temp-file restore | **AC7**   |
| 4   | **`INVALID_OPERATION` matrix**          | Allow `unstage` on a `worktree` comparison              | AC12      |
| 5   | **`BINARY_UNSUPPORTED`**                | Let a binary patch through to `git apply`               | AC10      |
| 6   | **`validatePathSegment` on both paths** | Drop the `originalPath` validation                      | NFR-8     |
| 7   | **Modified pane stays read-only**       | Set `readOnly: false` at `diff-view.component.ts:506`   | **AC11**  |

**Guard 1 is the one to be most suspicious of.** A staleness check that recomputes the token from
the same cached inputs the client sent will pass its own test and protect nothing. Prove it fails by
mutating the file **between** the diff read and the apply — which is what the real hazard is.

---

## 5. Real git required — jsdom and mocked git are NOT evidence here

**Batch 7 shipped with "nothing was verified in a running app" as a disclosed gap.** That was
tolerable there: it was a content-mirroring change, and the disclosure was honest. **It is not
tolerable for a patch-apply write path.**

`tasks.md` Task 8.7 is already explicit — _"Mocked git is NOT acceptable evidence for a claim of
byte-identity"_ — and it is the primary mitigation for **R-1, severity 9, the highest in the
register**. This dispatch extends that from 8.7 to the whole batch.

**Scratch repositories with the real `git` CLI are cheap, and the method is already proven in this
task.** `r3-triage.md` ran a 15-row matrix against real git on 2026-08-03, and the SEQ-2 verifier ran
three more live scratch-repo checks on 2026-08-10 against the identical `git 2.54.0.windows.1` —
staged rename `origPath` resolution, unstaged deletion, and the empty-tracked-file case. Create,
assert, delete. **No scratch work touches the shared index or the workspace repo.**

### Minimum real-git coverage for 8C

- **AC9 byte-identity** — for each of **CRLF**, **no trailing newline**, **non-ASCII content**:
  apply via `git:applyHunks`, apply the same selection via the CLI equivalent, and compare
  `git diff` / `git diff --cached` output **byte for byte**.
- **AC2 / AC3 / AC4** — "only that hunk moved": a multi-hunk file, one hunk selected, assert the
  others are untouched in both the index and the worktree.
- **AC6** — mutate the file **between** the `git:diffFile` read and the apply; assert
  `STALE_SNAPSHOT` and that **nothing was written**.
- **AC7 atomicity** — force an apply failure after `--check` passes; assert the repository is in its
  **exact pre-operation state**, index and worktree both.
- **AC10** — a real binary file yields `BINARY_UNSUPPORTED` and no write.

**Report what you could not verify.** If something genuinely cannot be exercised, disclose it the way
Batch 7 and the SEQ-2 verifier did — plainly, in its own section. **Do not rely on that permission
for the write path itself**; §4 and §5 are the bar for anything that mutates the repository.

---

## 6. Per-pass instructions

### Pass 8A — `backend-developer`, Tasks 8.1–8.4

Read `tasks.md` Batch 8, then **override every line number with §2**. Then:

- **8.1** — `patch`/`hunks` onto `GitDiffFileResult` (`rpc-git.types.ts:282-296`) + population in
  `diffFile` (`git-info.service.ts:574-684`). **Read §3 first** and state the V-4 disposition in your
  report.
- **8.2** — `git:applyHunks` contract + Zod. **One method with an `operation` discriminant, not
  three.** Register in `RpcMethodRegistry` **and** `RPC_METHOD_PRESENCE` **and** the `METHODS` tuple
  (`git-rpc.handlers.ts:91-109`). Per amendment A-2, `'git:'` is already allowlisted — the gates that
  can fail are `RPC_METHOD_PRESENCE` (compile error) and `METHODS` (`rpc-allowlist.spec.ts:43`).
  Amendment A-1: **no `platform-core` port**, and never `git-watcher.service.ts`.
- **8.3** — the operation matrix. **git generates the patch, git consumes the patch; the frontend
  never constructs diff text.** Do **not** recompute hunk headers, do **not** pass `--recount` or
  `--unidiff-zero`, write **no** line-ending code of your own.
- **8.4** — staleness, atomicity, forensics. **Reuse `computeSnapshotToken` (`:791-815`) — see
  §2.6.** `validatePathSegment` is at **`:852-863`**; call it on `path` **and** `originalPath`.
  `resolveRoot` is at **`:168-192`**. Raw stderr and absolute paths go to `logger.error` and nowhere
  else. Parse `git apply` stderr for `offset` and log it.

Every guard you write, note which §4 row it corresponds to. **8C will try to break each one.**

### Pass 8B — `frontend-developer`, Tasks 8.5–8.6

- **8.5** — glyph-margin decorations + overlay widget. **No view zones** (they shift line numbers),
  **no model edits**. Position by git's `@@ -a,b +c,d @@` modified-side ranges, **not** Monaco's
  change regions — the two segment differently and **git's segmentation is authoritative**.
  `readOnly: true` (`:506`) and `renderMarginRevertIcon: false` (`:510`) **stay**.
  AC14 keyboard reachability: roving-tabindex hunk list in the **diff header bar at `:147-157`**,
  driven by the same `hunks` array, so keyboard users never reach for the margin.
  Binary (`isBinary`, `:364`) → actions **absent**, not present-and-broken.
- **8.6** — **revert requires a confirmation modal, never a single unconfirmed click** (AC5). Model
  it on Batch 7's save-conflict dialog, which is `role="alertdialog"` + `aria-modal`, focus-trapped,
  focus-restoring, and axe-clean — **not** on the two older modals at `:469`/`:502`, which are the
  inaccessible ones filed as Batch 9 item 11. Post-apply refresh: reuse `refreshDiffTab` (`:213`),
  see §2.5.

### Pass 8C — `senior-tester`, Task 8.7

You own **§4 and §5**. Your deliverable is not "tests exist" — it is:

1. Real-repository byte-identity proof per §5, and
2. **Every guard in §4's table shown able to fail**, with the mutation, the failure, the count, and
   the restore recorded.

A guard you cannot break is a finding. **Report it as one** — do not assume you mutated it wrong.

---

## 7. Exit criteria

- D2 **AC1–AC14**, weighted per `tasks.md` Batch 8 Acceptance Criteria
- **AC6** proven by mutation-between-read-and-apply against a **real** repo
- **AC7** proven by a forced post-`--check` failure leaving the repo byte-identical
- **AC9** byte-identity vs the CLI on CRLF / no-trailing-newline / non-ASCII, **real temp repos**
- Every §4 guard shown able to fail, with counts
- `git:applyHunks` exercised **end-to-end in Electron**; registry + presence + `METHODS`;
  `rpc-allowlist.spec.ts` green
- Every hunk operation logged well enough to reconstruct what was applied (**R-1**)
- Standing gates 1–7 (`tasks.md:74-92`). NFR-1 cross-project floor: `ptah-electron` +
  `rpc-handlers` passed **must never decrease**
- **ONE commit for all seven tasks**, staged by explicit path (§1)

---

## 8. Report back

Do **not** commit. `team-leader` owns git. Return:

1. Files created/modified, absolute paths
2. **The V-4 disposition** (§3), stated explicitly
3. **The §4 mutation table** — guard, mutation, failure message, failing-test count, restore confirmed
4. **The §5 real-git evidence** — which repos, which git version, which criteria
5. **Anything you could not verify**, disclosed plainly in its own section
6. Any citation in §2 that had drifted **again** since this dispatch was written
7. Standing-gate figures, with the NFR-1 cross-project sum
