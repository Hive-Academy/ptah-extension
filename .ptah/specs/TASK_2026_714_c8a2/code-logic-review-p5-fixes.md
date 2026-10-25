# Code Logic Review P5 Fixes - TASK_2026_714_c8a2

Range: 953fee97d..52e06df02. Score: 8.5/10. Verdict: APPROVED.

Scoped test run: `npm run verify -- -t test -p auth-providers` filtered to the resolver and owner-resolver specs: pass.

## Verified fixes

1. Resume no longer depends on the active provider (was logic finding 1). `workspace-provider-profile-resolver.ts` `resolveExecutionProfile`: the expected identity uses the literal `providerId: 'openai-codex'`. `shouldStartNativeCodex` (the only caller of the active-provider resolver on this path) runs only when `!existingIdentity`. A stored identity with a different provider still yields a `providerId` mismatch (`session-runtime.types.ts:29`). A resume on a host without `nativeCodex` throws AuthRequiredError before any lookup. FIXED.
2. Workspace comparison is normalized (was logic finding 2). `workspaceIdentityKey` resolves, trims trailing separators (keeping a root), converts backslashes and case-folds on win32. It is applied to both the stored and the current side. It is idempotent on win32 for already-normalized keys. Stored home and current home both go through `normalizeCodexHomeKey`, and a throw maps to a content-free AuthRequiredError. FIXED.
3. Native seed model (was logic finding 3). `resolveNativeCodexModel` maps opus/sonnet/haiku through `CODEX_DEFAULT_TIERS`, keeps only ids found in `CODEX_PROVIDER_ENTRY.staticModels`, and otherwise falls back to `staticModels[0]`. `claude-*` and `default` therefore no longer leak. FIXED.
4. Default-home alias owner key (style finding 3). `provider-owner.resolver.ts` `ownerForCodexHome` uses `this.codexHome.path` when a home that normalizes equal to the default has no known key. A normalizer throw is caught, so an invalid home stays an isolated unknown owner and discovery does not fail. FIXED.
5. Request and result types (style finding 1) are named and exported from `index.ts`. There is no behavioral effect.

## Residual defects (none blocking; the fix-round cap is reached, so these go to later batches)

- MODERATE (new, minor): `workspaceIdentityKey` replaces `\` with `/` on every platform and calls `path.resolve`, which depends on the process cwd for a relative stored `workspaceId`. On POSIX a directory whose name contains a backslash would collide with a path using `/`. This is unlikely in practice. P6 should persist workspaceId already normalized, using the same helper, and the helper should move to a shared location so the persist side and the compare side cannot drift. A stored non-path id would be resolved against cwd, but since both sides go through the same function, the result is consistent.
- MODERATE: model matching is case-sensitive and exact. An id that differs only in case silently becomes the Codex default (`gpt-6.1-sol`). The user is not told of the substitution. This is acceptable for the gate-closed seed, but P6 should surface the substituted model.
- MINOR: logic findings 4-6 (schema refine for normalizedHome, the unwired PERMISSION_PROMPT_CANCELLED payload, explicit-home cache invalidation in P8) remain open, as already tracked.

## Five questions (fix scope)

1. Silent failure: none new. Invalid home and workspace mismatches throw coded, content-free errors.
2. User action: switching provider no longer breaks resume. This is now an implicit behavior. Record it explicitly in the P6 spec if the product wants blocking.
3. Wrong answer: only the case-variant model substitution above.
4. Dependency failure: the resolver reads no credentials on the native path. An active-provider failure affects only fresh starts.
5. Missing: a shared workspace-key helper, and the substitution signal for the model.
