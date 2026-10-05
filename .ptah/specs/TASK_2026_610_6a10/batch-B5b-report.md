# Batch B5b report — `chat-ui/ptah-ui` lazy entry, message text host, block

Task folder: `.ptah/specs/TASK_2026_610_6a10`. Batch B5b, tasks B5b.1-B5b.3 (component 9, decision 10/11; Req 2.3-2.7,
2.13, 2.17, 5.4, NFR a11y). No git commands were run.

## Files

1. CREATE `libs/frontend/chat-ui/src/ptah-ui.ts`: the lazy secondary entry.
2. MODIFY `tsconfig.base.json`: added `@ptah-extension/chat-ui/ptah-ui` → `./libs/frontend/chat-ui/src/ptah-ui.ts`,
   between the `change-set-card` and `turn-recap` aliases.
3. CREATE `libs/frontend/chat-ui/src/lib/organisms/ptah-ui/ptah-ui-message-text.component.ts` (+ `.spec.ts`)
4. CREATE `libs/frontend/chat-ui/src/lib/organisms/ptah-ui/ptah-ui-block.component.ts` (+ `.spec.ts`)

`libs/frontend/chat-ui/src/index.ts` is untouched. Nothing from the entry is in the main barrel.

## Public API (`@ptah-extension/chat-ui/ptah-ui`)

```ts
export type PtahUiBlockPipeline = typeof renderPtahUiBlock;
export const PTAH_UI_BLOCK_PIPELINE: InjectionToken<PtahUiBlockPipeline>; // providedIn 'root', factory () => renderPtahUiBlock

@Component({ selector: 'ptah-ui-message-text' }) // standalone, OnPush
export class PtahUiMessageTextComponent {
  text: InputSignal<string>;            // required: raw node text (renderedContent())
  messageId: InputSignal<string>;       // required
  nodeId: InputSignal<string>;          // required
  orderKey: InputSignal<number>;        // required: transcript order, higher = newer
  active: InputSignal<boolean>;         // default true; forwarded to surfaceMarkdown
  snapshot: InputSignal<TurnSourceSnapshot | null>; // default null
}

@Component({ selector: 'ptah-ui-block' }) // standalone, OnPush
export class PtahUiBlockComponent {
  raw, body: InputSignal<string>;       // required: whole fence / lines between the fence lines
  ordinal: InputSignal<number>;         // required
  messageId, nodeId: InputSignal<string>; orderKey: InputSignal<number>; // required
  active: InputSignal<boolean>;         // default true
  snapshot: InputSignal<TurnSourceSnapshot | null>; // default null
}
```

- Message text: `@for (part of parts(); track part.track)`. The tracks are `md:<n>`, where n is the index of the
  markdown part, and `ui:<ordinal>`. Markdown parts render as `<markdown [data]="part.text | surfaceMarkdown: active()" />`,
  the same element and pipe as `execution-node.component.ts:136-138`. Segmentation is `segmentPtahUi` (shared,
  unchanged). An unclosed fence stays in the trailing markdown part.
- Block:
  - surface id: `ptah-ui-<nodeId with [^A-Za-z0-9._-] → '-'>-<ordinal>`, truncated to
    `SURFACE_LIMITS.maxSurfaceIdLength` (128);
  - live-window key: `<messageId>:<nodeId>:<ordinal>`;
  - pipeline call: `pipeline(body, { surfaceId, snapshot, countBytes: utf8JsonBytes })`;
  - a pipeline that throws produces `internal error`.
- OK path: `<ptah-surface-renderer [renderable] [interaction]="READ_ONLY_INTERACTION" (renderFailed)="markRenderFailed()" />`.
  That interaction has `submitDisabled: true`, no selection and empty maps.
  - **Only the `void` `renderFailed` output is bound** (orchestrator decision). `actionInvoke`, `inputCommit`,
    `selectionChange` and `viewStateChange` stay unbound.
  - When `renderFailed` fires, the block switches to the code-block fallback with the reason "could not display".
- Failure path: `<markdown [data]="raw() | surfaceMarkdown: active()" [attr.aria-describedby]="reasonId()" />`, followed by
  `<p data-ptah-ui-reason class="text-xs text-base-content-muted" [id]="reasonId()">Not rendered: {{ reason() }}</p>`.
  The reason is interpolated as text, never HTML.

## Live-cap invariant: how it is enforced

The block registers in `ngOnInit` with the injected tab-scoped `PtahUiLiveWindow` and releases on `DestroyRef`. A view
`effect` watches the live signal. The first time it reads `false`, `freeze()` runs. A block that is remounted outside
the newest 8 freezes directly in `ngOnInit`. `freeze()` is one-way for the instance and does four things:

1. **Frozen renderable.** It captures the current pipeline result into `frozen`. The `result` computed returns `frozen`
   before it reads any input, so `body`/`snapshot` stop being dependencies. That gives zero source reads and zero
   pipeline runs afterwards.
2. **Inert subtree.** The renderer wrapper gets `inert=""` and `data-ptah-ui-mode="snapshot"`, so no control is
   focusable or enabled.
3. **Hidden text alternative.** A `<p class="sr-only">` outside the inert wrapper holds `renderSurfaceText(...)` of the
   frozen content. The `surface … revision …` footer and blank lines are dropped. Inert content is hidden from
   assistive technology, so this alternative is what screen readers get, and charts keep their points.
4. **Detached change detection.** `afterNextRender(() => cdr.detach())` runs after the snapshot markup has rendered
   once. Nothing ever calls `reattach`. A snapshot is not promoted even if the window later has room again, which
   satisfies Req 5.4 ("a remount does not promote a snapshot"). Only a new instance inside the newest 8 is live.

No timers, observers or polls are used. `afterNextRender` is a one-shot render hook.

## A-5 resolved: copy reads node text, not the DOM

- `libs/frontend/chat-ui/src/lib/atoms/copy-button.component.ts:62-71`. `copyMessage()` builds the clipboard text from
  `msg.streamingState` via `extractTextFromNode` (`:66`), or from `msg.rawContent` (`:68`), then calls
  `clipboard.copy(content)` (`:76`).
- `extractTextFromNode` (`:91-101`) concatenates `node.content` of the text and message nodes (`:94`).
- The only mount is `message-bubble.component.html:152` (`<ptah-copy-button [message]="message()" />`).
- No per-code-block copy action exists. There is no `clipboard` usage in `libs/frontend/markdown` and no ngx-markdown
  clipboard plugin anywhere in `libs/frontend`.
- The reason line, which is DOM-only, therefore never reaches a copy, and the stored message keeps the raw fence
  (Req 2.5, 2.13).
- The spec also pins that the reason line sits outside `<code>` and `<markdown>`, and that the markdown text excludes
  it.

## Tests

`npx nx run-many -t typecheck,test,lint -p @ptah-extension/chat-ui --parallel=1 --skip-nx-cache` →
"Successfully ran targets typecheck, test, lint". This was re-run after the `renderFailed` change. chat-ui totals:
**Test Suites 45 passed; Tests 479 passed**. Direct
`npx eslint` of the new files reports zero problems, exit 0. Lint accepts the `chat-ui` (`type:feature`, `scope:webview`)
→ `declarative-dashboard` (`type:ui`, `scope:webview`) edge (`eslint.config.mjs:264-266, 365-372`).

- `ptah-ui-block.component.spec.ts`, 22 tests:
  - a valid block renders via the renderer with `submitDisabled`;
  - a template scan shows the only event binding on `<ptah-surface-renderer>` is `(renderFailed)`;
  - on the mounted renderer, `renderFailed` has 1 listener, and `actionInvoke`, `inputCommit`, `selectionChange` and
    `viewStateChange` have 0;
  - a `SURFACE_VIEW_MODEL_BUILDER` override makes the renderer emit `renderFailed`. The block then shows fallback HTML
    identical to a plain fence and "Not rendered: could not display" outside `code`/`markdown`, with matching
    `aria-describedby`;
  - fallback `markdown.innerHTML` equals a plain `<markdown [data]="raw">` render, and the reason sits outside
    `code`/`markdown` with matching `aria-describedby`;
  - a throwing pipeline stub produces "Not rendered: internal error";
  - a snapshot-input change updates a live block in place;
  - live controls are natural tab stops (no positive tabindex, no trap);
  - charts have an accessible name;
  - axe: 6 states × 2 themes;
  - **instrumented live cap**. Twelve blocks are inserted one by one under one window, with `liveCount() <= 8` after
    each insertion. Blocks 1-4 are snapshots: `detach` is called once, there is an `inert` ancestor of the renderer
    and of every control, and the text alternative is present. Blocks 5-12 are live and `detach` is never called on
    them. After a snapshot change, the pipeline-run delta is 0 for blocks 1-4 and 1 for blocks 5-12. The test then
    destroys and recreates blocks 1, 6 and 12, with `liveCount() <= 8` after each step. Block 1 stays a snapshot,
    6 and 12 stay live, and `reattach` is never called.
- `ptah-ui-message-text.component.spec.ts`, 7 tests:
  - plain text produces `md:0`;
  - an open fence stays code, and closing it mounts one block (`md:0, ui:0`);
  - a fence unclosed at turn end stays code with no reason line;
  - two blocks are tracked as `md:0, ui:0, md:1, ui:1, md:2`;
  - **50 chunks plus an activity toggle plus a snapshot change produce 1 registration (1 instance)**, with the same
    block and renderer instance;
  - markdown is held while inactive (`surfaceMarkdown`);
  - agent HTML imitating `ptah-ui-block` / `data-ptah-ui-reason` mounts nothing.

## Axe results

`axe-core` was run on the block host for the states live (title, stats, table, list, bar chart), pending, unavailable,
empty (`$diff`/`$tests`/`$usage` table, list, stats plus a line chart), fallback-with-reason and snapshot. Each state
was run in `data-theme="light"` and `data-theme="dark"`. Result: **0 serious or critical violations in all 12 runs**.

`color-contrast` and `target-size` are disabled, as in `turn-tests-row.component.spec.ts`, because jsdom computes no
layout or colour. Contrast in both themes must be checked in the running Electron app (visual review).

## Deviations

1. **Token location (accepted by the orchestrator).** `PTAH_UI_BLOCK_PIPELINE` (and the `PtahUiBlockPipeline` type)
   is declared in `ptah-ui-block.component.ts` and re-exported from `ptah-ui.ts`. Declaring it in the entry file would
   create an import cycle: entry → block → entry. The public path is unchanged (`@ptah-extension/chat-ui/ptah-ui`).
2. **`renderFailed` (resolved by the orchestrator).** Only the `void` `renderFailed` output is bound. It sets a
   one-way `rendererFailed` flag that switches the block to the fallback with "could not display", as the plan says.
   Every interaction output stays unbound.
3. **Snapshot-to-live promotion is never done per instance.** This is by design: the test requires `reattach` never to
   be called. If newer blocks are released (render window) and an older snapshot instance becomes "live" in the
   window, it stays a snapshot until it remounts. The window's `liveCount()` can then count a key whose instance is
   frozen, so actual live instances are ≤ `liveCount()` ≤ 8.
4. The fallback `<markdown>` uses `raw() | surfaceMarkdown: active()`, not the plan's bare `[data]="raw"`. This keeps
   the fallback on the same pipe as every other text in the node. The HTML equality spec compares against a bare
   `<markdown [data]>` render.

## Notes for B6

- The transcript (or the bubble/execution-node owner) must **provide `PtahUiLiveWindow`** in the tab-scoped injector.
  The block injects it as required, so a missing provider fails inside `@defer` and lands in `@error`, which renders
  markdown.
- The message text host renders inside the execution node's `prose` wrapper. Prose typography will apply to the
  renderer's `h2`, table and list. The visual review should check this.
