# Code Logic Review — TASK_2026_250

Note: this change has already been committed. Findings below are recorded at
their honest severity as if pre-merge; treat any Critical/Serious item as a
required follow-up fix rather than a blocker, per the coordinator's note.

## Review Summary

| Metric              | Value                                                                                |
| ------------------- | ------------------------------------------------------------------------------------ |
| Overall Score       | 7/10                                                                                 |
| Assessment          | APPROVED-AS-LANDED (two documentation-accuracy follow-ups needed, not a revert case) |
| Critical Issues     | 0                                                                                    |
| Serious Issues      | 1                                                                                    |
| Moderate Issues     | 2                                                                                    |
| Minor Issues        | 1                                                                                    |
| Failure Modes Found | 3                                                                                    |

The production change (`model-resolver.ts`) is correct on every path
verified mechanically: key composition, defaults, no-defaultValue
precedence, and the `ModelResolver` tier-substitution mechanism all check
out against the real files, not just the implementation report's citations.
The issues found are in the new prose (docblock + `CLAUDE.md`), which
overclaims reachability, and in one un-mentioned call site whose behavior
silently changed.

---

## What was verified, file and line

### 1. Key composition parity — VERIFIED CORRECT

- `libs/backend/skill-synthesis/src/lib/model-resolver.ts:95-104` composes
  `provider.${authKey}.selectedModel` via
  `resolveAuthProviderKey(authMethod, anthropicProviderId)`.
- `libs/backend/platform-core/src/settings-auth-key.ts:12-23` —
  `resolveAuthProviderKey`: `authMethod === 'thirdParty'` returns
  `thirdParty.${providerId || 'unknown'}`, else returns `authMethod`
  verbatim (covers `apiKey`, `claudeCli`).
- `libs/backend/settings-core/src/repositories/model-settings.ts:31-43` —
  `ModelSettings.resolveKey()` calls the **exact same**
  `resolveAuthProviderKey` import, with `authMethod ?? AUTH_METHOD_DEF.default`
  and `providerId ?? ''`, producing `provider.${authKey}.selectedModel`.
- Both call sites import the one function from `platform-core`; they cannot
  structurally diverge. Holds for `apiKey`, `claudeCli`, `thirdParty`
  (built-in and user-defined ids alike — `PROVIDER_AUTH_MODEL_PATTERN`,
  `file-settings-keys.ts:634-635`, file-routes
  `provider.thirdParty.<any-id>.selectedModel` for custom providers too).
- No "subscription" auth method distinct from `claudeCli` exists —
  `AUTH_METHOD_SCHEMA` (`settings-core/src/schema/auth-schema.ts:5`) is
  `z.enum(['apiKey', 'claudeCli', 'thirdParty'])`, confirmed by reading the
  file directly.

**Conclusion**: the defect most suspected in the review brief does not
exist. A user who pinned a model will not silently fall through to
`JUDGE_DEFAULT_MODEL_ID` for any auth method.

### 2. `DEFAULT_AUTH_METHOD = 'apiKey'` — VERIFIED CORRECT

- `model-resolver.ts:20`: `const DEFAULT_AUTH_METHOD = 'apiKey';`
- `settings-core/src/schema/auth-schema.ts:8-16`:
  `AUTH_METHOD_DEF.default = 'apiKey' as const`. Exact match.
- `settings-core/src/migrations/v2-migration.ts:47`:
  `resolveAuthProviderKey(authMethod || 'apiKey', providerId)` — the
  migration that moved `model.selected` to `provider.<authKey>.selectedModel`
  uses the identical fallback.

### 3. The no-`defaultValue` read — VERIFIED CORRECT

- `model-resolver.ts:31-34` (`readSetting`) calls
  `ws.getConfiguration<string>(SECTION, key)` with no third argument.
- `platform-core/src/file-settings-manager.ts:76-90`
  (`PtahFileSettingsManager.get`): precedence is in-memory value → caller
  `defaultValue` only if `!== undefined` → `this.defaults[key]`
  (`FILE_BASED_SETTINGS_DEFAULTS`). Omitting the third argument means
  `defaultValue` is `undefined`, so the registered default is used —
  verified by reading the method body directly.
- All three adapters forward the third argument identically:
  `platform-vscode/.../vscode-workspace-provider.ts:76-83`,
  `platform-electron/.../electron-workspace-provider.ts:87-96`,
  `platform-cli/.../cli-workspace-provider.ts:87-96`.
- `authMethod`, `anthropicProviderId` are both in `FILE_BASED_SETTINGS_KEYS`
  (`file-settings-keys.ts:154-156`) with registered defaults (`'apiKey'`,
  `'openrouter'`, `:236-237`). `provider.apiKey.selectedModel` and
  `provider.claudeCli.selectedModel` are in `FILE_BASED_SETTINGS_KEYS` via
  `KNOWN_AUTH_KEYS_FOR_FILE_ROUTING.flatMap(...)` (`:33-42,403`), each
  defaulting to `''` (`:582-587`). `provider.thirdParty.<custom-id>.selectedModel`
  is routed by `PROVIDER_AUTH_MODEL_PATTERN` (`:634-635`) with no registered
  default — `get()` returns `undefined`, which `readSetting`'s
  `typeof raw === 'string'` guard turns into `''`, the same "nothing
  configured" outcome the function wants. Not a bug.

### 4. The `ModelResolver` remapping claim (Decision 1's mechanism) — VERIFIED TRUE

- `libs/backend/auth-providers/src/lib/auth/model-resolver.ts:38-46`
  (`ModelResolver.resolve`): a `claude-*` id has its tier detected and, if
  `env[TIER_ENV_VAR_MAP[tier]]` is set and differs from the literal, that
  override is returned instead — the exact mechanism `CLAUDE.md` and the new
  docblock describe.
- `libs/backend/auth-providers/src/lib/provider-models.service.ts:604-636`
  (`applyPersistedTiers`) populates `this.authEnv[envKey]` (i.e.
  `ANTHROPIC_DEFAULT_<TIER>_MODEL`) from the user's persisted tier mapping,
  falling back to `getAnthropicProvider(providerId)?.defaultTiers`; its own
  doc comment says "Call this during authentication setup when a provider is
  active."
- `libs/backend/skill-synthesis/src/lib/internal-query.interface.ts:31-38`
  documents that an absent `auth` on `execute()` falls through to
  `this.authEnv` — the same ambient env `applyPersistedTiers` populates.

**Conclusion**: the mechanism is real, not an invented guarantee.

**Caveat**: not traced — whether `applyPersistedTiers` fires on every
provider's auth-setup path, and whether every `ANTHROPIC_PROVIDERS` entry
has a non-empty `defaultTiers.haiku`. If some entry lacks it and the user
never manually set a haiku override, `applyPersistedTiers` skips setting
`ANTHROPIC_DEFAULT_HAIKU_MODEL` (`:626-634`, guarded by `if (value) {...}`),
and `ModelResolver.resolve` returns the pinned `claude-haiku-...` id
unchanged (`model-resolver.ts:44`) — 404 against that provider's endpoint.
Not ruled out; see "Not verified."

### 5. Lane "no provider branching" scan surface — GAP CONFIRMED, PRE-EXISTING

- `lanes/lane-resolver.providers.spec.ts:198-211` ("names no registry
  provider anywhere in the resolver source") scans only
  `LaneResolverService.prototype.resolve/.readConfig/.readConfigs`
  `.toString()`. `resolveLaneModel`/`resolveJudgeModel` are free functions,
  not prototype methods — their source is not part of any `.toString()`
  scanned here.
- `CLAUDE.md` bullet 1 ("pinned mechanically by
  `lane-resolver.providers.spec.ts`") does not, in fact, cover
  `resolveJudgeModel`. Pre-dates this diff (the old `llm.vscode.model`
  version was equally unscanned) — not a regression. The implementation
  report scopes its own claim accurately and does not overclaim coverage
  here; `CLAUDE.md` bullet 1 (unchanged) is the one place a reader could
  over-infer. The code itself is clean regardless — zero provider-id
  literals in `resolveJudgeModel`.

### 6. The two changed seeds in `lane-resolver.service.spec.ts` — VERIFIED NOT TAUTOLOGICAL

- `:99-115` and `:139-155` seed `'provider.apiKey.selectedModel'` and assert
  the resolved model equals that value. Under the reverted (old)
  `llm.vscode.model`-reading production code, this mock workspace has no
  such key, so the old code would return `JUDGE_DEFAULT_MODEL_ID`, not the
  seeded value — the assertions are real and discriminating, not renamed
  tautologies.

### 7. Decision 1's hard constraint (nothing-configured → `JUDGE_DEFAULT_MODEL_ID`, all paths) — VERIFIED

- Empty/whitespace `configured` → `JUDGE_DEFAULT_MODEL_ID`
  (`model-resolver.ts:105`, `readSetting` trims).
- Any thrown error inside `try` propagates to
  `catch { return JUDGE_DEFAULT_MODEL_ID; }` (`:106-108`) — verified by
  reading the full function body.
- `JUDGE_DEFAULT_MODEL_ID` unchanged (`types.ts:9`), and
  `lane-resolver.service.spec.ts:122` (moved from `:116`, content unchanged)
  still pins the lane-level version.

---

## Findings, ranked by severity

### Serious — Finding 1: the new docblock's reachability claim is false; a second, undocumented caller exists

- **File**: `model-resolver.ts:45-46` ("This function is only reached on the
  branch where the lane names NO provider...")
- **Scenario**: `skill-enhancer.service.ts:690`
  (`SkillEnhancerService.generateCandidate`) calls
  `resolveJudgeModel(settings.judgeModel, this.workspaceProvider)` directly
  and passes the result to `this.internalQuery.execute({...})` at
  `:740-746` with **no `auth` field** — confirmed by reading both call
  sites. This is not a lane at all, contradicting the docblock's exclusive
  reachability claim.
- **Impact**: not a functional bug — `execute()` without `auth` falls
  through to the same ambient `AuthEnv`, so the safety argument still holds
  for this caller too. But the stated justification is factually wrong, and
  a future reader trusting it to reason about blast radius works from a
  false premise. The docblock this replaced had the same class of error in
  reverse (claiming "SkillJudgeService and SkillCuratorService" as direct
  callers, when they actually go through `LaneRunnerService →
LaneResolverService.resolve → resolveLaneModel` —
  `skill-judge.service.ts:44`, `skill-synthesizer.service.ts:51`).
- **Fix (now a follow-up, since this has landed)**: name
  `SkillEnhancerService` explicitly as a second, direct, non-lane caller, or
  drop the specific reachability claim from the docblock.

### Moderate — Finding 2: an existing-install behavior change on the `SkillEnhancerService` path is not named anywhere

- **Files**: `skill-enhancer.service.ts:690`, `context.md`,
  `implementation-report.md`.
- **Scenario**: pre-diff, `generateCandidate`'s `resolveJudgeModel('inherit', ws)`
  read `llm.vscode.model`; any install with a persisted or
  settings-import-restored value there fed it into skill/agent/command
  **enhancement** calls. Post-diff, the same call site now reads
  `provider.<authKey>.selectedModel` — a different, real value on any
  install where the two keys diverge.
- **Impact**: very likely a net improvement (same fix class as the lane
  path, one caller earlier), but nowhere named as an affected consumer —
  not in `context.md`, not in the implementation report's blast-radius
  section (which scopes only `JUDGE_DEFAULT_MODEL_ID`'s consumers, not
  `resolveJudgeModel`'s callers), not in the new docblock/CLAUDE.md text.
  No spec exercises this call site.
- **Fix (follow-up)**: name this caller in the docs; add a thin spec
  asserting `generateCandidate` passes `resolveJudgeModel`'s output through
  unchanged.

### Moderate — Finding 3: unverified edge in the `ModelResolver` remapping guarantee

- **File**: `provider-models.service.ts:604-636`,
  `auth-providers/.../model-resolver.ts:38-46`.
- **Scenario**: a registry entry in `ANTHROPIC_PROVIDERS` with no
  `defaultTiers.haiku`, combined with a user who never manually set a haiku
  tier override, leaves `ANTHROPIC_DEFAULT_HAIKU_MODEL` unset in the ambient
  env → `ModelResolver.resolve('claude-haiku-4-5-20251001')` returns the
  literal unchanged → sent verbatim to that provider's non-Anthropic
  endpoint on the nothing-configured path.
- **Impact**: if such a provider exists, Decision 1's central safety
  argument has a hole for it. Not confirmed or ruled out — inherited risk
  from pre-existing `ModelResolver`/`ProviderModelsService` machinery, not
  introduced by this diff.
- **Fix (follow-up, low urgency)**: read the `ANTHROPIC_PROVIDERS` registry
  to confirm every entry defines a haiku default tier.

### Minor — Finding 4: `providerSelectedModelDef`'s schema was not opened

- **File**: `settings-core/src/schema/provider-schema.ts` (referenced at
  `model-settings.ts:9,45`, not read this session). The `typeof raw ===
'string'` guard in `readSetting` is defensive either way, so this is filed
  as an unverified detail, not a suspected defect.

---

## Not verified

- `provider-schema.ts` — `providerSelectedModelDef`'s exact Zod shape
  (Finding 4).
- Whether `applyPersistedTiers` is invoked on every third-party provider's
  auth-setup path (Finding 3).
- Whether every `ANTHROPIC_PROVIDERS` entry has a non-empty
  `defaultTiers.haiku` (Finding 3 — the single check that would most change
  confidence in Decision 1's rationale).
- Full end-to-end read of `lane-resolver.service.ts` (read via targeted
  excerpts only: docblock, `resolveLaneModel`, top of `resolve()`). Nothing
  read contradicts the report; the tail of `resolve()` (catch/backoff
  handling) was not read, being unrelated to this diff.
- Did not run the test suite or lint myself; relied on the report's stated
  gate output plus an independent static re-derivation of why the two
  changed seeds are discriminating (item 6 above).

---

## Verdict

**Recommendation**: the production logic is sound as landed — no revert or
hotfix warranted. The core logic (key composition, defaults,
no-defaultValue precedence, Decision 1's hard-constraint paths) is correct
on every path verified against the actual files, and the defect most
suspected going in (key composition mismatch) does not exist.

**Follow-up required, not blocking**: Finding 1 (false reachability claim in
the docblock) should be corrected — it names the wrong set of callers and
could mislead a future reader reasoning about blast radius from the comment
alone. Finding 2 (the `SkillEnhancerService` behavior change) should be
named in the record even though it already shipped, since nobody currently
knows to watch for it.

**Confidence**: MEDIUM-HIGH. High on the parts traced through real source
(items 1-3, 6-7, and the mechanism half of item 4). Medium on Decision 1's
overall safety guarantee, gated on the open question in Finding 3.

**Top risk**: not introduced by this diff — the pre-existing possibility
(Finding 3) that some `ANTHROPIC_PROVIDERS` entry has no
`defaultTiers.haiku`. The one risk this diff did introduce is Finding 1's
overclaimed docblock reachability.
