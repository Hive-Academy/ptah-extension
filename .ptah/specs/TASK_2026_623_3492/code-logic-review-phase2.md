# Phase 2 Code Logic Review — TASK_2026_623_3492

**Score: 6/10 — REVISE**

Scope reviewed: the complete Batches 7–12 diff `f0d5df3a4..c8c137611`, including all changed implementation and test files, the R10 requirements, implementation-plan D13/R10.1–R10.4, decisions #18/#41–#44, and the root instructions. No code-style findings are repeated. The score is above 5 because the normal lookup, formatter identity, capability gate, fixed handling for thrown/undefined lookup, and no-refresh/no-lane-call constraints are concretely implemented and tested. It is below 7 because malformed dependency output can bypass the privacy-preserving fixed error and invalid `null` input is accepted.

## Findings

1. **Serious — malformed `agent.limits()` output bypasses the fixed-text privacy/error boundary.** `libs/backend/rpc-handlers/src/lib/handlers/lane-plan-limits-rpc.handlers.ts:108-127` catches only rejection while awaiting `agent.list()`/`agent.limits()`, and accepts every non-`undefined` resolved value. It then invokes the formatter and dereferences `limit.state.state` outside that `try` at `:86-99`. `formatPlanLimitRows` immediately calls `limits.flatMap` (`libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/agent-limit.formatter.ts:233-238`) and `planLimitRows` dereferences nested row/state/window fields (`:185-221`). The RPC dispatcher returns an uncaught error's `error.message` to the caller (`libs/backend/vscode-core/src/messaging/rpc-handler.ts:234-237`) and reports the exception (`:344-347`).

   Failure scenario: a future/partially wired `agent.limits()` resolves `null`, a non-array, or an array with one malformed lane object rather than rejecting. Formatting/counting throws after `lookup()` has returned. The client receives the raw error rather than decision #42's fixed `Lane plan limits are unavailable on this host` text; an error originating in a dependency/getter can include a lane, path, account, or provider data and is also captured by error reporting. Treat the resolved lookup result as an untrusted boundary: validate its array/row shape, or wrap all response formatting/counting in the same fixed-text, cause-dropping error path. Add cases for `null`, non-array, and malformed rows that assert fixed caller text and no logged/reported sentinel.

2. **Moderate — an explicit invalid `null` payload is silently converted into valid empty input.** `libs/backend/rpc-handlers/src/lib/handlers/lane-plan-limits-rpc.handlers.ts:78` calls `LanePlanLimitsParamsSchema.safeParse(params ?? {})`; consequently `null` becomes `{}`. The strict schema itself correctly rejects non-objects/extra fields (`libs/backend/rpc-handlers/src/lib/handlers/lane-plan-limits-rpc.schema.ts:12`), but it never sees `null`. The only invalid-input cases in `lane-plan-limits-rpc.handlers.spec.ts:471-485` are extra-object fields and a string; `null` is absent.

   Failure scenario: a buggy or incompatible webview sends JSON `null`. It triggers the plan-usage lookup and returns a success-looking response instead of `INVALID_PARAMS`, concealing a client-contract defect and violating the required rejection of invalid parameters. Normalize only `undefined` (the allowed omitted RPC payload) to `{}`; pass `null` to Zod and pin the rejection before API construction.

## Five logic questions

1. **Silent failure:** explicit `null` is presented as a valid empty request at `lane-plan-limits-rpc.handlers.ts:78`; the caller gets a normal result rather than learning its request was invalid.
2. **Unexpected user action:** an Electron panel issuing `null` during a client-version/protocol mismatch performs a real plan-limit lookup instead of receiving `INVALID_PARAMS` (`lane-plan-limits-rpc.handlers.ts:78-86`).
3. **Wrong answer input:** an empty valid roster is handled correctly as `[]` (`agent-limit.formatter.ts:233-238`), but a malformed resolved `limits` value is not distinguished from a valid array in `lane-plan-limits-rpc.handlers.ts:123-127`; it becomes a raw failure rather than the required unavailable result.
4. **Dependency failure/timeout/wrong shape:** rejected `list()` and `undefined` limits are cleanly converted to fixed text (`lane-plan-limits-rpc.handlers.ts:110-126`), and the underlying lookup turns per-lane errors into rows (`agent-namespace.builder.ts:500-518`). Resolved malformed results remain unhandled, as Finding 1 shows.
5. **Missing requirement case:** R10 specifies unavailable/failed lookup behaviour but does not explicitly prescribe a runtime validation boundary for a malformed resolved API value. Given the privacy rule and the RPC dispatcher exposing `error.message`, that case needs an explicit fixed-error contract and regression test.

## Confirmed behaviour

- The handler invokes only `agent.list()` and `agent.limits(rows)` (`lane-plan-limits-rpc.handlers.ts:111-113`); the read-semantic proxy test verifies no lane-affecting method and no `refresh` argument (`lane-plan-limits-rpc.handlers.spec.ts:411-451`). The lower lookup passes only `{ signal }` to the usage reader (`lane-limit-lookup.service.ts:185-188`; regression test `lane-limit-lookup.service.spec.ts:292-327`).
- Formatting is shared: `formatPlanLimitsSection` calls `formatPlanLimitRows` (`agent-limit.formatter.ts:233-245`), and `formatAgentList` calls that section (`mcp-response-formatter.ts:1827-1835`). The handler maps only cells 0–4 field-by-field (`lane-plan-limits-rpc.handlers.ts:88-100,136-144`), while tests pin cell five/source exclusion and exact response keys (`lane-plan-limits-rpc.handlers.spec.ts:347-373`).
- The API cache is synchronous and only assigned after a successful `build()` (`lane-plan-limits-rpc.handlers.ts:130-133`), so concurrent reads cannot create duplicate asynchronous builds or retain a rejected promise; the retry-after-throw test is at `lane-plan-limits-rpc.handlers.spec.ts:534-556`.
- Capability gating is manifest-based (`manifest.ts:469-477`), defaults off (`host-profile.ts:67-97`), and is enabled by Electron only (`apps/ptah-electron/src/rpc-host-profile.ts:45-49`). VS Code and CLI/TUI expected-absent surface assertions include the method (`apps/ptah-extension-vscode/src/di/rpc-surface.spec.ts:34-37`; `libs/backend/cli-engine/src/lib/rpc/rpc-surface.spec.ts:38-54,116-169`).
- No TODO/PLACEHOLDER/STUB marker or empty implementation body was found in the changed production paths.

## Verification

- `git diff --check f0d5df3a4..c8c137611` reported no whitespace errors.
- Existing batch evidence reports the targeted shared, formatter, handler, Electron, VS Code, and CLI suites passed with the documented command-line `marked` mapper override (Batches 7–12 in `batches.md:531-570,633-667,687-690`).
- I ran the single permitted local Jest command for `lane-plan-limits-rpc.handlers.spec.ts`. It ran zero tests because this worktree has no `node_modules` and the repository mapper resolves `marked` under the worktree; per the one-Jest-command limit it was not rerun with the documented external mapper. This is verification-environment uncertainty, not evidence against the batch-recorded successful run.

## Decisions

- Decision #42's fixed-text, cause-dropping rule is correct for thrown/undefined lookup, but must also cover malformed resolved output to preserve its privacy rationale.
- Decision #18 is honoured by the implemented normal read path; no refresh, spawn, stop, or session operation is reachable from this handler.
