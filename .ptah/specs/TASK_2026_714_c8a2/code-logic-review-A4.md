# Code Logic Review - Removal A step A4

Scope: uncommitted A4 diff (10 files, +11/-2317) in worktree codex-removal-a. Read-only; no tests run.

## Summary

| Metric | Value |
| --- | --- |
| Score | 8/10 |
| Verdict | APPROVE |
| Blocking | 0 |
| Serious | 0 |
| Moderate | 1 |
| Minor | 3 |

## Checks

1. Nothing live needs the deleted code: PASS.
   `git grep` (excluding `.ptah` and `tools/mcp-bench`) for `SDK_CODEX_PROXY`, `SDK_CURATOR_CODEX_PROXY`, `SdkCodexProxy`, `SdkCuratorCodexProxy`, `CodexTranslationProxy`, `codex-translation-proxy`, `codex-stream-parity` and `translation-proxy.sdk.integration` returns zero hits in `libs/` and `apps/`. That covers DI composition roots, `container.smoke.spec.ts`, `expected-resolvable.ts`, `surface-composition.spec.ts`, jest mocks and e2e fixtures. The only hits are historical `tools/mcp-bench` data, which is intentionally reverted. `providers/codex/index.ts` and `auth-providers/src/index.ts` drop only the proxy export. `CodexAuthService`, `CodexHomeResolver`, `CodexAccountUsageService`, `CODEX_PROVIDER_ENTRY` and `CODEX_PROXY_TOKEN_PLACEHOLDER` stay exported. The placeholder is still imported by `sdk-model-service.ts:24`, `sdk-query-options-builder.ts:131`, `provider-owner.resolver.ts:50` and `sdk-query-runner.service.ts`.

2. session-query-executor change: PASS.
   - `session-query-executor.service.ts` (the `switch` in `resolveCapacityRoute`, around line 150) drops only the `CODEX_PROXY_TOKEN_PLACEHOLDER` case. Copilot, Kimi Code, OpenRouter, native Anthropic and the `getAllAnthropicProviders` matching are unchanged. Native Codex runs through `codex-app-server` and never uses this ANTHROPIC_BASE_URL path, so it is unaffected.
   - A stale `codex-proxy-managed` env now classifies as `{kind:'proxy', providerId:null}` instead of `openai-codex`. It is not swallowed here. Fresh Codex proxy requests are refused upstream by `codexNativeRuntimeRequired` at `provider-auth-resolver.ts:166,561`, `provider-proxy-pool.ts:229`, `curator-proxy-manager.ts:67` and `workspace-provider-profile-resolver.ts:537`. This matches HEAD behavior, where the executor only classified.
   - `codexProxy: false` is now hard-coded at the `CompactionSessionTap` registration (executor ~line 1628). The `codexProxy: true` branch for Codex was the only producer of `true`. Other sites already pass `false`: `idle-compaction.service.ts:178` and `idle-compaction.helpers.ts:89`.
   - Spec edits swap the Codex fixtures for the Kimi fixtures. The `bound(... true ...)` expectation becomes `false`, matching the hard-coded value. The Codex-only "classes the Codex proxy route as codexProxy" test is removed with its behavior.

3. Deleted integration spec: no lost non-Codex coverage.
   `git show HEAD:.../translation-proxy.sdk.integration.spec.ts` shows it built only `CodexTranslationProxy` (line 845). Its main suite was already `describe.skip('TASK_2026_408 Batch 9 - retired proxy; A4 deletes it')` (line 915). The `describe.each` at line 1249 sits inside that Codex proxy harness. No Copilot, OpenRouter or Kimi proxy cases were lost, and the suite was not running anyway.

4. translation-proxy-base.spec.ts: PASS.
   Only the `CodexLaneProbe` class, the Codex Responses-lane test and the Codex forced-SSE test are removed. The Copilot, OpenRouter and Local probes and the shared base suites (Responses terminal parity, native headers) remain. The `requiresResponsesStream` base hook is exercised no more for Codex, but no other provider in the file overrides it, so nothing else loses coverage.

5. Untouched: PASS. `git status` shows no changes to other provider proxies, `translation/` base source, `codex-native-runtime-refusal.ts` or MCP.

6. Degradation-audit markers: PASS. The deleted proxy files carried their own markers, which are deleted with them. The remaining markers in `executor` (`resolveCapacityRoute` catch) and `codex-home-auth.service.ts` are intact and still attached to their code.

## Findings

### Moderate

- M1. `session-query-executor.service.ts:~1628`: `codexProxy: false` is a literal while `CompactionSessionClass.codexProxy` (`compaction-state.types.ts:77`), `idle-compaction.types.ts:41,130,188,238`, `idle-fire-gate.ts:53` and `idle-session.reducer.ts:55` keep an unreachable `codex-proxy` lane. This is not a defect. It is a dead branch that tests still pin (`compaction-coordinator.spec.ts:64,377,445`). Track it for a later Removal A step so it does not rot. Do not expand A4.

### Minor

- m1. `sdk-model-service.ts:538,1043` and `sdk-query-options-builder.ts:216` still special-case the Codex placeholder. They are intentional stale-env guards, with specs at `sdk-model-service.spec.ts:160` and `sdk-query-options-builder.spec.ts:2142`.
- m2. `executeQuery` does not itself refuse a hand-crafted `authEnvOverride` that carries the Codex placeholder. It would classify the env as an unknown proxy and attempt the launch. This is the same as HEAD, and the refusal sits at auth resolution. Only the one-shot runner (`sdk-query-runner.service.ts:705`) guards it. Consider a defense-in-depth refusal later; no change needed in A4.
- m3. `CODEX_PROXY_TOKEN_PLACEHOLDER` is still a public export used by guards. Keep it until the stale-env guards go.

## Five logic questions

1. Silent failure: none new. Stale Codex env degrades to `providerId:null` (m2), identical to HEAD.
2. Unexpected user action: a user with a persisted Codex proxy profile gets the A3 `AuthRequiredError`, not this path.
3. Wrong answer from data: capacity route for a stale Codex placeholder is `null` provider instead of `openai-codex`. This is observability only.
4. Dependency failure: not applicable. A DI token removed with no resolvers left means no runtime resolve failure. The grep is clean.
5. Missing: none that blocks A4. See M1.

## Verdict

APPROVE, 8/10, confidence MEDIUM-HIGH. I did static analysis only, with no test run per instructions. Residual risk is a type or lint failure from a stale import, which `git grep` shows is unlikely.
