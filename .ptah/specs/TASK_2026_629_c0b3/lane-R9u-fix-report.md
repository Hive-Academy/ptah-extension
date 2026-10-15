# R9u fix round

## Findings

| Finding | Fix and source | Named spec case | Result |
| --- | --- | --- | --- |
| S1 | Mounted an Electron Rail ChatView with `SESSION_CONTEXT`, `RAIL_TRANSCRIPT_RETENTION`, a shared coordinator, and `RAIL_MIN_CONTENT_WIDTH`; drove its ResizeObserver and checked rendered dock, separator, and overlay states. No `HIDE_AGENT_SIDEBAR` provider is installed. `chat-view.keepalive.spec.ts:596-652` | `side dock at 804 px and overlay at 644 px with a 360 px minimum`; `side dock at 976 px (1280 stacked) and overlay at 648 px (920 stacked)`; `760/759 px flips with the default 400 px dock`; `token absent -> old breakpoint`; `Rail ChatView with coordinator keeps the display dock mounted (HIDE_AGENT_SIDEBAR not provided)` | PASS |
| S2 | Coordinator reads other hosts' active signals in `liveElsewhere` (`rail-transcript-retention-coordinator.service.ts:26`); retention delegates (`transcript-retention.service.ts:63`); ChatView excludes another pane's active id (`chat-view.component.ts:869`). A transcript DOM test id was added (`chat-view.component.html:82`). | `two ChatViews share one X transcript after active tab swaps in both directions` (`chat-view.keepalive.spec.ts:654`) | PASS |
| M1 | Custom dock width is capped at `hostWidth - minimum` with a 300 px floor; the default 400 px width still determines the 760/759 breakpoint (`chat-view.component.ts:476-492`). | `End at 804 px stays in side mode with its separator` (`chat-view.keepalive.spec.ts:644`) | PASS |
| M2 | Child host and coordinator injectors are destroyed and every owned tab's cache clear and final count are asserted (`rail-transcript-retention-coordinator.service.spec.ts:117`). | `host destroy and board destroy release every owner` | PASS |
| M3 | Split the combined case into transfer/cache, close, and workspace cases. The workspace test flushes the initial effect before retaining Z (`rail-transcript-retention-coordinator.service.spec.ts:91-115`). | `cache cleared only at last owner, not on transfer`; `close release`; `workspace release` | PASS |

## Checks

Each command ran from the worktree through the machine-wide lock, serially. Captured logs are in `%TEMP%`.

- `node .ptah/tmp/check-run.mjs r9u-fix-1 -- npx nx test @ptah-extension/chat --testFile=rail-transcript-retention-coordinator.service.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache` — Test Suites: 1 passed, 1 total; Tests: 6 passed, 6 total.
- `node .ptah/tmp/check-run.mjs r9u-fix-2 -- npx nx test @ptah-extension/chat --testFile=transcript-retention.service.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache` — Test Suites: 1 passed, 1 total; Tests: 19 passed, 19 total.
- `node .ptah/tmp/check-run.mjs r9u-fix-5 -- npx nx test @ptah-extension/chat --testFile=chat-view.keepalive.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache` — Test Suites: 1 passed, 1 total; Tests: 9 passed, 9 total.
- `node .ptah/tmp/check-run.mjs r9u-fix-6 -- npx nx test @ptah-extension/chat --testFile=chat-view.dock.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache` — Test Suites: 1 passed, 1 total; Tests: 26 passed, 26 total.

The first keepalive run (`r9u-fix-3`) failed 4 of 8 because deferred dock content had not rendered; adding the same three-round settle used by the dock spec resolved this. `r9u-fix-4` then passed 9 of 9; `r9u-fix-5` passed after adding direct reactive assertions. Keepalive prints `NG0101 ApplicationRef.tick is called recursively` console errors during both the pre-existing workspace case and the new mounted cases; the suite passes. Scoped `ptah_get_diagnostics` initially found no errors in requested TypeScript files; the post-edit attempt timed out after 45 seconds, so final confidence comes from the four passing Jest targets. No build, lint, full suite, or e2e check was run.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Read other panes' active tab signals in the coordinator predicate | Signal predicate or effect-ordered transfer only | S2 identified a DOM timing gap; synchronous computed assertions and both swap directions pass | Yes |
| Cap custom width while preserving the default width breakpoint | Cap all widths or only user custom width | The 760/759 default-width case and End at 804 both pass | Yes |
| Use a DOM `data-tab-id` on transcript hosts | DOM attribute or component instance query | The mounted ChatView test stubs heavy transcript children, so the host attribute identifies X without instantiating them | Yes |
| Reuse the dock spec's production-template harness shape in keepalive | Mounted ChatView or pure helper | S1 requires token injection and rendered dock assertions | Yes |

## Changed files

- `libs/frontend/chat/src/lib/services/rail-transcript-retention-coordinator.service.ts`
- `libs/frontend/chat/src/lib/services/rail-transcript-retention-coordinator.service.spec.ts`
- `libs/frontend/chat/src/lib/services/transcript-retention.service.ts`
- `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts`
- `libs/frontend/chat/src/lib/components/templates/chat-view.component.html`
- `libs/frontend/chat/src/lib/components/templates/chat-view.keepalive.spec.ts`
- `.ptah/specs/TASK_2026_629_c0b3/lane-R9u-fix-report.md`
