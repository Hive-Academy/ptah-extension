# Batch 11 report — HTML artifact chat wiring

## Previous partial edits

The previous lane added an `artifact` dock selection and `openArtifact`, mapped `artifact:<id>` panel keys back to that selection, supplied the active session's store records to the display panel, and routed `openExternal` through `ClaudeRpcService`. I kept those paths. I changed its sheet item count so an artifact-only sheet is visible, removed requested URLs from warning logs, and tightened selection comparison for the new union member.

## Files changed

- `libs/frontend/chat/src/lib/components/molecules/tool-execution/tool-call-item.component.ts` — parses the successful `ptah_artifact_publish` result (plain and `mcp__ptah__` names), resolves the id through `ArtifactStore`, and displays the metadata card only when a record exists (lines 104, 150). Card Open selects `artifact:<id>` through `DisplayDockState`; Full screen also sets the existing sheet mode to `full` (line 167).
- `libs/frontend/chat/src/lib/components/organisms/display-sheet/display-sheet.component.ts` — passes the active session's records to the panel, maps artifact selection keys, includes artifacts in sheet visibility/count, and relays external URLs to `artifacts:openLink` through RPC (lines 37, 89, 116, 121, 200, 207).
- `libs/frontend/chat/src/lib/services/display-dock/display-dock.state.ts` — retained the prior lane's artifact selection and open method (lines 28, 167); corrected union comparison (line 413).
- `libs/frontend/chat/src/lib/components/molecules/tool-execution/tool-call-item.component.spec.ts` — verifies both tool name forms, card gating on the store record, dock Open, and full-height action (lines 28, 40).
- `libs/frontend/chat/src/lib/components/organisms/display-sheet/display-sheet.component.spec.ts` — verifies session records, selected key, artifact-only count, external-link RPC, and panel selection (line 75).

`libs/frontend/chat/src/lib/services/index.ts` also has an unrelated worktree edit from another lane; I did not change it. No files outside this batch's ownership were modified by this lane.

## Verification

`NX_NO_CLOUD=true npx jest -c libs/frontend/chat/jest.config.ts <two changed spec paths> --coverage=false --maxWorkers=1`: 2 suites passed, 44 tests passed. `git diff --check -- libs/frontend/chat` found no whitespace errors. No typecheck or build was run, per the task's heavy-check hold.

## Decisions

- **Card placement:** In the generic tool row, immediately after its header. Options were the row or transcript container. The row already owns the tool result and keeps the card visible while the tool details are collapsed. Reversible.
- **Full screen action:** Use `DisplaySheetState` mode `full`. Options were existing full-height sheet mode or a new viewer route. The sheet already exposes `full` and the panel exposes no separate full-screen action. Reversible.
- **Result parsing:** Accept a JSON string or MCP text content block with an `id`; ignore errors, nonmatching names and missing records. This follows the publish handler's JSON text reply and existing MCP result display shape. Reversible.

## Gaps

Manual packaged Electron viewer and containment review remains for the orchestrator. The existing sheet's `full` mode fills chat height; it is not operating-system fullscreen.
