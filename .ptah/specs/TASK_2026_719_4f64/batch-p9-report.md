## Frontend implementation — `TASK_2026_719_4f64`, batch P9 (Presentation cleanup)

**Tasks completed**: removed the superseded exports listed in `implementation-plan-p6.md` component 1 ("cleanup batch removes ..."), together with their spec cases.

**Files**:

- MODIFIED D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/frontend/chat/src/lib/settings/providers/accounts/account-presentation.ts — removed the superseded exports and their private helpers
- MODIFIED D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/frontend/chat/src/lib/settings/providers/accounts/account-presentation.spec.ts — removed their spec cases and imports; kept the `ambientAge` case in its own `describe('ambientAge')`

### Removed exports (zero importers outside account-presentation.ts/.spec.ts)

Before removing anything, I grepped `*.ts` under the worktree `libs/` and `apps/` with account-presentation*.ts excluded. There were no matches.

| Export | Kind |
|---|---|
| `useForModel` | function |
| `UseForValue`, `UseForOption`, `UseForScopeModel` | types |
| `UNAVAILABLE_ACCOUNT_OPTION`, `UNAVAILABLE_ACCOUNT_MESSAGE` | constants |
| `assignmentChips` (and its private `CHIP` map) | function |
| `ambientRowModel`, `AmbientRowModel` | function, type |
| `SIGNED_OUT_HELP`, `UNKNOWN_HELP` | module-private constants (not exported) |

Spec cases removed: `describe('useForModel')` (6 cases), `describe('assignmentChips')` (3 cases), and the 7 `ambientRowModel` cases. The `ambientAge` banding case was in the old `ambientRowModel` block. It was kept unchanged and moved to `describe('ambientAge')`.

### Kept

- No listed export was kept because of an importer. Every one had zero outside importers.
- These helpers are kept because P6 code still uses them. They are not on the removal list:
  - `readyAmbient` and `AMBIENT_SUFFIX`, used by `accountSelectorModel`, `connectedAccountCount` and `ambientStatusModel`.
  - `AMBIENT_ROW_KEY`, used by `usedByChips` and `accounts-tab.component.ts:35`.
  - `AmbientTone`, used by `ambientStatusModel` and `ambient-account-row.component.ts:18`.
  - `PROVIDER_ACCOUNT_SCOPES`, used by `usedByChips`.
- The P2 P6 exports are unchanged.

**Verification**:

- `ptah_get_diagnostics` on both files: no diagnostics in the requested files. It also reported errors in other spec files of the chat project. Those files are not part of this batch, and none of the errors are in account-presentation files.
- `node D:/projects/ptah-extension/scripts/verify.mjs -t test -p @ptah-extension/chat -- --output-style=static -- --testPathPatterns=account-presentation`: `Test Suites: 1 passed, 1 total`; `Tests: 63 passed, 63 total`.

**Plan deviations**: none.

**Out-of-scope observations**: `ptah_get_diagnostics` reported errors in other chat spec files, for example `agent-card-truncation.spec.ts` and `chat-transcript.ptah-ui.spec.ts`. They are outside this batch's files and were left as they are.
