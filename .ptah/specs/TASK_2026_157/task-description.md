# Requirements Document — TASK_2026_157

**Title**: Ptah Task-Management System (Phase 1) — `.ptah/specs/` formalization + standalone Tasks tab
**Type**: FEATURE | **Priority**: P1-High | **Complexity**: XL (>8h)
**Workflow**: Full (project-manager → software-architect → team-leader → QA) | cli_delegation: DISABLED

---

## Introduction (Business Context)

Ptah already _runs_ an agent-orchestration PM process — the orchestration skill writes `TASK_YYYY_NNN/` folders under `.ptah/specs/` with context, plans, batches, and reviews — but the process is invisible to the product. Task state lives in hand-written markdown with emoji statuses, `registry.md` did not exist until this week, and ~85 legacy folders have drifted IDs and inconsistent formats. Users (and Ptah's own agents) have no board, no dependency view, and no one-click path from "task exists" to "agent is executing it."

Phase 1 turns `.ptah/specs/` into a first-class, machine-readable task system and surfaces it as a **standalone top-level Tasks tab** (peer of Chat/Analytics/Thoth/Tribunal — explicitly NOT a fifth tab inside thoth-shell, per user decision 2026-07-14):

1. **Agent-orchestration PM**: the board becomes the control plane for Ptah's own workflow — card → orchestrated session → (optional) isolated worktree, modeled on Vibe Kanban's card→agent→worktree interaction (Apache-2.0 inspiration only; no AGPL/Commons-Clause code).
2. **Groundwork for Phase 2 multi-user**: files-as-source-of-truth + rebuildable SQLite index is exactly the shape that later syncs via git-committed specs and claim leases. Schema fields `assignee` and `claim` are reserved now so Phase 2 is additive, not a migration.
3. **Competitive positioning**: Vibe-Kanban-style tools bolt a board onto agents; Ptah embeds the board in the same product that owns sessions, worktrees, memory, and skills.

**Value proposition**: files remain the durable, git-friendly source of truth; SQLite is a disposable derived index; the UI is a thin signal-driven view over a new `tasks:` RPC namespace.

---

## Assumptions (recorded defaults — architect may refine mechanics, not intent)

| #   | Assumption                                                                                                                                                                                                                                                                                                                                    | Rationale                                                                                                                                                                                                                                    |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | **Frontmatter carrier file**: YAML frontmatter lives at the top of each task folder's `context.md` (the first artifact every orchestration run creates). Folders without `context.md` or without frontmatter degrade to inferred metadata.                                                                                                    | Avoids inventing a new mandatory file; matches existing folder lifecycle. Architect may propose a dedicated carrier (e.g. `task.md`) only if `context.md` proves structurally hostile — decision must be recorded in implementation-plan.md. |
| B1  | **Canonical status vocabulary**: `backlog`, `in_progress`, `in_review`, `blocked`, `done`, `cancelled`. NO legacy status mapping (user decision 2026-07-14): folders without valid frontmatter are EXCLUDED from index/registry/board — counted and logged, never inferred, never crashing.                                                   | Board needs review lane; frontmatter is the only recognized format.                                                                                                                                                                          |
| C1  | **Task IDs**: tasks use `TASK_YYYY_NNN`; frontmatter `id` must equal the folder name (mismatch = validation issue, folder name wins). Folder name uniqueness within `.ptah/specs/` is the collision guarantee. ID allocation still scans ALL folder names (including non-conforming ones) so new IDs never collide with pre-existing folders. | Folder-name scan is the only collision-safe ground truth.                                                                                                                                                                                    |
| D1  | **Licensing**: the `tasks:` namespace is NOT added to `PRO_ONLY_METHOD_PREFIXES` in phase 1 (free-tier feature).                                                                                                                                                                                                                              | No user decision to gate; gating is additive later.                                                                                                                                                                                          |
| E1  | **Target surfaces**: VS Code webview + Electron shells both get the Tasks tab in phase 1. CLI gets the backend/RPC for free (hexagonal) but no CLI command surface is required.                                                                                                                                                               | Both shells share `AppStateManager`/`ViewType`; incremental cost is one tab button each.                                                                                                                                                     |
| F1  | **Watcher scope**: watch the current workspace's `.ptah/specs/` only (per-workspace index rows keyed by workspace root, since `~/.ptah/state/ptah.sqlite` is machine-global).                                                                                                                                                                 | Matches existing per-workspace partitioning (TabManager, CanvasStore).                                                                                                                                                                       |

---

## Requirements

### Requirement 1: Task frontmatter schema + Zod validation at the file boundary

**User Story:** As an orchestration agent (and as Ptah itself), I want every task folder to carry machine-readable YAML frontmatter validated at the file boundary, so that task metadata can be indexed, queried, and mutated programmatically instead of regex-scraped.

#### Acceptance Criteria

1. WHEN a task file is parsed THEN a Zod 4 schema SHALL validate a frontmatter block containing: `id` (string), `status` (enum per B1), `type` (enum: FEATURE, BUGFIX, REFACTORING, DOCUMENTATION, RESEARCH, DEVOPS, SAAS_INIT, CREATIVE), `title` (string), `description` (string, optional), `assignee` (string, optional — reserved for phase 2), `depends_on` (string[] of task ids, optional), `executor` (string, optional — e.g. agent/CLI lane), `claim` (object or string, optional — reserved for phase 2 leases), `created` (ISO 8601), `updated` (ISO 8601).
2. WHEN frontmatter is missing or YAML is unparseable THEN the parser SHALL return a typed `excluded` result (reason + folder name) — such folders never enter the index, registry, or board. WHEN frontmatter parses but fails Zod validation on non-essential fields THEN the parser SHALL return the task with a machine-readable issues list (surfaced in the UI as validation warnings). The parser SHALL NOT throw past its boundary in either case.
3. WHEN the schema types are defined THEN the plain TypeScript types (and enums) SHALL live in `libs/shared` so frontend and backend consume identical shapes; the Zod schema and file I/O SHALL live backend-side (validation at the external boundary per CLAUDE.md; frontend never parses files).
4. WHEN a new task is created via the system (Requirement 4, `tasks:create`) THEN the generated folder SHALL contain a carrier file with valid frontmatter (all required fields, `created`/`updated` set) that round-trips through the parser with zero validation issues.
5. WHEN frontmatter is programmatically updated (e.g. status change) THEN the markdown body below the frontmatter SHALL be preserved byte-for-byte, and `updated` SHALL be refreshed.

---

### Requirement 2: `registry.md` as a generated view (frontmatter-only, legacy excluded)

**User Story:** As a developer browsing the repo (or an agent reading specs), I want `registry.md` to be an always-accurate generated table derived from folder scans, so that there is exactly one source of truth (the folders) and no hand-edit drift.

#### Acceptance Criteria

1. WHEN registry generation runs THEN it SHALL scan `.ptah/specs/*/` directories (folder scan is ground truth — never the previous registry), parse each folder's frontmatter (Requirement 1), and emit a markdown table (Task ID | Status | Type | Title/Description | Created | Updated) preceded by a clearly-marked "GENERATED — do not hand-edit" header comment including generation timestamp.
2. WHEN the scan encounters a folder WITHOUT valid frontmatter (including all ~85 pre-existing folders: numeric gaps, `TASK_2026_146_ORCHESTRA`-style suffixes, `TASK_2026_HERMES`-style names) THEN that folder SHALL be EXCLUDED from the registry table and generation SHALL complete without error. The generated output SHALL include a single summary line with the excluded-folder count (no per-folder inference, no legacy parsing). **Running clean over the real 85-folder `.ptah/specs/` tree without errors is a hard requirement — verified against the live tree, not fixtures alone.**
3. There SHALL be NO legacy status inference of any kind (no emoji parsing, no file-presence heuristics, no old registry-string mapping) — user decision 2026-07-14. Frontmatter is the single recognized format.
4. WHEN generation runs twice with no file changes THEN output SHALL be byte-identical (deterministic ordering — newest first by created date, unknown-dated folders last alphabetically).
5. WHEN `.ptah/specs/.archive/` exists THEN archived folders SHALL be excluded from the registry table (optionally listed in a collapsed archive section — architect's choice, documented).

---

### Requirement 3: SQLite derived index + file watcher (files = source of truth)

**User Story:** As the Tasks UI, I want a fast queryable index of all tasks that stays current as files change, so that board queries never re-scan the filesystem per request — while the index remains disposable and rebuildable from scratch.

#### Acceptance Criteria

1. WHEN the feature ships THEN a new forward-only migration SHALL be appended to the `MIGRATIONS` tuple in `libs/backend/persistence-sqlite/src/lib/migrations/index.ts` (next free number; verify at merge time — see Risk R4) creating a tasks index table keyed by (`workspace_root`, `folder_name`) with columns for all Requirement 1 fields plus `frontmatter_valid`, `validation_issues` (JSON), and `last_indexed_at`.
2. WHEN a full reindex is requested (first run, explicit `tasks:reindex`-style call, or index-version bump) THEN the system SHALL rebuild the workspace's rows entirely from a folder scan, and the resulting index SHALL be equivalent to a from-scratch build (DELETE + re-INSERT for the workspace partition is acceptable). Deleting `~/.ptah/state/ptah.sqlite` SHALL never lose task data.
3. WHEN files under `.ptah/specs/` are created, modified, deleted, or renamed THEN a file watcher SHALL update the affected index rows and emit a push notification (Requirement 4.5). The watcher SHALL be acquired through the platform abstraction (platform-core port / existing watcher facility), NOT by importing a runtime-specific API into a runtime-agnostic backend lib.
4. WHEN watcher events burst (e.g. an agent writing many files during orchestration) THEN updates SHALL be debounced/coalesced (see NFR-2) so no rebuild storm occurs.
5. WHEN write operations flow through the system (status update, create) THEN the write order SHALL be: mutate file → reparse → update index → push event. The DB SHALL never be written as the primary copy of task state.
6. WHEN `.ptah/specs/` does not exist in the workspace THEN indexing SHALL no-op cleanly (empty result set, no errors, no directory auto-creation until the first `tasks:create`).

---

### Requirement 4: `tasks:` RPC namespace (dual registration)

**User Story:** As the frontend, I want a type-safe `tasks:` RPC surface, so that the Tasks tab can list, query, create, and mutate tasks without knowing anything about files or SQLite.

#### Acceptance Criteria

1. WHEN the namespace is added THEN it SHALL be dual-registered: (a) a per-namespace types file under `libs/shared/src/lib/types/rpc/` exported through the `rpc.types.ts` barrel (compile-time contract), AND (b) the `tasks:` prefix added to `ALLOWED_METHOD_PREFIXES` in `libs/backend/vscode-core/src/messaging/rpc-handler.ts` (~line 44, runtime guard). Missing either is a review-blocking defect.
2. WHEN methods are defined THEN the surface SHALL include at minimum: `tasks:list` (filterable by status/type), `tasks:get` (single task, full parsed detail + validation issues), `tasks:create` (id allocation per C1 + folder + frontmatter carrier), `tasks:updateStatus` (frontmatter mutation per Requirement 1.5), `tasks:generateRegistry` (Requirement 2), `tasks:board` (tasks grouped by status column in one round trip), and a full-reindex method (Requirement 3.2).
3. WHEN the handler is implemented THEN it SHALL be a handler class in `libs/backend/rpc-handlers/src/lib/handlers/` with a `static METHODS` array asserted against `RpcMethodName`, registered via `register-all.ts` `SHARED_HANDLERS` — matching the existing 30+ handler pattern.
4. WHEN any RPC payload crosses the boundary THEN request params SHALL be Zod-validated (Zod at external boundaries), and error responses SHALL be structured (code + safe message), never raw `error.message` leakage of file paths beyond the workspace.
5. WHEN the index changes (watcher or write path) THEN a `tasks:changed` push notification SHALL be emitted to the webview so open boards refresh reactively (mirroring the `git:worktreeChanged` push precedent).
6. WHEN `tasks:create` allocates a new numeric id THEN it SHALL scan existing folder names for the highest `TASK_YYYY_NNN` for the current year and allocate max+1, and SHALL fail with a structured error (not overwrite) if the target folder already exists.

---

### Requirement 5: Standalone Tasks tab (top-level surface in both shells)

**User Story:** As a Ptah user, I want a Tasks tab at the top level of the app — a peer of Chat/Analytics/Thoth/Tribunal — so that task management is a primary product surface, not a feature buried inside the Thoth hub.

#### Acceptance Criteria

1. WHEN the surface is registered THEN `'tasks'` SHALL be added to the `ViewType` union in `libs/frontend/core/src/lib/services/app-state.service.ts` (line 11) AND to the `validViews` array (~line 109), so `setCurrentView('tasks')`, state persistence, and initial-view deep-linking all work.
2. WHEN the UI is built THEN it SHALL live in a NEW frontend lib `libs/frontend/tasks-ui` (Angular 21, signals + `inject()`, `ChangeDetectionStrategy.OnPush` mandatory, zoneless-compatible), depending only on `libs/shared`, `libs/frontend/core`, and `libs/frontend/ui` — NO backend lib imports.
3. WHEN the webview shell renders THEN the Tasks view SHALL be wired following the existing lazy-view pattern: a new injection token in `libs/frontend/core/src/lib/tokens/lazy-view-components.token.ts` (peer of `ORCHESTRA_CANVAS_COMPONENT`), rendered via `*ngComponentOutlet` in `app-shell.component.html`, bound at BOTH composition roots (`apps/ptah-extension-webview` and the Electron renderer entry).
4. WHEN the Electron shell renders THEN a Tasks tab button SHALL be added to the tab strip in `libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts` (`role="tab"`, `[class.tab-active]="appState.currentView() === 'tasks'"`, `setCurrentView('tasks')` — matching existing tabs at lines ~200–275). ⚠ This file has uncommitted modifications on branch `ak/fix-canvas-issue` — coordinate, rebase onto current working-tree content, never clobber (Risk R1).
5. WHEN the board renders THEN it SHALL show status columns (per B1 vocabulary — canonical statuses only; excluded folders never appear) with cards displaying id, title, type, status, executor, and a `depends_on` indicator; data SHALL arrive exclusively via `ClaudeRpcService` calls + `MESSAGE_HANDLERS` push handling for `tasks:changed`.
6. WHEN `.ptah/specs/` is absent or empty THEN the tab SHALL render a friendly empty state with a create-first-task CTA — no errors, no blank screen.
7. WHEN status is changed from the UI (card action or column move) THEN it SHALL call `tasks:updateStatus` and reflect the pushed update — no optimistic local-only state that can diverge from files.
8. WHEN any AI/user-authored markdown (task description/body) is rendered THEN it SHALL route through `libs/frontend/markdown` (DOMPurify chokepoint) — never `[innerHTML]`.

---

### Requirement 6: Board → orchestration wiring (Start card → session, optional worktree)

**User Story:** As a user, I want to click "Start" on a task card and have an agent session begin orchestrating that task — optionally in an isolated git worktree — so that the board is a control plane, not a passive list.

#### Acceptance Criteria

1. WHEN "Start" is invoked on a card THEN the system SHALL open/focus a chat session and inject `/ptah-core:orchestrate TASK_ID` via `SessionLifecycleManager.executeSlashCommandQuery` (`libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts`), where TASK_ID is the card's id (folder name per C1).
2. WHEN the user opts into worktree isolation (per-card toggle/option, default OFF) THEN the flow SHALL create the worktree via the EXISTING `git:addWorktree` RPC (async-pending semantics with operationId + `git:worktreeChanged` push in `git-rpc.handlers.ts`) BEFORE starting the session, and the session SHALL be associated with that worktree using existing worktree/session mechanics — no new worktree plumbing in phase 1.
3. WHEN a task is started THEN its status SHALL transition to `in_progress` through the Requirement 4 write path (frontmatter mutation → index → push), and the board SHALL reflect it without manual refresh.
4. WHEN starting fails (session spawn error, worktree failure, task folder missing) THEN the user SHALL see a structured error on the card/toast, and the task status SHALL NOT be left transitioned (`in_progress` only on successful session start).
5. WHEN a card is opened (not started) THEN the user SHALL see task detail (parsed frontmatter + rendered markdown body per 5.8, dependency list, validation warnings for degraded tasks).

---

### Requirement 7: spec-harvester migration to frontmatter (with legacy fallback)

**User Story:** As the skill-synthesis pipeline, I want spec harvesting to read structured frontmatter instead of regex-parsing emoji statuses, so that harvesting is robust — while still working on the 85 legacy folders.

#### Acceptance Criteria

1. WHEN `spec-harvester.service.ts` / `spec-extractor.ts` (`libs/backend/skill-synthesis`) evaluate a task folder THEN they SHALL use frontmatter parsing ONLY (Requirement 1 parser — shared, not duplicated) for status/completion detection. The legacy emoji-status parsing path SHALL be REMOVED, not kept as fallback (user decision 2026-07-14: no legacy support).
2. WHEN a folder has no valid frontmatter THEN the harvester SHALL skip it (it is not harvest-eligible). Existing harvester tests SHALL be updated to frontmatter fixtures; HARVEST_MARKER_FILE and `.archive/` mechanics are retained unchanged.
3. WHEN a frontmatter task reads `status: done` (or `cancelled`) THEN the harvester SHALL treat it as harvest-eligible.

---

### Requirement 8: Orchestration skill documentation update (packaged plugin source)

**User Story:** As an orchestration agent following the skill, I want the task-tracking reference to document the frontmatter format and generated registry, so that future agent-created tasks are born valid.

#### Acceptance Criteria

1. WHEN skill text is updated THEN changes SHALL be made in the PACKAGED source of truth `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/orchestration/` (notably `references/task-tracking.md`) — NOT in any junctioned `.claude/skills/` copy — and `content-manifest.json` SHALL be regenerated so `ContentDownloadService` → UserLayerMirrorService → SkillJunctionService distributes it.
2. WHEN the updated reference is read THEN it SHALL document: the frontmatter schema (fields, status enum), that `registry.md` is generated (never hand-edited), and the new-task creation contract (Requirement 1.4).
3. WHEN skill markdown is authored THEN it SHALL respect the marketplace trademark constraint: no `copilot`/`codex`/`claude`/`openai`/`anthropic` additions to VSIX-bundled non-JS files — plugin assets ship via runtime download, and `.vscodeignore` exclusions SHALL remain intact.

---

## Non-Functional Requirements

### Performance

- **NFR-1 Index rebuild**: full from-scratch reindex of ~100 task folders SHALL complete in < 2s worst-case on Windows (target < 500ms typical). Parsers SHALL read only the frontmatter head of the carrier file, not whole large report files.
- **NFR-2 Watcher debounce**: filesystem events SHALL be debounced/coalesced with a 300ms (±) window; a burst of N file writes in one task folder SHALL produce at most one index update + one `tasks:changed` push per window.
- **NFR-3 UI responsiveness**: board render of 100 cards SHALL not jank — OnPush + signals throughout, `track` on all `@for` loops, no per-card RPC calls (board data in one `tasks:board` round trip). No virtualization required at phase-1 scale.
- **NFR-4 RPC latency**: `tasks:list`/`tasks:board` served from the SQLite index SHALL respond in < 100ms for 100 tasks.

### Reliability & Degradation

- **NFR-5**: absence of `.ptah/specs/`, an unreadable folder, or any single corrupt file SHALL degrade that row only — never fail the list/board/registry/index operation.
- **NFR-6**: the index SHALL be fully disposable — DB deletion or schema-version bump recovers via reindex with zero data loss (files are truth).
- **NFR-7**: forward-only migration discipline — no edits to shipped migrations; new migration appended to the `MIGRATIONS` tuple only.

### Platform & Security

- **NFR-8 Windows paths**: all file operations SHALL use absolute paths and be separator-safe (`path.join`/normalize); workspace-root keys in SQLite SHALL be normalized consistently so the same workspace never gets two partitions. Watcher behavior verified on Windows (primary dev OS).
- **NFR-9 Validation boundary**: Zod at every external boundary touched (file frontmatter, RPC params); internal types trusted past that. `catch (error: unknown)` + `instanceof Error` narrowing everywhere.
- **NFR-10 XSS**: all task markdown rendering routes through `libs/frontend/markdown` (single DOMPurify chokepoint).
- **NFR-11 Architecture isolation**: `tasks-ui` imports no backend libs; backend task libs/services import no adapters directly (platform-core ports only); `libs/shared` is the only bridge. Verified by `nx graph` / lint boundaries.

### Quality Gates

- **NFR-12**: unit tests for parser (valid/degraded/legacy fixtures), registry generator (determinism, legacy tolerance), index rebuild equivalence, RPC handler methods, and frontend store/components. `npm run typecheck:all` and `npm run lint:all` clean. No `--no-verify`.

---

## Out of Scope (do NOT scope-creep — restated from context.md)

1. **Multi-user sync** — git-committed spec sync, claim leases, gateway author attribution (phase 2/3). The `assignee`/`claim` fields exist in the schema as reserved placeholders ONLY; no lease logic, no conflict resolution.
2. **License-server Organization/Team model** — later premium tier; no license-server changes in this task.
3. **Plane MCP connector** — separate integration task.
4. **CLI command surface for tasks** (`ptah tasks ...`) — backend is runtime-agnostic by construction, but no CLI UX work in phase 1 (per E1).
5. **Legacy support of any kind** (user decision 2026-07-14) — no status inference, no emoji parsing, no backfill of the 85 pre-existing folders. They are excluded from the system; if the user later wants specific old tasks visible, adding frontmatter to those folders by hand (or a future utility) brings them in.
6. **Pro-gating of the tasks namespace** (per D1).
7. **Embedding or porting code from claude-task-master (Commons Clause) or any AGPL PM app** — design inspiration from Vibe Kanban / Spec Kit shapes only.

---

## Risks & Dependencies

### Risk Matrix

| ID  | Risk                                                                                                                                                 | Prob.  | Impact   | Score | Mitigation                                                                                                                                                                                                                |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | -------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | `electron-shell.component.ts` has UNCOMMITTED modifications on `ak/fix-canvas-issue` (concurrent-agent checkout). Tab-strip edits could clobber WIP. | High   | High     | 9     | Read current working-tree state immediately before editing; make minimal additive edits; if unexpected conflicts appear, STOP and report — never overwrite, never `--no-verify`.                                          |
| R2  | Legacy-folder heterogeneity crashes the scanner (85 real folders, drifted IDs, missing files).                                                       | Medium | Medium   | 4     | Exclusion model (no parsing of legacy content) shrinks the surface; scanner must still tolerate unreadable dirs/odd names without error. QA runs registry generation + full reindex against the REAL `.ptah/specs/` tree. |
| R3  | ID collision on create given legacy drift (precedent: TASK_2026_001 was silently taken despite no registry).                                         | Medium | Medium   | 4     | Requirement 4.6: allocation scans folder names (ground truth), never the registry; existing-folder collision is a structured failure.                                                                                     |
| R4  | Migration-number collision with concurrent tasks appending to the `MIGRATIONS` tuple (28 at last observation).                                       | Medium | Medium   | 4     | Pick the migration number at implementation time from the live tuple; re-verify at merge.                                                                                                                                 |
| R5  | Skill-text edits landing in the wrong place (junctioned `.claude/skills/` copy instead of packaged plugin source) and silently not shipping.         | Medium | High     | 6     | Requirement 8.1 names the exact packaged path + manifest regeneration; reviewer checklist item.                                                                                                                           |
| R6  | Marketplace trademark scanner regression if new markdown assets end up VSIX-bundled.                                                                 | Low    | Critical | 6     | Requirement 8.3; no new non-JS assets added to VSIX; `.vscodeignore` untouched or extended, never trimmed.                                                                                                                |
| R7  | Watcher storms during active orchestration runs (agents write many files fast) degrade UX or hammer SQLite.                                          | Medium | Medium   | 4     | NFR-2 debounce/coalesce; index updates scoped to affected folders on watch events (full rebuild only on explicit reindex).                                                                                                |
| R8  | spec-harvester behavior change (frontmatter-only) means pre-existing spec folders stop being harvest-eligible.                                       | Medium | Medium   | 4     | Accepted consequence of the no-legacy decision; harvester tests updated to frontmatter fixtures; marker/archive mechanics unchanged so nothing double-harvests.                                                           |

### Dependencies (existing code this task builds on — verified present)

- `SessionLifecycleManager.executeSlashCommandQuery` — `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts`.
- `git:addWorktree` / `git:worktreeChanged` — `libs/backend/rpc-handlers/.../git-rpc.handlers.ts`; frontend `libs/frontend/editor/src/lib/services/worktree.service.ts`.
- RPC infra — `libs/backend/vscode-core/src/messaging/rpc-handler.ts` (`ALLOWED_METHOD_PREFIXES` ~line 44), `libs/shared/src/lib/types/rpc/` + `rpc.types.ts` barrel, `register-all.ts` `SHARED_HANDLERS`.
- SQLite — `sqlite-connection.service.ts` (single WAL handle), `MIGRATIONS` tuple in `libs/backend/persistence-sqlite/src/lib/migrations/index.ts`; rebuildable-index precedent in symbol-index migrations 0008/0013.
- Surface registration — `ViewType` + `validViews` in `libs/frontend/core/src/lib/services/app-state.service.ts`; lazy-view tokens in `libs/frontend/core/src/lib/tokens/lazy-view-components.token.ts`; `app-shell.component.html` `*ngComponentOutlet` pattern; `electron-shell.component.ts` tab strip.
- Harvester — `libs/backend/skill-synthesis/src/lib/spec-harvester.service.ts` + `spec-extractor.ts`.
- Skill distribution — `ContentDownloadService` (`libs/backend/platform-core/src/content-download.service.ts`) → `~/.ptah/plugins/` → UserLayerMirrorService → SkillJunctionService.

---

## Stakeholder Summary

| Stakeholder                           | Impact | Success Criteria                                                                                                     |
| ------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------- |
| End users (VS Code + Electron)        | High   | Tasks tab usable end-to-end: browse board → start orchestrated session in ≤ 2 clicks; zero crashes on legacy folders |
| Orchestration agents / skill pipeline | High   | New tasks born with valid frontmatter; harvester keeps working on old + new formats                                  |
| Phase-2 (multi-user) planning         | Medium | Schema fields reserved; files-as-truth + rebuildable index leaves a clean sync seam                                  |
| Maintainers                           | Medium | One new frontend lib, one migration, one RPC namespace — no monolith growth; boundaries lint-clean                   |

---

## Definition of Done (roll-up)

- [ ] All 8 requirements' acceptance criteria pass, including live-tree verification over the real 85-folder `.ptah/specs/` (R2).
- [ ] `tasks:` dual registration present (shared types + runtime prefix) — reviewer-verified.
- [ ] Tasks tab reachable as a top-level tab in BOTH webview and Electron shells; NOT inside thoth-shell.
- [ ] Start-card flow launches `/ptah-core:orchestrate TASK_ID`; optional worktree path exercised at least once in QA.
- [ ] `npm run typecheck:all`, `npm run lint:all`, affected tests green; no `--no-verify`; no clobbering of `electron-shell.component.ts` WIP.
- [ ] Packaged orchestration skill reference updated + `content-manifest.json` regenerated.
