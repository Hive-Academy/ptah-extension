## Batch 28d report (Component 10.2 surface)

**Changed files**
- MODIFIED `libs/backend/rpc-handlers/src/lib/chat/session/chat-subagent-context-injector.service.ts`: two optional ctor params (`SDK_SUBAGENT_BUDGET_MONITOR`, `SDK_COMPACTION_CONFIG_PROVIDER`, both `isOptional`). Each agent line gets ` - advice: resume|fresh (reason)` using `adviseSubagentResume` + `getSnapshot(sessionId, toolCallId)`. Reasons: stopped, budget reached, cold, context at handoff size, or "cache warm, context within budget". A warm agent with advice fresh is excluded from the "resume first" instruction. One short added instruction appears only when advice exists. Existing wording is untouched. No monitor or config provider means no advice and the text is unchanged.
- MODIFIED `libs/backend/rpc-handlers/src/lib/chat/session/chat-subagent-context-injector.service.spec.ts`: 5 new tests (no monitor gives unchanged text, warm resume, cold gives fresh, handoff size gives fresh even when warm, stopped and budget reached).
- MODIFIED `libs/backend/agent-sdk/src/index.ts`: barrel export of `adviseSubagentResume` and the types `SubagentBudgetMonitor`, `SubagentResumeAdvice`, `SubagentResumeAdviceInput`, which were not exported before. `SDK_TOKENS` and `CompactionConfigProvider` were already exported. rpc-handlers already imports from `@ptah-extension/agent-sdk` (e.g. `turn-change-set-recorder.service.ts`), so the module boundary holds.

**Checks**
- `nx run-many -t test,lint,typecheck -p rpc-handlers`: lint and typecheck pass. Test exit 1 from two failures outside 28d. (1) `voice-rpc.handlers.spec.ts` hit a 5s timeout under load. Re-run alone it passes (78/78 together with the injector spec). (2) `chat-session-budget.spec.ts:125` raises TS2554 "Expected 7 arguments, but got 6", a constructor arity change from a concurrent batch, not this file.
- Typecheck of the affected set (thoth-runtime, cli-engine, ptah-cli, ptah-tui, ptah-electron, ptah-extension-vscode; `api-*`, license-server and landing-page-e2e excluded): exit 0.
- `di-lint:lint`: exit 0. `degradation-audit:lint`: exit 0. No `*.png` changed.

**Deviations**
- `adviseSubagentResume` needs `handoffTokens`, which the monitor snapshot does not expose. So the injector also takes the `SDK_COMPACTION_CONFIG_PROVIDER` optionally and reads `getConfig().subagentHandoffTokens`. Advice is omitted if either optional dependency is absent.
- `chat-session-budget.spec.ts` needs an owner to fix the 6-versus-7 constructor arguments.
