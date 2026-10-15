# Batch 11 freshness fix report

## Change

`AnalysisFreshnessService.getStatus` now skips schema-rejected manifests and manifests with unparseable `analyzedAt` while selecting the latest valid run. It reports `stale`/`unreadable` for a rejected manifest only when no valid run exists. A non-ENOENT manifest read failure still reports `stale`/`unreadable`; the filesystem read before `readManifest` exposes failures that the storage reader otherwise converts to `null`. All checks remain read-only.

## Tests added or changed

- Added `skips rejected v2 and malformed manifests beside a newer fresh v4 run` (also covers an unparseable `analyzedAt`).
- Added `skips a rejected v2 manifest newer than a fresh v4 run`.
- Changed `reports malformed manifests and filesystem read errors as unreadable` into `reports a rejected v2 manifest with no valid run as unreadable` and `reports filesystem read errors as unreadable`.
- Added `reports manifest read errors as unreadable`.

## Absolute paths written

- `D:\projects\ptah-extension\.claude-worktrees\task-647-setup-hub-chat-sessions\libs\backend\agent-generation\src\lib\services\analysis-freshness.service.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-647-setup-hub-chat-sessions\libs\backend\agent-generation\src\lib\services\analysis-freshness.service.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-647-setup-hub-chat-sessions\.ptah\specs\TASK_2026_652_7284\batch-11-fix-report.md`

## Verification (final files, in requested order)

All commands exited 0. Relevant tails:

```text
npx prettier --write libs/backend/agent-generation/src/lib/services/analysis-freshness.service.ts libs/backend/agent-generation/src/lib/services/analysis-freshness.service.spec.ts
analysis-freshness.service.ts 94ms (unchanged)
analysis-freshness.service.spec.ts 41ms (unchanged)

npx prettier --check libs/backend/agent-generation/src/lib/services/analysis-freshness.service.ts libs/backend/agent-generation/src/lib/services/analysis-freshness.service.spec.ts
Checking formatting...
All matched files use Prettier code style!

npx nx run-many -t typecheck,lint -p @ptah-extension/agent-generation --parallel=1
√ nx run @ptah-extension/agent-generation:typecheck
√ nx run @ptah-extension/agent-generation:lint
NX Successfully ran targets typecheck, lint for project @ptah-extension/agent-generation

npx nx run-many -t test -p @ptah-extension/agent-generation --parallel=1 --maxWorkers=2
√ nx run @ptah-extension/agent-generation:test --maxWorkers=2
NX Successfully ran target test for project @ptah-extension/agent-generation

npx nx run di-lint:lint
di-lint OK: 1825 @inject sites all resolve to a registered token (793 tokens); every container-constructed class names all required and non-equivalent defaulted dependencies
NX Successfully ran target lint for project di-lint
```

Nx Cloud also printed a disabled-organization warning (401) after each Nx command; it did not change the successful local target results or exit codes.
