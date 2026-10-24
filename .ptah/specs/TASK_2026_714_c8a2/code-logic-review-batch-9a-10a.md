# Code Logic Review - TASK_2026_714_c8a2, batches 9a (gateway) and 10a (lanes)

Review family: Claude reviewer, Codex implementer.

Score: 7/10. Verdict: REVISE (no blocking issues; two serious contract gaps to close before 9b/10b wire these in).

Scope read in full: codex-gateway-adapter.ts, codex-gateway-approval-sink.ts (libs/backend/gateway-chat-bridge/src/lib), codex-lane-profile.ts, codex-lane-events.ts (libs/backend/cli-agent-runtime/.../cli-adapters/codex), plus core codex-approval-bridge.ts, codex-parity-gate.ts, codex-runtime.ts:85-97, codex-execution-profile.ts, registration.ts, and the legacy codex-lane-config.builder.ts / codex-lane-budgets.ts / codex-exec-args.ts. Scoped jest: gateway 2 suites / 35 tests pass; lane profile+events 2 suites / 42 tests pass. Nothing is routed to these classes yet, so all findings are latent.

## Findings

1. SERIOUS - Approval reply has no request binding in the sink. codex-gateway-approval-sink.ts:52-67 accepts any bare string from `present(...)` (typed `Promise<unknown>`) as the decision. Nothing in the contract carries a requestId/correlation, so "accept bound to the right request, no cross-chat/cross-request confusion" depends entirely on an unwritten composition (9b) implementation. A presentation that uses a shared pending queue or a delayed reply from an earlier prompt would approve the wrong request. Core does validate liveness and dedup (codex-approval-bridge.ts:162-167, 205-235), but not which prompt the user answered. Fix: make `present` return `{ requestId/correlation, decision }`, check it against `request` in the sink and treat mismatch as decline; type the return instead of `unknown`.

2. SERIOUS - Adapter cannot prove the context uses the intended sink. codex-gateway-adapter.ts:46-49 only checks that `sink.request` is a function; the sink is never tied to the `CodexContext`. The doc comment (:14-16) says composition supplies "the same sink", but a context opened with any other sink (for example an auto-accept one) passes `assertReady`. The class also accepts any `CodexContext`, so it cannot guarantee it came from `resolveGatedCodexRuntime` (registration.ts:92). The gate check at :50 does hold today (CodexParityGate.isEnabled always returns false, parity-gate.ts:222-227), so startTurn/steer always throw; that is the intended fail-closed state. Fix: take a context factory/handle produced by the gated resolver, or at least a branded type, and drop the vacuous sink check.

3. MODERATE - Any non-terminal `error` event aborts the turn and closes the whole context. Adapter :199-200 throws on `error`, so the `finally` (:91-97) runs `context.close()`. The lane mapper (codex-lane-events.ts:145-146) treats `error` as non-fatal and waits for the terminal; `CodexRuntimeError.retryable` exists. The two consumers disagree, and a retryable/informational error kills the gateway conversation. Fix: yield nothing (or log) on `error` and rely on the terminal, or honor `retryable`.

4. MODERATE - `textFinal` that does not extend the streamed text is silently dropped (adapter :136-142, same for reasoning :149-151). The final text is lost from the gateway message and replaced in the map. The lane mapper handles the same case by emitting the whole final value (events.ts:182-185), so the two consumers differ. Pick one rule; dropping a final answer is the worse silent failure.

5. MODERATE - Usage could be counted twice downstream. Adapter :184-198 emits `message_delta` tokenUsage on each usage snapshot and :205-214 again on `message_complete`. Core snapshots are per-turn totals (and repeated at terminal, per the 10a report), so a consumer that sums events double counts. The lane mapper correctly emits once at terminal. Emit usage only at terminal, or document that these are snapshots.

6. MODERATE - Lane profile defaults `permissionLevel` to `'ask'` (codex-lane-profile.ts:87) while the legacy lane is headless (`approval_policy=never`, builder :148; sandbox `danger-full-access`, codex-cli.adapter.ts:572). That is correct not to copy, but a lane defaulting to approvals with no required sink/owner decision will hang until the core's 240s timeout (approval-bridge.ts:312-315) then decline, and `ask` gives a read-only sandbox, so write tasks fail. Make `permissionLevel` required so 10b must choose, and record the intended lane level.

7. MODERATE - Lane safety relies on a side channel. Settings that the core cannot represent (autoCompactTokens, toolOutputTokenLimit, webSearch, Ptah tool timeout, role delivery) exist only in `requirements` (profile.ts:123-136); a caller that passes only `settings` drops them silently. This is currently safe only because every output has non-empty `suppressedTools` (profile.ts:109-115) and `mcpServers` for Ptah, which the core refuses at open (codex-runtime.ts:87-96), so a native lane cannot start at all. Add a spec/assert that the output is never core-openable until the requirements are enforced, and have 10b fail on any unhandled requirement key.

8. MINOR - `maxTurns: 0` is passed through (profile.ts:116) while `maxBudgetUsd: 0` is treated as unset (:117-118). The core schema requires a positive int, so 0 throws at profile build instead of meaning "unlimited"; confirm legacy semantics and make the two consistent.

9. MINOR - Duplicated rules (token validation, role resend) copy the legacy builder (profile.ts:78-80, 141-153 vs builder validCount) instead of sharing them; drift risk. `toolCompleted` content can be `undefined` if `JSON.stringify` receives an unrepresentable value (events.ts:89-91).

10. MINOR - The gateway has no per-sequence dedup (the lane mapper does, events.ts:32-33); core is expected to be unique, so low risk.

## Focus checks

Approvals (9a): choices are exactly accept/acceptForSession/decline/cancel (sink :8-9). Unroutable and `userInput` requests decline (:36-41). Abort returns cancel (:35, 60) and the abort race removes the late answer (:47-60, 80-91); `dismiss` runs in `finally`. Core, not the sink, turns a timeout into decline and ignores the sink after settle (bridge :302-330). Edit objects become decline + `editNotSupported` (:68-75), matching the core. MCP elicitation is presented like other kinds; core validates `action: accept` before recording a session rule (bridge :246-253). Notices are best-effort and do not block (:94-101). Gap: finding 1.

Event mapping (9a): exactly one terminal, then return (:79-81); failed terminal throws core-sanitized message; usage only as reported (no invention); `finally` closes the context only when no terminal. Gap: findings 3-5.

Lane profile (10a): preserves suppression (agents/plugins/apps/skills/user MCP minus `ptah`, sorted, deduped), Ptah MCP attach with invalid-port warning, zero-omits-budget, role resend replaced as a scalar, `web_search` live/disabled; does not copy `approval_policy=never` or `danger-full-access` (`explicitFullAccess: false`, which the core also refuses). Lane events: terminal returns `terminal` status immediately without waiting for exit (events.ts:147-162); errors are generic text (:171); identity and sequence filtering is present; usage emitted once. No legacy lane file was modified (`git status` clean for libs).

Existing Claude gateway behavior: untouched (9a adds files and one dependency in package.json only).

## Fixes re-review (round 1 of 2)

Verdict: APPROVED with follow-ups (score 8/10). Scoped jest: gateway 2 suites / 47 tests, lane profile+events 4 suites / 134 tests, all pass.

Verified fixed: (1) replies are strict-zod `{requestId, decision}`, mismatch/malformed -> decline, abort -> cancel (sink :69-81); (2) the adapter has a private constructor and `open()` registers its own sink and resolves through `resolveGatedCodexRuntime('gateway')`; (3) non-terminal `error` no longer throws; (4) divergent finals are emitted whole; (5) usage appears once, on `message_complete`; sequence dedup added; (6) `permissionLevel` required; (7) settings are branded and the getter throws until `assertAllRequirementsHandled` receives every key; `maxTurns: 0` omitted. Lane events file is unchanged.

New findings:

R1. MODERATE - The runtime is never closed. `open()` creates a CodexRuntime (via `registerCodexRuntime`) per adapter, but `close()` closes only the context (adapter :60-62). `CodexRuntime.close()` (codex-runtime.ts:124-129) disposes the rule store and all contexts and is documented as the host owner's job; no host owner exists in the adapter's API, so the session-scoped rule store leaks. Return/expose the runtime (or close it in `adapter.close()`).

R2. MODERATE - Partial registration on failure and one runtime per container. `registerCodexRuntime` runs before `open` and before the parity check (registration.ts:30-33 throws "already registered" on a second call). Today the gate always disables, so `resolveGatedCodexRuntime` throws after registration, leaving the container dirty; a retry then fails with a misleading "already registered". Two gateways sharing a container collide on the second `open()`, so every gateway needs its own container (the comment says so, but nothing enforces it). Check the gate before registering, or take a pre-resolved gated runtime instead of registering internally.

R3. MODERATE - The `error` event now injects "Codex reported a runtime error." as `text_delta` into the assistant answer (adapter ~:228-234). A recoverable error pollutes the final text and cannot be told apart from model output. Emit nothing (log) or use an error-typed flat event; the terminal already carries failure.

R4. MINOR - Reply correlation is by `requestId` only. JSON-RPC ids are small per-process integers, so identical ids can exist in other conversations; safe only if each presentation is strictly per-request and per-conversation. Include contextId/threadId/turnId in the reply schema and compare them.

R5. MINOR - `assertReady` still re-checks `this.sink` (vacuous after the constructor proof). Harmless.

Fine: the proof symbol is module-private (not exported), so arbitrary contexts are refused; sequence dedup, required permission level and the `assertAllRequirementsHandled` throw on any missing key are specified in the specs.
