# CodeRabbit fixes for PR #918

## Fixes

1. **Shutdown adapter capture** — `apps/ptah-electron/src/activation/wire-runtime.ts:552`: guarded SDK adapter resolution, logged the real error through the injected logger, and left the ref null so later captures run. Spec: `apps/ptah-electron/src/activation/wire-runtime.spec.ts:49` checks later CLI and process manager refs after an adapter failure. Reply: "SDK adapter capture is now non-fatal; a regression spec confirms later shutdown handles are still captured."
2. **Late sealed revision** — `libs/backend/persistence-sqlite/src/lib/session-store/session-stats-repository.ts:205`: a newer accepted revision changes a finalized row to `finalize_pending`, clears the prior seal and retry state, and lets the worker seal the new revision. Older and equal revisions stay finalized. Spec: `session-stats-repository.spec.ts:117`. Reply: "Newer contributions now reopen finalization as pending, while only resumeSession returns a sealed row to active."
3. **Quit-time reconciliation** — `libs/backend/persistence-sqlite/src/lib/session-store/sqlite-session-usage-sink.ts:193`: `flush()` runs one pending-only reconciliation batch after queued writes, with a 500 ms row-processing deadline, logged failure isolation, and no exception from the reconcile pass. Spec: `session-stats-repository.spec.ts:152`. Reply: "Flush now performs one bounded pending finalization pass before shutdown completes."
4. **Coverage label** — `libs/frontend/dashboard/src/lib/components/usage-dashboard/usage-dashboard.component.html:59`: changed the label to "Ledger captured since". Spec: `usage-dashboard.component.spec.ts:372`. Reply: "The label now identifies the ledger as the source of the capture date."
5. **Partial empty state** — `libs/frontend/dashboard/src/lib/components/usage-dashboard/usage-summary.view-model.ts:299` and `usage-dashboard.component.html:116`: the view model describes ledger gaps, unavailable sources, or both. Specs: `usage-summary.view-model.spec.ts:249` and `usage-dashboard.component.spec.ts:372`. Reply: "The empty state now distinguishes a ledger coverage gap from unavailable usage sources."

## Decisions

- Used the ledger's historical-backfill reason to distinguish its coverage gap from a separate unavailable source. Other partial or unavailable statuses use the source-unavailable message. This follows `usage-summary.service.ts` status construction and is reversible.
- Limited the shutdown pass to the repository's existing 32-row batch and a 500 ms row-processing deadline. This leaves remaining rows for the next periodic or startup pass; the choice is reversible.

## Verification

- Ran exactly once: `npm run verify -- -t test -p @ptah-extension/persistence-sqlite,@ptah-extension/dashboard,ptah-electron`.
- Result: exit code 1 before tests ran. Nx failed to load default and configured plugins because worker spawn returned `EPERM`. No retry was made.
- `ptah_get_diagnostics` was called after edits; its TypeScript check remained unavailable after 45 seconds, so it reported four files unchecked rather than a pass or failure.
- Skill discovery/loading was unavailable in this lane; no skill instructions were applied.
