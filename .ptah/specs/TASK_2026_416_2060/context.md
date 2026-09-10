# Canvas controls and singleton layout

Strategy: BUGFIX, full workflow continuation. Read-only investigation and proposed design already presented; user requested orchestration using Antigravity CLI and refined the design to an expandable four-icon layout control.

cli_delegation: enabled
Selected executor: antigravity (installed, discovered live). Main orchestrator alone spawns. No commits or pushes authorized.

## Branch and protected changes

Working branch fix/codex-context-efficiency was switched and rebased onto fetched origin/main. Branch-only activity positioning commit is now 5f79f5ad8. Autostash successfully restored 16 unrelated local changes in .claude/skills/orchestration and .codex/agents. Preserve these changes; do not stage, overwrite, or revert them.

## User intent / implementation scope

Prevent layout controls overlapping session close and lock/new-session controls overlapping composer send. Reserve a slim control rail outside the measured session viewport. Floating-looking Layout trigger expands into four icon actions: one column, two columns, three columns, lock/unlock. Replace numeric labels with attractive, consistent icons, tooltips/accessibility labels, active states, keyboard-accessible interaction. New Session remains accessible in the reserved dock. No permanent controls overlay tile content.

Single session fills the usable viewport, no drag/resize handles, responds to viewport changes. Do not force locked=true or render a separate chat instance. Multi-session retains existing horizontal weighted resizing and header dragging when unlocked. Lock continues freezing user arrangement; singleton layout controls may be disabled as inapplicable. Preserve automatic responsive default internally; four expanded actions do not need a fifth Auto button. Column actions preserve current maximum-column semantics.

Activity placement: top-11 to top-6 moved 20px upward, not six, and overlaps the h-10 navbar. Correct placement using shell chrome or demonstrably safe placement rather than arbitrary offsets.

## Verified investigation

orchestra-canvas.component.ts grid occupies full area; absolute layout top-right and lock/new-session bottom-right overlap content. ResizeObserver measures outer canvas, so must observe usable viewport after rail allocation. canvas-workspace-grid.component.ts enables drag/east-west resize for singleton; static mode only considers lock/visibility. Layout service distributes 12 units across each row and floors height to six units; singleton requires exact fill. Lock freezes geometry, so singleton immobility must be separate from lock. Existing resize persists weights via store, no schema change needed.

Likely files: libs/frontend/canvas/src/lib/orchestra-canvas.component.ts, canvas-layout-controls.component.ts, canvas-workspace-grid.component.ts, canvas-layout.service.ts; libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts and existing associated specs. Add tile affordance change only if needed.

## Verification

Run scoped diagnostics and unit tests for @ptah-extension/canvas and @ptah-extension/chat; verify two projects actually run. Existing real Gridstack Electron canvas e2e should cover non-overlap via bounding boxes/hit testing, singleton fill/no handles, 1→2→1 without remount, narrow viewport/editor-open cases and activity notifications. Report unavailable visual verification explicitly. No tests have run yet.
