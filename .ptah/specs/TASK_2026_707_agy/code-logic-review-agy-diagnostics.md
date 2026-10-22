# Code logic review — Antigravity CLI failed-result diagnostics

Review family: opencode reviewing codex

Scope examined (whole files, not only changed lines):

- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.ts` (1,191 lines)
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.spec.ts` (1,242 lines)
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-result-diagnostics.ts` (new, 53 lines)
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-detection.service.ts` (259 lines)
- Read for contracts: `cli-stderr-severity.ts`, `libs/backend/vscode-core/src/logging/logger.ts`, and `git diff` / `git status` for the branch.

No test, typecheck, lint, build or e2e was run (per task instruction). Evidence relied on: implementer's jest tail (52/52 passed, `batch-agy-diagnostics.md`), orchestrator's `nx typecheck cli-agent-runtime` PASS.

**Verdict: APPROVE WITH FIXES — score 6/10.**

0 blocking, 2 serious, 3 moderate, 5 low defects; 6 failure modes identified.

The core contract holds: non-SUCCESS still maps to turn exit 1 even when the process exits 3 (`antigravity-cli.adapter.ts:937`, proven by `antigravity-cli.adapter.spec.ts:990`), the SUCCESS path emits no log and no error (`spec:1006-1016`), the failure log fires once per process via the injected logger (`adapter:928-930`, `spec:997`), the ERROR-step and AGY_ERROR buffers are count-bounded locals per `runSdk` (`adapter:738-739,744-746,879-884`), redaction is applied before the 8 KiB slice (`antigravity-result-diagnostics.ts:52`), and the constructor change is safe at every construction site (only `cli-detection.service.ts:72` in production; `undefined` as the 2nd arg keeps the default `--help` stream-json probe at `adapter:415-424`). What separates the score from 7-8 is that two defects contradict stated acceptance criteria on plausible inputs (D1 backward compatibility, D2 redaction key set), and one narrow regression flips a malformed trailing result to success (D5).

## Five logic questions

1. **How does this fail silently?** D1: `result.error: null` (or number/boolean/array) now fails `AgyResultEventSchema` (`antigravity-cli.adapter.ts:167`) — a `status: "SUCCESS"` event is rejected as "Invalid Antigravity stream-json event", the turn resolves 1, and because schema-invalid events never reach `onResult` (`adapter:1067`), `failedResult` stays false and the new diagnostics log (`adapter:928-930`) never fires — the one case where the CLI explicitly reports an error is the case with no diagnostics. Also D6: an `AGY_ERROR` stderr line longer than 8 KiB before its newline is silently never captured (`adapter:878,881,924`) — evidence is missing exactly when the error payload is largest.
2. **What user action produces unexpected behaviour?** A lane that awaits `done` after a non-SUCCESS result now blocks until the child process exits (D3) — previously it resolved at result time. A user pressing abort still resolves the turn (abort → close with signal → `adapter:936-938` resolves 1 — verified by tracing `spec:1098-1108`); continuation after a failed turn correctly throws (`adapter:976-980`, turn unsettled).
3. **What input data produces a wrong answer rather than an error?** D1 (`error: null` → exit 1 mislabelled "Invalid … event"), D4 (`agyErrors` alone → an `error` segment on an exit-0 SUCCESS turn; stale `failedEvent` after a later SUCCESS → failure log for a turn that resolved 0), D5 (trailing malformed result + exit 0 → turn resolves 0, where pre-diff it resolved 1).
4. **What happens when a dependency fails, times out, or returns a wrong shape?** D3: `agy` emits a failed result but does not exit after stdin EOF → turn `done` never settles (no adapter-side timeout; `--print-timeout` at `adapter:100,299` caps agy's turn wait, not post-result teardown; only `abort()` or an upstream manager cap breaks it). D10: if `logger.error` throws at `adapter:929`, the close handler dies before `resolve(exitCode)` at `adapter:945` → `done` hangs (theoretical; Logger's `writeLogEntry` path does not normally throw). D1 is also the wrong-shape case: agy version drift that serializes `error` as null/number invalidates the terminal event.
5. **What is missing that the requirements never mentioned?** The new ERROR-state step concept has no segment mapping — `handleStepUpdate` still routes any non-DONE state to the ACTIVE branch, so an ERROR tool step surfaces as a phantom `tool-call` (D8). Redaction covers the log but not the unchanged `[stderr]` passthrough, so an `AGY_ERROR` line's secrets still reach the transcript verbatim (D9, per-spec tension). `cookie` is absent from the redaction key set (D2).

## Defects

**D1 — Serious — `result.error` of unexpected JSON shape invalidates the whole result event (backward-compat regression).**
`antigravity-cli.adapter.ts:167` — `error: z.union([z.string(), z.object({...}).passthrough()]).optional()` accepts absence and string/object only; `.optional()` does not accept `null`, and numbers/booleans/arrays fail the union. Pre-diff the field was absent from the schema, so `.passthrough()` accepted any `error` shape. Post-diff, `{"status":"SUCCESS", ..., "error":null}` fails `AgyResultEventSchema` → `parseKnownEvent` returns false → "Invalid Antigravity stream-json event" error segment (`adapter:1091-1095`) and `settleTurn?.(1)` (`adapter:1072-1074`) → in stream mode the guard at `adapter:855-862` falls through (failedResult false), resolves the turn 1 and closes stdin: a SUCCESS result becomes exit 1 with a misleading diagnosis, and no diagnostics log is written. CLIs that serialize optional fields as explicit `null` make this plausible. Fix: add `z.null()` to the union (or `.nullable().optional()`). No test covers `error: null`/number/boolean/array.

**D2 — Serious — `cookie` missing from the redaction key set (a named requirement).**
`antigravity-result-diagnostics.ts:3` — `SENSITIVE_KEY = /token|key|secret|authorization|password|credential/i` has no `cookie`. A `cookie` / `cookies` / `set-cookie` key at any depth passes `redactValue` (`antigravity-result-diagnostics.ts:19-24`) unredacted into the 8 KiB log. The text paths have the same gap: the JSON-pair regex (`antigravity-result-diagnostics.ts:8`) and `INLINE_SECRET` (`:4`) list no cookie form. The review contract explicitly requires cookie to be redacted at any depth. Fix: add `cookie` to both patterns. No test asserts cookie redaction.

**D3 — Moderate — failed-turn settlement now depends on the child process exiting; no adapter-side timeout.**
`antigravity-cli.adapter.ts:855-862` — on a non-SUCCESS result the guard ends stdin and returns without resolving the turn; resolution moved to close (`adapter:936-938`). If `agy` emits a failed result but never exits after stdin EOF (stuck MCP connection, orphaned grandchild, console handle), the turn's `done` never settles. Pre-diff the turn resolved 1 at result time. Only `abort()` (`adapter:966`) or an upstream manager cap can break the wait. Consider resolving on a short post-result timer or documenting the external cap.

**D4 — Moderate — close-time error gating uses sticky flags that can contradict the turn outcome.**
`antigravity-cli.adapter.ts:931-935` — `if (failedResult || agyErrors.length > 0)` emits an `[Error] … process exited with code ${exitCode}` segment even when exitCode is 0 and the result was SUCCESS (only `agyErrors` nonempty), while `:936-938` resolves the turn 0 — a successful turn carrying an error segment; segment-scanning consumers disagree with `done`. Symmetric case: `failedResult`/`failedEvent` (`:748-753`) are never reset by a later SUCCESS result in the same process, so an ERROR result followed by an anomalous SUCCESS resolves the turn 0 (guard at `:856` only skips nonzero) yet still logs the stale `failedEvent` (`:928-930`) and emits the close `[Error]` (`:931`). Pre-diff the first failure resolved 1 and won. Fix: gate the close detail on `failedResult || exitCode !== 0` and log only when the final turn failed.

**D5 — Moderate — a trailing (unterminated) malformed result line on close now resolves the turn with the process exit code, not 1.**
`antigravity-cli.adapter.ts:916-918` — the flush-path settleTurn was narrowed to `(turnCode) => { if (turnCode === 0) currentTurn.resolve(turnCode); }`. A trailing partial line that parses as a `result` event but fails the schema → `settleTurn?.(1)` (`:1073`) is ignored, `failedResult` is false (invalid events never reach `onResult`), and `:937` resolves `exitCode` — with process exit 0 the turn succeeds. Pre-diff the flush settleTurn was `(turnCode) => currentTurn.resolve(turnCode)` and resolved 1. The stdout path is unaffected (guard at `:856` requires `failedResult`, false for malformed, so it resolves 1 — covered by `spec:741-761`). The "Invalid Antigravity stream-json event" segment is still emitted, so exit 0 and an error segment disagree.

**D6 — Low — AGY_ERROR capture drops lines > 8 KiB before their newline; captured lines capped at 1 KiB; error steps not size-bounded.**
`antigravity-cli.adapter.ts:878` — `stderrLineBuf = stderrLines.pop()?.slice(-8192) ?? ''` keeps the tail of an unterminated line; once the newline arrives the reassembled line no longer starts with `AGY_ERROR` (`:881,924`) and is silently never captured. Captured lines are then capped at 1024 chars (`antigravity-result-diagnostics.ts:29-31`). Also `errorSteps` (`adapter:738,744-746`) is count-bounded (5) but not size-bounded: five ERROR steps carrying megabyte tool outputs are retained whole in memory until close, then reduced to the 8 KiB log.

**D7 — Low — one failure now produces three error segments and two `[Error]` blocks.**
For a failed result with exit ≠ 0: `formatAgyFailure` at result time (`antigravity-cli.adapter.ts:1182-1184`), the new close detail (`:931-934`), and the pre-existing "Antigravity CLI exited with code N" (`:939-944`). The new detail subsumes the third segment's information; consumers that count or surface error segments now triple-report one failure.

**D8 — Low — an ERROR-state tool step still emits a phantom `tool-call` segment.**
`antigravity-cli.adapter.ts:1117-1142` — `handleStepUpdate` routes any non-DONE state to the ACTIVE branch, so the ERROR tool step the new buffer captures (`:742-747`) surfaces as `[Tool] tool` plus a `tool-call` segment with empty content and no parameters — not as an error.

**D9 — Low (per-spec tension, routed for a call) — the same AGY_ERROR line reaches the transcript unredacted.**
`antigravity-cli.adapter.ts:900-901` emits `cleaned` raw via `[stderr]` + `classifyCliStderr` while the captured copy (`:882`) is redacted. Verify item 6 demanded other stderr handling unchanged, so this is per-spec; but any secret inside an `AGY_ERROR` stderr line is redacted in the log and printed verbatim in the lane output — the redaction goal holds only for the log. Recorded as a defect so the orchestrator can decide whether stderr redaction should follow.

**D10 — Low (theoretical) — the failure log sits before `resolve(exitCode)` in the close handler.**
`antigravity-cli.adapter.ts:928-930` runs before `resolve(exitCode)` at `:945`. If `logger.error` ever throws, the close handler dies and `done` never settles. Logger's `writeLogEntry` path is not expected to throw (`logger.ts:265-269`), so this is defensive: resolve first, log after, or wrap the log call.

## Verification against the task's checklist

1. **Zod schema / backward compat** — partially met. Absent `error` and string/object error accepted; SUCCESS-without-error tested (`spec:1006-1016`). Fails for `error: null`/number/boolean/array (D1) — those events were valid pre-diff via passthrough.
2. **`[Error]` output with safe code/message** — met. `formatAgyFailure` (`antigravity-result-diagnostics.ts:33-45`) emits status + redacted code/message + redacted response; proven by `spec:992-993`.
3. **One Logger call per non-SUCCESS result** — met. Single call at close (`adapter:928-930`), injected logger (`cli-detection.service.ts:72`), no `console.*`; the redacted JSON in the message string matches Logger's own documented "stringify into the message" diagnostic mode (`logger.ts:220-221`). Caveats: D4 (stale failedEvent can log after a later SUCCESS) and D1 (schema-invalid results never log).
4. **Redaction** — met for token/key/secret/authorization/password/credential at any depth (object and array recursion, `antigravity-result-diagnostics.ts:14-27`; depth cap 12 stops cyclic input without a crash; bearer/inline-value patterns at `:4,:9`), 8 KiB bound applied after redaction (`:52`). Misses `cookie` (D2). Nested-array redaction and the 8 KiB bound are not covered by tests.
5. **Last-5 ERROR step buffer** — met. Locals per `runSdk` (`adapter:738`), push/shift bound of 5 (`:744-746`); no cross-run leak. Retention across turns within one process is by design (see Decisions); no test exercises the >5 eviction.
6. **AGY_ERROR stderr + exit code in lane error; other stderr unchanged** — met. Line-based capture across chunk splits (`:874-885`), trailing partial line captured at close (`:923-927`), bounded 5×1024; exit code 3 in the error message (`spec:994-995`); `[stderr]` emission and `classifyCliStderr` untouched (`:886-901`). Gaps: >8 KiB drop (D6); unredacted stderr passthrough (D9).
7. **Status→exit mapping / SUCCESS path** — met. Non-SUCCESS → 1 even with process exit 3 (`:937`, `spec:990`); SUCCESS → 0, no log, no error segments (`spec:1006-1016`); regression only in the two narrow cases D4/D5.
8. **Logger wiring / construction sites** — met. 3rd constructor param is new and optional (`adapter:356-360`); `cli-detection.service.ts:72` passes `(this.spawner, undefined, this.logger)` — `undefined` keeps the default `--help` probe (`adapter:415-424`); all other sites are 1-2 arg calls and unaffected (`spec:158,181,521,590,1215`, `antigravity-cli.adapter.mcp.spec.ts:111`); `@ptah-extension/vscode-core` is an existing dependency of this lib (`package.json:17`, dozens of Logger imports).
9. **Tests / no `any`, no `@ts-ignore`, `unknown` in catch** — met. New tests use `{ error: logError } as unknown as Logger` (a double cast, not `any`/`@ts-ignore`); no new `catch` blocks at all. Coverage gaps listed under the defects (D1 shapes, cookie, array-depth redaction, 8 KiB bound, >5 eviction, multi-turn failure, trailing partial AGY_ERROR at close, abort during failed result).

## Failure modes

1. `agy` emits a failed result then never exits → turn hangs (D3).
2. `agy` emits `error: null` (or number/boolean/array) → SUCCESS flips to exit 1, no diagnostics log (D1).
3. `AGY_ERROR` stderr line > 8 KiB before its newline → silently not captured (D6).
4. `agy` crashes with `AGY_ERROR` + exit 3 and no result event → close detail emitted with exit code; turn resolves 3 (pre-existing passthrough) — traced, correct.
5. ERROR result followed by an anomalous SUCCESS result in one process → turn 0 + failure log + `[Error]` segments (D4).
6. Logger throws inside the close handler → `done` never settles (D10, theoretical).

## Decisions

- **"Does not leak across turns" read as per-run isolation with count-bounded retention.** The buffers are `runSdk` locals (`adapter:738-739`), so separate runs/lanes never share state; within one process the last-5 ERROR steps are deliberate context for the one close-time log. If the intent was a per-turn reset, fold it into D4's fix. Reversible.
- **D9 kept as a reported defect, not a verdict-blocker**, because verify item 6 explicitly froze other stderr handling; whether `[stderr]` lines should also be redacted is the orchestrator's call. Reversible.
- **Native read/grep used instead of ptah workspace tools**: the `ptah_*` exploration tools are not in this lane's exposed catalog; only read-only inspection and `git diff`/`git status` were needed.
- **No verification commands run** per the task instruction; the implementer's jest tail and the orchestrator's typecheck PASS were taken as given evidence, and the review traced behaviour by reading the code paths directly.
- Style/naming/formatting observations (e.g. the settleTurn callback indentation drift at `adapter:854-867` and `:910-919`) were left to code-style-reviewer.
