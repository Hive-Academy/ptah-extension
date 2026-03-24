# Requirements Document - TASK_2025_208

## Multi-Workspace Isolation for Electron App

---

## Introduction

Ptah's Electron desktop app currently operates in a single-workspace mode. When a user opens a folder, the entire DI container, chat state, editor state, and session history are bound to that one workspace. There is no way to open a second project folder and have its chat sessions, file tree, and editor context remain independent from the first.

This is a fundamental limitation for professional developers who routinely work across multiple projects simultaneously. The `ElectronLayoutService` already tracks multiple workspace folders in the sidebar and supports switching between them, but switching is cosmetic only: the backend DI container stays bound to the original workspace, chat tabs persist globally in localStorage (not per-workspace), the editor file tree does not reload, and session lists do not re-scope. The result is that data from Project A leaks into Project B.

The goal is to make each workspace folder a fully isolated context where chat sessions, editor state, and AI agent history are encapsulated, and the user can switch between workspaces instantly within the same application window.

**Business value**: Professional developers need multi-project workflows. Without workspace isolation, Ptah is limited to single-project use, which is a dealbreaker for adoption in real-world development environments where developers context-switch between repositories dozens of times per day.

---

## Requirements

### Requirement 1: Workspace Lifecycle Manager

**User Story:** As a developer using the Ptah Electron app, I want opening a new folder to create a fully isolated workspace context (with its own scoped services, storage, and session registry), so that each project I open has completely independent state.

#### Acceptance Criteria

1. WHEN the user opens a folder via File > Open Folder or the sidebar "Add Folder" button THEN the system SHALL create a new workspace context with its own scoped DI child container, workspace-specific state storage path, and session registry, without restarting the application.

2. WHEN a workspace context is created THEN the workspace-scoped services (state storage, config, session metadata store, workspace intelligence) SHALL resolve from the child container and use the workspace-specific storage path (`${userDataPath}/workspace-storage/${encodedWorkspacePath}/`).

3. WHEN the user closes a workspace (removes a folder from the sidebar) THEN the system SHALL dispose of the workspace's child DI container, release file watchers and session watchers for that workspace, and remove it from the active workspace registry, without affecting other open workspaces.

4. WHEN the application launches with previously opened workspaces THEN the system SHALL restore all workspace contexts from persisted layout state and activate the last-active workspace, so that the user's multi-workspace arrangement survives app restart.

5. WHEN a workspace context fails to initialize (e.g., folder no longer exists, permissions error) THEN the system SHALL log the error, display a user-visible notification, skip that workspace, and continue initializing remaining workspaces without crashing.

### Requirement 2: Per-Workspace State Scoping

**User Story:** As a developer working on multiple projects, I want each workspace's configuration, preferences, and transient state to be stored separately, so that changing a setting in one project does not affect another.

#### Acceptance Criteria

1. WHEN the user modifies a workspace-scoped setting (e.g., selected model, autopilot level, agent configuration) THEN the change SHALL persist to the active workspace's storage path only and SHALL NOT affect settings in other workspace contexts.

2. WHEN the user switches workspaces THEN the config manager shim SHALL re-bind to the new workspace's state storage, and all services reading configuration SHALL see the new workspace's values without requiring re-initialization.

3. WHEN two workspaces are open simultaneously THEN each workspace's `WORKSPACE_STATE_STORAGE` token SHALL resolve to a distinct `ElectronStateStorage` instance backed by a different filesystem path, verified by the storage path containing the workspace-specific encoded folder name.

### Requirement 3: Per-Workspace Chat and Session Isolation

**User Story:** As a developer switching between projects, I want each workspace to have its own set of chat tabs and session history, so that conversations about Project A do not appear when I switch to Project B.

#### Acceptance Criteria

1. WHEN the user switches from Workspace A to Workspace B THEN the chat tab bar SHALL display only Workspace B's tabs, and Workspace A's tabs SHALL be preserved in memory (not destroyed) for instant restoration when switching back.

2. WHEN the user creates a new chat tab in the active workspace THEN the tab and its associated Claude session SHALL be scoped to that workspace. The session SHALL be stored under the workspace-specific Claude project path (`~/.claude/projects/{encoded-workspace-path}/`), and the tab state SHALL persist to the workspace-scoped storage (not global localStorage).

3. WHEN the `session:list` RPC is called THEN it SHALL return only sessions belonging to the active workspace, filtering by the active workspace's folder path. Sessions from other open workspaces SHALL NOT appear in the list.

4. WHEN a streaming response is in progress on Workspace A and the user switches to Workspace B THEN Workspace A's streaming SHALL continue in the background, and when the user switches back to Workspace A, the streamed content SHALL be fully visible without data loss.

5. WHEN the user closes a workspace that has active streaming sessions THEN the system SHALL prompt for confirmation, and upon confirmation, SHALL abort the active streams and clean up session resources for that workspace.

### Requirement 4: Per-Workspace Editor Isolation

**User Story:** As a developer editing files across multiple projects, I want each workspace to have its own file tree, open file, and editor scroll position, so that switching workspaces instantly restores my editing context.

#### Acceptance Criteria

1. WHEN the user switches from Workspace A to Workspace B THEN the file tree sidebar SHALL reload to show Workspace B's directory structure, and any previously open file in Workspace B SHALL be restored in the Monaco editor with its prior scroll position and cursor location.

2. WHEN the user opens a file in Workspace A THEN the file path, scroll position, and cursor position SHALL be tracked as part of Workspace A's state. Switching to Workspace B and back to Workspace A SHALL restore the exact editor state.

3. WHEN the `editor:getFileTree` RPC is called THEN it SHALL return the file tree for the active workspace's root folder only, not a merged tree of all open workspaces.

4. WHEN the `editor:openFile` and `editor:saveFile` RPCs are called THEN they SHALL validate that the file path falls within the active workspace's root folder, rejecting paths outside the workspace boundary to prevent cross-workspace file access via RPC.

### Requirement 5: Workspace Switching

**User Story:** As a developer who frequently context-switches, I want to click a workspace in the sidebar and have the entire UI (chat, editor, file tree) switch to that workspace's context instantly, so that I can move between projects without delay.

#### Acceptance Criteria

1. WHEN the user clicks a workspace entry in the sidebar THEN the system SHALL switch the active workspace context within 200ms perceived latency (UI responds immediately, background services re-bind asynchronously).

2. WHEN the workspace switch occurs THEN the following SHALL update atomically from the user's perspective: (a) the sidebar highlights the new workspace, (b) the file tree shows the new workspace's files, (c) the chat tab bar shows the new workspace's tabs, (d) the editor shows the new workspace's last-open file.

3. WHEN the backend workspace switch is triggered (via `workspace:switch` RPC) THEN the `ElectronWorkspaceProvider` SHALL update its active folder, the DI container SHALL activate the target workspace's child container for service resolution, and workspace-intelligence SHALL re-scope its analysis to the new workspace root.

4. WHEN the user rapidly switches between workspaces (e.g., clicking 3 different workspaces within 500ms) THEN only the final workspace switch SHALL take effect, with intermediate switches cancelled to prevent race conditions and UI flicker.

### Requirement 6: Workspace Indicator and Navigation UI

**User Story:** As a developer with multiple workspaces open, I want a clear visual indicator of which workspace is active and the ability to manage workspaces (add, remove, reorder), so that I always know my current context.

#### Acceptance Criteria

1. WHEN multiple workspaces are open THEN the sidebar SHALL display each workspace as a distinct entry with its folder name, and the active workspace SHALL be visually highlighted (e.g., bold text, accent color, or active indicator icon).

2. WHEN the user right-clicks a workspace entry THEN a context menu SHALL appear with options: "Remove Workspace", "Copy Path", and "Reveal in File Explorer" (or platform equivalent).

3. WHEN only one workspace is open and the user removes it THEN the system SHALL return to the "no workspace" empty state with a prompt to open a folder, rather than leaving the app in a broken state.

---

## Non-Functional Requirements

### Performance Requirements

- **Workspace switch latency**: UI SHALL respond within 200ms of a workspace click. Background service re-binding MAY take up to 500ms but SHALL NOT block UI rendering.
- **Memory per workspace**: Each idle workspace context (child container + cached tab state + file tree) SHALL consume less than 15MB of memory.
- **Concurrent workspaces**: The system SHALL support at least 10 simultaneous workspace contexts without degradation. Memory usage SHALL scale linearly (not exponentially) with workspace count.
- **Cold start with workspaces**: Application launch with 5 previously-open workspaces SHALL complete within 3 seconds (workspace contexts initialized lazily as needed).

### Data Integrity Requirements

- **No cross-workspace data leakage**: Under no circumstances SHALL chat messages, session history, file content, or configuration from one workspace appear in another workspace's context. This is a correctness invariant, not just a UX preference.
- **Crash recovery**: If the application crashes while multiple workspaces are open, all workspace contexts SHALL be restorable on next launch from persisted state. No session data SHALL be lost.
- **Concurrent streaming safety**: Two workspaces with active streaming sessions SHALL not interfere with each other's message routing. Each streaming event SHALL be routed to the correct workspace's chat store.

### UX Requirements

- **Instant perceived switching**: The workspace switch SHALL feel instant to the user. Stale UI from the previous workspace SHALL NOT flash before the new workspace's state renders.
- **Progressive disclosure**: Workspace management features (add/remove/switch) SHALL be discoverable but not intrusive. Single-workspace users SHALL not be burdened with multi-workspace UI.
- **Consistent with VS Code mental model**: The workspace concept SHALL behave similarly to VS Code's "Open Folder" concept, where each folder is a self-contained project context. Users familiar with VS Code SHALL find the behavior intuitive.

---

## Acceptance Criteria Summary (BDD Format)

```gherkin
Feature: Multi-Workspace Isolation
  As a developer using the Ptah Electron app
  I want each opened folder to be an isolated workspace
  So that my projects don't interfere with each other

  Scenario: Open a second workspace
    Given I have Workspace A open with 3 chat tabs and a file open in the editor
    When I click "Add Folder" and select a new project directory
    Then a new Workspace B entry appears in the sidebar
    And the UI switches to Workspace B with an empty chat and its own file tree
    And Workspace A's 3 chat tabs are preserved and accessible when I switch back

  Scenario: Switch between workspaces
    Given I have Workspace A and Workspace B open
    And Workspace A has an active streaming session
    When I click Workspace B in the sidebar
    Then the chat, editor, and file tree switch to Workspace B's state within 200ms
    And Workspace A's streaming continues in the background
    And when I switch back to Workspace A, all streamed content is visible

  Scenario: Workspace state persistence across restart
    Given I have 3 workspaces open with various chat tabs and editor states
    When I close and reopen the Ptah app
    Then all 3 workspaces are restored in the sidebar
    And the last-active workspace is selected
    And each workspace's chat tabs and editor state are restored

  Scenario: Remove a workspace
    Given I have Workspace A and Workspace B open
    When I remove Workspace A via the context menu
    Then Workspace A's entry disappears from the sidebar
    And its child DI container is disposed
    And Workspace B becomes active (if it wasn't already)
    And Workspace A's sessions remain on disk (not deleted) but are no longer loaded

  Scenario: Workspace-scoped session listing
    Given Workspace A has 5 sessions and Workspace B has 3 sessions
    When I am in Workspace A and open the session list
    Then I see only Workspace A's 5 sessions
    And when I switch to Workspace B and open the session list
    Then I see only Workspace B's 3 sessions
```

---

## Out of Scope

The following are explicitly NOT part of this task:

1. **Multi-window support**: Each workspace in its own Electron BrowserWindow. This task is single-window only with tabbed workspace switching.
2. **Remote workspaces**: SSH, Docker container, or WSL workspace support. All workspaces are local filesystem folders.
3. **Workspace groups or profiles**: Saving named collections of workspaces. Each workspace is independent.
4. **Cross-workspace search**: Searching across all open workspaces simultaneously. Search is always workspace-scoped.
5. **Workspace templates**: Creating new workspaces from templates or scaffolding.
6. **Multi-root workspaces**: A single workspace containing multiple root folders (VS Code's multi-root concept). Each workspace here is exactly one folder.
7. **Drag-and-drop workspace reordering**: Workspaces appear in the order they were added. Reordering is a future enhancement.
8. **Workspace-specific keybindings or themes**: All workspaces share the same app-level keybindings and theme.

---

## Dependencies and Risks

### Dependencies

| Dependency                                 | Description                                                                            | Impact if Missing                                                                            |
| ------------------------------------------ | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| tsyringe child containers                  | `DependencyContainer.createChildContainer()` is needed to scope services per workspace | **Critical** - Without child containers, workspace isolation requires a complete DI redesign |
| ElectronWorkspaceProvider events           | `onDidChangeWorkspaceFolders` event must fire reliably on workspace add/remove/switch  | **High** - Frontend relies on this to trigger UI updates                                     |
| Claude Agent SDK session paths             | Sessions must be storable at workspace-specific paths (`~/.claude/projects/{path}/`)   | **High** - Session isolation depends on SDK respecting workspace paths                       |
| Platform abstraction layer (TASK_2025_200) | Platform tokens and interfaces must be stable for child container registration         | **Medium** - Already complete, but changes would require rework                              |

### Technical Risks

| Risk                                                                                                                                          | Probability | Impact   | Mitigation                                                                                                                                                                                                 |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| tsyringe child containers don't support all registration types (e.g., factory registrations may not inherit correctly)                        | Medium      | High     | Spike: test child container behavior with factory registrations early. Fallback: manual service map per workspace instead of child containers.                                                             |
| Memory leaks from undisposed workspace contexts (file watchers, event listeners, cached data)                                                 | High        | Medium   | Implement explicit `dispose()` on workspace context that cleans up all subscriptions. Track all disposables in a registry.                                                                                 |
| Race conditions during rapid workspace switching (services reading stale workspace path)                                                      | Medium      | High     | Use a workspace context ID that is checked before applying async results. Debounce workspace switch signals with 100ms window.                                                                             |
| Tab state migration from global localStorage to per-workspace storage could lose existing user data                                           | Low         | Medium   | Implement one-time migration: on first launch with new system, read global localStorage tabs, assign them to the active workspace, and delete the global key.                                              |
| Frontend Angular services (`TabManagerService`, `EditorService`) are `providedIn: 'root'` singletons and cannot be instantiated per-workspace | Medium      | High     | These services must be refactored to accept a workspace context parameter or maintain an internal map of workspace-to-state. They remain singletons but internally partition state by active workspace ID. |
| Streaming events from background workspaces may be routed to the wrong chat store if the active workspace changes mid-stream                  | Medium      | Critical | Tag all streaming events with a workspace ID at the source (backend). Frontend routes events to the correct workspace's chat store regardless of which workspace is currently active.                      |

### Business Risks

| Risk                                                       | Probability | Impact | Mitigation                                                                                                      |
| ---------------------------------------------------------- | ----------- | ------ | --------------------------------------------------------------------------------------------------------------- |
| Scope creep into multi-window or remote workspace support  | Medium      | Medium | Strict scope definition in this document. Review all PRs against "Out of Scope" list.                           |
| Increased complexity makes the codebase harder to maintain | Medium      | Medium | Clear workspace context abstraction with well-defined interfaces. Comprehensive tests for isolation invariants. |

---

## Stakeholder Analysis

### Primary Stakeholders

| Stakeholder                    | Impact Level | Involvement            | Success Criteria                                                                  |
| ------------------------------ | ------------ | ---------------------- | --------------------------------------------------------------------------------- |
| End Users (developers)         | High         | Testing, feedback      | Can work on 3+ projects simultaneously without data leakage or performance issues |
| Core Developer (project owner) | High         | Implementation, review | Clean architecture, maintainable code, no regressions in single-workspace mode    |

### Secondary Stakeholders

| Stakeholder         | Impact Level | Involvement | Success Criteria                                                           |
| ------------------- | ------------ | ----------- | -------------------------------------------------------------------------- |
| QA / Testing        | Medium       | Validation  | Clear test scenarios for isolation, switching, persistence, and edge cases |
| Future Contributors | Low          | Maintenance | Well-documented workspace context API, clear extension points              |

---

## Success Metrics

1. **Isolation correctness**: Zero instances of cross-workspace data leakage in manual testing across 5+ workspaces
2. **Switch performance**: Workspace switch completes in under 200ms (UI) / 500ms (full backend re-bind) measured via performance marks
3. **Memory efficiency**: Each additional idle workspace adds less than 15MB to process memory (measured via Electron process.memoryUsage())
4. **Persistence reliability**: 100% of workspace contexts survive app restart with correct state restoration
5. **Streaming continuity**: Background workspace streams deliver all messages without loss when the user switches back
