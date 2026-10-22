# Glass UI repair — TASK_2026_710

Date: 2026-10-22. Worktree only: `D:/projects/ptah-extension/.claude-worktrees/ptah-glass-theme`. No commit, push, or history operation. `.gitignore` not touched. `axe.ts`, the marketplace visual helper, and the theme-toggle component/spec were not edited. No test, typecheck, lint, diagnostics, build, serve, or browser run.

## Decisions

1. Replace the blanket utility wipe with shell-root opt-in. Options were a per-modal exception list, or clearing only the window canvases that already exist as shell roots. Evidence: `styles.css` previously set every `.bg-base-100`, `.bg-surface-0`, and `.bg-surface-1` to transparent (old line 3177). `PreviousSessionsModalComponent` paints `.psm-panel` with `bg-surface-0` and its header with `bg-surface-1` and has no glass role (`previous-sessions-modal.component.html:19-33`). Electron already clears only the shell root (`electron-shell.component.ts:102-104`). Role rules still force chrome, bar, and overlay transparent (`styles.css:3240-3244`). Reversible by restoring the one-line wipe.

2. Inset assistant answer cards with the existing chat-bubble padding. Options were a new spacing scale, or `var(--sidebar-spacing-sm) var(--sidebar-spacing-md)` from `.chat-bubble` (`styles.css:63-64` and `1978-1981`). `.cs-answer` is `data-glass-surface="content"` and has no padding (`message-bubble.component.html:71-75` and `95`). The content role sets fill, radius, and shadow only (`styles.css:2872-2876`). User timestamps stay on `.chat-header` (`styles.css:3119`). Tool rows stay on `ptah-execution-node` / `ptah-tool-call-item`. Reversible by deleting the one rule.

3. Do not change popup z-index. The shared defect needs a top-layer move, and this session has no hit-test. See unresolved gaps.

## Preserve checklist

- C4 token blocks unchanged (`styles.css:2603-2690`), including `--glass-fill-content` `0.8` / `0.78` and accent blocks `3164-3171`.
- Six glass scenes unchanged: `ptah-glass`, `ptah-glass-light`, `dark`, `nord`, `cupcake`, `dracula` (`styles.css:2793-2798`).
- Non-glass unchanged: new rules are under `:root[data-glass='on']`. Lofi block untouched.
- Chrome, bar, overlay, content, tile, and plate recipes unchanged except the answer-card padding rule, which does not restyle other content cards.
- Inherited dirty files kept. This patch only adds to `styles.css` and `glass-roles.spec.ts`.

## 1. Surface transparency

Before: unlayered `:root[data-glass='on'] :is(.bg-base-100, .bg-surface-0, .bg-surface-1) { background-color: transparent; }` cleared every reading utility. `.psm-panel` and its header matched that selector and no later restorer (inputs, buttons, cards, `.modal-box`, `.dropdown-content`, `[data-glass-surface='overlay']`) matched them. The home scene showed through the dialog. The scrim and the dialog still took hits.

After (`styles.css:3176-3186`): transparency is opt-in on the shell canvases only:

- `.electron-shell-root` (same element the component rule already clears)
- `ptah-app-shell > .bg-surface-0`
- `ptah-marketplace-shell > .bg-surface-0`
- `ptah-thoth-shell > .bg-surface-0`

Nested `bg-surface-0` / `bg-surface-1` / `bg-base-100` keep the utility fill. That covers `.psm-panel`, the sessions header, the sticky group labels, and `.ptah-composer` (`chat-input.component.ts:161-166`). Composer padding (`px-3 pt-2 pb-2`) was painting over a wiped background, so the strip around the tile read as an empty gap. The tile role is unchanged.

Chrome and bar stay clear for the `::after` blur (`styles.css:2817-2838` and `3240-3244`). `.modal-box` and `.dropdown-content` stay clear so their overlay pseudo can paint (`styles.css:3233-3238`).

## 2. Chat spacing and fill

Inspected, not guessed from the screenshot alone.

- User text is `.chat-bubble` with `padding: var(--sidebar-spacing-sm) var(--sidebar-spacing-md)` (`styles.css:1978-1981`), which is `8px 12px`. Glass does not zero that padding (`styles.css:3114`).
- Assistant text is `.cs-answer[data-glass-surface='content']`. Prose has vertical margins only (`execution-node.component.ts:237-239`, `my-2`). No horizontal padding in the bubble CSS or the content role. Paragraphs sit on the card rim. Screenshot `images/3.png` matches that.
- Transcript slot gap stays `0.75rem` (`chat-transcript.component.css:58-61`). Disclosure rows, tool rows, and `.chat-header` timestamps were not restyled.
- Pale chat column is the approved chrome fill (`--glass-fill` `0.44` light / `0.06` dark) on `chat-view.component.html:4`. Tokens were not changed. The washed composer strip was the wiped `bg-surface-0`, restored by section 1.

After (`styles.css:3247-3252`): while glass is on, `.cs-answer[data-glass-surface='content']` uses the same padding as `.chat-bubble`. Non-glass answers are not cards, so they keep today's spacing. `pt-4` on a logged answer is a layered utility and loses to this unlayered padding; the card still has the `8px` inset on every side.

## 3. Popup stacking — traced, not retargeted

Source, this session:

- Every `[data-glass-surface]` is `position: relative; isolation: isolate` (`styles.css:2807`). A z-index inside that context does not escape it.
- `ptah-native-popover` keeps the panel in the host DOM: backdrop `fixed inset-0 z-40`, panel `popover-panel ... z-50`, `visibility: hidden` until positioned (`native-popover.component.ts:89-110`). It is not a `popover` element and not `dialog.showModal()`.
- The open-panel lift is `z-index: 30` on the hosting surface and on the direct parent of a content surface (`styles.css:2919-2935`). That is the same level as the bar. It does not lift further ancestors. A later isolating sibling at the same level still paints over a panel that could not escape its context.
- `backdrop-filter` stays on `::after`, not on chrome/bar/overlay/`.modal-box` (`styles.css:2809-2838`), so those elements are not fixed containing blocks. That pending mechanism was left as it was.
- Previous sessions is `<dialog class="modal modal-open psm-dialog z-[990]">` (`previous-sessions-modal.component.html:4-9`). Its screenshot (`images/2.png`) is the missing panel fill from section 1, not a stacking miss. The home controls were visible through transparent paint.

No global z-index change. Popover defects are not claimed fixed.

### Proposal (not implemented)

Move `NativePopoverComponent`'s panel to the top layer with the Popover API (`popover="manual"`, `showPopover` / `hidePopover`), the same family the theme menu already uses. Keep Floating UI `strategy: fixed`, the focus move, and explicit dismiss (backdrop and Escape). The backdrop has to join the top layer too, or the page still takes hits beside the panel. Nested case: a popover opened from `dialog.showModal()` must stay above that dialog. VS Code webview and Electron 44 both need a hit-test before this lands. Do not raise `z-index` on `.popover-panel` as a substitute.

## Files

| File | Lines | Change |
| --- | --- | --- |
| `apps/ptah-extension-webview/src/styles.css` | `3176-3186` | Blanket utility wipe replaced with four shell canvases |
| `apps/ptah-extension-webview/src/styles.css` | `3247-3252` | Glass-only assistant answer padding |
| `apps/ptah-extension-webview/src/app/glass-roles.spec.ts` | `37-48` | Source guard for both rules |

## Verification

Not run. The user restriction forbids local tests and browser launch. The new spec reads `styles.css` only; it has not been executed. No Electron screenshot of this patch. C4 parity is not claimed.

`search_tool` for `ptah_agent_report` returned no schema (`total_hidden_tools: 10`). The report call could not be made from this lane.
