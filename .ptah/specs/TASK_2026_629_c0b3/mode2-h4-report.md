# Mode 2 (H4) — Batch R9u verify, TASK_2026_629_c0b3

Verdict: **PASS**. Not committed: decision row 95 says the orchestrator commits once the pending scoped
re-review returns. `code-logic-review-R9u-fix.md` was not on disk when this report was written, and this
report did not wait for it.

## Step 1-2 — Report vs disk

`git status --short libs apps` lists exactly the 8 R9u paths and nothing else:

- M `libs/frontend/chat/src/index.ts`
- M `libs/frontend/chat/src/lib/components/templates/chat-view.component.html`
- M `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts`
- M `libs/frontend/chat/src/lib/components/templates/chat-view.keepalive.spec.ts`
- M `libs/frontend/chat/src/lib/services/transcript-retention.service.spec.ts`
- M `libs/frontend/chat/src/lib/services/transcript-retention.service.ts`
- ?? `libs/frontend/chat/src/lib/services/rail-transcript-retention-coordinator.service.spec.ts`
- ?? `libs/frontend/chat/src/lib/services/rail-transcript-retention-coordinator.service.ts`

Every file contains a real implementation, with no stubs. The coordinator (74 lines) has the board-wide
owner map, recency LRU, a pinned active tab per registered host, `liveElsewhere`, transfer via
`releaseForTransfer` (keeps the cache), `distinctRetainedCount`, and `DestroyRef` release. The fix-round
items all trace to code:

- S2: `liveElsewhere` filter at `chat-view.component.ts:869`.
- M1: custom dock width capped at host - minimum, with a 300 px floor, at `chat-view.component.ts:476-492`.
- S1/S2 DOM hook: `data-tab-id` at `chat-view.component.html:82`.

Without a token, `dockWidth` gives the same result as before. `clampDockWidth` already caps at 0.75 x host,
so the extra `Math.min` with `dockMaxWidth` changes nothing.

## Step 3 — Checks (serial, lock runner `.ptah/tmp/check-run.mjs`, logs `%TEMP%/629-check-<label>.log`)

| Label | Command | Result |
| --- | --- | --- |
| `r9u-full` | `npx nx test @ptah-extension/chat --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache` | exit 0. `Test Suites: 203 passed, 203 total`; `Tests: 2 skipped, 3719 passed, 3721 total` |
| `r9u-tc` | `npx nx typecheck @ptah-extension/chat --parallel=1 --skip-nx-cache` | exit 0. `Successfully ran target typecheck`; 0 error lines |
| `r9u-lint` | `npx nx lint @ptah-extension/chat --parallel=1 --skip-nx-cache` | exit 0. `42 problems (0 errors, 42 warnings)` |
| `r9u-names-json` | `npx jest -c libs/frontend/chat/jest.config.ts <dock, keepalive, coordinator, retention specs> --coverage=false --maxWorkers=2 --json --outputFile=%TEMP%/629-r9u-names.json` | exit 0. `Test Suites: 4 passed`; `Tests: 60 passed`; `numFailed=0` |

Baseline comparison with H1 (`mode2-h1-report.md`: 202 suites, 3705 passed, 2 skipped):

- Suites: +1, the new coordinator spec.
- Passing tests: +14. That is the coordinator spec (6), the retention spec (1, `no coordinator -> unchanged
  behaviour`) and the keepalive spec (7, the `Rail ChatView per-pane display dock` block).
- Skipped tests: unchanged at 2. No test was lost.

Lint compared with H1 (40 warnings, 0 errors): +2 warnings, both in R9u files. Neither blocks: the lint
exits 0 and they are warnings, not errors.

- `chat-view.keepalive.spec.ts:86` `no-unused-vars`: `DisplayDockState` is imported but never used. This is
  new in R9u.
- `rail-transcript-retention-coordinator.service.ts:71` `no-non-null-assertion`: `this.owners.get(victim)!`.
  This is new in R9u.

The other warnings in R9u files were already there before R9u:

- `chat-view.component.ts:1012` `max-lines` (1346; it was 1320 at H1).
- `chat-view.keepalive.spec.ts:226/238/239/247` `no-non-null-assertion`. These are the H1 lines
  209/221/222/230, moved down by the new imports.

Non-failing runtime noise:

- The full run printed "A worker process has failed to exit gracefully". Every suite passed, and this run
  did not attribute it to any file.
- The fix lane reported `NG0101 ApplicationRef.tick is called recursively` console errors in the keepalive
  spec. They appear in both the existing workspace case and the new mounted cases, and the suite passes.

There are no failures, so there are no pre-existing failures outside R9u to list.

## Named-case evidence (from `%TEMP%/629-r9u-names.json`)

Decision 89 (R9h) dock cases, still green:

- `passed | ChatViewComponent - Display dock (Task 25.2) Rail host (SESSION_CONTEXT) counts only owned agents: an unresolved running agent adds no badge or auto-open`
- `passed | ChatViewComponent - Display dock (Task 25.2) single chat view that provides SESSION_CARD_ACTIONS without SESSION_CONTEXT keeps unresolved agents`

R9u coordinator cases:

- `passed | RailTranscriptRetentionCoordinator tab retained in A then shown in B gives exactly one subtree`
- `passed | RailTranscriptRetentionCoordinator count <= 4 counts distinct tab trees and fifth distinct tab evicts the LRU frozen tree, never a pinned visible tab`
- `passed | RailTranscriptRetentionCoordinator cache cleared only at last owner, not on transfer`
- `passed | RailTranscriptRetentionCoordinator close release`
- `passed | RailTranscriptRetentionCoordinator workspace release`
- `passed | RailTranscriptRetentionCoordinator host destroy and board destroy release every owner`
- `passed | TranscriptRetentionService no coordinator -> unchanged behaviour`

R9u keepalive and dock cases (a mounted ChatView, not the helper):

- `passed | Rail ChatView per-pane display dock side dock at 804 px and overlay at 644 px with a 360 px minimum`
- `passed | Rail ChatView per-pane display dock side dock at 976 px (1280 stacked) and overlay at 648 px (920 stacked)`
- `passed | Rail ChatView per-pane display dock 760/759 px flips with the default 400 px dock`
- `passed | Rail ChatView per-pane display dock token absent -> old breakpoint`
- `passed | Rail ChatView per-pane display dock Rail ChatView with coordinator keeps the display dock mounted (HIDE_AGENT_SIDEBAR not provided)`
- `passed | Rail ChatView per-pane display dock End at 804 px stays in side mode with its separator`
- `passed | Rail ChatView per-pane display dock two ChatViews share one X transcript after active tab swaps in both directions`

## rg results

- `HIDE_AGENT_SIDEBAR: true` is not added. The only added diff line that mentions `HIDE_AGENT_SIDEBAR` is the
  spec title at `chat-view.keepalive.spec.ts:635`. `chat-view.component.ts:263/295` are the existing optional
  injects, unchanged. No provider sets it.
- The coordinator does not import canvas. Its only imports are `@angular/core` and
  `import type { TranscriptRetentionService } from './transcript-retention.service'`. No R9u file has a
  `from '...canvas'` import.
- `RAIL_MIN_CONTENT_WIDTH` is exported at `libs/frontend/chat/src/index.ts:46` (from `chat-view.component`),
  and `RailTranscriptRetentionCoordinator` at `:47`. The token is declared as
  `InjectionToken<Signal<number | null>>` at `chat-view.component.ts:104`.

## Recorded, not fixed (row 100 Minors, plus residuals seen here)

1. Row 100 / review Minor 1: a Rail host with the coordinator but no `SESSION_CONTEXT` is never registered, so
   it is never pinned and its active tab can be evicted (`transcript-retention.service.ts:77-79`). This
   cannot happen with today's providers. Deferred to R9w.
2. Row 100 / review Minor 2: `evict()` returns at `victim === null` with more than 4 owners
   (`rail-transcript-retention-coordinator.service.ts:70`). This only happens with more than 2 hosts. The
   soft cap is not documented or logged. Deferred to R9w.
3. Row 100 / review Minor 3: there is no dev-mode assert when both panes show the same tab. R9w must prevent
   it. Deferred to R9w or the PR.
4. Residual: the named cases "count <= 4 counts distinct tab trees" and "fifth distinct tab evicts the LRU…"
   are still one `it` (coordinator spec:78). The M3 split covered transfer, close and workspace only. Naming
   only; both halves are asserted.
5. Residual: the 2 new lint warnings above (unused `DisplayDockState` import; non-null assertion at
   coordinator:71).
6. Residual: `NG0101` recursive-tick console errors and the Jest worker force-exit notice. Both are
   non-failing.
7. Re-review `code-logic-review-R9u-fix.md` was not on disk at report time. Any residuals it raises are not
   covered here.

## Ready commit command (run from W in the foreground, only after the re-review accepts and no writer lane runs)

```bash
git add libs/frontend/chat/src/index.ts \
  libs/frontend/chat/src/lib/components/templates/chat-view.component.html \
  libs/frontend/chat/src/lib/components/templates/chat-view.component.ts \
  libs/frontend/chat/src/lib/components/templates/chat-view.keepalive.spec.ts \
  libs/frontend/chat/src/lib/services/transcript-retention.service.spec.ts \
  libs/frontend/chat/src/lib/services/transcript-retention.service.ts \
  libs/frontend/chat/src/lib/services/rail-transcript-retention-coordinator.service.spec.ts \
  libs/frontend/chat/src/lib/services/rail-transcript-retention-coordinator.service.ts
git commit -F - <<'EOF'
feat(chat): batch R9u - board retention coordinator, pane dock width

Add RailTranscriptRetentionCoordinator: one cap of four distinct tab
trees per visible Rail board across both Rail ChatViews, visible tabs
pinned, LRU eviction, transfer disposes the old pane's subtree first
and keeps the tree cache until the last owner releases. ChatView hides
a tab that is live in the other pane.

Add RAIL_MIN_CONTENT_WIDTH: the dock overlays when host width minus
dock width drops below the minimum; a custom width is capped so it
cannot push the dock into overlay. Token absent keeps the 600 px rule.
The display dock stays mounted; HIDE_AGENT_SIDEBAR is not provided.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git log --oneline -1
```

Subject is 68 characters; every body line is 72 characters or fewer; type `feat`, scope `chat` (both in
`.commitlintrc.json`).
