# Code Style Review — TASK_2026_578_3b00

## Batch 2

Scope: `libs/backend/platform-core/src/file-settings-keys.ts`, `file-settings-keys.spec.ts`, `apps/ptah-docs/src/content/docs/skill-synthesis/settings.md`. Read in full around the diff, plus sibling context (`file-settings-manager.ts`, `skill-synthesis.service.ts`, the rpc handler and schema, `skill-clustering.service.ts`).

Checks run: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/platform-core --skip-nx-cache` — typecheck, test and lint all passed (filtered output).

### BLOCKING

None.

### MODERATE

1. Docs absolute count is off against the registry (`settings.md:8`). The registry has 50 literal `skillSynthesis.*` keys in `FILE_BASED_SETTINGS_KEYS` (file-settings-keys.ts:154-430) plus 32 lane keys spread at :165, so 82 in total. The docs say 80 (48 named + 32). The delta (+2 for the retirement keys) is correct (HEAD had 48 literal; docs said 46), so this is an inherited 2-key undercount, not a Batch 2 regression. Undocumented in the registry: `skillsRoot`, `judgeProvider`, `enhanceTimeoutMs`, `triggers.bootScanDelayMs`, `triggers.bootScanIdleBackoffMs` (the 5 may be covered by prose, not backticks). The batch's claim that "80 / 48" is "accurate" is therefore not verified. Fix: either correct to 82 / 50, or reword to avoid a hard number.
2. Docs overclaim until Batch 7 lands (`settings.md:43-44`). "Pinned and user-authored skills are exempt" matches the plan (implementation-plan.md:736-738: `row.pinned` or registry `clone_status IN ('authored','diverged')`). "its directory deleted" matches plan :741-742 (guarded `rmSync` of `dirname(bodyPath)`). Both are accurate for the planned behaviour. But the keys currently have no runtime reader (A6) so the page documents unshipped behaviour. This is acceptable only because Batch 7 ships in the same PR; do not release the docs without it. Note the exemption is wider than "user-authored" (it includes `diverged`, i.e. user-edited clones); consider "pinned, user-authored and user-edited".

### MINOR

1. Clumsy wording `settings.md:44`: "Days of remaining dormant without use after which a skill is retired". Suggest: "Days a skill must stay dormant without use before it is retired and its directory deleted." Also the key is cumulative (retire at N+M idle days, plan :740); the dormantAfterDays row ("Days of inactivity") and this row should say retirement counts from the dormancy start, otherwise users will read M as total idle time.
2. Docs row placement: the retirement rows sit between `suggestionMaxCandidates` and `trayKeepalive` in the Core table, splitting the curator rows from the Electron-only row. Fine, but a "Retirement" sub-heading would match how Triggers/lanes are grouped (`settings.md` Triggers section). Preference only.
3. Table alignment: the whole Core table was re-padded to the new longest key (diff noise on 18 unchanged rows) — this is prettier-driven, correct, and not a defect. Retirement-row padding is consistent with the others.
4. Spec naming (`file-settings-keys.spec.ts:653`): `'skillSynthesis retirement and pool keys (TASK_2026_578)'` matches neighbouring `(TASK_2026_180, Phase 1)` describe naming. `it.each(Object.entries(...))` with `%s to %s` formatting is fine. The `suggestionMaxCandidates` test asserts only the default and Set membership; it does not pin the runtime fallback split (see write-path), which is correct for this lib.

### Structure and consistency (check 1)

- Placement: both retirement keys sit in the Set directly after `suggestionMaxCandidates` (:244-246) and in DEFAULTS directly after it (:535-537), before the TASK_2026_180 drain block. Same order in both maps; matches the registry's grouping of the curator/core block. A6 satisfied: both keys in BOTH maps (verified by grep at :245-246 and :536-537, and asserted by the spec via `FILE_BASED_SETTINGS_KEYS.has` and `isFileBasedSettingKey` and defaults).
- Naming: `skillSynthesis.retirement.dormantAfterDays` / `retireAfterDormantDays` follow the dotted sub-tree shape already used by `skillSynthesis.triggers.*` and `drain.*`; matches plan :142-143.
- Plan prescribed 30/30 defaults: matches. No TODO/stub in any of the three files.
- No stray edits: `skill-synthesis.service.ts:153` still `suggestionMaxCandidates: 200` (unmodified, no diff in `libs/backend/skill-synthesis`). Check 4 passes.

### Write-path trace for suggestionMaxCandidates 200 to 1000 (check 2)

Confirmed against code:
- `file-settings-manager.ts` resolves stored value, then caller default, then registered default (as the team-leader stated).
- Runtime: `skill-synthesis.service.ts:1366-1369` passes `SETTINGS_DEFAULTS.suggestionMaxCandidates` (`:153`, 200), so the caller default wins; `skill-clustering.service.ts:46` slices to 200 for users with no stored value until Batch 10 changes the literal.
- Panel: `skills-synthesis-rpc.handlers.ts:529-549` reads `FILE_BASED_SETTINGS_DEFAULTS[configKey]` and also passes it as the fallback, so `getSettings` shows 1000 now. Zod max is 5000 (`skills-synthesis-rpc.schema.ts:91`), so 1000 validates.
- Persistence: the panel submits the whole form, so saving any panel setting writes `suggestionMaxCandidates: 1000` as an explicit stored value. From then on the runtime reads 1000 (stored wins), so the interim split self-resolves for users who save, and the stored 1000 is also what Batch 10 would deliver. Users with an existing explicit value (e.g. 200) are unaffected. Net effect of the split: only users with no stored value, who have not saved the panel, run on 200 while the panel displays 1000.
- Side note: existing rpc tests hardcode 200 as a fixture value (`skills-synthesis-rpc.handlers.spec.ts:2972`, `skills-synthesis-rpc.schema.spec.ts:96`); they pass explicit values, so they are not coupled to the default and are unaffected.

Assessment: the split is cosmetic and low-risk. The panel is ahead of runtime by at most one PR, the larger pool only widens candidate consideration, and there is no data hazard. Acceptable inside a single PR that also ships Batch 10.

### Score and verdict

Score: 8/10. Registry edit, spec, and docs are correct, minimal, and match conventions; typecheck/test/lint green. Held from 9 by the unverified/incorrect absolute key count in the docs (inherited 2-key undercount presented as "accurate") and the retirement-row wording.

The batch is acceptable to commit as long as Batch 10 (SETTINGS_DEFAULTS 200 to 1000 at `skill-synthesis.service.ts:153`) and Batch 7 (retirement reader) land in the same PR; do not ship Batch 2 alone, since the docs describe retirement behaviour with no runtime reader and the panel/runtime defaults would stay split. Recommended (non-blocking): fix the key count at `settings.md:8` and reword `settings.md:44`.

Verdict: APPROVED


## Batch 10

Scope: `libs/backend/skill-synthesis/src/lib/diagnostics.types.ts`, `diagnostics.service.ts`, `diagnostics.service.spec.ts`, `skill-synthesis.service.ts`, `skill-synthesis.service.spec.ts`.
Context: Shared files with TASK_2026_586 (PR #620). Minimal-edit rule (risk R-e in `batches.md`).

### Summary

| Metric          | Value        |
| --------------- | ------------ |
| Overall score   | 9/10         |
| Assessment      | APPROVED     |
| Blocking issues | 0            |
| Serious issues  | 0            |
| Minor issues    | 0            |
| Files reviewed  | 5            |

### Five style questions

#### 1. What breaks in six months?

If new lifecycle states or candidate counters are introduced to `SkillCandidateStats` (`types.ts:351-365`), `SkillCandidateStatusCounts` (`diagnostics.types.ts:48-61`) and `readStats` (`diagnostics.service.ts:47-76`) will require synchronous updates. Because `SkillSynthesisDiagnosticsSnapshot['byStatus']` requires all properties declared on `SkillCandidateStatusCounts`, omitting any new field produces a TypeScript compilation failure at build time rather than a runtime gap.

#### 2. What would a new team member misread?

A new team member might observe the slight naming divergence between `SkillCandidateStats.candidates` (plural, in `types.ts:352`) and `SkillCandidateStatusCounts.candidate` (singular, in `diagnostics.types.ts:49`), mapped at `diagnostics.service.ts:51` (`candidate: s.candidates`). This asymmetry is inherited from the 586 diagnostics contract; Batch 10 maintains consistency with the established DTO and appends the 4 new lifecycle fields (`active`, `dormant`, `merged`, `retired`) with 1:1 identical names across store, diagnostics, and snapshot.

Additionally, a reader might look for defensive null-coalescing (`?? 0`) on `s.active` / `s.dormant` / etc. in `readStats()`: it was deliberately omitted because `SkillCandidateStats` types all 8 count fields as required non-nullable `number`, and the enclosing `try/catch` already provides a clean zero-fallback for database/query failure.

#### 3. What does this cost to maintain?

Negligible maintenance cost. The diff is strictly additive and surgical:
- 4 interface fields with descriptive docstrings.
- 4 direct property assignments in the try block and 4 zero literals in the catch block.
- 1 numeric default literal update (`suggestionMaxCandidates: 1000`) in `SETTINGS_DEFAULTS` and its corresponding spec expectation.

#### 4. Where is this inconsistent with the rest of the repository?

It is fully consistent. The formatting, JSDoc comment styling, Jest assertion idioms, and type-safe error boundaries directly match the patterns established in `libs/backend/skill-synthesis` and the sibling 586 PR.

#### 5. What would you have done differently?

Nothing differently. Under risk constraint R-e (minimal edits to 586-shared files), any broader refactoring or renaming (e.g. normalizing `candidate` to `candidates` in `SkillCandidateStatusCounts`) would risk downstream breaking changes across RPC consumers in `libs/shared` and `libs/backend/rpc-handlers`. The executor correctly performed only the specified minimal modifications.

### Blocking issues

None.

### Serious issues

None.

### Minor issues

None.

### File-by-file

#### `libs/backend/skill-synthesis/src/lib/diagnostics.types.ts`

Score: 10/10 — 0 blocking, 0 serious, 0 minor.
Appends `active`, `dormant`, `merged`, and `retired` to `SkillCandidateStatusCounts` (lines 53-60) with accurate JSDoc comments matching domain terminology. No other lines touched.

#### `libs/backend/skill-synthesis/src/lib/diagnostics.service.ts`

Score: 10/10 — 0 blocking, 0 serious, 0 minor.
`readStats()` maps the 4 new fields directly from `store.getStats()` without redundant fallback operators (`?? 0`), respecting the required type contract of `SkillCandidateStats`. The catch block properly returns zero for all 8 counts when the store fails.

#### `libs/backend/skill-synthesis/src/lib/diagnostics.service.spec.ts`

Score: 10/10 — 0 blocking, 0 serious, 0 minor.
`makeStore` helper now explicitly types `stats: SkillCandidateStats` (importing `SkillCandidateStats` from `./types`) and defaults all 8 fields to 0. Both snapshot success and error fallback test cases assert all 8 status counts.

#### `libs/backend/skill-synthesis/src/lib/skill-synthesis.service.ts`

Score: 10/10 — 0 blocking, 0 serious, 0 minor.
Only `SETTINGS_DEFAULTS.suggestionMaxCandidates` is changed from 200 to 1000 (line 155). `recentEvents`, `RING_CAPACITY`, and all 586 logic remain untouched.

#### `libs/backend/skill-synthesis/src/lib/skill-synthesis.service.spec.ts`

Score: 10/10 — 0 blocking, 0 serious, 0 minor.
Default settings assertion updated from 200 to 1000 (line 1022) to align with `SETTINGS_DEFAULTS`. No other tests touched.

### Pattern compliance

| Repository rule or nearby convention | Status | Evidence |
| ------------------------------------ | ------ | -------- |
| R-e minimal edits to 586-shared files | PASS   | Only named lines modified in all 5 files (`git diff`) |
| No alterations or reordering of 586 code | PASS | All 586 features (`recentEvents`, `triggers`, etc.) untouched |
| Strict type precision (no redundant `?? 0`) | PASS | `diagnostics.service.ts:55-58` maps non-nullable fields directly |
| Explicit test typing                 | PASS   | `diagnostics.service.spec.ts:68` explicitly typed as `SkillCandidateStats` |
| JSDoc style matches domain terms     | PASS   | `diagnostics.types.ts:53-60` matches `types.ts:355-362` |
| Scoped test verification             | PASS   | `diagnostics` (4/4 passed), `skill-synthesis.service` (79/79 passed) |

### Specific checks evaluation

1. **Named changes only**:
   - `SkillCandidateStatusCounts` gained `active`, `dormant`, `merged`, `retired` (appended, documented).
   - `readStats` maps them with zero fallbacks in the try block and returns zeros in the catch block.
   - `SETTINGS_DEFAULTS.suggestionMaxCandidates` changed 200 -> 1000; `recentEvents` and `RING_CAPACITY` untouched.
   - Spec pinning 200 updated to pin 1000.
2. **No 586 code altered or reordered**: Confirmed via `git diff`.
3. **Naming and doc-comment style**: Confirmed matching repository standards.
4. **Omission of per-field `?? 0`**: ACCEPTED. `SkillCandidateStats` declares all count fields as required `number`. Adding nullish coalescing would be redundant defensive coding that weakens type trust.
5. **Type precision in spec**: Confirmed `makeStore(stats: SkillCandidateStats = { ... })`.

### Maintenance debt

- Introduced: None.
- Retired: Discrepancy between runtime default (previously 200) and registry default (`FILE_BASED_SETTINGS_DEFAULTS`, 1000) resolved.
- Net: Neutral to positive (consistency restored between settings registry and runtime default).

### Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Key concern: None. The batch is a clean, minimal surgical change adhering strictly to R-e.
- What a 10/10 version would do differently: The implementation is exemplary for a constrained patch; 9/10 reflects the inherited singular/plural naming difference (`candidate` vs `candidates`) originating in 586 that cannot be altered without cross-lib breakage.

Verdict: APPROVED
