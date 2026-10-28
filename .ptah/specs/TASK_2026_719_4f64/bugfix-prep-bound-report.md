## Backend implementation — `TASK_2026_719_4f64`, bugfix M2 + N1 (D76 item 3)

**Tasks completed**: M2 (bound named pre-admission preparation by the handler-entry deadline), N1 (spec that the entry deadline reaches the adapter unchanged).

**Files**:

- MODIFIED D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts
- MODIFIED D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/rpc-handlers/src/lib/chat/session/chat-session.account-binding.spec.ts

Not touched: session-query-executor.service.ts (+ accounts spec), sdk-agent-adapter.ts, cli-agent-runtime.

### The bound

- New private `withinNamedAdmissionDeadline(named, deadline, prepare)`. With no named selection or no deadline it returns `prepare()` unchanged, so ambient behaviour is the same. For a named launch it races the preparation against a timer set to `max(0, deadline - Date.now())`. When the timer fires it:
  - rejects with `{ code: 'identity-unproved', summary: 'Named account admission could not be completed.' }`, which is the code and copy the SDK admission uses (`session-query-executor.service.ts` `NAMED_REFUSAL_SUMMARY`);
  - attaches a `.catch` to the abandoned preparation that logs fixed text through the injected Logger, so a late rejection is observed (M1 pattern).

  A `finally` clears the timer. The method adds no catch clause, so it needs no degradation marker.
- The refusal is surfaced the way the service already surfaces admission refusals: the existing caller catches run `mainSessionAccountFailure(error)`, which returns `{ success: false, error: summary, accountRefusal: { code, summary } }`.
- Where it applies:
  - `launchSdkSession` (chat:start, child and handoff starts): wraps enhanced prompts, `buildMcpServersOverride` (Smithery + serial MCP OAuth refreshes), the stored model, the provider profile and the output style as one bounded block. `startChatSession` is not called when the bound fires.
  - `autoResumeIfInactive` (chat:continue auto-resume, chat:resume activate, rewind): two bounded calls. The first covers enhanced prompts, which stays outside the try as before, so a refusal reaches the caller's `mainSessionAccountFailure` catch. The second covers provider profile + output style inside the try, where the existing `resumeError` refusal mapping returns `{ error: { ...refusal, sessionId } }`. The resume path has no OAuth/MCP override build. `resumeSession` is not called when the bound fires.
- Not bounded (residual): awaits that run before the named selection is resolved or outside these blocks. These are `ensureRegisteredForSubagents` (the .mcp.json lock) in start/continue, `resolveSessionFolder`, and history reads in resume. Their time still counts against the deadline, because the SDK admission refuses once it has passed. They are not raced here.

### Specs (`chat-session.account-binding.spec.ts`, describe "named admission deadline from handler entry (D76)")

- forwards the handler-entry deadline unchanged to a named start although time advanced during preparation (`Date.now` advanced +5 s and +9 s inside preparation; asserts `admissionDeadline === T0 + NAMED_ACCOUNT_ADMISSION_BUDGET_MS`)
- passes no deadline to an ambient start
- forwards the chat:continue entry deadline unchanged to the named resume
- refuses a named start with the admission refusal when preparation outlasts the deadline, without calling the adapter (fake timers; exact result `{ success:false, error, accountRefusal:{ code:'identity-unproved', summary } }`; `startChatSession` and `streamEventsToWebview` not called)
- does not bound an ambient start by the named deadline (preparation outlasts the budget, start still succeeds)

**Stack observed**: tsyringe service with an injected `Logger` (`chat-session.service.ts` constructor). Refusal mapping is `mainSessionAccountFailure` (`chat-slash-command-router.service.ts:60`). The refusal type `ProviderAccountPortRefusal` comes from `@ptah-extension/auth-providers-tokens`, which the router in the same lib already imports.

**Verification**:

- `node scripts/verify.mjs -t test,typecheck -p @ptah-extension/rpc-handlers -- --output-style=static -- --testPathPatterns=chat-session` → test: `Test Suites: 13 passed, 13 total; Tests: 193 passed, 193 total`. Typecheck in that run failed only with `TS5023: Unknown compiler option '--testPathPatterns'` (the Jest filter was forwarded to tsc).
- Re-ran without the filter: `verify.mjs -t typecheck -p @ptah-extension/rpc-handlers` → `exit code 0`. Note that `tsconfig.lib.json` excludes specs; ts-jest compiled the spec in the test run.
- `npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts` → `TOTAL 278 unsuppressed site(s)`, exit 0 (no baseline increase).
- Lint was not run (not requested).

## Decisions

- Refusal shape: thrown `{ code: 'identity-unproved', summary }` mapped by the existing `mainSessionAccountFailure`. The alternative was a new result type. Evidence: the executor's deadline refusal uses this exact code and summary. Reversible.
- Resume path: two bounded calls instead of moving enhanced-prompt resolution into the try. Moving it would change how an ambient enhanced-prompt failure is shaped. Reversible.

**Plan deviations**: none.

**Out-of-scope observations**:

- The typecheck target forwards Jest flags when the nested `--` form is combined with `-t test,typecheck`, so the documented command fails typecheck spuriously.
- The pre-selection awaits listed under "Not bounded" remain unraced.

## Review fix round (code-logic-review-d76 finding 3)

**Finding**: the named preparation bound was timer-only. With the deadline already past, a
preparation that settles through microtasks wins `Promise.race` against the zero-delay timer
(or the clock passes the deadline while preparation resolves before the timer gets a turn),
and `launchSdkSession` went on to call `startChatSession`.

**Fix** (`libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts`,
`withinNamedAdmissionDeadline`):

- Before invoking `prepare`: `if (Date.now() >= deadline) throw namedPreparationRefusal();`
  so preparation is never started once the deadline has passed.
- After the race resolves: the same clock check; a result that arrives at or after the
  deadline is discarded and the same refusal is thrown.
- Unchanged: ambient launches (no selection or no deadline) await `prepare` directly; the
  timer path still observes the abandoned preparation with the fixed-text Logger warning;
  the user-facing refusal (`identity-unproved`, "Named account admission could not be
  completed.") is the same object factory. No new catch blocks.

**Specs** (`chat-session.account-binding.spec.ts`, D76 describe), both new:

- `refuses a named start whose preparation resolves after the deadline before any timer
  runs, without calling the adapter` — `Date.now` is moved past the deadline inside the
  preparation, which resolves through microtasks only; asserts the refusal result,
  `startChatSession` and `streamEventsToWebview` not called. Without the post-race check
  the race returns the result and the adapter is called.
- `refuses a named start without starting preparation when the deadline already passed` —
  handler entry reads T0, every later reading is T0 + budget; asserts the refusal,
  `resolveEnhancedPromptsContent` and `startChatSession` not called.

The existing five D76 specs are unchanged and pass.

**Verification**:

- `node scripts/verify.mjs -t test -p @ptah-extension/rpc-handlers -- --output-style=static -- --testPathPatterns=chat-session`
  → 13 suites passed, 195 tests passed, exit 0.
- `node scripts/verify.mjs -t typecheck -p @ptah-extension/rpc-handlers -- --output-style=static`
  → success, exit 0.
- `npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts` → TOTAL 278
  unsuppressed sites, all within baseline, exit 0.

`sdk-agent-adapter.ts` not touched.
