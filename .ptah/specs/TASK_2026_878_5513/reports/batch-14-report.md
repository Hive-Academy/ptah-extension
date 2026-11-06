# Batch 14 report — Memory tab rebuild state and indexing banner

Implementer: frontend-developer subagent (claude family). Paths are relative to the worktree root.

## Files changed

- MODIFIED `libs/frontend/memory-curator-ui/src/lib/services/memory-state.service.ts`
  - adds `MemoryRebuildOutcome` and `MEMORY_REBUILD_FAILED_MESSAGE`
  - adds the `_rebuilding` and `_rebuildResult` signals
  - `rebuildIndex` no longer uses `_loading`
- MODIFIED `libs/frontend/memory-curator-ui/src/lib/services/memory-state.service.spec.ts`: new describe block "rebuildIndex" (4 cases).
- MODIFIED `libs/frontend/memory-curator-ui/src/lib/components/memory-curator-tab.component.ts`
  - button label and busy state
  - result line and error alert in the Code index view
  - banner `actionMessage`
  - removed the swallowing `.catch()` calls
- MODIFIED `libs/frontend/memory-curator-ui/src/lib/components/memory-curator-tab.component.spec.ts`
  - the existing stubs gain `rebuilding` and `rebuildResult`
  - the indexing stub gains `isBusy`, `starting`, `runningOrigin`, `lastRun` and `actionMessage`
  - the label assertion is updated
  - new describe block "rebuild state and banner action message" (7 cases)
- MODIFIED `libs/frontend/memory-curator-ui/src/lib/components/memory-indexing-banner.component.ts`
  - new `actionMessage` input, rendered with `role="alert"`
  - the error case uses fixed text

## Acceptance criteria evidence

Task 14.1:
- `memory-state.service.ts:74-75` declares `_rebuilding` and `_rebuildResult` (`{at, rebuiltFts, rebuiltVec}`). They are exposed as the read-only signals `rebuilding` and `rebuildResult`.
- `rebuildIndex` (`:299`) no longer touches `_loading`. A failure goes through `error()` with the fixed `MEMORY_REBUILD_FAILED_MESSAGE` (`:26`, `:312`).

Task 14.2:
- The button label and `aria-label` are `Rebuild memory search index`. `[disabled]` and `aria-busy` are bound to `rebuilding()`, with a spinner while it runs (`memory-curator-tab.component.ts:140-152`).
- The result line `Memory search index rebuilt (full-text: yes, vectors: yes|unavailable)` uses `role="status"` and `data-testid="memory-rebuild-result"` (`:163`, computed at `:371`).
- A rebuild failure shows in the Code index view as `role="alert"` (`data-testid="memory-code-error"`, `:172`). Before this change, `error()` was rendered only in the Memories view, so a rebuild failure was invisible.
- The `.catch(() => undefined)` calls on start, resume and cancel are removed (`:516`, `:522`, `:528`). Since Batch 13, these service methods never reject.
- The banner gets `[actionMessage]="indexingActionMessage()"` (`:272`). It renders the message with `role="alert"` (`memory-indexing-banner.component.ts:20-29`, input `:186`).
- The banner busy state also counts `indexingService.isBusy()` (`:332`).

## Tests added

- State spec:
  - `rebuilding` is true while the call is in flight and `loading` stays false; the result is stored
  - a second call during a rebuild is ignored
  - a failure gives the fixed sentence, with the raw error absent and no stuck flags
  - the result survives `refresh()`
- Tab spec:
  - label, aria-label, click and disabled-with-spinner bound to `rebuilding()`
  - result line for vectors yes and vectors unavailable (`role="status"`)
  - failure alert in the code view
  - banner action message as `role="alert"`
  - banner error shows fixed text, with the raw message absent
  - banner Index now calls `start('/ws', false)`

## Verify

Command, run from the worktree root with `TMPDIR=/var/tmp/b878`:
`npm run verify -- -p @ptah-extension/memory-curator-ui,ptah-extension-webview` (N=2)

First run:
- Lint and typecheck: `NX 4 tasks: 3 succeeded, 1 failed`. The failure is `✖ nx run ptah-extension-webview:lint`, the known pre-existing "Static imports of lazy-loaded libraries" errors in unchanged app files.
- Test: `NX 2 tasks: 1 succeeded, 1 failed`. 4 new tab cases failed (`this.service.lastRun is not a function`): the Code index view renders the real `ptah-workspace-indexing` component against the stubbed indexing service. Fix: the stub now provides `lastRun`, `runningOrigin` and `starting`.

Single-file re-run:
`npm run verify -- -t test -p @ptah-extension/memory-curator-ui -- --testPathPatterns=memory-curator-tab` gave `NX 1 task: 1 succeeded`.

Full re-run: see the "Final verify" section below.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Every rebuild failure uses one fixed sentence, matching the backend `RpcUserError` | pass `result.error` through / fixed text | The brief forbids raw backend text. A transport timeout would otherwise show `RPC timeout: memory:rebuildIndex` | yes |
| `error()` is also rendered in the Code index view | new rebuild-error signal / reuse `error()` | The plan says "Error through `error()`". The rebuild button only exists in the Code index view, where `error()` was not rendered | yes |
| `full-text: no` when `rebuiltFts` is false | — | The plan names only `yes`. The backend contract allows `false` | yes |
| The banner error case shows `Indexing failed. See the logs for details.` and no longer shows `banner.message` | keep raw / fixed | `banner.message` is the raw `last_error` (see the Batch 13 report) | yes |
| A second rebuild during an in-flight one is ignored | — | The button is disabled while rebuilding. This guard covers programmatic calls | yes |

## Proposed removals

None. The "Rebuild index" label is renamed, not removed (plan parity note).

## Final verify (after the stub fix)

`npm run verify -- -p @ptah-extension/memory-curator-ui,ptah-extension-webview` (N=2):
- lint,typecheck: `NX 4 tasks: 3 succeeded, 1 failed`. The failure is `✖ nx run ptah-extension-webview:lint`, only the pre-existing "Static imports of lazy-loaded libraries" errors.
- test: `NX 2 tasks: 2 succeeded`.

## Review round 1 fixes (commit a29242802)
- Findings 2 and 5: the rebuild failure lives in its own `rebuildError` signal, so list and
  stats loads cannot clear or replace it. The Code index alert renders only `rebuildError`.
- Every other memory action failure (list, search, pin, forget, stats, symbols) and both purge
  actions show a fixed sentence. The raw detail goes to `console.warn` only.
- Tests: memory-state.service.spec.ts and memory-curator-tab.component.spec.ts. Scoped tests passed.
