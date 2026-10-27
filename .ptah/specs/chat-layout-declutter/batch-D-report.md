# Batch D — Active agents / execution header

## Produced

Implemented the four owned components and updated their four adjacent specs. No git operations or edits to other batches' source files.

- Execution header: default-true `showStats`; false removes projected passive stats without removing Details, progress/meta or action controls.
- Agent card and subagent lane: default-true `showStats` forwarded to execution header; stats components are also conditionally instantiated. Resume, Stop, Background and Close column handlers and eligibility/loading conditions are unchanged.
- Inspector: ACTIVE SUBAGENTS count and running/waiting rows; pending-request owners remain visible regardless of status. Selected historical agents and open steering drafts remain mounted. Removed the 260px nested vertical scroller and population paragraph. Empty copy is exactly `No active subagents`.
- Compact rows contain avatar, truncated name, status, tokens/cost and the existing size-7 actions menu. Both unknown metrics collapse to one dash; individually known values remain visible, with partial/estimated markers and accessible missing-field labels. Measured zero is retained.
- Selected details preserve model/raw ID, kind, activity, duration, CLI usage and actions. Existing `cliLaneStats` / `subagentLaneStats` adapters and Batch C's exported `AgentLaneStatsComponent` supply context/model/cache/token/cost detail from monitor records. No lane usage is added to session totals.
- Regression specs cover default stats rendering, hidden stats with retained Resume/Details/Close and Stop/Background, active filter, empty state, selected historical details, measured zero, and pending finished-agent questions with answer forwarding.

## API handoff for canvas / inspector batches

All three components expose `readonly showStats = input(true)`:
`ptah-execution-header`, `ptah-agent-card`, `ptah-subagent-lane`.
Canvas should bind `[showStats]="false"` only for Electron canvas CLI/subagent lanes. Other consumers retain current behavior by omitting the input.

`ptah-inspector-agents-section` inputs:
- `tabId: string` required.
- `agents: SectionState<InspectorAgentsData>` required; pass the complete existing rows, including finished/request-bearing rows. Filtering is internal.
- `sessionId: string | null = null` scopes existing tray ownership.
- `selectedAgentKey: string | null | undefined` NEW, default undefined. Bind the existing selected roster lane key (`cli:<id>`, `sub:<id>`, `bg:<id>`) from canvas via the owning inspector; explicit null clears host selection. When omitted, row activation retains a local selection for standalone consumers.
- `hasLaneSurface: boolean = false`, `staggerStart: number = 0` unchanged.

Outputs remain `laneRequested`, `answerRequested`, and `announced`. Action dispatch continues to re-read tray context. No new RPC or store action API.

**Integration required outside D ownership:** B/A must forward their existing selected lane key to `selectedAgentKey`. This lane did not edit session-inspector.component.* or canvas files.

## Verification

Required command launched ONCE from the worktree root:
`npm run verify -- -p @ptah-extension/chat`

**Result: pending, not a pass.** The foreground command remained queued behind the machine-wide verification lock. Initial output at 2026-10-26T12:21:11Z: queue position 7, holder PID 28164 in the claude-named-accounts worktree (holder started 12:04:46Z). One completion check waited 60 seconds and returned the same live execution session, with no completion output. No second verification run, build, serve, e2e or workspace-wide command was started.

Execution session: `62341`. Output log: `$env:TEMP/ptah-batch-D-verify.log`. Coordinator must collect its completion before accepting this batch. The tool-call ceiling / no wait-status-loop rule prevents further polling in this lane.

Scoped `ptah_get_diagnostics` after final source/spec edits: **no diagnostics in any of the eight requested changed files**. It reports 253 errors in sibling/dependency files, including existing casts in agent-card-truncation/chat-input/setup-plugins specs, compact-session fixture types, execution node fixtures and transcript specs. No out-of-scope errors were changed. This diagnostic result does not establish Angular template compilation or passing Jest tests.

Prettier completed successfully on exactly the eight owned source/spec files.

## Decisions

- Active means existing roster `running` or `waiting`; excluded queued and terminal rows unless selected, carrying a pending request or retaining an open steering draft. Alternative: all non-terminal rows. Evidence: approved target layout explicitly excludes merely non-completed records. Reversible.
- Expose selected historical row through an optional host-selected key rather than importing canvas selection into chat. Alternative: a new selection store or showing every finished row. Evidence: approved selector remains canvas-owned and chat cannot depend on canvas; finished details must remain reachable. Reversible; integration binding documented above.
- Keep one existing section-level timer with cleanup; derive row visibility rather than moving request/steer state. Alternative: a separate per-row lifecycle. Evidence: existing draft and action handlers, runtime-cost requirements. Reversible.
- Reuse lane adapters and Batch C's existing exported lane-stats component for selected details, instead of copying attribution/pricing/cache logic. Evidence: approved change 3 and existing lane consumers. Reversible.
- Unknown compact usage is one dash when both fields are absent; otherwise show known values only. Preserve partial/estimated markers and measured zero. Evidence: approved empty-state rules and Batch C copy. Reversible.
- Used native targeted reads after `ptah_code_search_symbols` returned zero hits with an empty index. Workspace/AST tools established Nx/Angular and the existing input/output/OnPush conventions; angular-frontend-patterns skill was read and applied.

## Remaining / not done

- Mandatory verification completion and any resulting test/template failures are unresolved. No passing test counts claimed.
- External selectedAgentKey binding belongs to B/A and must be integrated.
- Electron dark/light screenshots and visual acceptance belong to the coordinating visual-review workflow; none taken here.
- Other hosts were not separately tested: the user restricted this lane to the single chat verification command.

## Absolute paths written

- D:/projects/ptah-extension/.claude-worktrees/chat-layout-declutter/libs/frontend/chat/src/lib/components/molecules/execution-header/execution-header.component.ts
- D:/projects/ptah-extension/.claude-worktrees/chat-layout-declutter/libs/frontend/chat/src/lib/components/molecules/execution-header/execution-header.component.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/chat-layout-declutter/libs/frontend/chat/src/lib/components/molecules/agent-card/agent-card.component.ts
- D:/projects/ptah-extension/.claude-worktrees/chat-layout-declutter/libs/frontend/chat/src/lib/components/molecules/agent-card/agent-card-flat-header.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/chat-layout-declutter/libs/frontend/chat/src/lib/components/organisms/subagent-lane/subagent-lane.component.ts
- D:/projects/ptah-extension/.claude-worktrees/chat-layout-declutter/libs/frontend/chat/src/lib/components/organisms/subagent-lane/subagent-lane.component.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/chat-layout-declutter/libs/frontend/chat/src/lib/components/organisms/session-inspector/inspector-agents-section.component.ts
- D:/projects/ptah-extension/.claude-worktrees/chat-layout-declutter/libs/frontend/chat/src/lib/components/organisms/session-inspector/inspector-agents-section.component.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/chat-layout-declutter/.ptah/specs/chat-layout-declutter/batch-D-report.md

