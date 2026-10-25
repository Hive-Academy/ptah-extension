## Backend implementation — `TASK_2026_712_5d7c`, lint fix `cli-agent-runtime`

**Tasks completed**: the `nx lint cli-agent-runtime` errors listed in the brief. Warnings were out of scope. Behavior is unchanged.

**Files**:

- MODIFIED `libs/backend/cli-agent-runtime/package.json:26`. `@nx/dependency-checks`: added `"@ptah-extension/auth-providers-tokens": "0.0.1"` under `@ptah-extension/auth-providers`. The spec style matches the sibling workspace deps. The name and version were checked against `libs/backend/auth-providers-tokens/package.json`.
- MODIFIED `libs/backend/cli-agent-runtime/src/lib/claude/claude-sdk-lane-runner.ts`
  - ~92 `prefer-const` (`settleAbort`): I did not move it to a late `const`. `closeMailbox` can run before `finish` exists: it is called from the abort listener and from the `queryFn` catch at ~111. At that point a `const` would be in its temporal dead zone and would throw a ReferenceError. It is now a holder, `const abortSettler: { settle?: () => void } = {}`. The call is `abortSettler.settle?.()` and the assignment is `abortSettler.settle = () => finish(1)` (~174). The semantics are identical to before.
  - ~353 `prefer-const` (`query`): same reasoning. The `child.query` getter and `close()` are installed (and `this.child` is set) before `queryFn()` returns. The value now lives in a holder, `const opened: { query?: ReturnType<LaneQueryFunction> } = {}`, and the getter, `close()` and the assignment use `opened.query`. The refusal path (`claudeLaneRefusal()` when the value is not yet set) is preserved.
  - ~462 `@typescript-eslint/no-this-alias` (`const owner = this`): the async generator body moved into a private method, `private async *admittedTurns(turns)`, placed just above `launch`. `launch` now builds `prompt` as `{ [Symbol.asyncIterator]: () => this.admittedTurns(gate.prompt) }`. The arrow keeps `this` lexically bound, so no alias or eslint-disable is needed. Each iteration still creates a fresh generator over `gate.prompt` with the same validate, assertOpen, yield and catch-dispose-refuse sequence.
  - The uncommitted Batch 23b edit (`lanePlanLimits.onSystemInit(sdkQuery, context.named?.route)` at ~139) is kept unchanged.
- MODIFIED `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.spec.ts:608` `prefer-const` (`attachment`). `probe.get()` reads it before it is assigned, so a late `const` would hit the temporal dead zone. It is now a holder, `const attachmentRef: { current?: McpAttachment } = {}`, and its uses at ~616, ~654 and ~660 were updated. The assertions are unchanged.
- MODIFIED `libs/backend/cli-agent-runtime/src/lib/session-children/session-spawner.accounts.spec.ts:57-58` `no-unexpected-multiline`: the opening `(` of the `it.each(...)` call now sits on the same line as the closing `)`. The test content is unchanged.

**`agent-events.spec.ts`**: not touched. The brief named no specific errors there. A read of the file found no un-reassigned `let`, no `this` alias, and no line that starts with `(`, `[` or a template literal right after an expression. If the orchestrator's lint run names an error there, it needs a follow-up.

**Verification**: `ptah_get_diagnostics` (severity: error) on `claude-sdk-lane-runner.ts` and `agent-process-manager.service.spec.ts`: 0 errors, 0 warnings, coverage clean. A first pass caught one missed `attachment` reference at spec line 660, which is now fixed. Per the brief, I did not run nx, jest, tsc or lint. The orchestrator runs `nx lint cli-agent-runtime` and the tests.

**Plan deviations**: none. Holders were used in place of a literal `let`→`const` because a late `const` would change behavior (temporal dead zone).

**Out-of-scope observations**: none.
