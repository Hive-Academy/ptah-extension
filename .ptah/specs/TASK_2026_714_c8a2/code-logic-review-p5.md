# Code Logic Review P5 — TASK_2026_714_c8a2

Score: 6.5/10
Verdict: REVISE

Scope: combined diff 16c6455e1..953fee97d under libs (resolver, usage service, owner resolver, register-providers, shared contracts). Read in full: resolveExecutionProfile, CodexAccountUsageService home paths, CodexHomeAuthService.forHost, normalizeCodexHomeKey, core usage client read/clearCache, shared session-runtime types and schemas. Heavy checks not run.

No TODO/PLACEHOLDER/STUB markers, empty bodies or mock logic in P5 code (the only "PLACEHOLDER" hit is the pre-existing OLLAMA token). Gate-closed constraint holds: the native branch only runs when a caller passes hostCapabilities.nativeCodex, and nothing in P5 calls it. The native branch makes no proxyPool, authManager or buildProfile call and does not touch AuthEnv.

## Findings

1. SERIOUS — resume check uses the current active provider, not the persisted identity
   (workspace-provider-profile-resolver.ts:~138-160). `active = resolveActiveAuthForPath(workspacePath)`, then the comparison identity is built with `providerId: active.providerId`. Once a workspace switches away from openai-codex, `sessionRuntimeIdentityMismatch` returns `providerId` and the session throws AuthRequiredError, so a native session becomes unresumable after any provider switch. The plan says dispatch follows the immutable identity, not the focused provider. Also, the `existingIdentity ||` branch still queries the active provider, which is useless on resume. Fix: when `existingIdentity` is native, take the expected provider as the literal 'openai-codex' (the identity's own provider must equal it), validate workspace and home only, and consult the active provider only for fresh starts. If product intent is that switching must block resume, record that as an explicit decision with a distinct error message. It must not be an accidental side effect.

2. SERIOUS — workspaceId compared as a raw path string (same function, `workspaceId: workspacePath`). On Windows, "D:\\Proj" vs "d:/proj" vs a trailing separator produce a spurious `workspaceId` mismatch and fail resume. The home is normalized (normalizeCodexHomeKey) but the workspace is not. Normalize both sides with one shared helper (win32 case-fold, separators, trailing slash) before comparing, or define workspaceId as a normalized key at persist time. Also compare against `existingIdentity.workspaceId` normalized, not the caller string.

3. MODERATE — native model resolution (same file, resolveModel with `{}` snapshot). It is credential-free. `default` resolves to the first static Codex model (gpt-6.1-sol), which is correct. But a `claude-*` requested model (the usual chat default) passes straight through the ModelResolver (model-resolver.ts:39-50) and lands in `seed.model`. 'opus', 'sonnet' and 'haiku' depend on `getDefaultTiers({})` and are unverified. A native seed should only keep a model the Codex catalog knows. Otherwise it should fall back to the Codex default. Pin this in a spec.

4. MODERATE — `normalizedHome` min(1) only (session-runtime.schemas.ts). The schema does not enforce an absolute or normalized home, and `workspaceId` and `providerId` are free strings. Identity relies on hosts having normalized the values. Consider a refine calling the same normalizer, or at least document that the mismatch helper compares raw strings.

5. MINOR — `PERMISSION_PROMPT_CANCELLED` was added to MESSAGE_TYPES with no payload-map entry (message-constants.ts:231, payload type in session-runtime.types.ts:78). It is harmless now, but wire it when P6 consumes it so the type and payload cannot drift.

6. MINOR — auth-file-changed handling. The event listener calls `clearCache()` (default home only). Explicit-home core caches are cleared only via `clearCache(home)` or the core client's own subscription. Confirm in P8 composition that the core client invalidates on auth change for explicit homes.

## Rulings on the questions

Q1: Not correct (findings 1 and 2). Verified failure: a native session is unresumable after a workspace provider switch, and Windows path variants cause spurious mismatches.

Q2: Credential-free, and `default` maps correctly. Non-Codex requested models leak through (finding 3).

Q3: No path gives an explicit home default data. `homeKind` normalizes both sides: undefined and lexical aliases of the default map to the legacy path (default behaviour unchanged, since the `options.home !== undefined` early return was replaced by an equivalent explicit-only path). Explicit homes go to the core client, or to `service-unavailable` and `null` owner key when no client is bound, so there is no default leakage. Invalid homes return unavailable or null without throwing. `clearCache(home)` for an explicit home clears only the core client, as intended. `ProviderOwnerResolver` methods cannot throw: the core read converts errors to unavailable.

Q4: `SDK_CODEX_HOME_AUTH` uses `CodexHomeAuthService.forHost` (a WeakMap keyed by the workspace provider), and the facade uses the same call, so they share one owner provided both resolve the same IWorkspaceProvider (true within one container). The null usage client is registered only if absent (recursive `isRegistered`), and a later host binding overrides it. The only residual risk is that the usage service instance is resolved before the host binding, caching null. The binding must occur during composition before first resolve (P8).

Q5: Schemas are strict and discriminated on `runtime`, and SessionId is validated and branded. Parse failures return a content-free `rejected` code. The mismatch helper priority order is sane, and sessionId is deliberately ignored. The main barrel exports the types only (the zod schemas go through schemas.ts), so it stays zod-free.

Apply findings 1 and 2 and re-review that function. Findings 3-6 can be tracked.
