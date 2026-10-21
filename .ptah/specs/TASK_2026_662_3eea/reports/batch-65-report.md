# Batch 65 report

## Settings keys removed

Exactly **79 registered keys** were removed: **47 explicit** plus **32 lane derived**. `skillSynthesis.enabled` and `skillSynthesis.skillsRoot` remain in both the routing set and defaults.

### Explicit keys (47)

- `skillSynthesis.successesToPromote`
- `skillSynthesis.dedupCosineThreshold`
- `skillSynthesis.maxActiveSkills`
- `skillSynthesis.candidatesDir`
- `skillSynthesis.evictionDecayRate`
- `skillSynthesis.generalizationContextThreshold`
- `skillSynthesis.dedupClusterThreshold`
- `skillSynthesis.prefilterMinEdits`
- `skillSynthesis.prefilterMinToolUses`
- `skillSynthesis.judgeEnabled`
- `skillSynthesis.minJudgeScore`
- `skillSynthesis.judgeModel`
- `skillSynthesis.judgeProvider`
- `skillSynthesis.enhanceTimeoutMs`
- `skillSynthesis.maxPinnedSkills`
- `skillSynthesis.curatorEnabled`
- `skillSynthesis.curatorIntervalHours`
- `skillSynthesis.suggestionMinClusterSize`
- `skillSynthesis.suggestionMaxCandidates`
- `skillSynthesis.retirement.dormantAfterDays`
- `skillSynthesis.retirement.retireAfterDormantDays`
- `skillSynthesis.drain.cronExpr`
- `skillSynthesis.drain.nightlyCronExpr`
- `skillSynthesis.drain.weeklyCronExpr`
- `skillSynthesis.drain.maxItemsPerRun`
- `skillSynthesis.drain.nightlyMaxItemsPerRun`
- `skillSynthesis.drain.weeklyMaxItemsPerRun`
- `skillSynthesis.drain.perWorkspaceBatch`
- `skillSynthesis.drain.foregroundBackoffMs`
- `skillSynthesis.drain.pauseOnBattery`
- `skillSynthesis.drain.maxAttempts`
- `skillSynthesis.drain.staleClaimTtlMs`
- `skillSynthesis.budget.maxTokensPerDay`
- `skillSynthesis.trayKeepalive`
- `skillSynthesis.replayValidation.enabled`
- `skillSynthesis.replayValidation.minConfidence`
- `skillSynthesis.triggerEval.enabled`
- `skillSynthesis.judgePanel.enabled`
- `skillSynthesis.judgePanel.disagreementThreshold`
- `skillSynthesis.triggers.idleMs`
- `skillSynthesis.triggers.bootScan`
- `skillSynthesis.triggers.bootScanDelayMs`
- `skillSynthesis.triggers.bootScanIdleBackoffMs`
- `skillSynthesis.triggers.subagentStop.enabled`
- `skillSynthesis.triggers.postToolUse.enabled`
- `skillSynthesis.triggers.postToolUse.minEditCount`
- `skillSynthesis.triggers.maxAnalyzesPerHour`

### Lane keys (32)

- `archaeologist`: `skillSynthesis.archaeologist.provider`, `skillSynthesis.archaeologist.model`, `skillSynthesis.archaeologist.defaultTier`, `skillSynthesis.archaeologist.structuredOutput`, `skillSynthesis.archaeologist.toolUse`, `skillSynthesis.archaeologist.timeoutMs`, `skillSynthesis.archaeologist.maxInputChars`, `skillSynthesis.archaeologist.maxPasses`
- `synthesis`: `skillSynthesis.synthesis.provider`, `skillSynthesis.synthesis.model`, `skillSynthesis.synthesis.defaultTier`, `skillSynthesis.synthesis.structuredOutput`, `skillSynthesis.synthesis.toolUse`, `skillSynthesis.synthesis.timeoutMs`, `skillSynthesis.synthesis.maxInputChars`, `skillSynthesis.synthesis.maxPasses`
- `judge`: `skillSynthesis.judge.provider`, `skillSynthesis.judge.model`, `skillSynthesis.judge.defaultTier`, `skillSynthesis.judge.structuredOutput`, `skillSynthesis.judge.toolUse`, `skillSynthesis.judge.timeoutMs`, `skillSynthesis.judge.maxInputChars`, `skillSynthesis.judge.maxPasses`
- `replay`: `skillSynthesis.replay.provider`, `skillSynthesis.replay.model`, `skillSynthesis.replay.defaultTier`, `skillSynthesis.replay.structuredOutput`, `skillSynthesis.replay.toolUse`, `skillSynthesis.replay.timeoutMs`, `skillSynthesis.replay.maxInputChars`, `skillSynthesis.replay.maxPasses`

## Advanced settings

Removed six descriptors and their descriptor tests:

- `skillSynthesis.retirement.dormantAfterDays`
- `skillSynthesis.retirement.retireAfterDormantDays`
- `skillSynthesis.replayValidation.minConfidence`
- `skillSynthesis.judgePanel.disagreementThreshold`
- `skillSynthesis.triggers.bootScanDelayMs`
- `skillSynthesis.triggers.bootScanIdleBackoffMs`

Removed the 11 old scope metadata entries (eight lane provider/model entries plus `judgeModel`, `judgeProvider`, and `enhanceTimeoutMs`). The three `skills.enhancement.{provider,model,timeoutMs}` entries remain.

## Migration move and write path

Moved `SKILL_SETTINGS_MIGRATIONS` from `file-settings-manager.ts` to `file-settings-keys.ts`, exported it there, and imported it in the manager. Its four mappings and behavior are unchanged. `loadSync` flattens the raw `settings.json` object into `this.settings` and checks each old key with `hasOwnProperty`; it does **not** consult `FILE_BASED_SETTINGS_KEYS`. Therefore the three removed registered migration sources remain readable for migration, along with the already unregistered telemetry source. The manager spec retains a raw old-key fixture.

`ElectronWorkspaceProvider.getConfiguration` routes registered `ptah` keys to `PtahFileSettingsManager`; an unregistered key reads the reader-supplied default. Its general config fallback also returns that default when the key is absent. The retained readers for the removed keys are `lane-resolver.service.ts`, `skill-lane-config.ts`, and `skill-trigger-config.ts`. The old `judgeModel` default and reader fallback are both `inherit`; all 32 lane defaults agree with `SKILL_LANE_DEFAULTS`; the eight registered trigger defaults agree with `SKILL_TRIGGER_DEFAULTS`, including both 300000 ms boot scan values. `turnComplete.enabled` and `skillInvocationTelemetry.enabled` were already unregistered, so there is no removed `FILE_BASED_SETTINGS_DEFAULTS` value to compare for them.

| Key | Old default | Reader fallback |
| --- | --- | --- |
| None: no mismatches among removed keys read by the kept readers | ? | ? |

`isFileBasedSettingKey` uses exact set membership, then only `provider.*` and `app.*` / `workspace.*` prefix patterns. None matches an unscoped removed `skillSynthesis.*` key. The former lane generator and its spread into the key list/default map are gone.

## Remaining `rg` hits

Command: `rg -n --pcre2 "skillSynthesis\.(?!enabled\b|skillsRoot\b)" libs apps -g '!**/migrations/**'`

Output classified line by line ({len(rows)} hits):

| Hit | Classification | Output text |
| --- | --- | --- |
| `apps/ptah-docs/src/content/docs/reference/file-locations.md:12` | documentation of legacy settings prefix; outside edit scope | `\| `C:\Users\<you>\.ptah\settings.json` (Win) / `/Users/<you>/.ptah/settings.json` (mac) / `/home/<you>/.ptah/settings.json` (Linux) \| Global Ptah settings (incl. `memory.*`, `skillSynthesis.*`, `cron.*`, `gateway.*`) \|` |
| `apps/ptah-docs/src/content/docs/reference/changelog.md:23` | documentation of legacy settings prefix; outside edit scope | `All four Hermes tracks share `~/.ptah/ptah.db` and live under their respective `memory.*`, `skillSynthesis.*`, `cron.*`, `gateway.*` settings prefixes in `~/.ptah/settings.json`.` |
| `libs/backend/skill-synthesis/src/lib/types.ts:85` | skill-synthesis comment | `* `skillSynthesis.judgePanel.disagreementThreshold` on any criterion, a` |
| `libs/backend/skill-synthesis/src/lib/triggers/skill-trigger-config.ts:12` | kept reader or adjacent comment | `* Deliberately NOT `skillSynthesis.triggers.enabled`: it gates the boot` |
| `libs/backend/skill-synthesis/src/lib/triggers/skill-trigger-config.ts:22` | kept reader or adjacent comment | `idleMs: 'skillSynthesis.triggers.idleMs',` |
| `libs/backend/skill-synthesis/src/lib/triggers/skill-trigger-config.ts:23` | kept reader or adjacent comment | `bootScan: 'skillSynthesis.triggers.bootScan',` |
| `libs/backend/skill-synthesis/src/lib/triggers/skill-trigger-config.ts:33` | kept reader or adjacent comment | `bootScanDelayMs: 'skillSynthesis.triggers.bootScanDelayMs',` |
| `libs/backend/skill-synthesis/src/lib/triggers/skill-trigger-config.ts:39` | kept reader or adjacent comment | `bootScanIdleBackoffMs: 'skillSynthesis.triggers.bootScanIdleBackoffMs',` |
| `libs/backend/skill-synthesis/src/lib/triggers/skill-trigger-config.ts:41` | kept reader or adjacent comment | `enabled: 'skillSynthesis.triggers.subagentStop.enabled',` |
| `libs/backend/skill-synthesis/src/lib/triggers/skill-trigger-config.ts:44` | kept reader or adjacent comment | `enabled: 'skillSynthesis.triggers.turnComplete.enabled',` |
| `libs/backend/skill-synthesis/src/lib/triggers/skill-trigger-config.ts:47` | kept reader or adjacent comment | `enabled: 'skillSynthesis.triggers.postToolUse.enabled',` |
| `libs/backend/skill-synthesis/src/lib/triggers/skill-trigger-config.ts:48` | kept reader or adjacent comment | `minEditCount: 'skillSynthesis.triggers.postToolUse.minEditCount',` |
| `libs/backend/skill-synthesis/src/lib/triggers/skill-trigger-config.ts:51` | kept reader or adjacent comment | `enabled: 'skillSynthesis.triggers.skillInvocationTelemetry.enabled',` |
| `libs/backend/skill-synthesis/src/lib/triggers/skill-trigger-config.ts:53` | kept reader or adjacent comment | `maxAnalyzesPerHour: 'skillSynthesis.triggers.maxAnalyzesPerHour',` |
| `libs/backend/skill-synthesis/src/lib/triggers/skill-trigger-config.ts:83` | kept reader or adjacent comment | `subagentStop: 'skillSynthesis.triggers.subagentStop',` |
| `libs/backend/skill-synthesis/src/lib/triggers/skill-trigger-config.ts:84` | kept reader or adjacent comment | `turnComplete: 'skillSynthesis.triggers.turnComplete',` |
| `libs/backend/skill-synthesis/src/lib/triggers/skill-trigger-config.ts:85` | kept reader or adjacent comment | `postToolUse: 'skillSynthesis.triggers.postToolUse',` |
| `libs/backend/skill-synthesis/src/lib/triggers/skill-trigger-config.spec.ts:65` | kept reader spec | `it('declares both keys under the skillSynthesis.triggers namespace', () => {` |
| `libs/backend/skill-synthesis/src/lib/triggers/skill-trigger-config.spec.ts:67` | kept reader spec | `'skillSynthesis.triggers.bootScanDelayMs',` |
| `libs/backend/skill-synthesis/src/lib/triggers/skill-trigger-config.spec.ts:70` | kept reader spec | `'skillSynthesis.triggers.bootScanIdleBackoffMs',` |
| `libs/backend/skill-synthesis/src/lib/skill-md-migration-state.store.ts:8` | skill-synthesis comment | `* anywhere by `skillSynthesis.candidatesDir`. A single shared row would let a` |
| `libs/backend/skill-synthesis/src/lib/skill-judge.service.ts:53` | skill-synthesis comment | `// Shipped defaults of the retired skillSynthesis.judgeEnabled / minJudgeScore keys` |
| `libs/backend/memory-curator/src/lib/triggers/memory-trigger-config.ts:88` | memory-curator comparison comment | `* Matches `skillSynthesis.drain.foregroundBackoffMs` (also 5 min). The two` |
| `libs/backend/skill-synthesis/src/lib/lanes/skill-lane-config.ts:2` | kept reader or adjacent comment | `* The `skillSynthesis.<lane>.*` settings sub-tree.` |
| `libs/backend/skill-synthesis/src/lib/lanes/skill-lane-config.ts:47` | kept reader or adjacent comment | `/** `skillSynthesis.<lane>` — the prefix a sparse patch flattens against. */` |
| `libs/backend/skill-synthesis/src/lib/lanes/skill-lane-config.ts:49` | kept reader or adjacent comment | `archaeologist: 'skillSynthesis.archaeologist',` |
| `libs/backend/skill-synthesis/src/lib/lanes/skill-lane-config.ts:50` | kept reader or adjacent comment | `synthesis: 'skillSynthesis.synthesis',` |
| `libs/backend/skill-synthesis/src/lib/lanes/skill-lane-config.ts:51` | kept reader or adjacent comment | `judge: 'skillSynthesis.judge',` |
| `libs/backend/skill-synthesis/src/lib/lanes/skill-lane-config.ts:52` | kept reader or adjacent comment | `replay: 'skillSynthesis.replay',` |
| `libs/backend/skill-synthesis/src/lib/lanes/skill-lane-config.spec.ts:2` | kept reader spec | `* `skillSynthesis.<lane>.*` settings sub-tree specs.` |
| `libs/backend/skill-synthesis/src/lib/lanes/skill-lane-config.spec.ts:127` | kept reader spec | `it('nests every key under the proven skillSynthesis. namespace', () => {` |
| `libs/backend/skill-synthesis/src/lib/lanes/skill-lane-config.spec.ts:129` | kept reader spec | `expect(SKILL_LANE_PREFIXES[id].startsWith('skillSynthesis.')).toBe(true);` |
| `libs/backend/skill-synthesis/src/lib/lanes/provider-network-backoffs.ts:5` | skill-synthesis comment | `* Lanes may name different providers (`skillSynthesis.<lane>.provider`,` |
| `libs/backend/skill-synthesis/src/lib/lanes/lane-resolver.service.ts:107` | kept reader | `const JUDGE_MODEL_KEY = 'skillSynthesis.judgeModel';` |
| `libs/backend/memory-curator/src/lib/retention/memory-retention-config.ts:103` | memory-curator comparison comment | `/** Matches `skillSynthesis.drain.foregroundBackoffMs`' default. */` |
| `libs/shared/src/lib/types/rpc.types.ts:2744` | RPC legacy reference; other batch owns file | `* (`skillSynthesis.budget.maxTokensPerDay`) is compared against; an entry list` |
| `libs/shared/src/lib/types/rpc.types.ts:2910` | RPC legacy reference; other batch owns file | `// key as `skillSynthesis.${schemaKey}` and `updateSettings` writes back the` |
| `libs/shared/src/lib/types/rpc.types.ts:2912` | RPC legacy reference; other batch owns file | `// path `skillSynthesis.drain.cronExpr`; renaming it to `drainCronExpr` would` |
| `libs/backend/platform-core/src/file-settings-manager.spec.ts:402` | raw migration fixture assertion | `expect(saved.skillSynthesis.judgeProvider).toBe('saved-provider');` |
| `libs/backend/platform-core/src/file-settings-keys.ts:21` | migration old-key string | `['skillSynthesis.judgeProvider', 'skills.enhancement.provider'],` |
| `libs/backend/platform-core/src/file-settings-keys.ts:22` | migration old-key string | `['skillSynthesis.judgeModel', 'skills.enhancement.model'],` |
| `libs/backend/platform-core/src/file-settings-keys.ts:23` | migration old-key string | `['skillSynthesis.enhanceTimeoutMs', 'skills.enhancement.timeoutMs'],` |
| `libs/backend/platform-core/src/file-settings-keys.ts:25` | migration old-key string | `'skillSynthesis.triggers.skillInvocationTelemetry.enabled',` |

The two docs hits describe the legacy broad prefix. They and the reader specs are outside this batch's edit list. `rpc.types.ts` hits are at lines 2744, 2910, and 2912; that file belongs to another batch. No removed registration, default, advanced descriptor, or scope metadata remains in the edited files.

## Decisions

- Kept the migration old-key strings and raw migration assertion so stored values can still move after routing removal.
- Left the kept readers and their specs unchanged as instructed. Their fallback values agree with the removed registered defaults.
- Removed obsolete drain and lane tests that asserted the deleted registrations; retained a focused check for the two surviving keys.
- Did not run Nx, Jest, TypeScript, npm, build, lint, or other checks, as instructed. Validation was limited to file reads and the requested `rg` search.

## Could not do

The requested remaining-hit restriction cannot be literal for this batch: the read-only search also finds pre-existing docs, kept reader specs, and the raw migration spec assertion outside the listed files. They are classified above. Scoped checks are reserved for the orchestrator.
