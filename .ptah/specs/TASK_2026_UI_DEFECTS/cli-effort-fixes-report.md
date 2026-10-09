# CLI effort fixes report

## Part A

1. The frontend `ProvidersOrchestration` projection omitted Grok and Antigravity effort fields even though the RPC already loaded and saved them. Added both keys to `ProvidersOrchestrationField` at `libs/frontend/core/src/lib/services/providers-settings.types.ts:74-75`; the existing settings state load/save path now retains them through its typed orchestration patch.
2. The matrix-row prototype did not include Grok, so the new effort assertion could not locate its row. Added the Grok detection fixture and updated its ordered-row expectation in `libs/frontend/chat/src/lib/settings/ptah-ai/cli-matrix-rows.spec.ts`.
3. The matrix component spec still asserted Antigravity had no effort UI and Ptah instances displayed `mapped`. It now asserts Antigravity's default selector and the new Ptah instance default selector at `libs/frontend/chat/src/lib/settings/ptah-ai/cli-orchestration-matrix.component.spec.ts:248-256`. The parallel `ptah-provider-mark` changes were preserved.
4. `MonitoredAgent.cacheReported` is readonly. `onAgentOutput` now replaces the immutable object at `libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts:1287,1320`, rather than assigning that property.
5. Antigravity resolution tests now expect `xhigh` and `max` to be retained, and expect its persisted setting to win before the reviewer default. `minimal` continues mapping to `low` in `mapEffortToAgy` at `libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-spawn-policy.ts:203`, because `agy` accepts `low` but not `minimal`.
6. The requested representative RPC suite fails before tests execute due to an unrelated parallel edit: `libs/backend/auth-providers/src/lib/providers/codex/codex-account-usage.service.ts:154` has `TS1005 ':' expected` (with adjacent unreachable/type-overlap diagnostics). The same compile error prevents the requested run-many command from reaching these projects. This file is outside the task diff and was not changed here.

## Part B — Ptah CLI instance effort

Implemented end-to-end.

- Persisted `reasoningEffort` on `PtahCliConfig` and returned it in `PtahCliSummary`: `libs/shared/src/lib/types/ptah-cli.types.ts:31,63` and `libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry.ts:269`.
- Extended `ptahCli:update` with a Zod-validated `'' | low | medium | high | xhigh | max` input contract at `libs/shared/src/lib/types/rpc/rpc-agents.types.ts:344-354`; the handler validates and persists it at `libs/backend/rpc-handlers/src/lib/handlers/ptah-cli-rpc.handlers.ts:191-192`.
- Passed a nonblank saved value to Claude Agent SDK `query()` as `options.effort` at `libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry.ts:804`.
- Replaced the instance `mapped` matrix cell with the same popover selector UX, including save/undo and provider-default reset: `cli-orchestration-matrix.component.ts` and `cli-model-effort-popover.component.ts:228-231,490-498`. Matrix row construction supplies its persisted value at `cli-matrix-rows.ts:389`.
- Added instance-row coverage in `cli-matrix-rows.spec.ts` and updated component expectations.

## Verification

- Targeted CLI-runtime effort tests initially exposed the expected stale Antigravity assertions; after updating the policy mapping, the relevant changed behavior is covered. The prior run showed 158 passing tests and only the two stale `minimal` expectations before the mapping adjustment.
- Representative RPC test: blocked at TypeScript compilation by the unrelated Codex account usage syntax error above.
- Required scoped command was run once:
  `npx nx run-many -t typecheck,test -p @ptah-extension/cli-agent-runtime,@ptah-extension/rpc-handlers,@ptah-extension/chat,@ptah-extension/chat-streaming --parallel=2 --output-style=static`
  Its filtered output was `codex-account-usage.service.ts(154,36): error TS1005: ':' expected.`

## Decisions

- A blank persisted Ptah instance effort means provider default and is omitted from SDK query options.
- The SDK scale is deliberately separate from the Codex/Copilot setting list because Ptah instances support `max`.
- No fixes were made to parallel lane-guard, agent-card, provider-icon, or Codex usage work.

## Not done

Full scoped typecheck/test completion is blocked by the unrelated auth-providers compilation error. No test was added for the SDK query option itself because the suite cannot compile until that external error is repaired.
