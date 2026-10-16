# Batch 28 (B10a) report

## Files created

- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\tools\outcome-report.tool.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\tools\outcome-report.tool.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\.ptah\specs\TASK_2026_646_136a\reports\batch-28-report.md`

## Requirements and assumption evidence

- VLT resolves to `libs/backend/vscode-lm-tools/src/lib/code-execution` (`batches.md:19`). The requested `mcp-core/tools` directory is under that path.
- The module imports the sole `OutcomeReportArgsSchema` and validates incoming arguments (`outcome-report.tool.ts:5,70`); it creates a fresh UUID per call (`:144`). It does not register the tool.
- Deliverable paths are checked against the workspace boundary, passed to the Batch 23 `checkLaneDeliverable` helper and converted to stat facts (`outcome-report.tool.ts:99-127`). The checked payload passes `DeliverablesPayloadSchema` (`:130-137`). No path or verdict is sent in the report payload; lane-outcomes computes the verdict when applying it (`lane-outcomes/src/lib/write/report-effect.ts:57-73`). The Zod args limit is 20 (`lane-outcomes/src/lib/lane-outcome.schema.ts:20`).
- `agentId` resolves an exact subagent row first, then the latest lane row, otherwise `subagent:<agentId>` for a report hold (`outcome-report.tool.ts:76-95`). Ambiguous existing rows are refused. `runId` is exact (`:74-75`).
- Pipeline results return `applied`, `held` or `queued` (`outcome-report.tool.ts:147-160`). Unregistered dependencies and failed writes return a nonfatal unavailable result, with thrown writes logged (`:71-72,161-169`).
- Module boundary: `vscode-lm-tools`, `cli-agent-runtime`, and `lane-outcomes` all have `scope:extension` and `type:feature` (`project.json:6` in each). `eslint.config.mjs:285-294` allows extension-to-extension imports. The public aliases exist (`tsconfig.base.json:64,159`). `vscode-lm-tools` already imports `cli-agent-runtime`; `cli-agent-runtime` imports `lane-outcomes` (`cli-agent-runtime/src/lib/di/register.ts:24`); `lane-outcomes` imports neither consumer. Thus both direct imports are allowed and acyclic. No package.json or registration was edited.
- No new injected token was introduced; the module takes dependencies as arguments (`outcome-report.tool.ts:17-23`). IA-4 developer capture was not added because correctness uses Ptah run tags and agent IDs (`implementation-plan.md:280-317`).

## Fixtures

- Concurrent and repeated same-slug A/B/C runs, by both run tag and `agentId`, with separate deliverable and review outcomes: `outcome-report.tool.spec.ts:108-176`.
- Report-before-stop on both target forms, held review, join, receipts and empty hold table: `outcome-report.tool.spec.ts:178-214`.
- R3-1: real `OutcomeWritePipeline` over a fake closed connection and in-memory store, journal starting with L1; L9 review errors by name and leaves the journal unchanged; after opening, L9 has no row, receipt or hold; a `subagent:` deliverables report in that state is held. Also checks `queued` for pending L1: `outcome-report.tool.spec.ts:216-254`.
- Workspace escape rejection and no path in the journal: `outcome-report.tool.spec.ts:256-277`.

## Allowed checks

- `npx eslint <two created TypeScript files>`: passed, empty output.
- `npx prettier --check <two created TypeScript files>`: reported formatting issues in both. Applied `npx prettier --write` to both; final write output: spec unchanged on its second format pass. The check was not rerun because the brief allows one check invocation.
- Degradation audit tail: `degradation-audit: TOTAL 296 unsuppressed site(s)`; no FAIL line.
- DI lint tail: `di-lint OK: 1843 @inject sites all resolve to a registered token (814 tokens); every container-constructed class names all required and non-equivalent defaulted dependencies`.
- Nx, Jest and typecheck were not run under decision #53; the team leader owns them.
