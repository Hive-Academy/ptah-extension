# Batch 38c (P6f-c) report: P6 bounded correction

Executor: backend-developer subagent (Anthropic). Worktree `.claude-worktrees/decision-model-routing`. No git, no Nx,
Jest, tsc or build runs (orchestrator runs checks). Line numbers below are in the working tree after this batch.

## Items

### Logic N-1: route gate measures tokens as well as chars; the token budget fits a 100-phase result

- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-result-budget.ts:77-90`: new
  `ROUTE_DECIDE_RESULT_BUDGET = { tokens: 25_600, chars: 64_000 }` (replaces `ROUTE_DECIDE_RESULT_MAX_CHARS`). The
  override table uses it at `:104`. The tokens are no longer derived at 4 chars/token. Measured with the repo's
  `gpt-tokenizer`: a 100-phase roster whose reasons carry scores and ids is 58,775 chars and 24,655 tokens (2.4
  chars/token). The old 16,000-token budget would have cut that result. 25,600 tokens is the char ceiling at 2.5
  chars/token.
- `route-tool-handlers.ts:90-95` `returnedWhole(text)` makes the same two checks the budget engine makes before it
  returns a text whole (`apply-output-budget.ts:160-162`): `text.length <= chars` and
  `countTokensPiecewise(text, tokens) <= tokens`. `:121-127` turns a failure into the tool error
  `result exceeds the 64000-character / 25600-token tool limit`. So the gate and the budget can no longer disagree.
- `route-tools.ts:120`: the tool description now states both limits.
- Specs:
  - `route-tool-handlers.spec.ts`: new `describe('token-dense 100-phase results (P6 re-review N-1)')`. Case one: a
    varied-reason 100-phase result (58,775 chars, more than 16,000 tokens, within 25,600) returns as success, and
    `applyToolResultBudget` for `ptah_route_decide` returns it with `truncated: false` and byte-identical text. Case
    two: a result under 64,000 chars but over 25,600 tokens is a tool error with the exact limit text.
  - The two existing 100-phase cases now read from `ROUTE_DECIDE_RESULT_BUDGET`.
  - Token pins changed from 16,000 to 25,600: `tool-result-budget.spec.ts:156-159` and
    `mcp-contract.sweep.spec.ts:1495-1497` (with the 2.5 chars/token rationale).
- Comment-only Minors in these files:
  - M-b: the overrides doc again sits on `TOOL_RESULT_BUDGET_OVERRIDES`, and the new constant has its own doc.
  - M-a (doc part): `route-tool-handlers.ts:44-48` `describeZodIssues` doc no longer claims a dispatcher copy.
  - Logic Minor: the stray override-table doc on the constant is gone.

### Logic N-2: HTTP and stdio resolve the outcome-report store inside the handler's `try`

- `mcp-core/tools/outcome-report.handler.ts:37-55`: `handleOutcomeReportToolCall` now takes the resolver
  (`(() => OutcomeReportDependencies | undefined) | undefined`) and calls it inside its `try` (`:51`). A throwing
  store or pipeline factory becomes a tool error on both transports. It is never a rejected promise, which HTTP had
  turned into a JSON-RPC `-32603` that carried a stack.
- Callers pass the resolver and no longer call it: `protocol-dispatcher.ts:2808` (HTTP) and
  `mcp-stdio/agent-tool.dispatcher.ts:347` (stdio). This also covers LT-P6-2 (stdio, same fault).
- Specs:
  - `tools/outcome-report.tool.spec.ts`: the existing case now passes a resolver. A new case checks that a throwing
    resolver gives `{ isError: true, invalidArguments: false, text: 'ptah_outcome_report failed: …' }`.
  - `protocol-dispatcher.spec.ts`, "route and outcome registration": a new HTTP case checks that a throwing
    `resolveOutcomeReport` gives a tool error, not `response.error`.
  - `agent-tool.dispatcher.spec.ts`: a new stdio case checks the same, with `ptah_code: 'mcp_tool_failed'`.

### Style N1: one self-bounded drain registered by `startAndRegisterLaneOutcomes`

- `libs/backend/lane-outcomes/src/lib/di/start.ts`:
  - `:22` `LANE_OUTCOME_DRAIN_BUDGET_MS = 2000`. It has one owner, and its doc explains why it is bounded and why
    nothing is lost on expiry: the pipeline moves queued ops to its KV journal.
  - `:29-35` `LaneOutcomesDisposer { dispose(): Promise<void> }`.
  - `:105-116` `drainOrWarn`.
  - `:119-145` `boundedDisposer` is the one `Promise.race` with a timer. It warns on expiry, logs a failed drain and
    never rejects.
  - `:164` registers the bounded disposer, including the no-op fallback when start throws.
  - Type exported from the barrel at `index.ts:67`.
- Removed:
  - the three host constants: VS Code `main.ts` (old :47), Electron `shutdown.ts` (old :87-88) and CLI
    `shutdown-host-runtime.ts` (old :35);
  - the two hand-rolled races in VS Code `main.ts` (old :208-224) and CLI `disposeSubsystem` (old :90-105);
  - the Electron `withBudget` wrapper around the drain.
- Each host now only calls `dispose()`:
  - VS Code `main.ts:206-218`;
  - Electron `shutdown.ts:278-285` (`refs.laneOutcomesDisposer` is now typed `LaneOutcomesDisposer | null`,
    `boot-coordinator.ts:128-132`, captured at `wire-runtime.ts:557`);
  - CLI `shutdown-host-runtime.ts:138-147` `shutdownLaneOutcomes` through the existing `'dispose'` verb.
- Specs:
  - `lane-outcomes/src/lib/di/start.spec.ts` keeps the partial-start case (now `.dispose()`) and adds three cases:
    - start throws, so a no-op drain is registered;
    - the drain never settles, so `dispose()` settles at exactly the budget with a warn and no timer left (fake
      timers);
    - the drain rejects, so it resolves with a warn.
  - Shape updates to `{ dispose }`: `cli-engine/.../shutdown-host-runtime.spec.ts` (two cases) and
    `with-engine.spec.ts` (ordering case), plus `apps/ptah-electron/src/activation/shutdown.spec.ts`.
  - `apps/ptah-extension-vscode/src/deactivate-order.spec.ts` no longer pins the inline race. It pins one awaited
    `DIContainer.resolve<LaneOutcomesDisposer>(` after `await agentsReaped;` and before `DIContainer.clear()`, and
    that `main.ts` has no `LANE_OUTCOME_DRAIN_BUDGET_MS`.
- Comment Minors:
  - M-c: `tokens.ts:14-17` says the lib registers the disposer.
  - M-e: the redundant local alias in `main.ts` is gone with the rewrite.
  - M-d (code, folded in because `start.ts` was rewritten): the two copied unsubscribe-and-warn loops are now one
    local `unsubscribeAll` (`:56-66`), and the four `instanceof Error` ternaries are one `asError`.

### Style N2: no drain-specific verb in `disposeSubsystem`

- `cli-engine/src/lib/bootstrap/shutdown-host-runtime.ts:63`: `TeardownVerb` is `'disposeAll' | 'dispose'` again.
  The `'call'` branch and its timer are gone, so `disposeSubsystem` is verb-uniform and its two docs are true again.
- `shutdownLaneOutcomes` (`:138-147`) sits beside `shutdownAgentProcesses` and its siblings. It is not added to the
  barrel, matching `shutdownWorkspaceWatcher`.
- Header fixed:
  - item 4 names the token, why it follows the reap and precedes Thoth's SQLite close, and that the drain bounds
    itself (`:17-20`);
  - the order paragraph names the drain;
  - "`mode: 'minimal'` registers neither" now reads "registers none of them" (`:31`);
  - the over-long line 4 is rewrapped.

### Style N3 + S3: load-bearing comments in Electron `shutdown.ts` and CLI `with-engine.ts`

- Electron `apps/ptah-electron/src/activation/shutdown.ts`:
  - `:262-266`: the TASK_2026_584 note is restored: the session spawner is synchronous and holds its place on a path
    Electron does not wait for.
  - `:268-272`: the "guard is HERE rather than inside `reapAgents`" note is restored, and it now names `SQLite close`
    among the steps a hidden microtask would push. This makes the `reapAgents` doc cross-reference "see the comment
    at that call site" (`:319-320`) true again. The drain guard (`:278-285`) is inline for the same reason, and
    says so.
  - `:310-314`: stale "the CLI registry on the next line" now reads "disposed after the reap in
    `disposeAfterPersistence`".
  - `:403-412`: `requiresDeferredDisposal` doc says three handles qualify: the gateway, the agent manager (now also
    naming its lane-outcome write) and the lane-outcomes drain.
  - `:566-571`: the undeferred-path comment says the only two awaits are the reap and the drain, and that `false`
    means neither exists.
  - `:238-247`: `disposeAfterPersistence` doc restores the "nothing in here before the gateway has SETTLED"
    invariant and states the reap -> drain -> close order inside it.
  - `:28-38`: the module header is rewrapped and accurate: it names what defers a quit, and that the drain bounds
    itself.
  - `:103`: M-e "the two budgets above" now reads "the budgets above".
  - `:360-363`: `withBudget` doc notes that the drain is the one self-bounded await.
  - `:436-438`: `disposeBootRefs` doc names the three awaits.
  - `:556-558`: the `handleWillQuit` doc line is rewrapped.
- CLI `libs/backend/cli-engine/src/lib/bootstrap/with-engine.ts:431-442`: the TASK_2026_323 B11 / TASK_2026_326
  rationale is restored beside the call. A spawned agent is a child of this process and `process.exit` orphans it,
  and the call also stops the proxy leases. The P6 constraint follows it: the drain runs before `disposeThoth`
  closes SQLite.

## Checks

- `ptah_get_diagnostics` (errors), scoped to the changed files:
  - lane-outcomes (`start.ts`, `start.spec.ts`, `index.ts`): 0 errors.
  - vscode-lm-tools (all eight changed files): 0 errors.
  - cli-engine (four files): 0 errors.
  - The Electron and VS Code app files (`shutdown.ts`, `shutdown.spec.ts`, `boot-coordinator.ts`,
    `wire-runtime.ts`, `main.ts`, `deactivate-order.spec.ts`) are UNCHECKED. The TypeScript check was still running
    after 45 s on each of four attempts. The orchestrator's typecheck must cover them.
- No Jest, Nx, tsc or lint run (batch rule). For the orchestrator: specs to run are
  - `lane-outcomes` `start.spec.ts`;
  - vscode-lm-tools `route-tool-handlers.spec.ts`, `tool-result-budget.spec.ts`, `mcp-contract.sweep.spec.ts`,
    `tools/outcome-report.tool.spec.ts`, `protocol-dispatcher.spec.ts`, `mcp-stdio/agent-tool.dispatcher.spec.ts`;
  - cli-engine `shutdown-host-runtime.spec.ts`, `with-engine.spec.ts`;
  - Electron `activation/shutdown.spec.ts` and `main.quit-path.spec.ts` (by Jest config, per decision #103);
  - VS Code `deactivate-order.spec.ts`.
- Fixture numbers (58,775 chars / 24,655 tokens; 62,775 chars / 26,936 tokens) were measured with a standalone Node
  script against the installed `gpt-tokenizer`. The specs assert the char count exactly and the token counts as
  ranges.

## Not done, and why

- M-a (code part): moving `describeZodIssues` into a neutral `zod-issues.ts` is a code move, not a comment. Only the
  false doc was corrected.
- M-d (second half): `startLaneOutcomes` stays exported from the barrel. Removing a public export is outside this
  correction.
- Logic Minors that are not comments:
  - outer drain budget strictly larger than the pipeline's inner `DISPOSE_DEADLINE_MS` (both still 2,000 ms; the
    late journal append lands in the KV journal);
  - narrowing the S-3 no-workspace guard to `deliverables`;
  - a debug log for writes dropped after close;
  - logging the over-cap route path.
- Logic N-3 and N-4 are already queued as LT-P6-8 and LT-P6-9 (decision #105).
- Behaviour note: the Electron drain no longer goes through `withBudget`, so its timeout warning now comes from the
  lane-outcomes logger, not `console.warn`. The Electron spec stub still never settles until released, so the
  ordering assertion is unchanged.
