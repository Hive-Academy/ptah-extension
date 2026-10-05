# Batch B6 report — execution-node and bubble wiring with the Electron gate

Task folder: `.ptah/specs/TASK_2026_610_6a10`. Batch B6, tasks B6.1-B6.3 (component 10; Req 2.1, 2.4, 2.9, 2.10, 5.2;
VS Code fence stays code [user]). No git commands that change state were run. No `chat-ui` file was touched.

## Files

All paths are under `libs/frontend/chat/src/lib/components/organisms/`.

1. CREATE `execution/ptah-ui-fence-line.ts`. `hasPtahUiFenceLine(text)` has zero imports. It is an `indexOf` scan for
   ```` ```ptah-ui ```` at column 0, followed only by spaces, an optional `\r`, and then `\n` or the end of the text.
   This is exactly the opener `segmentPtahUi` accepts (`ptah-ui-fence.ts:31`, `removeTrailingSpaces`, `readLines`).
2. MODIFY `execution/execution-node.component.ts`:
   - `PtahUiNodeContext { messageId; orderKey }` and `samePtahUiContext` (`:50-69`);
   - the lazy import (`:21-24`) and the `imports` entry (`:142-143`);
   - the `@else if (ptahUiHost(); as host)` branch with `@defer (on immediate)`, `@placeholder` and `@error`
     (`:158-185`);
   - the `[ptahUi]` forward in `@case ('message')` only (`:320`);
   - the input `ptahUi` (`:410`), default `null`;
   - the computed `ptahUiHost` (`:506-513`).
3. MODIFY `message-bubble.component.ts`:
   - the input `ptahUiOrderKey` (`:138`), default `0`;
   - the computed `ptahUiContext` (`:177-185`). It is `null` unless `vscode.isElectron` is true **and**
     `role === 'assistant'`.
4. MODIFY `message-bubble.component.html:109`. It binds `[ptahUi]="ptahUiContext()"` on the top-level
   `<ptah-execution-node>`.
5. MODIFY `transcript/chat-transcript.component.ts:37, :164-166`. It sets `providers: [TranscriptRenderWindow, PtahUiLiveWindow]`.
   **This file is not in the B6 list.** See Deviations.
6. CREATE `execution/execution-node.ptah-ui.spec.ts` (27 tests).

## Where the live window is provided, and why

It is provided in `ChatTranscriptComponent.providers` (`chat-transcript.component.ts:166`), next to `TranscriptRenderWindow`.

- **One transcript per tab.** `tabId` is a required input, and hidden tabs keep their transcript via `[class.hidden]`.
  The component's own injector is therefore the per-tab scope.
- **The bubble and the execution node are the wrong scope.** The bubble is per message and the node is per node. A
  provider there would give every message its own window, so the 8-live cap would apply per message instead of per
  tab (L-5, decision 10).
- **Root is also wrong.** `providedIn: 'root'` would make every tab share one window, which the class doc rules out.
- **Every block resolves the window through the transcript.** The bubble is the only consumer that passes a non-null
  context, and it is mounted only by `chat-transcript.component.html:50`. Other `ptah-execution-node` hosts
  (harness builder, setup wizard, mcp-apps, agent cards) never pass `ptahUi`, so they never reach the block.

## TASK_2026_532 defects 1-6 (review-lane-b.md): how each is avoided

The 532 defects are all ways that HTML which had passed the `'full'` sanitizer escaped containment. B6 adds no HTML
marker, changes no sanitizer setting and never decides a mount from HTML. The block mounts only by Angular control flow
over raw text: `ptahUiHost` (`execution-node.component.ts:506-513`) feeds `@else if` (`:158`), and `segmentPtahUi`
runs inside the lazy host. `provide-markdown-rendering.ts` is untouched.

1. **CSS comment and escape bypass.** No style is read or produced to decide a mount. Agent `style` content stays
   under the unchanged sanitizer. Pinned by the spec "does not mount a block from forged HTML".
2. **App classes recreate overlays.** No class is used as a marker. The block's own markup (`data-ptah-ui-*`,
   `ptah-ui-*` tags) comes from Angular templates, never from markdown HTML. The forged-HTML spec puts
   `<ptah-ui-block>`, `<ptah-ui-message-text>`, `<ptah-surface-renderer>`, `data-ptah-ui-reason` and
   `data-ptah-ui-mode` in the text and asserts zero blocks, zero hosts, zero renderers and zero deferred blocks. Any
   surviving `data-ptah-ui-*` element is only inert HTML inside `<markdown>`.
3. **`popover` fixed positioning.** No attribute is consulted. Forbidden attributes are unchanged.
4. **Geometry escape from an unclipped host.** The block renders inside the existing `prose` wrapper and adds no
   wrapper styles. The markdown parts keep the `ptah-markdown-root` containment (visible in the spec HTML).
5. **Tests covered token filtering, not the contract.** The B6 spec tests the mount contract itself, on real
   `ngx-markdown` with the app's `provideMarkdownRendering({ extensions: 'full' })`:
   - forged tags and attributes mount nothing;
   - a forged tag beside a real fence mounts exactly one block;
   - ```` ```ptah-ui-x ```` and indented fences load nothing;
   - `hasPtahUiFenceLine` rejects HTML that contains the opener inside an attribute.
6. **Prefix matches.** The opener check is exact: line start, the literal ```` ```ptah-ui ````, then only spaces up to
   the line end. The `ptah-ui-x`, `ptah-ui x`, `text ```ptah-ui` and indented cases are pinned in the
   `hasPtahUiFenceLine` table.

## VS Code: how the identical-output check is done

The test is "renders %s identical to the template without the feature", run for a valid, an invalid and an open fence.

- **Baseline ("feature absent").** `templateWithoutPtahUi()` reads `execution-node.component.ts` from disk and cuts
  out the two B6 additions: the `} @else if (ptahUiHost(); as host) {…}` branch and `[ptahUi]="ptahUi()"`.
  - It throws if either addition is not found exactly once.
  - Ignoring HTML comments and whitespace, the cut template equals the `HEAD` template. This was checked once during
    the batch.
  - The baseline is applied with `TestBed.overrideComponent(ExecutionNodeComponent, { set: { template } })`.
- **Render.** The same `ExecutionChatMessage` object (so the timestamp matches) is rendered through the real
  `MessageBubbleComponent` with `isElectron=false`, once with the shipped template and once with the baseline. Both
  renders use real markdown.
- **Assertions.**
  1. Every `.exec-text-branch` `outerHTML` is **byte-identical, comments included**. The only normalisation is the
     encapsulation id (`_ngcontent-*`/`_nghost-*`), which comes from the template hash.
  2. The whole bubble `innerHTML` is byte-identical after removing Angular's empty `<!--container-->` anchors. The
     third branch adds exactly one such anchor per text node. Angular declares one anchor per control-flow branch
     template, so no template-level branch can avoid it. Anchors are never rendered, are not in the accessibility
     tree, are not in `textContent` and are not copied. The chat jest config already drops comments in snapshots
     (`html-comment` serializer).
  3. There is no `data-ptah-ui-*`, no `<ptah-ui-*` and no `<ptah-surface-renderer`, and the output contains
     `language-ptah-ui`.
- **A second VS Code test.** It asserts:
  - every execution node has `ptahUi() === null`;
  - `hasPtahUiFenceLine` is **never called** (spy), so the text is never scanned;
  - `getDeferBlocks()` is empty;
  - the fence is an ordinary `<code>` with no reason line.

## Spec coverage (`execution-node.ptah-ui.spec.ts`)

- **Electron, valid fence through the real bubble:** one host and one block, a live renderer, intro and outro markdown
  in place, no reason line, and `messageId`/`nodeId` forwarded.
- **Electron, invalid fence:** the code fallback plus `Not rendered: …` outside `code`/`markdown`.
- **Scope on Electron:** each of these stays ordinary code with zero deferred blocks:
  - user message;
  - subagent text (through the real `nodeTemplate` recursion);
  - generic-tool-nested text;
  - SendMessage-nested text;
  - thinking.
- **Forged HTML and wrong fences:** forged HTML mounts nothing; real fence plus forged HTML mounts 1; `ptah-ui-x` and
  indented fences render as code.
- **Chunk states (`DeferBlockBehavior.Manual`):** `@error` (chunk-load failure) and `@placeholder` both render
  markdown whose `innerHTML` equals the plain no-context render. No host, no block, no reason line.
- **Streaming:** an open fence stays code with no reason line, and closing it mounts exactly one block.

## Verification

`npx nx run-many -t typecheck,test,lint -p @ptah-extension/chat --parallel=1` gives "Successfully ran targets typecheck,
test, lint" with 0/3 cache hits. Chat totals: **Test Suites 163 passed; Tests 2992 passed, 2 skipped (2994)**. The new
spec has 27 tests. Running `npx eslint` directly on the changed files gives exit 0.

- **First run, cold transform cache.** `electron-shell.review-dock.spec.ts` timed out in its first `beforeEach`
  (5 s). It passes warm with the default timeout (19 s suite), and also passed in the full run above.
- **Cause.** Jest compiles in JIT, so the static import of `@ptah-extension/chat-ui/ptah-ui` in the execution node is
  loaded eagerly in tests. AOT moves it into the `@defer` chunk; JIT has no such split. Every spec that reaches the
  execution node now loads the ptah-ui graph the first time.
- **Risk.** This is a cold-cache CI timing risk only. Production is unaffected.

No production build was run, so the AOT template type-check of `@else if (…; as host)` and the lazy-chunk split are
not verified here. JIT accepts the syntax.

## Deviations

1. **`chat-transcript.component.ts` was edited (2 lines: the import and `providers`).** It is outside the B6 list and
   is B7.1's file. The orchestrator made the per-tab provider a hard requirement, and no B6 file has tab scope.
   Without the provider every Electron block injection fails and lands in `@error` markdown. **B7.1 should now only
   add `[ptahUiOrderKey]`** and its spec, and must not add the provider again.
2. **`ptahUiOrderKey` defaults to `0`** until B7.1 passes it. With equal keys the live window ranks by registration
   order, so later blocks win.
3. **`PtahUiNodeContext` has no `snapshot` field.** The plan's `{ messageId; orderKey; snapshot }` snapshot is PR C.
   C adds the field and the `ptahUiSnapshot` input.
4. **No fade class on the ptah-ui wrapper.** That branch is entered mid-stream when the opener arrives, and replaying
   `exec-fade-in` would flash the whole text.
5. **The spec counts scans with `jest.spyOn`, not `jest.mock`.** This preset does not hoist `jest.mock`, so a module
   mock of the fence-line file did not take effect.
