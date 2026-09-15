# Code Logic Review — `TASK_2026_437_0778` (PR #518 CI fix)

## Summary

| Metric              | Value    |
| ------------------- | -------- |
| Overall score       | 9/10     |
| Assessment          | APPROVED |
| Blocking issues     | 0        |
| Serious issues      | 0        |
| Moderate issues     | 1        |
| Failure modes found | 0        |

Scope: two uncommitted changes in `D:\projects\ptah-437` — (1) `content-manifest.json`
hash/timestamp regeneration, (2) a `NOSONAR` suppression + justification comment on the
`new Function(` call in `apps/ptah-electron-e2e/src/support/ui-driver.ts:126`. No test
execution or git writes performed, per instructions; verification used `npm run
manifest:check` and a single-file `eslint` run, both read-only.

## Five logic questions

### 1. How does this fail silently?

Not applicable to this diff's own logic — both changes are inert data/comment changes.
The one place silent failure could hide is if `content-manifest.json` were regenerated
from a _different_ tree than what's committed (stale generator output silently drifting
from source). Checked: `npm run manifest:check` (`scripts/generate-content-manifest.js
--check`) recomputes the hash from disk and reports "up to date (sha256:22dcc5c7...,
224 files)" — matching the working tree's `content-manifest.json:5` exactly. No drift.

### 2. What user action produces unexpected behaviour?

None from this diff. The `NOSONAR` comment and reasoning comment are non-executable.
The manifest change only affects `contentHash`/`generatedAt` (`content-manifest.json:5-6`),
not `baseUrl`, plugin paths, or the 224-file listing — confirmed via `git diff --stat`
showing 4 lines changed (2 added / 2 removed) in an 8-line-changed header only.

### 3. What input data produces a wrong answer?

Traced the `new Function` resolver source at `ui-driver.ts:126-129`. `source` comes from
`g.__uiMockFns[method]`, populated only by `UiDriver.mockRpc()` (`ui-driver.ts:186-216`),
which is called only from `apps/ptah-electron-e2e/src/specs/**/*.spec.ts` (66 call sites,
grep-confirmed, all under the e2e spec tree). A representative string-resolver call
(`tile-open-longtask-budget.perf.spec.ts:386`) embeds `JSON.stringify(...)` of an in-memory
fixture object into a template literal authored in the spec file itself — not user input,
not network input, not anything read from disk at runtime. The suppression's factual claim
("only e2e specs in this repo populate `__uiMockFns`, and only e2e runs this file") holds
for the code as written; nothing outside `apps/ptah-electron-e2e` references
`__uiMockFns`.

### 4. What happens when a dependency fails?

N/A — no new dependency interaction introduced by either change.

### 5. What is missing that the requirements never mentioned?

The review brief asked whether the memoization key can leak across tests. It cannot, on
the current wiring: `__uiCompiledFns` lives on the Electron main process's `globalThis`
(`ui-driver.ts:76`), and `electronApp` in `fixtures.ts:42-49` launches a fresh
`ElectronApplication` per test (default Playwright fixture scope) and closes it in a
`finally`, which tears down that process — and its `globalThis` — with it. The comment at
`ui-driver.ts:71-75` states this correctly and flags the one condition that would break it
(a future spec reusing one page/app across multiple tests). That is an honest forward-looking
caveat, not a current gap — nothing in this PR introduces worker-scoped or session-scoped
Electron app reuse.

## Failure modes

None found in the two changes under review. Scope reviewed: the full diff (`git diff`
against the worktree), the commit that triggered the manifest regeneration (`0e4867b0c`),
manifest generator behaviour (via `--check`), and every `mockRpc(` call site path (via
grep) to confirm the trust boundary claim in the new comment.

## Blocking issues

None.

## Serious issues

None.

## Moderate and minor issues

### NOSONAR reason comment duplicates the block comment above it (Minor)

- File: `apps/ptah-electron-e2e/src/support/ui-driver.ts:118-126`
- The six-line block comment immediately above (`:118-125`) and the trailing
  `// NOSONAR typescript:S1523 — ...` on `:126` both explain the same trust boundary in
  different words. Not a defect — the trailing comment is what SonarQube's suppression
  mechanism requires to be _on the flagged line_, and the block comment is what a reader
  scrolling past actually reads first — but a future edit to one has no compiler-enforced
  link to the other, so they can drift apart (e.g. someone loosens the trust boundary in
  the block comment and forgets the one-liner still promises "never user or network
  input"). Low cost given this file's low change frequency; worth a single shared comment
  if this pattern is copied elsewhere.

## Data flow

1. `mockRpc()` call in an e2e spec (e.g. `tile-open-longtask-budget.perf.spec.ts:386`) —
   OK, string is a literal template authored in the spec.
2. `UiDriver.mockRpc` — OK, string values routed to `__uiMockFns[method]`
   (`ui-driver.ts:191-192`), non-string values routed to `__uiMockStatics`
   (`ui-driver.ts:193-194`); mutually exclusive via the `delete` calls on the other map
   (`ui-driver.ts:207,211`), so a method can't be simultaneously static and dynamic.
3. Inbound `'rpc'` IPC message from the renderer — OK, `method` extracted defensively with
   an early return when absent (`ui-driver.ts:83,107`).
4. `fns[method]` lookup and `__uiCompiledFns` cache check — OK, keyed by source text so
   distinct fixture payloads (different `JSON.stringify` output) never collide with each
   other; identical source text producing the same behaviour is not a collision, it's a
   correct cache hit.
5. `new Function('params', ...)` compile-once-per-source-text — OK for the stated purpose
   (amortizing `new Function` parse cost for large literals across many calls to the same
   registered resolver, per the Batch-22-cited perf finding); the boundary claim in the
   suppression comment is verified true by the caller-path grep in Q3 above.
6. `content-manifest.json` regeneration — OK, driven by the real content change in
   `jsonrpc.md` from commit `0e4867b0c` (verified via `git show 0e4867b0c --
.../jsonrpc.md`, a table-reformat + `session.history` params/result docs correction),
   not by any file outside that commit; `git status` in the worktree shows no other dirty
   files that could have contaminated the recomputed hash; `manifest:check` independently
   recomputes and confirms the committed hash matches the 224-file tree.

## Requirements fulfilment

| Requirement                                                              | Status   | Gap                                                                                                                                                          |
| ------------------------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Manifest regenerated from committed content, not a stray dirty file      | COMPLETE | None — `git status` shows only the two files under review; hash independently reproduced by `manifest:check`                                                 |
| `generatedAt` churn acceptable by repo convention                        | COMPLETE | `git log -p -- content-manifest.json` shows every prior content-affecting commit re-stamps `generatedAt` the same way (e.g. `befeecbe6`, `7e60f005e`)        |
| NOSONAR on the exact line Sonar flags                                    | COMPLETE | Comment is trailing on the `new Function(` statement itself (`ui-driver.ts:126`), the line S1523 flags, even though the call's arguments span two more lines |
| Justification is true — only spec-authored source reaches `new Function` | COMPLETE | All 66 `mockRpc(` call sites are under `apps/ptah-electron-e2e/src/specs/**`; `__uiMockFns` has no writer outside `ui-driver.ts` itself                      |
| Memoization key cannot leak across tests                                 | COMPLETE | `__uiCompiledFns` lives on the per-test Electron process's `globalThis`; `fixtures.ts:42-49` launches and closes one `ElectronApplication` per test          |

Implicit requirements not addressed: none identified beyond the moderate note above.

## Edge cases

| Case                                                                                              | Handled                 | How                                                                | Concern                                                                |
| ------------------------------------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| Manifest hash recomputed against a dirty unrelated file                                           | N/A (not present)       | `git status` clean apart from the two reviewed files               | None — verified, not just assumed                                      |
| Two specs registering the same method with different resolver source                              | YES                     | Cache keyed by source text, not method name (`ui-driver.ts:116`)   | None                                                                   |
| Electron app reused across multiple tests in future (breaks the "harmless today" premise)         | Documented, not handled | Comment at `ui-driver.ts:73-75` flags it explicitly as future work | Acceptable — correctly scoped as out of bounds for this fix            |
| Sonar re-flagging if the `new Function(` call is reformatted onto multiple lines by a future edit | Not handled             | NOSONAR is line-bound by design (Sonar mechanism)                  | Minor — inherent to the suppression mechanism, not a defect in this PR |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: none material; the one moderate note (duplicated reasoning between the block
  comment and the trailing NOSONAR reason) is a documentation-drift risk, not a logic
  defect.
- What a robust implementation would add: nothing required for this CI fix; if this
  suppression pattern recurs elsewhere, consider a single shared comment block instead of
  restating the trust-boundary justification twice.
