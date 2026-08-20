# Implementation Plan — TASK_2026_157

**Ptah Task-Management System (Phase 1)** — `.ptah/specs/` formalization + standalone Tasks tab

**Architect verdict**: Build a new focused backend lib `libs/backend/task-specs` (parser / scanner / registry generator / writer / SQLite index + watcher) with a dedicated `task.md` frontmatter carrier, migration **0029**, a 7-method `tasks:` namespace in the existing dual-registration pattern, and a new `libs/frontend/tasks-ui` lib surfaced as a top-level `'tasks'` ViewType via a new lazy-view token. All required plumbing (watcher port, push broadcast, slash-command injection, worktree RPC) already exists and was verified — zero new platform ports needed.

---

## 1. Codebase Investigation Summary (evidence)

All claims below were spot-verified against the working tree on 2026-07-14 (branch `ak/fix-canvas-issue`).

| Fact                                                                                                                                                                                       | Evidence                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Watcher port EXISTS: `IFileSystemProvider.createFileWatcher(pattern): IFileWatcher`                                                                                                        | `libs/backend/platform-core/src/interfaces/file-system-provider.interface.ts:105`; `IFileWatcher { onDidChange/onDidCreate/onDidDelete: IEvent<string> }` at `libs/backend/platform-core/src/types/platform.types.ts:61-65`                                                                                                                         |
| Watcher adapters exist for VS Code (wraps `createFileSystemWatcher`) and Electron (chokidar)                                                                                               | `libs/backend/platform-vscode/src/implementations/vscode-file-system-provider.ts:139`; `libs/backend/platform-electron/src/implementations/electron-file-system-provider.ts:123`                                                                                                                                                                    |
| Live migration tuple ends at **28** → next free number is **29**                                                                                                                           | `libs/backend/persistence-sqlite/src/lib/migrations/index.ts:238-241` (`0028_gateway_conversation_workspace_root`)                                                                                                                                                                                                                                  |
| RPC runtime allowlist                                                                                                                                                                      | `ALLOWED_METHOD_PREFIXES` at `libs/backend/vscode-core/src/messaging/rpc-handler.ts:44-88` (last entry `'update:'`)                                                                                                                                                                                                                                 |
| RPC compile-time contract shape                                                                                                                                                            | `libs/shared/src/lib/types/rpc.types.ts` barrel (child files `libs/shared/src/lib/types/rpc/rpc-*.types.ts`), `RpcMethodRegistry` entries (e.g. `'git:addWorktree'` at line 1192), `RPC_METHOD_ENTRIES` map (~line 2650+), `RPC_METHOD_NAMES` derived at line 2850                                                                                  |
| Handler class pattern (`static METHODS ... satisfies readonly RpcMethodName[]`, `register()`, injected `RpcHandler`/`WebviewManager`)                                                      | `libs/backend/rpc-handlers/src/lib/handlers/git-rpc.handlers.ts:71-104`; fan-out via `SHARED_HANDLERS` in `libs/backend/rpc-handlers/src/lib/register-all.ts:58-92`                                                                                                                                                                                 |
| Push notification precedent: `webviewManager.broadcastMessage('git:worktreeChanged', payload)`                                                                                             | `libs/backend/rpc-handlers/src/lib/handlers/git-rpc.handlers.ts:341-348`                                                                                                                                                                                                                                                                            |
| `executeSlashCommandQuery` exists; chat pipeline routes slash prompts to it automatically (`SlashCommandInterceptor` → `ChatSlashCommandRouterService` → `sdkAdapter.executeSlashCommand`) | `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts:471-500`; `libs/backend/rpc-handlers/src/lib/chat/session/chat-slash-command-router.service.ts:130`; frontend already submits `/ptah-core:orchestrate ...` as plain chat prompts (`libs/frontend/chat-ui/src/lib/molecules/setup-plugins/prompt-suggestions.component.ts:190`) |
| ViewType union + validViews                                                                                                                                                                | `libs/frontend/core/src/lib/services/app-state.service.ts:11-24` and `:109-123`                                                                                                                                                                                                                                                                     |
| Lazy-view token pattern (6 existing tokens incl. `TRIBUNAL_COMPONENT`)                                                                                                                     | `libs/frontend/core/src/lib/tokens/lazy-view-components.token.ts`                                                                                                                                                                                                                                                                                   |
| Single Angular composition root serves BOTH shells (webview build artifact is copied into VS Code and Electron renderer)                                                                   | `apps/ptah-extension-webview/CLAUDE.md` ("Same build artifact is copied into both"); token bindings in `apps/ptah-extension-webview/src/app/app.config.ts:113-121`                                                                                                                                                                                  |
| App-shell standalone-view outlet pattern (`@case` + `*ngComponentOutlet` + spinner fallback)                                                                                               | `libs/frontend/chat/src/lib/components/templates/app-shell.component.html:18-111`                                                                                                                                                                                                                                                                   |
| Electron tab strip current state (WIP, uncommitted) — tabs Canvas/Dashboard/Thoth/Tribunal/Setup/[Marketplace]/Settings                                                                    | `libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts:198-280` (read from working tree this session)                                                                                                                                                                                                                         |
| Signal-bridge request precedent for cross-lib feature launch (`HarnessWorkflowRequest`, `CanvasSessionRequest` with `resolve` callback)                                                    | `libs/frontend/core/src/lib/services/app-state.service.ts:57-86,142-153`                                                                                                                                                                                                                                                                            |
| `git:addWorktree` async-pending semantics (`operationId` + `git:worktreeChanged` echo)                                                                                                     | `libs/shared/src/lib/types/rpc/rpc-git.types.ts:75-154`; frontend awaits via correlated push in `libs/frontend/editor/src/lib/services/worktree.service.ts:62-67,216-224`                                                                                                                                                                           |
| `gray-matter` already a workspace dependency, used by two backend libs                                                                                                                     | root `package.json:147`; `libs/backend/workspace-intelligence/src/autocomplete/command-discovery.service.ts`, `libs/backend/agent-generation/src/lib/services/template-storage.service.ts`                                                                                                                                                          |
| spec-harvester legacy path to remove                                                                                                                                                       | `libs/backend/skill-synthesis/src/lib/spec-extractor.ts:65-70` (emoji `detectStatus`), `:111-131` (`isComplete` heuristics); consumed by `spec-harvester.service.ts:226-240`                                                                                                                                                                        |
| VS Code host HAS SQLite (migrations run in bootstrap; connection conditionally registered)                                                                                                 | `apps/ptah-extension-vscode/src/activation/bootstrap.ts:104`; `wire-runtime.ts:176-178` (`isRegistered(PERSISTENCE_TOKENS.SQLITE_CONNECTION)` guard pattern)                                                                                                                                                                                        |
| Electron DI seams: lib registration + handler singletons + fan-out                                                                                                                         | `apps/ptah-electron/src/di/phase-2-libraries.ts:172`, `phase-4-handlers.ts:103`, `src/services/rpc/rpc-method-registration.service.ts:92`; VS Code fan-out with exclusions at `apps/ptah-extension-vscode/src/services/rpc/rpc-method-registration.service.ts:137-151`                                                                              |
| Workspace-root normalization precedent                                                                                                                                                     | `WorkspacePathEncoder` in `libs/shared/src/lib/utils/` (shared CLAUDE.md Public API list)                                                                                                                                                                                                                                                           |

Note per tooling-precedence rule: ptah MCP first-class index tools were not used for symbol lookups in this session; the task context pre-mapped every subsystem and exact file paths were provided, so lookups were direct-path Reads/Greps (spot-verification, not discovery).

---

## 2. Design Decisions (the 8 required calls)

### D1 — Frontmatter carrier: dedicated `task.md` (NOT context.md head)

**Decision**: Each task folder carries a small, system-owned **`task.md`**: YAML frontmatter + a free markdown body (the task description shown in the card detail). `context.md` stays 100% agent-owned prose.

**Rationale** (A1 permits either; context.md is structurally hostile on the evidence):

1. **R1.5 byte-preservation**: agents (project-manager, orchestrator) rewrite `context.md` wholesale — this very task's `context.md` was fully regenerated at Checkpoint 1. Frontmatter there would be clobbered by any agent rewrite, or force merge logic into every agent write path. `task.md` is written only by `tasks:create`, `tasks:updateStatus`, and skill-instructed agents (R8) — the byte-preserving splice is trivial and race-poor.
2. **NFR-1 scan speed**: the scanner reads one tiny file per folder (`task.md`), never large report files. Legacy folders (no `task.md`) are excluded without opening anything — the 85-folder exclusion path is a single `exists` check per folder.
3. **Crisp exclusion semantics**: "no valid `task.md` → excluded" is one rule; no ambiguity about frontmatter-less context.md files that still contain prose.

**Trade-off recorded**: one extra file per folder; the orchestration skill must mandate `task.md` creation as the FIRST artifact (covered by R8 doc update). `tasks:create` writes it; agent-created tasks are born valid per the updated skill reference.

### D2 — Backend lib placement: NEW lib `libs/backend/task-specs`

**Decision**: new focused Nx lib `@ptah-extension/task-specs` owning frontmatter parse/serialize, folder scan, registry generation, task writes, and the SQLite index + watcher service.

**Rationale**:

- CLAUDE.md SOLID rule: "New libs own one concern (do NOT replicate the agent-sdk monolith)". No existing lib owns "task specs": `skill-synthesis` consumes specs for telemetry (wrong direction to host the parser — it depends on `agent-sdk`), `workspace-intelligence` is code/AST-focused, `persistence-sqlite` is a foundation lib that explicitly excludes domain queries ("each consumer owns its stores" — persistence-sqlite CLAUDE.md).
- Dependency direction works: `rpc-handlers → task-specs` (like `rpc-handlers → workspace-intelligence`) and `skill-synthesis → task-specs` (R7 shared parser) are both acyclic. `task-specs` depends only on `shared`, `platform-core` (ports), `vscode-core` (Logger token — same as skill-synthesis), `persistence-sqlite` (connection + tokens). It imports NO adapters, NO agent-sdk.
- Pattern compliance: tsyringe `register.ts` per lib, `Symbol.for(...)` tokens (`TASK_SPECS_TOKENS`), kebab-case files — matching `skill-synthesis/src/lib/di/{tokens,register}.ts`.

### D3 — Watcher acquisition: existing `IFileSystemProvider.createFileWatcher` port — no new port

**Decision**: `TaskIndexService` injects `PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER` and calls `createFileWatcher('**/.ptah/specs/**')`, filtering events to the active workspace's normalized `.ptah/specs/` prefix. Verified implementations: VS Code (`vscode.workspace.createFileSystemWatcher`), Electron (chokidar). CLI adapter implements the same interface (contract-tested via `platform-core/src/testing` mock suites); CLI never starts the watcher anyway because index start is lazy (see §5.3) and no CLI surface calls `tasks:` in phase 1 (E1).

**Precedent**: `libs/backend/workspace-intelligence/src/autocomplete/command-discovery.service.ts:166` and `agent-discovery.service.ts:195` acquire watchers exactly this way from a runtime-agnostic lib.

### D4 — Frontend composition: one new token, one outlet case, two nav buttons, one composition root

- New token `TASKS_VIEW_COMPONENT` in `libs/frontend/core/src/lib/tokens/lazy-view-components.token.ts` (peer of `TRIBUNAL_COMPONENT`).
- `app-shell.component.html`: new `@case ('tasks')` with `*ngComponentOutlet` + spinner fallback (copy of the tribunal case, lines 99-110).
- `app-shell.component.ts`: `readonly tasksComponent = inject(TASKS_VIEW_COMPONENT, { optional: true });` + `'tasks'` added to its standalone-view predicate (`isStandaloneView()`), + a VS Code-only header nav button (in the existing `@if (!isElectron)` group next to Tribunal, `app-shell.component.html:461-471` pattern) so VS Code users can reach the tab.
- **Composition root is SINGLE**: `apps/ptah-extension-webview/src/app/app.config.ts` serves both shells (same artifact copied to VS Code and Electron renderer — verified in app CLAUDE.md). Add `{ provide: TASKS_VIEW_COMPONENT, useValue: TasksViewComponent }` + `MESSAGE_HANDLERS` multi-provider for `TasksStore`. The task-description's "both composition roots" collapses to this one file; the Electron-specific work is the tab strip only.
- `electron-shell.component.ts` (⚠ UNCOMMITTED WIP — Risk R1): **additive-only** edits: one `<button role="tab">` block after the Tribunal tab (`[class.tab-active]="appState.currentView() === 'tasks'"`, `(click)="openTasks()"`), one icon import (`KanbanSquare` or `ClipboardList` from lucide-angular), one `openTasks()` method. Developer MUST re-read the file immediately before editing and stop if the tab strip has structurally changed.
- `AppStateManager`: add `'tasks'` to `ViewType` union (line 11) and `validViews` (line 109) — this alone lights up `setCurrentView`, persistence, and deep-linking.

### D5 — `tasks:` RPC surface: 7 methods + 1 push (full shapes in §6)

`tasks:list`, `tasks:get`, `tasks:create`, `tasks:updateStatus`, `tasks:generateRegistry`, `tasks:board`, `tasks:reindex`, plus push `tasks:changed`. Dual registration: new `libs/shared/src/lib/types/rpc/rpc-tasks.types.ts` + barrel export + `RpcMethodRegistry` + `RPC_METHOD_ENTRIES` entries, AND `'tasks:'` appended to `ALLOWED_METHOD_PREFIXES`. NOT added to `PRO_ONLY_METHOD_PREFIXES` (D1 of task-description: free tier). Handler `TasksRpcHandlers` in `rpc-handlers` with sibling `tasks-rpc.schema.ts` Zod schemas, added to `SHARED_HANDLERS` (included on all three hosts — VS Code has SQLite, see evidence table; graceful no-SQLite degradation in §5.4).

### D6 — Migration: `0029_task_specs`

Number **29** picked from the live tuple (last = 28). Re-verify at merge (Risk R4). DDL in §7.

### D7 — Board→orchestrate Start flow (sequence + failure story in §8)

Frontend-driven orchestration: (optional) `git:addWorktree` await via correlated push → signal-bridge `ChatPromptRequest` on `AppStateManager` (new, modeled on `CanvasSessionRequest` incl. `resolve` callback) consumed by the chat lib, which creates/focuses a session and submits `/ptah-core:orchestrate TASK_ID` as the initial prompt (the backend chat pipeline routes slash prompts to `executeSlashCommandQuery` — verified precedent, no new backend session plumbing) → on resolved success ONLY, `tasks:updateStatus(in_progress)`.

### D8 — spec-harvester surgery (details in §9)

`extractSpec` gates on the shared frontmatter parser: no valid `task.md` → `null` (folder skipped). Task-level completion = `status ∈ {done, cancelled}` from frontmatter — the `isComplete()` heuristics (state json / marker file / pending-scan) and ALL emoji regexes are deleted. Batch-level executor verdicts still come from `tasks.md` but word-token-only (`COMPLETE`/`FAILED`); rationale: R7's "frontmatter parsing ONLY" is scoped to _status/completion detection_ (task-level) — removing batch verdicts entirely would gut `harvest()`'s purpose (per-executor reconciliation). The R8 skill-doc update mandates word statuses in `tasks.md` so new specs never need emoji. **Recorded as an interpretation** — if reviewers read R7 as "delete parseBatchVerdicts too", harvest degrades to task-level-only reconciliation; flag at review.

---

## 3. Architecture Overview

```
                        FILES (source of truth)
   .ptah/specs/TASK_YYYY_NNN/task.md   ◄── tasks:create / tasks:updateStatus (byte-preserving splice)
   .ptah/specs/registry.md             ◄── RegistryGenerator (derived view, GENERATED header)
        │  scan / watch (**/.ptah/specs/**, 300ms debounce)
        ▼
┌──────────────────────── libs/backend/task-specs (NEW) ────────────────────────┐
│ task-frontmatter.ts (pure parse/serialize, Zod at file boundary)              │
│ task-scanner.service.ts (folder scan → TaskScanResult{tasks, excluded[]})     │
│ task-writer.service.ts (create + updateStatus; write→reparse→index→event)     │
│ registry-generator.service.ts (deterministic markdown table)                  │
│ task-index.store.ts (SQLite task_specs rows; DELETE+INSERT per workspace)     │
│ task-index.service.ts (lazy start, watcher, debounce, onDidChangeIndex event) │
└───────────────┬──────────────────────────────┬────────────────────────────────┘
                │ (services via DI)            │ (shared parser)
                ▼                              ▼
   rpc-handlers/TasksRpcHandlers      skill-synthesis/spec-extractor (frontmatter-only)
   7 methods + broadcasts 'tasks:changed' via WebviewManager
                │  RPC / push
                ▼
┌──────────────────────── libs/frontend/tasks-ui (NEW) ─────────────────────────┐
│ TasksStore (signals; MessageHandler for 'tasks:changed')                      │
│ TasksViewComponent → TaskBoardComponent → TaskColumn → TaskCard               │
│ TaskDetailComponent (markdown via @ptah-extension/markdown)                   │
│ TaskStartService (worktree RPC → ChatPromptRequest bridge → updateStatus)     │
└───────────────┬───────────────────────────────────────────────────────────────┘
                │ TASKS_VIEW_COMPONENT token (lazy-view pattern)
                ▼
   app-shell.component @case('tasks')  +  electron-shell Tasks tab  +  ViewType 'tasks'
```

Dependency directions (nx boundaries — all existing-legal):

- `task-specs` → `shared`, `platform-core`, `vscode-core`, `persistence-sqlite`. Never adapters, never agent-sdk, never frontend.
- `rpc-handlers` → `task-specs` (new edge; same class as its existing `workspace-intelligence` edge).
- `skill-synthesis` → `task-specs` (new edge; acyclic — `task-specs` imports nothing from `skill-synthesis`'s tree).
- `tasks-ui` → `shared`, `core`, `ui`, `markdown`. **Deviation from R5.2 recorded**: `markdown` added to the allowed list because R5.8/NFR-10 mandate the DOMPurify chokepoint for task body rendering; `chat` does the same.
- `chat` → `core` (consumes `ChatPromptRequest`); `tasks-ui` never imports `chat` (token + signal bridge inversion, same as harness/canvas).

---

## 4. Frontmatter Schema

### 4.1 Canonical `task.md`

```markdown
---
id: TASK_2026_158
status: backlog # backlog | in_progress | in_review | blocked | done | cancelled
type: FEATURE # FEATURE | BUGFIX | REFACTORING | DOCUMENTATION | RESEARCH | DEVOPS | SAAS_INIT | CREATIVE
title: Short imperative title
description: One-line summary (optional; long form goes in the body)
assignee: # reserved, phase 2
depends_on: [] # e.g. [TASK_2026_140, TASK_2026_155]
executor: # optional agent/CLI lane hint
claim: # reserved, phase 2 leases
created: 2026-07-14T10:00:00.000Z
updated: 2026-07-14T10:00:00.000Z
---

## Description

Free markdown body — rendered in the card detail through the markdown chokepoint.
```

### 4.2 Shared plain types — `libs/shared/src/lib/types/task-spec.types.ts` (NEW)

```typescript
export const TASK_STATUSES = ['backlog', 'in_progress', 'in_review', 'blocked', 'done', 'cancelled'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_TYPES = ['FEATURE', 'BUGFIX', 'REFACTORING', 'DOCUMENTATION', 'RESEARCH', 'DEVOPS', 'SAAS_INIT', 'CREATIVE'] as const;
export type TaskType = (typeof TASK_TYPES)[number];

export interface TaskValidationIssue {
  field: string;
  code: 'id_mismatch' | 'invalid_type' | 'invalid_date' | 'invalid_depends_on' | 'schema_issue';
  message: string;
}

/** Summary row — what list/board return and what the index stores. */
export interface TaskSpecSummary {
  /** Canonical id — ALWAYS the folder name (C1: folder name wins on mismatch). */
  id: string;
  folderName: string;
  status: TaskStatus;
  type: TaskType | null; // null when frontmatter type failed validation (warning, not exclusion)
  title: string;
  description?: string;
  assignee?: string; // reserved
  dependsOn: string[];
  executor?: string;
  created: string | null; // ISO 8601; null when unparseable (warning)
  updated: string | null;
  frontmatterValid: boolean; // true = zero issues
  validationIssues: TaskValidationIssue[];
}

export interface TaskSpecDetail extends TaskSpecSummary {
  body: string; // markdown body of task.md (below frontmatter)
  artifacts: string[]; // filenames present in the folder (context.md, tasks.md, ...)
}

/** Typed exclusion — folders that never enter index/registry/board (R1.2). */
export interface ExcludedTaskFolder {
  folderName: string;
  reason: 'no_carrier' | 'no_frontmatter' | 'yaml_unparseable' | 'invalid_status' | 'missing_title' | 'unreadable';
}
```

### 4.3 Zod schema (backend-side) — `libs/backend/task-specs/src/lib/task-frontmatter.ts` (NEW)

```typescript
import { z } from 'zod';
import { TASK_STATUSES, TASK_TYPES } from '@ptah-extension/shared';

export const TaskFrontmatterSchema = z.object({
  id: z.string().min(1),
  status: z.enum(TASK_STATUSES), // ESSENTIAL — invalid ⇒ excluded
  type: z.enum(TASK_TYPES).nullish(), // non-essential ⇒ warning, stored null
  title: z.string().min(1), // ESSENTIAL — missing ⇒ excluded
  description: z.string().nullish(),
  assignee: z.string().nullish(),
  depends_on: z.array(z.string()).nullish(), // non-essential ⇒ warning, []
  executor: z.string().nullish(),
  claim: z.union([z.string(), z.record(z.string(), z.unknown())]).nullish(),
  created: z.string().nullish(), // ISO validated leniently ⇒ warning + null
  updated: z.string().nullish(),
});

export type ParseTaskFileResult = { kind: 'task'; task: TaskSpecSummary; body: string } | { kind: 'excluded'; excluded: ExcludedTaskFolder };

/** NEVER throws past this boundary (R1.2). */
export function parseTaskFile(folderName: string, raw: string): ParseTaskFileResult;

/**
 * R1.5 byte-preserving mutation: locates the frontmatter block via
 * /^---\r?\n[\s\S]*?\r?\n---(\r?\n|$)/, re-serializes ONLY that block
 * (gray-matter for parse; manual splice for write), leaves every body
 * byte untouched, refreshes `updated`.
 */
export function updateFrontmatter(raw: string, patch: Partial<TaskFrontmatter>): string;
```

**Essential vs non-essential (R1.2 line drawn)**: missing carrier / no frontmatter / unparseable YAML / invalid `status` / missing `title` ⇒ **excluded** (typed reason). Everything else (id≠folder, bad `type`, bad dates, malformed `depends_on` entries, unknown extra keys) ⇒ **included with `validationIssues` warnings**; folder name wins over `id` (C1).

Parsing uses `gray-matter` (already a workspace dep, backend precedent in workspace-intelligence + agent-generation). Writes never use gray-matter's stringify for the whole file — only the frontmatter block is replaced, guaranteeing byte-for-byte body preservation incl. CRLF (NFR-8: all paths through `path.join`; workspace-root keys normalized via a single `normalizeWorkspaceRoot()` helper — `path.resolve` + lower-cased drive letter + trailing-separator strip — used by store, watcher filter, and RPC params alike).

---

## 5. Backend Components — `libs/backend/task-specs` (NEW lib)

Generate with the Nx node-lib generator matching sibling config (`libs/backend/skill-synthesis` as template: project.json, jest.config.ts, tsconfig trio, `@ptah-extension/task-specs` path mapping in `tsconfig.base.json`).

```
libs/backend/task-specs/
├── src/index.ts                          # public barrel
├── src/lib/task-frontmatter.ts           # §4.3 — pure parse/serialize (unit-test heavy)
├── src/lib/task-scanner.service.ts
├── src/lib/task-writer.service.ts
├── src/lib/registry-generator.service.ts
├── src/lib/task-index.store.ts
├── src/lib/task-index.service.ts
├── src/lib/id-allocator.ts               # pure: folder names → next TASK_YYYY_NNN
├── src/lib/normalize-workspace-root.ts
└── src/lib/di/{tokens.ts, register.ts}   # TASK_SPECS_TOKENS (Symbol.for), registerTaskSpecsServices(container)
```

### 5.1 `TaskScannerService`

- `scan(workspaceRoot): Promise<TaskScanResult { tasks: (TaskSpecSummary & {body?})[], excluded: ExcludedTaskFolder[], specsDirExists: boolean }>`
- Reads `.ptah/specs/*/` dirs (skips `.archive/`, non-dirs, dot-dirs). Per folder: `exists(task.md)` → read → `parseTaskFile`. Unreadable dir/file ⇒ excluded row with `reason: 'unreadable'` — **never throws** (NFR-5). Missing `.ptah/specs/` ⇒ `{tasks: [], excluded: [], specsDirExists: false}` no-op (R3.6).
- Uses `PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER` for I/O (hexagonal; spec-harvester's direct `node:fs` is grandfathered, new code goes through the port).
- **Hard QA gate (R2.2)**: `scan()` runs clean over the real 85-folder tree with `tasks.length === (folders with valid task.md)` and `excluded.length ≈ 85`.

### 5.2 `RegistryGeneratorService`

- `generate(workspaceRoot): Promise<{ registryPath, includedCount, excludedCount }>` — scans (never reads old registry), emits:

```markdown
<!-- GENERATED by Ptah tasks:generateRegistry — DO NOT HAND-EDIT. Derived from TASK_*/task.md frontmatter. -->
<!-- Last content change: <max(updated) of included tasks, or '-' when none> -->

# Task Registry

| Task ID | Status | Type | Title | Created | Updated |
| ------- | ------ | ---- | ----- | ------- | ------- |

...

_Excluded (no valid frontmatter): 85 folder(s)._
```

- **R2.1×R2.4 conflict resolved**: the header timestamp is `max(updated)` of included tasks — a pure function of inputs — so two runs over unchanged files are byte-identical while the header still communicates freshness. Ordering: newest-first by `created`, null-created last alphabetically by folder name (R2.4). `.archive/` excluded entirely; **no archive section in phase 1** (R2.5 choice, documented here: keeps determinism trivial; revisit if users ask).
- Write-if-changed (compare produced string with existing file) to avoid watcher self-trigger loops; the watcher additionally ignores `registry.md` events.

### 5.3 `TaskIndexService` (watcher + debounce + lifecycle)

- **Lazy start**: `ensureStarted(workspaceRoot)` invoked by every `TasksRpcHandlers` method — first call performs a full reindex and creates the watcher; keyed per normalized workspace root; `dispose()` on container teardown. No activation-file changes in any app; CLI never pays for a watcher it doesn't use.
- Watcher: `fsProvider.createFileWatcher('**/.ptah/specs/**')`; events filtered to `<root>/.ptah/specs/` prefix, ignoring `registry.md` and `.archive/`. Event → affected `folderName` extracted from path → accumulated in a pending set → **300ms debounce timer** (NFR-2) → flush: re-parse only affected folders (upsert or delete rows), bump `task_index_meta`, fire `onDidChangeIndex` (`createEvent` from platform-core) with `{workspaceRoot, folderNames, reason: 'watcher'}`. A burst of N writes in one folder ⇒ 1 index update + 1 event (R3.4/R7-risk).
- `reindex(workspaceRoot)`: full scan → `DELETE FROM task_specs WHERE workspace_root = ?` + re-INSERT in one transaction (R3.2 — equivalent-to-fresh guaranteed by construction; symbol-index precedent migrations 0008/0013).
- **Write order invariant (R3.5)**: `TaskWriterService` mutates the file first, then calls `TaskIndexService.applyFolderChange(folderName)` synchronously (reparse→row update→event `reason:'write'`). The DB is never written except from a parse of the file just written.

### 5.4 `TaskIndexStore` (SQLite) + no-SQLite degradation

- Plain store over `PERSISTENCE_TOKENS.SQLITE_CONNECTION`: `upsertMany`, `deleteByFolder`, `replaceWorkspace`, `listByWorkspace(filters)`, `getMeta/setMeta`.
- **Degradation (NFR-5/NFR-6, VS Code native-module failure case)**: `registerTaskSpecsServices` checks `container.isRegistered(PERSISTENCE_TOKENS.SQLITE_CONNECTION)` (precedent: `wire-runtime.ts:176`). When absent, it registers an `InMemoryTaskIndexStore` implementing the same `ITaskIndexStore` interface (Map-backed, rebuilt on start). Files remain truth either way; behavior of the RPC surface is identical. Both impls live in `task-index.store.ts`.

### 5.5 `TaskWriterService`

- `create(workspaceRoot, input): Result<TaskSpecSummary>` — id allocation (§below), `mkdir` folder (creating `.ptah/specs/` only now — R3.6), write `task.md` with full valid frontmatter + `## Description` body; round-trips through `parseTaskFile` with zero issues (R1.4) before returning; structured `TASK_FOLDER_EXISTS` error if the target folder exists (R4.6) — checked via `exists()` immediately before `mkdir`, and `mkdir` non-recursive on the leaf so a race still fails loudly rather than overwriting.
- `updateStatus(workspaceRoot, taskId, status): Result<TaskSpecSummary>` — read raw → `updateFrontmatter(raw, {status, updated: nowIso})` (byte-preserving splice) → write → reparse → index → event. Errors: `TASK_NOT_FOUND`, `TASK_EXCLUDED` (can't mutate an invalid-frontmatter folder), `WRITE_FAILED`.
- **Id allocation (C1/R4.6)**, pure `id-allocator.ts`: scan ALL folder names (valid + legacy + suffixed) with `/^TASK_(\d{4})_(\d{1,})/` — `TASK_2026_146_ORCHESTRA` counts as 146, `TASK_2026_HERMES` contributes nothing — take max NNN for the current year, allocate `TASK_YYYY_{max+1, zero-padded 3}`.

### 5.6 DI

```typescript
export const TASK_SPECS_TOKENS = {
  TASK_SCANNER: Symbol.for('TaskSpecsScanner'),
  TASK_WRITER: Symbol.for('TaskSpecsWriter'),
  REGISTRY_GENERATOR: Symbol.for('TaskSpecsRegistryGenerator'),
  TASK_INDEX_STORE: Symbol.for('TaskSpecsIndexStore'),
  TASK_INDEX_SERVICE: Symbol.for('TaskSpecsIndexService'),
} as const;
```

`registerTaskSpecsServices(container, logger)` — called from:

- Electron: `apps/ptah-electron/src/di/phase-2-libraries.ts` (beside `registerSkillSynthesisServices`, line 172).
- VS Code: the phase module that registers backend feature libs (`apps/ptah-extension-vscode/src/di/phase-2/3-*.ts` — team-leader locates the exact phase file beside workspace-intelligence registration; gate with `isRegistered` per app CLAUDE.md rule).
- CLI: `apps/ptah-cli` container setup beside its existing shared-lib registrations.

---

## 6. RPC Namespace (dual registration) — full shapes

### 6.1 `libs/shared/src/lib/types/rpc/rpc-tasks.types.ts` (NEW)

```typescript
import type { TaskSpecSummary, TaskSpecDetail, TaskStatus, TaskType } from '../task-spec.types';

/** Workspace scoping — same convention as GitWorkspaceScopedParams. */
export interface TasksWorkspaceScopedParams {
  workspaceRoot?: string;
}

export interface TasksListParams extends TasksWorkspaceScopedParams {
  status?: TaskStatus[];
  type?: TaskType[];
}
export interface TasksListResult {
  tasks: TaskSpecSummary[];
  excludedCount: number;
  specsDirExists: boolean;
}

export interface TasksGetParams extends TasksWorkspaceScopedParams {
  taskId: string;
}
export interface TasksGetResult {
  task: TaskSpecDetail | null;
}

export interface TasksCreateParams extends TasksWorkspaceScopedParams {
  title: string;
  type: TaskType;
  description?: string;
  dependsOn?: string[];
  executor?: string;
}
export interface TasksCreateResult {
  success: boolean;
  task?: TaskSpecSummary;
  error?: { code: 'TASK_FOLDER_EXISTS' | 'WRITE_FAILED' | 'INVALID_PARAMS'; message: string };
}

export interface TasksUpdateStatusParams extends TasksWorkspaceScopedParams {
  taskId: string;
  status: TaskStatus;
}
export interface TasksUpdateStatusResult {
  success: boolean;
  task?: TaskSpecSummary;
  error?: { code: 'TASK_NOT_FOUND' | 'TASK_EXCLUDED' | 'WRITE_FAILED'; message: string };
}

export type TasksGenerateRegistryParams = TasksWorkspaceScopedParams;
export interface TasksGenerateRegistryResult {
  success: boolean;
  includedCount: number;
  excludedCount: number;
  registryPath: string; // workspace-relative: '.ptah/specs/registry.md' (no abs-path leakage, R4.4)
}

export type TasksBoardParams = TasksWorkspaceScopedParams;
export interface TasksBoardResult {
  columns: Record<TaskStatus, TaskSpecSummary[]>; // all six keys always present
  excludedCount: number;
  specsDirExists: boolean;
}

export type TasksReindexParams = TasksWorkspaceScopedParams;
export interface TasksReindexResult {
  success: boolean;
  indexedCount: number;
  excludedCount: number;
  durationMs: number;
}

/**
 * Push notification payload for 'tasks:changed' webview messages.
 * NOT an RPC method — mirrors GitWorktreeChangedNotification's documented pattern.
 */
export interface TasksChangedNotification {
  workspaceRoot: string;
  reason: 'watcher' | 'write' | 'reindex';
  folderNames?: string[];
}
```

### 6.2 Barrel + registry edits — `libs/shared/src/lib/types/rpc.types.ts` (MODIFY)

- `export * from './rpc/rpc-tasks.types';`
- `RpcMethodRegistry` additions (git-style entries): `'tasks:list' | 'tasks:get' | 'tasks:create' | 'tasks:updateStatus' | 'tasks:generateRegistry' | 'tasks:board' | 'tasks:reindex'` each mapping `{ params: ...; result: ... }`.
- `RPC_METHOD_ENTRIES`: the same 7 keys `: true` (drives `RPC_METHOD_NAMES` + compile-time drift assertions automatically).
- Also NEW `libs/shared/src/lib/types/task-spec.types.ts` exported from the shared root barrel.

### 6.3 Runtime guard — `libs/backend/vscode-core/src/messaging/rpc-handler.ts` (MODIFY)

Append to `ALLOWED_METHOD_PREFIXES` (line 44 block): `'tasks:', // Task specs board (list, get, create, updateStatus, generateRegistry, board, reindex)`. Do NOT touch `PRO_ONLY_METHOD_PREFIXES` / `LICENSE_EXEMPT_PREFIXES`.

### 6.4 Handler — `libs/backend/rpc-handlers/src/lib/handlers/tasks-rpc.handlers.ts` (NEW)

```typescript
@injectable()
export class TasksRpcHandlers {
  static readonly METHODS = ['tasks:list', 'tasks:get', 'tasks:create', 'tasks:updateStatus', 'tasks:generateRegistry', 'tasks:board', 'tasks:reindex'] as const satisfies readonly RpcMethodName[];

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(TOKENS.WEBVIEW_MANAGER) private readonly webviewManager: WebviewManager,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER) private readonly workspace: IWorkspaceProvider,
    @inject(TASK_SPECS_TOKENS.TASK_INDEX_SERVICE) private readonly index: TaskIndexService,
    @inject(TASK_SPECS_TOKENS.TASK_WRITER) private readonly writer: TaskWriterService,
    @inject(TASK_SPECS_TOKENS.REGISTRY_GENERATOR) private readonly registry: RegistryGeneratorService,
  ) {}

  register(): void {
    // one registerMethod per METHODS entry; every method:
    //   1. Zod-parse params (tasks-rpc.schema.ts) — RpcUserError on failure
    //   2. resolve + normalize workspaceRoot (param ?? workspace.getWorkspaceRoot())
    //   3. await this.index.ensureStarted(root)   // lazy warm (§5.3)
    //   4. delegate to index/writer/registry
    //   5. catch (error: unknown) → structured { code, message } — never raw error.message with paths (R4.4)
    // constructor also subscribes: index.onDidChangeIndex(e => this.broadcastChanged(e))
    //   → webviewManager.broadcastMessage('tasks:changed', payload) (git:worktreeChanged precedent)
  }
}
```

Sibling `tasks-rpc.schema.ts` (Zod request schemas — `TasksListParamsSchema`, etc., NFR-9). Register in `handlers/index.ts` barrel + `SHARED_HANDLERS` in `register-all.ts` (compile-time coverage assertion then forces correctness). Host wiring: Electron `phase-4-handlers.ts` `registerSingleton(TasksRpcHandlers)`; VS Code — include (do NOT add to the exclude list at `rpc-method-registration.service.ts:137-151`); CLI — included via its `registerAllRpcHandlers` call automatically.

### 6.5 Push registration (frontend)

`'tasks:changed'` is dispatched by `MessageRouterService` purely by message-type string — `TasksStore` implements `MessageHandler` with `handledMessageTypes = ['tasks:changed']` and joins the `MESSAGE_HANDLERS` multi-provider in `app.config.ts`. No `MESSAGE_TYPES`/payload-map change needed (same posture as `git:worktreeChanged`, which is documented as a raw webview message in `rpc-git.types.ts:124-133`).

---

## 7. Migration DDL — `libs/backend/persistence-sqlite/src/lib/migrations/0029_task_specs.ts` (NEW)

```typescript
// Static SQL only — no `${...}` interpolation (ESLint no-template-curly-in-migration).
export const sql = `
CREATE TABLE IF NOT EXISTS task_specs (
  workspace_root    TEXT    NOT NULL,
  folder_name       TEXT    NOT NULL,
  task_id           TEXT    NOT NULL,
  status            TEXT    NOT NULL,
  type              TEXT,
  title             TEXT    NOT NULL,
  description       TEXT,
  assignee          TEXT,
  depends_on        TEXT    NOT NULL DEFAULT '[]',
  executor          TEXT,
  claim             TEXT,
  created_at        TEXT,
  updated_at        TEXT,
  frontmatter_valid INTEGER NOT NULL DEFAULT 1,
  validation_issues TEXT    NOT NULL DEFAULT '[]',
  last_indexed_at   INTEGER NOT NULL,
  PRIMARY KEY (workspace_root, folder_name)
);

CREATE INDEX IF NOT EXISTS idx_task_specs_ws_status
  ON task_specs (workspace_root, status);

CREATE TABLE IF NOT EXISTS task_specs_scan_meta (
  workspace_root    TEXT PRIMARY KEY,
  excluded_count    INTEGER NOT NULL DEFAULT 0,
  last_full_scan_at INTEGER
);
`;
```

`migrations/index.ts` (MODIFY): import + append `{ version: 29, name: '0029_task_specs', sql: sql0029TaskSpecs }`. No `vecSql`. Forward-only (NFR-7). **Re-verify 29 is still free at merge time** (Risk R4 — concurrent tasks append to this tuple). Note: excluded folders get **no row** (they're outside the system per R1.2); `frontmatter_valid=0` marks _included-with-warnings_ rows; the excluded count lives in `task_specs_scan_meta` and rides along on list/board results.

---

## 8. Board → Orchestration Start Flow (R6)

### 8.1 Sequence (happy path)

```
TaskCard "Start" (worktreeToggle: default OFF)
  │ tasks-ui TaskStartService (frontend)
  ├─[1, optional] ClaudeRpcService.call('git:addWorktree',
  │     { branch: 'task/TASK_2026_158', createBranch: true, operationId: uuid })
  │     → await correlated 'git:worktreeChanged' push (success flag)      [existing semantics]
  ├─[2] appState.requestChatPrompt({
  │       prompt: '/ptah-core:orchestrate TASK_2026_158',
  │       cwd: worktreePath ?? undefined,        // session association per existing worktree/session mechanics
  │       resolve })                              // Promise bridge, CanvasSessionRequest precedent
  │     chat lib consumer: creates/focuses a session (Electron: canvas tile path;
  │     VS Code single mode: new tab), submits the prompt through the normal send path
  │     (chat:start) — backend SlashCommandInterceptor routes it to
  │     SessionLifecycleManager.executeSlashCommandQuery (R6.1 satisfied transitively,
  │     verified pipeline: chat-session.service.ts:317 → chat-slash-command-router.service.ts:130),
  │     then appState.setCurrentView('chat')
  ├─[3] await resolve → success ONLY THEN:
  │     ClaudeRpcService.call('tasks:updateStatus', { taskId, status: 'in_progress' })
  │     (write path: file → reparse → index → 'tasks:changed' push → board updates, R6.3)
  └─[4] board reflects pushed update; no optimistic local state (R5.7)
```

**Where each step runs**: steps 1–3 are frontend (`TaskStartService` in tasks-ui + the chat-lib consumer of `ChatPromptRequest`); the only backend work is the two existing RPC namespaces plus `tasks:updateStatus`. **No new backend session plumbing** — this mirrors how prompt-suggestions already inject `/ptah-core:orchestrate` strings today.

### 8.2 `ChatPromptRequest` bridge — `libs/frontend/core/src/lib/services/app-state.service.ts` (MODIFY)

```typescript
export interface ChatPromptRequest {
  prompt: string;
  cwd?: string; // worktree path when isolation was chosen
  sessionName?: string; // e.g. 'TASK_2026_158'
  resolve?: (r: { success: boolean; error?: string }) => void;
}
// signal + readonly view + requestChatPrompt()/clearChatPromptRequest(),
// exactly mirroring _harnessWorkflowRequest / _canvasSessionRequest (lines 142-153).
```

Consumer: an effect in the `ChatStore` facade (or its `ChatLifecycleService` slice — implementer's choice within `libs/frontend/chat/src/lib/services/chat-store/`) that watches `appState.chatPromptRequest()`, performs create-session + send, resolves, clears the request. This keeps `tasks-ui` free of any `chat` import (NFR-11) and works in both shells since `ChatStore` is root-provided in the single composition root.

### 8.3 Failure / rollback story (R6.4)

- **Worktree fails** (push returns `success:false`): stop; toast with the push's error; no session, no status change.
- **Session start fails** (`resolve({success:false})`): toast; status untouched; if a worktree was created in step 1, it is **left in place** and visible in the existing editor worktree UI (one-click removal there) — documented as the phase-1 posture; auto-cleanup would need remove-orchestration we don't want in phase 1.
- **`tasks:updateStatus` fails after session started**: session keeps running (it's the valuable thing); card shows a warning badge "status not updated — retry"; retry is a plain re-call. No attempt to kill the session.
- Timeouts: worktree await reuses the WorktreeService-style correlated-push timeout; `resolve` bridge gets a 30s guard timeout → treated as failure (no transition).

---

## 9. spec-harvester Surgery (R7) — `libs/backend/skill-synthesis`

**`spec-extractor.ts` (MODIFY)**

- DELETE: `detectStatus` emoji alternates (`❌|✗`, `⏸️|🔄`, `✅` at lines 65-70) — keep word tokens `FAILED`, `PENDING|IN PROGRESS|IMPLEMENTED`, `COMPLETE` only; DELETE `isComplete()` entirely (state-json phase check, `future-enhancements.md` marker, pending-scan fallback — lines 111-131) and the now-unused `COMPLETION_MARKER_FILE`/`STATE_FILE` constants.
- CHANGE `extractSpec(dir)`: first action = read `task.md`, run the **shared** `parseTaskFile` from `@ptah-extension/task-specs` (import the pure function — no DI needed). `kind: 'excluded'` → return `null` (folder skipped, R7.2). `completed = status === 'done' || status === 'cancelled'` (R7.3).
- KEEP: `normalizeExecutor`, `parseBatchVerdicts` (word-token only), `HARVEST_MARKER_FILE`, review-file reading, `readWindow` — marker/archive mechanics unchanged (R7.2).

**`spec-harvester.service.ts` (MODIFY)** — no structural change; `readSpecs` keeps calling `extractSpec` (whose contract now enforces frontmatter). `listSpecs`/`clearStaleSpecs`/`getRecentFindings` behavior follows automatically.

**Dependency check**: adds `skill-synthesis → task-specs`. `task-specs` imports only shared/platform-core/vscode-core/persistence-sqlite ⇒ **acyclic** (verify with `nx graph` in review, NFR-11).

**Tests**: rewrite `spec-extractor.spec` fixtures to frontmatter (`task.md` + word-status `tasks.md`); add exclusion cases (no task.md, bad YAML, `status: wip`); delete emoji fixtures. Accepted consequence (Risk R8): pre-existing folders stop being harvest-eligible.

**Interpretation flag** (from D8): batch-level executor verdicts remain sourced from `tasks.md` word statuses. If the review reads "no legacy support" as banning `tasks.md` parsing wholly, the fallback is to drop `parseBatchVerdicts` and reconcile at task level only — a one-file change, but it weakens per-executor skill telemetry. Decision recorded; proceeding with word-token batch parsing.

---

## 10. Frontend Components — `libs/frontend/tasks-ui` (NEW lib)

Generate with the Nx Angular lib generator matching a small sibling (`libs/frontend/skill-synthesis-ui` as config template). Angular 21, standalone, signals + `inject()`, `OnPush` everywhere, zoneless-compatible, `track` on all `@for` (NFR-3).

```
libs/frontend/tasks-ui/
├── src/index.ts                                   # exports TasksViewComponent, TasksStore
├── src/lib/services/tasks-store.service.ts        # root-provided; signals: board, excludedCount, specsDirExists,
│                                                  #   loading, error, selectedTaskId, taskDetail;
│                                                  #   MessageHandler { handledMessageTypes: ['tasks:changed'] } → refresh;
│                                                  #   methods: loadBoard(), openTask(), updateStatus(), createTask(), reindex()
│                                                  #   ALL data via ClaudeRpcService (R5.5); no optimistic state (R5.7)
├── src/lib/services/task-start.service.ts         # §8 sequence; injects ClaudeRpcService + AppStateManager only
├── src/lib/components/tasks-view.component.ts     # page: header (New Task, Generate Registry, excluded-count chip,
│                                                  #   reindex), board, detail panel; empty state w/ create CTA (R5.6)
├── src/lib/components/board/task-board.component.ts    # 6 status columns (B1 order), one tasks:board round trip
├── src/lib/components/board/task-column.component.ts   # presentational; status-change via action menu (no DnD phase 1 —
│                                                        #   R5.7 allows "card action or column move"; DnD is a stretch)
├── src/lib/components/board/task-card.component.ts     # id, title, type badge, status, executor, depends_on indicator,
│                                                        #   validation-warning icon, Start button + worktree toggle
└── src/lib/components/detail/task-detail.component.ts  # frontmatter facts, depends_on list, validation warnings,
                                                         #   body via MarkdownBlockComponent (NFR-10) — NEVER [innerHTML]
```

**Deps**: `@ptah-extension/shared`, `core`, `ui`, `markdown` (+ `lucide-angular`, tailwind/daisyui classes). No backend libs, no `chat` (NFR-11).

### Surface wiring (MODIFY, all additive)

| File                                                                          | Edit                                                                                                                                                              |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `libs/frontend/core/src/lib/services/app-state.service.ts`                    | `'tasks'` in `ViewType` (line 11) + `validViews` (line 109); `ChatPromptRequest` bridge (§8.2)                                                                    |
| `libs/frontend/core/src/lib/tokens/lazy-view-components.token.ts`             | `export const TASKS_VIEW_COMPONENT = new InjectionToken<Type<unknown>>('TASKS_VIEW_COMPONENT');`                                                                  |
| `libs/frontend/chat/src/lib/components/templates/app-shell.component.ts`      | inject `TASKS_VIEW_COMPONENT` optional; `'tasks'` in the standalone-view set                                                                                      |
| `libs/frontend/chat/src/lib/components/templates/app-shell.component.html`    | `@case ('tasks')` outlet (clone of tribunal case, lines 99-110); VS Code header nav button in the `@if (!isElectron)` group (after Tribunal, `KanbanSquare` icon) |
| `libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts` | ⚠ WIP file (Risk R1): re-read before editing; add ONE tab button after Tribunal (lines ~233-243 pattern) + `openTasks()` + icon import. Nothing else.             |
| `libs/frontend/chat/src/lib/services/chat-store/` (one slice)                 | `ChatPromptRequest` consumer effect (§8.2)                                                                                                                        |
| `apps/ptah-extension-webview/src/app/app.config.ts`                           | `{ provide: TASKS_VIEW_COMPONENT, useValue: TasksViewComponent }`; `{ provide: MESSAGE_HANDLERS, useExisting: TasksStore, multi: true }`                          |

---

## 11. Skill Documentation Update (R8)

- MODIFY `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/orchestration/references/task-tracking.md` (**packaged source of truth** — never the junctioned `.claude/skills/` copy, Risk R5): document the `task.md` frontmatter contract (§4.1 schema + status enum), that `task.md` is the FIRST artifact of every run, that `registry.md` is GENERATED (never hand-edit), status transitions (agent sets `in_review`/`done` etc. by editing frontmatter only), and **word statuses** (`COMPLETE`/`FAILED`/`PENDING`/`IN PROGRESS`) in `tasks.md` batches — no emoji.
- Regenerate `content-manifest.json` (locate the manifest-generation script under `scripts/` or the plugin asset pipeline — verify step for the implementer; the manifest drives `ContentDownloadService` → UserLayerMirror → SkillJunction distribution).
- **Trademark constraint (R8.3/Risk R6)**: the reference text must not add `copilot|codex|claude|openai|anthropic` strings; plugin assets are runtime-downloaded and `.vscodeignore` already excludes `assets/plugins/**` — do not touch `.vscodeignore` except to extend exclusions.

---

## 12. File-by-File Change Inventory

### NEW

| Path                                                                                               | What                                                                                                                                                                                                                                                                                                                                                    |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `D:\projects\ptah-extension\libs\backend\task-specs\**`                                            | New lib (§5): `src/index.ts`, `task-frontmatter.ts`, `task-scanner.service.ts`, `task-writer.service.ts`, `registry-generator.service.ts`, `task-index.store.ts`, `task-index.service.ts`, `id-allocator.ts`, `normalize-workspace-root.ts`, `di/tokens.ts`, `di/register.ts`, specs for each, `project.json`, `jest.config.ts`, tsconfigs, `CLAUDE.md` |
| `D:\projects\ptah-extension\libs\shared\src\lib\types\task-spec.types.ts`                          | §4.2 shared types                                                                                                                                                                                                                                                                                                                                       |
| `D:\projects\ptah-extension\libs\shared\src\lib\types\rpc\rpc-tasks.types.ts`                      | §6.1 RPC types + push payload                                                                                                                                                                                                                                                                                                                           |
| `D:\projects\ptah-extension\libs\backend\persistence-sqlite\src\lib\migrations\0029_task_specs.ts` | §7 DDL                                                                                                                                                                                                                                                                                                                                                  |
| `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\handlers\tasks-rpc.handlers.ts`      | §6.4 handler                                                                                                                                                                                                                                                                                                                                            |
| `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\handlers\tasks-rpc.schema.ts`        | Zod request schemas                                                                                                                                                                                                                                                                                                                                     |
| `D:\projects\ptah-extension\libs\frontend\tasks-ui\**`                                             | New lib (§10) with specs, `project.json`, configs, `CLAUDE.md`                                                                                                                                                                                                                                                                                          |

### MODIFY

| Path                                                                                                                              | Edit                                                                                   |
| --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `D:\projects\ptah-extension\libs\shared\src\lib\types\rpc.types.ts`                                                               | barrel export + `RpcMethodRegistry` + `RPC_METHOD_ENTRIES` (7 methods)                 |
| `D:\projects\ptah-extension\libs\shared\src\index.ts`                                                                             | export `task-spec.types`                                                               |
| `D:\projects\ptah-extension\libs\backend\vscode-core\src\messaging\rpc-handler.ts`                                                | `'tasks:'` in `ALLOWED_METHOD_PREFIXES`                                                |
| `D:\projects\ptah-extension\libs\backend\persistence-sqlite\src\lib\migrations\index.ts`                                          | import + append version 29                                                             |
| `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\handlers\index.ts`                                                  | export `TasksRpcHandlers`                                                              |
| `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\register-all.ts`                                                    | add to imports + `SHARED_HANDLERS`                                                     |
| `D:\projects\ptah-extension\libs\backend\skill-synthesis\src\lib\spec-extractor.ts`                                               | §9 legacy-path removal + frontmatter gate                                              |
| `D:\projects\ptah-extension\libs\backend\skill-synthesis\src\lib\spec-harvester.service.ts`                                       | follows extractor contract (minimal/no change)                                         |
| `D:\projects\ptah-extension\libs\backend\skill-synthesis\**\spec-extractor.spec.ts` (+ harvester specs)                           | frontmatter fixtures                                                                   |
| `D:\projects\ptah-extension\libs\frontend\core\src\lib\services\app-state.service.ts`                                             | ViewType + validViews + `ChatPromptRequest` bridge                                     |
| `D:\projects\ptah-extension\libs\frontend\core\src\lib\tokens\lazy-view-components.token.ts`                                      | `TASKS_VIEW_COMPONENT`                                                                 |
| `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\app-shell.component.ts` / `.html`                     | token inject + `@case ('tasks')` + VS Code nav button                                  |
| `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\electron-shell.component.ts`                          | ⚠ additive tab button only (WIP file)                                                  |
| `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\chat-store\<slice>.ts` (+ `chat.store.ts` if facade-wired)        | ChatPromptRequest consumer                                                             |
| `D:\projects\ptah-extension\apps\ptah-extension-webview\src\app\app.config.ts`                                                    | token binding + MESSAGE_HANDLERS entry                                                 |
| `D:\projects\ptah-extension\apps\ptah-electron\src\di\phase-2-libraries.ts`                                                       | `registerTaskSpecsServices`                                                            |
| `D:\projects\ptah-extension\apps\ptah-electron\src\di\phase-4-handlers.ts`                                                        | `registerSingleton(TasksRpcHandlers)`                                                  |
| `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\di\<phase-N>.ts`                                                       | `registerTaskSpecsServices` (locate exact phase file beside feature-lib registrations) |
| `D:\projects\ptah-extension\apps\ptah-cli\src\<container setup>`                                                                  | `registerTaskSpecsServices` (beside existing shared-lib registration)                  |
| `D:\projects\ptah-extension\tsconfig.base.json`                                                                                   | path mappings `@ptah-extension/task-specs`, `@ptah-extension/tasks-ui`                 |
| `D:\projects\ptah-extension\apps\ptah-extension-vscode\assets\plugins\ptah-core\skills\orchestration\references\task-tracking.md` | §11                                                                                    |
| content-manifest.json (regenerated via its script)                                                                                | §11                                                                                    |

### NOT changed (explicit)

`PRO_ONLY_METHOD_PREFIXES`, `.vscodeignore` (except never trimmed), thoth-shell (user decision: not the surface), any shipped migration, MESSAGE_TYPES/payload-map (push rides the raw-message pattern), `worktree-hook-handler.ts` / SDK worktree plumbing (reuse as-is).

---

## 13. Test Strategy (NFR-12)

| Component                                | Tests                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `task-frontmatter.ts`                    | Pure unit: valid full/minimal frontmatter; excluded cases (no block, bad YAML, `status: wip`, missing title); warning cases (id mismatch → folder wins, bad type/date/depends_on); **byte-preservation**: body with CRLF, trailing bytes, `---` inside body code fences survives `updateFrontmatter` byte-identically; `updated` refresh |
| `id-allocator.ts`                        | Pure unit: gaps, suffixed names (`TASK_2026_146_ORCHESTRA`→146), non-numeric (`TASK_2026_HERMES` ignored), year rollover, zero-padding                                                                                                                                                                                                   |
| `TaskScannerService`                     | Mock `IFileSystemProvider` (platform-core testing mocks): mixed valid/legacy/unreadable tree; missing specs dir no-op; excluded counting                                                                                                                                                                                                 |
| `RegistryGeneratorService`               | Determinism (two runs byte-identical), ordering rule, excluded summary line, GENERATED header, write-if-changed                                                                                                                                                                                                                          |
| `TaskIndexStore` / `TaskIndexService`    | In-memory sqlite (better-sqlite3 `:memory:` + migration 29): **rebuild equivalence** (watch-updated index === fresh reindex); debounce coalescing (N events → 1 flush + 1 event); write-order invariant; no-SQLite in-memory fallback parity                                                                                             |
| `TasksRpcHandlers`                       | Method-level: Zod rejection, workspace normalization, structured errors (no path leakage), `tasks:create` collision, broadcast on index event — mirror `git-rpc.handlers` spec style                                                                                                                                                     |
| spec-extractor/harvester                 | §9 fixture rewrite; no-frontmatter skip; done/cancelled eligibility                                                                                                                                                                                                                                                                      |
| `TasksStore` / components                | Store: board load, push-triggered refresh, no optimistic transition; component specs per sibling-lib conventions (empty state, card fields, warning badge)                                                                                                                                                                               |
| **Live-tree QA (hard requirement R2.2)** | Against the REAL `D:\projects\ptah-extension\.ptah\specs\` (~85 folders + this task's): `tasks:reindex` clean, `tasks:generateRegistry` clean with excludedCount ≈ 85 and only frontmatter-bearing folders listed; timing vs NFR-1 (<2s) / NFR-4 (<100ms board) on Windows                                                               |
| Gates                                    | `npm run typecheck:all`, `npm run lint:all`, affected jest; `nx graph` boundary eyeball for the two new edges; no `--no-verify`                                                                                                                                                                                                          |

---

## 14. Team-Leader Handoff

**Developer type**: backend-developer (Batches A/B/E) + frontend-developer (Batches C/D). cli_delegation DISABLED — sub-agent developers only.
**Complexity**: XL, est. 14–20h across batches.

### Suggested batch decomposition (maximize parallelism)

| Batch                          | Content                                                                                                                                                                                                          | Executor           | Depends on                                |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ----------------------------------------- |
| **A — Contract + parser core** | shared types (`task-spec.types.ts`, `rpc-tasks.types.ts`, barrel/registry entries), new `task-specs` lib with frontmatter parser, scanner, id-allocator, writer, registry generator + unit tests; migration 0029 | backend-developer  | —                                         |
| **B — Index + RPC surface**    | `TaskIndexStore/Service` (watcher, debounce, fallback), `TasksRpcHandlers` + schemas, `ALLOWED_METHOD_PREFIXES`, `SHARED_HANDLERS`, app DI wiring (electron/vscode/cli), push broadcast + handler tests          | backend-developer  | A                                         |
| **C — tasks-ui + surface**     | `tasks-ui` lib (store, board, card, detail, empty state), ViewType/validViews, `TASKS_VIEW_COMPONENT`, app-shell case + VS Code nav button, electron-shell tab (⚠ WIP file protocol), app.config bindings        | frontend-developer | A (types only) — runs **parallel with B** |
| **D — Start flow**             | `ChatPromptRequest` bridge + chat-lib consumer, `TaskStartService` (worktree option, resolve bridge, updateStatus-on-success, failure toasts)                                                                    | frontend-developer | B + C                                     |
| **E — Harvester + skill docs** | spec-extractor/harvester surgery + fixture rewrite; task-tracking.md update + content-manifest regeneration                                                                                                      | backend-developer  | A — runs **parallel with B/C**            |
| **QA**                         | Live-tree verification (R2.2), Start-flow e2e incl. one worktree run, typecheck/lint/test gates                                                                                                                  | senior-tester      | all                                       |

### Critical verification points for developers

1. **Dual registration is review-blocking**: `rpc-tasks.types.ts` + registry entries AND `'tasks:'` prefix — missing the runtime prefix crashes silently (`rpc-handler.ts:44`).
2. **Migration number 29**: re-check the live tuple at merge (`migrations/index.ts:238`); renumber if a concurrent task landed 29.
3. **`electron-shell.component.ts` is uncommitted WIP**: re-read from the working tree immediately before editing; additive button only; STOP and report on structural conflict — never clobber, never `--no-verify`.
4. **All imports verified**: `createFileWatcher` (`file-system-provider.interface.ts:105`), `createEvent` (platform-core utils), `WebviewManager.broadcastMessage` (`git-rpc.handlers.ts:342`), `gray-matter` (package.json:147), `WorkspacePathEncoder` (shared utils), `CanvasSessionRequest.resolve` precedent (`app-state.service.ts:74-86`).
5. **No adapter imports** in `task-specs` (platform-core ports only); no backend imports in `tasks-ui`; markdown ONLY through `@ptah-extension/markdown`.
6. **Skill text**: packaged plugin path only; no trademarked strings; `.vscodeignore` untouched.

### Recorded assumptions (non-blocking)

- **A-1**: `task.md` carrier (D1) — overrides A1's context.md default under its own escape clause; PM sign-off implicit in "architect may propose a dedicated carrier ... decision recorded".
- **A-2**: Batch verdicts still parsed from `tasks.md` word statuses (D8 interpretation) — flag to reviewer.
- **A-3**: No drag-and-drop in phase 1 (status changes via card action menu) — R5.7 permits either; DnD is an enhancement.
- **A-4**: Registry timestamp = `max(updated)` (resolves R2.1×R2.4 determinism conflict).
- **A-5**: Exact VS Code DI phase file and the content-manifest regeneration script are located by the implementer (named seams verified to exist; precise filenames not load-bearing to the design).
