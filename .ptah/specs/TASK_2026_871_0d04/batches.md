# Phase 1 batches — TASK_2026_871_0d04

## Scope

Phase 1 only: Electron Tasks redesign, typed folder representation, bounded inline markdown, and TASK_2026_606 CLI label. TASK_2026_358 contributes only an inactive placeholder; its runner gets a later plan. Keep the disk source of truth, carrier format, chat-prefill Start, and every capability in `parity-inventory.md`. This follows the approved `implementation-plan.md`, `design-spec.md`, and prototype. D3 assigns frontend code to Claude subagents; B1 may use a codex lane. Paths below are workspace-relative.

## Batches

### B1 — Backend filesystem and RPC

- **Goal:** Extend the existing filesystem port and expose contained, bounded markdown read and folder listing.
- **Executor:** backend-developer (codex lane permitted).
- **Dependencies:** none.
- **Files:** all B1 rows in the ownership table below. The generated host-source baseline is inspection only.
- **Acceptance:** Required `IFileSystemProvider.lstat`, `realpath`, and `readFileBoundedNoFollow` work in Electron/CLI, shared mock/contract, and independently typed fixtures. Register `tasks:readFolderMarkdown` and `tasks:listFolderEntries` in both `rpc.types.ts` locations, handler methods/schema, and Electron replay sanitizer. Zod checks request shape; service returns `rejected` for a shaped but disallowed path. Canonical workspace/task containment, direct-child lowercase `.md`, no symlink/junction, 1 MiB cap, fatal UTF-8, NUL/binary, permissions, races, depth 4, 200 entries and `too_many` are covered. Never expose absolute paths/raw errors. Add typed entries and derive legacy `artifacts`; preserve closed `DOC_FILES` and `tasks.md` fallback. Electron and CLI DI resolve the new port methods.
- **Parity rows:** 13–16 and 24 contract side; task-description criteria 3/3a.
- **Jest specs add/update:** shared eligibility predicate spec; file-system contract self spec; Electron/CLI provider specs; task-index and tasks-RPC handler specs; Electron replay sanitizer and DI smoke/resolution spec; CLI-engine container spec. Run host-source-registry contract and Electron RPC-surface guards; edit a guard only if its assertion fails. Add real junction/escape tests and mock link/race tests.
- **Verify, one at a time:** `npm run verify -- -p @ptah-extension/platform-core`; `npm run verify -- -p @ptah-extension/platform-electron`; `npm run verify -- -p @ptah-extension/platform-cli`; `npm run verify -- -p @ptah-extension/shared`; `npm run verify -- -p @ptah-extension/task-specs`; `npm run verify -- -p @ptah-extension/rpc-handlers`; `npm run verify -- -p @ptah-extension/cli-engine`; `npm run verify -- -p ptah-electron`; `npm run verify -- -p @ptah-extension/lane-routing`; `npm run verify -- -p @ptah-extension/workspace-intelligence`; `npm run verify -- -p @ptah-extension/vscode-lm-tools`; `npm run verify -- -p @ptah-extension/agent-generation`; `npm run verify -- -p @ptah-extension/output-styles`; `npm run verify -- -p @ptah-extension/memory-curator`; `npm run verify -- -p @ptah-extension/cli-agent-runtime`; `npm run verify -- -p @ptah-extension/skill-synthesis`.

### B2 — Shared CLI label

- **Goal:** Normalize CLI label once for Chat and Tasks agent discovery.
- **Executor:** frontend-developer (Claude subagent, D3).
- **Dependencies:** B1 creates the predicate before B2 exports it from shared index; other B2 work can run alongside B1.
- **Files:** B2 rows below.
- **Acceptance:** Move `VERSION_TOKEN`, `isCliProcessDump`, `cliVersionLabel` to shared; preserve Chat re-export. Export B1 predicate from shared index. `codex-cli 0.155.1` yields `Run through codex v0.155.1.`; empty/process-dump label yields exactly `Run through the codex CLI lane.`. Normalize before `if(version)`; keep fallback and zod-free public index.
- **Parity rows:** 18 label side, 19.
- **Jest specs add/update:** `cli-version-label.spec.ts`, `cli-matrix-rows.spec.ts`, `task-agent-discovery.service.spec.ts`, `index.zod-free.spec.ts`.
- **Verify, one at a time:** `npm run verify -- -p @ptah-extension/shared`; `npm run verify -- -p @ptah-extension/chat`; `npm run verify -- -p @ptah-extension/tasks-ui`.

### B3 — Folder state and reader data

- **Goal:** Extract document/folder request state behind TasksStore's public facade.
- **Executor:** frontend-developer (Claude subagent).
- **Dependencies:** B1 RPC/types, B2 shared-index export.
- **Files:** B3 rows below.
- **Acceptance:** Signal state owns task/root/entry, typed state, loading/content and breadcrumbs. One request sequence spans known-doc and extra-doc reads; another guards directory listing. Invalidate on file/task/root/close/`tasks:changed`; reject stale or mismatched results. Known docs use `tasks:getArtifact`; eligible extra markdown uses new read RPC; directories use bounded listing RPC. Preserve `tasks.md`, separate carrier body from `context.md`, derive actual versus expected missing files, validate direct-child editor target.
- **Parity rows:** 4, 9, 12–16, 21–24 data side.
- **Jest specs add/update:** `tasks-store.service.spec.ts`, `task-folder.store.spec.ts`, optional pure entries spec; cover stale responses, root switch, changed event, nested directory, legacy, typed read states and editor target.
- **Verify:** `npm run verify -- -p @ptah-extension/tasks-ui`; `npm run verify -- -p ptah-extension-webview`.

### B4 — Board and parity controls

- **Goal:** Split board shell while retaining all existing controls and keyboard behavior.
- **Executor:** frontend-developer (Claude subagent).
- **Dependencies:** B2; may overlap B3 and B5 using unchanged TasksStore/detail public APIs.
- **Files:** B4 rows below.
- **Acceptance:** Preserve six statuses, counts, list and remembered mode, roving focus/Escape/range/select-all, search/facets/sort, full saved-view lifecycle, palette, create/status, Start/chat prefill/isolation, bulk confirm/progress/cancel/retry, reindex/registry, sweep, and all empty/excluded/error/no-workspace states. Match approved tokens and widths: 220px lanes at 1280, 58px Cancelled rail, 242px scroll lanes below 1100, wrapping controls/internal scroll at 760. Checkbox and title are sibling controls.
- **Parity rows:** 1–9, 12, 18, 21–23.
- **Jest specs add/update:** tasks-view; board/card/column/list; filter/view-menu; bulk bar/summary; palette; four new shell components and their specs. Run task-start, task-prompt-context and task-views specs as parity guards.
- **Verify:** `npm run verify -- -p @ptah-extension/tasks-ui`; `npm run verify -- -p ptah-extension-webview`.

### B5 — Detail, markdown and inactive seam

- **Goal:** Split detail into overview, files, reader, activity and Phase 2 placeholder.
- **Executor:** frontend-developer (Claude subagent).
- **Dependencies:** B1 and B3; may overlap B4 with disjoint files.
- **Files:** B5 rows below.
- **Acceptance:** Keep `ptah-task-detail` selector and exact inputs/outputs used by tasks-view. Separate canonical folder/carrier/body/warnings from `context.md`; show actual file types and expected missing docs; expand directories. Reader displays loading/empty/missing/unreadable/binary/directory/too-large/rejected and editor action. Use shared `MarkdownBlockComponent variant='auto'` for body and documents, DOMPurify, safe links and overflow. Preserve metadata, relations, sessions, progress, PR. At 1280 use 248px files, 268px side, 16px gutters; at 760 stack with files max-height 290px. Placeholder says `Planned for Phase 2 · TASK_2026_358`, takes selectedTaskId/workspaceRoot nullable inputs and has no runnable controls.
- **Parity rows:** 10–17, 20.
- **Jest specs add/update:** task-detail, metadata editor, relations, and all five new detail component specs; run shared markdown-block spec. Test sanitizer binding, safe links, typed states, keyboard, selection and absence of run controls.
- **Verify:** `npm run verify -- -p @ptah-extension/tasks-ui`; `npm run verify -- -p ptah-extension-webview`.

## File ownership proof

Each exact file or set below has one editing owner. Prefixes in a row apply to every following basename. Optional files are reserved to the stated batch. Inspection-only guards and cast-backed fixtures are not edited unless an actual failure requires ownership to be assigned first.

| File(s), workspace-relative | Batch |
| --- | --- |
| `libs/shared/src/lib/types/rpc/rpc-tasks.types.ts`; `libs/shared/src/lib/types/rpc.types.ts`; `libs/shared/src/lib/types/task-spec.types.ts`; `libs/shared/src/lib/types/task-folder-markdown-eligibility.ts` and `.spec.ts` | B1 |
| `libs/backend/platform-core/src/interfaces/file-system-provider.interface.ts`; `src/testing/mocks/file-system-provider.mock.ts`; `src/testing/contracts/run-file-system-contract.ts`, `run-file-system-contract.self.spec.ts` (same platform-core root) | B1 |
| `libs/backend/platform-electron/src/implementations/electron-file-system-provider.ts`, `electron-file-system.spec.ts`; `libs/backend/platform-cli/src/implementations/cli-file-system-provider.ts`, `cli-file-system-provider.spec.ts` | B1 |
| `libs/backend/task-specs/src/lib/task-index.service.ts`, `task-index.service.spec.ts`; `libs/backend/rpc-handlers/src/lib/handlers/tasks-rpc.schema.ts`, `tasks-rpc.handlers.ts`, `tasks-rpc.handlers.spec.ts` | B1 |
| `apps/ptah-electron/src/replay/scenario-sanitizer.ts`, `scenario-sanitizer.spec.ts`; `apps/ptah-electron/src/di/expected-resolvable.ts`, `container.smoke.spec.ts`; `libs/backend/cli-engine/src/lib/container.spec.ts` (or existing container test) | B1 |
| `libs/backend/lane-routing/src/lib/matrix/capability-matrix.store.spec.ts`; `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/system-namespace.builders.spec.ts`; `libs/backend/workspace-intelligence/src/testing/mcp-contract/mcp-contract.bench.spec.ts`; `libs/backend/agent-generation/src/lib/services/generated-section-validator.spec.ts` | B1 |
| `libs/shared/src/lib/cli-version-label.ts`, `cli-version-label.spec.ts`; `libs/shared/src/index.ts`, `index.zod-free.spec.ts` | B2 |
| `libs/frontend/chat/src/lib/settings/ptah-ai/cli-matrix-rows.ts`, `cli-matrix-rows.spec.ts`; `libs/frontend/tasks-ui/src/lib/services/task-agent-discovery.service.ts`, `task-agent-discovery.service.spec.ts` | B2 |
| `libs/frontend/tasks-ui/src/lib/services/tasks-store.service.ts`, `tasks-store.service.spec.ts`, `task-folder.store.ts`, `task-folder.store.spec.ts`, optional `task-folder-entries.ts` and `task-folder-entries.spec.ts`; `libs/frontend/tasks-ui/src/lib/task-presentation.ts` if needed | B3 |
| `libs/frontend/tasks-ui/src/lib/components/tasks-view.component.ts`, `tasks-view.component.spec.ts`, `task-board-header.component.ts`, `task-board-header.component.spec.ts`, `task-board-states.component.ts`, `task-board-states.component.spec.ts`, `task-create-dialog.component.ts`, `task-create-dialog.component.spec.ts`, `task-maintenance-dialog.component.ts`, `task-maintenance-dialog.component.spec.ts` | B4 |
| `libs/frontend/tasks-ui/src/lib/components/board/task-board.component.ts`, `task-board.component.spec.ts`, `task-column.component.ts`, `task-column.component.spec.ts`, `task-card.component.ts`, `task-card.component.spec.ts`, `task-list.component.ts`, `task-list.component.spec.ts` | B4 |
| `libs/frontend/tasks-ui/src/lib/components/filter/task-filter-bar.component.ts`, `task-filter-bar.component.spec.ts`, `task-view-menu.component.ts`, `task-view-menu.component.spec.ts`; `components/bulk/task-bulk-bar.component.ts`, `task-bulk-bar.component.spec.ts`, `task-bulk-summary.component.ts`, `task-bulk-summary.component.spec.ts`; `components/palette/task-command-palette.component.ts`, `task-command-palette.component.spec.ts`, `palette-entries.spec.ts` (all under same tasks-ui src/lib root) | B4 |
| `libs/frontend/tasks-ui/src/lib/components/detail/task-detail.component.ts`, `task-detail.component.spec.ts`, `task-metadata-editor.component.ts`, `task-metadata-editor.component.spec.ts`, `task-relations.component.ts`, `task-relations.component.spec.ts` | B5 |
| `libs/frontend/tasks-ui/src/lib/components/detail/task-folder-overview.component.ts`, `task-folder-overview.component.spec.ts`, `task-folder-files.component.ts`, `task-folder-files.component.spec.ts`, `task-document-reader.component.ts`, `task-document-reader.component.spec.ts`, `task-activity.component.ts`, `task-activity.component.spec.ts`, `task-run-placeholder.component.ts`, `task-run-placeholder.component.spec.ts` | B5 |

B1 alone owns shared types/predicate; B2 alone owns shared index, strictly after the predicate exists. B3 alone edits TasksStore; B4/B5 use its public API. B4 alone edits tasks-view; B5 retains detail's public interface. Any B4 shell integration after B5 is a strictly ordered B4 follow-up, never concurrent ownership.

## Execution order

1. Dispatch B1 and B2 concurrently (2 slots); B2 waits for B1's predicate before the shared-index export. Verify B1 before integrating B2's export.
2. After B2, dispatch B3 and B4 concurrently (2 slots).
3. After B3, dispatch B5; it may overlap B4. Never exceed three active executors.
4. Verify returned files against the ownership table and all 24 parity rows. Run scoped project checks one at a time, inspect rendered Electron dark/light screenshots at 1280 and 760 against the approved prototype, resolve owner-specific findings, then gate phase completion on the code-logic review. No workspace-wide verify or e2e run.

## Stress-test notes

- The approved B1 census (plan lines 25–40) covers production adapters, core mock/contract, `MemoryFiles`, three independently typed test objects and cast-backed fixtures. Audit those cast fixtures for reachable new read/list paths. Required methods must not become optional. The B1 verify list includes every census project.
- The host-source registry regex excludes these `tasks:` names; its baseline remains untouched. `tasks:` is already allowlisted. A changed guard requiring regeneration needs the orchestrator/Gate 2 exception.
- Existing file opener is a file route, so `prototype/` needs B1's bounded listing RPC. Nested editor opening requires independent host authorization; B3/B5 still show navigable directory entries.
- Schema validates string shape; service returns `rejected` for a string that violates path policy. B3/B5 display it as a state. This preserves criterion 3a.
- Existing closed `readArtifact` and `task.md` reads stay within the approved plan. Review host-side `openArtifact` containment before using a new editor target; report a discovered escape to the orchestrator.
- Jest cannot prove dark/light contrast, widths, focus, or scroll containment. Electron screenshots and parity-by-row review are mandatory before completion.

## Decisions

| Decision | Options, evidence | Reversible |
| --- | --- | --- |
| Use B1/B2 overlap, then B3/B4 overlap, then B5 after B3. | Approved plan lines 7–9, 42–60 specify these dependencies; D3 fixes frontend executor. | Yes |
| Let B2 export B1's predicate only after B1 creates it. | Shared index is B2-owned; predicate is B1-owned. | Yes |
| Treat derived guard specs as run-only until an explicit assertion fails. | Plan line 13 identifies derived RPC surface and unchanged host-source regex. | Yes |
| Leave Phase 2 runner outside this batch graph. | D4 and approved plan reserve only the inactive seam. | Yes |

## Clarifications Needed

None for decomposition. Any discovered baseline regeneration, public capability removal or architecture change goes to the orchestrator before that dependent work.

### Next action:

Dispatch B1 to backend-developer and B2 to a Claude frontend-developer subagent concurrently; B2 waits for B1's predicate before editing shared index.

