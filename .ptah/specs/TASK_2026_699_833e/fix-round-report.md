# Fix round report — TASK_2026_699_833e

Branch `feat/inspector-side-dock` (worktree `.claude-worktrees/inspector-side-dock`). Nothing committed.
Input: `code-style-review.md` (findings 1–3), `code-logic-review.md` (findings 1–2), and decision 13.

## Fixes

| # | Finding | Fix | Where |
|---|---------|-----|-------|
| 1 | Style Blocking: appearance type missing from barrel | `type SplitHandleAppearance` re-exported next to `SplitHandleOrientation` | `libs/frontend/chat-ui/src/index.ts:17-21` |
| 2 | Style Serious: dock block in ChatView | New `InspectorDockController` (`@Injectable()`, provided per host next to `InspectorShellController`). It holds `slotShown`, the draft `linkedSignal`, `resizing`, `width`, `maxWidth`, `minWidth`, `preview`/`cancel`/`setResizing`, the commit policy (`commit`), `reset` and the tab-opener lookup (`toggleFromTab`). ChatView keeps only `protected readonly dock = inject(InspectorDockController)`, the `bindHosted` call and the badge computed. It no longer uses `viewChild('sessionTab')` or `linkedSignal`. Behavior is the same as before. ChatView went from 2135 to 2062 lines. | `services/session-inspector/inspector-dock.controller.ts` (new), `index.ts:23-26`; `chat-view.component.ts:61-63, 237, 993, 1010, 1162-1173`; template bindings `chat-view.component.html:310-328, 346-347, 361-362` |
| 3 | Style Moderate: duplicated separator | One `role="separator"` element with shared ARIA, tabindex, title and pointer/key/dblclick handlers. Only the children (`@if grip` spans / `@else` line div) and the classes differ. Classes come from one `separatorClass()` computed: `line` = the original class string, `grip` = base + outline/tone/transition. | `libs/frontend/chat-ui/src/lib/atoms/split-handle.component.ts:19-25, 47-84, 114-130` |
| 4 | Logic Moderate: fractional max | `inspectorMaxWidthFor` floors `shellWidth - 624` before the clamp. `inspectorDockWidth` rounds the wanted width first, then clamps it to the integer max. The ARIA max (`dock.maxWidth()`) and the render/ARIA value (`dock.width()`) therefore come from the same integer bound. Shell 960.5 with preference 560 gives dock 336, valuemax 336 and a 624.5 px chat column. | `inspector-shell.controller.ts:69-87, 116-121` |
| 5 | Logic Minor: body styles cleared | The previous inline `userSelect`/`cursor` values are saved on pointerdown and restored on every exit path (pointerup, cancel, destroy). Nothing changes when the body had no inline style. | `split-handle.component.ts:163-166, 221-225, 302-309` |
| 6 | Decision 13: "Stats" tab on the dock's inner edge | The tab is renamed **Stats** and moved inside the shell. It sits right after the main column and before `.cs-dock-slot`/the dock, inside a `div.cs-stats-tab-slot` (32 px). When the dock is closed it is the chat column's right edge. When the dock is open it sits immediately left of the grip and dock. `side="left"` puts its border and active line on the right edge, facing the dock. **Floor math:** the tab is now inside the measured shell, so `InspectorShellController.attach(..., reservedWidth)` subtracts `INSPECTOR_TAB_WIDTH` (32) from every measurement. The band, `shellWidth`, the dock max and the 624 px floor are therefore unchanged (960 px for main + dock still docks). **Sheet:** while the sheet is open the tab floats immediately left of the sheet (`.cs-stats-tab--sheet`, absolute, `right: 336px`, z 30, above the scrim). Over the full-width sheet it is pinned at the shell's left edge (`.cs-stats-tab--full`), and that sheet is `calc(100% - 32px)` wide. It stays inert and at `opacity-50`. The slot keeps its 32 px, so the main column does not reflow. These are kept: `data-inspector-tab`, the header toggle's `aria-controls="inspector"`, focus returning to the tab button on close (via `dock.toggleFromTab(statsTabSlot)`), and the compact/forced/tile/bare exclusions. The tab's text, title and name are now "Stats", "Show Stats"/"Hide Stats" and "Toggle Stats panel". | `chat-view.component.html:283-307` (old outside-shell tab removed); `chat-view.component.css:1, 62-89`; `inspector-dock.controller.ts:10-16` (`INSPECTOR_TAB_WIDTH`); `inspector-shell.controller.ts:177, 186-191, 266-291, 407-413`; comment renames `chat-view.component.ts:485`, `inspector-shell.controller.ts:304` |

## Tests added or changed

- `libs/frontend/chat/src/lib/services/session-inspector/inspector-dock.controller.spec.ts` (new, 8 tests). They cover slot visibility, draft preview and cancel without a write, commit once, skip on a shell-clamped equal width, the fractional max (960.5 → 336/336), reset, the draft and resizing reset when the slot goes away, and the tab-button opener.
- `inspector-shell.controller.spec.ts`: `inspectorMaxWidthFor(960.5)=336` and `(1124.9)=500`. `inspectorDockWidth(560, 960.5)=336` and `(499.6, 1124.9)=500`. One new test checks that the reserved width is subtracted from every measurement (992 → docked, 991 → sheet). The opener fixture is now labelled "Stats".
- `chat-view.component.spec.ts` (describe renamed "Stats tab and inspector dock"): `emitShellWidth(w)` now emits `w + INSPECTOR_TAB_WIDTH`, because the measured shell holds the tab. Rewritten test: the tab is inside `.cs-shell` right after the main column. When open, its next sibling is `.cs-dock-slot`, it has `border-r` and a right-edge active line, and its title, aria-label and text are "Stats". New tests: the fractional shell (960.5 + 560 → dock 336, valuenow/valuemax 336), the tab never counting toward the band or max (raw 991 = sheet, raw 992 = docked with max 336), the sheet tab classes (`--sheet` but not `--full`), and the full-sheet tab (`--sheet` + `--full`, inert). Test names now say "Stats".
- `split-handle.component.spec.ts`: new tests for restoring the previous body styles (after pointerup and after Escape) and for one shared separator element across appearance switches. The line-render assertion now compares the class **set** with the original string (see Decisions).

## Verification

`npx nx run-many -t typecheck,test,lint -p @ptah-extension/chat-ui @ptah-extension/chat --parallel=1` (one foreground run, exit 0):

```
NX   Running targets typecheck, test, lint for 2 projects:
- @ptah-extension/chat-ui
- @ptah-extension/chat
√  nx run @ptah-extension/chat-ui:test
√  nx run @ptah-extension/chat-ui:typecheck
√  nx run @ptah-extension/chat-ui:lint
√  nx run @ptah-extension/chat:test
√  nx run @ptah-extension/chat:typecheck
√  nx run @ptah-extension/chat:lint
NX   Successfully ran targets typecheck, test, lint for 2 projects
```

Earlier targeted Jest runs (`--maxWorkers=2`): split-handle spec 32/32. Session-inspector specs plus chat-view spec: 207 tests, all passing after the full-sheet assertion fix. The first full run failed `chat-ui:lint` (`no-duplicate-attributes`: a static `class` next to `[class]`). That is fixed by the single `separatorClass()` computed, and the second run is the result above. Lint warnings that remain in chat-ui are in files this round did not touch. Not run: visual/Electron screenshots (the visual-review phase).

## Decisions

- **Tab side = `left`.** `sidebar-tab.component.ts:55-69`: `side="left"` puts `border-r` and the active line at `right-0`, so it faces the dock to its right. The side effect is that the label reads bottom-to-top (`tab-label--flip`), the same as other left-side tabs. Reversible.
- **Reserved width, not DOM restructuring.** The tab has to sit between two children of the measured shell. The shell's measurement therefore includes it, and the controller subtracts a constant 32 px (`INSPECTOR_TAB_WIDTH`, which equals `w-8` = 2rem; the webview has no root font-size override) passed by ChatView only. The Rail board's `attach` call is unchanged (default 0). Options considered: measure the tab element (rejected: it goes stale when the tab mounts without a shell resize), or keep the tab outside the shell (rejected: it cannot then sit between the column and the dock). Reversible.
- **Sheet presentation:** the tab sits immediately left of the sheet, which stays at `right: 0`, 336 px wide, over a scrim. This mirrors the docked rule (tab left of the inspector). The previous layout put the tab right of the sheet, outside the shell. That is not possible any more without the tab jumping to the far edge. The full sheet loses 32 px so the tab stays visible. Reversible (CSS only).
- **R4 class-order assertion relaxed to set equality.** Angular's `[class]` binding re-sorts classes. The lint rule forbids a static `class` next to `[class]`, and ten single-class bindings would add noise. The rendered class set, and therefore the CSS result, is the original line string exactly. Host classes are still pinned exactly. Reversible.
- `toggleFromTab` takes the `#statsTabSlot` template element instead of a `viewChild`, so ChatView needs no query for the tab.

## Out-of-scope observations

- Running `prettier --write` on the touched files reformatted unrelated, previously unformatted code (for example the whole `chat-view.component.html`, and hunks in `chat-view.component.spec.ts` / `.ts` / `.css`). All of that churn was reverted hunk by hunk. Only this round's changes remain in the diff.
- The visual review should now also check the Stats tab: open/closed docked at 1440, and the sheet at 760 (tab left of the sheet).
