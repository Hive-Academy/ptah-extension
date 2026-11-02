# Glass polish batch 4

## Changes by issue

1. **Voice Command Center:** `libs/frontend/command-center/src/lib/components/command-center-start.component.ts:31-35` adds a glass-scoped 1rem top and bottom margin to the existing content section. The header and card now have a stable gap as the session list grows.
2. **Tasks and WORKSPACES:** `apps/ptah-extension-webview/src/styles.css:3635-3636` clears the tasks `bg-base-100` page root and the workspace sidebar's `bg-surface-1` inner painter. `libs/frontend/tasks-ui/src/lib/components/tasks-view.component.ts:450-453` gives only the empty state a `plate`. The shared rule at `styles.css:3644-3648` gives task cards a reading plane.
3. **Thoth:** `styles.css:3644-3648` maps its `.surface-1` nav/cards and `.surface-2` memory list to `--glass-scrim-text`, retaining a scrim under dense text.
4. **Dashboard:** `styles.css:3637` clears the dashboard `bg-surface-0` root; `styles.css:3644-3648` gives its structural cards the shared reading plane.
5. **Settings Providers:** `libs/frontend/chat/src/lib/settings/providers/providers-settings.component.ts:123,550-553` gives the Main agent and Connections block a `content` surface and glass-only padding. `libs/frontend/chat/src/lib/settings/ptah-ai/cli-orchestration-matrix.component.ts:200-203` gives the dense table wrapper a `tile` surface.
6. **Marketplace:** `styles.css:3644-3648` changes the left nav's `.surface-1` fill to the glass reading plane; its border remains. The shared rule also covers the shell header.

The shared `.surface-1/.surface-2` rule excludes explicit glass roles, menus, modal/dropdown surfaces and `.navbar`; `.surface-3` is untouched. `apps/ptah-extension-webview/src/app/glass-scrim.spec.ts:90-105` asserts the three cleared roots and the shared reading-plane declarations.

## Settings Providers painter investigation

`settings.component.html:17` owns the only full-page `bg-surface-0` plane, and `settings.component.ts:133-135` clears it under glass. Providers, Context Management and Advanced share this page and the same `.ptah-motion-panel` wrappers. `providers-settings.component.ts:110-123` has a transparent `providers-page` root with no component `styles` or `:host` background; its `bg-base-100` uses are controls, not a page plane. `agents-routing-settings.component.ts:60-150` likewise has no full-pane background. The global motion-panel rules at `styles.css:916-1004` animate or position panels; they do not paint a background. Nested wizard and drawer backgrounds apply only while those overlays are open.

The supported static cause of the apparent grey Providers area is therefore its missing local reading surfaces: the large Main agent/Connections block and CLI matrix table were bare over the cleared Settings plane, unlike Advanced's content surfaces. The changes above address those actual content painters. A runtime-only opaque ancestor could not be ruled out: Electron rendering/devtools inspection was unavailable under this batch's no serve/dev/e2e constraint.

## Glass-off behaviour

Every new CSS selector requires `[data-glass='on']`. The added role attributes have no non-glass rule, so solid-theme backgrounds, borders, spacing and layout remain as before. The Tasks plate and Providers table fill are role-based only in glass.

## Verification

`npm run verify -- -p ptah-extension-webview,@ptah-extension/command-center,@ptah-extension/chat,@ptah-extension/tasks-ui -- --output-style=static` confirmed **4 projects** in its header and passed all 12 lint, test and typecheck targets (exit 0). Test totals: webview 730, command-center 553, chat 5,718 passed with 2 skipped, tasks-ui 655. Lint reported warnings, no errors. `ptah_get_diagnostics` was attempted after edits but its TypeScript compiler timed out; the scoped Nx typechecks passed. No rendered Electron screenshot was taken because running the app was outside the authorized verification commands.

## Decisions

- Used the spec's top/bottom margin for Command Center rather than centering; the growing list and scrollable host support a stable top edge. Reversible.
- Added a `plate` only to the Tasks empty state, as directed; the dense board content uses the shared reading plane. Reversible.
- Left the under-72rem side gap out, as directed. Reversible.
