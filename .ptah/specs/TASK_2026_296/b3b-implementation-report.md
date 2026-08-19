# B3b Implementation Report — TASK_2026_296

**Batch**: 3b — the shared blankness primitive + the narrow sweep
**Executor**: `backend-developer`
**Status**: COMPLETE — typecheck 19/19, test 18/18, lint 6/6, all green
**Git**: nothing staged, committed, stashed or reverted. Working tree only.

---

## Verdict headline

The primitive exists and is spec'd for the first time; 22 of the 28 forms 1–4
census sites adopt it; the 6 exclusions are intact and named; zero bare `!x`
guards and zero §0 guards were removed.

---

## 1. Files created

| Path                                                                            | Purpose                                                                        |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `D:\projects\ptah-extension\libs\shared\src\lib\utils\session-id.utils.ts`      | The primitive: `blankToUndefined` + `blankToNull`, one documented trim policy  |
| `D:\projects\ptah-extension\libs\shared\src\lib\utils\session-id.utils.spec.ts` | 14 cases — the first spec coverage this rule has ever had anywhere in the repo |

## 2. Files modified

| Path                                                                                                              | Change                                                                                     |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `D:\projects\ptah-extension\libs\shared\src\lib\utils\index.ts`                                                   | Named export added (`export { blankToUndefined, blankToNull } from './session-id.utils';`) |
| `D:\projects\ptah-extension\libs\backend\cli-agent-runtime\src\lib\ptah-cli\helpers\ptah-cli-registry.utils.ts`   | Rewire #1 — local `blankToUndefined` becomes a one-line re-export of the shared primitive  |
| `D:\projects\ptah-extension\libs\backend\memory-curator\src\lib\memory.store.ts`                                  | Rewire #2 — `sessionIdOrNull` deleted, bind now `blankToNull(insert.sessionId)`            |
| `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\sdk-agent-adapter.ts`                                  | Sweep ×1 (§0 guard, expression only)                                                       |
| `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\session-metadata-store.ts`                             | Sweep ×1                                                                                   |
| `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\session-lifecycle\session-registry.service.ts` | Sweep ×1 (§0 guard, expression only)                                                       |
| `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\session-importer.service.ts`                           | Sweep ×1 (`.filter()` predicate clause)                                                    |
| `D:\projects\ptah-extension\libs\backend\skill-synthesis\src\lib\triggers\skill-trigger.service.ts`               | Sweep ×5 (R12 trim change)                                                                 |
| `D:\projects\ptah-extension\libs\backend\skill-synthesis\src\lib\skill-invocation-recorder.ts`                    | Sweep ×1 (R12 trim change)                                                                 |
| `D:\projects\ptah-extension\libs\backend\skill-synthesis\src\lib\skill-synthesis.service.ts`                      | Sweep ×1 (§0 guard, expression only)                                                       |
| `D:\projects\ptah-extension\libs\backend\memory-curator\src\lib\triggers\memory-trigger.service.ts`               | Sweep ×8 (7 of them R12 trim changes)                                                      |
| `D:\projects\ptah-extension\libs\backend\memory-curator\src\lib\observation-queue.store.ts`                       | Sweep ×1 (§0 guard, expression only)                                                       |
| `D:\projects\ptah-extension\libs\backend\memory-curator\src\lib\memory-curator.service.ts`                        | Sweep ×1 (`coalesceKey`)                                                                   |
| `D:\projects\ptah-extension\libs\backend\vscode-core\src\services\subagent-registry.service.ts`                   | Sweep ×1 (§0 guard, expression only — see §6, tri-state preserved)                         |
| `D:\projects\ptah-extension\libs\backend\skill-synthesis\src\lib\triggers\skill-trigger.service.spec.ts`          | +2 R12 specs (rejection + paired-isolation sibling)                                        |
| `D:\projects\ptah-extension\libs\backend\memory-curator\src\lib\triggers\memory-trigger.service.spec.ts`          | +2 R12 specs (rejection + paired-isolation sibling)                                        |

**Zero spec files deleted. Zero specs weakened.**

---

## 3. Census verdict (acceptance criterion 3)

**The primitive exists.** `libs/shared/src/lib/utils/session-id.utils.ts`, pure
and dependency-free (`libs/shared/CLAUDE.md` guideline 3), exported by name from
the utils barrel, with the trim policy — _trim, and treat whitespace-only as
absent_ — stated once in its JSDoc and nowhere re-derived.

**22 of the 28 forms 1–4 sites adopted it.** Mechanically verified from the diff
by counting added `blankToUndefined(` call sites per lib:

| Lib               | Sites  | Census rows                                                                                                           |
| ----------------- | ------ | --------------------------------------------------------------------------------------------------------------------- |
| `agent-sdk`       | 4      | `sdk-agent-adapter:647`, `session-metadata-store:406`, `session-registry.service:157`, `session-importer.service:240` |
| `memory-curator`  | 10     | `memory-trigger.service` ×8, `observation-queue.store:130`, `memory-curator.service:242`                              |
| `skill-synthesis` | 7      | `skill-trigger.service` ×5, `skill-invocation-recorder:36`, `skill-synthesis.service:424`                             |
| `vscode-core`     | 1      | `subagent-registry.service:463`                                                                                       |
| **Total**         | **22** | across **4 libs** — plus `cli-agent-runtime` via the rewire                                                           |

> Note a small arithmetic slip in `tasks.md`'s own summary line: it reports
> "`skill-synthesis` (6)" where the row-by-row disposition table lists 7
> (5 trigger + recorder + synthesis service). The **22 total is correct**; only
> the per-lib breakdown was off by one. Corrected here, no scope change.

This clears §3c's pre-stated threshold of "≥ 8 production call sites across ≥ 4
libs" on the criterion written in advance, not one adjusted to fit.

**The 6 exclusions, each with its reason, all verified untouched:**

| #   | Site                                               | Reason it is excluded                                                                                                                                                                                                                                                                                                                    |
| --- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ---------------------------------------------------------- |
| 1   | `agent-sdk/.../sdk-permission-handler.ts:1030`     | Genuine **tri-state**. `cleanupPendingPermissions(sessionId?)` reads `undefined` as "all sessions" (deliberate) and `''` as a caller that lost its id (refuse). `blankToUndefined` collapses `''` → `undefined`, which would resolve **every pending permission in the process** as deny/systemAbort — the literal TASK_2026_295 defect. |
| 2   | `agent-sdk/.../sdk-query-options-builder.ts:1164`  | §6d "Untouched" invariant — MCP URL routing segment; a missing id throws `SdkError` there by design.                                                                                                                                                                                                                                     |
| 3   | `agent-sdk/.../hook-session-resolver.ts:32`        | §3c's own words: two-source precedence, a _different_ rule, not a blankness converter.                                                                                                                                                                                                                                                   |
| 4   | `agent-sdk/.../hook-session-resolver.ts:35`        | Same.                                                                                                                                                                                                                                                                                                                                    |
| 5   | `rpc-handlers/.../subagent-rpc.handlers.ts:143`    | §0 **and** §2d — the `sessionId === ''` branch owns semantics Zod must not take over. B2 also edits this file.                                                                                                                                                                                                                           |
| 6   | `skill-synthesis/.../skill-candidate.store.ts:604` | Owned by B3a, already landed as `                                                                                                                                                                                                                                                                                                        |     | null`. A one-line `\|\| null` does not need the primitive. |

**28 accounted for: 22 swept + 6 excluded.**

**The 97 form-5 bare `!x` sites (46 files) are excluded by policy** (R11). On a
`string | undefined`, `if (!sessionId) return;` is already correct and idiomatic;
rewriting them is large-surface churn with real regression risk and zero
behavioural gain. **Zero of them were touched** — see the diff audit below.

---

## 4. Diff audit

Every one of these was verified against the working tree, not assumed.

- **Zero bare `!x` guards changed.** Every removed line in this batch's diff was
  enumerated. All 22 are compound forms — `!x || x.trim().length === 0`,
  `!x || x.length === 0`, `x.trim().length === 0`, `x.length > 0`, `x === ''`.
  Not one line of the shape `if (!sessionId) return;` appears among the
  deletions.
- **Zero §0 guards removed.** Six §0 sites were swept: `sdk-agent-adapter:647`,
  `session-registry.service:157`, `observation-queue.store:130`,
  `skill-synthesis.service:424`, `subagent-registry.service:463`. In every case
  **only the inner expression changed** — the guard, its `logger.warn` /
  `SdkError` throw, its early return and its surrounding doc comment all survive
  verbatim. This is the RESOLVED Clarification 1 reading: §0 governs a guard's
  existence, not its spelling.
- **Hard exclusions confirmed untouched** (`git diff --numstat`, 0 lines each):
  - `libs/backend/agent-sdk/src/lib/sdk-permission-handler.ts` — 0
  - `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts` — 0
  - `libs/backend/agent-sdk/src/lib/helpers/hook-session-resolver.ts` — 0
  - `libs/frontend/chat-streaming/src/lib/session-scope.ts` — 0
  - `libs/backend/rpc-handlers/src/lib/handlers/subagent-rpc.handlers.ts` — carries a diff, but it is **B2's**, not mine. I never opened it. Its `sessionId === ''` branch is present and intact (now at `:149` after B2's insertions).
  - `libs/backend/skill-synthesis/src/lib/skill-candidate.store.ts` — carries B3a's 2-line diff only; contains no `blankToUndefined`, and I did not re-touch it.
- **`memory-curator.service.ts:243` left alone.** `${input.workspaceRoot ?? ''}::${sessionId}` coerces **workspaceRoot**, not a session id. `:242` was swept; `:243` is byte-identical.
- **`skill-trigger.service.ts:456` left alone.** `if (!payload.skillSlug || payload.skillSlug.length === 0)` is a **slug**, not a session id, and is not a census site. The `replace_all` used on that file was keyed on `payload.sessionId`, so it could not reach the slug guard.

---

## 5. The `memory.store.ts` behavioural change — a conscious decision

`sessionIdOrNull` **tested the trimmed value but returned the untrimmed one**:

```ts
// before
function sessionIdOrNull(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value.trim().length > 0 ? value : null; // <- returns `value`, not the trim
}
```

`blankToNull` returns the **trimmed** value. So a `MemoryInsert` carrying
`sessionId: '  <uuid>  '` previously wrote `'  <uuid>  '` into `memories.session_id`
and now writes `'<uuid>'`.

This is **correct and deliberate**. The column is read back with `WHERE session_id = ?`
against ids that were never padded, so a padded row was already unreachable by
every scoped read — it was a silent orphan, not working behaviour. Normalising it
makes the row findable. Recording it here because it is a real write-path change
and must not look like it slipped through.

The bind-parameter object shape is intact; its sibling
`workspace_root: insert.workspaceRoot ?? null` at the next line is unchanged. The
rationale JSDoc that lived on the deleted function was **relocated, not lost** —
it now sits as a comment directly above the bind, extended with the
better-sqlite3 `undefined`-throws reason.

---

## 6. One judgement call that needs a reviewer's eye

**`subagent-registry.service.ts:463` is a tri-state, and the naive sweep would have broken it.**

The disposition table marks it SWEEP. But its documented contract is:

- argument omitted (`undefined`) → no filter, **every** background agent
- non-empty id → exact match
- empty string → matches **nothing**

A flat `if (blankToUndefined(parentSessionId) === undefined)` would have collapsed
the omitted-argument arm into the blank arm, so `getBackgroundAgents()` with no
argument would return `[]` — silently emptying the background-agent list. That is
structurally the same hazard that hard-excludes `sdk-permission-handler:1030`.

The swept form keeps the `undefined` arm explicit:

```ts
if (
  parentSessionId !== undefined &&
  blankToUndefined(parentSessionId) === undefined
) {
```

A comment above it states why the `!== undefined` arm is load-bearing. The warn
and the early return survive verbatim. Net behaviour change: `getBackgroundAgents('   ')`
previously fell through and matched nothing silently; it now returns `[]` via the
guard **and logs the warn**. Same output, better signal.

I did **not** apply this reasoning to `sdk-permission-handler:1030` — it stays
hard-excluded exactly as instructed, even though the same shape would work there.
That exclusion is normative and I am not the right layer to reopen it.

---

## 7. R12 — the trim-policy change, pinned

13 swept sites (the F1-variant `!x || x.length === 0` guards in the two trigger
services) previously did **not** trim, so `'   '` was a _valid_ session id there:
it armed an idle timer under a whitespace key and was enqueued for analysis /
curation. Adopting the primitive makes it absent. Real behavioural change, now
explicit rather than silent.

Four specs added, two per trigger service:

| File                             | Spec                                                                                                                                                                                         |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `skill-trigger.service.spec.ts`  | `arms no idle timer for a whitespace-only sessionId (trim policy)` — two sessions reporting `'   '` and `'\t\n'`, asserts `enqueueAnalyze` never called                                      |
| `skill-trigger.service.spec.ts`  | `still arms the idle timer for a real sessionId after the trim tightening` — **paired-isolation sibling**, asserts the timer still arms and `enqueueAnalyze` still fires with the right args |
| `memory-trigger.service.spec.ts` | `arms no idle timer for a whitespace-only sessionId (trim policy)` — same shape, asserts `curator.curate` never called                                                                       |
| `memory-trigger.service.spec.ts` | `still arms the idle timer for a real sessionId after the trim tightening` — **paired-isolation sibling**, asserts `curate` still fires for `s1`                                             |

Each carries a docblock naming TASK_2026_296 / R12 and stating what the old
no-trim behaviour was, so a future reader does not "simplify" the policy back.

---

## 8. Verification — raw numbers

### Typecheck — 19/19 green

```
npx nx run-many -t typecheck -p shared,agent-sdk,cli-agent-runtime,cli-engine,
  thoth-runtime,rpc-handlers,vscode-core,vscode-lm-tools,memory-contracts,
  memory-curator,skill-synthesis,chat-streaming,chat,chat-state,chat-routing,
  canvas,tribunal-panel,chat-execution-tree,core

NX   Successfully ran target typecheck for 19 projects
```

### Test — 18/18 green, exit 0

```
Tests: 10,328 passed · 128 skipped · 0 failed · 10,456 total
Test suites: 0 failed
```

Per-project passed counts as reported by Jest:
`1093, 365, 530, 1013, 241, 402, 327, 805, 21, 1295, 329, 2401, 112, 845, 36, 333, 37, 143`.
Skipped: `57, 37, 1, 31, 2` = 128.

**Against baseline (10,297 passed / 128 skipped):**

- Skipped: **128 — exactly at baseline, unchanged.**
- Passed: **+31.** This batch contributes **+18** (14 in `session-id.utils.spec.ts`,
  verified by running that file alone; +2 in each trigger spec).
- **The remaining +13 is not mine and I cannot attribute it by name.** It is an
  _increase_, not a drop, so no gate is violated — but reporting it rather than
  swallowing it: the likeliest source is the parallel session's specs landing
  between the orchestrator's baseline measurement and my run (that session has
  uncommitted work in `apps/ptah-cli` and an additive re-export in
  `libs/backend/rpc-handlers/src/index.ts`). **Zero tests failed anywhere, so no
  drop needs explaining.**

### Known flake observed — R10, reported not swallowed

`@ptah-extension/rpc-handlers:test` **failed on the first full parallel run.**
This batch touches no file in `rpc-handlers`. Rerun isolated per the standing
instruction:

```
npx nx run @ptah-extension/rpc-handlers:test --skip-nx-cache
  Test Suites: 86 passed, 86 total
  Tests:       31 skipped, 2401 passed, 2432 total
  Successfully ran target test for project @ptah-extension/rpc-handlers

NX   Nx detected a flaky task
     @ptah-extension/rpc-handlers:test
```

**Nx itself classified it as flaky.** The subsequent full 18-project run was green
end to end, including `rpc-handlers`. `chat:test` — the other known flake — did
**not** fail in either run.

### Lint — 6/6 green, exit 0

```
npx nx run-many -t lint -p shared,agent-sdk,memory-curator,skill-synthesis,
  vscode-core,cli-agent-runtime

NX   Successfully ran target lint for 6 projects
```

**0 errors.** All warnings are pre-existing and untouched by this batch:
`no-non-null-assertion`, `no-explicit-any`, `no-empty-function`, and three
`max-lines` warnings on files that were already far past the 700-line soft
ceiling (1579 / 3112 / 822 lines) before this batch — none crossed the ceiling
_because of_ these edits; the largest addition to any production file was a
single import line.

`memory-contracts` is correctly absent from this lint list — this batch does not
touch it, so its `eslint:lint`-only quirk does not apply.

`libs/frontend/core` coverage floor (statements 85% / lines 85%): **untouched.**
This batch adds no frontend code to `core`; `core:test` passed at its existing
thresholds. **No threshold was lowered.**

---

## 9. Line-number drift found between the docs and the tree

Every one of the 22 sweep sites was spot-checked before editing, per the standing
instruction. Results:

- **21 of 22 line numbers were exact** as given in the prompt and the disposition
  table.
- **One drift**: `skill-candidate.store.ts` — the docs cite `:605` for the
  B3a-owned `|| null` line; at the current tree it sits at **`:604`** (B3a's edit
  collapsed two lines into one, moving it up by one). Not re-touched either way;
  recorded only so the next reader is not confused by the citation.
- `memory-curator.service.ts:242` is the `if (sessionId.length === 0) return null;`
  line; `:241` is the `.trim()` assignment feeding it. Both lines belong to the
  one site and both changed. `:243` untouched, as required.
- After my edits every file's sites shifted down by exactly 1 (the added import
  line). Any future doc citing these files should be re-derived, not copied.

---

## 10. Deliberately left alone — follow-ups, not this batch

Recorded rather than fixed, per the standing instruction:

1. **The 97 bare `!x` form-5 sites across 46 files.** R11 policy exclusion. They
   are correct as written; the cost is ~46 files of churn for zero behavioural
   gain. If they are ever revisited it should be as its own task with its own
   justification.
2. **The 9 `?? undefined` no-ops** (census §Latent). `??` does not collapse `''`,
   so these silently fail to normalize blank input — latent instances of the exact
   bug the primitive prevents. `sdk-query-options-builder.ts:665`,
   `sdk-adapter-callback-registry.ts:37`, `ptah-cli-registry.ts:733`,
   `message-finalization.service.ts:115,134,244,266`,
   `harness-workflow.service.ts:502`. **These are the best candidates for a
   follow-up batch** — each is a one-line change to `blankToUndefined(...)` and
   each is a real (if latent) defect.
3. **The 6 F6 sites** (`x ? x : undefined` / `x || undefined`) — same rule spelled
   a seventh way, no trim. Not in scope.
4. **`sdk-message-transformer.ts:132-133`** — its `:124-127` comment says
   "`||` not `??`" on purpose because the caller can hand `''`. Correct as-is.
5. **`knownSessionId` / `agentVisibleInSession`** (`chat-streaming/session-scope.ts`).
   No-trim policy pinned by `session-scope.spec.ts`. The divergence is now
   **documented in the primitive's JSDoc** so it reads as a deliberate exception
   rather than an oversight — which was the assigned deliverable. Changing its
   behaviour needs its own justification.
6. **`agent-sdk/CLAUDE.md:77` is stale** (found in the census, §Documentation
   defect). It still claims `SdkQueryOptionsBuilder.createHooks` captures
   `sessionId ?? ''`; the real signature is `createHooks(cwd: string, sessionId?: string, …)`.
   Not corrected here — it is a doc file outside this batch's scope, and it is the
   doc a developer would read before touching item 6 (B5a/B5b), so it should be
   fixed before then.
7. **No file was split, no large file refactored, nothing opportunistically
   tidied.** `skill-synthesis.service.ts` (3112 lines) and the two trigger specs
   were edited surgically and left at their existing size.

---

## 11. Standing-rule compliance

| Rule                                                                              | Status                                                                                                                                         |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `?: string` does not make `''` unrepresentable — no guard deleted on type grounds | ✅ Zero guards deleted; six §0 guards rewritten in place, all logs + returns intact                                                            |
| Spot-check every line number before editing                                       | ✅ All 22 verified against the tree; one drift found and reported                                                                              |
| Zero specs deleted                                                                | ✅ Zero deleted, zero weakened; 4 added                                                                                                        |
| Every "must reject" assertion has a sibling proving the legitimate path works     | ✅ Both R12 rejection specs have an explicit paired-isolation sibling; the primitive's spec asserts real UUIDs pass through unchanged          |
| No git commits, staging, stashing or reverting                                    | ✅ None performed                                                                                                                              |
| No stubs, placeholders, TODOs or mock data                                        | ✅ None                                                                                                                                        |
| No opportunistic refactoring outside the batch                                    | ✅ None; 7 items recorded above instead                                                                                                        |
| Stay out of B1/B2/B3a and TASK_2026_297 files                                     | ✅ `subagent-rpc.handlers.ts`, `skill-candidate.store.ts`, `memory.ts`, `apps/ptah-cli/**` and `rpc-handlers/src/index.ts` all untouched by me |
