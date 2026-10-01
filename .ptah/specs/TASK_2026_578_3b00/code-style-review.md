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
