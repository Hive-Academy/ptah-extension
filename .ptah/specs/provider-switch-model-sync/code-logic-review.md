# Code Logic Review - provider-switch-model-sync

Score 7/10 - REVISE (minor). Blocking 0, Serious 1, Moderate 4, Minor 2.

## Findings

### S1 (Serious) - re-sync runs inside the auth-status read, so `_isLoading` stays true for the slowest RPC
auth-state.service.ts `fetchAndPopulateAuthStatus` awaits `syncProviderDependents()` before the `finally { _isLoading.set(false) }`.
`syncProviderDependents` awaits `refreshModels` (catalog read plus pricing hydrate), `refreshEffort` and `planLimits.load`
(`provider:getPlanLimits`, a quota fetch that can hit the network). `persistedTileId` returns null while `_isLoading`, so the
"Active" tile indicator disappears and the settings spinner holds until the slowest call finishes. Every awaiting caller
(`saveAndTest`, `refreshAuthStatus`, workspace switch) is delayed the same way.
Fix: fire the re-sync after `_isLoading` is cleared (do not await it in the read), or `void` it. Callers that need fresh models already
call `refreshModels` themselves.

### M1 (Moderate) - re-sync can join a stale in-flight `config:models-list`
model-state.service.ts `loadModels` shares an in-flight promise keyed by workspace scope only, not by provider. A refresh issued
earlier (tab creation, workspace switch) but processed by the host before the provider switch landed is joined by the
sync call, and the old provider's list is published as the new one's. Nothing re-triggers a read afterwards.
Fix: have the sync path bypass the join, or key the latch by provider identity.

### M2 (Moderate) - `syncedProviderIdentity` is only set by a successful read
auth-state.service.ts `fetchAndPopulateAuthStatus`. If the first `getAuthStatus` fails, the identity stays null. A later successful
read then counts as "first load" (`previous === null`) and skips the re-sync, even if the provider changed in between.
The first read also never syncs, so models loaded by boot before auth state resolved are not revalidated against the resolved provider.
Fix: seed the identity from the first successful read after the models boot load, or treat null as "unknown, sync once".

### M3 (Moderate) - a stale non-claude saved model remains stored after a switch back to Anthropic
config-rpc.handlers.ts `registerModelGet` no longer migrates. After Codex to Anthropic, the stored `gpt-6-luna` is not offered
(`savedModelOption` returns null for an unknown id), so no entry is selected and the frontend falls back to `default`.
Webview sends are safe because they pass `default` explicitly. Paths that read the stored value directly are not:
`chat-session.service.ts:880` and `:1621`, `chat-slash-command-router.service.ts:288` and `gateway-chat-bridge.ts:870`, when `params.model` is empty.
Those would send `gpt-6-luna` to Anthropic. This is the D2 symptom on the non-webview paths, not covered by this change.
Settings read-back also shows the stale id. Needs a decision: clear or validate the saved model on provider switch on the host.

### M4 (Moderate) - duplicate `planLimits.load`, and the clock starts without the card
`planLimits.load` is now fired by both `syncProviderDependents` and the provider-account-card `providerWatcher` effect (same
`activeProviderId` change). The generation guard keeps the result correct, but it costs two quota RPCs per switch.
`load()` also calls `startClock()`, so the 30 s interval now starts for any user who switches provider, even if the dashboard card is
never mounted (`stopClock` only runs on store destroy). The store sets `providerId` stickily, so a later no-arg load targets the new provider (intended).

### m1 (Minor) - `savedModelOption` matches `staticModel.id` case-sensitively
config-saved-model-option.ts. `inCatalog` and the static lookup use exact ids, but alias handling is case-insensitive.
A saved `GPT-6-Luna` is not offered. Probably acceptable.

### m2 (Minor) - the `models.some(m => m.id === savedModel)` guard in `appendSavedModel` is unreachable
config-rpc.handlers.ts `appendSavedModel`. The caller only calls it when nothing is selected, and an id match would have been
selected through `matchesSaved`. Harmless dead guard.

## Checked and found sound
- D3: `config:model-get` is now a pure read. It no longer wipes the workspace override. The `providers-commit.service.ts:102` read-back
  (`model === params.model`) is now accurate for tier aliases and third-party ids.
- D1: `matchesSaved` handles `default`, tier aliases and `claude-` ids. When two entries resolve to the same model, the "first selected"
  de-dup keeps one. The exact id match still wins. An empty catalog gives no appended entry unless the static registry declares the model.
- Model selector: with `models.length === 0` the override is kept, matching `MessageSenderService.resolveValidModel`, so display and send agree.
  A dropped override is not cleared from the tab, so it reappears when the provider is switched back (reasonable).
- No loop: `syncProviderDependents` does not call back into the auth read, and the identity is stored before the awaits, so overlapping
  reads do not double-sync. The `saveAndTest` optimistic `_persisted*` set (lines 742-743) still differs from the last synced identity,
  so the sync fires on its refresh. `refreshModels` is coalesced with the caller's own call.
- Failures in the re-sync are caught and warned, and the auth read stays successful. `refreshModels` and `refreshEffort` already swallow errors.

## Test coverage gaps
- No test for the catalog-cache path with `cachedModelIds` populated and an empty static list beyond one spec. No test for a failed first
  auth read followed by a switch (M2).
- No test that `_isLoading` is false while the re-sync is pending (S1).
- No test for a concurrent `refreshModels` in flight during the sync (M1).
- Provider-account-card: no test that a single switch yields one load.

## Five questions (short)
1. Silent failure: the re-sync warn-only path (OK), and a stale stored model on non-webview send paths (M3).
2. Unexpected user action: switching provider while a models-list is in flight (M1).
3. Wrong answer: an unknown saved id gives a default fallback and the stored value stays stale (M3).
4. Dependency failure: models, effort or limits RPC failure is swallowed and auth stays OK; the stale list persists until the next read.
5. Missing: a host push event (accepted), plus S1 and M2 above.

## Verdict
REVISE. Fix S1 (do not hold `_isLoading` on the re-sync), consider M1 and M2, and decide on M3. The D1 and D3 fixes are correct.
Confidence: medium (static review; tests not run).

## Re-review (fixes for S1, M1, M2, m2)

Score 8.5/10 - APPROVED. Blocking 0, Serious 0, Moderate 1 (M3 deferred, accepted), Minor 3. Static review; tests not run by me.

### S1 - resolved
`fetchAndPopulateAuthStatus` sets `_isLoading=false` in `finally`, then `void this.syncProviderDependents()` only when `loaded`.
No unhandled rejection: the Promise.all sits in try/catch with a warn; the code before it only reads computed signals. Sub-calls already swallow
their errors (`fetchModels` never rejects; `refreshEffort` catches). `loaded` is set only after `fetchAndPopulateScope`; that method catches internally.
A new caveat (minor): callers that `await refreshAuthStatus()` and then read model state (`saveAndTest` does its own `refreshModels` after,
which covers it) no longer see the models re-synced when the call returns. Any other awaiting caller must not rely on that.

### M1 - resolved
`loadModels(fresh)` skips the join and bumps `modelsGeneration`; `fetchModels` drops its result if a newer read started.
- `_isLoaded`: the superseding read always sets it on its success, error and catch paths. The only path that leaves it unset is the
  pre-existing scope-mismatch early return. A superseded read A therefore cannot strand it, unless the superseding read B also hits the scope
  mismatch. That is a narrow window that a workspace-switch refresh resolves.
- Pricing: `hydratePricing` runs after `loadModels` in `refreshModels`, is independent of the generation, and runs per caller. Not affected.
- Minor: a caller awaiting the superseded read A resolves when A returns without publishing, so it can resume before B's list lands. This is
  harmless for the sync (it awaits its own read), but the `saveAndTest` follow-up `refreshModels` is non-fresh and joins B if B is in flight, so it is OK.
- Generation is bumped by non-fresh reads too, so a later non-fresh read in another scope supersedes an earlier fresh one. That is correct (latest wins).

### M2 - resolved
A failed boot read sets the sentinel (`null` -> `'unsynced'`), so the next successful read re-syncs. Cost: one extra sync even when the provider
is unchanged. It is limited to the first successful read after a failure. Fine.

### m2 - resolved (dead guard removed).

### Remaining, accepted by coordinator
- M3 (stored stale model on host-direct paths): deferred; a follow-up is needed. Note it remains a real D2 variant for slash-router and
  gateway sends with an empty `params.model`.
- M4: the reasoning holds (other PlanLimitsStore consumers); duplicate load is generation-guarded. Accepted.
- m1: accepted (canonical ids).
- Minor: no test pins the "superseded awaiter resolves early" behaviour or the scope-mismatch + supersede double drop.

Verdict: APPROVED.
