# Batch A — Canvas composition

## Final verification status
INCOMPLETE: the single 300-second completion check returned the same running execution session (96933), without an exit result. The required verification was launched once and has not been restarted or cancelled. The coordinator must collect this session / the log before acceptance. Stopping this lane near the requested 45-call ceiling; no passing test or Angular template-compilation result is claimed. Final scoped diagnostics found no errors in the 11 owned source/spec files.

## Implementation
Implemented the canvas composition in the assigned files. Verification is pending; this is not a passing acceptance report.

- Changes 1/6: canvas-rail-board mounts presentation="rail" under the existing dockShown condition when compact, replaces it with the expanded inspector, forwards expandRequested to expanded state and focusSection, and restores focus to the rail expand control on collapse. Expanded width excludes the former Stats tab subtraction. Below the combined 300px dock / 360px main floor, the expanded aside overlays the main surface. Git composition is untouched.
- Changes 1/4: title, urgent needs-you indicator, Stop, view toggle, pane menu and Close remain in the header. Passive status/workflow/branch and Send to messaging live in the compact fallback menu or expanded inspector identity/actions slot. Details retains its split/compact-sheet condition.
- Change 2: expanded dock, split details and compact sheet project the existing lane selector through inspectorSection; focus-area suppresses its selector while that pane's inspector is expanded. Selection remains in CanvasDetailService. selectedAgentKey reaches the inspector. View-mode toggle restores selected-tab focus after rendering.
- Change 3: canvas-lane-view sets showStats=false on agent-card and subagent-lane; their existing action and Details APIs remain unchanged.
- Width: focus-area host declares --chat-content-max-width: 1100px for focused chat and lane views, consuming Batch E's inheritance.
- Change 8: the compact inspector receives the existing tabId and stats. Batch B's Run tile directly reads model().needsYouCount from SessionInspectorStore; no separate count input exists or is needed.
- Narrow overflow: selected agent takes the first slot, followed by orchestrator when space permits; compact overflow omits the decorative avatar pile so its reserved 44px width is accurate. Existing selector ResizeObserver, menu and keyboard handling are reused.

## Files changed
- `D:/projects/ptah-extension/.claude-worktrees/chat-layout-declutter/libs/frontend/canvas/src/lib/canvas-rail/canvas-focus-header.component.ts`
- `D:/projects/ptah-extension/.claude-worktrees/chat-layout-declutter/libs/frontend/canvas/src/lib/canvas-rail/canvas-focus-header.component.spec.ts`
- `D:/projects/ptah-extension/.claude-worktrees/chat-layout-declutter/libs/frontend/canvas/src/lib/canvas-rail/canvas-focus-area.component.ts`
- `D:/projects/ptah-extension/.claude-worktrees/chat-layout-declutter/libs/frontend/canvas/src/lib/canvas-rail/canvas-focus-area.component.spec.ts`
- `D:/projects/ptah-extension/.claude-worktrees/chat-layout-declutter/libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.ts`
- `D:/projects/ptah-extension/.claude-worktrees/chat-layout-declutter/libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.spec.ts`
- `D:/projects/ptah-extension/.claude-worktrees/chat-layout-declutter/libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-view.component.ts`
- `D:/projects/ptah-extension/.claude-worktrees/chat-layout-declutter/libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-view.component.spec.ts`
- `D:/projects/ptah-extension/.claude-worktrees/chat-layout-declutter/libs/frontend/canvas/src/lib/canvas-detail/agent-dock-menu.component.ts`
- `D:/projects/ptah-extension/.claude-worktrees/chat-layout-declutter/libs/frontend/canvas/src/lib/canvas-detail/dock-overflow.ts`
- `D:/projects/ptah-extension/.claude-worktrees/chat-layout-declutter/libs/frontend/canvas/src/lib/canvas-detail/dock-overflow.spec.ts`

CanvasLaneTabsComponent itself did not need changes: it already measures its host and cleans up its observer. No chat/chat-ui files or task state were edited.

## Verification
- Required command started exactly once at worktree root: `npm run verify -- -p @ptah-extension/canvas`.
- Attached execution session: 96933; log: `$env:TEMP/ptah-batch-A-verify.log`. It initially waited at queue position 6 behind the machine-wide verification lock. One long completion check is in flight. Final result will be appended below.
- Final scoped ptah_get_diagnostics: no diagnostics in the 11 changed source/spec files. Nine dependency diagnostics remain: four mock-RPC cast errors in frontend/core testing and five BigInt-target errors in shared capability/attention types. These are outside this batch.
- Prettier completed on owned edits.
- Added/updated tests for rail expansion and target section, exactly one selector, identity/action fallback, width inheritance, showStats bindings, and overflow at 300/360/400/480/560px.
- No build, serve, e2e or workspace-wide command. No git commands.

## Decisions
- Use InspectorOpenStateService for explicit per-tab/per-view-mode expanded/compact choices, retaining existing band defaults for tabs without a choice. Alternative: board-local-only toggle. Evidence: Batch B's state contract and shared service implementation. Reversible.
- Mount the compact inspector eagerly, retaining deferred expanded bodies. Alternative: defer every reference. Evidence: the compact rail is the always-visible entry and has no placeholder interaction contract; an eager reference means the inspector component is now in the initial canvas bundle. Reversible.
- Bind existing needs-you model through tabId instead of inventing a count input. Alternative: require Batch B to add a redundant input. Evidence: session-inspector.component.html Run tile already reads the requested count. Reversible.
- At one available avatar slot, retain selected agent before orchestrator; the full menu still includes every agent. Alternative: hide the selected lane at 300px. Evidence: approved selected-agent preservation and 180px selected pill reservation. Reversible.
- Apply literal showStats=false and the width variable to the canvas mounts, as the current explicit What to build instructions require. The design's older Electron-only wording differs; default-true stats in other consumers are unchanged. Reversible.
- Reuse existing Angular OnPush, signal inputs/outputs, injection and selector/store boundaries. Evidence: canvas focus-area/header/lane-tabs source, CLAUDE.md, and the loaded .claude/skills/angular-frontend-patterns/SKILL.md. Ptah workspace analysis identified the Nx/Angular workspace; AST tools established source structure. Symbol search returned an empty index before the targeted SessionAgent fixture read.

## Clarifications Needed
None for implementation. The coordinator must collect verification completion and arrange visual acceptance.

## Not done / limitations
- Electron dark/light screenshots and visual acceptance were not run.
- No claim of cross-host compilation or passing Jest until the required verification completes.
- The new narrow overlay uses the existing non-modal aside/focus behavior; browser visual/focus acceptance remains necessary.
