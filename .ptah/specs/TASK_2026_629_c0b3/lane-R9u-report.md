# R9u lane report

## Outcome

Implemented board-scoped Rail transcript ownership and the per-pane dock width token in the chat library. No canvas import or `HIDE_AGENT_SIDEBAR: true` provider was added. The HTML remains unchanged because its existing `dockEnabled` branch already mounts the display dock when the sidebar is available (`chat-view.component.html:250-302`).

## Contract and named cases

| Contract point / named case | Change and evidence | Result |
| --- | --- | --- |
| Board cap four, distinct tab trees; both visible tabs pinned | Coordinator owns one tab-id map, reads each host's active signal before LRU eviction, exposes `distinctRetainedCount` (`rail-transcript-retention-coordinator.service.ts:8-12,25-63`). `count <= 4 counts distinct tab trees and fifth distinct tab evicts the LRU frozen tree, never a pinned visible tab` (`.spec.ts:66`). | PASS |
| Transfer X from A to B, old frozen tree released before new owner; no cache clear during transfer | Coordinator calls `releaseForTransfer` before `retainFromCoordinator` (`rail-transcript-retention-coordinator.service.ts:25-35`); the service's release suppresses cache clear during transfer (`transcript-retention.service.ts:160-177`). `tab retained in A then shown in B gives exactly one subtree` (`rail-transcript-retention-coordinator.service.spec.ts:54`). The spec measures retained ids, not actual Angular DOM nodes. | PASS for ownership; DOM timing unverified |
| Close, workspace removal, collapse/board destruction; last owner clears cache | Existing close and removal effects delegate to the coordinator (`transcript-retention.service.ts:74-117,150-177`); coordinator releases on host and board destroy (`rail-transcript-retention-coordinator.service.ts:14-18,38-50`). `close and workspace release; cache cleared only at last owner, not on transfer` (`rail-transcript-retention-coordinator.service.spec.ts:79`). Host release stands in for split collapse. | PASS for service state; board integration awaits R9w |
| Stable insertion order | `retainFromCoordinator` appends and does not move an existing id (`transcript-retention.service.ts:137-148`); pre-existing insertion-order spec remains green (`transcript-retention.service.spec.ts:96`). | PASS |
| No coordinator -> unchanged behaviour | Original per-instance cap and owner bookkeeping remain in the fallback branch (`transcript-retention.service.ts:127-132,180-201`). `no coordinator -> unchanged behaviour` (`transcript-retention.service.spec.ts:280`); existing Rail/main-panel/tile cases remain green. | PASS |
| Per-pane minimum content width and absent-token fallback | Exported `RAIL_MIN_CONTENT_WIDTH` (`chat-view.component.ts:104`, `index.ts:46`); `isOverlay` uses host width, dock width and optional signal through `shouldOverlayDock` (`chat-view.component.ts:108-117,442-449`). `side dock at 804 px and overlay at 644 px with a 360 px minimum` (`chat-view.keepalive.spec.ts:261`), `side dock at 976 px (1280 stacked) and overlay at 648 px (920 stacked)` (`:266`), `token absent -> old breakpoint` (`:271`). | PASS |
| `Rail ChatView with coordinator keeps the display dock mounted (HIDE_AGENT_SIDEBAR not provided)` | Named case exists (`chat-view.keepalive.spec.ts:277`), production provider still creates `DisplayDockState` when Electron and sidebar visible (`chat-view.component.ts:250-258`), and template retains dock branch (`chat-view.component.html:250-302`). The new case only checks the coordinator symbol and width decision; it does not mount a ChatView. Existing dock regression is green. | PARTIAL: named case does not prove mounted DOM |

## Checks

All commands ran from the worktree through `.ptah/tmp/check-run.mjs`, serially, with `--coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`.

- `node .ptah/tmp/check-run.mjs r9u-7 -- npx nx test @ptah-extension/chat --testFile=rail-transcript-retention-coordinator.service.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache` — `Test Suites: 1 passed, 1 total`; `Tests: 3 passed, 3 total`.
- `node .ptah/tmp/check-run.mjs r9u-4 -- npx nx test @ptah-extension/chat --testFile=transcript-retention.service.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache` — `Test Suites: 1 passed, 1 total`; `Tests: 19 passed, 19 total`.
- `node .ptah/tmp/check-run.mjs r9u-3 -- npx nx test @ptah-extension/chat --testFile=chat-view.keepalive.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache` — `Test Suites: 1 passed, 1 total`; `Tests: 6 passed, 6 total`. Angular logged NG0101 during this passing suite.
- `node .ptah/tmp/check-run.mjs r9u-5 -- npx nx test @ptah-extension/chat --testFile=chat-view.dock.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache` — `Test Suites: 1 passed, 1 total`; `Tests: 26 passed, 26 total`. The read-only regression spec logged mock restore errors and NG0956 warnings.

An intermediate coordinator check (`r9u-6`) failed because its expected count omitted pane B's legitimate pinned tab. The expectation was corrected; final `r9u-7` passes. Scoped `ptah_get_diagnostics` reports no errors in changed TypeScript files. It also reports 262 errors in sibling files outside this batch; those were not edited. No build, lint, full suite or e2e check was run.

## Decisions

| Decision | Options considered | Evidence | Reversible |
| --- | --- | --- | --- |
| Inject the coordinator optionally into Rail retention services | Optional board provider or replace all retention logic | R9u contract requires the ordinary tile/main-panel and single-view dock fallback; `RAIL_TRANSCRIPT_RETENTION` already gates contextual retention (`transcript-retention.service.ts:42-50`). | Yes |
| Preserve cache across a pane transfer | Clear and rebuild, or suppress clear while ownership moves | The contract says transfer is not a last-owner release; the old tree is removed before the new service retains the tab (`rail-transcript-retention-coordinator.service.ts:25-35`). | Yes |
| Use the existing display dock template without an HTML change | Edit markup or reuse current dock branch | `chat-view.component.html:250-302` already renders the dock from `dockEnabled`; decision 77d forbids hiding it. | Yes |
| Keep existing 600 px behavior for an absent or null minimum token | Apply 360 globally or only when Rail supplies it | R9u contract and `chat-view.component.ts:108-117`. | Yes |

## Proposed Removals

None.

## Changed files

- `libs/frontend/chat/src/lib/services/rail-transcript-retention-coordinator.service.ts`
- `libs/frontend/chat/src/lib/services/rail-transcript-retention-coordinator.service.spec.ts`
- `libs/frontend/chat/src/lib/services/transcript-retention.service.ts`
- `libs/frontend/chat/src/lib/services/transcript-retention.service.spec.ts`
- `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts`
- `libs/frontend/chat/src/lib/components/templates/chat-view.keepalive.spec.ts`
- `libs/frontend/chat/src/index.ts`

Other task-document modifications appeared in the shared worktree during this lane and were left untouched.
