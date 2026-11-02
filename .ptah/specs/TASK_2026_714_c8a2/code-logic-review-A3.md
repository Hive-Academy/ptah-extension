# Code Logic Review - Removal A batch A3 (Remove proxy consumers)

Review family: claude (in-process subagent); implementer: codex

Scope: uncommitted A3 diff in `libs/backend/auth-providers`, `libs/backend/agent-sdk/src/lib/helpers`, token/apps grep. Read-only; no tests run.

Score: 6/10
Verdict: REVISE

## Check results

1. D30 non-Codex behaviour: unchanged. The removed branches in provider-proxy-pool (`case 'openai-codex'`, `ensureCodexReady`), provider-auth-resolver (`assertProxyAuthenticated` Codex arm), the three strategies, curator-proxy-manager and register.ts are Codex-only. Constructor parameter removal in ProviderProxyPool and the strategies keeps the remaining injects intact. Codex home/auth/account-usage registrations (`SDK_CODEX_AUTH`, `SDK_CODEX_ACCOUNT_USAGE`, `CodexHomeResolver`) remain. MCP untouched.
2. Explicit refusal: `AuthRequiredError(providerId: 'openai-codex')` is thrown in `ProviderAuthResolver.resolve` (163), `buildDraftOverride` (563), `ProviderProxyPool` acquire (228), `CuratorProxyManager.ensureProxy` (66) and `getActiveProviderId` (210). The OAuth strategy returns `configured:false` with `errorMessage` (not silent). No fallback to another provider found.
3. DI: no `resolve`/`@inject` of `SDK_CODEX_PROXY` or `SDK_CURATOR_CODEX_PROXY` remains in libs/apps (`git grep`; apps has zero hits). Both token definitions remain in `auth-providers-tokens/src/lib/tokens.ts:41,63` as dead symbols (A4 should delete). `container.smoke.spec`/guards need no change.
4. `codex-translation-proxy.ts` is now referenced only by `providers/codex/index.ts:8`, `src/index.ts:116`, and specs (`codex-translation-proxy.spec`, `codex-stream-parity.spec`, `translation-proxy-base.spec.ts:31/2289`, `translation-proxy.sdk.integration.spec.ts:53`). OK for A4 to delete, but A4 must also rewrite the `CodexLaneProbe` in translation-proxy-base.spec and the SDK integration spec (they use the real Codex proxy as the base-class harness, so deleting the class breaks coverage of TranslationProxyBase, which non-Codex proxies still use).
5. Specs: deleted Codex-only proxy-pool spec content was Codex-only; refusal specs added for pool, resolver, curator, builder. Strict TS/Logger fine. No degradation-audit comments needed in the diff.

## Defects

1. SERIOUS - `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:210` - `getActiveProviderId` (a pure classifier) now throws. Callers that are observational/non-fatal rely on it returning a value: `ModelResolver.warnUnservableTierValue` (model-resolver.ts:133, a log-only path), `isSubscriptionCovered` (175), `resolveForCost` (221), `ptah-cli-spawn-options.service.ts:229`, `sdk-query-options-builder.ts:2025`, `sdk-query-runner.service.ts:708`. A stale env carrying the Codex placeholder now crashes model picking/cost/spawn assembly with an unrelated-looking error instead of the Codex refusal at the real entry. Fix: keep the pure function returning `'openai-codex'` for the placeholder (or null) and raise the refusal only at a single launch gate (resolver/builder `build`), or wrap non-fatal callers. If kept, audit every caller.
2. SERIOUS - stale specs not updated and will fail: `libs/backend/auth-providers/src/lib/auth/model-resolver.spec.ts:58-73,108,119,136,167` (`codexEnv()` goes through `getActiveProviderId`, now throws) and `libs/backend/agent-sdk/src/lib/helpers/sdk-query-runner.service.spec.ts:1318-1385` (expects `openai-codex` provenance from the Codex placeholder). They are outside the 17-file list but are direct consumers of the changed behaviour; A3 left red tests. Fix: rewrite to expect the refusal or move to a non-Codex placeholder; A5 must at least list them.
3. SERIOUS - `libs/backend/skill-synthesis/src/lib/lanes/lane-resolver.service.ts:205-235` - catches only `ProviderAuthError`/`ProviderQuotaError` by name and rethrows everything else. `ProviderAuthResolver.resolve` now throws `AuthRequiredError` (name `AuthRequiredError`) for a Codex lane, and also when `requested===''` and the active provider is Codex (provider-auth-resolver.ts:163 runs before the inherit short-circuit that previously returned `null`). Result: a Codex lane/inherit becomes an uncaught drain defect instead of a lane stall. Fix: map `AuthRequiredError` to a stall in the lane resolver, or decide explicitly (D30) that inherit-with-native-Codex active must return `null` and only an explicit `requested==='openai-codex'` throws.
4. MODERATE - `provider-auth-resolver.ts:163` - behaviour change for the inherit case beyond "remove consumer": see 3. Also the throw precedes `assertNotCoolingDown`, so a Codex quota cooldown is no longer surfaced (acceptable, but unspecified).
5. MODERATE - `draft-verification.service.ts:339-345` - `buildDraftOverride` now throws `AuthRequiredError`; no spec asserts the draft probe classification for it (draft spec only removed codex mocks). Add a test that the failure maps to an auth reason rather than "unknown".
6. MINOR - Duplicated literal message/providerId in five throw sites (`provider-auth-resolver.ts:163,563`, `provider-proxy-pool.ts:228`, `curator-proxy-manager.ts:66`, `sdk-query-options-builder.ts:210`) plus `oauth-proxy.strategy.ts:280`; extract one helper/constant.
7. MINOR - Dead leftovers for A4/A5: tokens `tokens.ts:41,63`; `CODEX_PROXY_TOKEN_PLACEHOLDER` readers (`session-query-executor.service.ts:154`, `ptah-cli-registry.ts:18,1606`, `provider-owner.resolver.ts:50,86`); `ICodexOwnerKeySource` (index.ts:56, still implemented by CodexAccountUsageService; remove from the proxy-only API when the proxy goes); `CodexTranslationProxy` exports (index.ts:116, codex/index.ts:8); `oauth-proxy.strategy.ts` `ITranslationProxy` import check (still used for Kimi/Copilot likely, fine).

## Verdict

REVISE: non-Codex paths verified unchanged and DI is consistent, but making `getActiveProviderId` throw leaves at least two specs red and risks non-fatal callers crashing; lane-resolver does not handle the new error type.

## Round 1

Scope: Revision 1 diff plus `workspace-provider-profile-resolver.ts` coordinator fix. Read-only, no tests run.

Defect status:
1. FIXED - `getActiveProviderId` is pure again (`sdk-query-options-builder.ts:208-218` returns `'openai-codex'`). Single gate `SdkQueryRunner.launch` (`sdk-query-runner.service.ts:347-360`) wraps all four queryFn call sites (450, 489, 523); interactive chat reaches it through `queryRunner.invokeWithLoadedQuery` (`session-query-executor.service.ts:1869`); one-shots, curator, commit, cron, wizard, gateway all go via the runner or the proxy pool/curator refusal. Non-Codex unchanged (token-equality gate only).
2. FIXED - model-resolver and runner specs rewritten (`model-resolver.spec.ts:68`, `sdk-query-runner.service.spec.ts:1334,1369`); not executed by me.
3. FIXED - `lane-resolver.service.ts:234` maps `AuthRequiredError` to the existing stall path.
4. FIXED - cooldown (`provider-auth-resolver.ts:161`) precedes refusal (`:163`).
5. FIXED - `draft-verification.service.ts:195,667,753` classifies `AuthRequiredError` with `providerId==='openai-codex'` as credential-rejected with a fixed message.
6. FIXED - helper `codex-native-runtime-refusal.ts`. Residual duplicate literals remain in `sdk-query-runner.service.ts:356` (justified by cycle) and `workspace-provider-profile-resolver.ts:519` (same message plus recoveryHint, no cycle; could use the helper).
7. FIXED (deferred correctly) - dead symbols listed for A4/A5 in the report.

DI: no token resolved without registration found; `SDK_CODEX_PROXY`/`SDK_CURATOR_CODEX_PROXY` remain only as unreferenced declarations.

New defects:
R1-1. SERIOUS - `workspace-provider-profile-resolver.ts:270-276` vs `:360,473`. The coordinator fix only changes the early guard. For a stored Claude session in a workspace now set to Codex, `resolveProviderProfileForWorkspace` still calls `resolveAuthForPath` (workspace active = Codex) -> `buildProfile` -> `rejectLegacyCodexProfile` at line 473. So in production the resume of that Claude session is still refused; the new rpc-handlers specs pass only because they mock `resolveProviderProfileForWorkspace` (`chat-session.native.spec.ts:581-583`). Fix: when `existingIdentity` is non-Codex, build the profile for `existingIdentity.providerId` (not the workspace's active auth), or document and assert the intended refusal; add a real (non-mocked) resolver spec for stored-Claude-in-Codex-workspace and stored-legacy-Codex rejection (no `workspace-provider-profile-resolver.spec.ts` covers `existingIdentity` at all).
R1-2. MODERATE - `sdk-model-service.ts:543,1068` and `ptah-cli-registry.ts:553/808` call `getQueryFunction()` outside `SdkQueryRunner.launch`. Model-list probes with a stale Codex placeholder env (`authEnv` spread at 1068-1076) spawn a CLI against a dead proxy URL with an empty prompt; no chat turn, but the refusal is not single-gate for them. Fix: skip/short-circuit when `ANTHROPIC_AUTH_TOKEN===CODEX_PROXY_TOKEN_PLACEHOLDER` in the model probe.
R1-3. MINOR - `workspace-provider-profile-resolver.ts:518-525` reuse `codexNativeRuntimeRequired()` plus recoveryHint instead of a fourth literal.

Score: 7/10
Verdict: REVISE (one real remaining defect, R1-1; the rest is cleanup).

Correction to R1-1: `workspace-provider-profile-resolver.spec.ts` does cover `existingIdentity` (lines ~986-1115) but I did not verify it exercises a stored non-Codex identity through the unmocked profile build; the gap to confirm is that case.

## Round 2

Scope: Revision 2 diff (resolver, sdk-model-service, ptah-cli-registry, specs). Read-only; no tests run.

- R1-1 FIXED. `workspace-provider-profile-resolver.ts:270-296` takes the serving provider from the stored identity, rejects stored legacy Codex first (`:275`), then refuses a stored/active provider mismatch (`:278-283`) before any profile build; `resolveProviderProfileForWorkspace` rechecks at `:370-377` (closes the switch race). Unmocked specs cover stored Claude in a Codex workspace, stored legacy Codex and new Codex without native support (`workspace-provider-profile-resolver.spec.ts:890,915,938`), each asserting `acquire` was not called.
- R1-2 FIXED. Stale-placeholder probes short-circuit before `getQueryFunction()` at `sdk-model-service.ts:538,1043` (spec `sdk-model-service.spec.ts:160` asserts no query load and no spawn); CLI test returns explicit failure (`ptah-cli-registry.ts:588`) and spawn throws a coded `AuthRequiredError` (`:816`), with specs in `ptah-cli-registry-spawn-model.spec.ts:208,219`.
- R1-3 FIXED. `rejectLegacyCodexProfile` reuses `codexNativeRuntimeRequired` (`:537`).

No new strict-TS, Logger, MCP-stripping or frontend-special-case violations found in the touched hunks. The new silent-ish returns are logged (`logger.warn`), so no degradation-audit marker is missing in a way I could see.

Follow-ups (minor, non-blocking):
- MINOR `workspace-provider-profile-resolver.ts:278`: a stored session of one Claude-family provider (for example kimi) in a workspace later switched to another (for example anthropic) is now refused rather than silently running on the workspace provider. This is intended and the message says how to recover, but it is a visible behavior change for non-Codex users; confirm it is wanted and mention it in the PR notes.
- MINOR `sdk-model-service.ts:538,1043`: the probe returns `[]`; a caller that treats an empty list as "provider has no models" could show an empty picker. The existing Codex path likely never reads it, but the caller was not traced end to end.
- MINOR `ptah-cli-registry.ts:588` and `:816` repeat the Codex message literal a fifth time; a use of `codexNativeRuntimeRequired` would remove it (a cycle may be the reason; unchecked).
- MINOR the named-account placeholder branch (`sdk-model-service.ts:538`) has no direct fixture, as the implementer disclosed.

Score: 8.5/10
Verdict: APPROVE
