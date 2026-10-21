# Lane C glass theme fixes

## Defects

1. **Escape hatches:** `apps/ptah-extension-webview/src/styles.css:2633,2645` now gives both fallback blocks a mode selector with the same specificity as the dark tokens. `apps/ptah-extension-webview/src/app/glass-scrim.spec.ts:15` checks both selectors and their solid plates.
2. **Utility cascade:** `apps/ptah-extension-webview/src/styles.css:3069` moves the background utility neutralizers and competing chrome, bar, content, tile, plate and overlay fills after the component layer. This covers the settings cards, Electron header, command center header, and theme menu. Existing role guards read the whole CSS file and need no parsing change.
3. **Theme toggle:** `libs/frontend/core/src/lib/services/theme.service.ts:433` now chooses the opposite Ptah glass mode using theme metadata. `libs/frontend/core/src/lib/services/theme.service.spec.ts:228,236` covers dark and light themes outside the pair.
4. **Accent CSS assertion:** `apps/ptah-extension-webview/src/app/accent-css.spec.ts:11` selects the block that declares `--g-ptah-focus` instead of the preceding scene URL block.
5. **Lifted tab fill:** `apps/ptah-extension-webview/src/styles.css:2507` supplies the glass plate and line variables in the unlayered tab rules, including the active tab's inherited pseudo-element fill. Removed the ineffective layered tab rule.
6. **Invalid saved accent:** `libs/frontend/core/src/lib/services/theme.service.ts:290` writes the resolved accent back whenever VS Code state is missing or invalid. `libs/frontend/core/src/lib/services/theme.service.spec.ts:416` covers invalid state with a valid local hint.
7. **Pre-paint accent:** `apps/ptah-extension-webview/src/index.html:80,97` reads VS Code state first, then the localStorage hint, and applies only an allowed accent.
8. **Sessions pane:** `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail.component.ts:80` gives the rail a chrome root, plates for its title and scroll area, and breathing room around the plates. `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.ts:103` preserves the existing glass-only Aurora hiding and gives the board and rail separate surfaces.
9. **Pane corners:** `libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts:106,345` adds glass-only 8px outer padding and pane gaps. The workspace and Git tabs are their own chrome cards; the Git dock is a chrome card. `libs/frontend/chat-ui/src/lib/atoms/sidebar-tab.component.ts:37` clears the tab button's opaque fill under glass. `libs/frontend/chat/src/lib/components/organisms/workspace-sidebar.component.ts:123` removes the extra bottom tile role.
10. **Chat tab rectangle:** Same fix as defect 5 at `apps/ptah-extension-webview/src/styles.css:2507`.
11. **Section comment:** `apps/ptah-extension-webview/src/styles.css:2705` closes the section 3 header before section 4.

## Decisions

- Used option **(a)** for defect 9. The Electron shell and canvas board already use flex rows, so glass-only spacing can expose the backdrop around each card without changing the non-glass layout.
- Kept the Sessions rail's `bg-base-100` class for non-glass themes. The unlayered glass chrome fill wins when glass is on.
- No Nx, Jest, TypeScript, lint, build, serve, or e2e commands were run, as required. Verification was a targeted diff review, `git diff --check`, and comparison with the supplied screenshot and C4 reference. Runtime rendering and tests remain unverified.

## Files modified

- `apps/ptah-extension-webview/src/styles.css`
- `apps/ptah-extension-webview/src/app/glass-scrim.spec.ts`
- `apps/ptah-extension-webview/src/app/accent-css.spec.ts`
- `apps/ptah-extension-webview/src/index.html`
- `libs/frontend/core/src/lib/services/theme.service.ts`
- `libs/frontend/core/src/lib/services/theme.service.spec.ts`
- `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail.component.ts`
- `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.ts`
- `libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts`
- `libs/frontend/chat/src/lib/components/organisms/workspace-sidebar.component.ts`
- `libs/frontend/chat-ui/src/lib/atoms/sidebar-tab.component.ts`
- `.ptah/specs/TASK_2026_710_ptah-glass-theme/lane-c-fixes.md`
