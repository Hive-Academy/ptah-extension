# Batch A report

## Files changed

- `libs/shared/src/lib/types/session-budget.types.ts` — close-source state/config/default.
- `libs/shared/src/lib/types/session-budget.types.spec.ts` — state fixture.
- `libs/backend/agent-sdk/src/lib/helpers/session-budget/session-budget-config.provider.ts` — validated close setting and dev budget limit.
- `libs/backend/agent-sdk/src/lib/helpers/session-budget/session-budget-config.provider.spec.ts` — close setting validation.
- `libs/backend/agent-sdk/src/lib/helpers/session-budget/session-budget.service.ts` — publish close field in measured and disabled states.
- `libs/backend/agent-sdk/src/lib/helpers/session-budget/session-budget.service.spec.ts` — state publication test.
- `libs/backend/agent-sdk/src/lib/helpers/session-budget/session-budget-stage.spec.ts` — state fixtures.
- `libs/backend/agent-sdk/src/lib/helpers/compaction-config-provider.ts` — dev idle minimum.
- `libs/backend/agent-sdk/src/lib/helpers/compaction/idle/idle-compaction.types.ts` — optional injected TTL.
- `libs/backend/agent-sdk/src/lib/helpers/compaction/idle/idle-session.reducer.ts` — injected TTL in arm and expiry times.
- `libs/backend/agent-sdk/src/lib/helpers/compaction/idle/idle-compaction.service.ts` — injected TTL and structured arm/release/fire/skip logs.
- `libs/backend/agent-sdk/src/lib/helpers/compaction/idle/idle-compaction.service.spec.ts` — background, release and late-reading fake-clock cases.
- `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.ts` — structured query-ownership release reason log.
- `libs/backend/agent-sdk/src/lib/di/dev-overrides.ts` — bounded, dev-gated env parsing and one warning.
- `libs/backend/agent-sdk/src/lib/di/dev-overrides.spec.ts` — dev/production/bounds tests.
- `libs/backend/agent-sdk/src/lib/di/register.ts` — inject overrides into SDK services.
- `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.spec.ts` — state fixture.
- `libs/backend/platform-core/src/file-settings-keys.spec.ts` — explicit default-key guard. `file-settings-keys.ts` derives the new key and default from the shared settings table automatically.
- `libs/backend/cli-agent-runtime/src/lib/wiring/sdk-callbacks.spec.ts` — state fixture.
- `apps/ptah-electron/src/di/phase-2-libraries.ts` — enable overrides only for unpackaged Electron with NODE_ENV=development.
- `.ptah/specs/TASK_2026_863_cfae/batch-a-report.md` — this report.

## Tests added

- Dev override parsing: production ignores, development applies, invalid values are rejected.
- Idle service fake clock: background bound session fires; release cancels; late reading does not arm.
- Close setting: invalid value falls back to false; measured and disabled states publish the value.

## Verification

- Mandatory `npm run verify -- -p agent-sdk,shared,platform-core,ptah-electron,cli-agent-runtime`: exit 1. Nx daemon socket was denied (`EPERM`), then Nx plugin child-process spawns were denied (`spawn EPERM`). No project verification target ran.
- Direct Jest, three agent-sdk suites: 136 tests passed. A later session-budget service suite: 46 tests passed. PowerShell returned exit 1 because Node emitted a Jest config ESM warning; Jest itself reported all suites passed.
- Direct TypeScript `tsc --noEmit`: agent-sdk spec, cli-agent-runtime spec, platform-core spec, and Electron app all exited 0.
- `ptah_get_diagnostics` after edits: zero errors and warnings, clean coverage for scoped agent-sdk files.

## Decisions

- Kept real one-hour cache classification and cache projection unchanged; the dev TTL only changes idle fire/expiry scheduling. Reversible.
- Treated stream teardown as query death. `session-released` cancels the timer, which prevents a send into a dead query. A background session with a still-live query remains armed. Evidence: query tap releases at stream finalization; the idle reducer closes on release; `sendMessage` can enqueue only to a live record. Reversible.
- Used the host's `!app.isPackaged && NODE_ENV === 'development'` pattern for env override permission. Packaged Electron ignores env values. Reversible.
- `file-settings-keys.ts` constructs budget defaults from `SESSION_BUDGET_SETTINGS`, so the new key is available without a duplicate manual entry. Reversible.

## Not done / limitations

- No query-resume path was added after stream death. If an SDK stream ends while a tab still appears open, the idle timer is cancelled, and the session cannot receive `/compact` through its dead query. That scenario needs a resumable query contract and a follow-up lifecycle change; the current sender only queues into the live record.
- Dev overrides are wired for Electron development composition. Other hosts call `registerSdkServices` without the devHost option and ignore these variables.
- Frontend fixtures were not edited, per Batch B ownership. The frontend lane needs to add `closeSourceAfterAutoHandoff` to `SessionBudgetState` literals in `libs/frontend/chat-state`, `libs/frontend/chat-ui`, and `libs/frontend/chat` specs (search `autoHandoff:`).
