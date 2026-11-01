# Code Style Review - TASK_2026_714_c8a2 Phase P5

Scope: `git diff 16c6455e1..953fee97d -- libs` (19 files; 5a shared contracts, 5b usage service + tokens + registration, 5c profile seam + owner resolver + exports). Source files read in full for the diff hunks; specs skimmed. No checks run (team-leader ran scoped lint/test/typecheck).

Score: 7/10
Verdict: APPROVED

No blocking or serious findings. The shared contracts follow the provider-account types/schemas split, keep the main barrel zod-free, and the zod-free guard spec was extended to cover the new types file. Tokens live in `auth-providers-tokens`. The nullable core client follows the core's own `useFactory: () => null` pattern. The findings below are moderate/minor cleanups, none changing behavior.

## Findings

### Moderate

1. `libs/backend/auth-providers/src/lib/auth/workspace-provider-profile-resolver.ts:122-134` - public `resolveExecutionProfile` has an anonymous inline input type and an anonymous inline union return type. Every P6/P7 caller will have to restate or `Parameters<>`-extract them. Name them (`ExecutionProfileRequest`, `ExecutionProfile`) next to the class and export from the barrel when the first consumer lands. The `existingIdentity?.runtime !== 'claude-sdk'` guard followed by a second compound `existingIdentity || (... nativeCodex)` condition (:138-152) is also hard to read; hoist the "is native codex" decision into a named local.
2. `libs/backend/auth-providers/src/index.ts:45-50` and `register-providers.ts:63-70` - new public exports (`CodexHomeAuthService`, `resolveCodexProxyPolicy`, `CodexProxyPolicy`, `ICodexOwnerKeySource`) and the `SDK_CODEX_HOME_AUTH` token/registration have no consumer outside auth-providers in this phase (grep: only in-lib users; nothing resolves `SDK_CODEX_HOME_AUTH`). Likewise shared `SessionRuntimeControls`, `PermissionPromptCancelledPayload`, `RuntimeConsumer` and `PERMISSION_PROMPT_CANCELLED` (`message-constants.ts:231`) are unconsumed. This is consistent with decisions P5-D4/D5 (consumers in P6-P8), but it is speculative API surface until then; record the intended consumer batch beside each export or defer the barrel exports to that batch.
3. `libs/backend/auth-providers/src/lib/quota/provider-owner.resolver.ts:566-568` - `ownerForCodexHome(home)` builds the unknown owner key from the raw `home`, while `CodexAccountUsageService.homeKind` treats a lexical alias of the default home as the default. An alias therefore yields a different unknown-owner key than the default call. Normalize (or fall back to `this.codexHome.path` when the home is the default) so both paths produce the same key. Also the doc comment above (:561-564, "resolved `CODEX_HOME`") no longer describes the new `home` parameter.

### Minor

4. Unrelated formatting churn: `provider-owner.resolver.ts:646-649` (re-wrapped `readAccountForRoute` call) and `libs/backend/auth-providers/src/index.ts:4-7` (re-wrapped `export type` list) are unrelated to P5. Drop or isolate in a format-only commit.
5. `libs/backend/auth-providers/src/lib/providers/codex/codex-account-usage.service.ts:~160-195` - `home !== undefined && kind === 'explicit'` is redundant since `homeKind` returns `explicit` only for a defined home; the three methods repeat the same three-way branch, and `clearCache` for an `invalid` home silently returns. Consider a single private `route(home)` returning `{ kind: 'default' } | { kind: 'explicit', home } | { kind: 'invalid' }`.
6. `libs/shared/src/lib/types/permission.types.ts:32` - `allowedDecisions` was inserted above `id`, the first field of `PermissionRequest`; neighbours put optional additions after the required identity fields. Move it down.
7. `libs/shared/src/lib/types/session-runtime.types.ts` - `PermissionPromptCancelledPayload.sessionId`/`requestId` are `string` while the same file types the identity's `sessionId` as the branded `SessionId`; use `SessionId` for consistency. `SessionApprovalDecision =\n 'accept' | ...` mirrors core's odd formatting; harmless.
8. `session-runtime.types.ts` is named `*.types.ts` but exports a runtime function (`sessionRuntimeIdentityMismatch`). Acceptable (zod-free spec covers it), but note `AppliedSettings` / `SessionApprovalDecision` are structural duplicates of `codex-runtime.types.ts` (recorded as P5-D2); add a type-level assignability check in a spec so drift between the two fails typecheck.
9. `workspace-provider-profile-resolver.ts:~160` - comment "Empty override prevents reads from the process-global auth environment" is accurate but the `{}` argument is undocumented at the `resolveModel` signature; fine for now.

## Pattern compliance

| Rule | Status | Evidence |
| --- | --- | --- |
| Main barrel stays zod-free; schemas behind `shared/schemas` | PASS | `index.ts` exports types only; `schemas.ts:29` exports schemas; zod-free spec extended |
| Types/schemas split like provider-account | PASS | `session-runtime.types.ts` + `session-runtime.schemas.ts` |
| Readonly contracts in shared | PASS | all interfaces `readonly`; `SessionRuntimeControls` is a method interface |
| No `any` / `@ts-ignore` / `as unknown as` | PASS | none in diff |
| Tokens in auth-providers-tokens | PASS | `tokens.ts:39-40` |
| Injected Logger | PASS | `forHost(c.resolve(TOKENS.LOGGER), ...)` |
| Cross-lib imports via package index | PASS | `@ptah-extension/codex-runtime` |
| No dead exports | PARTIAL | finding 2 |
| Minimal unrelated churn | FAIL (minor) | finding 4 |

## Maintenance debt

- Introduced: duplicate `AppliedSettings`/approval-decision shapes (recorded), unconsumed API surface, a third default/explicit home branch in the usage service.
- Net: small, reversible; mostly clean.
