# Batch v2 A: plan-limit owner roster

## Changes

- `libs/backend/cli-agent-runtime/src/lib/cli-agents/limits/plan-limit-owner-discovery.service.ts:209-242`: Detection has a separate bounded 12-second budget. The `cli-store` 3-second and `lane` 12-second read deadlines begin after detection settles. Independent selected-provider, session, Ptah CLI, and ledger sources still start immediately and retain source precedence.
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/limits/plan-limit-owner-discovery.service.ts:386`: Installed Grok uses the existing CLI-store owner resolver without an additional login-file check. The Grok reader remains responsible for unsupported API-key usage status.
- Existing owner-key map at `plan-limit-owner-discovery.service.ts:198-205` retains first-source deduplication. Existing `planOwnerRead` at `:565-571` still excludes providers without a reader, including Copilot, Cursor, and pi.

For the dashboard's `provider:getPlanLimits` request without `sessionIds` or `ownerKeys`, installed Codex comes from the lane source; installed OpenCode (including Go when its key is selected by `ownerForOpenCode`), Antigravity, and Grok come from CLI stores; enabled Ollama Cloud agents come from the Ptah CLI source. The selected Claude API-key owner remains present with `unsupported-auth` status. No RPC or DI registration changed; `apps/ptah-extension-vscode/src/di/expected-absent.ts` still excludes `agent:getLanePlanLimits` while the dashboard uses `provider:getPlanLimits`.

## Specs and verification

- `libs/backend/cli-agent-runtime/src/lib/cli-agents/limits/plan-limit-owner-discovery.service.spec.ts:167`: Installed Grok appears without a local login file.
- `:291`: Dashboard request without session/owner keys includes the six expected owners, preserves Claude's unsupported-auth status, excludes readerless CLIs, and has unique owner keys.
- `:314`: A four-second detection delay does not consume the CLI source read budgets. Existing source failure and timeout tests remain in the suite.
- Command: `npx jest -c libs/backend/cli-agent-runtime/jest.config.ts libs/backend/cli-agent-runtime/src/lib/cli-agents/limits/plan-limit-owner-discovery.service.spec.ts --coverage=false --maxWorkers=1 --silent`. Result: 1 suite passed, 33 tests passed.
- Scoped `ptah_get_diagnostics` after edits: 0 TypeScript errors, clean coverage.

## Decisions

- Used the existing detection result and owner resolvers instead of adding a lane roster dependency. The service already resolves the same Codex, OpenCode, Antigravity, Grok, and Ptah CLI owners; moving deadline start points fixes the observed gap with no DI changes. Alternative: inject `LaneOwnerResolver` / `LaneLimitLookupService`. Evidence: existing `cliStores`, `detectedLanes`, `ptahCliLanes`, and `planOwnerRead` in this service. Reversible: yes.
- Gave detection the existing slow lookup budget of 12 seconds. Alternative: retain 3 seconds, which would still drop all detection-dependent owners when detection takes longer. Evidence: `SLOW_LIMIT_LOOKUP_DEADLINE_MS` already bounds Codex work, and the investigation identified detection exceeding the old shared 3-second budget. Reversible: yes.

## Not done

- No live Electron snapshot was run; the focused service spec verifies the dashboard request shape and owner discovery. No files outside this service, its colocated spec, and this report were edited by this batch.
