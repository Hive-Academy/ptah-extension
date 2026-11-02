# Code Logic Review (merge of #826 into codex runtime) — TASK_2026_714_c8a2

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 8/10 |
| Assessment | APPROVED (with minor follow-ups) |
| Blocking | 0 |
| Serious | 0 |
| Moderate | 1 |
| Minor | 3 |

Scope: `git diff HEAD` and `git diff MERGE_HEAD` for the listed files, plus the code around `prepare()`, `resolveExecutionProfile()` and the three call sites. No conflict markers remain in auth-providers or rpc-handlers. Tests were not run (coordinator did).

## Required behavior check

1. Model read late (PASS, one literal deviation, see M1).
   - Start: `chat-session.service.ts` reads `currentModel` after `outputStyleActivation.resolveSessionFields`, then calls `prepare()` / `resolveClaudeExecution`.
   - Resume: model read after the `resolveSessionFields` await, inside the try.
   - Slash relaunch: `chat-slash-command-router.service.ts` reads `requestedModel` after `resolveEnhancedPromptsContent`.
   - The stored-model check itself now runs inside `prepare()` / `resolveExecutionProfile` (`workspace-provider-profile-resolver.ts` claude branch), immediately before `resolveProviderProfileForWorkspace`. Both use the same `workspacePath`, so the model check and the profile see the same provider, which is stronger than main (main resolved the model, then did separate awaits).
2. Claude only, no explicit model (PASS).
   - `modelIsStored = !options?.model` / `!params.model` in all three sites, using `||` semantics, identical to main (empty string counts as not given).
   - `resolveExecutionProfile` calls `resolveStoredModel` only in the final claude return. The native branch returns earlier and maps via `resolveNativeCodexModel` with the raw model. The spec "checks a stored model only on the Claude branch" (`workspace-provider-profile-resolver.spec.ts:993-1031`) asserts `resolveStoredModel` is not called for native.
   - `shouldStartNativeCodex` (`:260`) decides on provider, not on model, so the raw stored model cannot change the runtime choice.
3. Claude parity with main #826 (PASS).
   - Main: `model = options.model || resolveStoredModel(ws, stored)`, profile resolved with that model, SDK config `model` is that value. Merge: `execution.model` is spread into `startChatSession`, `resumeSession` and the slash `executeSlashCommand` config for `claude-sdk`. Profile uses the same resolved `model` (`:247-256` of the resolver; `resolveClaudeExecution` in `chat-runtime-profile.service.ts`).
   - Fallback (no `ChatRuntimeProfileService`) goes through `resolveClaudeExecution`, with identical logic to the resolver's claude branch. Explicit model skips `resolveStoredModel` (`chat-session-provider-profile.spec.ts:415`).
   - Explicit-model `claude-sdk` now also returns `model: requestedModel` (unchanged value), so no difference for explicit models.

## Five logic questions

1. Silent failure: `resolveStoredModel` falls back to `'default'` and logs at info; same as main. No new swallowed errors. A `claude-sdk` result lacking `model` would be a type error (field is required in `ResolvedExecutionProfile`), so the SDK config cannot silently keep the unresolved model.
2. Unexpected user action: switching provider between the settings read and `prepare()` is now evaluated once, in `prepare()`, so no mixed state. Explicit `params.model` from a prior provider is trusted (same as main).
3. Wrong answer: a native-branch session with a stored Claude alias (`sonnet`) is mapped by the Codex catalog (tier map `CODEX_DEFAULT_TIERS`) with a substitution notice. Intended.
4. Dependency failure: `resolveStoredModel` reads only cached model lists, no network. `activeProviderResolver` throwing would surface in the same path as main (start/resume/slash all inside existing try or result-shaping paths; fallback path unchanged in position).
5. Missing: nothing beyond the notes below.

## Findings

### Moderate

- M1 `chat-session.service.ts` resume (~L1687-1692) and `chat-slash-command-router.service.ts` (~L322-327): the arguments of `prepare()` include `await this.sessionMetadataStore.get(sessionId)` / `await this.metadata?.get(...)`, evaluated after the model setting is read. So rule 1 ("read after the last await before prepare()") is literally not met for resume and slash with a bound profile service. Impact is low: only the raw stored string can be one await stale, and the provider check plus profile are evaluated together later inside `prepare()`. Fix if wanted: hoist the metadata `get` above the model read (resume and slash), or read the model inside the arg list. Not behavior-changing versus main in any harmful way.

### Minor

- m1 Duplicated Claude-branch logic: `resolveClaudeExecution` (`chat-runtime-profile.service.ts`) and the resolver's claude return (`workspace-provider-profile-resolver.ts:247-256`) implement the same rule twice. Drift risk. Consider having the fallback call `resolveExecutionProfile`-like shared helper, or a spec that asserts both agree.
- m2 Spec gap: no test that, with a bound `ChatRuntimeProfileService` returning `runtime: 'claude-sdk', model: 'default'` for a stored mismatched model, `startChatSession` / `resumeSession` receives `model: 'default'` (existing native specs only pass `model: 'sonnet'` fixtures equal to the input). `chat-runtime-profile.service.spec.ts` passes `requestedModelIsStored: false` only (L105, L179); the stored-true propagation from `prepare(..., true)` into the resolver request is covered only indirectly via call-argument assertions in the session/router specs. Add one `prepare(config, undefined, true)` assertion that the resolver receives `requestedModelIsStored: true`.
- m3 Idle-coalesce spec (see below) is fine but its comment could say why microtask count is no longer stable.

## Idle-coalesce spec change (`chat-slash-command-router.idle-coalesce.spec.ts:~234`)

Verdict: does not hide a real ordering regression.
- The router gained an extra `async` hop (`resolveClaudeExecution`), so two `await Promise.resolve()` ticks no longer reach `executeSlashCommand`; the count of ticks is an implementation detail.
- The assertions that matter are unchanged and still strict: both sends reach `executeSlashCommand` (called 2 times) while both deferred streams are pending, `claimIdle` returns `'manual-reserved'` (reservation held by overlapping sends), stays reserved after the first settles, and `'claimed'` only after the second settles. `setImmediate` runs after all queued microtasks and cannot let either deferred stream resolve (they resolve only when the test calls `resolve`), so ordering semantics are not weakened.
- Residual: a regression that introduced a macrotask boundary before reservation would be masked, but reservation is taken before the profile resolution in the router, and the other idle-coalesce cases still cover release-on-throw.

## Spec adequacy

Adequate: resolver spec covers Claude-only application, native not calling it, and many `resolveStoredModel` cases (`:1036-1206`); fallback explicit/stored paths covered in `chat-session-provider-profile.spec.ts:379-438`; `modelIsStored` flag asserted in native session/router specs (`chat-session.native.spec.ts:133-134, 164`, `chat-slash-command-router.native.spec.ts:126, 244-246, 290`). Gap per m2.

## Verdict

- Recommendation: APPROVE
- Confidence: MEDIUM-HIGH (static review; tests not run by me)
- Top risk: literal ordering deviation from rule 1 on resume/slash (M1), harmless in effect.
