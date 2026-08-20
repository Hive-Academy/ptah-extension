# TASK_2026_157 — Context

## User Request

Build the Ptah task-management system (phase 1) on top of the existing `.ptah/specs/` convention, surfacing tasks as a **standalone top-level tab** in the product UI (explicitly NOT a fifth tab inside thoth-shell).

## Task Type / Strategy

- **Type**: FEATURE
- **Complexity**: Complex (>8h) — new shared types, SQLite migration, new RPC namespace, new frontend lib + top-level surface, spec-harvester update
- **Workflow**: Full (project-manager → software-architect → team-leader → QA)
- **cli_delegation**: DISABLED (Checkpoint 0.1, 2026-07-14) — sub-agents only, no CLI fan-out

## Agreed Scope (from user conversation)

1. **Formalize the task file format**
   - YAML frontmatter per task (`id`, `status`, `type`, `assignee`, `depends_on`, `executor`, `claim`) validated with Zod at the file boundary; markdown bodies unchanged.
   - `registry.md` becomes a **generated view** derived from per-task frontmatter (no longer hand-edited source of truth). NO LEGACY SUPPORT (user decision at Checkpoint 1): the ~85 pre-existing folders without valid frontmatter are EXCLUDED from index/registry/board (counted + logged, never inferred, never crashing the scan). No emoji parsing, no backfill.
   - Update `spec-harvester` (libs/backend/skill-synthesis) to frontmatter-only parsing; REMOVE the legacy emoji-status path (tests updated to frontmatter fixtures).
2. **Surface tasks in the product**
   - New `tasks:` RPC namespace — dual registration: `libs/shared/src/lib/types/rpc/` types + `ALLOWED_METHOD_PREFIXES` in `libs/backend/vscode-core/src/messaging/rpc-handler.ts`.
   - SQLite derived-index migration in `persistence-sqlite` + file watcher over `.ptah/specs/` (files remain source of truth; DB is a rebuildable index).
   - New `tasks-ui` frontend lib rendered as a **standalone top-level tab/surface** (like dashboard/chat/canvas).
3. **Wire board actions to orchestration**
   - Card "Start" opens a session injecting `/ptah-core:orchestrate TASK_ID` via `SessionLifecycleManager.executeSlashCommandQuery`.
   - Optional per-task worktree via existing `git:addWorktree` RPC (async-pending + `git:worktreeChanged` push already exist).

## Out of Scope (explicitly deferred)

- Multi-user sync (git-committed specs, claim leases, gateway author attribution) — phase 2/3.
- License-server Organization/Team model — later premium tier.
- Plane MCP connector — separate integration task.

## Pre-Gathered Subsystem Findings (do NOT re-explore from scratch)

Condensed from three deep exploration reports run earlier this session:

### Existing .ptah/specs convention (orchestration skill)

- Authoritative format: `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/orchestration/references/task-tracking.md`.
- `registry.md` = markdown table (Task ID | Status | Type | Description | Created); statuses IN_PROGRESS/COMPLETE/BLOCKED/CANCELLED.
- `TASK_YYYY_NNN/` folders with agent-owned deliverables: context.md, task-description.md, implementation-plan.md, tasks.md (batches with emoji statuses ⏸️/🔄/✅/❌ + Recommended Executor + Execution Mode), research-report.md, test-report.md, review files, screenshots/.
- Phase detection = which files exist. Tribunal RELAY reuses same folders (`mode: tribunal-relay` in context.md).
- Skill content ships via ContentDownloadService (`libs/backend/platform-core/src/content-download.service.ts`) → `~/.ptah/plugins/` → UserLayerMirrorService → SkillJunctionService junctions into `.claude/skills/`. Skill text changes must be made in `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/orchestration/` (packaged source of truth) and content-manifest.json regenerated.
- Spec harvesting: `libs/backend/skill-synthesis/src/lib/spec-harvester.service.ts` + `spec-extractor.ts` parse tasks.md batch statuses post-completion, write HARVEST_MARKER_FILE, archive stale specs to `.ptah/specs/.archive/`.
- REAL-WORLD STATE (observed 2026-07-14): ~85 task folders exist, IDs have drifted (numeric gaps, name suffixes, non-numeric names), and no registry.md existed until today. The design must treat folder scans, not the registry, as ground truth.

### Agent execution backend

- `libs/backend/agent-sdk`: `SessionLifecycleManager` (~543 lines, `helpers/session-lifecycle-manager.ts`) — `executeSlashCommandQuery` exists specifically for injecting slash commands (fresh resume query with raw string prompt). Canonical sessionId from SDK init message. Sub-services: SessionRegistry, SessionStreamPump, SessionQueryExecutor, SessionControl.
- Subagents = SDK Task tool passthrough, observed via SubagentStart/Stop hooks (`subagent-hook-handler.ts`) into SubagentRegistryService (vscode-core).
- CLI agents: `libs/backend/cli-agent-runtime` — AgentProcessManager (max concurrent default 5, spawnMutex), PtahCliRegistry. MCP tools ptah*agent*\* dispatched in `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts`.
- RPC: `ALLOWED_METHOD_PREFIXES` at `libs/backend/vscode-core/src/messaging/rpc-handler.ts:44` (~40 prefixes; also PRO_ONLY_METHOD_PREFIXES line 110, LICENSE_EXEMPT_PREFIXES line 138). Compile-time contract: `libs/shared/src/lib/types/rpc.types.ts` barrel + per-namespace files under `libs/shared/src/lib/types/rpc/`. Handler classes in `libs/backend/rpc-handlers/src/lib/handlers/`, fanned out via `register-all.ts` (SHARED_HANDLERS, static METHODS asserted against RpcMethodName).
- Worktrees: `git:worktrees / git:addWorktree / git:removeWorktree` in `git-rpc.handlers.ts` (async-pending semantics with operationId + `git:worktreeChanged` push); SDK WorktreeCreate/Remove hooks in `worktree-hook-handler.ts`; frontend `libs/frontend/editor/src/lib/services/worktree.service.ts`.
- Frontend session mapping: `libs/frontend/chat-state` — TabManagerService (~2000 lines, per-tab signals, workspace partitioning), ConversationRegistry (ConversationId → ClaudeSessionId[]), TabSessionBinding.
- Canvas: `libs/frontend/canvas` — CanvasStore (MAX_TILES=9, per-workspace partition), gridstack v12.5, per-instance providers (never root).

### Persistence + UI shell

- SQLite: `~/.ptah/state/ptah.sqlite` (`db-path.ts`), single shared better-sqlite3 handle (`sqlite-connection.service.ts`, WAL). 28 forward-only migrations in `libs/backend/persistence-sqlite/src/lib/migrations/index.ts` (MIGRATIONS tuple). No sessions/tasks tables today. sqlite-vec loaded best-effort with graceful degradation (FTS5/BM25 fallback). IEmbedder contract in `src/lib/embedder/embedder.interface.ts`.
- No sync — DB per-machine by construction; files-as-truth + rebuildable index is the established pattern (symbol index precedent: migrations 0008/0013).
- Cron precedent for at-most-once: `run.store.ts` tryClaim bare INSERT on UNIQUE(job_id, scheduled_for).
- thoth-shell is NOT the target surface (user decision) — but its tab registration pattern documents how surfaces register. The standalone-tab approach must instead hook the app-level navigation (webview shell / electron-shell templates in `libs/frontend/chat/src/lib/components/templates/`, dashboard routing in `libs/frontend/chat-routing`). NOTE: electron-shell.component.ts currently has uncommitted modifications on branch ak/fix-canvas-issue — coordinate, do not clobber.

### Research conclusions feeding design (from earlier deep-research)

- Model the board interaction on Vibe Kanban (Apache-2.0): card → agent in isolated worktree → diff review → PR. Borrow Spec Kit /speckit.tasks shape (dependency-ordered work items, parallel markers) for tasks.md schema.
- Avoid claude-task-master (Commons Clause) and embedding any AGPL PM app.

## Decisions Log

- 2026-07-14: Tasks UI = standalone top-level tab (user decision, overrides thoth-shell default extension point).
- 2026-07-14: Files remain source of truth; SQLite is derived index only.
- 2026-07-14: Phase 1 single-user; multi-user deferred.
- 2026-07-14: Task ID = TASK_2026_157 (TASK_2026_001 was taken by a legacy memory-curator task despite registry absence).
- 2026-07-14: Checkpoint 2 APPROVED by user (no changes). Architect decisions D1–D8 stand: task.md carrier, new libs/backend/task-specs lib, existing createFileWatcher port, migration 0029, 7-method tasks: namespace, TASKS_VIEW_COMPONENT lazy token, frontend-driven Start flow via ChatPromptRequest bridge, harvester word-status batch parsing.
- 2026-07-14: Checkpoint 1 APPROVED by user with one caveat: NO legacy support — folders without valid frontmatter are excluded (no inference/emoji parsing/backfill); spec-harvester goes frontmatter-only with legacy path removed. task-description.md revised accordingly (B1, C1, R1.2, R2, R5.5, R7, out-of-scope 5, risks R2/R8, NFR-1).
