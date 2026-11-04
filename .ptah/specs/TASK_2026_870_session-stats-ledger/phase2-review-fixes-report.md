# Phase 2 review fixes report

## Findings and fixes

| Finding | Fix | Regression coverage |
| --- | --- | --- |
| Periodic idle sweep sealed open chats | `session-stats-repository.ts:262` limits periodic candidates to pending rows. Startup alone may consider active rows after both event and write timestamps are idle; live IDs are excluded. `sqlite-session-usage-sink.ts:115` obtains live IDs from the adapter. | `session-stats-repository.spec.ts:93` checks periodic exclusion and startup live-ID exclusion. |
| Config re-init and workspace disposal sealed surviving sessions | `sdk-agent-adapter.ts:415` no longer queues finalization on config re-init. `sdk-agent-adapter.ts:969` excludes IDs still live after workspace disposal. | Existing adapter lifecycle specs cover Stop and compaction; repository tests cover pending and resume. |
| Quit omitted or lost finalization requests | `sdk-agent-adapter.ts:814` returns its disposal promise. `shutdown.ts:303` snapshots IDs before chat disposal, filters IDs still live afterwards, queues requests, then flushes. `with-engine.ts:347` and `:435` dispose the SDK adapter before `shutdownHostRuntime` drains the sink on failure and normal exit. | `shutdown.spec.ts:380` asserts chat disposal, request, SDK disposal, drain ordering. `with-engine.spec.ts:962` and `:975` assert SDK disposal before drain on normal and failed initialization. |
| Late lower revision reopened a true end | `session-stats-repository.ts:202` preserves finalization state unless the aggregate revision exceeds `finalize_revision`. Explicit resume also clears pending via `session-stats-owner.service.ts:477` and `session-stats-repository.ts:253`. | `session-stats-repository.spec.ts:109` checks late revision; `:125` checks resume before new usage. |
| One failed row aborted the page | `session-stats-repository.ts:262` continues after a failed row, records retry metadata, logs the real Error, and returns the changed-row count. Retry metadata failure is logged too. | `session-stats-repository.spec.ts:156` uses an SQLite trigger to fail one row and checks that the next seals. |
| Welcome tiles dropped known lower bound | `usage-vitals.model.ts:149` uses `costUsd ?? knownCostUsd ?? null`, retaining a separate unpriced flag. | `usage-vitals.model.spec.ts:196` and `usage-vitals.cache.spec.ts:116` cover lower bounds and null. |
| Empty range overclaimed partial coverage | `usage-dashboard.component.html:116` now says earlier usage may be incomplete. | Presentation-only copy change. |

The successful token-matched stream exit is a true end: `endSessionIfTokenMatches` removes the registered record only when its token still matches, and finalization is requested only when that method returns true (`sdk-agent-adapter.ts:1614`). A normal turn's stream-end callback only releases run-scoped resources and does not call this method.

## Decisions

- Keep the startup idle scan conditional on a live-ID provider. The adapter supplies that provider at construction; if a host never constructs the adapter, it avoids guessing which active rows are safe to seal. This is reversible.
- Treat an explicit resumed run as a resume signal before its first usage contribution; this clears pending state without waiting for a new revision. This is reversible.

## Verification

The single scoped command was `npm run verify -- -p @ptah-extension/persistence-sqlite,@ptah-extension/agent-sdk,@ptah-extension/platform-core,@ptah-extension/cli-engine,@ptah-extension/chat,@ptah-extension/dashboard,ptah-electron`. It acquired a memory slot, but Nx failed while loading default and ESLint/Jest plugins with `spawn EPERM`; no lint, tests, or typecheck ran. It was not retried. Scoped Ptah diagnostics also reported TypeScript checking unavailable after 45 seconds, with the requested files unchecked, including the later CLI failure-path edit. The verifier was not rerun after that edit.

## Known gaps

- The startup idle scan is skipped if the live-ID provider has not been installed by its scheduled pass. Pending rows still reconcile; later periodic passes do not scan active rows by design.
- No test execution result is available because the verifier stopped during Nx plugin loading.



