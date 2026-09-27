# Code Style Review — Batches 7 & 8 — `TASK_2026_408`

## Scope

- Batch 7 (`@ptah-extension/shared`): `libs/shared/src/lib/providers/entries/codex-provider-entry.ts` (MODIFY), `codex-provider-entry.spec.ts` (CREATE, untracked).
- Batch 8 (`@ptah-extension/agent-sdk`): `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts` (MODIFY), `sdk-query-options-builder.spec.ts` (MODIFY).
- Read via `git -C D:\projects\ptah-extension-task-408 diff` for the two tracked files and full read of the untracked spec. All four files read in full, not only the diff hunks.
- Compared against sibling `opencode-provider-entry.spec.ts` (Batch 7 pattern) and the existing `Building SDK query options` log block and `includesUserSettingSource` predicate site (Batch 8 pattern).
- Verified `npx nx run-many -t test,lint,typecheck -p @ptah-extension/shared @ptah-extension/agent-sdk` — both projects pass all three targets (4/6 cached, 2/6 executed clean, no failures). Also ran the Batch 8 targeted guard: `npx nx test @ptah-extension/output-styles --testPathPattern=output-style-activation.resolver` — 9 suites / 250 tests pass, including the two guard-spec assertions (`libs/backend/output-styles/src/lib/output-style-activation.resolver.spec.ts:180-200`) that the builder still contains the literal `settingSources: includesUserSettingSource(` and no re-added localhost regex.

## Summary — Batch 7

| Metric          | Value                     |
| --------------- | ------------------------- |
| Overall score   | 9/10                      |
| Assessment      | APPROVED                  |
| Blocking issues | 0                         |
| Serious issues  | 0                         |
| Minor issues    | 1                         |
| Files reviewed  | 2                         |

**Verdict: APPROVED**

### Findings

- `codex-provider-entry.ts:13-24` — the header comment is rewritten from a false "kept in sync with SUPPORTED_MODELS" claim to an accurate one: fallback/display-only, `contextLength: 0` for every entry, real windows sourced from `CodexAuthService.listModels` (`codex-auth.service.ts:302`, `contextLengthSource: 'provider'` at `:333`). This directly retires the misleading comment the task targeted.
- All eight entries now carry `contextLength: 0` (`codex-provider-entry.ts:29,39,48,58,67,77,` plus the two new entries `:83-96`); `gpt-5.4` remains `STATIC_IDS[0]` (`codex-provider-entry.ts:27`, pinned by `codex-provider-entry.spec.ts:31-33`); `CODEX_DEFAULT_TIERS` is untouched (not in the diff, and pinned by `codex-provider-entry.spec.ts:70-79`).
- **Team-leader validation risks, re-checked against disk:**
  - **`contextLength: 0` never consumed as a real window** — confirmed. `provider-models.service.ts:381-391` only copies `m.contextLength` through to the UI-facing `ProviderModelInfo` shape for display; `codex-translation-proxy.ts:78-80` (`getStaticModels`) returns `{ id }` pairs only, never reads `contextLength`; `ptah-cli-registry.ts:245,321,1614` reference only `staticModels.length` and `staticModels[0]?.id`, never `contextLength`. No consumer treats `0` as a live window.
  - **Pricing seed adds nothing for `openai-codex`** — confirmed. `provider-registry.ts:899-900`: `seedStaticModelPricing` returns immediately when `isSubscriptionCoveredProvider(providerId)` is true, and `codex-provider-entry.spec.ts:107-118` pins that `openai-codex` is subscription-covered and that the pricing map gains zero new keys (both bare and lower-cased id) after seeding. The general `provider-lookup.spec.ts:154`-style assertion (declared-rate providers only) does not apply here because Codex never reaches the seeding branch at all — stronger than "adds nothing," it is skipped outright.
  - **`staticModels[0]` is still `gpt-5.4`** — confirmed at `codex-provider-entry.ts:27` and pinned by `codex-provider-entry.spec.ts:31-33,70`.
- Spec (`codex-provider-entry.spec.ts`) follows the sibling `opencode-provider-entry.spec.ts` header-comment-as-pin-list convention (compare `opencode-provider-entry.spec.ts:1-15` to `codex-provider-entry.spec.ts:1-13`), asserts order, no-duplicate-IDs, all-zero windows, tool-use flags, registry resolution identity (`toBe`, not `toEqual`, on `staticModels`), tier subset, and the pricing-skip behavior. No TODO/PLACEHOLDER/STUB markers, no empty bodies, no mock data standing in for logic.

### Minor

- `codex-provider-entry.ts:88,97` — the two new entries (`gpt-6-astra`, `gpt-5.6-sol`) have single-word descriptions (`'GPT 6 Astra'`, `'GPT 5.6 Sol'`) that are just the name restated, unlike the six existing entries which describe capability (`'GPT 5.4 -- advanced reasoning'` etc.). Cosmetic only — the field is display metadata, not behavioral, and the spec does not assert description content. No fix required for this task's scope; flagged for whoever next edits this file.

## Summary — Batch 8

| Metric          | Value                     |
| --------------- | ------------------------- |
| Overall score   | 8/10                      |
| Assessment      | APPROVED                  |
| Blocking issues | 0                         |
| Serious issues  | 0                         |
| Minor issues    | 1                         |
| Files reviewed  | 2                         |

**Verdict: APPROVED**

### Findings

- `sdk-query-options-builder.ts:1129-1133` — new `if (!includesUserSettingSource(...)) { this.logger.info(...) }` block sits directly after the existing `Building SDK query options` info log (`:1110-1128`), matching the plan's instruction to follow that pattern and using the same `this.logger.info` call shape as its neighbor.
- `sdk-query-options-builder.ts:1197,1211` confirm the log is purely additive: `settingSources` computation at `:1233-1237` is byte-identical to before the diff (`includesUserSettingSource(effectiveAuthEnv.ANTHROPIC_BASE_URL) ? ['user','project','local'] : ['project','local']`), and the literal `settingSources: includesUserSettingSource(` required by the output-styles guard spec is preserved verbatim.
- `sdk-query-options-builder.ts:1230-1232` — new comment is 3 lines, well under the 5-line budget, and names both "path A" and `.ptah/specs/TASK_2026_408/ownership.md` as required.
- No localhost regex was reintroduced in the builder (`output-style-activation.resolver.spec.ts:194-200` — the `not.toContain('(127\\.0\\.0\\.1|localhost)')` guard — passes), so the single-definition-of-the-predicate invariant this batch was required to preserve holds.
- Spec additions (`sdk-query-options-builder.spec.ts:767-909`) construct the builder through its full constructor argument list (matching the existing `makeBuilder`-style pattern used elsewhere in the file, consistent with how the rest of the spec builds the class under test) and cover: two localhost forms fire exactly one disclosure line with the exact expected string and drop `user` from `settingSources`; three non-localhost/absent cases fire none and keep `user`; and `authEnvOverride` is honored ahead of the constructor-level env. No TODO/PLACEHOLDER/STUB markers, no empty bodies, no mock data substituting for real assertions — the log content and `settingSources` array are both asserted with exact equality (`toEqual`/`toHaveLength`), not existence checks.

### Minor

- `sdk-query-options-builder.ts:1129` and `:1233` — `includesUserSettingSource(effectiveAuthEnv.ANTHROPIC_BASE_URL)` is called twice with identical arguments to decide two independent things (whether to log, and which `settingSources` array to build) instead of being evaluated once into a local and reused. Both calls are guaranteed to agree today because `effectiveAuthEnv` is not reassigned between them, but the duplication is exactly the shape the neighboring comment at `:1226-1229` warns future editors about ("the two must agree, and now they cannot disagree" — that comment is about `output-styles` vs the builder, not about these two in-function call sites). A `const userTierIncluded = includesUserSettingSource(...)` hoisted above `:1110` and reused at both sites would remove the chance of the two diverging under a future edit, at zero cost. Not blocking: no behavioral risk exists today, and the guard spec (`output-style-activation.resolver.spec.ts:181-200`) does not cover this internal duplication.

## Combined verdict

Both batches: **APPROVED**. No blocking or serious issues. Batch 7 score 9/10, Batch 8 score 8/10. All three team-leader-flagged Batch 7 validation risks are confirmed resolved against the current source, not merely asserted by the diff's own comments. Both projects' `test,lint,typecheck` pass, plus the Batch 8 cross-project guard spec in `@ptah-extension/output-styles`.
