# Batch 2 Deliverable: File-based Settings Keys and Docs (TASK_2026_578_3b00)

## Summary of Accomplishments

Batch 2 tasks have been implemented and verified:
1. **Task 2.1: Register retirement keys and raise the pool default**
   - Registered `skillSynthesis.retirement.dormantAfterDays` and `skillSynthesis.retirement.retireAfterDormantDays` in `FILE_BASED_SETTINGS_KEYS`.
   - Declared default values of `30` for both retirement keys in `FILE_BASED_SETTINGS_DEFAULTS`.
   - Raised the `skillSynthesis.suggestionMaxCandidates` default from `200` to `1000` in `FILE_BASED_SETTINGS_DEFAULTS`.
   - Verified that `SS/skill-synthesis.service.ts:153` was NOT touched (reserved for Batch 10 post-586 rebase).
   - Added unit test coverage in `file-settings-keys.spec.ts` asserting registration, routing via `isFileBasedSettingKey`, and default values for the retirement keys and `suggestionMaxCandidates`.

2. **Task 2.2: Settings docs table**
   - Updated `suggestionMaxCandidates` default in `apps/ptah-docs/src/content/docs/skill-synthesis/settings.md` from `200` to `1000`.
   - Added two rows for `skillSynthesis.retirement.dormantAfterDays` and `skillSynthesis.retirement.retireAfterDormantDays` (default `30`, explaining dormant after N days of inactivity and retired M days after dormancy, noting pinned and user-authored skills are exempt).
   - Updated the total key count in the introductory text from 78 (46 named keys) to 80 (48 named keys).
   - Ensured table formatting and file formatting comply with Prettier (`npx prettier --check` passed cleanly).

---

## Files Modified

- `D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/backend/platform-core/src/file-settings-keys.ts`
- `D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/libs/backend/platform-core/src/file-settings-keys.spec.ts`
- `D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/apps/ptah-docs/src/content/docs/skill-synthesis/settings.md`

Deliverable output file:
- `D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/.ptah/specs/TASK_2026_578_3b00/agent-output-d227b40d-4d13-4cbe-a703-4e4eb2101ff8.md`

---

## Risk and Assumption Handling

- **Assumption A6**: `skillSynthesis.retirement.*` keys are only readable as file-based settings once registered in `FILE_BASED_SETTINGS_KEYS`.
  - *Handled*: Registered both keys in `FILE_BASED_SETTINGS_KEYS` and `FILE_BASED_SETTINGS_DEFAULTS` in `libs/backend/platform-core/src/file-settings-keys.ts` so they are fully available before Batch 7 reads them.
- **586 Isolation / Conflict Prevention**:
  - `SS/skill-synthesis.service.ts:153` was not touched, preserving independence until Batch 10 (post-586 rebase).
- **No-touch policy**:
  - Uncommitted Batch 1 files (`libs/backend/persistence-sqlite/src/lib/migrations/*`) were untouched.
  - `libs/shared`, `libs/backend/agent-sdk`, `libs/backend/cli-agent-runtime`, `libs/frontend/chat-state`, `libs/frontend/chat`, and `batches.md` were untouched.

---

## Verification Evidence

1. **Platform Core Targets (lint, typecheck, test)**:
   Command: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/platform-core`
   Result:
   - `nx run @ptah-extension/platform-core:lint` - Passed
   - `nx run @ptah-extension/platform-core:typecheck` - Passed
   - `nx run @ptah-extension/platform-core:test` - Passed (233/233 tests passed in `file-settings-keys.spec.ts`)

2. **Docs Project Lint Target**:
   Command: `npx nx run ptah-docs:eslint:lint`
   Result:
   - `nx run ptah-docs:eslint:lint` - Passed

3. **Prettier Check**:
   Command: `npx prettier --check libs/backend/platform-core/src/file-settings-keys.ts libs/backend/platform-core/src/file-settings-keys.spec.ts apps/ptah-docs/src/content/docs/skill-synthesis/settings.md`
   Result:
   - `Checking formatting...`
   - `All matched files use Prettier code style!`
