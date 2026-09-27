# Code Logic Review — `TASK_2026_408`

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 8/10 |
| Assessment | APPROVED |
| Blocking issues | 0 |
| Serious issues | 0 |
| Moderate issues | 1 |
| Failure modes found | 1 |

Scope: Batches 7 and 8 only, current files in `D:\projects\ptah-extension-task-408`. Both production files and both specs were examined across their full executable contents, along with task context, the relevant implementation-plan/batch contracts, and downstream readers. No source edits or git operations were performed. Other in-progress translation changes were not reviewed.

Reviewer-contract limitation: the higher-priority role requires the recognized filename `code-logic-review.md` and prohibits git operations. Consequently this report was written here rather than the requested `code-logic-review-b7-b8.md`; no baseline diff was obtained. Statements about preserved behavior compare current code with the supplied contracts and consumer evidence, not an independently verified diff. No `task-description.md`, existing code-style review, or repository AGENTS.md/CLAUDE.md was found in the worktree search; supplied project guidance was used.

## Batch 7

Verdict: APPROVED

Score: 8/10

Numbered findings: none supported within this batch.

Evidence: `libs/shared/src/lib/providers/entries/codex-provider-entry.ts:26` contains eight ordered entries, every window zero; `:28` retains gpt-5.4 first, `:82` and `:91` append the requested IDs, and `:105` retains the three default tiers. The registry subscription guard at `libs/shared/src/lib/providers/provider-registry.ts:900` returns before constructing pricing entries. The reason is subscription billing, not absence of cost fields: the Codex entries explicitly contain zero costs (`codex-provider-entry.ts:33`).

The new spec exercises the actual registry and pricing map, not a source-text approximation: `libs/shared/src/lib/providers/entries/codex-provider-entry.spec.ts:64` checks registry identity; `:93` calls the real seed function and checks the resulting map; `:30`, `:34`, `:51`, and `:72` assert ordering, membership, unknown windows, and tiers.

The score is in the sound band: the narrow behavior has executable regression evidence and guarded consumers. It is not a 9–10 assessment because this review did not establish diff isolation or live-provider behavior, and did not execute the entire cross-runtime consumer graph. No demonstrated defect justifies a lower band.

## Batch 8

Verdict: APPROVED

Score: 7/10

1. **Non-blocking — Moderate: disclosure names a translation proxy without establishing one.** `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:1131` says “Localhost translation proxy session.” Its condition at `:1129` only calls `includesUserSettingSource`; `libs/shared/src/lib/utils/auth-env.utils.ts:14` and `:37` test the URL prefix, not the provider or whether protocol translation occurs. A direct Anthropic-compatible local server gets the same attribution. This can send support diagnosis toward a proxy that is not involved. Use “Localhost provider session” or describe only that the user settings tier is excluded. Update the exact-string expectation at `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.spec.ts:880`. The implementation follows the plan's exact wording (`.ptah/specs/TASK_2026_408/implementation-plan.md:361`); the wording problem therefore originates in that contract as well.

The actual settings selection is consistent: `sdk-query-options-builder.ts:996` selects override-or-injected auth once; both `:1129` and `:1234` read its ANTHROPIC_BASE_URL. There is no await between those two reads, no added state or listener, and one disclosure call site per completed build. The disclosure is a fixed string with no interpolated URL or credential (`:1131`). This does not claim that all existing builder logs are URL-free: the pre-existing general log includes baseUrl at `:1022`.

The exact guard literal remains at `:1233`; the added host-loop comment is three lines at `:1230`. Specs invoke build and inspect both the log and returned settingSources (`sdk-query-options-builder.spec.ts:871`, `:886`, `:901`). A direct injected environment overridden with localhost is exercised. The inverse override and repeated builds on the same instance are not explicitly tested; the shared effective-env binding and absence of disclosure state support their expected behavior.

The score is the lower end of the sound band because accurate disclosure is the purpose of this batch and its attribution is too narrow. The selected settings and override behavior are correct, so this does not warrant rejection or the significant-gap bands.

## Five logic questions

### 1. How does this fail silently?

No new silent execution failure was found. Static zero values cannot enter the provider-capacity registry through the inspected fallback: `provider-models.service.ts:381` maps metadata without a source marker and `:221` records only provider-marked observations. The new disclosure itself is observable at `sdk-query-options-builder.ts:1130`; its misleading attribution is finding 1, not a hidden settings change.

### 2. What user action produces unexpected behaviour?

Starting a session against a direct localhost provider produces the translation-proxy label (finding 1, `sdk-query-options-builder.ts:1129`). Selecting a static-only Codex model suppresses the window hint intentionally: `libs/frontend/ui/src/lib/native/provider-model-picker/provider-model-picker.component.ts:478` returns null for zero. Both default-model consumers still select the first ID (`libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry.ts:1614`; `libs/backend/auth-providers/src/lib/auth/workspace-provider-profile-resolver.ts:493`).

### 3. What input data produces a wrong answer?

A localhost URL alone is insufficient evidence for the log's proxy attribution (`auth-env.utils.ts:14`). No wrong capacity answer was found from the new zeros: `libs/shared/src/lib/utils/pricing.utils.ts:382` rejects non-positive observations, `:449` returns unknown/null without positive catalog evidence, and `libs/frontend/chat/src/lib/services/chat-store/session-live-stats.util.ts:93` guards the percentage denominator. Tier ranking normalizes non-positive values to zero at `libs/backend/auth-providers/src/lib/model-tier-derivation.ts:95`.

### 4. What happens when a dependency fails?

Codex list failure returns an empty list at `libs/backend/auth-providers/src/lib/providers/codex/codex-auth.service.ts:348`; registered discovery can return static metadata at `libs/backend/rpc-handlers/src/lib/handlers/provider-rpc.handlers.ts:315`. ProviderModelsService warns on a thrown fetcher (`:320`) and tries persisted then static catalogs (`:365`, `:381`). Static fallback conveys unknown capacity. Live positive finite context windows alone receive the provider source marker (`codex-auth.service.ts:329`).

The builder validates and awaits dependencies before the disclosure (`sdk-query-options-builder.ts:1024`, `:1042`); a build rejected there never reaches the info line. Thus “once per build” means once for a build reaching options construction, not logging on every failed invocation. Later option-construction errors can still reject normally; the disclosure is not a session-start success event (`:1149`, `:1792`). No network or live-provider verification was performed.

### 5. What is missing that the requirements never mentioned?

The wording needs to distinguish a localhost endpoint from established proxy identity (finding 1). The existing shared predicate is a prefix regex, so it also matches names such as localhost.example and omits IPv6 loopback (`auth-env.utils.ts:14`); this is pre-existing settings policy, not introduced by either batch, and was not changed. The ownership document referenced by the log is assigned to later Batch 10 (`implementation-plan.md:370`), so its absence during this review is a sequencing dependency rather than another Batch 8 defect.

## Failure modes

### 1. Incorrect provider-path attribution in support logs

- Trigger: build a session with a matching localhost URL that is a direct compatible server.
- Symptom: support logs identify the session as a translation proxy.
- Evidence: `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:1129`; `libs/shared/src/lib/utils/auth-env.utils.ts:14`.
- Current handling: fixed disclosure text; settings exclusion still matches the shared predicate.
- Recommendation: describe localhost provider settings exclusion without asserting translation.

## Blocking issues

None found in the reviewed scope.

## Serious issues

None found in the reviewed scope.

## Moderate and minor issues

Finding 1 above: Moderate, non-blocking, `sdk-query-options-builder.ts:1131`. No separate style findings or invented test-coverage defects.

## Data flow

1. **OK:** Codex registry entry supplies IDs, tiers, and unknown windows (`codex-provider-entry.ts:26`, `:131`).
2. **OK:** Subscription seed exits before publishing a zero maxTokens entry (`provider-registry.ts:900`).
3. **OK:** Proxy model listing emits IDs only (`libs/backend/auth-providers/src/lib/translation/translation-proxy-base.ts:365`); static RPC fallback passes zero as metadata without provider provenance (`provider-rpc.handlers.ts:316`).
4. **OK:** Dynamic model metadata merge preserves a positive dynamic window and falls back to static zero only when absent/falsy (`provider-models.service.ts:542`). Provider evidence registration is separate (`:214`).
5. **OK:** UI hints and context percentages guard unknown/zero capacity (`provider-model-picker.component.ts:478`; `session-live-stats.util.ts:93`). Compaction reads explicit configuration, not static model windows (`libs/backend/agent-sdk/src/lib/helpers/compaction-config-provider.ts:57`; `sdk-query-options-builder.ts:1099`).
6. **OK:** Auth override is selected once (`sdk-query-options-builder.ts:996`), then the same property controls disclosure and settings tiers (`:1129`, `:1233`). **Gap:** disclosure overstates provider identity (`:1131`).

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Zero all eight static windows; append IDs; retain default/tier mappings | COMPLETE | Registry/spec evidence above |
| No zero-capacity consumer or pricing-seed regression | COMPLETE | Inspected consumers guard unknown; no live runtime test |
| No compaction threshold change | COMPLETE | Current path reads explicit config, independent of static entries; no baseline diff |
| One disclosure per options build using effective auth env | COMPLETE | Failed preflight calls do not reach options construction |
| Settings behavior and source guard literal retained | COMPLETE | Executed builder and guard specs pass |
| No secrets/URL in new log; three-line comment | COMPLETE | Fixed message and lines 1230–1232 |
| Accurate endpoint description | PARTIAL | Finding 1 |

Implicit requirements not addressed: precise provider-path attribution, as finding 1.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Static window is zero | YES | No provenance, hidden hint, guarded denominator | No divide-by-zero path found |
| Catalog empty/fails | YES | Persisted/static fallback; capacity stays unknown without evidence | Existing persisted catalog can be older than live data |
| Positive live window | YES | Provider marker plus positive finite registration | Live fetch not exercised |
| Absent/non-localhost base URL | YES | User tier retained and no disclosure | Covered by build specs |
| authEnvOverride changes endpoint | YES | Same effective object drives both decisions | Reverse direction inspected, not a dedicated new case |
| Repeated/concurrent build calls | YES | No new shared state or asynchronous disclosure work | One call site per options construction |
| Localhost endpoint is not a translation proxy | NO | Settings exclusion correct; label inaccurate | Finding 1 |

## Verification

Executed in the requested worktree with NX_DAEMON=false and NX_NO_CLOUD=true:

- `nx run-many -t test -p @ptah-extension/shared --testPathPatterns=provider --runInBand --outputStyle=static`: 6 suites, 133 tests passed (including new Codex entry, registry, and lookup coverage).
- `nx run-many -t test -p @ptah-extension/agent-sdk --testPathPatterns=sdk-query-options-builder.spec.ts --runInBand --outputStyle=static`: 1 suite, 65 tests passed.
- Authorized unchanged-project guard: `nx run-many -t test -p @ptah-extension/output-styles --testPathPatterns=output-style-activation.resolver.spec.ts --runInBand --outputStyle=static`: 1 suite, 19 tests passed.
- `nx run-many -t lint,typecheck -p @ptah-extension/shared,@ptah-extension/agent-sdk --outputStyle=static`: all four targets passed, two from cache.

Total targeted tests: 217 passed. No full-workspace run and no live provider calls. Two initial shared-test launch attempts failed before tests started (Windows command-shim pipe interpretation, then an unavailable assumed Nx JS entry point); the simpler provider pattern above executed successfully. Ptah diagnostics was attempted with both absolute production paths and returned unavailable because they are outside its configured workspace root; scoped Nx typecheck supplied the fallback evidence. Passing tests establish mocked builder/registry behavior, not actual installed SDK skill discovery or compaction.

## Verdict

- Recommendation: APPROVE both batches; make the non-blocking wording correction before publishing the disclosure if feasible.
- Confidence: MEDIUM, given no baseline diff and no live runtime validation.
- Top risk: support users may infer a translation layer solely from the localhost log label.
- What a robust implementation would add: provider-neutral disclosure wording and a matching exact-string test; retain the existing shared predicate and all current settings behavior.
