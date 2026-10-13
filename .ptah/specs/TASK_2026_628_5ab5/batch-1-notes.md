# Batch 1 notes (1a streaming markdown, 1b sidebar transitions)

Status: implemented and verified (not committed; the user approves commits).

## Files changed
- MODIFIED `libs/frontend/markdown/src/lib/streaming-markdown-renderer.ts` — `render()` returns
  `{ blocks, tail }`; each completed slice is parsed once (`marked.parse(.., { async: false })`)
  and sanitized once, alone, by `sanitizeFullMarkdownHtml`; blocks append-only with ids from a
  never-reset counter; `escapeHtml` and the `<p>..<br></p>` tail HTML removed; parse/sanitize
  failure keeps the slice in the raw tail and retries next render.
- MODIFIED `libs/frontend/markdown/src/lib/streaming-markdown-renderer.spec.ts` — rewritten for
  the structured result plus the new tests below.
- MODIFIED `libs/frontend/markdown/src/index.ts` — exports `StreamingMarkdownBlock`,
  `StreamingMarkdownRender` types.
- MODIFIED `libs/frontend/chat/src/lib/components/organisms/execution/execution-node.component.ts` —
  `_streamingHtml` replaced by `_streamingBlocks` / `_streamingTail` signals; template renders a
  `ptah-markdown-root` containment wrapper, `@for (block; track block.id)` with one
  `<div class="contents" [innerHTML]="block.html">` per block, and the tail as `{{ }}` text in
  `<p class="whitespace-pre-line">`. Comment above the branch updated.
- CREATED `libs/frontend/chat/src/lib/components/organisms/execution/execution-node.streaming-dom.spec.ts`.
- MODIFIED `libs/frontend/chat/src/lib/components/templates/app-shell.component.html` — aside
  `[ngClass]="sidebarResizing() ? 'transition-none' : 'transition-[width]'"`; session row
  `transition-[color,background-color,box-shadow]`; Load More footer `transition-colors`.
- MODIFIED `libs/frontend/chat/src/lib/components/templates/app-shell.component.ts` — doc comment
  names `transition-[width]` (comment only).
- MODIFIED `libs/frontend/chat/src/lib/components/templates/app-shell.organization.spec.ts` — test
  `sidebar rows and footer do not use transition-all`.
- NOT changed: `apps/ptah-extension-webview/src/styles.css` (`aside:not(:hover) .sidebar-scroll`
  kept per user decision); no canvas files; no `content-visibility`.

## Design notes
- Security invariant: every string reaching an HTML parser is the output of one
  `sanitizeFullMarkdownHtml` call for exactly that block, inserted alone into its own host; the
  tail is a text node. Angular's DomSanitizer still runs on each `[innerHTML]` (no bypass, no
  `bypassSecurityTrust*`, no Renderer2/insertAdjacentHTML).
- Tail: leading `\n` left after a closing fence is stripped so the pre-line tail does not open
  with a blank line (fidelity only).
- Whitespace-only blocks advance the source but add no block.
- Display fences: the `ptahUiHost()` branch is untouched and precedes the incremental branch.

## Test results (all in the worktree, one at a time)
- `npx jest -c libs/frontend/markdown/jest.config.ts libs/frontend/markdown/src/lib/streaming-markdown-renderer.spec.ts --coverage=false --maxWorkers=2` — PASS 12/12
- `npx jest -c libs/frontend/chat/jest.config.ts <execution-node.streaming-dom.spec.ts> <app-shell.organization.spec.ts> <execution-node.render-throttle.spec.ts> <execution-node.ptah-ui.spec.ts> <chat-transcript.display.spec.ts> --coverage=false --maxWorkers=2` — PASS 5 suites, 75 tests
- `npx jest -c libs/frontend/chat/jest.config.ts libs/frontend/chat/src/lib/components/templates/app-shell --coverage=false --maxWorkers=2` (after the ngClass fix) — PASS 5 suites, 39 tests
- `npx nx typecheck @ptah-extension/markdown --parallel=1 --excludeTaskDependencies` — PASS
- `npx nx typecheck @ptah-extension/chat --parallel=1 --excludeTaskDependencies` — PASS
- `npx nx lint @ptah-extension/markdown --parallel=1 --excludeTaskDependencies` — PASS
- `npx nx lint @ptah-extension/chat --parallel=1 --excludeTaskDependencies` — first run FAIL
  (`[class]` next to static `class` = duplicate attribute); switched to `[ngClass]`; re-run PASS
  (0 errors, 35 pre-existing warnings, none in changed lines).

## Review fix (code-logic-review-batch-1.md, defect 1)
- Renderer: a failing boundary is retried once. On the second failure at the same slice start
  the renderer stops (`stoppedAt` = that source): it keeps its blocks, returns everything after
  them as raw tail text, and makes no further parse/sanitize calls. A source that does not
  extend `stoppedAt` (non-prefix change) resets it; settling switches to `<markdown>`.
- `StreamingMarkdownRender.failed` is true on exactly the render that stops.
- `ExecutionNodeComponent` injects `LoggingService` (`@ptah-extension/core`, the logger already
  used in chat, e.g. `lane-guards-settings.component.ts:174`) and calls
  `logger.warn('ExecutionNode', ..., { nodeId })` when `failed` is true (once per message). No
  content or error text is logged.
- Tests: renderer spec `stops incremental rendering after a boundary fails twice, and reports it
  once` (always-throwing sanitizer, 50 growing frames: sanitize <= 2 calls, `failed` once, tail
  holds all text after the last good block, blocks array unchanged); `a non-prefix change after
  a stop renders incrementally again`; transient-failure test now also asserts `failed: false`.
  Component spec `reports a stopped incremental render once through the logger`.
- Results:
  - `npx jest -c libs/frontend/markdown/jest.config.ts libs/frontend/markdown/src/lib/streaming-markdown-renderer.spec.ts --coverage=false --maxWorkers=2` — PASS 14/14
  - `npx jest -c libs/frontend/chat/jest.config.ts <execution-node.streaming-dom.spec.ts> <execution-node.render-throttle.spec.ts> <execution-node.ptah-ui.spec.ts> <chat-transcript.display.spec.ts> --coverage=false --maxWorkers=2` — PASS 4 suites, 57 tests
  - `npx nx run-many -t typecheck,lint -p @ptah-extension/markdown @ptah-extension/chat --parallel=1 --excludeTaskDependencies` — PASS

## Unverified
- Visual check of `display: contents` block hosts under `prose` (first-child margins) and of
  the `transition-[width]` aside animation: not run (no serve/build allowed).
- Angular inert-document parse per `[innerHTML]` (plan HS2c "A"): not measured; after-trace item.
- Full `nx test` for markdown/chat not run; changed and regression specs run instead.

## Decisions
- Containment root class: literal `ptah-markdown-root` (the constant is not re-exported from
  the package index; plan allows the literal).
- Session row: `transition-[color,background-color,box-shadow]` (orchestrator resolution 2).
- Aside: `[ngClass]` ternary instead of `[class.transition-[width]]` (bracketed class names do not
  parse as a `[class.x]` binding; `[class]` beside static `class` fails lint).
- Split-payload safety tests assert on parsed DOM (no `on*` attribute, no `javascript:` URL, no
  script element) rather than the plan's regex: the text `onerror=alert(1)>` legitimately
  survives as escaped paragraph text in the second half, which the regex would flag.
