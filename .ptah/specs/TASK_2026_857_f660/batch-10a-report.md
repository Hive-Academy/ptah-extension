# Batch 10a report — TASK_2026_857_f660

## Task 10a.1: API rate-limit wording matcher; `classifyLaneFailureClass` optional `rateLimited` → `usage-limit`

Status: DONE. All four batch files done; both scoped verify runs exit 0.

### What changed

1. CREATE `…/cli-agents/limits/lane-rate-limit-classifier.ts`
   - Exports `matchesApiRateLimit(texts: readonly string[]): boolean` and the fixed marker
     `PTAH_API_RATE_LIMIT_SEGMENT = 'API rate limit (HTTP 429)'`.
   - Pure, shaped like `matchesAuthFailure` (implementation-plan.md:523-536): no clock, no I/O, no
     logging, and the text is never stored. Each text is read up to 4096 chars
     (`RATE_LIMIT_TEXT_CHARS`, the plan's `LIMIT_CLASSIFIER_SEGMENT_CHARS` segment cap).
   - Patterns exactly as the plan gives them:
     - `/\bAPI Error\b[^\n]{0,80}?\b429\b/i`
     - `/\b429\b[^\n]{0,80}?\b(?:rate[- ]?limit(?:ed)?|too many requests)\b/i`
     - `/\brate[- ]?limit(?:ed)?\b[^\n]{0,80}?\b429\b/i`
     - the fixed marker, checked with an exact `includes`.
   - A 429 must sit next to an API or rate wording on the same line. A bare "429" or a bare
     "rate limit" never matches. It never feeds `classifyLaneLimit`, `failureKind` or
     `recordLaneLimits`.
   - The exact Kimi wording `API Error: Request rejected (429) · Kimi Code API rate limit exceeded.`
     matches through the first two patterns.

2. CREATE `…/cli-agents/limits/lane-rate-limit-classifier.spec.ts`
   - Matches: the exact Kimi wording; `API Error: Request rejected (429)`;
     `API Error: 429 {"type":"rate_limit_error"}`; `429 Kimi Code API rate limit`;
     `rate limited (429)`; `Rate-limit exceeded (429)`; `HTTP 429: Too Many Requests`; the fixed
     marker. One test also pins the marker constant value.
   - Rejects: a bare `429`; a bare `rate limit`; `rate`; `HTTP 4290`; `Request rejected (429)`
     (a 429 with no API or rate wording); `MODEL_CAPACITY_EXHAUSTED`; the number 429 in a file
     path (`wrote D:/logs/429/build-output.txt`); a 429 and a rate wording on different lines;
     quota wording (`usage limit reached ∙ resets 2am`).
   - Oversized input: a wording inside the cap of an 8 KiB text matches; a wording only past
     4096 chars does not (the cap truncates first).
   - One wording among several texts matches; an empty text list returns false.

3. MODIFY `…/cli-agents/limits/lane-failure-class.ts`
   - `LaneFailureClassInput` gains optional `readonly rateLimited?: boolean`. Optional because
     `classifyLaneFailureClass` and the input type are exported from the lib barrel
     (`src/index.ts:2-5`).
   - Precedence per implementation-plan.md:562-566: `delivered`/`unverified` → null; `quota` →
     `usage-limit`; `rateLimited` → `usage-limit`; timeout; auth; crash; completed +
     `no-deliverable` → `bad-output`.
   - The doc comment now reads "quota, rate limit, timeout, auth, crash, output".
   - With the field absent or false, every existing branch is unchanged.

4. MODIFY `…/cli-agents/limits/lane-failure-class.spec.ts`
   - Eight new rows in the precedence table:
     - `{ rateLimited: true }` on the `failed` base → `usage-limit` (was `crash`).
     - completed + `no-deliverable` + `rateLimited: true` → `usage-limit` (was `bad-output`).
     - `delivered` + `rateLimited: true` → null; `unverified` + `rateLimited: true` → null.
     - `quota` + `rateLimited` + `timeout` → `usage-limit` (quota keeps precedence).
     - `rateLimited` + `timeout` → `usage-limit`; `rateLimited` + `authMatched` → `usage-limit`
       (rate limit before timeout and auth, as the plan orders it).
     - `rateLimited: false` → `crash` (false behaves as absent).

### Evidence

- Both verify runs below exit 0. The cli-agent-runtime test task (2m 32s critical path) ran the
  two new spec files: `jest.preset.js` keeps the Nx default colocated `*.spec.ts` glob, the same
  glob that runs the sibling `limits/` specs.
- Acceptance (Req 1, usage-limit failure class) holds by composition of two passing rows: the
  classifier spec proves the exact Kimi wording sets the flag, and the failure-class row
  `{ rateLimited: true }` on the `failed` base maps it to `usage-limit`. Today that lane gets
  `crash` or no class; with the field it gets `usage-limit`.

### Files touched (absolute paths)

- CREATE `D:\projects\ptah-extension\.claude-worktrees\lane-learning-routing\libs\backend\cli-agent-runtime\src\lib\cli-agents\limits\lane-rate-limit-classifier.ts`
- CREATE `D:\projects\ptah-extension\.claude-worktrees\lane-learning-routing\libs\backend\cli-agent-runtime\src\lib\cli-agents\limits\lane-rate-limit-classifier.spec.ts`
- MODIFY `D:\projects\ptah-extension\.claude-worktrees\lane-learning-routing\libs\backend\cli-agent-runtime\src\lib\cli-agents\limits\lane-failure-class.ts`
- MODIFY `D:\projects\ptah-extension\.claude-worktrees\lane-learning-routing\libs\backend\cli-agent-runtime\src\lib\cli-agents\limits\lane-failure-class.spec.ts`
- This report: `D:\projects\ptah-extension\.claude-worktrees\lane-learning-routing\.ptah\specs\TASK_2026_857_f660\batch-10a-report.md`

Nothing else was modified. No barrel, no other file, and no git command of any kind was run.

### Verification

Command 1 (PASS, exit 0; waited 385 s in the verify lock queue behind other lanes, which is
normal per the run constraints):

```
npm run verify -- -p @ptah-extension/cli-agent-runtime 2>&1 | tail -40
```

Tail:

```
[verify 2026-10-30T17:42:50.088Z] lock slot 1 acquired after 385s: verify lint,test,typecheck (@ptah-extension/cli-agent-runtime)

NX   3 tasks: 3 succeeded

  Run duration:      3m 10s
  Cache:             0/3 hit (0%)
  Critical path:     2m 32s (1 task)
  Recoverable time:  37.4s (20% of the run)
[verify 2026-10-30T17:46:09.303Z] lock released after 199.2s, exit code 0
```

Command 2 (PASS, exit 0; waited 233 s in the queue; one of the two tasks was a shared-Nx-cache
hit from a run in this worktree that already included these finished files, so both hosts
type-check against this source):

```
npm run verify -- -t typecheck -p @ptah-extension/vscode-lm-tools,ptah-electron 2>&1 | tail -40
```

Tail:

```
[verify 2026-10-30T17:50:11.277Z] lock slot 1 acquired after 233s: verify typecheck (@ptah-extension/vscode-lm-tools,ptah-electron)

NX   2 tasks: 2 succeeded, 1 cached

  Run duration:      24.7s
  Cache:             1/2 hit (50%)
  Critical path:     24.7s (1 task)
  Recoverable time:  <1ms
[verify 2026-10-30T17:50:43.154Z] lock released after 31.9s, exit code 0
```

## Decisions

1. The matcher caps each text at its first 4096 chars.
   - Options: (a) no internal cap, trust callers to pre-slice; (b) cap each text at 4 KiB;
     (c) cap the concatenation.
   - Evidence: the plan bounds every caller's input — segments are each cut to
     `LIMIT_CLASSIFIER_SEGMENT_CHARS` (4 KiB) and there are at most 8
     (implementation-plan.md:543-545), and the ptah-cli adapter slices to 4096 before the call
     (implementation-plan.md:558). An internal cap keeps the exported pure function bounded even
     for a caller that forgets. Per-text (b) matches the plan's per-segment bound.
   - Reversible: yes, one constant.

2. The fixed marker is checked with an exact `includes`, as a fourth pattern.
   - Options: rely on the third regex (it already matches "rate limit (HTTP 429)"); check the
     marker string exactly.
   - Evidence: the plan lists the marker as its own bullet in the pattern list
     (implementation-plan.md:533-534). The exact check keeps marker recognition independent of
     later regex changes.
   - Reversible: yes.

3. The classifier is NOT added to the lib barrel.
   - Options: export from `src/index.ts` like `matchesAuthFailure`; leave it project-internal.
   - Evidence: B10c's stream loop "imports the classifier by relative path, inside the same
     project" (implementation-plan.md:560-561), and this batch's file list forbids any other file,
     barrels included. If a later batch needs it on the barrel, that batch owns the barrel edit.
   - Reversible: yes.

4. `rateLimited` sits after `quota` and before `timeout` and `auth`, exactly as the plan orders
   it, and the spec pins those two orderings even though the real pipeline never sets the flag on
   timeout or stop paths (implementation-plan.md:551-552).
   - Options: place it after auth; place it first.
   - Evidence: implementation-plan.md:564-566 gives the full precedence list; the spec rows
     `{ rateLimited: true, status: 'timeout' }` and `{ rateLimited: true, authMatched: true }`
     document the specified position of the pure function's check.
   - Reversible: yes, but a change would need a plan revision.

5. Extra spec cases beyond the plan's list: the number 429 in a file path, "rate" alone,
   `Request rejected (429)` without an API wording, quota wording, oversized input (both sides of
   the cap), one-match-among-several, and the empty list.
   - Evidence: the plan's spec list (implementation-plan.md:620-623) plus this batch's own
     coverage requirement for path-429, "rate" alone and oversized input. Each case pins the
     conservative boundary the plan states ("a 429 must sit next to an API or rate wording on the
     same line").
   - Reversible: yes.

## Issues outside scope

- None. Other lanes' verify runs (canvas, chat, agent-sdk/skill-synthesis,
  shared/persistence-sqlite, the hosts typecheck) occupied the shared lock before both commands;
  that is normal queueing per the run constraints, not a failure. No failure outside this batch's
  files was seen in either tail.
