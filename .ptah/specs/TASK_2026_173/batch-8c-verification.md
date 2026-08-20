# Batch 8C Verification — Task 8.7 (D2 hunk stage/revert write path)

**TASK_2026_173** · `senior-tester` · 2026-08-10
**Scope**: verification only. No product code changed. Nothing committed, nothing staged, nothing
touched in the index.

**Headline verdict: FIT TO COMMIT, except one named exit criterion is not met.** Every guard
protecting the index/working tree from unrecoverable corruption is proven against real git
2.54.0.windows.1, including the two offset guards 8A disclosed as "believed unreachable" — I
constructed real-git scenarios that reach **both**, which resolves that open question in the
guards' favor (they fire correctly and protect). One non-blocking hardening gap found and explained
below. The dispatch's own named exit criterion **"`git:applyHunks` exercised end-to-end in
Electron"** is **NOT satisfied** — I attempted it, judged it infeasible within a reasonable budget
given no existing driver skill for this repo's Electron app, and stopped rather than burn the
session on GUI automation setup. That is stated plainly per the dispatch's own rule: a criterion you
could not test is not a criterion that passed.

---

## 0. Correcting the record I inherited

8B's report opens with a claim that a `git stash` at 22:08:26 swept 8A's and 8B's work into
`stash@{0}`. I was told before starting this pass that this was independently checked and found
false, and I re-verified it myself at the start of this pass:

- `git stash list` shows exactly one entry: `stash@{0}: On ak/quick-fix-discord: vertical marketing
video` — four unrelated marketing files, predating this session.
- Every file both 8A and 8B report creating/modifying was present, unstaged, on disk: `git-info.service.apply-hunks.spec.ts`
  (new, untracked), `git-info.service.ts`, `git-rpc.handlers.ts`, `git-rpc.schema.ts`, `rpc.types.ts`,
  `rpc-git.types.ts` (8A); `diff-view.component.ts`, `editor-diff-split.ts`, `editor-tab.types.ts`,
  `editor-panel.component.ts`, `editor.service.ts` and their specs (8B).
- I never ran `git stash pop` or any stash operation. It was not necessary.

I mention this only because it means the rest of this report treats both prior reports as accurate
about their own content, but starts from the tree, not from either report's narrative about the tree.

**One file is dirty that belongs to neither pass**: `libs/backend/rpc-handlers/src/lib/handlers/workspace-rpc.handlers.ts`
and its spec. This is a concurrent session's edit, not Batch 8's. I did not open it, did not assess
it, and it plays no part in anything below (NFR-9).

---

## 1. What I verified myself, and how

### 1.1 Suites re-run from a clean invocation (not accepted on either report's word)

| Project                                                                       | Suites                        | Tests                            | Notes                                                                                                                         |
| ----------------------------------------------------------------------------- | ----------------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `@ptah-extension/vscode-core`                                                 | 21/21                         | **342/342**                      | matches 8A                                                                                                                    |
| `@ptah-extension/editor`                                                      | 16/16                         | **337/337**                      | matches 8B                                                                                                                    |
| `@ptah-extension/shared`                                                      | 30/30                         | **690/690**                      | matches 8A                                                                                                                    |
| `rpc-handlers`, isolated `git-rpc.handlers.spec.ts` + `rpc-allowlist.spec.ts` | 2/2                           | **55/55**                        | matches 8A's isolated 50/50 + the allowlist's 5/5                                                                             |
| `rpc-handlers`, full project                                                  | 73/74                         | 1741/1773 (1 failed, 31 skipped) | see §4 — the one failure is `chat-session-resume-activate.spec.ts`, unrelated to git, a different failure than the one 8A saw |
| `ptah-electron`, full project                                                 | 13/14 (1 skipped, not failed) | 145/149 (4 skipped, 0 failed)    | now green; 8A's compile failure from a concurrent `agent-sdk` edit has since resolved                                         |

`nx typecheck` for `shared`, `vscode-core`, `rpc-handlers`, `editor` — **all green**.
`nx lint --max-warnings=-1` for `editor` — **0 errors, 14 warnings, none in a Batch 8 file** (this
closes 8B's disclosed gap §7.1: lint had never been run on this pass's code).

### 1.2 Independent spot-check of the highest-stakes guard (AC6 staleness)

Rather than accept 8A's mutation table on its word, I reproduced their guard-1 mutation myself:
changed `if (before.snapshotToken !== request.snapshotToken)` to
`if (false && before.snapshotToken !== request.snapshotToken)` in `git-info.service.ts:953`, ran
`git-info.service.apply-hunks.spec.ts`.

**Result: 2 of 28 failed — an exact match to 8A's reported count.** Restored via a pre-mutation
backup, confirmed clean with `grep` for the mutation string, re-ran: **28/28 green.**

One extra thing this spot-check surfaced: the second failing test ("refuses the shifted-offset
case") did **not** fall back to `success: true` once staleness was disabled — it still failed, but
with `APPLY_FAILED` in place of the expected `STALE_SNAPSHOT`. That is the first sign the offset
guard was doing real work independently of the staleness check, which §2 confirms directly.

---

## 2. The finding that matters most: both "unreachable" offset guards ARE reachable

8A's report (§7.2) disclosed, explicitly and in good faith, that it could not construct a real-git
scenario where either offset guard fires, and gave the structural reason: `applyHunks` always
re-derives its patch from a **fresh** `diffFile` call, so a stale **client** patch never reaches
git. Its exact words to me: _"do not assume I mutated them wrong — I believe they are currently
unreachable, and if you can reach one, that is a finding about the design, not the test."_

**I reached both.** The reachable window is not a stale client patch — it is a TOCTOU race
**internal to a single `applyHunks` call**, between the moment it freshly re-reads the diff (`before
= await this.diffFile(...)`, `git-info.service.ts:943`) and the moment it actually invokes
`--check`/the real apply a few lines later. Nothing in the current design closes that window; it is
milliseconds wide but real, on any filesystem shared with another process (another Ptah window, a
background hook, a concurrent `git add`).

### Guard 2 — pre-write offset refusal (`checkOffsets`, `git-info.service.ts:1080-1094`)

Scratch repo, real git 2.54.0: commit a 60-line file, edit line 30, read the diff (token `T`,
single hunk). Called `applyHunks(stage, hunkIndices:[0], snapshotToken: T)` with the service's
private `execGit` seam intercepted: the instant it saw the `--check` invocation, I staged (via
`git add`, outside the service) a version of the index shifted five lines down — same context,
relocated. Let the intercepted call proceed normally after that.

**Result:**

```
{"success":false,"code":"APPLY_FAILED","message":"The selected changes no longer line up with this
file. Nothing was changed."}
```

which is the exact string at `git-info.service.ts:1090-1093` (the offset-refusal branch), not the
generic `--check`-failed message at `:1067-1070`. The logged evidence confirms it precisely:

```
"[GitInfoService] applyHunks refused an offset match"
offsets: [5]
stderr: "Checking patch f.txt...\nHunk #1 succeeded at 32 (offset 5 lines).\n"
```

This is real `git apply --check --verbose` output reporting a genuine 5-line offset — exactly the
catastrophic shape (silent line-shift) this batch exists to prevent — and the guard refused it
before any write.

### Guard 3 — post-write offset rollback (`appliedOffsets`, `git-info.service.ts:1131-1155`)

Same setup, but I let `--check` run first against the **unshifted** index (so it reports offset 0
and passes both guards it would otherwise trip), then sabotaged the index the same way immediately
afterward, before the **real** `git apply --cached -` ran.

**Result:**

```
{"success":false,"code":"APPLY_FAILED","message":"The selected changes no longer line up with this
file. The previous state was restored."}
```

Log:

```
"[GitInfoService] applyHunks rolled back an offset apply"
offsets: [5]
stderr: "...Hunk #1 succeeded at 32 (offset 5 lines).\nApplied patch f.txt cleanly.\n"
restored: true
```

and `git diff --cached` on the scratch repo was **empty afterward** — the `read-tree` rollback
restored the index to its pre-operation tree, which also erased my sabotage (a stronger guarantee
than guard 2 gives — see §3).

**Disposition: this is a positive finding, not a blocker.** Both guards are real, not dead code;
they fire on genuine `git apply --check --verbose` offset reports against real git, and in both
cases the guard's own hunk selection is never applied. 8A's disclosed uncertainty is resolved: the
guards are reachable via an internal race, not via a stale client patch, and they work as designed
when reached.

Probe scripts (`zzz-offset-probe.spec.ts`, `zzz-offset-probe-b.spec.ts`) were scratch files under
`libs/backend/vscode-core/src/services/`, run, and **deleted** — confirmed absent by directory
listing.

---

## 3. A minor, non-blocking asymmetry the above surfaced

I also tried the same sabotage for a `revert` (working-tree, non-`--cached`) operation. Guard 2
fired identically (`APPLY_FAILED`, "Nothing was changed"), but this time I inspected the **physical
file on disk** afterward: it retained my sabotage content (5 extra lines), not the original bytes
the user was looking at when they clicked Revert, even though `worktreeRestoreBytes` had already
been captured earlier in the function specifically to make a restore possible.

Tracing why: the guard-2 branch (`git-info.service.ts:1081-1094`) returns a failure directly without
calling `restoreAfterFailedApply`, on the reasoning that `--check` is a dry run and nothing needed
undoing. That reasoning holds for the service's **own** writes — it never touches the file in this
branch — but it does not hold for a **concurrent external write that lands in this exact window**,
which the guard now provably can observe (§2). Guard 3's branch, by contrast, unconditionally calls
`restoreAfterFailedApply`, and that call's `git read-tree` / bytes-rewrite also erases any concurrent
sabotage as a side effect — a stronger guarantee than guard 2 gives, for what is otherwise the same
class of message ("nothing changed" / "state was restored").

**Why I am not calling this a blocker:** in every reproduction, the tool never writes the user's
selected hunk when this fires, and the leftover content is exactly what an external actor wrote —
identical to what would be on disk if `applyHunks` had never been called at all. The tool adds no
new corruption; it simply does not proactively clean up someone else's concurrent write, and its
"Nothing was changed" message is accurate about its **own** actions if not about the file's absolute
state. The fix is cheap (call `restoreAfterFailedApply` in the guard-2 branch too, using the restore
point already captured) and closes the asymmetry with guard 3. **Recommended for the Batch 9
register, not a condition of this commit.**

---

## 4. Ruling on guard 7 — does the `--check` dry run earn its place?

8A disclosed removing `--check` entirely fails 0 of 28 tests, and asked me to rule on whether a
reviewer's "this is redundant" is fair.

**It is not redundant; it earns its place, but not for final-state correctness.** §2/§3 show guard 3
(the post-apply offset rollback) is a comprehensive backstop: whatever `--check` would have caught,
the real apply's own offset check catches too, after the fact. That is consistent with 8A's 0/28
result. What `--check` actually buys, and what the tests don't measure, is the **size of the window
during which a real filesystem or index write exists in a transiently wrong state**:

- For `revert` (no `--cached`), the real apply writes straight to the **physical working-tree file**.
  Without `--check`, an offset-shifted apply would briefly leave the wrong content on disk before the
  rollback restores it — a window visible to a concurrently open editor or file watcher.
- For `stage`/`unstage`, the equivalent window is a transient **index** write, which is exactly what
  Electron's `.git/index` watcher (dispatch §2.5) exists to observe and push as `git:status-update`.

`--check` eliminates this window for the (large) majority of failures that are non-offset — those
never touch the file/index at all with `--check` in place, versus a write-then-rollback without it.
**Recommendation: retain.** This is defense-in-depth against exactly the class of hazard (transient,
externally-observable bad state) this whole batch is scoped around, even though it is not load-bearing
for the tests' final assertions.

Probe (`zzz-offset-probe-c.spec.ts`) run and **deleted**.

---

## 5. Client-side AC6 binding — reached via a REAL `git:status-update` push, not `setTab`

8B's handover asked me to try reaching the client-side AC6 binding "from a real host, where a
genuine `git:status-update` — not a `setTab` — does the renumbering." I could not get to a real
host (§7), but I could exercise the actual production entry point for that push,
`EditorDiffSplitHelper.onGitStatusUpdate`, rather than 8B's own tests' direct state mutation.

Wrote a scratch spec (`zzz-client-ac6-probe.spec.ts`): opened a diff (token `T0`, hunk at line 1),
called `helper.onGitStatusUpdate('/ws')` — the real push handler — backed by a mocked RPC response
carrying a new token `T1` and a renumbered `hunks` array, advanced the 250ms debounce, then called
`helper.applyHunks(...)` with the **stale** `T0` captured "at the moment of choice."

**First run was vacuous** — it passed, but for the wrong reason: I had hand-typed the tab key as
`'worktree:a.ts'` instead of the real format `diffTabKey('worktree', 'a.ts')` → `'diff:worktree:a.ts'`,
so the lookup missed and the test was silently exercising the "no tab" early-return, not the token
check. I caught this by printing the intermediate result rather than trusting the green light,
fixed the key, and reran.

With the key fixed:

- **Guard disabled** (`if (diff.snapshotToken === '' || ...)` → `if (false)`): the probe now
  **fails** — the code proceeds to the real RPC call, which my mock has no queued response for, and
  throws exactly where the coordinator reads `call.success`. Non-vacuous confirmed.
- **Guard restored**: the probe **passes** — `STALE_SNAPSHOT`, and `mockRpcCall`'s call log after
  the attempt contains **no `git:applyHunks` entry at all** (only the `git:diffFile` re-read the
  guard triggers). The write path is never entered, exactly as 8B's docstring at
  `editor-diff-split.ts:290-304` claims.

This closes 8B's specific request: the client-side binding is proven against the real push path, not
only against a hand-set tab record. `zzz-client-ac6-probe.spec.ts` was **deleted** after the run;
`editor-diff-split.ts` was restored from a pre-mutation backup and reconfirmed clean (`grep` for the
mutation string returns nothing) and green (337/337 on the full suite, §1.1).

---

## 6. AC6 reuse of `computeSnapshotToken` — confirmed, both sides

Read `git-info.service.ts:1444-1470` directly: **one implementation**, called from exactly two sites,
both inside `diffFile` (success and both-sides-failed branches). `applyHunks` (`:943-951`) does not
recompute a digest alongside `diffFile` — it **calls `diffFile` itself** and compares the token it
returns, so there is structurally no second implementation that could drift.

On the frontend: `editor-diff-split.ts` never re-derives the token (it is passed through as an opaque
string), and `GitDiffFileResult.patch` is deliberately not mirrored onto `DiffTabState` — confirmed by
reading `toDiffState` (`:592-`) and the type (`editor-tab.types.ts`), which carries `snapshotToken`
but no `patch` field. The apply result's own returned `snapshotToken` is explicitly discarded in favour
of a fresh `refreshDiffTab` read (`editor-diff-split.ts:300-304`, `:350-355`), which is the correct
call: a written token paired with content the tab record does not yet hold would reproduce exactly the
pairing defect 8A's own digest fix (D-1) closed.

**AC6: SATISFIED**, on both the server's single-implementation guarantee and the client's opaque
pass-through.

---

## 7. `hunkLineRange`'s clamp against real git output (8B's flagged item)

8B asserted the arithmetic in `hunkLineRange` (`diff-view.component.ts:94-103`) but not git's actual
output shape for the `@@ -1,3 +0,0 @@` case its comment cites. Verified against real git
2.54.0.windows.1 in a scratch repo:

- Deleting the first 3 of 10 lines (context remains below): `@@ -1,6 +1,3 @@` — **not** `c=0`, because
  `-U3` keeps trailing context.
- Deleting the entire remaining content of a file down to empty: `@@ -1,3 +0,0 @@` — **exactly** the
  shape the code comment cites, confirming the `c === 0` clamp is exercised by real git, not a
  synthetic-only case.

---

## 8. AC2–AC5, AC7, AC9, AC10, AC12 — status

All verified against real git, either directly by 8A's spec (which I re-ran clean, §1.1) or via my
own independent reproductions above. I did not re-derive every one of 8A's or 8B's individual
mutation-table rows myself; I spot-checked the single highest-stakes one exactly (§1.2), and my own
three new probes (§2, §4, §5) independently exercise the same code paths those rows protect and are
consistent with their claims. Combined with clean, fresh suite runs, I have no reason to doubt the
remaining rows in either table, and no contradiction turned up anywhere I did check by hand.

---

## 9. What I could NOT verify

1. **`git:applyHunks` exercised end-to-end in Electron — NOT satisfied.** This is a named dispatch
   exit criterion (§7). I attempted it: no project skill in `.claude/skills/` covers launching
   `ptah-electron`, and there is no existing Electron GUI driver in this repo (the generic pattern
   requires a Playwright `_electron` REPL under a Linux-style headless setup that does not exist
   here). Building and launching the actual Electron shell from scratch would have consumed the rest
   of this session's budget on driver setup rather than on the write path itself, so I stopped rather
   than gamble the remaining time on it. **This criterion is unmet by all three passes (8A, 8B, 8C).**
   Recommend a follow-up manual or scripted smoke test before or shortly after this ships — but see
   my verdict below for why I do not think it should block the commit given the depth of real-git
   evidence for the actual data-safety guarantees.
2. **NFR-1 cross-project floor still cannot be cleanly established**, for the reason 8A already gave:
   there is no clean pre-Batch-8 baseline to diff against without stashing (forbidden), and HEAD has
   moved under every pass. Current snapshot, for the record: `rpc-handlers` 1741/1773 passing (1
   failure, `chat-session-resume-activate.spec.ts`, demonstrably unrelated to git — a chat-session
   domain test, different from the compile failure 8A saw); `ptah-electron` 145/149 passing, 0
   failures (8A's compile failure has since resolved upstream). Neither number is a like-for-like
   floor comparison; I report them as a snapshot, not a pass/fail on NFR-1.
3. I did not personally re-run every one of 8A's 6 and 8B's 12 mutation-table rows — see §8.
4. Visual/theme rendering of the glyph-margin markers (8B's own disclosed gap) — unchanged, still
   unverified, and out of reach without the Electron host in item 1.

---

## 10. Scratch work — all deleted, confirmed

`zzz-offset-probe.spec.ts`, `zzz-offset-probe-b.spec.ts`, `zzz-offset-probe-c.spec.ts` (all under
`libs/backend/vscode-core/src/services/`), and `zzz-client-ac6-probe.spec.ts`
(`libs/frontend/editor/src/lib/services/editor/`) — written, run, and deleted. Confirmed absent by
directory listing after deletion. Every scratch git repository used was created under the OS temp
directory by the existing spec harness or my own probes and cleaned up by their own `afterAll`
hooks; none touched the workspace repository or its index.

Both product files I mutated for spot-checks (`git-info.service.ts`, `editor-diff-split.ts`) were
restored from pre-mutation backups and reconfirmed byte-clean (`grep` for the mutation string
returns nothing) and green on their full suites before I moved on.

`git status --porcelain` at the end of this pass shows exactly the file set 8A and 8B reported
(plus the pre-existing, out-of-scope `workspace-rpc.handlers.*` from a concurrent session, §0) — no
leftover artifact of mine anywhere in the tree.

---

## 11. Verdict

**Fit to commit, except the named Electron end-to-end exit criterion, which is not met.**

Every criterion that touches the actual safety of the user's index and working tree — AC2–AC7, AC9,
AC10, AC12, and both halves of AC6 (server staleness + reuse, client-side selection binding) — is
proven against real git 2.54.0.windows.1 in throwaway repositories, including two guards previously
disclosed as unreachable that I showed **are** reachable and **do** protect correctly. The one
non-blocking finding (§3) is a message-accuracy gap under an adversarial race that never causes the
tool to write wrong content, and I am recommending it for the Batch 9 register rather than blocking
on it.

The unmet criterion — `git:applyHunks` run end-to-end in a real host — is a real gap against the
dispatch's own exit list, not something I am willing to wave through as "covered" by the extensive
jsdom/real-git coverage above; that coverage proves data-safety, not that the UI actually wires a
click through to the RPC correctly in a running app. I am stating this plainly rather than softening
it, per the dispatch's own rule that an untested criterion is not a passed one. Whether that gap
should hold the commit is `team-leader`'s call, not mine — but the honest state of the evidence is:
every corruption-risk guard is proven; the UI's live wiring is not.
