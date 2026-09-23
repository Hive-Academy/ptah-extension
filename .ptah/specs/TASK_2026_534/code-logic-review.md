# Code Logic Review — TASK_2026_534, Round 2

**Verdict: REVISE**

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 4/10 |
| Assessment | NEEDS_REVISION |
| Blocking issues | 2 |
| Serious issues | 1 |
| Moderate issues | 0 |
| Failure modes found | 3 |

The six original reproductions are addressed, but the revised stored-key probe has an unguarded credential destination, and the revised tier workflow has two runtime defects. The security boundary failure and success-looking stale model state place this below the 5–6 band; the original fixes and correctly scoped persistence distinguish it from a foundational failure.

This replaces the canonical review with the Round 2 assessment. No source was edited and no git operation was run. References below are relative to the reviewed worktree.

## Original defects: closure evidence

| Original defect | Result | Evidence and independent check |
| --- | --- | --- |
| 1. API-key activation marks another provider active | CLOSED | `libs/backend/auth-providers/src/lib/auth/effective-route.ts:93` selects direct Anthropic for apiKey and the runtime default for an absent third-party selector. In-memory execution of the actual resolver and actual shared strategy function returned Anthropic with apiKey + stale claude-cli selector + unrelated defaultProvider; claudeCli returned the claude-cli tile; thirdParty without a selector returned OpenRouter. This agrees with `auth/active-provider-resolver.ts:25`, allowing the intentional CLI tile identity distinction. |
| 2. Failed Copilot auto-approval write looks successful | CLOSED | `libs/frontend/chat/src/lib/settings/ptah-ai/agent-orchestration-config.component.ts:485` requires both the envelope and payload to succeed; lines 494–518 read back uncertain outcomes, restore the checkbox, and show an error. Executing the actual methods with saved=true and a success-envelope/payload-success=false disable request left both UI state and checkbox true and produced the save error. Specs at `agent-orchestration-config.component.spec.ts:77` assert checkbox, state, and error for three failure shapes, not merely RPC calls. |
| 3. Collected model choices are discarded | CLOSED for the original paths; new tier defects below | `libs/frontend/core/src/lib/services/providers-settings-state.service.ts:495` now persists edited built-in tiers for Connect only. Actual-method execution persisted the chosen model under mainAgent, with no activation and no cliAgent writes. Native setup opts out in `libs/frontend/chat/src/lib/settings/providers/provider-setup-wizard.component.ts:1642` and emits no tiers at line 2274. The native UI test at `provider-setup-wizard.component.spec.ts:909` checks absent pickers, navigation, and the emitted payload. First activation and reset-to-default still fail in the new scenarios N2/N3. |
| 4. Unedited stale wizard value overwrites another window | CLOSED | Wizard snapshot/dirty tracking is at `provider-setup-wizard.component.ts:1647` and line 1861. `providers-settings-state.service.ts:499` skips unchanged tiers; line 505 rejects a changed baseline. Actual-method execution with a newer persisted sonnet and no edited tier preserved it and issued zero tier calls. `providers-settings-state.service.spec.ts:403` checks the resulting store. The accepted non-atomic read-then-write limitation is not re-raised. |
| 5. Stored-key Manage/Edit requires key re-entry | CLOSED for usability; new security defect N1 | `provider-setup-wizard.component.ts:1631` makes the stored credential sufficient, line 2191 sends only kind=stored, and line 2263 records reuse without a key in the commit. `libs/backend/auth-providers/src/lib/auth/draft-verification.service.ts:296` reads the host secret. The passing wizard test at `provider-setup-wizard.component.spec.ts:488` verifies navigation, probe success, and a credential-null commit. Destination binding is not closed by keeping the key out of the webview. |
| 6. Arbitrary saved effort becomes selectable again | CLOSED | `libs/frontend/chat/src/lib/settings/ptah-ai/ptah-cli-config.component.ts:225` substitutes a disabled unsupported placeholder, line 237 restricts effort options, and line 251 prevents saving that placeholder. Host validation at `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts:73` runs before any write at line 264. Actual validation rejects Pi banana and accepts off/max. `agent-rpc.handlers.set-config.spec.ts:95` asserts no partial writes when invalid effort accompanies a model update. |

## Failure modes

### N1. Stored credentials can be sent to another provider's draft endpoint — Blocking

- **File:** `libs/backend/auth-providers/src/lib/auth/draft-verification.service.ts:296`.
- **Trigger:** Request verification with providerId=moonshot, credential={kind:stored}, authMode=apiKey and baseUrl=https://provider-b.invalid. A second reproducible variant uses providerId=anthropic with authMode=custom and that URL.
- **Symptom/impact:** The host takes provider A's stored secret and hands it to an inference subprocess configured for caller-selected provider B. The webview never needs to receive the raw key to cause disclosure to a different endpoint.
- **Evidence:** The service replaces the credential but preserves the caller's draft at line 307. Its validation accepts any allowed key-carrying mode and any string baseUrl at lines 508–530; it does not bind either to the saved provider. `libs/backend/auth-providers/src/lib/auth/provider-auth-resolver.ts:594` prefers draft.baseUrl over the stored provider URL. Its custom branch at lines 549–569 accepts the caller's mode even for the direct Anthropic identity and places the stored key beside that URL.
- **Current handling:** Neither the service nor resolver rejects this mismatch. The submitted tests at `draft-verification.service.spec.ts:603` use a matching provider without an alternate URL; line 662 checks oauth mode rejection, not provider/destination binding.
- **Independent reproduction:** Executed the actual verify/normalization/secret-reading methods and actual buildDraftOverride method with synthetic secrets and a captured, non-networked runner. Both variants reached the supplied destination with the stored secret in its auth override. The synthetic successful stream produced outcome=verified. The ordinary service result/log capture contained no secret and the parent process environment was unchanged; those properties do not prevent the outbound leak.
- **Fix:** For kind=stored, derive the permitted auth mode and destination from the saved host-side provider configuration. Reject mismatched mode, provider identity, or endpoint before reading/releasing the secret to the runner. A new/changed destination should require a supplied key or a separately authorized host-side credential rebinding flow. Test wrong URL and mode spoofing with both third-party and native Anthropic secrets.

### N2. First activation conflicts with its own auto-mapped tiers — Serious

- **File:** `libs/frontend/core/src/lib/services/providers-settings-state.service.ts:485`.
- **Trigger:** Open setup for a provider with defaultTiers and no saved tier overrides, choose an explicit model, and select Use for main agent.
- **Symptom/impact:** Activation succeeds and chooses the provider's defaults. The model write then returns conflict, falsely reporting another edit and leaving the user's chosen model unapplied. No concurrent writer is necessary.
- **Evidence:** The activation operation is enqueued before tier operations at lines 485–488. `libs/backend/rpc-handlers/src/lib/handlers/auth-rpc.handlers.ts:999` invokes autoMapProviderTiers; its lines 1621–1627 persist the previously empty tiers. The wizard then compares the now-filled tier to its original null snapshot at `providers-settings-state.service.ts:505`. The mismatch becomes the “Changed elsewhere” message at line 1113.
- **Current handling:** runCommit reports a partial save after the route has already changed. It cannot distinguish its own earlier auto-map from another writer.
- **Independent reproduction:** Ran the actual connectProvider and actual autoMapProviderTiers methods with an in-memory settings store. Starting with three null tiers and a chosen sonnet model produced operation outcomes [true, conflict] and persisted the provider defaults rather than the chosen model.
- **Test gap:** `providers-settings-state.service.spec.ts:405` mocks auth:saveSettings as an acknowledgement only. It omits the tier mutation performed by the real handler, so the cross-boundary ordering failure is invisible.
- **Fix:** Perform baseline checks and persist edited mainAgent tiers before activation, then activate only if those writes succeed. B2-2 now makes those writes safe for an inactive provider, and the host's fill-if-unset auto-map will preserve them. Add a test using real auto-map behavior. This is not the accepted atomicity limitation.

### N3. Resetting an active model tier leaves the old subprocess mapping — Blocking

- **File:** `libs/backend/auth-providers/src/lib/provider-models.service.ts:619`.
- **Trigger:** For the active provider, save an explicit mainAgent tier, then use the revised wizard to change it back to the provider default.
- **Symptom/impact:** The saved override disappears and the UI can report success, while subsequent SDK subprocesses still inherit the old ANTHROPIC_DEFAULT_*_MODEL value. Main-agent model resolution and SDK tier/subagent resolution can disagree.
- **Evidence:** setModelTier writes both authEnv and process.env at lines 555–556. clearModelTier clears persistence at line 618 and deletes only authEnv at line 620. The new wizard path calls this method for an empty/default selection at `providers-settings-state.service.ts:506`; its read-back at line 511 verifies persistence alone. `libs/backend/rpc-handlers/src/lib/handlers/provider-rpc.handlers.ts:670` clears only the model cache after the call, without an auth reset. `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:993` spreads process.env before the effective auth environment. `libs/backend/agent-sdk/src/lib/helpers/sdk-model-service.ts:159` emits only present values, so an absent authEnv entry does not erase the inherited process value.
- **Current handling:** The RPC returns success. The active-provider guard prevents clearing another provider's authEnv, but does not synchronize deletion across the two environment stores.
- **Independent reproduction:** Executed actual setModelTier followed by actual clearModelTier with a synthetic active provider. Persistence and authEnv were empty afterward; process.env and the subsequent environment spread still contained old-model. Restored the process value after the check.
- **Test gap:** `provider-models.service.spec.ts:401` checks only authEnv deletion; the UI test at `providers-settings-state.service.spec.ts:441` checks only the stored tier.
- **Fix:** Recompute the active provider's effective default/derived tier after clearing the override and synchronize its value and metadata in both authEnv and process.env. If no replacement exists, explicitly delete both stores' corresponding keys. Keep inactive-provider and cliAgent clears isolated. Assert the environment actually passed to the next SDK launch, not just the settings store.

## Blocking issues

N1: cross-provider stored-secret disclosure. N3: success-looking reset with stale subprocess model selection. See their file/line, scenario, impact and fixes above.

## Serious issues

N2: normal first activation rejects its own model choice and leaves a partial configuration.

## Moderate and minor issues

No additional defect is claimed. The accepted non-atomic tier comparison was excluded.

## Five logic questions

### 1. How does this fail silently?

N3 removes the persisted tier but leaves process.env unchanged (`provider-models.service.ts:620`), while the frontend confirms only persistence (`providers-settings-state.service.ts:511`). N1 can return verified even though the credential went to an unbound destination (`provider-auth-resolver.ts:594`).

### 2. What user action produces unexpected behaviour?

Choosing a model on first activation yields the false conflict in N2 (`providers-settings-state.service.ts:485`). Choosing Provider default on an active connection leaves the old subprocess tier in N3 (line 506).

### 3. What input data produces a wrong answer?

A stored credential paired with another draft URL, or native Anthropic paired with custom mode, passes normalization and builds the wrong credential/destination combination (`draft-verification.service.ts:508`, `provider-auth-resolver.ts:549`). A null opening tier snapshot becomes stale because this same commit fills it before comparison (N2).

### 4. What happens when a dependency fails?

The revised Copilot toggle reads back after transport failure or payload failure and displays uncertainty if read-back also fails (`agent-orchestration-config.component.ts:494`). Missing stored keys produce a typed no-stored-credential result before inference (`draft-verification.service.ts:297`). Probe classification keeps arbitrary exception messages out of its detail construction at lines 592 and 611. These are useful local guarantees, not an end-to-end guarantee about SDK stderr or arbitrary endpoint responses.

### 5. What is missing that the requirements never mentioned?

Cross-layer regression tests need real handler side effects rather than acknowledgement-only mocks (N2), and model-reset tests need the final subprocess environment (N3). The stored-key feature also needs an explicit destination-identity policy enforced on the host (N1); the review request correctly makes this a required security boundary.

## Data flow and confirmed-correct items

1. **OK — native auth writes:** `providers-settings-state.service.ts:536` emits apiKey or claudeCli without anthropicProviderId. The native branch at line 478 excludes tier writes. This continues to avoid the invalid virtual selector payload.
2. **OK — effective identity across consumers:** `effective-route.ts:93` selects native API, native CLI tile, explicit third party, or OpenRouter fallback independently of llm.defaultProvider. The UI uses the single returned driver identity at `providers-settings-state.service.ts:242`. `apps/ptah-cli/src/cli/commands/doctor.ts:224` and `apps/ptah-cli/src/cli/commands/init.ts:686` call the same pure resolver. Their provider catalogs include the native API entry; `llm-rpc-app.handlers.ts:280` itself uses the scoped ActiveProviderResolver when deciding native auth type.
3. **OK — stale claude-cli selector:** With effective authMethod=apiKey, it is ignored for identity; with claudeCli, the CLI tile wins; with thirdParty, the claude-cli registry entry deliberately selects the native CLI strategy. Actual resolver execution covered all three combinations.
4. **OK — scope precedence for the new tier guard:** `provider-models.service.ts:553` delegates through resolveActiveProviderId at line 990 to `active-provider-resolver.ts:25`. This uses the same app-scopable reads as runtime initialization. `libs/backend/settings-core/src/scope/workspace-scope-resolver.ts:80` orders app/workspace, app, cross-app workspace, and global candidates. It does not compare against an unrelated global selector or llm.defaultProvider.
5. **OK — inactive tier writes:** Connect-only edited tiers persist under mainAgent and do not touch the running environment when the provider differs from that resolver. The behavioral test at `provider-models.service.spec.ts:215` snapshots both environment stores. **GAP:** active reset is N3.
6. **OK — activation and leaving a provider:** `auth-rpc.handlers.ts:1002` resets the adapter; `auth/auth-manager.ts:159` clears all tier env keys, and third-party strategies call switchActiveProvider. `provider-models.service.ts:967` clears both stores before applyPersistedTiers at line 708 selects saved/default/derived tiers. Native API deliberately only clears tiers (`auth/strategies/api-key.strategy.ts:701`); native subscription uses SDK defaults. **GAP:** the frontend ordering before this transition is N2.
7. **OK — CLI-agent separation:** `providers-settings-state.service.ts:507` writes mainAgent only. `libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry.ts:1483` reads cliAgent; per-instance precedence remains separate. The B2 guard retains the scope=mainAgent requirement.
8. **OK within the tested host path — probe state isolation:** `draft-verification.service.ts:352` passes an auth override to InternalQueryService, which forwards it at `libs/backend/agent-sdk/src/lib/internal-query/internal-query.service.ts:131`. The runner builds a new environment object at `sdk-query-runner.service.ts:424`; it does not assign the override into process.env. Synthetic verification left the host process environment unchanged, and service logs/results did not contain the synthetic key. **GAP:** N1 violates provider binding; no live subprocess isolation/security claim is made.
9. **OK — effort choices:** Shared allowlists at `libs/shared/src/lib/types/rpc/rpc-agents.types.ts:152` and line 165 give the UI and host the same accepted write values. Pi accepts off through max; Codex/Copilot offer values the runtime map accepts. Existing Codex/Copilot max is now treated as unsupported by this write allowlist even though the runtime maps that legacy alias to xhigh; a user can explicitly replace it with xhigh. No additional runtime defect is asserted for that narrower write contract.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Close original six defects | COMPLETE for original reproductions | The extended tier/key features introduce N1–N3 |
| B2-1 no key re-entry or raw key returned to webview | COMPLETE in inspected service/UI paths | No live SDK/stderr security validation |
| B2-1 bind stored credential to its provider | MISSING | N1 |
| B2-1 no route/settings/secret writes during ordinary API probe | COMPLETE in inspected host path | Tests replace inference runner; not a subprocess sandbox proof |
| B2-2 inactive-provider tier persistence without env mutation | COMPLETE | Correct scoped resolver guard |
| B2-2 apply saved tiers on activation and clear previous provider | COMPLETE in backend transition | Frontend activation ordering fails N2 |
| B2-2 reset/default model behavior | PARTIAL | N3 |
| Effective route consumers remain consistent | COMPLETE for valid requested routes | Local skipped/unknown status still means configuration readiness, not successful probing |
| CLI-agent tier resolution unchanged | COMPLETE | No connection writes into cliAgent |

Implicit requirements still needing coverage: destination binding and an actual subprocess-environment reset assertion, as detailed above.

## Edge cases

| Case | Handled | Evidence / concern |
| --- | --- | --- |
| apiKey plus stale claude-cli selector at an effective scope | YES | Native identity wins in effective-route.ts:99 and active-provider-resolver.ts:30 |
| thirdParty local provider with skipped status | YES | Effective resolver accepts configuration readiness; UI accepts the same driver, providers-settings-state.service.ts:253 |
| Missing stored credential | YES | Typed failure, no runner call, draft-verification.service.ts:297 |
| Stored provider A credential plus destination B | NO | N1 |
| First activation, null snapshot, explicit edited tier | NO | N2 |
| Connect only, inactive provider, explicit tier | YES | mainAgent persistence with unchanged runtime env |
| Unedited tier changed by another window | YES | No write; original defect 4 closed |
| Active tier returned to provider default | NO | N3 |
| Invalid Pi effort plus otherwise valid config fields | YES | Rejected before all writes, agent-rpc.handlers.ts:264 |

## Verification and test quality

- Read the task, batch-2 spec, prior canonical review, and the implementer's Revision 1 + Batch 2 account. Re-traced revised paths through host readers, tier/environment writes, auth strategies, effective-route consumers, and the relevant tests. Used direct file reads; no git/diff operation.
- Independently ran `npx nx test @ptah-extension/chat --testFile=provider-setup-wizard.component.spec.ts --runInBand --skipNxCache --output-style=static`: **46/46 tests passed**, one suite.
- Scoped ptah_get_diagnostics to the changed draft-verification service/auth-providers project: **0 errors, 0 warnings**, TypeScript compiler source.
- Used in-memory AST extraction/transpilation of actual production methods for route identity, Copilot rollback, Connect-only persistence, unchanged-tier preservation, effort rejection, stored-key destination binding, real auto-map ordering, and active-tier clearing. Dependencies were synthetic; no real key or network request was used and no test file was added. One initial harness script had a syntax error before execution; the corrected harness completed with the results reported above.
- New tests meaningfully assert emitted commit contents, rendered state and stored values. They are not all call-count tests. However, acknowledgement-only auth mocks omit auto-mapping, active-clear assertions omit process.env, and stored-key tests omit wrong-destination/mode cases. Their passing results therefore do not cover N1–N3.
- Did not rerun the full project/workspace suites, lint/build matrix, or a live SDK subprocess. Broader passing counts in fix-report.md remain implementer-reported evidence. Existing SDK stderr forwarding at `sdk-query-runner.service.ts:443` is not a secret-redaction proof; this review does not claim that all possible downstream log paths are safe.

## Verdict

- Recommendation: **REVISE**
- Confidence: **HIGH** for N1–N3; each has a concrete production path and independent in-memory reproduction.
- Top risk: a stored secret can be routed to a caller-selected destination while the probe reports successful verification.
- A robust revision would bind stored credentials to host-owned provider destinations, save checked tier edits before activating, and synchronize tier resets through both runtime environment stores and the final SDK launch environment.

## Round 3 verification (N1–N3)

**Verdict: REVISE — the original N1, N2 and N3 reproductions are closed; the N1 fix introduces one serious local-native stored-key regression (N4).**

This is verification only of the three reported fixes and their immediate consequences. The earlier review above is preserved as historical evidence. The current scoped assessment is **NEEDS_REVISION: 0 blocking, 1 serious, 0 moderate, 1 failure mode**; confidence is HIGH in the concrete credential omission described below. No new full review was performed.

### Closure results

| Item | Result | Current evidence |
| --- | --- | --- |
| N1 — stored key sent to caller-chosen destination | **CLOSED for the original disclosure and tested URL bypasses** | `libs/backend/auth-providers/src/lib/auth/draft-verification.service.ts:307` calls bindStoredDraft before the secret read at line 326. Direct Anthropic accepts apiKey without a URL only (line 508); non-custom registry entries reject custom mode (line 514); other requested URLs are compared with the host-owned URL (line 517). Original foreign-URL and Anthropic/custom reproductions now return stored-credential-mismatch with zero secret reads and zero runner calls. The accepted local-mode branch introduces N4 below. |
| N2 — activation conflicts with its own auto-map | **CLOSED** | `libs/frontend/core/src/lib/services/providers-settings-state.service.ts:490` adds edited-tier operations first and line 514 appends activation last. Actual connectProvider, runCommit and host autoMapProviderTiers methods executed together against an in-memory store: first activation saved the selected sonnet, auto-mapped only remaining unset tiers, and reported saved. The order was tier:mainAgent then activate. Conflict and rejected-write cases did not activate. |
| N3 — clearing an active tier leaves process.env stale | **CLOSED** | `libs/backend/auth-providers/src/lib/provider-models.service.ts:623` selects registry default then live-derived fallback. Lines 627–629 synchronize the model and metadata; lines 631–635 remove both stores' model/metadata when no fallback exists. Actual setModelTier → clearModelTier execution no longer leaves the old value in the environment spread used for the next SDK launch. |

### N1: normalization and binding attempts

Executed the revised verification, normalization, binding, secret-reading and override-building methods with synthetic secrets and a captured inference runner. No network request or real credential was used. The resolver's getSavedBaseUrl/resolveProviderBaseUrl methods were also executed; configuration and registry data were controlled inputs.

For these tests the saved third-party endpoint was `https://saved-host/anthropic/`.

| Attempt | Observed result |
| --- | --- |
| Original foreign base URL, provider A's stored key | Rejected before reading any secret or invoking inference. |
| Direct Anthropic identity with custom mode and foreign URL | Rejected before any secret read or inference. |
| Origin case: HTTPS://SAVED-HOST/anthropic | Accepted; inference used exactly the saved endpoint, not the caller string. |
| Extra trailing path slashes | Accepted; inference used exactly the saved endpoint. |
| Userinfo: https://evil@saved-host/anthropic/ | Accepted as the same origin/path, but caller userinfo was discarded; inference used the clean saved endpoint. This did not redirect the key to evil. |
| Host trick: https://saved-host@evil/anthropic/ | Rejected; the actual host differs. |
| Different path or path case | Rejected before any secret read. |
| Additional query parameter | Rejected before any secret read. |
| Fragment on otherwise equal endpoint | Accepted; fragment was discarded and the saved URL used. |
| Saved custom entry whose host-configured URL is https://attacker.invalid/api | Accepted for that custom entry's own key and exactly its saved URL. The trust boundary is host configuration, not whether a hostname looks trustworthy. This is not the original cross-provider/draft-URL bypass. |
| That custom entry with a different caller URL | Rejected before any secret read. |
| local-native or local-proxy with a foreign caller URL | Both rejected before any secret read. |
| local-native with the saved caller URL | Binding accepted, but the resulting auth override omitted the stored key: N4. |
| local-proxy with the saved caller URL | Binding accepted and the no-baseUrl branch selected the host proxy resolver. Its captured environment contained a proxy token rather than the stored key. The proxy was stubbed; no claim is made here about how a real proxy authenticates its upstream. |

The relevant normalization is `draft-verification.service.ts:116`; safety for accepted origin-case/userinfo/fragment variants comes from discarding the caller URL, rather than from treating every variant as invalid. For custom mode, line 521 substitutes the saved URL. For non-custom modes, line 522 drops the URL and lets the resolver read host configuration.

For the captured service executions, process.env was unchanged and neither the returned result nor the service log capture contained the synthetic secret. These checks cover the inspected host path, not live SDK stderr or a compromised host configuration.

The new tests at `libs/backend/auth-providers/src/lib/auth/draft-verification.service.spec.ts:662` correctly assert rejection before secret access and inference. The saved-endpoint test at line 694 checks the actual override destination. Neither covers an accepted local-native stored-key request.

### N2: order, Connect only, and an already-active provider

Re-ran the earlier reproduction using the actual connectProvider and runCommit methods and actual `AuthRpcHandlers.autoMapProviderTiers`, with a synthetic settings store.

| Case | Result |
| --- | --- |
| First activation; all stored tiers null; explicit sonnet edit | saved; selected sonnet preserved; remaining tiers filled by auto-map; tier write preceded activation. |
| Connect only | saved; selected mainAgent tier persisted; no activation call; other tiers stayed unset. |
| Manage an already-active provider; edit an existing tier | saved; selected tier replaced the opening value; subsequent auto-map preserved it. |
| Another writer changed the edited tier from the opening snapshot | Existing value preserved; no tier overwrite and no activation. |
| Tier write rejected without persisting | Failed save; no activation. |

The failure gate remains `providers-settings-state.service.ts:1040`: a dependent operation is skipped once an earlier field is unsaved or unconfirmed. The revised behavioral tests at `providers-settings-state.service.spec.ts:428` and line 446 now simulate auto-map side effects and verify resulting storage/order and blocked activation.

For the already-active case, changing the tier before an explicit reactivation is intentional: the existing active-provider guard in `provider-models.service.ts:553` applies the edit immediately. The changed ordering does not create a false conflict. The accepted non-atomic UI comparison limitation is not re-raised.

### N3: runtime fallback and isolation checks

Executed actual setModelTier, clearModelTier, getLiveDerivedTiers, readLiveCatalog, and applyTierMetadata, with the actual deriveTiersFromCatalog function. Controlled catalogs had three tool-capable models with distinct context lengths. Each temporary process environment entry was restored afterward.

| Case | Result after clear |
| --- | --- |
| Registry default available | authEnv, process.env and next-launch environment spread all contained the registry default. Unavailable metadata was removed. |
| No registry default; in-memory live catalog available | All three selected the live middle-ranked sonnet model; name, description and capabilities metadata matched that model in both stores. |
| Same catalog available only through persisted catalog fallback | Same model and metadata result as the in-memory case. |
| No default or catalog fallback | Model and all tested tier metadata keys absent from both stores and the next-launch spread. |
| Provider is inactive | Both environment stores and their metadata unchanged. Persistence still cleared. |
| cliAgent scope | Main-agent environment stores and metadata unchanged. Persistence still cleared. |

The fallback uses the same live derivation as activation: `provider-models.service.ts:692`, compared with applyPersistedTiers at line 743. readLiveCatalog checks memory then persisted catalog at line 658. Metadata synchronization at line 931 deletes missing fields rather than retaining old labels/capabilities.

The revised clear tests at `provider-models.service.spec.ts:403`, line 415 and line 428 now check both environment stores. This independent check additionally exercised live/persisted catalog fallback and metadata.

### New defect N4 — accepted local-native stored-key probes silently discard the credential

- **Severity:** Serious.
- **File:** `libs/backend/auth-providers/src/lib/auth/draft-verification.service.ts:520`–522.
- **Scenario:** A local-native provider has a stored API key and a saved endpoint that requires it. Verify using kind=stored, that provider's local-native mode, and a caller URL equal to its saved URL. A concrete supported identity is Ollama Cloud: `libs/shared/src/lib/providers/entries/local-provider-entry.ts:115` defines the provider, line 120 declares optional API-key support, and lines 125–131 describe direct cloud key use.
- **Failure:** bindStoredDraft returns only providerId/authMode for every non-custom provider. After the host reads and attaches the key, buildDraftOverride therefore cannot take its URL-bearing local branch at `libs/backend/auth-providers/src/lib/auth/provider-auth-resolver.ts:533`, which includes the credential. Instead it takes local-native at line 552 and resolveLocalNative at line 268. That method puts the saved URL and tiers into the auth override but no credential (lines 273–277).
- **Impact:** A protected saved endpoint rejects a valid stored key because the probe never sends it. An endpoint that accepts anonymous calls can instead produce a successful connection result without exercising the stored credential. Keeping the secret safe is necessary, but the accepted stored-key request must still test that credential.
- **Independent evidence:** Loaded the real OLLAMA_CLOUD_PROVIDER_ENTRY and used a host-saved `https://ollama.com` override with a synthetic key. The unchanged draft resolver, called with saved URL plus key as before this binding change, included ANTHROPIC_AUTH_TOKEN. Passing the same request through the new bindStoredDraft first retained the same destination but removed the token from the resulting auth override. This was a captured environment comparison, not an observed live HTTP response. The complete service harness also showed one stored-secret read followed by an override containing no stored key.
- **Why this is introduced by these changes:** The original matching-URL local branch included the key at provider-auth-resolver.ts:538. The new binder removes the URL that selected that branch; the resolver itself was not changed to preserve the credential on the alternative path.
- **Fix:** Preserve the host-owned saved URL in the rebuilt local-native/local-proxy draft, so the isolated local draft path receives the credential, or explicitly teach the saved local route to use the bound stored key. Keep the destination check and never restore the caller's raw URL. Derive/validate the allowed mode from the provider contract where appropriate.
- **Regression test:** For an accepted saved local-native endpoint, assert the actual inference override contains that provider's stored token and saved URL, and that no global state is changed. Include a rejecting inference stub when the token is absent. Also pin the intended local-proxy behavior so stripping a URL cannot silently switch probe mechanisms.

N4 is confined to the revised N1 branch. No additional defect outside these three fixes is raised.

### Verification evidence and limits

- Inspected the implementer's “Review round 2 fixes” account and the changed functions, their direct readers/callees, shared result reason, wizard error copy, and relevant regression assertions.
- Targeted Jest execution passed for:
  - `draft-verification.service.spec.ts` and `provider-models.service.spec.ts` in `@ptah-extension/auth-providers`.
  - `providers-settings-state.service.spec.ts` in `@ptah-extension/core`.
- Ran each targeted command once, with cache skipped and tailed output. No full project or workspace suite/build/lint rerun.
- Scoped ptah_get_diagnostics to the reviewed auth-providers/core paths: **95 errors, 0 warnings** were reported by the TypeScript compiler, including neighboring `auth-state.service.spec.ts:171` test typing. No diagnostic locations matched the three reviewed production files. This is not a clean project diagnostic result and does not independently confirm the implementer's broader typecheck claim.
- Reproductions used actual extracted/transpiled production methods with synthetic settings, secrets, catalog data and captured inference. They did not use a real key, contact an endpoint, start a proxy, or launch an SDK subprocess. An initial N1 harness output formatter failed on an absent capture after correctly rejected input; correcting that formatter produced the full matrix above.
- No source file was edited and no git operation was performed. This section was appended without rewriting the preceding review.

### Verification verdict

**REVISE for N4.** N1's original credential-destination disclosure, N2's self-conflicting activation, and N3's stale environment clear are closed in the verified scenarios. The accepted local-native stored-key path must retain and exercise the bound credential before this limited verification can be approved.


