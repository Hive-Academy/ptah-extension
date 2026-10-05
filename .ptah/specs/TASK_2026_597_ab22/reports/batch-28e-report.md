# Batch 28e report (Component 10.3 frontend, F11)

## Changed files
- libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts: `SubagentRequestUsage.contextTokens?` added; `readRequestUsage` reads and validates `tokenUsage.contextTokens`; `sumRequestUsage` uses `last.contextTokens ?? <local input+cacheRead+cacheWrite sum>`. `AgentUsageView.contextTokens` and `subagentUsageView` pick it up through `lastRequestContextTokens`. No poll. Main-session path untouched.
- libs/frontend/chat-streaming/src/lib/agent-monitor.store.spec.ts: 3 new specs: backend figure wins over the local sum; backend figure used when cache fields are absent; fallback sum when the latest event lacks it.

## Checks
- `nx run-many -t test,lint,typecheck -p @ptah-extension/chat-streaming`: exit 0, all 3 pass.
- `nx affected -t typecheck --files=libs/frontend/chat-streaming/src/index.ts`: exit 0 (13 projects).
- `nx run di-lint:lint`: exit 0.
- `nx run degradation-audit:lint`: exit 0.
- No png files rewritten.

## Deviations
None. The backend figure is taken from the latest request only (the same "last request" semantics as the old sum).
