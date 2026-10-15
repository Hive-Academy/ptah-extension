# Batch 14 report

## Task 14.1 — wizard submit freshness gate

- `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-rpc.handlers.ts:269`: after authorizing the caller path, resolve freshness and storage, authorize the workspace-relative status directory, and compare canonical paths. A failed freshness lookup degrades to stale/unreadable with an audit marker and a Logger warning.
- `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-rpc.handlers.ts:327`: pass analysis data and directory only for the matching fresh run. Report stale, missing, or mismatched state through Logger. Preserve checkpoint location, selection, overrides, resume, and retry.
- `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-rpc.handlers.spec.ts:773`: added fresh analysis, selected IDs, and overrides case.
- `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-rpc.handlers.spec.ts:797`: added stale and missing cases, proving generation succeeds, both analysis inputs are omitted, and checkpoint location remains.
- `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-rpc.handlers.spec.ts:828`: added fresh but mismatched directory case. Existing unauthorized-path case at :745, resume case at :1273, and retry case at :1621 passed.

## Task 14.2 — gathered workspace context

- `libs/backend/agent-generation/src/lib/services/orchestrator.service.ts:307,380,937` already selects the richer precomputed path or calls `analyzeWorkspace`, then passes the resulting context to content generation. No production edit was needed in this file after the RPC gate strips stale inputs.
- `libs/backend/agent-generation/src/lib/services/orchestrator.service.spec.ts:556`: added missing/stale fallback prompt-input cases asserting project type, framework, and detected language reach `generateContent`, with no stale phase data or directory. Existing fresh analysis test at :352 passed.

## Verification

- `npx prettier --check libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-rpc.handlers.ts libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-rpc.handlers.spec.ts libs/backend/agent-generation/src/lib/services/orchestrator.service.spec.ts` — PASS: `All matched files use Prettier code style!`
- `npx nx run-many -t typecheck,lint -p @ptah-extension/rpc-handlers @ptah-extension/agent-generation --parallel=1` — PASS: `Successfully ran targets typecheck, lint for 2 projects` (four targets).
- `npx nx run-many -t test -p @ptah-extension/rpc-handlers @ptah-extension/agent-generation --parallel=1 --maxWorkers=2` — PASS: `Successfully ran target test for 2 projects` (agent-generation result came from Nx cache; rpc-handlers ran). Initial test runs failed on a missing local fixture token and then Windows path handling in that fixture; both were fixed before the passing run.

## Decisions

| Decision                                                         | Options                                            | Evidence                                                                                                    | Reversible |
| ---------------------------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------- |
| Keep checkpoint directory while omitting stale generation inputs | Move checkpoint or keep it                         | Resume and retry require the persisted location; handler build options at :932 gates only generation inputs | Yes        |
| Use the latest fresh directory when the caller supplies none     | Require a caller directory or use freshness status | `AnalysisStatus.analysisDir` is workspace-relative; storage authorization resolves it before use            | Yes        |
| Log fallback status                                              | Extend RPC response or log                         | `WizardSubmitSelectionResponse` has no status field; plan permits logging                                   | Yes        |
| Reuse existing orchestrator discovery branch                     | Add another discovery path or test existing branch | `orchestrator.service.ts:380` calls `analyzeWorkspace`; :937 passes context to content generation           | Yes        |

## Not done

No changes outside the scoped source/spec files and this report. No outstanding clarification.
