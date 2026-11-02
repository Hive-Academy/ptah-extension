# Batch 17 report — TASK_2026_857_f660

## Tasks and evidence

- Task 17.1 complete. Added `agentOrchestration.hostRouting` to `FILE_BASED_SETTINGS_KEYS` and set its stored default to `true` (`file-settings-keys.ts:134,357`). The existing `isFileBasedSettingKey` path therefore routes settings reads and writes to file storage.
- Added the key to `KNOWN_CONFIG_KEYS` for settings export/import (`settings-export.types.ts:92`).
- Re-exported the B16 `NextTurnReminderQueue` class from the agent SDK public barrel (`index.ts:276`); its implementation exists at `src/lib/helpers/next-turn-reminder.queue.ts`.
- Added a focused spec asserting file routing, the default, and persistence of `false` across reopening `PtahFileSettingsManager` (`file-settings-keys.spec.ts:429-456`). The library verification below passed this spec.
- Scoped `ptah_get_diagnostics` on all four changed TypeScript files: 0 errors, 0 warnings.

## Files written

- `D:\projects\ptah-extension\.claude-worktrees\lane-learning-routing\libs\backend\platform-core\src\file-settings-keys.ts`
- `D:\projects\ptah-extension\.claude-worktrees\lane-learning-routing\libs\backend\platform-core\src\file-settings-keys.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\lane-learning-routing\libs\backend\agent-sdk\src\lib\types\settings-export.types.ts`
- `D:\projects\ptah-extension\.claude-worktrees\lane-learning-routing\libs\backend\agent-sdk\src\index.ts`
- `D:\projects\ptah-extension\.claude-worktrees\lane-learning-routing\.ptah\specs\TASK_2026_857_f660\batch-17-report.md`

All four source files were checked as UTF-8 without BOM. No other file was edited by this lane.

## Risks handled

- R1: Concurrent work may cause foreign failures. Both scoped checks passed; no failure required an out-of-scope edit.
- R2: Included `ptah-tui` in the four-host typecheck; all four succeeded.
- R7: Confirmed B16's queue class exists before adding its barrel export. This batch touched only its assigned agent SDK barrel.
- Plan F7: Added no cross-lib import or Nx edge. The queue export points to a file within agent SDK.
- The stored default is `true`; effective enablement with a configured decision model belongs to `HostRoutingSetting` in Component 13. The visible toggle belongs to B20.

## Verification

`npm run verify -- -p @ptah-extension/platform-core,@ptah-extension/agent-sdk 2>&1 | Select-Object -Last 40`

```text
> @ptah-extension/source@0.0.0 verify
> node scripts/verify.mjs -p @ptah-extension/platform-core,@ptah-extension/agent-sdk
[verify 2026-10-30T18:46:20.165Z] lock slot 1 acquired after 8s: verify lint,test,typecheck (@ptah-extension/platform-core,@ptah-extension/agent-sdk)
NX   6 tasks: 6 succeeded
Run duration:      2m 43s
Cache:             0/6 hit (0%)
[verify 2026-10-30T18:49:10.200Z] lock released after 170.0s, exit code 0
```

`npm run verify -- -t typecheck -p ptah-electron,ptah-extension-vscode,ptah-cli,ptah-tui 2>&1 | Select-Object -Last 40`

```text
> @ptah-extension/source@0.0.0 verify
> node scripts/verify.mjs -t typecheck -p ptah-electron,ptah-extension-vscode,ptah-cli,ptah-tui
[verify 2026-10-30T18:50:08.299Z] lock slot 1 acquired after 48s: verify typecheck (ptah-electron,ptah-extension-vscode,ptah-cli,ptah-tui)
NX   4 tasks: 4 succeeded
Run duration:      2m 28s
Cache:             0/4 hit (0%)
[verify 2026-10-30T18:52:43.423Z] lock released after 155.1s, exit code 0
```

Both tails also contained expected FIFO lock wait messages. No diagnostics or task failures appeared.

## Decisions

- **Use a dedicated file setting and the existing settings export allowlist.** Options were an `ADVANCED_SETTINGS` row or a dedicated setting. Component 17 and D-6 explicitly choose the file key and reserve the dedicated UI for B20. Reversible by changing the setting/UI contract in a later batch.
- **Test storage through `PtahFileSettingsManager` here.** Options were membership-only assertions or a persisted round trip. The spec already uses that manager for other settings, and Req 4 requires persistence. Reversible test-only choice.

## Issues outside scope

- None observed. No host or library verification failure occurred.
- No skill invocation mechanism was available in this lane's tool list; no skill was loaded. The repository guidance and task documents supplied the implementation rules.
