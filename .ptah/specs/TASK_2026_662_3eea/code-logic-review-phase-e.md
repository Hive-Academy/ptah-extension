# Code Logic Review (Phase E, batches 62-66) - TASK_2026_662

Review family: Claude (reviewer) vs codex (implementer)

Scope: uncommitted working tree against HEAD 068678e77. Read-only; no nx/jest/tsc was run (gate belongs to the orchestrator). Evidence is file reads and `rg`/`git diff`.

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 8.5/10 |
| Assessment | APPROVED |
| Blocking | 0 |
| Serious | 0 |
| Moderate | 2 |
| Minor | 3 |

## 1. Write-path trace (batch 65)

Routing, all three hosts. `isFileBasedSettingKey` is exact-set plus provider/app/workspace prefixes (`file-settings-keys.ts`); no pattern matches an unscoped `skillSynthesis.*` key. An unregistered `ptah` key therefore takes the non-file branch:

- Electron: `electron-workspace-provider.ts:95-102` -> in-memory `this.config['ptah']` -> `defaultValue`.
- CLI: `cli-workspace-provider.ts:89-95`, same shape -> `defaultValue`.
- VS Code: `vscode-workspace-provider.ts:80-84` -> `vscode.workspace.getConfiguration('ptah').get(key, defaultValue)`. `rg skillSynthesis` over every `package.json` returns nothing, so no `contributes.configuration` declaration exists for any removed key (none for the kept ones either, they are file-routed). `get` with no contribution and no user value returns the supplied default. Only way to diverge: a user hand-wrote `"ptah.skillSynthesis.*"` into VS Code settings.json, in which case it is now honoured instead of ignored; harmless.

Readers still in code and their fallbacks against the removed `FILE_BASED_SETTINGS_DEFAULTS` values (from `git show HEAD:file-settings-keys.ts`):

| Reader | Key(s) | Removed default | Reader fallback | Match |
| --- | --- | --- | --- | --- |
| `lane-resolver.service.ts:107,285-290` | `skillSynthesis.judgeModel` | `'inherit'` | `JUDGE_MODEL_DEFAULT = 'inherit'` (:108), also empty-string guard | yes |
| `skill-lane-config.ts` `SKILL_LANE_DEFAULTS` | 4 lanes x 8 fields | identical table (provider/model `''`, haiku, sdk, timeouts 120000/90000/45000/90000, chars 12000/8000/3000/8000, passes 4/1/1/1) | same table, plus per-field validation (`readPositiveNumber`, `readEnum`) | yes |
| `skill-trigger-config.ts:56-76` `SKILL_TRIGGER_DEFAULTS` | idleMs 600000, bootScan true, subagentStop/postToolUse enabled true, minEditCount 3, maxAnalyzesPerHour 6 (+ bootScanDelayMs/IdleBackoffMs 300000) | identical | yes |
| `turnComplete.enabled`, `skillInvocationTelemetry.enabled` | already unregistered before this batch | n/a | `true` | n/a |
| `skill-enhancer.service.ts:313`, `wire-runtime.ts:655`, `skills-root.ts:7`, `skill-synthesis-state.service.ts:19`, `thoth-status.service.ts:325` | `skillSynthesis.enabled` / `skillsRoot` | kept | kept | yes |

`skillSynthesis.enabled` (true) and `skillSynthesis.skillsRoot` ('') remain in both `FILE_BASED_SETTINGS_KEYS` (`file-settings-keys.ts:183,185`) and defaults (`:381-382`), and are pinned by the new `retained skill synthesis settings` spec block.

Migrations: `SKILL_SETTINGS_MIGRATIONS` (`file-settings-keys.ts:20-26`, 4 pairs) is imported into `file-settings-manager.ts:25-28` and consumed in `loadSync` (:524-532) against the raw flattened map via `hasOwnProperty`, not against the registered key set, so unregistered old sources are still found. The migration is only-if-new-absent, so explicit new values win. The manager spec (`file-settings-manager.spec.ts:362+`) is untouched and still asserts all four sources, persistence, idempotent restart, and that `saved.skillSynthesis.judgeProvider` survives the rewrite (old keys are not stripped). Result: migrations run for users with old values.

Behavioural consequence (accepted, O44/O46): users who customised lane provider/model/timeouts, trigger toggles, or `judgeModel` silently revert to shipped defaults on every host; the values remain inert in settings.json. This is documented in O46(b), so not a defect, but see M1.

## 2. Is any removed key still written?

No live writer. `rg` over libs/apps/tools for `skillSynthesis.<removed>` in non-spec code finds only the readers above. `flattenSkillLanes` and `flattenSkillTriggers` are exported from `skill-synthesis/src/index.ts:51,95` but have zero non-spec callers, so nothing emits `settings:set` for them. The six advanced-settings descriptors and 11 scope-metadata entries are gone, so the settings UI cannot address them. The only frontend write of this namespace is `skillSynthesis.enabled` (still routed). If anyone later revived `flattenSkillLanes`, on VS Code it would call `getConfiguration('ptah').update(...)` on an uncontributed key and reject, on Electron/CLI it would write to the non-persistent in-memory config; see M1.

## 3. Dangling references

- Token/DTO sweep: I extracted all 113 removed export names (24 tokens, shared interfaces/types/consts, `SKILL_DRAIN*`) from the diff and ran a word-boundary search across libs/apps/tools (ts/tsx/js/json). Only hits are three query strings in `tools/mcp-bench/questions/7910f34cf/*.json` (benchmark question corpora, pinned to an old commit, not code). No code reference remains.
- `skillSynthesis:event` / `SKILL_SYNTHESIS_EVENT` / `SkillSynthesisEvent*` / `skill-drain.constants`: zero hits outside the deliberately renamed string in `back-office-activity.service.spec.ts:507` (now `'retired:event'`). No frontend listener, no host registry entry (baseline entry removed at `host-source-registry.baseline.ts:537`), `payload-map` entry and import removed consistently, `libs/shared/src/index.ts` export removed.
- Token usage in `register.spec.ts` now uses `Symbol.for('<name>')` literals for the negative guard, which preserves the "not registered" check.
- `SkillTriggersDto` is intentionally kept (still used by `skill-trigger-config.ts:3`).
- `SKILL_SYNTHESIS_SETTINGS` / `SkillSynthesisSettings` (settings-core) is an empty repository subclass; unaffected.

## 4. Spec deletions vs kept behaviour

`file-settings-keys.spec.ts`: kept-behaviour coverage survives. The curator trigger block now covers the `memory.triggers.*` keys (`curator trigger keys`), the SDK-hook block was reduced rather than dropped (memory hook keys retained), the new `retained skill synthesis settings` block pins `enabled`/`skillsRoot`/`skills.*` routing and defaults, and the `skill enhancement and telemetry` block (including `skills.enhancement.*`, `skills.telemetry.enabled`) is untouched. Removed blocks (drain, empirical-gate, lane, retirement, "keeps old route during migration") only asserted deleted registrations; the last one is correctly dropped per O47. Migration coverage lives in the manager spec and is intact. `advanced-settings.types.spec.ts` lost only the six removed-descriptor tests. `skill-drain.constants.spec.ts` deleted with its source (no remaining importer). I could not find any lost coverage for kept behaviour.

## 5. Lane config / data loss

- No stored data is deleted: settings.json is never rewritten to strip old keys (spec asserts retention), SQLite/migrations untouched in this phase.
- Lane config: kept readers get validated defaults identical to the old shipped table, so no lane can resolve to an invalid config. Default lane provider/model `''` = inherit active provider, same as before for default installs.
- DI: 24 removed tokens have zero live injects/registrations (sweep above); the Electron `wire-runtime.spec.ts` fake for `SKILL_SYNTHESIS_SERVICE` was dead and removed. Gate (di-lint, typecheck, test) still required from the orchestrator since I did not run it.

## Findings

### Moderate

- **M1 - Orphaned readers/writers now operate on unregistered keys.** `readSkillLane`/`readAllSkillLanes`, `flattenSkillLanes`, `flattenSkillTriggers`, `SKILL_LANE_KEYS`, `SKILL_TRIGGER_PREFIXES` (`skill-lane-config.ts`, `skill-trigger-config.ts`, `index.ts:51,95`) still treat the removed keys as configurable, and their header comments claim the keys are file-routed and guarded by a platform-core table that no longer exists. The two `flatten*` helpers have no callers and would silently misroute if reused. O46 already names removal of the now-default-only readers as a follow-up; recommend tracking it explicitly so the comments do not mislead (stale comment at `skill-lane-config.ts` header and `skill-trigger-config.ts:11-18,25-31`).
- **M2 - Silent revert of customised values.** Hand-edited or UI-set lane providers/models, judge model and trigger tunables stop taking effect with no notice or log. Accepted in O44/O46; flagging only because there is no release-note/migration message. Reader fallbacks are correct, so no breakage.

### Minor

- `file-settings-keys.spec.ts`: after removing the `it.each` the enclosing describe leaves a blank line before `});` (`~:211`); prettier will flag it (style, not logic).
- `tools/mcp-bench/.../provider-provenance.ts:132-134` still reads `skillSynthesis.<lane>.model/provider` from a bench-supplied settings record; unaffected (it is a fixture map, not the host store) but conceptually stale.
- `batch-65-report.md` contains a literal `{len(rows)}` template placeholder and a "?" table row; cosmetic documentation only.

## Five logic questions (condensed)

1. Silent failure: customised settings revert silently (M2); otherwise none found.
2. User action: toggling the Skills switch still persists (`skillSynthesis.enabled` routed); removed controls are gone from advanced settings.
3. Wrong-answer input: a stale value in settings.json for a removed key is ignored, not misread; reader validation rejects 0/negative/invalid enums to the default.
4. Dependency failure: unregistered-key read cannot throw on any host (defaults path); migration persist failure is caught and logged (`file-settings-manager.ts:535-541`).
5. Missing: no deprecation notice for dropped customisations; dead flatten helpers (M1).

## Verdict

- Recommendation: APPROVE (APPROVED), score 8.5/10, confidence HIGH on the static trace, MEDIUM-HIGH overall because no checks were run by me.
- Top risk: gate must confirm no stale import of a removed DTO/token in a spec that `rg` on names missed (name sweep found none).
- Conditions: orchestrator's combined test+typecheck+di-lint gate stays mandatory; log M1 as a follow-up.
