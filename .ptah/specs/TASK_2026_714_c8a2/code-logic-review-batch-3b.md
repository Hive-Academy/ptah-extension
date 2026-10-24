# Code Logic Review — Batch 3b (6061732d1)

Review family: Claude reviewer, Codex implementer.
Evidence: scoped jest on auth-providers providers/codex + quota: 21 suites, 480 tests pass (integration spec excluded).

## Verdict: APPROVED — 8/10 (0 blocking, 0 serious, 2 moderate, 1 minor)

## Focus checks

1. Default-home users unchanged: PASS. For a default home, `entry()` (codex-home-auth.service.ts:~158-160) still resolves the same path; only the identity key differs (`normalizeCodexHomeKey`: trailing separators trimmed, lowercased on win32). `HomeAuthState` receives `homePath` (the case-preserving resolved path), so auth.json, models_cache.json, rename and watch paths are byte-identical to before. The only behavioral deltas are `listModels` debug logs. `resolveCodexHome` is unchanged.
2. Key vs path separation: PASS. `normalizeCodexHomeKey` is used only at codex-home-auth.service.ts:160 (Map key) and inside codex-runtime. Every I/O call goes through `HomeAuthState.home`/`authFilePath`. The win32 spec (`preserves mixed-case filesystem paths...`) asserts `readFile`, `writeFile`, `rename` and `watch` receive the mixed-case path while `toUpperCase()` aliases share one owner. Two caveats: (a) the first caller's spelling wins for an owner, which is fine for a case-insensitive filesystem; (b) the key throws for non-absolute input but `resolve()` always yields an absolute path, so it cannot throw here.
3. Reader home supplier: PASS for activation, see finding 1 for a latent trap. `createCodexPlanUsageReader`'s `homeSource` is optional and the only production call site, plan-usage.service.ts:157, passes none, so `home` is never sent and nothing activates alternate homes. No other caller of the new parameter exists in libs/ or apps/.
4. DTO re-export compatibility: PASS. `CodexAccountUsageStatus`/`CodexAccountUsageResult` in codex-runtime (codex-account-usage.types.ts) are field-for-field identical to the removed local types (status union, `account`, `quota.primary/secondary/rateLimitReachedType`, `activity`). They are re-exported from codex-provider.types.ts and onward through providers/codex/index.ts:20-22 and src/index.ts:109-111. Consumers: provider-rpc.handlers.ts:67 and provider-owner.resolver.ts:46 import `ICodexAccountUsageService` only, and the interface change is additive (optional `home`). No breakage.
5. listModels debug logs: PASS. Both messages are fixed strings (`Model discovery request failed.` / `unavailable.`) with no URL, token, status body or error text; a spec feeds `private-test-key` and body text through both failure paths and asserts neither appears. This also resolves my round-1 recommendation on this catch.

## Findings

1. MODERATE (latent), codex-provider.types.ts (ICodexAccountUsageService.getAccountUsage `home?`) vs codex-account-usage.service.ts:156-157: the interface now advertises `home`, but `CodexAccountUsageService.getAccountUsage` still takes `{refresh, signal}`, ignores `home`, and always reads `this.codexHome.path` (lines 270, 295, 356) and the default-home auth owner. Today no one supplies a home, so it is inert. But when a supplier is wired before 3b.1 lands, the reader would silently return default-home usage for another account's home (wrong data, attributed to the wrong account). Fix: have the service throw or return `service-unavailable` when `options.home` is set and differs (via `normalizeCodexHomeKey`) from `codexHome.path`, plus a spec, or do not put `home` on the interface until 3b.1.
2. MODERATE, codex-plan-usage.reader.ts:61: `...(homeSource && { home: homeSource() })` forwards `home: undefined` when the supplier returns undefined, indistinguishable from "default home" downstream; with finding 1 this means a supplier bug degrades silently to the default account. Prefer omitting the key and, if the supplier is present but yields undefined, treating it as an error.
3. MINOR, codex-home-auth.service.ts:175: change events emit `home: key`, which on win32 is now the lowercased identity key, not the real path. Safe for current consumers (codex-account-usage-client.ts:232 normalizes before comparing), but any future consumer that uses `event.home` for file access would hit a lowercased path. Document it as identity-only or emit `homePath`.

## Remaining uncertainty
Alternate-home behavior beyond the auth owner is untestable until #808/3b.1; the win32 mixed-case spec only runs on win32 (skipped elsewhere).
