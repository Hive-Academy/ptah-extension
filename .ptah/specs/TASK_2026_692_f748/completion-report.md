# Completion Report (Mode 3) - TASK_2026_692_f748

Worktree `D:\projects\ptah-extension\.claude-worktrees\idle-compaction`, branch `feat/idle-compaction`,
base `7bdc6eed4`, HEAD `2fd53158e`. Read-only check. No tests, typechecks or builds were run (QA
already ran them, `test-report.md`). Nothing was committed. Only `batches.md` status lines were edited.

Verdict: COMPLETE. All prerequisites are met. One live check (A1) stays open for the PR.

## 1. Prerequisite checklist

| # | Prerequisite (`batches.md` "Completion prerequisites") | Result | Evidence |
| --- | --- | --- | --- |
| 1 | Every batch COMPLETE with a commit SHA | PASS (after reconciliation) | `git log --oneline 7bdc6eed4..HEAD` = 24 commits: 23 batch commits plus `ec61276b1` (docs, Phase 2 acceptance). Each SHA matches its batch header (table below). |
| 2 | Phase 1 review accepting | PASS | Logic: `code-logic-review.md` § "Batch 8I re-review", Assessment APPROVED (0 Blocking, 0 Serious). Style: `code-style-review.md` Verdict APPROVED. Implementer codex, reviewer Claude. |
| 3 | Phase 2 review accepting | PASS | `code-logic-review-phase2-rereview.md:5` APPROVED; `code-style-review-phase2-rereview.md:5` APPROVED (8/10). Decisions row 13. |
| 4 | Phase 3 review accepting | PASS | `code-logic-review-phase3.md:13` APPROVED; style NEEDS_REVISION fixed in 17F, then `code-review-phase3-rereview.md:3` APPROVED (logic + style, 1 optional Minor). Decisions rows 14 and 16. |
| 5 | Live probe P1: A2/A3 PASS, A4 noted | PASS | `research-report.md:25` (A2 PASS), `:26` (A3 PASS, boundary 2 ms before `result`), `:28` (A4 PASS, informational), `:31` (Batch 10 gate satisfied). |
| 6 | Visual evidence, dark + light, before/after, marker and both settings rows | PASS | `visual-review.md:8` APPROVED; 38 PNGs in `visual/` (`before-*` from base `7bdc6eed4`, `after-*` from `2fd53158e`): `before-/after-marker-*-{dark,light}[-narrow][-chip].png`, `before-/after-settings-context-budgets-{dark,light}[-narrow].png`, `after-settings-focus-{toggle,number}-*.png`. Decisions row 15 records the user's build/run approval for this. |
| 7 | Write-path trace for both settings keys | PASS | Section 2 below. |
| 8 | Parity | N/A | No surface was replaced, consolidated, rebuilt or redesigned. The change adds two settings rows to an existing table-driven group and one marker text variant. |
| 9 | Plan-validation risks resolved | PASS | A2 failure risk: P1 PASS. Constructor params: optional last params only (`session-lifecycle-manager.ts:424`, `compaction-hook-handler.ts:164`, router optional inject); QA green. 27-key count: updated in Batch 5 (`advanced-settings.types.spec.ts`). Service spec split: Batches 7 and 8. |
| 10 | QA | PASS | `test-report.md:99`: 8 changed libs plus 3 host smoke specs green. The 2 failures (`file-settings-manager.bench.spec.ts`, `subagent-handoff-index.spec.ts`) were already there before this branch, are outside the diff, and pass when run alone. |
| 11 | QA live run A1/A5 plus in-app `sendIdleCompact` | PARTIAL, by decision | Decisions row 17: A5 is covered at unit level by the 13F `settled` specs. A1 stays OPEN (Section 4). |

### Batch / commit table

| Batch | Commit | Batch | Commit |
| --- | --- | --- | --- |
| 1 | 70478faf7 | 9 | bb9cb377b |
| 2 | a3ecaff29 | 10 | 0adfca37b |
| 3 | b9cab2be6 | 11 | eda363706 |
| 4 | 53018036f | 12 | 90dc77bf4 |
| 5 | cdb70c581 | 13 | 97338b3fa |
| 6 | 7901e5155 | 13F | a8842a8e4 (+ ec61276b1 docs) |
| 7 | c7e24c58b | 14 | c630b427d |
| 8 | daeefb6ec | 15 | 22670c58f |
| 8F | 4af674c31 | 16 | 06e6b38f7 |
| 8G | d27b9e13f | 17 | 6e7d132b3 |
| 8H | e931d243c | 17F | 2fd53158e |
| 8I | 2e8b4820b | | |

### `batches.md` reconciliation (status lines only)

- Line 3 header: `Complete: 12/21` -> `Batches: 23 incl. fix rounds 8F-8I, 13F, 17F | Complete: 23/23`.
- Tasks 10.1, 10.3 IMPLEMENTED -> COMPLETE; 10.2 IN_PROGRESS -> COMPLETE; 11.1, 11.2, 12.1, 13.1
  PENDING -> COMPLETE. No PENDING/IN_PROGRESS/IMPLEMENTED remains in the file.
- Commit SHAs added to the Batch 10-17F headers (they were missing); review paths added to 13F and 17F.
- Batch 10 verification: added an acceptance line after the attempt-1 NOT ACCEPTED note. On disk,
  defect (1) is fixed (`session-lifecycle-manager.ts:432-447` passes `this.idleCompaction` to
  `new SessionQueryExecutor(`).
- Spot checks of the 10-13 artifacts on disk: pump `beforeEnqueue` (`session-stream-pump.service.ts:206,246`);
  hook rekey target (`compaction-hook-handler.ts:164,178`); router admit/release
  (`chat-slash-command-router.service.ts:174,246`); `SDK_IDLE_COMPACTION` singleton assertions in all
  three host smoke specs (`apps/ptah-cli/...:355`, `apps/ptah-electron/...:562`,
  `apps/ptah-extension-vscode/...:283`).

## 2. Write-path trace: `compaction.idleCompactionEnabled`, `compaction.idleCompactionMinTokens`

Paths are under `libs/` unless stated.

### Declaration (one source of truth)

- Descriptors: `shared/src/lib/types/advanced-settings.types.ts:178-198`. Both are in group
  `context-budgets`. Enabled is `boolean`, default `true`. MinTokens is `number`, integer, min `100_000`,
  max `5_000_000`, default `200_000`. Both have `apply: 'live'`.
- Defaults: `backend/platform-core/src/file-settings-keys.ts:176-177` builds `ADVANCED_SETTINGS_DEFAULTS`
  from that table, and `:737` spreads it into `FILE_BASED_SETTINGS_DEFAULTS`. The default literals
  appear only once (pinned by `file-settings-keys.spec.ts:282-287`).
- Storage routing: `file-settings-keys.ts:226-228` adds both keys to `FILE_BASED_SETTINGS_KEYS`;
  `isFileBasedSettingKey` (`:795`) returns true for them.

### UI write

1. The row is rendered by `frontend/chat/src/lib/settings/ptah-ai/orchestration-settings.component.ts:204`
   (`<ptah-advanced-settings-group groupId="context-budgets" />`, Settings > Agent Orchestration >
   Context budgets; the plan text said Advanced, decisions row 16). The group filters `ADVANCED_SETTINGS` by
   group (`advanced-settings-group.component.ts:282`) and reads each key with `settings:get` (`:320`).
2. Toggle and number commits call `write()` (`advanced-settings-group.component.ts:426-433`), and
   `write()` sends `rpcCall('settings:set', { key, value })` (`:448`). The row shows the saved value
   only after the host confirms. A refused write or a timeout leaves the saved value and shows a fixed
   message (`:458-471`).

### Host `settings:set`

3. `backend/rpc-handlers/src/lib/handlers/settings-rpc.handlers.ts:167-209`. The key must pass
   `isFileBasedSettingKey` (`:172`) and must not be in `SETTINGS_SET_DENIED_KEYS` (`:178`). Then
   `validateAdvancedSettingValue` checks type and range against the descriptor (`:184-190`), so a
   non-boolean, a non-integer, or a number outside 100k..5M is refused and nothing is written. The
   checked value then goes to `workspaceProvider.setConfiguration('ptah', key, value)` (`:192`).

### Storage

4. Every host routes these keys to `PtahFileSettingsManager` (`~/.ptah/settings.json`,
   `backend/platform-core/src/file-settings-manager.ts:2,91`), using `set()` (`:122`):
   - Electron: `platform-electron/.../electron-workspace-provider.ts:216-225`
   - VS Code: `platform-vscode/.../vscode-workspace-provider.ts:100-109`. These keys never go to VS Code `settings.json`.
   - CLI: `platform-cli/.../cli-workspace-provider.ts:109-118`
5. After the write, each host fires a synthetic `onDidChangeConfiguration` with
   `affectsConfiguration` matching `ptah.<key>` (same line ranges as step 4).

### Runtime readers

6. `CompactionConfigProvider` (`backend/agent-sdk/src/lib/helpers/compaction-config-provider.ts`):
   - The constructor (`:99-121`) reads both defaults from `FILE_BASED_SETTINGS_DEFAULTS` and checks them
     once. A missing or invalid default throws at boot (Batch 8H).
   - `getIdleCompactionConfig()` (`:204-252`) reads `config.get('compaction.idleCompactionEnabled' |
     'compaction.idleCompactionMinTokens')` on every call. An unset value gives the default. An invalid
     hand-edited value gives the default and one `warnOnce`. MinTokens must be an integer of at least
     100k; no maximum is checked on read (recorded as Minor in Phase 1).
   - `config` is `TOKENS.CONFIG_MANAGER`, which sends file-based keys to the same file store. Electron:
     `apps/ptah-electron/src/di/phase-1-infra.ts:112-123` (`setFileSettingsStore(...,
     workspaceProvider.fileSettings, isFileBasedSettingKey)`). VS Code:
     `apps/ptah-extension-vscode/src/di/phase-1-infra.ts:86`. CLI: shim in
     `backend/cli-engine/src/lib/container.ts:563-607,627`. Dispatch happens in
     `backend/vscode-core/src/config/config-manager.ts:106-113`. So the reader and the writer use the
     same store and the same key, with no prefix difference (the reader omits `ptah.` and the namespace adds it).
7. Consumers in `IdleCompactionService` (built in `agent-sdk/src/lib/di/register.ts:140-165` and resolved
   from `SDK_COMPACTION_CONFIG_PROVIDER`):
   - Every reduce step: `readIdleSettings(this.config)` (`idle-compaction.service.ts:156`;
     `idle-compaction.helpers.ts:22-33`). When disabled, the reducer refuses to arm (`idle-session.reducer.ts:53-54`).
   - At fire: the fire gate reads again (`idle-compaction.service.ts:317-321`) and refuses with `disabled`
     (`idle-fire-gate.ts:30`) or below min tokens (`idle-fire-gate.ts:39`).
8. Change propagation: the service subscribes to `workspace.onDidChangeConfiguration`
   (`idle-compaction.service.ts:117-130`) for `ptah.compaction.enabled`,
   `ptah.compaction.idleCompactionEnabled` and `ptah.compaction.idleCompactionMinTokens`, and enqueues
   `settings-changed` for each live session. When settings are now disabled, the reducer clears a
   `pending` attempt (`idle-session.reducer.ts:224-230`). An in-flight attempt is not cancelled.

### Side effects and other paths

- No environment variable and no SDK option is derived from these keys. They only gate Ptah's own
  timer and send path.
- Export: both keys are in `KNOWN_CONFIG_KEYS` (`agent-sdk/src/lib/types/settings-export.types.ts:65-66`),
  read by `settings-export.service.ts:140-147`. Import does not write config keys
  (`settings-import.service.ts:111-118` skips them), so export/import adds no second write path.
- A hand edit of `~/.ptah/settings.json` from outside the process does not fire `onDidChangeConfiguration`
  (the file watcher only notifies per-key `watch()` listeners, `file-settings-manager.ts:168-200`). The
  edit still takes effect, because steps 7 and 8 read the setting at every arm and at fire. Only the
  early disarm of an already pending attempt is skipped, and the fire gate still refuses it.
- Conclusion: the runtime behaviour matches the intent (`apply: 'live'`, default on, off-switch honoured
  at arm and at fire). No unintended write was found.

## 3. Later items (not in this task; carry to `future-enhancements.md` / follow-up tasks)

From `batches.md` (Phase 1 fix round, L1-L8):

1. L1: Release the idle claim by `claimId` across both ids, or let the coordinator release it on rebind (F5).
2. L2: Make the idle notice consume-once, or clear it on a foreign `pre-compact` / `request-started` (F6).
3. L3: Treat `pre-compact` in `sending` as `precompact`, and make `fire-sent` a no-op once the phase has moved on (F7). Decisions row 12 judges it impossible in practice.
4. L4: Add a count or timeout to the manual reservation; `requestManualCompact` should check for an existing reservation (F8). This also covers the Phase 2 M3 point that the router has no independent expiry.
5. L5: Log a `rekey-collision` warning. Done in Batch 8I (Task 8I.3); kept here only for traceability and can be closed.
6. L6: Give the `IdleCompactionService` constructor one trailing `options?` object, with one way to say absent.
7. L7: Add `idle-compaction.constants.ts` and derive the min-tokens floor and default from the shared descriptor (`compaction-config-provider.ts:115` and `:228` still hard-code `100_000`).
8. L8: Add a spec for a reducer that throws on `session-released`, so a hung `sending` attempt cannot block `finalize`.

From `decisions.md` rows 12-17:

9. Row 12 / Phase 2 M1: an idle `/compact` can overtake a message the user has just typed, because `beforeEnqueue` does not re-check `activitySinceTurnEnd`. The window is rare and nothing is lost.
10. Row 12: `register.ts` is over the 700-line `max-lines` limit (939). Split it by registration domain.
11. Row 13: other `chat:continue` callers ignore `settled`: TUI `use-chat.ts` (watchdog error), CLI `interact.ts` (possible wait), `apps-session.service.ts` (turn left pending).
12. Row 13: a failed idle factory is cached for the life of the container (a transient failure disables idle compaction until restart).
13. Row 13: a disposer that throws can mask the constructor error.
14. Row 13: `IdleCompactionFacadePort` is missing from the internal idle barrel.
15. Row 13: give the inline `Pick<IdleCompactionSignals,'rekey'>` in `compaction-hook-handler.ts:164` a named alias.
16. Row 13: reword the `settled?` doc in `rpc-chat.types.ts`.
17. Row 13: the settle sequence is copied 4 times in `message-sender.service.ts`. Extract `settleTabIdle(tabId)`.
18. Rows 14 and 16: `boundaryNoticeFor` is not consume-on-read (Phase 3 logic M2).
19. Row 16: at narrow tile widths the long idle sentence wraps the marker chip to 4 lines and ellipsizes the token line.
20. Row 16: the token line contrast is below 4.5:1 (`opacity-60`). This was already there before the task.
21. Row 16: the toggle hit area is 32x20. This was already there before the task.
22. Row 17: there was no live 1-hour idle run, so the in-app `sendIdleCompact` path was not exercised live (A5 is covered at unit level only).
23. Phase 3 re-review M-1 (optional): restore `not.toContain('manual')` on the default-marker title test.

## 4. Open live check A1 (list in the PR description)

- A1, anchor skew: the idle timer anchor (`anchorAt`) is assumed to sit within 5 s of the server's
  cache-write time. Verify it in a live session by logging `anchorAt` against `firstEventAt - ttft_ms`
  on a real turn. Unit specs pin the anchor rule (AC 1.2), but nothing has checked it live
  (`test-report.md:87`, decisions row 17). If the skew is larger, the fire may land after the 1h
  cache expires; it does no harm, but it saves less.

## 5. Handoff notes

- Uncommitted task-folder files (need a docs commit before the PR): `decisions.md` (rows 16-17),
  `batches.md` (this reconciliation), and new files `code-review-phase3-rereview.md`, `test-report.md`,
  `visual-review.md`, `completion-report.md`. The 38 PNGs in `visual/` are git-ignored
  (`.gitignore:141`, `.ptah/specs/**/*.png`), so they stay local evidence; attach key ones to the PR
  if needed.
- PR: base `main`, branch `feat/idle-compaction`. Per the user's CLAUDE.md, push and open the PR in the
  same task, and list A1 and the later-items list in the body.
