# Batch 8A Report — Tasks 8.1–8.4 (D2 backend write path)

**TASK_2026_173** · `backend-developer` · 2026-08-10
**Scope executed**: 8.1, 8.2, 8.3, 8.4. **8.5–8.7 not started.** **Nothing committed, nothing staged.**

**Headline**: the write path is implemented and verified against real git 2.54.0.windows.1 in throwaway
repositories (28 new tests, all green). Five of seven §4 guards are proven able to fail with recorded
counts. **One guard's test was found vacuous and was repaired**; **two guards remain unproven and are
disclosed in §7** — the `--check` dry run and both offset guards, because the always-regenerate design
makes the hazard they target structurally unreachable.

---

## 1. Files created / modified

All unstaged. No `git add`, no commit, no workspace-index mutation of any kind (`git diff --cached`
is empty; the only staged content in this repo is none).

| File                                                                                                    | Task          | Change                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `D:\projects\ptah-extension\libs\shared\src\lib\types\rpc\rpc-git.types.ts`                             | 8.1, 8.2      | `GitHunkRef`; `patch` + `hunks` on `GitDiffFileResult`; `GitApplyHunksOperation` / `Params` / `Failure` / `Result`                                                            |
| `D:\projects\ptah-extension\libs\shared\src\lib\types\rpc.types.ts`                                     | 8.2           | `git:applyHunks` in `RpcMethodRegistry` + `RPC_METHOD_PRESENCE` + the git type import block                                                                                   |
| `D:\projects\ptah-extension\libs\backend\vscode-core\src\services\git-info.service.ts`                  | 8.1, 8.3, 8.4 | `readPatch`, `splitPatch`, `parseHunkRefs`, `applyHunks` + 5 private helpers; `computeSnapshotToken` gains a patch field; `WorktreeFileAccess` / `ApplyHunksRequest` exported |
| `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\handlers\git-rpc.schema.ts`               | 8.2           | `GitApplyHunksOperationSchema`, `GitApplyHunksParamsSchema`, `parseGitApplyHunksParams`                                                                                       |
| `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\handlers\git-rpc.handlers.ts`             | 8.2           | `git:applyHunks` in `METHODS` + `register()` + `registerGitApplyHunks()`; `diffFileFailure` gains `patch: null, hunks: []`                                                    |
| `D:\projects\ptah-extension\libs\backend\vscode-core\src\services\git-info.service.apply-hunks.spec.ts` | **NEW**       | 28 real-git tests                                                                                                                                                             |
| `D:\projects\ptah-extension\libs\backend\vscode-core\src\services\git-info.service.spec.ts`             | 8.1           | one spawn-count assertion 2 → 3 (the added patch read)                                                                                                                        |
| `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\handlers\git-rpc.handlers.spec.ts`        | 8.2           | `METHODS` count 17 → 18; `git:applyHunks` presence test; 13 handler-boundary tests; mock gains `applyHunks` + `patch`/`hunks`                                                 |

Nothing under `libs/frontend/**` was touched. `editor-panel.component.ts` was never opened.

---

## 2. The V-4 disposition (dispatch §3), stated explicitly

**Task 8.1's second touch of `GitDiffFileResult` is deliberate, pre-dispositioned risk V-4 / Open
Question #3 — it is not scope drift.**

- The addition is **additive and non-breaking**: `patch` and `hunks` are new required fields on a
  result the backend always constructs. Every existing consumer compiles and behaves unchanged.
  `nx typecheck` is green for `shared`, `vscode-core`, `rpc-handlers` **and** `editor`.
- **SEQ-1 constrains the tab-key scheme, not this interface.** The tab-key scheme was changed exactly
  once, in Batch 2 pass 2B, and this pass does not touch it.
- It was scoped into Batch 8 on purpose so the keystone batch stayed tight rather than carrying D2
  fields it could not test.

**Reviewer: this does not need relitigating.**

---

## 3. What the code actually does

### 8.1 — patch + hunks

`diffFile` now runs `git diff [--cached] -U3 --no-color --no-ext-diff -- <pathspec>` **after** both
blob reads, and returns the output verbatim as `patch` plus one `GitHunkRef` per `@@` header. `null`
when git emitted nothing (untracked file, unchanged path, failed invocation).

**Finding that changed the implementation — staged renames must be asked for by BOTH paths.**
Against real git, `git diff --cached -- new.txt` for a staged rename loses the rename pairing and
emits `new file mode` with **every line an addition**. That is the A3 "fabricated whole-file
addition" hazard arriving through the patch instead of through a failed read — staging from it would
stage content whose real pre-image was never read. `readPatch` therefore passes both pathspecs when
`originalPath !== path`. Covered by a test that asserts `rename from old.txt` is present and
`new file mode` is absent.

### 8.3 — operation matrix and reassembly

git generates the patch, git consumes the patch. No diff text is constructed anywhere; the selected
`@@` blocks are copied byte for byte. No `--recount`, no `--unidiff-zero`, no line-ending code.

| comparison | operation | invocation                          |
| ---------- | --------- | ----------------------------------- |
| `worktree` | `stage`   | `git apply --cached --verbose -`    |
| `worktree` | `revert`  | `git apply -R --verbose -`          |
| `staged`   | `unstage` | `git apply --cached -R --verbose -` |

The matrix is enforced in `GitInfoService.applyHunks`, **before** the schema-valid payload reaches
git and independently of the snapshot check, so a caller reaching the service directly cannot route
around it.

**Finding that would have shipped a broken patch — the newline trap.** Splitting the patch on `\n`
and re-joining drops the terminator of every hunk block except the last. Selecting a middle hunk then
produces `error: corrupt patch at <stdin>:13`. Reproduced against real git before `splitPatch` was
written; the helper keeps each segment's `\n` so any subset concatenates into a well-formed patch,
and normalises a missing final newline (safe — "no final newline" is carried by the
`\ No newline at end of file` marker, not by the stream's own termination).

Confirmed against real git, and therefore deliberately **not** worked around: later hunks' `+`-side
start lines are stale after a partial apply, and `git apply` resolves them by context exactly as
`git add -p` does. Selecting hunks 0 and 2 of a 3-hunk file with insertions applied cleanly.

### 8.4 — staleness, atomicity, forensics

Order is: `validatePathSegment(path)` → `validatePathSegment(originalPath)` → operation matrix →
`isGitRepo` → **fresh snapshot** → binary/hunkless → selection normalisation → single-file-block
guard → rollback point → `--check --verbose` → offset refusal → real apply → post-apply offset
rollback → new token → forensic log.

**On reuse of `computeSnapshotToken` (dispatch §2.6).** There is still exactly **one** hashing
implementation, with exactly **two** call sites, both inside `diffFile`. `applyHunks` does not
recompute the digest alongside `diffFile` — it **calls `diffFile` itself** and compares the token it
returns. That is a stronger form of the reuse §2.6 demands: there is no second code path that could
drift, because there is no second code path. The token is never cached; two calls a millisecond
apart re-read git both times (Risk A-5).

Forensic log (`logger.info`, R-1): `workspaceRoot`, `path`, `originalPath`, `comparison`,
`operation`, `hunkIndices`, `hunkCount`, `snapshotToken`, `nextSnapshotToken`, `patchSha256`,
`patchByteLength`, `exitCode`, `offsets`, `stderr`. Raw stderr and absolute paths appear only in the
log; every RPC reply carries a closed code plus a sanitized sentence (NFR-8), asserted by tests that
check the message contains neither `..` nor the repository path.

---

## 4. Deviations from the 12-step algorithm — declared, not smuggled

**D-1 — `computeSnapshotToken` gains a length-prefixed `patch` field.** The 12 steps do not mention
it. Without it the token certifies blobs read at T while the patch was generated at T+δ, and a write
landing in that gap is certified as "the snapshot the user saw". With it, token match implies both
sides _and_ the patch bytes are identical. One implementation, both call sites changed together, so
the §2.6 drift hazard does not apply. Proven load-bearing by mutation 2 below.

**D-2 — the revert rollback is an in-memory `Buffer`, not a temp file** (step 8). A temp file only
beats memory if the process dies mid-apply, in which case no restore code runs either way. Memory
removes temp-file leaks, permissions, and cross-device rename. Restores exact bytes; proven by the
CRLF revert test.

**D-3 — a hunkless non-binary diff returns `APPLY_FAILED`, not `BINARY_UNSUPPORTED`** (step 6, which
conflates them). An untracked file produces no `git diff` output at all; telling the user it is
binary would be a user-visible lie. Binary detection uses the blob outcomes plus the
`Binary files … differ` marker. Both branches are tested.

**D-4 — two offset guards were added** (not in the 12 steps): refusal on a non-zero offset reported by
`--check --verbose` (pre-write), and rollback on a non-zero offset reported by the real apply. See §7
— these are **unproven** and I say so.

**D-5 — `--verbose` on both apply invocations.** Step 12 says "parse `git apply` stderr for `offset`".
Verified against real git: **plain `git apply` prints nothing about offsets; only `--verbose` does.**
Without it the forensic `offsets` field would be empty forever and the instruction would be vacuous.

---

## 5. The §4 mutation table — every guard broken on purpose, watched, restored

Method per §4: mutate the **product file**, run the suite, record which tests fail and how many,
revert, re-run, confirm green, confirm `git status --porcelain` clean. Baseline for every row:
**28/28 passing**.

| #   | Guard                                               | Mutation applied                                                                                   | Failure                                                                                                                                                     | Count               | Restored             |
| --- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | -------------------- |
| 1   | **Snapshot staleness refusal (AC6)**                | `if (request.snapshotToken !== request.snapshotToken)` — trust the client instead of the recompute | `AC6: refuses a diff that moved…` + `AC6: refuses the shifted-offset case…`                                                                                 | **2 of 27**         | ✅ 27/27, then 28/28 |
| 2   | **Token covers everything it must (AC6, Risk A-5)** | dropped the `patch` field from `computeSnapshotToken`                                              | `AC6: the token is bound to the patch bytes…`                                                                                                               | **1 of 27**         | ✅                   |
| 3   | **Atomic rollback (AC7)**                           | replaced `restoreAfterFailedApply(...)` with `const restored = true`                               | `AC7: restores the index when the real apply fails after --check passed` — tree `3f8609a1…` expected, `4693a3c0…` received                                  | **1 of 27**         | ✅                   |
| 4   | **`INVALID_OPERATION` matrix (AC12)**               | added `'unstage'` to `VALID_OPERATIONS.worktree`                                                   | `AC12: refuses worktree + unstage…`                                                                                                                         | **1 of 27**         | ✅                   |
| 5   | **`BINARY_UNSUPPORTED` (AC10)**                     | `const isBinary = false`                                                                           | `AC10: refuses a real binary file…`                                                                                                                         | **1 of 27**         | ✅                   |
| 6   | **`validatePathSegment` on both paths (NFR-8)**     | deleted `this.validatePathSegment(originalPath)`                                                   | **first attempt: 0 of 27 — VACUOUS.** After repair: `NFR-8: validates originalPath BEFORE anything else` — expected `UNKNOWN`, received `INVALID_OPERATION` | **0, then 1 of 28** | ✅                   |
| 7   | **`--check` dry run (AC7)**                         | replaced the dry run with a hardcoded `exitCode: 0`                                                | **0 of 28 — see §7**                                                                                                                                        | 0                   | ✅                   |

### Guard 6 — a vacuous test, caught and repaired

Deleting `validatePathSegment(originalPath)` from `applyHunks` failed **nothing**. Root cause:
`diffFile` performs the same validation a few lines later, outside its own `try`, so the traversal
still threw and the reply was still `UNKNOWN`. The original test could not distinguish the guard from
its own redundancy — exactly the "reads sensible, catches nothing" pattern the dispatch warns about,
and exactly what Batch 7's regression guard did.

Repaired by pairing a traversal with an operation the matrix rejects: if validation runs **first**
(NFR-8's actual requirement) the answer is `UNKNOWN`; if it does not, the matrix answers
`INVALID_OPERATION` and the traversal is never examined. Re-running the mutation against the repaired
test fails **1 of 28** with the exact predicted symptom. The redundant validation was kept —
defence in depth is fine; an unprovable test was not.

### A correction to my own earlier reading

Under mutation 1 I first recorded that the offset guard had caught the shifted case, because the reply
was `APPLY_FAILED`. **That was wrong and I checked rather than assuming.** Printing the whole result
showed `"git reports no applicable changes for this file."` — the hunkless branch, not the offset
branch. The offset guards did not fire. See §7.

---

## 6. The §5 real-git evidence

**git version 2.54.0.windows.1**, the same build the SEQ-2 verifier used on 2026-08-10.
Every repository created under `%TEMP%`, asserted against, then deleted. **Nothing touched the
workspace repository or its index.** Eight hand-driven probe repos plus every repo the suite creates
(`ptah-hunks-*`, `ptah-nogit-*`) were removed; the `afterAll` hook cleans the suite's own, and I
confirmed by glob that none remain.

`core.autocrlf` is **`true` on this machine**, which is the harder case and is why it is pinned
per-repo in the suite rather than inherited.

Verified in `git-info.service.apply-hunks.spec.ts` (28 tests, all green):

- **AC2** — 3-hunk file, hunk 1 staged: the index carries only `L25-MOD`; `L5-MOD` and `L45-MOD`
  remain in the working tree.
- **AC3** — hunk 0 unstaged: the other two stay staged, the working tree is untouched.
- **AC4** — hunk 2 reverted: the other two survive in the working tree and `git diff --cached` is
  empty — the index was not touched.
- Out-of-order, duplicated selection `[2, 0, 2]` is normalised to ascending order (a hard `git apply`
  requirement) and applies correctly.
- **AC9 byte identity** — for **CRLF under `core.autocrlf=true`**, **no trailing newline**, and
  **non-ASCII (accented Latin, CJK, astral-plane emoji)**: two identical repos, one driven through
  `git:applyHunks`, the other through **an independently written reassembly** (lookahead split rather
  than terminator-preserving scan) piped to the `git apply` CLI. `git diff`, `git diff --cached` and
  the raw worktree bytes compared **byte for byte** as `Buffer`s. Equal in all three fixtures.
- **AC9 revert** — reverting every hunk of a CRLF file restores the **exact original bytes**
  (`0d0a` preserved) even though the patch itself is LF-space, and `git diff` is empty. Recorded for
  8C: `git status --porcelain` shows ` M` afterwards because the rewrite is **stat-dirty**; both blob
  SHAs in `--porcelain=v2` are identical. **`git diff` is the authoritative check, not `git status`.**
- **AC6** — file mutated between the `diffFile` read and the apply: `STALE_SNAPSHOT`, no
  `snapshotToken` in the reply, index byte-identical, the sneaked-in edit still present.
- **AC6 shifted offset** — the catastrophic shape reproduced: identical hunk content five lines lower.
  I confirmed by hand that **`git apply --check` returns exit 0 for this and applies cleanly at
  `offset 5 lines`**. The token refuses it; the index never sees `L30-MOD`.
- **AC6 no caching** — read, change the file, read, change it back, read: token differs in the middle
  and returns to the original value. A cached token would have frozen and the test would pass
  vacuously; the middle read is what stops that.
- **AC7 post-check failure** — the index sabotaged between `--check` and the real apply via the
  service's own git seam. Asserted **unconditionally** (an `if (!result.success)` version would pass
  vacuously the moment the sabotage stopped working): `APPLY_FAILED`, message says "restored", and
  `git write-tree` returns the pre-operation tree.
- **AC7 refused patch** — a patch git rejects at `--check` leaves index and worktree byte-identical.
- **AC10** — a real binary file (NUL bytes) yields `BINARY_UNSUPPORTED`, index empty, bytes unchanged.
- **AC12** — all three invalid cells refused with `INVALID_OPERATION` **before** the snapshot check
  (a deliberately bogus token is supplied to prove the ordering); all three valid cells succeed.
- **NFR-8** — traversal in `path` and in `originalPath`; replies carry no `..`, no absolute path.
- Untracked file → "no applicable changes", explicitly **not** reported as binary.
- Out-of-range hunk ordinal → refused, index unchanged.
- Non-repository folder → `NOT_A_REPO`.
- **R-1** — the forensic log asserted field by field, including `patchSha256` matching `^[0-9a-f]{64}$`.

RPC boundary (mocked, correctly — these test the boundary, not git): 13 tests covering delegation,
`originalPath` forwarding, **eight** malformed-payload rejections that never reach git (unknown
operation, unknown comparison, empty selection, negative ordinal, fractional ordinal, empty token,
missing token, empty path), unregistered folder, no workspace, and a thrown rejection mapped to a
sanitized `UNKNOWN` with no `snapshotToken`.

---

## 7. What I could NOT verify — disclosed plainly

1. **The `--check` dry run is unproven.** Removing it entirely fails **0 of 28**. This is honest, not
   a gap I can close by writing a better test: `git apply` is itself all-or-nothing per invocation for
   a single-file patch, so any patch `--check` would reject the real apply also rejects with no write.
   Its real function is to let us inspect offsets **before** writing — which leads directly to (2).
   I kept it. A reviewer is entitled to call it redundant.

2. **Both offset guards are unproven, and I could not construct a real-git scenario in which either
   fires.** With the staleness check disabled _and_ `--verbose` stripped from both invocations, the
   shifted-offset test still refused — with `"git reports no applicable changes for this file."`
   **The reason is structural: the patch is always regenerated server-side from the current state, so
   a stale patch is never the thing that gets applied.** The offset hazard is designed out rather than
   guarded. I kept both guards as canaries for the day someone caches the patch, and I am explicitly
   **not** claiming them as verified. **8C: do not assume I mutated them wrong — I believe they are
   currently unreachable, and if you can reach one, that is a finding about the design, not the test.**

3. **Nothing ran in a real Electron or VS Code host.** `git:applyHunks` has not been exercised
   end-to-end (dispatch exit criterion). It cannot be, yet: there is no frontend caller until 8B.

4. **Neither half of the NFR-1 floor can currently be established.** `ptah-electron` and, as of the
   last re-run, `rpc-handlers` are both red from concurrent out-of-scope edits in `agent-sdk` /
   `cli-agent-runtime` — see §8. My own suites are green in isolation.

5. **`applyHunks` inherits the service's existing assumption that `workspacePath` is the repository
   top level.** Every other method already assumes this (`readBlob` uses root-relative `rev:path`;
   `readWorktreeBlob` joins `workspacePath + path`). If a user opens a _subdirectory_ of a repo,
   `git diff` emits root-relative paths while `git apply` resolves them relative to cwd, so the apply
   **fails safely** — it cannot corrupt. I did **not** fix this: it originates outside this task's
   scope (NFR-9, file-not-fix). **Recommended for the Batch 9 register.**

6. **The `libs/frontend` spec helper is silently under-typed.**
   `editor-diff-split.spec.ts:76` `makeResult()` declares a return type of `GitDiffFileResult` but now
   omits `patch` and `hunks`. It does **not** fail: `tsconfig.lib.json` excludes `**/*.spec.ts` from
   `typecheck`, and `tsconfig.spec.json` sets `isolatedModules: true`, so ts-jest transpiles without
   checking. All 279 editor tests pass. **8B must add `patch: null, hunks: []` to that helper**, or
   every hunk-rendering test will silently receive `undefined`. I did not touch it — `libs/frontend`
   is off-limits to this pass.

---

## 8. Standing-gate figures

| Project        | Tests                              | Suites  | Note                                                                          |
| -------------- | ---------------------------------- | ------- | ----------------------------------------------------------------------------- |
| `shared`       | **690 passed / 690**               | 30 / 30 | type-level change only                                                        |
| `vscode-core`  | **342 passed / 342**               | 21 / 21 | was 314; **+28** (the new real-git spec)                                      |
| `rpc-handlers` | **1732 passed, 31 skipped / 1763** | 74 / 74 | was 1718 passed; **+14**. Measured at 20:5x; see the late-breaking note below |
| `editor`       | 279 passed / 279                   | 16 / 16 | read-only check; unchanged                                                    |

### Late-breaking: `rpc-handlers` went red from an out-of-scope edit, after my gates were green

Two commits from the concurrent session landed mid-pass — `6dc68c03b` and `6c9c1a1ba`, exactly the
moving `HEAD` dispatch §1.1 predicts. A re-run afterwards shows `rpc-handlers` at **7 failed suites /
1608 passed**, down from 74/74.

**All seven fail for one identical, out-of-scope reason:**

```
libs/backend/cli-agent-runtime/src/lib/ptah-cli/helpers/ptah-cli-spawn-options.service.ts:86:7
  error TS2353: 'authEnv' does not exist in type 'AssembleSystemPromptInput'.
```

`AssembleSystemPromptInput` lives in `agent-sdk`, whose files are **dirty in the working tree** from
that session; the committed `cli-agent-runtime` consumer no longer matches them. This pass touches
neither lib. Per NFR-9 I **reported it and did not fix it**.

Casualties include **`rpc-allowlist.spec.ts`**, which is a named exit criterion. Its 5/5 green result
above was captured before this edit landed and is valid for my change; it currently cannot compile for
a reason unrelated to `git:applyHunks`. Verified after the breakage:

- `git-rpc.handlers.spec.ts` in isolation — **50 / 50 green**
- `vscode-core` full suite — **342 / 342 green**, 21 / 21 suites

**Team-leader: this is a branch-level blocker for the batch's standing gates, not a Batch 8 defect.**
`rpc-allowlist.spec.ts` must be re-run green before the single commit lands.

- `nx typecheck` — **green** for `shared`, `vscode-core`, `rpc-handlers`, `editor`.
- `nx lint` — **0 errors** across all three touched projects. The one warning in a file I touched
  (`git-info.service.ts:1863`, forbidden non-null assertion) is **pre-existing**, inside `getRemotes`,
  and only moved line number because of my additions. Not fixed (NFR-9).
- `rpc-allowlist.spec.ts` — **5/5 green**. The manifest partition assertion covers `git:applyHunks`
  automatically because the manifest entry references `GitRpcHandlers.METHODS`.
- `'git:'` confirmed already present in `ALLOWED_METHOD_PREFIXES` — **amendment A-2 holds, no change
  needed**.

### NFR-1 cross-project floor — CANNOT BE ESTABLISHED, and the cause is not mine

`ptah-electron`: **118 passed / 118**, but **5 of 14 suites failed to run** with

```
libs/backend/agent-sdk/src/lib/helpers/sdk-query-runner.service.ts:340:28
  error TS2304: Cannot find name 'buildModelIdentityPrompt'.
  error TS2304: Cannot find name 'getActiveProviderId'.
```

That file is **dirty in the working tree** (` M`) from the concurrent session the dispatch warns about
in §1.1 — the symbols exist in `sdk-query-options-builder.ts` but are not imported in the runner. It
is an in-flight edit in `agent-sdk`, a lib this pass does not touch and does not depend on. Per NFR-9
I **reported it and did not fix it**. The `ptah-electron` half of the NFR-1 sum cannot be computed
until that session's edit compiles. `rpc-handlers` did not decrease (1718 → 1732).

The working tree also changed substantially during this pass (`apps/ptah-electron/project.json`,
`cli-agent-runtime`, `tribunal-panel`, `vscode-lm-tools` all became dirty mid-session). Expect more.

---

## 9. Citations from dispatch §2 that had drifted again

Most held exactly — `computeSnapshotToken :791-815`, `validatePathSegment :852-863`,
`parseFileStatus :1372`, `execGitBuffer :1312-1317`, `createHash :9`, `resolveRoot :168-192`,
`isRegisteredFolder :194-201`, `METHODS :91-109` with `'git:diffFile'` at `:101`, the `git:diffFile`
handler's `resolveRoot` at `:509` and sanitized log at `:535`, and every `rpc-git.types.ts` anchor
were **correct to the line**. Four small corrections:

| Anchor                            | Dispatch §2                     | Actual (pre-edit)                                                         |
| --------------------------------- | ------------------------------- | ------------------------------------------------------------------------- |
| `git-rpc.schema.ts` params schema | `:18-30`, helper `:32`          | **`:18-23`**, helper **`:31`**                                            |
| `readBlob`                        | `:503-550`                      | method opens at **`:498`** (`:503` is its first statement)                |
| `exec-git.ts`                     | path not given                  | **`libs/backend/vscode-core/src/utils/exec-git.ts`**, not `src/services/` |
| `ALLOWED_METHOD_PREFIXES`         | `:46` (CLAUDE.md + dispatch §6) | **`:40`**; `'git:'` at **`:67`**                                          |

`git apply -` was confirmed already invocable (N2): `exec-git.ts:144-148` writes then closes stdin.
**`execGit` was not re-hardened.**

---

## 10. Handover

**8B (`frontend-developer`)** — `GitDiffFileResult.hunks` is populated and ordinal-stable; select by
`GitHunkRef.index` and send it straight back in `hunkIndices`. Position affordances by
`modifiedStart` / `modifiedLines` (git's segmentation, authoritative). `hunks` is `[]` for binary and
for untracked files, so "actions absent" falls out for free (AC10). **Add `patch: null, hunks: []` to
`makeResult()` in `editor-diff-split.spec.ts` — see §7.6.** A failure reply never carries
`snapshotToken`; treat its absence as "do not retry with the old token". On success, the returned
`snapshotToken` is the new one — use it, do not re-read to get it.

**8C (`senior-tester`)** — §5's table is yours to extend. Guards 1–6 are broken and restored with
counts above; **guard 7 and the two offset guards are the open ones, and §7.2 is my honest belief that
they are unreachable rather than untested.** Try to reach them. If you can, that is a design finding.
The `execGitSeam` helper in the new spec is the hook for interleaving events with a specific git
invocation.

**Not committed. `team-leader` owns git. 8.5 not started.**
