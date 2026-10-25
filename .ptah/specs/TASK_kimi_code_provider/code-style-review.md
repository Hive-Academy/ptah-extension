# Code Style Review — `TASK_kimi_code_provider`

## Summary

| Metric          | Value         |
| --------------- | ------------- |
| Overall score   | 8/10          |
| Assessment      | APPROVED      |
| Blocking issues | 0             |
| Serious issues  | 1             |
| Minor issues    | 3             |
| Files reviewed  | focused sample of ~140 changed paths (new entry, sdk-model-service, api-key.strategy, provider-auth-resolver, workspace-provider-profile-resolver, provider-models.service, ptah-cli-registry, barrels), plus repo-wide greps on the diff |

Scope: static read and grep only. No tests, typecheck or lint were run (per instruction). Spec files and the frontend lane were checked by grep, not read in full.

## Five style questions

1. Six months out: `KIMI_CODE_MODEL_CAPABILITIES` is applied identically to all seven models (`kimi-code-provider-entry.ts:36-60`). If one model diverges (K3.1 Pro is thinking-only), the shared constant must be split. Acceptable today.
2. A new reader may misread `keyPrefix: ''` (`kimi-code-provider-entry.ts:~140`); the header comment explains it. Tier labels show raw ids for Kimi (HANDOFF-noted cosmetic gap).
3. The same fail-closed message is spelled out three times (see Serious 1).
4. Consistent with siblings: entry file layout mirrors `codex-provider-entry.ts` (`*_DEFAULT_TIERS`, private `*_STATIC_MODELS`, `*_PROVIDER_ENTRY`). Barrels updated in `agent-sdk/src/index.ts:314` and `helpers/index.ts:222`.
5. I would extract the unknown-provider guard into one helper in auth-providers.

## Blocking issues

None found.

- Leftover `moonshot` in non-spec production code outside the allowlist: only `provider-auth-resolver.ts:636` (a comment explaining the fail-closed case, legitimate) and `provider-accent.ts:13` (allowlisted). Spec hits are all fail-closed or legacy-id regression tests.
- No added `as any`, `@ts-ignore`, `eslint-disable` or `as unknown as` in non-spec diff lines.
- Import boundaries: auth-providers and cli-agent-runtime import `buildStaticTierCapabilityEnv` / `ALL_TIER_ENV_KEYS` from the `@ptah-extension/agent-sdk` barrel (`ptah-cli-registry.ts:43`, `workspace-provider-profile-resolver.ts`), not deep paths. agent-sdk imports `getStaticModelCapabilities` from the `@ptah-extension/shared` barrel (`sdk-model-service.ts`). No adapter imports.

## Serious issues

### Fail-closed message duplicated three times

- File: `libs/backend/auth-providers/src/lib/auth/provider-auth-resolver.ts:256`, `provider-auth-resolver.ts:641`, `libs/backend/auth-providers/src/lib/auth/strategies/api-key.strategy.ts:565`
- Problem: the literal `Provider '${providerId}' is not available in this version of Ptah. Choose a provider in Settings.` and the "registry does not know this id" check are copied in three places.
- Tradeoff: three copies will drift (the wording is user-facing and asserted by specs, e.g. `api-key.strategy.spec.ts:769`).
- Recommendation: one exported helper (e.g. `unknownProviderMessage(id)`) next to `ProviderAuthError`. Non-blocking.

## Minor issues

- No `kimi-code-provider-entry.spec.ts`, although `codex-provider-entry.spec.ts` exists for the same shape (tier ids are listed models, capabilities non-empty). `tier-capability-env.spec.ts` covers the helper only.
- `KIMI_CODE_MODEL_CAPABILITIES` is exported from `libs/shared/src/lib/providers/index.ts:37` but has no consumer outside the entry file; drop the export unless a spec needs it.
- `sdk-model-service.ts` doc comment lines now exceed the surrounding wrap width (`Under a translation proxy (Codex, Copilot, OpenRouter, Kimi Code, …)`); formatter-owned, ignore if Prettier passes.

## File-by-file

### kimi-code-provider-entry.ts

Score 9/10 — 0 B, 0 S, 1 M. Mirrors the codex entry layout. Header explains the non-obvious choices (no `modelsEndpoint`, empty `keyPrefix`, `adaptive_thinking` absent). Static models typed `ProviderStaticModel[]`, capabilities `readonly ModelCapability[]` with no casts.

### sdk-model-service.ts

Score 8/10 — `buildStaticTierCapabilityEnv` is documented, exported through both barrels, and writes keys only for non-empty lists. Reused by three callers (workspace snapshot, lane registry, models service) rather than copied.

### api-key.strategy.ts / provider-auth-resolver.ts

Score 7/10 — 0 B, 1 S. Behaviour is right; message duplication is the cost.

### provider-models.service.ts

Score 8/10 — capability fallback via `getStaticModelCapabilities` is narrow and the comment states why `_NAME`/`_DESCRIPTION` do not fall back.

### ptah-cli-registry.ts

Score 8/10 — `applyTierEnv` is a single merge point used at both call sites (lines 1465 and 1578).

## Pattern compliance

| Repository rule or nearby convention | Status | Evidence |
| --- | --- | --- |
| Cross-lib imports through `@ptah-extension/<lib>` barrels | PASS | `ptah-cli-registry.ts:43`, `agent-sdk/src/index.ts:314` |
| No `eslint-disable` of module boundaries in production code | PASS | grep of added lines: none |
| No new `as any` / `@ts-ignore` / unsafe casts | PASS | grep of added non-spec lines: none |
| Provider entry file naming (`*-provider-entry.ts`, `*_PROVIDER_ENTRY`) | PASS | `kimi-code-provider-entry.ts` |
| Entry-file spec like Codex | FAIL (minor) | `codex-provider-entry.spec.ts` exists, no Kimi equivalent |
| Leftover `moonshot` outside allowlist | PASS | only `provider-auth-resolver.ts:636` comment and spec regression tests |
| Hexagonal ports / platform adapters | NOT_APPLICABLE | no port or adapter touched |
| Commit scope enum | NOT_VERIFIED | no commit yet; check `.commitlintrc.json` for `kimi-code`-related scopes |

## Maintenance debt

- Introduced: one provider entry, one shared helper, a repeated guard message.
- Retired: the whole `moonshot` provider path and its tier/pricing special cases.
- Net: positive, one provider replaces another with a reusable capability mechanism.

## Verdict

- Recommendation: APPROVE
- Confidence: MEDIUM (spec files and the 31 frontend files were grepped, not read in full; nothing was executed)
- Key concern: unknown-provider guard and message are copied in three places.
- What a 10/10 version would do differently: single guard helper, an entry spec mirroring `codex-provider-entry.spec.ts`, no unused export.
