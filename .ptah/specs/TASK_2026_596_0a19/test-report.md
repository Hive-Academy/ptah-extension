# Test Report - TASK_2026_596_0a19 (Batch 22, fixture sweep)

## Scope

- User request: prove fixtures F1-F83 (incl. F13a, F67b) and the G3 restart fixture are covered by specs, add only what is missing (specs only), run the Batch 22 verification.
- Method: spec names carry few F-numbers, so three read-only mapping passes matched each fixture to a spec by behaviour, reading the test bodies. Roots are repo-relative under `libs/`.
- Recorded decisions honoured (the spec proving the recorded behaviour is the mapped one): AS5 daemon case stays unknown; Antigravity owner stays `cli-store` (TASK-596-FU-PHASE4); lane model scope `null` (TASK-596-FU-PHASE6); G1 `utilization` is never ingested (F13a asserts unset).
- No production edits. No live network, forced 429 or rollout read. Settings paths and 597-deferred files untouched.

## Fixture to spec map

Line numbers are the `it()` lines the mapping passes reported. Where a row gives a file only, the assertion exists in that file but its line was not captured.

| Fixture(s) | Spec | Status |
| --- | --- | --- |
| F1, F5-F10 | `shared/src/lib/utils/plan-limits/instants.spec.ts` (F10 at :108-:120) | COVERED. F10 asserts the deadline stays exactly 7 d; ADDED round 2: a deadline has no duration, so `windowKindFromDuration` gives `other`, never `weekly` |
| F11, F12 | `shared/src/lib/utils/plan-limits/window-state.spec.ts` | COVERED |
| F2-F4, F22, F25 | `shared/.../plan-limits/window-state.spec.ts`, `lane-state.spec.ts` | COVERED |
| F21 | `shared/.../plan-limits/evidence-precedence.spec.ts` | COVERED |
| F13, F13a, F14, F15, F16 | `backend/agent-sdk/src/lib/helpers/plan-limits/claude-rate-limit.mapper.spec.ts` | COVERED (F13a: `utilization` never ingested, G1) |
| F17-F20, F24, F25 | `backend/auth-providers/src/lib/quota/plan-limit-ledger.service.spec.ts`, `shared/.../lane-state.spec.ts` | COVERED |
| F23 | `plan-limit-ledger.service.spec.ts:490` | COVERED. Round 2 ADDED: a ledger window whose reset passed with no newer observation classifies as `reset-usage-unknown` via the shared `classifyWindow`. Removal after the longest window stays asserted at :490 |
| F26-F29 | `backend/auth-providers/src/lib/quota/readers/{claude,codex}-plan-usage.reader.spec.ts`, `codex-account-usage.service.spec.ts` | COVERED |
| F30-F32 | `quota/plan-usage.service.spec.ts` | COVERED |
| F33 | `quota/readers/{ollama-cloud,antigravity}-plan-usage.reader.spec.ts` | COVERED |
| F34-F40 | `backend/cli-agent-runtime/src/lib/cli-agents/limits/lane-limit-classifier.spec.ts` | COVERED |
| F41 | `cli-agents/limits/lane-limit-lookup.service.spec.ts` | COVERED |
| F42-F46, F48-F50 | `backend/vscode-lm-tools/.../mcp-core/agent-limit.formatter.spec.ts`, `shared/.../lane-state.spec.ts:459-475` | COVERED. Round 2 ADDED F42-F44 formatter text, asserted verbatim: `unknown (no windows reported)`, `unknown (window set not established, partial data)`, `unknown (5-hour session: aged value)` |
| F47 | `agent-limit.formatter.spec.ts` | ADDED this batch: list-variant sentence "No lane has confirmed room. Near-limit and unknown lanes may still work; every known reset is listed below." |
| F51, F52 | `agent-limit.formatter.spec.ts`, `agent-spawn-limits.transport.spec.ts`, `agent-namespace.limits.spec.ts` | COVERED. Round 2 ADDED F51: at-limit with a known reset (`AT LIMIT (Weekly · Opus, resets 2026-10-05 09:00 UTC)`, warning, "still started") and a failed spawn that keeps the warning and lists alternatives. F52, both transports: spawn under cooldown and under exhaustion still runs (`agent.spawn` called once) with the cooldown or warning text, and a failed lookup never blocks it |
| F53, F54, F56, F58, F60 | `frontend/chat-ui/.../plan-limits/stats-limit-view-model.spec.ts` | COVERED |
| F55 (backend legs) | `cli-agents/limits/owner-lifecycle.integration.spec.ts:310`, `:365`; `session-quota-probe.service.spec.ts:170`, `:212` | COVERED |
| F55 (frontend legs) | `stats-limit-view-model.spec.ts`, `chat-streaming/.../agent-monitor.store.spec.ts` | COVERED in pieces; no single chained test, see residual risks |
| F57, F73 | `chat-ui/.../plan-limits/stats-tile-expansion.state.spec.ts`, `plan-limit-tile.component.spec.ts` | COVERED |
| F59 | `chat-ui/.../session/session-stats-summary.component.spec.ts:514-532` | Tokens covered; Cost card value ADDED this batch (`$38.18` unchanged by lane usage) |
| F61 | `frontend/dashboard/.../provider-account-card.component.spec.ts` (:299 and the 16 numbered cases) | Failure statuses `unsupported-config`, `provider-unsupported`, `cli-unavailable` ADDED this batch (case 16c) |
| F62-F66 | `plan-limit-ledger.service.spec.ts` (F64 at :510), `stream-transformer.plan-limits.spec.ts`, `sdk-callbacks.spec.ts`, `agent-process-manager.service.spec.ts` | COVERED |
| F67, F67b, F68 | `translation-proxy-base.spec.ts:1087`, `plan-limit-ledger.service.spec.ts` (F67/F68 cases in the proxy-observers describe), `provider-owner.resolver.spec.ts`, `codex-translation-proxy.spec.ts:343` | COVERED. Round 2 ADDED F67: owners A and B each keep only their own cooldown and are `different`. F68: an unattributed cooldown sits under an unknown owner; `ownerRelation` with any known owner is `unknown`, so no lane borrows it |
| F69-F72, F79, F81-F83 | `plan-limit-owner-discovery.service.spec.ts:140-305`, `plan-limits-snapshot.service.spec.ts`, `provider-rpc.handlers.spec.ts`, `plan-credential.source.spec.ts` | COVERED |
| F74 | `plan-limit-ledger.service.spec.ts` | COVERED for 100 owners surviving; no owner cap exists to push past |
| F75, F76 | `stream-transformer.plan-limits.spec.ts` | COVERED |
| F77 | `session-quota-probe.service.spec.ts:170`, `:212` | COVERED. G2 per-turn path: two queries with different `accountInfo()` results, query replacement, assistant `authentication_failed` |
| F78 | `provider-owner.resolver.spec.ts` | COVERED |
| F80 | `provider-quota.store.spec.ts:221-268`, `plan-limit-ledger.service.spec.ts:610` | PARTIAL: 2xx, 3xx and unknown owner covered; no credit-provider case at the proxy boundary |
| G3 restart (run A, no ledger evidence, session moves to B, restored run A is "Different owner"; malformed value restores as "Unknown owner") | `owner-lifecycle.integration.spec.ts:310`, `:365`; `agent-sdk/.../quota-owner-ref.schema.spec.ts`; `session-metadata-store.spec.ts`; `agent-process-manager.restore.spec.ts` | COVERED |

## Specs added

- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/agent-limit.formatter.spec.ts`: F47 list variant.
- `libs/frontend/dashboard/src/lib/components/provider-account-card/provider-account-card.component.spec.ts`: case 16c (F61 failure statuses).
- `libs/frontend/chat-ui/src/lib/molecules/session/session-stats-summary.component.spec.ts`: F59 Cost card assertion.
- Round 2: `shared/.../plan-limits/instants.spec.ts` (F10), `auth-providers/.../quota/plan-limit-ledger.service.spec.ts` (F23, F67, F68), `agent-limit.formatter.spec.ts` (F42-F44, F51 x2), `agent-spawn-limits.transport.spec.ts` (F52 x3, each run over both transports).

## Defects found

None. No fixture needed a production change to pass.

## Execution

- `npx nx run-many -t typecheck,test,lint -p <12 libs>`: the only failure is `@ptah-extension/auth-providers:test` in `translation-proxy.sdk.integration.spec.ts` (5 failed, 1524 passed, 60 of 61 suites). All 5 are EPERM/ENOTEMPTY `removeTree` teardown on the Windows temp dir. This is a known environment item, not a new failure. `@ptah-extension/agent-sdk:test` was flagged flaky by Nx; it passed.
- `npx nx run-many -t typecheck -p ptah-extension-vscode ptah-electron ptah-cli ptah-extension-webview`: 4/4 pass.
- Guard specs: `vendor-roster-drift`, `lane-rule-single-home`, `agent-spawn-surface-parity` (vscode-lm-tools) and `rpc-allowlist` (rpc-handlers) are green inside the project runs. `no-alpha-base-content` run on `ptah-extension-webview`: 11 passed. `session-stats-summary.component.spec.ts` is green.
- Round 2 run: `nx run-many -t test,typecheck,lint -p @ptah-extension/shared @ptah-extension/auth-providers @ptah-extension/vscode-lm-tools`: the only failed task is `auth-providers:test`, the same 5 known EPERM/ENOTEMPTY failures in `translation-proxy.sdk.integration.spec.ts` (1526 passed, up 2 from the new ledger cases). shared and vscode-lm-tools pass test, typecheck and lint.
- After adding the first-round specs: `nx run-many -t test,typecheck,lint` for vscode-lm-tools, dashboard and chat-ui passed. My first F59 edit failed because `text` is not in scope in that block; I switched it to `querySelector` and the rerun passed.
- Nx Cloud is disabled (401); local execution is unaffected.

## Verdict

- Proven: F1-F79, F81-F83 (F80 and F55 as noted below), the G2 per-turn path, and G3 restart and malformed restore.
- Residual risks (documented, not defects):
  - F80: no credit-provider case at the proxy boundary (2xx, 3xx and unknown owner are covered).
  - F55: pieces exist, but there is no single chained test across probe, ledger, resolver, `agent-events`, `AgentMonitorStore` and the view model.
  - F68 is proven at ledger and `ownerRelation` level; `LaneLimitLookupService` itself is mocked at the snapshot seam, so the lookup does not run the ledger end to end.
  - Line numbers in the map are those the mapping passes reported; I did not re-read every body myself.
- Known environment items: EPERM/ENOTEMPTY teardown in `translation-proxy.sdk.integration.spec.ts`. The PowerShell "timeout kill" case, the header-deadline timing test, the `opencode-translation-proxy.spec.ts:654` timing and the `plan-usage.service.spec.ts` watch item did not fail in this run.
