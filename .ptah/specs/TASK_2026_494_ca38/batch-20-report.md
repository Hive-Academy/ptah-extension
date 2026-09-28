# Batch 20 report: Apps page splitter (Task 20.1)

Executor: frontend-developer. Nothing staged or committed. B16's files were not touched.

## Files

| Change | Path (under `libs/frontend/`) | Lines |
| --- | --- | --- |
| MODIFIED | `core/src/lib/services/electron-layout.service.ts` | 822 (was 788; +34) |
| MODIFIED | `core/src/lib/services/electron-layout.service.spec.ts` | +116 |
| MODIFIED | `mcp-apps-page/src/lib/components/apps-page.component.ts` | 434 |
| CREATED | `mcp-apps-page/src/lib/components/apps-page-splitter.spec.ts` | 374 (11 tests) |

`apps-page.component.spec.ts` was left alone (693 lines), as the B15 note asked.

## Requirements

| Requirement | What was done |
| --- | --- |
| Reuse `ptah-electron-resize-handle`, no fork | The page imports `ElectronResizeHandleComponent` from `@ptah-extension/chat-ui` (`apps-page.component.ts:12,65`) and puts it inside the B15 slot `apps-split-handle-slot` (`:245-270`). Boundary check: both libs are `type:feature`/`scope:webview`. `eslint.config.mjs` allows type:feature -> type:feature, and scope:webview -> scope:webview. Lint is green, and no eslint config was changed. |
| Subtract the container's left edge | `onSplitDragMoved` (`:346-349`) computes `pointerX - host.getBoundingClientRect().left - dragGrabOffset`. The host is the `apps-page` container. `dragGrabOffset` (`:337-343`) is taken from the bubbling `mousedown` and is the distance into the 6px handle. This stops the column jumping by the grab point, and it makes the handle's restore exact (see Escape). |
| Clamp, and reject non-finite | Service (`electron-layout.service.ts:215-220`): rejects any non-finite value, then clamps to [240, 1200]. Page (`apps-page.component.ts:299-306, 377-384`): max = `containerWidth - 6 - 360`, never below 240. `applySplitWidth` also rejects non-finite values. The width that is laid out is `min(stored, max)` (`:308-310`), so a window shrink never squeezes the surface. It also does not rewrite the saved preference. |
| Escape/blur restore still works | The handle is unchanged. On Escape or blur it re-emits the mousedown X, then `dragEnded`. Because of the grab offset this maps back to the exact starting width, which is then committed. Pinned in the splitter spec at `:284`. |
| Keyboard | The slot is the focusable separator: `role="separator"`, `tabindex="0"`, `aria-orientation="vertical"`, `aria-label="Resize the conversation column"`, `aria-controls="apps-conversation-column"`, and `aria-valuenow/min/max` bound to computeds (`:246-262`). Left/Right step 16px, Shift+arrow 64px (`:357-364`). Other keys are not handled and not prevented. A focus-visible ring (`focus-visible:ring-2 ring-inset ring-primary/60`) follows the `background-agent-strip` precedent. The separator carries `data-apps-focus-key="apps:splitter"`, so B14 focus memory restores it too. |
| Persistence | `appsSplitWidth` (readonly signal), `setAppsSplitWidth` and `commitAppsSplitWidth` follow the git-rail shape (`electron-layout.service.ts:75,89-91,211-224`). It is written in `persistLayout()` (`:621`) and read in `restoreLayout()` (`:643,663-667`). Drag frames and key steps only call the setter. Persistence happens only on `dragEnded`, on arrow `keyup`, on separator `blur` with a key resize pending, and on page destroy with a key resize pending (`:319,351-375`). |
| Page holds no width state | The width comes from the service. The page keeps only three things: a measured `containerWidth` signal from a ResizeObserver, `dragGrabOffset` (per drag) and `keyResizePending` (per key run). None of them is a split width. |
| Hidden and stacked at <=480px and in the embedded sidebar | The B15 container query still stacks the columns and hides the slot (CSS, first paint). The new `stacked` computed mirrors it from one ResizeObserver on the host (`:288-295,316-330`), and `@if (!stacked())` removes the separator from the DOM and the a11y tree (`:246`). The embedded sidebar is covered because it is a narrow container, as in B15. |
| B15 guarantees | Unchanged: the composer, session calls, the B8 viewState write-back (in the panel, not touched), interaction through computeds, focus memory. No `innerHTML` was added. The width is applied through a `[style.--apps-conversation-width]` binding. |
| Runtime cost | There is one ResizeObserver per page, disconnected in `DestroyRef` (`:330`), pinned in the splitter spec at `:367`. The handle's document listeners are released by the handle itself. Nothing runs per item and nothing is timer-based. |

## Spec pins

| Pin | Where |
| --- | --- |
| Offset subtraction | Splitter spec `:241`: left 200, grab 3px in, pointer 703 -> 500. |
| Clamp bounds and non-finite | Splitter spec `:252`: 634 max at container 1000, 240 min, NaN/Infinity from the handle ignored. Key clamps at `:320`. Service spec `:1170` block: [240, 1200], NaN/±Infinity rejected. |
| Persist on commit only | Splitter spec `:269`: 3 frames, 0 `setState` calls, then 1 on mouseup. Key version at `:301` (0 on keydown, 1 on keyup). Blur at `:332` (exactly one write, a second blur writes nothing). Service spec: `clamps drag frames … never persists them`. |
| Restore round-trip | Service spec `:2087`: persist, then a new service restores 430 and the git rail's 210. Page level at `:341`: restored 900 is laid out as 900, then as 634 in a 1000px container; the stored value stays 900. |
| Missing or non-numeric fallback | Service spec `:2115` `it.each`: missing, `'500'`, NaN, Infinity and null all fall back to 360. Out of range is clamped (`:2123`). |
| Arrow-key resize and Shift | Splitter spec `:301`: 360 -> 376 -> 440 -> 424, and `aria-valuenow` follows. |
| Handle absent when stacked | Splitter spec `:353`: absent at 480 (and no `ptah-electron-resize-handle`), back at 481. |
| Separator a11y | Splitter spec `:221`. |

## Write-path trace (mandatory)

**Key and format.** The key is `'electron-layout'` (`LAYOUT_STATE_KEY`, `electron-layout.service.ts:34`). Scope: the renderer webview state, stored per workspace by the Electron main process as `webview-state` (`apps/ptah-electron/src/ipc/ipc-bridge.ts:519-543`, reached through `preload.ts:31`). The value is a plain object: `{ sidebarWidth, sidebarVisible, editorWidth, editorVisible, gitRailWidth, gitRailCollapsed, appsSplitWidth }`. The new field is a number in CSS px.

**Writers of `LAYOUT_STATE_KEY`.** A repo grep outside specs, e2e and task docs finds exactly one writer: `ElectronLayoutService.persistLayout()` (`:612-622`). It rebuilds the whole object from the service's signals every time. Every caller (sidebar and editor drag end, toggles, git rail commit and toggle, workspace switch, remove, and the sync paths, plus the new `commitAppsSplitWidth`) goes through it. Because of that, every later write carries the current `appsSplitWidth`, and the new field cannot be dropped by another writer of this key. This is pinned in the service spec as "is kept when another layout writer persists afterwards", which runs toggleGitRail and setSidebarDragging(false).

**Merge semantics.** `VSCodeService.setState(key, value)` (`vscode.service.ts:237-248`) reads the whole state, spreads it, and replaces only `[key]`. Other keys are preserved. The other callers of `VSCodeService.setState` are:

- `theme.service.ts:231,354` (`THEME_STATE_KEY`);
- `git-review.service.ts:95,199` (`VIEWED_KEY`).

Both are keyed and merge the same way, so they never touch `electron-layout`. No frontend code calls the raw `window.vscode.setState` other than `VSCodeService`. `webview-html-generator.ts:459` only reads (`getState`), and only in VS Code.

**Readers.**

- `restoreLayout()` (`:639-673`) is the only production reader.
- Tests and e2e: `git-dock.mount.spec.ts:169` and `apps/ptah-electron-e2e/.../git-rail-collapse.spec.ts:141` both use `objectContaining`, so the extra field does not break them. The git-dock spec still passes because it is `objectContaining` on gitRail fields.

**`workspaceFolders` / `activeWorkspaceIndex`.** `persistLayout()` did not write these fields before this change and does not now. The new field changes nothing for them.

- `restoreLayout()` reads them only as the cache fallback passed to `syncFromBackend`, and that code path is unchanged.
- The pre-existing gap is that the cache fallback can never be filled. See Out-of-scope observations.

**Fallback.** `typeof === 'number'` rejects a missing, string or null value. The setter's `Number.isFinite` rejects NaN and ±Infinity, so the 360 default stays. An out-of-range value is clamped.

**Side effects of a commit.**

- One synchronous `vscode.setState` of the whole webview state.
- An async `set-state` IPC, which the main process persists with `stateStorage.update('webview-state', …)`.
- No RPC, no postMessage, nothing on drag frames.
- When a key is held down, the commit happens once on keyup, not on every repeat.

## Decisions

- **Width model.** `appsSplitWidth` is the conversation-column width, because that is what the handle's `direction='left'` pointer X measures. It defaults to 360, the prototype's column (`prototype/index.html:90`).
- **Clamp numbers.**
  - Min 240px: the header, the composer and the Send/Stop row stay usable.
  - Static service max 1200: a sanity bound for persisted garbage.
  - Container max: `container - 6 (handle, RESIZE_HANDLE_STYLES) - 360 (surface floor)`.
  - Known band: at a container width of 481-605px both floors cannot hold. The conversation min wins there, and the surface gets 115-239px. Below that band the page stacks (B15's 480 breakpoint).
- **Key steps.** 16px, and 64px with Shift. Only Left and Right are handled (the brief's scope); Home and End are not.
- **Stacked detection.** A ResizeObserver plus `@if`, rather than CSS alone. jsdom has no container queries, so the "handle absent" pin needs explicit state. It also takes the hidden handle out of the tab order and the a11y tree. The CSS rule stays for the first frame before the observer reports.
- **Separator placement.** The ARIA attributes sit on the B15 slot `div`, which wraps the handle. The handle's own inner `div` also carries `role="separator"` (it has no tabindex or value). Separator children are presentational, so this nesting is allowed. The handle itself was not changed.

## Deviations

- `electron-layout.service.ts` is 822 lines, over the 700-line rule for non-spec files. It was 788 before this batch, and the batch added 34 lines (the minimum for the field, the setter, commit, persist and restore). Getting under 700 would mean extracting unrelated workspace-switching code from a shared core service, which is outside this batch's files and scope. The team-leader should decide.
- The Files list said to add specs to `apps-page.component.spec.ts`. They went into the new `apps-page-splitter.spec.ts`, per the B15 note.

## Verification

- `npx nx run-many -t lint,typecheck,test -p @ptah-extension/core @ptah-extension/mcp-apps-page --skip-nx-cache --parallel=2`
  - Result: `Successfully ran targets lint, typecheck, test for 2 projects`. All six tasks passed.
  - The first run of the same command had 4 failures in `apps-submit-flow.spec.ts` (polling and serialization timing tests). That file was not touched. It passed alone (22/22) and in the full re-run. This looks like load flakiness while B16 was verifying on the same machine.
- Test counts (jest, `--maxWorkers=2`):
  - core: 33 suites, 900 tests passed. `electron-layout.service.spec.ts` alone: 97.
  - mcp-apps-page: 16 suites, 270 tests passed (B15's 259 plus 11 new).
- `npx tsc -p libs/frontend/mcp-apps-page/tsconfig.spec.json --noEmit`: exactly the 8 baseline errors, and no new ones:
  - `mock-rpc-service.ts:54,60,66,69`;
  - `monaco-loader.service.ts:113,151,171,187`.
- `npx prettier --check` on the 4 files: clean.

## Notes for the visual review

- **Wide window.** Drag the 6px handle between the conversation and the surface.
  - The column must follow the pointer with no jump at grab.
  - Escape mid-drag restores the exact starting width.
  - The surface never gets narrower than 360px; try containers of about 700px and 1000px.
- **Keyboard.**
  - Tab to the separator; a primary ring shows.
  - Left and Right move it 16px, Shift+arrow moves it 64px.
  - A screen reader should announce the value and range.
  - Reload: the width persists.
- **Narrow window (<=480px), dark and light.** The columns stack and there is no handle or tab stop. Widening again brings the handle back.
- **Band from 481 to 605px.** Check whether a surface narrower than 360 is acceptable there, or whether the stacking breakpoint should rise.
- **Hover and active colours** come from the shared handle styles (`oklch(var(--p) / 0.3 | 0.5)`).

## Out-of-scope observations

- `persistLayout()` never writes `workspaceFolders` or `activeWorkspaceIndex`. So the cache fallback in `restoreLayout()`/`syncFromBackend(cachedState)`, used when `workspace:getInfo` fails or returns no folders, always sees `undefined` and restores nothing. This is pre-existing and was not changed.
- `apps-submit-flow.spec.ts` timing tests can fail when the machine is under load (see Verification).
