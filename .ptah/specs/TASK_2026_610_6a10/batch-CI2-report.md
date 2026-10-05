# Batch CI2 report

## Change

- `apps/ptah-electron/src/config/eager-closure-gate.spec.ts` — removed the artifact-dependent `describeIfBuiltOrFail` production-build block. Removed only its unused `readFileSync`, `describeIfBuiltOrFail`, and `STATS_PATH` dependencies, plus the stale `require` lint suppression. The five unit tests in `describe('eager-closure bundle gate', ...)` are unchanged.

The real production-artifact gate remains enforced by the later CI `gate:eager-closure` step; no changes were made to `build-artifact-gate.ts`, `project.json`, or `ci.yml`.

## Verification

- Temporarily moved `dist/apps/ptah-extension-webview/stats.json` aside when present, ran `npx nx test ptah-electron --testFile=eager-closure-gate.spec.ts --skip-nx-cache`, and restored it in a PowerShell `finally` block. Exit 0: 1 suite, 5 tests passed; cache skipped.
- `npx nx lint ptah-electron` — exit 0. It reported 16 pre-existing warnings and no errors; the changed spec is no longer among the warnings.
- `npx prettier --write apps/ptah-electron/src/config/eager-closure-gate.spec.ts` — unchanged.
- `npx prettier --list-different apps/ptah-electron/src/config/eager-closure-gate.spec.ts` — exit 0 with no output.
- `git diff --check` — exit 0.
