# Implementation plan

## Scope

- Keep `ObservationQueueStore` capture, batching, and SQLite persistence unchanged.
- Stop publishing routine observation-captured messages from Electron/VS Code and CLI bridges; they only drive activity noise and a premature TUI refresh.
- Make the remaining Thoth push subscriptions singleton-safe and owned by returned runtime disposables.
- Carry the originating workspace on successful curation events and suppress foreign-workspace activity items in the renderer.
- Skip constructor-effect first passes in the Memory tab so `ngOnInit` is the single initial list/stats/symbol load.

## Verification

- Add deterministic 1/6/9 repeated-boot coverage for listener count and broadcast count.
- Preserve tests for meaningful curation broadcasts and warnings; add workspace routing coverage.
- Update Memory tab tests to assert one initial load and one load per real trigger.
- Run focused Nx tests/typechecks for every changed project and report test-suite/test counts exactly.

## Explicit non-goals

- No SQLite worker redesign, capture serialization change, startup/analytics work, or background-session live-view work.
- No UI latency/FPS claims from mocked tests; scaling evidence is limited to listener/broadcast cardinality and static path analysis.
