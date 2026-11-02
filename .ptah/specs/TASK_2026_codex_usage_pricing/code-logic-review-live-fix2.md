# Code Logic Review: live-fix2 (PR #886)

Score: 8/10. Verdict: APPROVE, with the moderate follow-ups below. Blocking 0, Serious 0, Moderate 4.
Scope: full `git diff -- libs` (14 files) in the codex-usage-pricing worktree, read against the implementer's fix2 report. Nothing was executed (no tests, lint, typecheck or git writes), so the specs are read, not run.

## Verification of the fix1 findings

### S1, per-turn model: resolved
- `codex-context.ts:~536-541` stages the validated `turn/start` request model on the thread before the request is sent. It binds the model to the returned turn id after the response. This covers usage that arrives before the response.
- `codex-event-translator.ts:206-211` binds the thread model to the turn on the `turn/started` notification. `:341-347` resolves the model as notification model, then turn model, then thread model. Late usage for an older turn therefore keeps its own model. Child threads have independent entries.
- `codex-runtime.spec.ts` drives real `updateNextTurn` and `startTurn`. It checks model-less usage mapping to `model` and then `gpt-4o`. A second spec checks `thread/resume` seeding.

### S2, per-segment billing basis: resolved
- `codex-session-usage-owner.ts` `recordTurnPrice` takes each turn's `costBasis`. It keeps contiguous segments (capped at `MAX_USAGE_THREADS`) and a session `basis` that collapses to `unknown` when bases differ.
- `lifetimePrice()` returns `totalCost: null`, `costBasis: 'unknown'` and `pricingCoverage: 'partial'` for a mixed session. This follows the shared `SessionCostBasis` contract, which has no mixed value.
- `restore` cross-checks that the segment sum matches `knownCost` and that the derived basis matches the saved basis when the price is complete. A mismatch marks the checkpoint invalid.
- Turn-level cost and basis still come from the per-turn price, so the per-turn event stays correct (`turnCost` greater than 0, `covered-by-subscription` in the lifecycle spec).
- `session-metadata-store.ts` `nativeCheckpointCost` applies the same rule to sidebar totals: unknown basis gives null cost. It falls back to the legacy `billingMode` for old checkpoints.
- The `setBillingMode` overwrite from fix1 is gone.

### S3, specs exercise the real chain: mostly resolved
- `codex-chat-turn-lifecycle.spec.ts` runs a real `CodexEventTranslator`, the owner and the stream across an API-key then subscription resume. It checks the mixed checkpoint segments and provenance.
- It calls `setThreadModel` and `setTurnModel` by hand rather than going through `CodexContext`. `codex-runtime.spec.ts` covers that half, so the two together cover the chain, but no single test does.

### Old checkpoints and the metadata-store change: safe on upgrade
- New fields (`basis`, `segments`, thread `modelContextWindow` and `lastRequestTotalTokens`, `billingMode`) are all optional, so old checkpoints parse under `.strict()`.
- Legacy priced checkpoints get a derived basis (saved `billingMode`, else `unknown`) and one synthetic segment (`restore`). Nothing is discarded.
- `serialize()` no longer writes `billingMode`; the optional schema field is kept for reading.

### Claude and other providers: unaffected
- The only shared-path edits are in `session-metadata-store.ts`'s codex checkpoint cost function and in the plan-limits service. The plan-limits mapping still applies only to `codexExecution.runtime === 'codex-app-server'` sessions. Ledger owners still win, and the discovered-owner key gate still blocks other homes. A failed lookup now logs a warning.

## Moderate

- M1. **Staged model survives a failed `turn/start`.** `codex-context.ts:~538` sets the thread model before `process.request('turn/start')`. If the request rejects, `threadModels` keeps the new model and later model-less usage on a turn that did not use it is attributed to it. Fix: restore the previous value in a `catch`.
- M2. **A mixed session loses its visible total.** For a session that ran under an API key and later a subscription, `totalCost` is null and the basis is `unknown`. The estimated spend from the API-key segment is not shown anywhere at session level. This matches the contract but is lossy. Consider surfacing the estimated-segment sum, or document that this is intended.
- M3. **Downgrade risk.** The pricing schema is `.strict()`, so an older build reading a checkpoint with `basis` or `segments` rejects it as `invalid-checkpoint`. It then starts a fresh owner and can overwrite the saved totals on the next persist. Upgrade is safe; rollback is not. Note it in the PR.
- M4. **Legacy history stays unpriced after a mode change.** A pre-fix checkpoint with no saved `billingMode` restores as basis `unknown`. After any new turn the session total stays `unknown` permanently. This is an acknowledged limit, and it is conservative.

## Minor
- `turnModels` grows by one entry per turn until the translator is disposed. This is negligible but unbounded.
- `recordTurnPrice` maps the `reported` basis to `unknown`. This is fine for Codex, but it hides a future reported-cost path.
- The pre-existing M3 limit stands: a native session maps to the home's current account if the login in that home changed.

## Verdict
APPROVE. The fix1 defects (wrong-model attribution, relabeled billing history, weak specs) are addressed with evidence in code and specs. Confidence is medium-high; the specs are unexecuted. M1 is the one worth fixing before merge.
