# TASK_2026_390 — review gate

Reviewed 2026-09-08. Shipped as commit `2024caac7`
("fix(cli-agent-runtime): stop vendor SDK failures dumping subprocess output
into the stream"), working tree clean, nothing left uncommitted.

## Acceptance criteria

| # | Criterion (from task.md / context.md) | Verdict | Evidence |
|---|---|---|---|
| AC1 | Pure, vendor-parameterised `summarizeCliSdkError(error, vendor)` in `sdk-error-summary.ts` | SATISFIED | `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/sdk-error-summary.ts:30-39` — no I/O, no logging, no mutation; `vendor` is a parameter, not a Codex constant |
| AC2 | `/usage limit/i` collapses to `<Vendor> usage limit reached. Try again at <when>.`, hint kept only when it parses and is ≤ 40 chars | SATISFIED (wording overstated — see N2) | `sdk-error-summary.ts:20-22`, `:45-55`; tests `sdk-error-summary.spec.ts:4-11` (with hint) and `:14-20` (without) |
| AC3 | Otherwise: first non-empty line, cut at the `Output:` marker, capped at 500, `[output truncated]` when anything dropped, exit code survives | SATISFIED (one uncovered edge — see N3) | `sdk-error-summary.ts:61-83`; tests `sdk-error-summary.spec.ts:22-37` (exit-code headline survives, dump gone), `:39-47` (marker on first line), `:49-57` (500-char cap) |
| AC4 | `CodexCliAdapter.runSdk` catch routes both `output.emit` and `segment.emit` through the summary; no verbatim `.message` left | SATISFIED | `codex-cli.adapter.ts:707-717` — one `summary` const feeds both emits |
| AC5 | `CursorCliAdapter` same | SATISFIED | `cursor-cli.adapter.ts:356-366` |
| AC6 | Both adapters take an optional `Logger`, supplied by `CliDetectionService`, full text logged before the bounded emit; missing logger must not throw | SATISFIED | `codex-cli.adapter.ts:440-444`, `cursor-cli.adapter.ts:197-201`; construction site `cli-detection.service.ts:50` and `:57`; `this.logger?.error(...)` optional-chained, and both adapter specs construct with no logger (`codex-cli.adapter.spec.ts:157`, `cursor-cli.adapter.spec.ts:116`) and pass |
| AC7 | AbortError / cancellation branch untouched | SATISFIED | `codex-cli.adapter.ts:700-706` and `cursor-cli.adapter.ts:354-357` sit before the new code; the commit diff touches neither; covered by `codex-cli.adapter.spec.ts:483-497` |
| AC8 | Spawn-based adapters (copilot, antigravity, opencode, pi) correctly left alone | SATISFIED | They stream child stdio and only forward Node spawn-`error` messages: `copilot-sdk.adapter.ts:433`, `opencode-cli.adapter.ts:509,538`, `pi-cli.adapter.ts:445,479`. Not the vendor-SDK dump path |
| AC9 | Unit tests cover the new function's branches; suite green | SATISFIED for the function, THIN at the adapter layer (see N4) | `sdk-error-summary.spec.ts` (7 cases). Verified myself: `npx nx test @ptah-extension/cli-agent-runtime --skip-nx-cache` → **51 suites passed, 658 passed, 1 skipped** — exactly the number context.md claims |

## Codex raw verdict

`VERDICT: NEEDS_WORK`, on four "blocking findings":

1. `String(error)` renders `undefined` / `null` / `[object Object]` to the user, and the spec asserts the `undefined` case as desirable.
2. The retry-hint regex accepts any short text after "try again at" (`try again at bananas`); no long-hint rejection test.
3. A first line beginning with `Output:` returns `Unknown error` with no `[output truncated]` marker.
4. Adapter-level specs never prove a large dump is excluded from both `output` and `segment`.

Plus a speculative note that a throwing `logger.error` would escape the catch.

## My adjudication

I opened every line Codex named. All four factual claims are **accurate as
descriptions of the code**. None of them is a blocker for this task, for the
reasons below. The speculative logger claim I drop.

- **N1 (Codex #1) — confirmed, not blocking.** `sdk-error-summary.ts:31` does
  `String(error)` and `sdk-error-summary.spec.ts:69-71` pins
  `summarizeCliSdkError(undefined, 'Codex') === 'Codex SDK Error: undefined'`.
  Cosmetic: both call sites reject with an `Error` from a vendor SDK, the string
  is bounded either way, and the task promised bounding, not value coercion.
  Worth a one-line follow-up (`Unknown error` for null/undefined/plain object),
  not a gate.
- **N2 (Codex #2) — confirmed, doc-vs-code wording only.** `RETRY_AT_REGEX` at
  `sdk-error-summary.ts:22` matches `[^\n.)]+` and validates nothing as a time,
  so context.md's "only when it parses" overstates what line 51 checks (it
  checks non-empty and ≤ 40 chars). The output is still one bounded line of
  vendor text. The >40-char rejection branch (`:54`) has no test — real gap,
  small.
- **N3 (Codex #3) — confirmed, contrived input.** `raw = "Output: <dump>"` gives
  `markerIndex === 0`, so `headline` is empty at `:73` and the function returns
  `Unknown error` before the truncation-marker logic at `:82` can run. The user
  still gets a bounded line, which is the point of the task; the real Codex
  message always carries `Codex Exec exited with code 1: …` ahead of the marker,
  which `sdk-error-summary.spec.ts:39-47` covers.
- **N4 (Codex #4) — confirmed.** `codex-cli.adapter.spec.ts:461-481` only
  asserts the short message `SDK initialization failed` appears; the Cursor spec
  change was a one-line string update (`[Cursor SDK Error]` → `Cursor SDK
  Error:`) at `cursor-cli.adapter.spec.ts:387`. No adapter test feeds a 2000-line
  dump and asserts it is absent from both emitters. The wiring is three lines
  and I read it directly, so this is a coverage nit, not an unverified claim.
- **Dropped:** "an exception thrown by `logger.error` would escape the catch."
  `Logger` (`@ptah-extension/vscode-core`) does not throw and Codex produced no
  path where it does. Speculation.

One thing Codex did not check that I did: `cursor-cli.adapter.ts:296` still
emits `[Cursor SDK Error] ${msg}` verbatim. That is **not** a miss — `msg` is a
fixed literal ("Cursor API key not found…") on the missing-key branch, not
vendor output.

## Blockers

None.

## Final verdict

**READY FOR DONE.** The defect described in context.md is fixed at both call
sites, the full text still reaches the injected logger, the AbortError branches
are untouched, the spawn adapters were correctly left out of scope, and the
suite is green at the exact numbers claimed. N1–N4 are cosmetic/coverage nits
worth a small follow-up task; none of them lets an unbounded subprocess dump
reach the chat bubble again, which is the whole of what this task promised.
