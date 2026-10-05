# Canvas tile rendering-cost lane report

## Files changed

- `libs/frontend/markdown/src/lib/provide-markdown-rendering.ts`
- `libs/frontend/markdown/src/lib/provide-markdown-rendering.spec.ts`
- `libs/frontend/canvas/src/lib/canvas-tile.component.ts`
- `libs/frontend/canvas/src/lib/canvas-tile.component.spec.ts`
- `libs/frontend/chat-ui/src/lib/molecules/agent-card/agent-card-output.component.ts`
- `libs/frontend/chat-ui/src/lib/molecules/agent-card/agent-card-output.component.spec.ts`

## Changes

1. Markdown containment — `provide-markdown-rendering.ts:210-240`
   - Preserved `contain: layout paint`, so the sanitizer-owned root remains the containing block and paint clip for hostile fixed/absolute content.
   - Removed `isolation: isolate` and wrapper `overflow-x: auto`; ordinary markdown roots no longer create a scroll container or isolation stacking context.
   - Added local horizontal scrolling only to `pre` elements and a generated wrapper around `table` elements, both capped at `max-width: 100%`. Existing word wrapping is untouched.
   - `provide-markdown-rendering.spec.ts:86-100, 383-414` asserts the reduced root style and local code/table scrollers.

2. Tile containment — `canvas-tile.component.ts:393-403`
   - Added `contain: style` to `.tile-content`; it bounds style invalidation without establishing a containing block or paint clip.
   - `canvas-tile.component.spec.ts:1117-1126` confirms layout and paint containment are deliberately absent.

   Overlay audit:

   | Overlay | Positioning mechanism | Safe with tile containment? |
   | --- | --- | --- |
   | Tile layout menu `NativePopoverComponent` | Floating UI assigns the panel `position: fixed`; its optional backdrop is also fixed. It is in the header, outside `.tile-content`. | Yes. |
   | Chat-input attachment `NativePopoverComponent` | Floating UI fixed panel/backdrop in the contained chat subtree. | Yes: `contain: style` neither changes its fixed containing block nor clips paint. |
   | Model and effort selectors | Chat-input descendants; their dropdown controls remain local/Floating UI overlays. | Yes for the same reason; no layout/paint containment was applied. |
   | Slash/@ unified suggestions | `UnifiedSuggestionsDropdownComponent` uses Floating UI with an absolute floating panel relative to the textarea origin. | Yes: style containment does not affect absolute positioning or overflow. |
   | Chat context menus and Floating UI tooltips | Fixed/absolute Floating UI descendants where present. | Yes: style-only containment preserves their positioning and paint escape. |

3. Agent output — `agent-card-output.component.ts:50-301`
   - Replaced `track $index` with object-identity tracking (`track segment`), retaining DOM nodes when front-trimmed streaming arrays retain their segment objects. `RenderSegment` has no segment id and is outside this lane's allowed files, so no model change was made.
   - Added per-segment `content-visibility: auto; contain-intrinsic-size: auto 80px`. The agent lane scroll directive observes content height and pins a reader at the bottom; the component's existing bottom-scroll also uses `scrollHeight`, so this preserves bottom-follow behavior when segments enter the viewport.
   - `agent-card-output.component.spec.ts:30-71` verifies retained nodes after front trimming and the intrinsic-size visibility style.

## Visual risks for review

- Wide code blocks and tables must scroll horizontally inside the tile without an outer markdown scrollbar.
- Sanitized positioned content must remain clipped to its markdown block.
- Chat-input menus, model/effort dropdowns, slash/@ suggestions, tooltips, and context menus must still escape the chat body correctly.
- Long agent streams must retain bottom-follow scrolling; off-screen segments may reserve approximately 80px until rendered.

## Verification

- `npx nx run-many -t test -p markdown canvas chat-ui --skip-nx-cache 2>&1 | tail -40`: failed overall — markdown succeeded; canvas had 8 passing suites and 1 failing suite (29 failed / 208 passed tests) because existing `OrchestraCanvasComponent` test mocks omit `tabManager.onTabClosed`; chat-ui initially exposed the new style assertion and was fixed below.
- `npx nx test chat-ui --skip-nx-cache --output-style=static`: passed, 41 suites / 440 tests.
- `npx nx run-many -t lint -p markdown canvas chat-ui 2>&1 | tail -20`: passed, all 3 projects (one cache hit). Nx Cloud reported its organization is disabled, but lint completed locally.
- Scoped TypeScript diagnostics were unavailable after 45 seconds twice; the checker reported it continued in the background without returning results.

## Open Items

- Canvas project tests remain blocked by the pre-existing `OrchestraCanvasComponent` mock failure (`this.tabManager.onTabClosed is not a function`); this lane did not modify that out-of-scope test or production component.

## Revision 1

- `libs/frontend/chat-ui/src/lib/molecules/agent-card/agent-card-output.component.ts:25-46, 73-74, 352-366`: replaced object-identity iteration tracking with content-derived FNV-1a keys over every `RenderSegment` rendering field. Duplicate static segments receive occurrence suffixes; the final segment uses `tail:<type>`, retaining its DOM node while stdout grows. The existing `content-visibility` wrapper remains unchanged.
- `libs/frontend/chat-ui/src/lib/molecules/agent-card/agent-card-output.component.spec.ts:44-76`: replaced the identity-based trim test with a reparse-shaped update using fresh segment objects, a front trim, two identical segments, and a grown text tail. It asserts all unchanged wrapper element references are retained and that duplicate keys do not throw.

Verification:

- `ptah_get_diagnostics` for the two revised files: 0 errors, 0 warnings. The workspace has 8 pre-existing sibling diagnostics, none in the revised files.
- `npx nx test chat-ui --skip-nx-cache 2>&1 | tail -15`: started but produced no result/status through the available runner before its handle was lost; pass/fail count unavailable.
- `npx nx lint chat-ui 2>&1 | tail -10`: produced no output or pass/fail count after 120 seconds and was interrupted (exit 1) rather than rerun; result unavailable.

## Revision 2

1. Markdown containment
   - `libs/frontend/markdown/src/lib/provide-markdown-rendering.ts:223-225`: removed the post-sanitization `<template>` parse/serialize and DOM mutations. The sanitizer result is now inserted only through the original plain string wrapper with `contain: layout paint;`.
   - `apps/ptah-extension-webview/src/styles.css:958-962`: added root-scoped horizontal overflow rules for `pre` and `table`. This is the webview's shipped global markdown stylesheet, alongside the existing `.prose` styling. Tables retain `display: table` and their current column-sizing behavior; this avoids the layout trade-off of `display: block` while allowing overflow handling on the table itself.
   - `libs/frontend/markdown/src/lib/provide-markdown-rendering.spec.ts:395-402`: asserts the exact plain wrapper string around the sanitizer output, with no extra content DOM.

2. Agent output
   - `libs/frontend/chat-ui/src/lib/molecules/agent-card/agent-card-output.component.ts:30-32, 61-62, 332-345`: removed the content-visibility wrapper and restored direct segment rendering. Static keys use type, content length, a 48-character content prefix, optional `toolCallId`, and a duplicate occurrence suffix; the final segment remains `tail:<type>`.
   - `libs/frontend/chat-ui/src/lib/molecules/agent-card/agent-card-output.component.spec.ts:44-77`: retains the production-shaped fresh-object/front-trim/duplicate/growing-tail test, snapshots nodes before update, and waits for asynchronous markdown rendering before checking the grown tail.

3. Canvas tile
   - `libs/frontend/canvas/src/lib/canvas-tile.component.ts:395`: removed `contain: style` from `.tile-content` without changing the SURFACE_ACTIVE provider behavior.
   - `libs/frontend/canvas/src/lib/canvas-tile.component.spec.ts`: removed the containment-only assertion; the adjacent rendering catch-up coverage remains.

Verification:

- `npx jest -c libs/frontend/markdown/jest.config.ts --silent 2>&1 | tail -6`: passed — 6/6 suites, 196/196 tests (Jest reported a worker forced-exit teardown warning after completion).
- `npx jest -c libs/frontend/chat-ui/jest.config.ts agent-card-output --silent 2>&1 | tail -6`: passed — 1/1 suite, 3/3 tests.
- `npx jest -c libs/frontend/canvas/jest.config.ts canvas-tile --silent 2>&1 | tail -6`: failed — 8/9 suites and 235/237 tests passed; the runner also reported a worker forced-exit teardown warning.
- Focused TypeScript diagnostics remained unavailable after 45 seconds; no result was returned for the six requested files.
