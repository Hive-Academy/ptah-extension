# Popover tabs report

## Changes

- `libs/frontend/chat-ui/src/lib/atoms/theme-toggle.component.ts:227`: Electron shows compact Themes and Animation tabs above the existing Light/Dark/Glass category tabs. Both surface tabs have persistent tabpanels, linked IDs, selected state, and roving tabindex. Non-Electron keeps the original theme category UI without surface tabs.
- `libs/frontend/chat-ui/src/lib/atoms/theme-toggle.component.ts:243`: Themes contains the category switch, swatch grid, Primary accent, then Backdrop. `:329` places Motion and Animation style, in that order, in Animation. Animation controls mount when selected.
- `libs/frontend/chat-ui/src/lib/atoms/theme-toggle.component.ts:432`: selection retains the active surface during the open session and queues placement. `:495` resets to Themes on reopen. `:545` handles Left/Right/Home/End and focus; Escape and tile/category navigation remain in the existing dialog handler.
- `libs/frontend/chat-ui/src/lib/atoms/theme-toggle.component.ts:649`: simplified the height cap to the viewport for Electron and the smaller of viewport/28rem elsewhere. The existing CSS viewport cap and positioning remain aligned with it.

## Tests

- `libs/frontend/chat-ui/src/lib/atoms/theme-toggle.component.spec.ts:142`: Motion RPC save and restart note after switching to Animation.
- `:173`: tab labels, default Themes, ARIA linking, group separation, glass options, and selected/tabindex state.
- `:203`: Left/Right/Home/End navigation and focus.
- `:465`: 1186×738 placement cap on both Electron tabs; `:494`: non-Electron 28rem cap, no surface tabs or Motion control.
- `git diff --check` found no whitespace errors. The scoped Ptah diagnostics found no errors in the two edited files, but reported 13 errors in unrelated sibling files; the requested verify command passed.

## Verify

`npm run verify -- -p @ptah-extension/chat-ui,ptah-extension-webview` passed after the final component/test edits: **6 tasks, 6 succeeded, 0 cached** (lint, test, typecheck for both projects). No build, serve, Electron run, or e2e was used.

## Motion RPC finding

The red text is rendered by `libs/frontend/chat-ui/src/lib/atoms/motion-preference.component.ts:29`. Its load path at `:54-61` sets the error after a failed/unsuccessful `settings:getMotion` call or a thrown error. The handler registers the method at `libs/backend/rpc-handlers/src/lib/handlers/settings-rpc.handlers.ts:126`; it returns `unsupported` without `process.versions.electron` at `:127`, and returns a failure after a workspace configuration exception at `:129-134`. A missing or invalid stored preference is explicitly normalized to `always` at `:130-131`, so it cannot by itself explain the red text. The Electron host includes the settings handler through `libs/backend/rpc-handlers/src/lib/host-profile/manifest.ts:362-367` and calls `registerRpcSurface` in `apps/ptah-electron/src/activation/wire-runtime.ts:333-337`. The likely cause is a runtime RPC failure/timeout or a configuration read exception, potentially from a mismatched running host; the screenshot alone does not identify which. No proven small bug in the listed scope was found, so no RPC or theme service file was changed.

## Decisions

- Keep the selected surface tab while the popover stays open; reset to Themes on reopen. No persisted setting is needed.
- Use a small inline surface tablist because the shared native tab group owns projected content as one panel and would complicate the existing nested category tabs and popover focus behavior.
- Keep both surface panel elements in the DOM so `aria-controls` always resolves; mount Motion controls only when Animation is active.

## Not done

- Electron could not be run here. A real rendered screenshot and measured no-scroll assertion at 1186×738 are unavailable; the geometry and DOM behavior were verified in unit tests. A static HTML approximation would require an extra workspace file outside the allowed scope and would not exercise the Angular component.

## Revise round 1

### Changes

- `libs/frontend/chat-ui/src/lib/atoms/theme-toggle.component.ts:227-260,344-352`: formatted the surface tabs, kept both tab panels and their contents mounted, and hid the inactive panel with `[hidden]`. The Motion preference now retains its selected radio and restart note across tab switches.
- `libs/frontend/chat-ui/src/lib/atoms/theme-toggle.component.ts:392,612,627-645`: observe both panel heights while the popover is open and call `place()` after a content size change, including Motion RPC results. The observer disconnects on close and component destroy through the existing `ngOnDestroy`/`cancelFollowup` path. Existing keyboard, ARIA, Escape, Electron gating, and height cap logic remain intact.

### Tests and verification

- `libs/frontend/chat-ui/src/lib/atoms/theme-toggle.component.spec.ts:142-183`: saving Reduce motion, switching to Themes and back, preserving the restart note and radio, and confirming exactly one `settings:getMotion` call.
- `libs/frontend/chat-ui/src/lib/atoms/theme-toggle.component.spec.ts:185-217,528-557`: hidden panel semantics and the updated 1186 by 738 height test.
- `libs/frontend/chat-ui/src/lib/atoms/theme-toggle.component.spec.ts:234-279`: simulated ResizeObserver callback re-places after content growth; close and destroy disconnect it.
- First scoped verification run found one stale assertion in the existing height test (5 succeeded, 1 failed); it was updated. Final `npm run verify -- -p @ptah-extension/chat-ui,ptah-extension-webview`: **6 tasks, 6 succeeded, 2 cached**, exit 0.

### Decisions

- Keep the Motion components mounted for the component lifetime so switching tabs cannot reset their RPC state. Native `[hidden]` removes the inactive panel from focus navigation and the accessibility tree.
- Observe the two tab panels, whose intrinsic height changes with their contents. Do not observe the capped scrolling popover box, whose visible height may remain fixed after content growth.
- The Angular skill invocation mechanism was unavailable in this lane; I read `.claude/skills/angular-frontend-patterns/SKILL.md` directly.

### Not done

- Electron was not run. No rendered screenshot or measured no-scroll result was available under the two-file edit scope; DOM and geometry behavior were covered by the tests above.

