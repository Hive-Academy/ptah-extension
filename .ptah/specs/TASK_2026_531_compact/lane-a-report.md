# Lane A Report: Compact Session View Elevation Pass (TASK_2026_531)

## Files Changed
- **CREATED** `libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-plain-text.ts` — Pure, unit-tested markdown-to-plain-text stripper for feed row labels and detail lines.
- **CREATED** `libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-plain-text.spec.ts` — 10 unit test cases verifying markdown removal across headings, code ticks, tables, emphasis, links, images, blockquotes, bullets, and whitespace collapsing.
- **MODIFIED** `libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-session-activity.component.ts` — Implemented G1 markdown rendering, G2 height/width size-adaptive layout, and G3 variant-4 wire console prototype parity (filter chips, tone badges, blinking cursor, terminal prompt footer, agent context box).
- **MODIFIED** `libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-session-activity.component.spec.ts` — Expanded test suite covering markdown rendering, plain text question handling, unbudgeted feed rendering, filter chips with `aria-pressed`, live cursors, and terminal prompt footer.
- **MODIFIED** `libs/frontend/chat-ui/src/index.ts` — Exported `FeedFilter` and `stripMarkdownToPlainText` from `@ptah-extension/chat-ui` barrel.

## Design Decisions
1. **Recap Markdown Rendering (G1)**:
   - Integrated `MarkdownBlockComponent` from `@ptah-extension/markdown` for recap content (`summary().content.text`) for `prose`, `result`, and `error` content kinds.
   - Maintained plain text paragraphs for interactive question/permission prompts and idle states.
   - Scoped compact typography via `:host ::ng-deep .cs-recap-md`: downscaled headings (`font-size: 0.8125rem` bold), tight margins (`0.25rem 0`), bounded code blocks (`max-height: 120px` with auto-overflow), horizontally scrolling tables with borders, and daisyUI token colors.
   - Provided `provideMarkdown()` locally in `CompactSessionActivityComponent` providers to safeguard standalone rendering in isolated environments and parent spec harnesses.
2. **Plain-Text Feed Sanitization (G1)**:
   - Created pure helper `stripMarkdownToPlainText` to strip headings, bold/italic markers, inline/fenced code ticks, markdown link syntax `[t](u) -> t`, image syntax `![alt](u) -> alt`, table separator rows, pipes (`| -> space`), blockquotes, and list bullets, collapsing into a single whitespace-trimmed line.
3. **Size-Adaptive Layout (G2)**:
   - Removed fixed `ROW_BUDGET` truncation: the feed renders all marks chronologically (newest last) inside an auto-scrolling container.
   - Pinned the feed to newest marks using `afterRenderEffect` and `viewChild`, pausing auto-scroll when user scrolls up (`distanceToBottom > 20px`).
   - Replaced fixed `line-clamp` on recap with a flexible `cs-recap-scroll` pane with bottom fade mask (`mask-image`), keeping the agent context box and full-view action pinned at the bottom.
   - Responsive column split: `grid-template-columns: minmax(240px, clamp(240px, 34%, 420px)) 1fr`.
   - Maintained `tier` input for backward compatibility without coupling layout directly to it.
4. **Variant-4 Wire Console Prototype Parity (G3)**:
   - **Status Row**: Status dot with box-shadow glow, icon, status text, dual-coded tone badge (glyph + short uppercase word: `▶ RUN`, `✓ DONE`, `▲ WARN`, `✖ ERR`, `○ IDLE`), and right-aligned workspace label. Prevented 3x repetition of finished status text.
   - **Recap Pane**: Title header `ASSISTANT RECAP` with outcome tag (`FINISHED`, `ACTIVE`, `FAILED`, `ATTENTION`, `IDLE`). Agent context box displaying active agent (`activeAgentName`) and phase with tone coloring.
   - **Feed Rows**: Monospace timestamp gutter (`w-[50px]`), dual-coded kind badges, plain text detail lines, tone-colored left borders, and blinking cursor on newest live row (with `@media (prefers-reduced-motion: reduce)` support).
   - **Filter Chips**: Signal-driven local filtering with `ALL (n)`, `ERR (n)`, `WARN (n)` buttons and accessible `aria-pressed`.
   - **Terminal Prompt Footer**: Styled CRT terminal prompt (`ptah:<workspaceLabel>$ <status>`) with live cursor and total event count.

## Container Query Breakpoints
The body host element uses `container-type: size`:
- `@container (max-width: 600px)`: Switches dual-pane grid to single-column vertical stack (`grid-template-columns: 1fr; grid-template-rows: auto minmax(0, 1fr)`), capping the recap pane to `max-height: 45%` so feed remains visible.
- `@container (min-height: 300px)`: Progressively reveals the `.cs-agent-context` box in the recap pane and switches the feed header counter to `.cs-filter-chips`.
- `@container (min-height: 500px)`: Progressively reveals the `.cs-terminal-footer` at the bottom of the feed pane.

## Verification Results
- **Unit Tests (`chat-ui`)**:
  `npx nx test chat-ui --testPathPattern=compact-session`
  **Result**: 30 / 30 test suites passed, 240 / 240 tests passed (0 failed).
- **Integration Tests (`chat`)**:
  `npx nx test chat --testFile=compact-session-card.component.spec.ts`
  **Result**: 1 / 1 test suite passed, 10 / 10 tests passed (0 failed).
- **Linter (`chat-ui`)**:
  `npx nx lint chat-ui`
  **Result**: 0 errors (4 preexisting warnings on unrelated files).
- **Typecheck (`chat-ui`)**:
  `npx tsc -p libs/frontend/chat-ui/tsconfig.lib.json --noEmit`
  **Result**: Exited with code 0 (no type errors).

## Out-of-Scope / Not Done
- Lane B (`libs/frontend/canvas/src/lib/canvas-tile.component.ts` layout menu / Goal G4) is owned by a concurrent agent lane and was left untouched.
- `libs/frontend/canvas` was strictly untouched.
