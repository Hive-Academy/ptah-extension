# Code Logic Review (Phase B fix round, re-review) - TASK_2026_662

Reviewer: Claude (Sonnet 5.5). Implementers were codex CLI lanes, so this is a cross-family review.
Scope: uncommitted diff against HEAD 829600e7f, fixes only. No checks run (orchestrator ran them).

## Per-defect result

| Defect | Result | Evidence |
| --- | --- | --- |
| Visual S1: `events` injection | FIXED | `skill-scorecard.service.ts:46` has `@inject(SkillInvocationEventStore)`. The class is registered at `skill-synthesis/src/lib/di/register.ts:79` as a singleton, so esbuild-bundle resolution works. The new spec (`skill-scorecard.service.spec.ts` top) builds a child container, registers the store instance and resolves the service through tsyringe, so it needs the decorator to pass. Without the decorator the param type metadata is absent in a bundle and the spec's resolve would fail or inject undefined. |
| M2: `toCloneSummary` guard | FIXED | `skills-synthesis-rpc.handlers.ts:2380-2389` wraps `getInvocationStats` in try/catch, logs warn with `kind`, `slug`, `error`. On failure `stats` is undefined, so `invocationCount` is 0 (line ~2410) and `successRate` is null: one card degrades, the list survives. |
| S1 (O17): telemetry key | FIXED | `skill-trigger.service.ts:1097-1103` reads `('ptah', 'skills.telemetry.enabled')` first and returns it only when `typeof === 'boolean'`, otherwise it falls through to the old `skillSynthesis.triggers...enabled` read. The key is in the ptah section list (`file-settings-manager.ts:54`, `file-settings-keys.ts:299`) and the Library writer uses the same key (`skill-synthesis-state.service.ts:63,534`). The new spec asserts an explicit `false` on the new key overrides `true` on the old key and blocks `recordSkillEvent`. |
| S2: enhancement save | FIXED | Mirror: `SaveCloneBodyResult.currentContentHash` added (`user-layer-mirror.service.ts:~203`). Early returns `clone-missing` and `stale-source` return null (lines ~706, ~719, ~803). Both refresh paths return the hash from success, from the no-sidecar branch and from the catch branch, with `currentContentHash` declared outside the try so a post-hash sidecar failure still carries it. A hash failure leaves null. Handler (`handlers.ts:1497-1534`): runs only for `origin === 'enhancement'`, after the O14 stale refusal (1478) and the written check (1485), both unchanged. Null hash skips `markEnhanced` and sets metadataIncomplete with a warn. Otherwise `markEnhanced(..., result.currentContentHash)`. Re-propagation uses `{ userInitiated: true }` and a failure sets metadataIncomplete without failing the save. The flag is merged into both the log and the result. Manual saves (no origin) take no new branch. The frontend passes `'enhancement'` from the preview-apply path (`skill-clones-view.component.ts:825`), the service forwards it only when set, and the schema/types accept it. |
| S4: invocationStats | FIXED | Handler (`handlers.ts:1818-1836`): `total` = `invocationCount` (telemetry), plus `graded`, `passed`, `successRate`, `succeeded`/`failed`. `kind` is optional with `.default('skill')` in the schema. Shared types were updated (`rpc-skill-clone.types.ts`). The frontend service defaults kind to `'skill'` and sends it. The e2e support type (`skill-telemetry-db.ts:36`) only reads `total`, and the spec polls `total > 0`, so it matches the telemetry count (the extra fields are tolerated). |
| S3: scoped keys | FIXED | `rpc-auth.types.ts` adds `skills.enhancement.provider`, `.model`, `.timeoutMs`, all `global`, `appScopable: false`. The old entries remain (additive diff only). |
| 24a: Thoth wrapper | FIXED | `thoth-shell.component.ts:222` drops `mx-auto` and `max-w-5xl`. A new spec assertion checks no `max-w-` class on the panel wrapper. |
| O21 spec updates | FIXED, intent preserved | The original test intent (tile reloads on tab switch and workspace switch, no reload on a same-tab click) is kept. Reads are counted through `telemetryReads()`: 1 at first load, 2 after a tab switch, 3 after a workspace switch, 1 after a same-tab click. Value transitions On to Off to On show the reloaded value, not just a call count. The old workspace-scope assertions (the `scope: 'workspace'` params and the row-count checks) were replaced, not merely loosened. They no longer apply because the tile now shows telemetry, and the new assertions pin the exact key and the `settings:get` method. The backend root is still switched before the webview root. |

## New findings

Blocking: none. Serious: none.

Moderate:
- `handlers.ts:1818-1829`: `succeeded` and `failed` now describe graded runs while `total` is telemetry. `total` is not equal to `succeeded + failed`. Fine for the current consumers, but a trap for new ones. Prefer to drop or alias them to the `graded`/`passed` names later.
- `handlers.ts:1516`: if `this.repropagation` is null (the optional injection is unbound on a host), enhancement re-propagation is skipped silently, with no log and no `metadataIncomplete`. The no-op port is registered on the desktop host (`register.ts:247`), so this is only reachable on hosts without that registration.
- `skill-scorecard.service.ts:62`: `events.getUsageStats(slug)` is keyed by slug only, so `kind` does not scope the telemetry count. A skill and a command with the same slug share a count. Pre-existing, but the new optional `kind` param implies per-kind scoping.

Minor:
- `handlers.ts:2414`: `historyCount` swallows its error silently (pre-existing, not part of this round).
- No test file in this round covers the "mirror `saveCloneBody` fills the hash on every return path" claim beyond the one spec delta in `user-layer-mirror.service.spec.ts` (12 lines). I read the paths by hand and they are correct.

## Score and verdict

Score: 8.5/10. All targeted defects are fixed with evidence, there are no regressions, and the residual items are moderate. Not 9+ because of the telemetry/graded semantics mix in `invocationStats` and the silent re-propagation skip.

Verdict: APPROVED
