# Code Logic Review - A5 (TASK_2026_714_c8a2)

Score: 8.5/10. Verdict: APPROVE. Blocking: 0. Serious: 0. Moderate: 0. Minor: 2.

## Evidence

- Compaction/idle: codexProxy removed from CompactionSessionClass (compaction-state.types.ts), canAct (compaction-coordinator.ts:75), IdleSessionState/initialState, reducer noArmReason and session-bound (idle-session.reducer.ts:52,109), fire gate (idle-fire-gate.ts:50), signal and sessionBound signature (idle-compaction.types.ts:38,235; idle-compaction.service.ts:505). The only producer always passed codexProxy:false (session-query-executor.service.ts:1618 before), so the removed branches were unreachable; remaining lanes behave identically. All sessionBound callers and register() calls repo-wide compile against the new arity; specs moved the old 4th arg (nativeAnthropic) to 3rd correctly (idle-compaction.service.spec.ts:167+). The mixed-in RouteAwareIdleSignals type was folded into IdleCompactionSignals, which now carries the optional nativeAnthropic arg.
- Backward compat: compaction/idle state is in-memory (no JSON.parse/persist in compaction/*.ts), so no stored codexProxy field is deserialized.
- ICodexOwnerKeySource folded into ICodexAccountUsageService (codex-provider.types.ts:~103); CodexAccountUsageService and ProviderOwnerResolver (provider-owner.resolver.ts:~480) use the single interface; the DI token SDK_CODEX_ACCOUNT_USAGE is unchanged; git grep finds no remaining ICodexOwnerKeySource, resolveCodexProxyPolicy or codex-proxy-policy reference in libs/apps/tools. currentOwnerKey spec coverage retained (codex-account-usage.service.spec.ts).
- Policy fold: isNativeCodexAuthIntent (codex-native-runtime-refusal.ts) has the exact old condition; hostNativeCodex is z.boolean().default(false) (auth-strategy.types.ts:28) so the return type is a plain boolean (no strict-TS issue). auth-manager.ts:167,253 and oauth-proxy.strategy.ts use it with negation/equality preserved. A3 refusal and legacy-session-start path intact.
- CODEX_PROXY_TOKEN_PLACEHOLDER kept in shared and auth-providers; comments updated only. Other provider proxies and MCP untouched.

## Minor

- idle-compaction.types.ts:141 skip reason not-actable is now never produced (only emitter was the removed fire-gate line). Dead union member; remove or document.
- The removal of codex-proxy-policy.spec.ts relies on AuthManager/OAuth strategy specs for coverage of the legacy-session-start exception; no dedicated unit spec for isNativeCodexAuthIntent. Add a 3-case spec.

Not run (read-only): typecheck/tests. Symbol greps found no dangling imports.
