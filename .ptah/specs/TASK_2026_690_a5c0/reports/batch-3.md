# Batch 3 — Inline blocks

## Files changed

- `libs/frontend/chat-ui/src/lib/organisms/ptah-ui/ptah-ui-message-text.component.ts:79` renders each closed display-target fence through `PtahUiBlockComponent` in its turn, retaining the `ui:<ordinal>` track. At `:96,115` it forwards `openInDisplayRequested(surfaceKey)` to the transcript caller.
- `libs/frontend/chat-ui/src/lib/organisms/ptah-ui/ptah-ui-block.component.ts:253,280-293` accepts an optional display ID, uses the display feed's anonymous ID rule, and rejects reserved IDs before compilation. The existing renderer and read-only inline interaction state remain shared with ordinary blocks.
- `libs/frontend/chat-ui/src/lib/organisms/ptah-ui/ptah-ui-display-chip.component.ts:12-70` is a compact status/action beside the full block. It reads the existing dock status port and emits the surface key; it does not navigate until Batch 4 binds the message-text output.
- `libs/frontend/chat-ui/src/lib/organisms/ptah-ui/ptah-ui-message-text.component.spec.ts:165-225` updates display-fence expectations to include the inline renderer.
- `libs/frontend/chat-ui/src/lib/organisms/ptah-ui/ptah-ui-display-chip.component.spec.ts:1-109` covers pending, applied, superseded, evicted, invalid, host-unavailable and event emission.
- `libs/frontend/chat-ui/src/lib/organisms/ptah-ui/ptah-ui-inline-display.component.spec.ts:1-104` covers streaming closure, full rendering with a null dock, invalid reserved IDs, historical superseded/evicted rendering and output forwarding.

## Preserve-list mapping

| Existing chip capability | Batch 3 destination |
| --- | --- |
| Pending identity | Closed fence renders inline immediately; compact label says `Pending display` until the feed publishes. Unclosed fence remains markdown code. |
| Invalid | Inline block shows its raw fenced code and localized `Not rendered` reason; status affordance says `Not in display`. |
| In display | Full inline block plus `In display` label and Open in display button. |
| Updated later | Historical inline block stays mounted; label becomes `Updated later`, action emits the current surface key (`Open latest`). |
| Evicted | Historical inline block stays mounted; label becomes `No longer in display`, with no unavailable navigation action. |
| Host-null | Inline renderer works without the dock; label says `Display panel unavailable`. |
| Open in display | `PtahUiDisplayChipComponent.openInDisplayRequested` and `PtahUiMessageTextComponent.openInDisplayRequested` emit the surface key. Batch 4 binds the latter to sheet selection/scroll. |

The `PtahUiDisplayDock` and `PtahUiDisplayDockSync` ports remain intact. Inline and sheet paths use the same compile/resolve pipeline and source inputs; inline renderer interactions remain local and read-only for selection/submit. Sheet view state remains under the current-surface owner.

## Verification

No tests, typecheck, lint, build, serve or e2e commands were run, as directed. `ptah_get_diagnostics` reported no diagnostics in the six changed source/spec files; it reported ten errors in unrelated sibling files.

## Decisions

- **Status as a compact sibling of the full renderer.** Options were keeping the old collapsible chip or rendering the block with a small status/action. The binding plan and user answer require full inline content and retention of the action. This is reversible within the ptah-ui presentation files.
- **Navigation via an output carrying the existing surface key.** Options were calling the old dock directly or emitting to the host. Batch 4 owns the sheet migration, while the task requires an output that can be bound later. This is reversible when Batch 4 wires the event.
- **Display ID compilation parity.** Options were compiling with the ordinary inline ID or matching the display feed's ID and reserved-prefix rule. The feed compiles named display fences with their display ID and anonymous ones with `anonymousDisplaySurfaceId`; the inline block now follows that rule. This is reversible if the shared resolver contract changes.

## Handoff

Batch 4 should bind `(openInDisplayRequested)` on `<ptah-ui-message-text>` at its host call site to open/scroll the sheet to the emitted current surface key. The event is harmless when unbound, including in VS Code.
