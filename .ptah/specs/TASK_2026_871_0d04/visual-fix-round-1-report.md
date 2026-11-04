# Visual fix round 1 — TASK_2026_871_0d04

Source: `visual-review.md` (Electron, head a2500bfab), plus two coordinator CI items (initial-bundle budget, degradation-audit ratchet). Nothing committed; worktree left dirty.

## 1. Serious — detail is a full page, not a 384px side panel (review issues 1 and 2)

- NEW `libs/frontend/tasks-ui/src/lib/components/detail/task-detail-header.component.ts` (223 lines). It renders the "← Board" button (`task-detail-back`), the `.ptah / specs / <folder>` breadcrumb, the title with status, type and stage badges, the folder path `.ptah/specs/<folder>/` (`task-detail-path`), and on the right "Start in chat" (`task-detail-start`) and a "Change status" DaisyUI dropdown (`task-detail-status-menu`). It emits the card's own payloads (`TaskStartRequest`, `TaskStatusChange`). Start only shows where the card shows it (`isStartableStatus`: backlog and blocked). Focus moves to Back when the page opens, because the card that opened it is now hidden.
- `detail/task-detail.component.ts`
  - The `<aside w-96>` panel is now a full-height `<section data-testid="task-detail-page">` (:156-171) that uses the new header.
  - The `wide` input is gone. New inputs: `folderHint` and `starting`. New outputs: `startTask` and `statusChange`. `closed` is now Back.
  - Grid padding is 20px (:82). The container query is unchanged: 3 columns (248px | 1fr | 268px) at ≥980px; stacked below that, with the file list scrolling inside a 290px box so the reader starts near the fold (prototype 760 shot).
- `components/tasks-view.component.ts`
  - New `detailOpen` computed (:425).
  - While a task is open, the view bar is hidden but stays mounted (`[class.hidden]`, :175), the status rail is not rendered (:214), and the board or list region is hidden but stays mounted (:258). Back therefore returns to the same lanes, selection, card state and drafts.
  - The detail renders full-width (:311-334). Kanban and list mode behave the same; the old list "rail + wide panel" split (`detailRail`) is removed.
  - Start in chat goes to `onStartTask` → `TaskStartService.start`, the same path as the card. Change status goes to `onStatusChange` → `store.updateStatus`, also the card's path. No new RPC.
  - `detailStarting` (:430) disables Start while that task is launching (`TaskStartService.busyTaskId`).
  - Escape on the page goes Back. This is handled in the existing host `keydown` handler (:569, :652), because a `(keydown)` binding on a div fails `interactive-supports-focus`. It is skipped for text fields, `defaultPrevented`, and dialogs/the palette.
- Parity (parity-inventory): every capability of the old panel is still reachable: metadata editor, relations (open related task), activity, run placeholder, file list, reader, open in editor, breadcrumb, status/type/stage badges. The board's Start with isolation and agent picker is still on the card and the list row; the header Start uses the default (no isolation), which is the card's plain Start.

## 2. Serious — light theme clipped the first glyph of card titles (review issue 3)

- Cause: `line-clamp-2` (`overflow:hidden`) sat on the title button together with `rounded-btn`. In the light themes `--rounded-btn` is a 2rem pill (`apps/ptah-extension-webview/tailwind.config.js:221`), so the pill's radius clipped the left edge of each text line. In dark, `--rounded-btn` is 0.375rem, which is why dark was fine.
- Fix: `board/task-card.component.ts` around :345-363. The clamp moves to an inner `<span class="line-clamp-2" data-testid="task-card-title">`, and the button uses `rounded-sm` (the focus ring is unchanged).
- The same latent pattern is fixed in `detail/task-folder-files.component.ts` (directory link with `truncate rounded-btn` → `rounded-sm`).

## 3. Moderate — reader inline code and headings (review issues 4 and 5)

`detail/task-detail.component.ts` `styles` (:104-142). These rules are scoped to `:host ::ng-deep .task-reader-body .prose`. The shared markdown lib and `styles.css` are untouched, so chat keeps its look.

- Inline code uses `word-break: normal` and `overflow-wrap: anywhere`, so it wraps at spaces and breaks inside a token only when the token alone is too wide. `box-decoration-break: clone` keeps pills boxed across lines. Colour is base-content, as in the prototype, not amber/gold.
- Fenced code keeps `overflow-x: auto` (it was already there).
- h1/h2 are plain base-content, with no gold, no rule and no `prose-heading-dot`. `.prose-heading-accented` uses `display: block`. h1 is 1.45em.

## 4. Minor (review issues 7 and 8)

- File rows (`task-folder-files.component.ts:398, :420`):
  - Every file row uses the same document glyph (no external-link icon), and directories use the chevron (prototype ▸).
  - Editor-only rows say "Opens in editor" instead of the ambiguous "Markdown" type next to other rows' "Present". The aria-label still names the type: `Open notes.txt (File) in the editor`.
- Cancelled lane at 1280: no change. In the screenshot the lanes measure 220px (x 48→268), not 242px. The real data's Cancelled lane holds tasks, so it is a full lane, and design-spec line 28 says "the terminal rail expands to a normal lane if it gains tasks". Six 220px lanes plus gutters (≈1412px) cannot fit the ≈1216px board, so the board's internal horizontal scroll is intentional. The prototype shot shows an empty Cancelled rail.

## 5. CI — initial bundle over budget (4.01 MB > 4.00 MB)

- Import chain found:
  - The tasks board itself was already lazy: `app.routes.ts:147` uses `import('@ptah-extension/tasks-ui')`, so `@defer` on the detail would not have changed the initial bundle.
  - The eager leak was `app.config.ts` → `@ptah-extension/tasks-ui/services` → `TasksStore` (registered in `MESSAGE_HANDLERS`) → `TaskFolderStore` (`task-folder.store.ts`, new in this task) plus `task-folder-entries.ts`. The new folder/document state grew the eager store past the budget.
- Fix:
  - `TasksStore` is no longer a bootstrap message handler. The eager `TasksChangedFeed` (presentation entry, already registered) gets `listenRaw(listener)` (`services/tasks-changed-feed.service.ts:51`). It relays every raw `tasks:changed` payload, in order and before validation.
  - `TasksStore` subscribes in its constructor (`tasks-store.service.ts:1103`), with release on `DestroyRef`. It drops `implements MessageHandler` and `handledMessageTypes`; `handleMessage` is kept as its internal entry.
  - `services.ts` now exports only `TaskSessionLinksService`. `app.config.ts` drops the `TasksStore` registration and import.
  - Behaviour is unchanged. The store was already surface-gated: it drops pushes while nothing is mounted, and bulk runs need the store to exist. A payload without a root still refreshes the active board.
  - `TasksStore`, `TaskFolderStore` and the folder entries now load only with the board chunk. Not measured locally; CI measures.
- Specs updated:
  - `apps/ptah-extension-webview/src/app/unit5-message-routing.spec.ts` registers the feed and asserts the raw relay.
  - `apps/ptah-electron-e2e/src/specs/tasks/message-handlers-eager.spec.ts`: header comment only. Its assertions still hold: no scan while unopened, and a refresh after opening with `payload: {}`. Not run here (no e2e allowed).

## 6. CI — degradation-audit ratchet (`tasks-ui: 5 FAIL (baseline 3)`)

`tasks-store.service.ts` catch blocks (rule in `tools/degradation-audit/check-degradation.ts:6`: a catch that reaches `return <literal>` with no throw or `.error(...)`). They are restructured so that none returns from the catch:

- `openTask` catch, :1262: guarded `if (seq === detailReqSeq) setDetailError(...)`.
- `reconcileAfterBulk` board catch, :2184-2192: sets the visible refresh error and a flag, then returns after the try.
- The detail catch, :2203: guarded `if`.

No suppression comments, no baseline change.

## Tests added or changed

- `detail/task-detail-header.component.spec.ts` (new, 10 cases): content, focus on Back, back/start/status payloads, no emit for the current status, Start gating for 4 statuses, disabled states, loading hint.
- `detail/task-detail.component.spec.ts`: full-page section with no `aside`, path, Back/Start/status reaching the host outputs; host contract updated (`folderHint`, `starting`, new emitters).
- `tasks-view.component.spec.ts` (board keyboard block): board, view bar and rail swapped for the detail with the board still mounted; Back restores; Escape goes back but not from a text field; Start and Change status route to `TaskStartService.start` and `TasksStore.updateStatus`; list mode opens the full page too (mode reset afterwards).
- `board/task-card.component.spec.ts`: clamp is on the inner span and the button has no `rounded-btn` or `line-clamp-2`.
- `detail/task-folder-files.component.spec.ts`: editor row label and aria-label.
- `services/tasks-changed-feed.service.spec.ts` (new): publish, raw relay in order including malformed payloads, other types ignored, unsubscribe.
- `services/tasks-store.service.spec.ts`: refresh via a feed relay (`payload: {}`); the store is not a message handler.

## Verification (exact results)

- `npm run verify -- -t typecheck,lint -p @ptah-extension/tasks-ui`: `2 tasks: 2 succeeded`, exit 0.
  - The first two attempts failed on Nx plugin-worker timeouts or startup, and then on one real lint error (`interactive-supports-focus` on the Escape div), which was fixed.
  - Lint warnings remain (e.g. `max-lines` elsewhere, `no-useless-assignment`); there are no errors. `tasks-view.component.ts` is 695 lines, under the 700-line limit.
- `npm run verify -- -t test -p @ptah-extension/tasks-ui`: `1 task: 1 succeeded`, exit 0; `Test Suites: 34 passed, 34 total`; `Tests: 850 passed, 850 total`.
- Because `app.config.ts` and its spec changed, two more checks ran:
  - `npm run verify -- -t test -p ptah-extension-webview -- --testPathPatterns=unit5-message-routing`: `Tests: 8 passed, 8 total`, exit 0. The first run failed one test that still expected the store's RPC; it was updated.
  - `npm run verify -- -t lint -p ptah-extension-webview`: `1 task: 1 succeeded`, exit 0 (after one plugin-worker flake).
- `node scripts/verify.mjs --exec --task degradation -- npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts | grep tasks-ui`: `libs/frontend/tasks-ui: 2 ok (baseline 3)`. The remaining 2 are pre-existing (`task-view-mode.service.ts:66`, `task-views.service.ts:528`).
- Not run: build, e2e, Electron visual review (orchestrator re-runs it), webview typecheck.

## Decisions

- **Eager store → feed relay instead of `@defer`.**
  - Options: `@defer` the detail; lazily import `TaskFolderStore` inside `TasksStore`; make `TasksStore` lazy behind the feed.
  - Evidence: the detail is already in the lazy route chunk; the eager edge is the `MESSAGE_HANDLERS` registration; the store is surface-gated, so it never needs pushes before it exists.
  - The feed relay removes the whole store from the initial graph with no behaviour change. Reversible.
- **Board kept mounted (hidden) under the detail**, rather than destroyed, so Back keeps lanes, selection and card-local state. Reversible.
- **`TaskListComponent.compact` input kept** although `tasks-view` no longer sets it: it is exported public lib API with its own spec. It can be removed in a follow-up.

## Out-of-scope observations

- `prettier --check` flags 4 untouched files that were already unformatted on HEAD: `task-folder-entries.spec.ts`, `task-folder.store.spec.ts`, `task-folder.store.ts`, `task-session-links.service.spec.ts`. Left as is.
- `eslint.config.mjs` comment on `checkDynamicDependenciesExceptions` still describes `tasks-ui/services` as carrying the store; it is comment-only and was not edited.
