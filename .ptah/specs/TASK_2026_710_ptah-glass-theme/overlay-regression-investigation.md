# Overlay regression investigation — TASK_2026_710 / PR 805

Read-only. No Electron, browser, tests, or source edits. Worktree `D:/projects/ptah-extension/.claude-worktrees/ptah-glass-theme`. `HEAD` is `241b03356277b7e548d39794b784e1eff72888a9`. DaisyUI checked in-tree is **4.12.24** (`node_modules/daisyui/package.json`). `ptah_*` tools were not available (`search_tool` for `ptah` returned no tools).

This report does not choose a visual redesign. It recommends the next observation and the smallest correction that observation would justify.

## Question

- Decision this supports: why glass popups and native modals fail, and what the smallest next change is allowed to touch.
- Question: do the pending `::after` rules attach the glass fill to `.modal-box` or to an ancestor, and which of stacking, overflow, and the top layer actually breaks each overlay family?
- Bounds: no rendered Electron pass; no Light/Dark/Glass redesign; no claim about a 40px bar clipping by height alone; marketplace viewport algebra and contrast ink left out.

## Answer

The screenshot is `ptah-previous-sessions-modal` (`PreviousSessionsModalComponent`), not `NativeModalComponent` and not `.modal-box`. Its panel uses `bg-surface-0` and its header uses `bg-surface-1`. With glass on, the unlayered rule at `styles.css:3177` sets both utilities to `background-color: transparent`, and nothing restores a fill on `.psm-panel`. The home screen shows through the panel. The dialog and `.psm-scrim` still dim the scene and still take hits. That is a missing paint fill, not a hole in pointer interception.

The earlier `.modal-box` `::after` note still stands for `NativeModalComponent` only. DaisyUI’s transform attaches that pseudo to the box. Native popovers stay in-DOM `position: fixed` under surface `isolation`. The `h-10` bar does not by itself clip either family.

## Confirmed source facts

| Claim | Source | Date | Verified how |
| --- | --- | --- | --- |
| Working tree vs `HEAD` changes `styles.css` (+85/−17 in that file’s stat) and `glass-roles.spec.ts`. Native modal, native popover, and `floating-ui.service.ts` are not in the diff. Also dirty, and not accepted here: `license-status-card.component.ts` (`host: { class: 'block' }`), `axe.ts`, `marketplace-visual.e2e.spec.ts`, `HANDOFF.md`, `.gitignore`. | `git diff HEAD`, `git status --short` | 2026-10-22 | ran git |
| Every `[data-glass-surface]` is `position: relative; isolation: isolate`. | `apps/ptah-extension-webview/src/styles.css:2807` | undated | read the source |
| Pending rules set `.modal-box` and `.dropdown-content` to `background: transparent` and `isolation: isolate`. They do not set `position` on those elements. | `styles.css:2817-2844` | undated | read the source; diff vs `HEAD` |
| Pending `::after` is `content: ''`; `position: absolute`; `inset: 0`; `z-index: -1`; `pointer-events: none`; `backdrop-filter: var(--glass-filter)` / overlay token. At `HEAD` the filter and fill were on the element, and overlay `::after` was `content: none`. | `styles.css:2809-2851`; diff | undated | read the source |
| The same absolute `inset: 0` rim is `::before` at `z-index: 1` with a 1px mask. That rim block is not part of the pending diff. | `styles.css:2890-2907` | undated | read the source |
| Parent lift is only `:has(> [data-glass-surface='content']:has(.popover-panel))` at `z-index: 30`, same value as the bar. It does not mention chrome, overlay, tile, plate, `.dropdown-content`, or `dialog`. | `styles.css:2918-2935` | undated | read the source |
| `overflow` is not an inherited property. `body` sets `overflow: hidden` on itself. The Electron bar is `h-10` with `data-glass-surface="bar"` and no overflow utility. Shell chrome panes set `overflow-hidden` on those panes. | `styles.css:698-709`; `libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts:174-180`, `367-411` | undated | read the source |
| Native popover backdrop and panel are in the component DOM. Backdrop classes include `fixed inset-0 z-40`. The panel starts `visibility: hidden` and is not `dialog` / `popover`. | `libs/frontend/ui/src/lib/native/popover/native-popover.component.ts:89-110` | undated | read the source |
| Floating UI writes `position: fixed` before `computePosition` (`strategy: 'fixed'`) and sets `visibility: visible` only in `applyPosition`. | `libs/frontend/ui/src/lib/native/shared/floating-ui.service.ts:176-181`, `229-235` | undated | read the source |
| Native modal is `<dialog class="modal">` > `.modal-box` > content, then `<form class="modal-backdrop">`. Open path is `showModal()`. Host is `display: contents`. Closed dialog is `display: none`. | `libs/frontend/ui/src/lib/native/modal/native-modal.component.ts:70-104`, `133-139` | undated | read the source |
| DaisyUI `.modal` is `position: fixed; inset: 0`. `.modal-box` in unstyled CSS sets only `max-height`. Styled `.modal-box` sets `transform: translate(...) scaleX(...) scaleY(...)` at rest (`scale` 0.9) and again when `.modal[open] .modal-box` (`scale` 1), plus `overflow-y: auto`. | `node_modules/daisyui/dist/unstyled.css:894-927`; `styled.css:3655-3685` | package 4.12.24, file undated | read the installed file |
| `.dropdown` is `position: relative`. `.dropdown .dropdown-content` is `position: absolute`. Closed non-details dropdown content is `visibility: hidden; opacity: 0` until `.dropdown-open`, focus, or focus-within. Styled content also has a non-`none` `transform` (scale 0.95 closed, 1 open). | `unstyled.css:548-597`; `styled.css:2717-2744` | package 4.12.24 | read the installed file |
| `.modal-backdrop` is `z-index: -1` in the same grid cell as `.modal-box`. | `styled.css:3646-3654` | package 4.12.24 | read the installed file |
| Overlay fill token is `oklch(var(--b1) / 0.9)` (0.88 in the following theme block). Not a new measurement of pixels. | `styles.css:2627`, `2665` | undated | read the source |
| A non-`none` `transform` makes the element’s padding box the containing block for absolute and fixed descendants. `isolation` and `position: relative` do not do that for `position: fixed`. `isolation` does create a stacking context, so a negative `z-index` child cannot paint outside that context. | CSS Transforms containing-block rule; CSS2.1 Appendix E | spec text not re-fetched this session | inferred from those specs, applied to the rules above |

### Where the pseudo attaches

Glass never positions `.modal-box`. The pending `::after` is `position: absolute`. Its containing block is the nearest ancestor that is positioned or that has a non-`none` transform. DaisyUI’s transform is on `.modal-box` itself, in both the closed and `[open]` rules, so the pseudo’s inset box is the modal box’s padding edge. It is not the `dialog`, and it is not a shell `[data-glass-surface]`.

The same attachment holds for `.dropdown-content`: DaisyUI already sets `position: absolute` and a non-`none` `transform` on that panel, so its `::after` sizes to the menu panel.

For chrome, bar, and overlay surfaces, `:where([data-glass-surface]) { position: relative }` is what sizes their `::after` to that surface. The pseudo is a child, not an ancestor, so it does not become the containing block of a following `position: fixed` popover.

`overflow-y: auto` on `.modal-box` computes `overflow-x` to `auto` as well. That clips the absolute pseudo to the box. It does not inherit onto the dialog. A viewport-sized glass sheet would require the box to stop being the containing block and to stop clipping. The installed DaisyUI rules do both the opposite.

### Two families

**Native popover (in-DOM fixed).** Backdrop and panel are descendants of whatever surface hosts `ptah-native-popover`. At `HEAD` the chrome/bar/overlay element still has `backdrop-filter`, which makes that surface the containing block for `position: fixed`. Shell chrome also has `overflow: hidden`. Those two together clip a fixed panel to the pane and make Floating UI’s viewport coordinates resolve against the pane. The pending diff removes `backdrop-filter` from the element and leaves it on `::after`. That part matches the comment at `styles.css:2809-2816`. It does not remove `isolation: isolate`. `z-50` on `.popover-panel` competes only inside the surface’s stacking context. Later isolating siblings can paint over the panel and take its hits. The new selector lifts only the direct parent of a `content` surface, to the same `z-index: 30` as the bar (`styles.css:2919`, `2931-2935`). The license host change adds `class: 'block'` so that host can be that positioned parent (`license-status-card.component.ts` host). Canvas and other chrome hosts are outside that selector.

**Native modal (top layer).** `showModal()` puts the `dialog` in the top layer. Page `isolation` and the bar’s `z-index` do not cover it. The box still has DaisyUI’s transform, so it remains a containing block and a clipping scrollport for anything fixed inside the box, including a native popover opened from modal content. The pending change that is new for this family is the transparent element background. The card fill exists only if `::after` paints. `::before` at `z-index: 1` is older than this diff and sits above in-flow text unless the mask punches out the center.

**DaisyUI dropdown (third path, often what a click on the theme control is).** Not `NativePopover`. Closed state is `opacity: 0` and `visibility: hidden` until focus or `.dropdown-open`. The panel is absolute inside `.dropdown` (`position: relative`), so the bar’s height is not its containing block. The bar rule has no `overflow`. `body { overflow: hidden }` clips only what leaves the body box.

## Hypotheses

Not rendered. Each needs the experiment below.

- If the running Electron bundle is still `HEAD`, popovers are still clipped by element `backdrop-filter` plus pane `overflow: hidden`. Modals at `HEAD` still paint their fill on `.modal-box` itself, so a fully missing modal card is not explained by the pending pseudo. HANDOFF says the pending CSS has no new renderer build.
- If the bundle includes the pending CSS, a missing modal card means `::after` did not paint inside `transform` + `overflow-y: auto` + `z-index: -1` + `backdrop-filter`. Text would still be in the box. A card that covers its own text means the `::before` mask is not excluding the center, or the filtered pseudo is grouping above the text. Source paint order says the pseudo is behind in-flow content and the rim is in front.
- Popovers that are positioned on the viewport but still “dead” are covered by a later stacking context. That is not the bar’s 40px height. `elementFromPoint` decides this. The inline-host sentence in `styles.css:2928-2930` is stronger than CSS2.1: a non-positioned inline parent does not trap a positioned descendant’s `z-index`. The `block` host and the parent `:has` rule are unproven workarounds.
- `theme-dropdown-fix.md` says the 40px bar clips the theme menu because `body` and `main` are `overflow: hidden`. That is not sufficient. The bar sets no overflow, and an absolute panel whose containing block is `.dropdown` is clipped by the bar only if the panel actually crosses an ancestor clip edge. This investigation did not re-measure that menu.

## Proposed rendered experiment

One Electron session, after a renderer build that actually loads this worktree’s `styles.css`. Glass on, one dark theme and one light theme. Do not restyle. Preserve `showModal()`, the closed-dialog `display: none`, popover `visibility: hidden` until `applyPosition`, and the existing focus trap.

1. Confirm the loaded rule: chrome/bar/overlay/`.modal-box` computed `backdrop-filter` is `none`, and `::after` computed `backdrop-filter` is the glass filter. If the element still has the filter, stop: the live bug is `HEAD`, not the pseudo.
2. Open one native modal. Record `getBoundingClientRect()` for `dialog`, `.modal-box`, `.modal-box::after`, and `.modal-box::before`. Record used `transform`, `overflow-x`, `overflow-y`, `background-color`, and `z-index` on the box and the pseudo.
3. Expected if this note is right: `::after` matches the box, not the dialog (about 1px). `transform` is not `none`. `elementFromPoint` on the title hits the title, not `::before` or `.modal-backdrop`. The scrim outside the box is still the dialog background (`--glass-scrim`), and a click there still requests close.
4. Open one native popover from a chrome pane (canvas rail) and one from the license card. Record the panel’s rect, its containing block (whether the offset parent is the viewport or the pane), and `elementFromPoint` at the panel center plus a corner that hangs over the next pane and over the bar.
5. Expected if stacking is the remainder: the panel’s coordinates are viewport coordinates, and `elementFromPoint` returns a later pane or the bar, not `.popover-panel`. Expected if the bundle is still `HEAD`: the panel’s containing block is the filtered pane and the rect is clipped to that pane. A hit on `.popover-panel` means this stacking account is wrong for that screen.
6. Open one DaisyUI dropdown in the bar. Expected: it is not clipped to 40px unless a computed overflow ancestor’s edge actually cuts it. Record that ancestor if a clip is real.

## Minimum correction direction

Proposal only. Do not apply it in this pass.

- Keep `backdrop-filter` off chrome, bar, and overlay elements. Putting it back recreates the fixed containing block the pending diff removes.
- Do not treat `z-index: 30` on one `:has(> content)` selector as the popup fix. If step 5 shows a viewport-fixed panel under another surface, lift every isolating ancestor between `.popover-panel` and the shell for as long as the panel exists, to a level above the bar, or move the panel to the top layer the way a `popover` element already does. Leave `dialog.showModal()` as the modal path.
- For the modal card, add an explicit `position: relative` on `.modal-box` only so the pseudo does not depend on DaisyUI’s transform. Keep the box background as the fallback fill until step 3 shows `::after` painting. Do not put `backdrop-filter` back on `.modal-box`: its transform is already a fixed containing block for popovers inside the dialog.
- If step 3 shows `::before` taking the hit, drop that rim below the text for `.modal-box` only. The rim is older than this regression.
- Leave tokens, theme pair, and shell layout alone. The license `host: { class: 'block' }` stays only if step 5 shows that host was the one under a sibling.

## Unresolved design status

Light, dark, and glass were not redesigned in `241b03356`. The sessions screenshot is a fill bug on `PreviousSessionsModalComponent`, not a request to redesign the theme pair. The pending parent `:has` selector remains a partial popover patch. C4 parity is not established here.

## Unknowns

- Whether the Electron the user clicked was running `HEAD` or this dirty `styles.css`. Smallest check: step 1 above.
- Whether Chromium  (Electron 44) drops a `z-index: -1` `backdrop-filter` pseudo inside a transformed `overflow-y: auto` box. The rect and hit test in steps 2–3 settle it. No bug number was fetched.
- Which other popup the user still means besides this sessions modal (native popover, DaisyUI dropdown, or `NativeModalComponent`). Those families do not share this fill rule.

## Previous sessions modal (screenshot)

Component: `PreviousSessionsModalComponent`, selector `ptah-previous-sessions-modal`.

- Class: `libs/frontend/chat/src/lib/components/organisms/previous-sessions/previous-sessions-modal.component.ts`
- Template: `libs/frontend/chat/src/lib/components/organisms/previous-sessions/previous-sessions-modal.component.html`
- Screenshot read: `C:/Users/abdal/AppData/Local/Temp/claude/D--projects-ptah-extension/f1431b1f-1d63-4e1a-8ed0-e073938f4d40/images/2.png` (2026-10-22). No pixel measurement.

What the image shows, matched to that template: a bordered rounded panel titled “Previous sessions”, a filled search field, session-row text, and a close control. Through the panel body the home title “A FRESH SPACE TO WORK”, the New session control, the setup card, and recent-session cards stay readable. The whole scene, including that body, is dimmed. The panel outline is in front of the home content.

### Paint

| Claim | Source | Date | Verified how |
| --- | --- | --- | --- |
| The overlay is a `<dialog class="modal modal-open psm-dialog z-[990]">`, then `.psm-scrim.absolute.inset-0`, then `.psm-panel.relative…bg-surface-0`. The header is `bg-surface-1`. There is no `.modal-box` and no `data-glass-surface`. | `previous-sessions-modal.component.html:4-33` | undated | read the source |
| The class never calls `showModal()` and the template does not set `open`. It is not the top layer. DaisyUI `.modal` is still `position: fixed; inset: 0`. `.modal-open` sets `pointer-events: auto`. | `previous-sessions-modal.component.ts` (no `showModal`); `unstyled.css:894-926` | package 4.12.24 | read the source |
| Component CSS clears the dialog’s own fill (`background-color: transparent`) and paints `.psm-scrim` at `rgb(0 0 0 / 0.5)`. It sets no background on `.psm-panel`. The comment says the scrim replaces DaisyUI’s `#0006`. | `previous-sessions-modal.component.ts:104-127` | undated | read the source |
| Glass, unlayered, sets `.bg-surface-0` and `.bg-surface-1` to `background-color: transparent`. Later restorers cover inputs, buttons, cards, `.modal-box`, `.dropdown-content`, and `[data-glass-surface='overlay']`. `.psm-panel` matches none of them. | `styles.css:3176-3230` | undated | read the source |
| The search control is an `.input`, so `styles.css:3182` gives it `--glass-fill-input`. Row hosts have no resting background; only hover and current set `--surface-2` / `--surface-3`. | `styles.css:3182-3184`; `session-list-row.component.ts:61-77` | undated | read the source |
| Glass also sets `.modal.modal-open` to `--glass-scrim` (`oklch(var(--bc) / 0.28)` or `rgb(8 10 14 / 0.5)`). That selector is `(0, 4, 0)`, which beats the encapsulated dialog transparent rule. | `styles.css:2645`, `2684`, `2910-2916` | undated | read the source; specificity inferred |

The scrim is the previous sibling of the panel. A transparent panel shows that scrim and the home scene through the card. The search field stays filled, which matches the solid search bar in the shot. This rule is in the committed glass sheet. It does not depend on the pending `::after` diff. `.modal-box` `::after` never attaches here, because this panel is not a `.modal-box`.

The spec comment at `previous-sessions-modal.component.spec.ts:165-166` says DaisyUI `.modal { display: grid }` overrides `dialog:not([open]) { display: none }` in the app. The author rule is `(0, 1, 0)` and the usual UA rule is `(0, 1, 1)`, so that claim is not settled by specificity. The screenshot shows the panel was painted, so that session was not `display: none`.

### Pointer interception

Transparency is not `pointer-events: none`. Neither `.psm-panel` nor `.psm-scrim` sets `pointer-events`. `.modal-open` sets the dialog to `pointer-events: auto` (`unstyled.css:920-926`). The dialog is `position: fixed; inset: 0`, so it covers the viewport even without the top layer.

The panel comes after the scrim and is `position: relative`. Hits inside the panel box land on the panel or its controls, including where the background is transparent. Hits on the scrim outside the panel run `onScrimClick()` (`previous-sessions-modal.component.html:15`, `previous-sessions-modal.component.ts:376-378`). The home title and New session control are visible through the body and are not the hit target there. A click test was not run. The source does not describe a click-through hole.

### Correction direction for this component only

Proposal only.

- Stop using the wiped utilities as the card fill. Give `.psm-panel` and the header a background the rule at `styles.css:3177` does not clear, or mark the panel `data-glass-surface="overlay"` so it uses the overlay fill. Keep the scrim as the dim outside the card.
- Do not change the scrim click, Escape, or focus wrap to “fix” this picture. Those already intercept.
- Do not apply the `.modal-box` `::after` change to this panel. It does not match that selector.

## Decisions

- The pseudo attaches to `.modal-box` via DaisyUI’s transform, not to the dialog. Options were “dialog containing block” or “box containing block”. Evidence: `styled.css:3655-3685` and `styles.css:2826-2838`. Reversible: a later runtime rect can overturn it.
- The 40px bar is not the clip. Options were “bar height clips” (`theme-dropdown-fix.md`) or “no overflow on the bar”. Evidence: `electron-shell.component.ts:178-180`. Reversible if step 6 names a real clip ancestor.
- The sessions screenshot is transparent paint on `.psm-panel`, not click-through. Options were “`styles.css:3177` clears `bg-surface-0`” or “the dialog is behind the home screen”. Evidence: `previous-sessions-modal.component.html:11-30`, `styles.css:3177`, and the image. Reversible if a hit test shows the home control receives the click.
