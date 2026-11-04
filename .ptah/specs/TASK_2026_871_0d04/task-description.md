# Tasks UI revamp requirements

## Summary

Revamp the Electron Tasks board so it follows Ptah's design language and shows each task as its actual `.ptah/specs/TASK_*/` folder. Phase 1 delivers the UI, safe markdown reading and TASK_2026_606_b6b7. Phase 2 delivers TASK_2026_358's resumable fleet runner and board surface. Preserve the capabilities in `parity-inventory.md`.

## Problem evidence

- Tasks uses a compact toolbar, board and detail (`libs/frontend/tasks-ui/src/lib/components/tasks-view.component.ts:119`, `:165`, `:565`); chat uses `bg-surface-1` and `border-surface-border` (`libs/frontend/chat/src/lib/components/templates/app-shell.component.html:117`), and Settings uses shared text, button and focus styles (`libs/frontend/chat/src/lib/settings/ptah-ai/cli-matrix-styles.ts:14`). Existing token use does not satisfy the requested visual hierarchy.
- Detail lists every folder entry but opens general entries in an editor (`libs/frontend/tasks-ui/src/lib/components/detail/task-detail.component.ts:601`, `:609`). Its inline workflow reader uses the closed `DOC_FILES` list (`libs/frontend/tasks-ui/src/lib/task-presentation.ts:379`; `libs/shared/src/lib/types/task-spec.contract.ts:93`). The backend lists all directory entries (`libs/backend/task-specs/src/lib/task-index.service.ts:587`), while `tasks:getArtifact` reads only `DocFile` (`:362`; `libs/shared/src/lib/types/rpc.types.ts:2626`). A constrained new RPC is needed for supported extra files such as `decisions.md`; `prototype/` requires directory handling.
- Carrier body and workflow documents already render through the shared markdown block (`libs/frontend/tasks-ui/src/lib/components/detail/task-detail.component.ts:460`, `:630`). It uses marked/DOMPurify (`libs/frontend/markdown/src/lib/markdown-block.component.ts:16`; `libs/frontend/markdown/src/lib/provide-markdown-rendering.ts:11`), as chat release notes do (`libs/frontend/chat/src/lib/update-dialog/update-dialog.component.ts:57`). Its default is dark prose and an `auto` theme variant exists (`libs/frontend/markdown/src/lib/markdown-block.component.ts:51`); Tasks selects no variant.
- Agent discovery includes the raw CLI version (`libs/frontend/tasks-ui/src/lib/services/task-agent-discovery.service.ts:74`); Settings normalizes it (`libs/frontend/chat/src/lib/settings/ptah-ai/cli-matrix-rows.ts:327`).
- Current Start prefills chat for review (`libs/frontend/tasks-ui/src/lib/services/task-start.service.ts:32`, `:120`); task RPC lists no owned run methods (`libs/shared/src/lib/types/rpc.types.ts:2624`).

## In scope

### Phase 1 — revamp and CLI label

- Restyle board, list, cards, filters, saved views, bulk bar, detail, dialogs and loading/empty/error states with app typography, spacing, surface, button, focus and color tokens. Make the layout work in Electron at narrow widths and in light/dark themes.
- Separate carrier metadata from `context.md` and other prose. Display canonical folder name/path, actual files and directories, presence/missing states and workflow stage. Include `task.md`, `context.md`, design, plan and review documents, legacy `tasks.md`, supported additional markdown such as `decisions.md`, and `prototype/`. Keep Open in editor and add inline reading where safe. Never render a directory as markdown.
- Extend task-spec and RPC contracts only for file types the existing `tasks:getArtifact` cannot read. Validate task identity and file choice, constrain reads to the active workspace's selected task folder, and report missing, unreadable, binary and directory states clearly.
- Render markdown through the shared marked/DOMPurify component with theme-aware prose, usable links, code, tables and overflow. Preserve safe URL handling and last-selected-file response ordering.
- Move `cliVersionLabel` to a boundary-safe public library surface shared by Settings and Tasks. Retain Settings behavior; show a normalized version once in Tasks. The current helper returns `v0.155.1` for `codex-cli 0.155.1` (`cli-matrix-rows.ts:327`).
- Reserve a visible run-panel location and frontend selection contract for phase 2, without presenting working run controls.

### Phase 2 — TASK_2026_358 (requirements only)

- Let users launch a Ptah-owned run for a task; watch run and per-stage state/output; cancel or steer eligible stages; resume interrupted runs from the Tasks board after host restart and session change.
- Persist runs and stages in Ptah SQLite. Key reusable completed stages by a content hash of stage, task id, prompt and inputs; changed inputs invalidate reuse, and dispatch order must not affect it. Make partial, failed and cancelled states explicit and recoverable.
- Dispatch through existing subagent, CLI-agent and Ptah CLI provider lanes, including mixed-provider runs. Define validated run/stage RPC, event updates and task association through host-neutral contracts.
- Use TASK_2026_357's script stage contract and fleet-orchestration skill as architecture inputs. Specify tests for restart/session resume, cache reuse/invalidation, lane dispatch, cancel/steer and board updates.

## Out of scope

- Phase 1 runner backend, persistence, dispatch, migrations or simulated working run controls.
- Redesigning chat/Settings, changing the carrier format, migrating task folders, or editing arbitrary files from Tasks.
- Removing existing board features or changing the current chat-prefill Start action into automatic status updates.

## Acceptance criteria

1. Electron Tasks board/detail follow app visual tokens and show readable controls and markdown in light/dark themes at normal and narrow widths.
2. A folder with `task.md`, `context.md`, `task-description.md`, `implementation-plan.md`, a review, `decisions.md` and `prototype/` shows actual file/directory and presence states. Carrier metadata remains distinct; folder-name identity wins over a mismatched frontmatter id.
3. Supported markdown files open inline with current content; rapid switching leaves the last selected file visible. Missing/unreadable/binary entries have explicit states. Open in editor still targets the selected artifact; directories are navigable or openable as folders.
4. Markdown headings, links, lists, tables and fenced code render in both themes; HTML/script payloads and unsafe URL schemes cannot execute/open. No untrusted content uses unsanitized `[innerHTML]`.
5. Every capability in `parity-inventory.md` stays reachable and behaves as before, including keyboard navigation, filters/views, CRUD, bulk operations, palette, sessions, validation, registry/reindex and sweep.
3a. The extra-file read rejects a path outside the selected task folder, a `..` segment, and a symlink or junction that resolves outside it; it enforces an extension allowlist and a size cap, and reports the rejection as an explicit state.
6. Tasks shows `Run through codex v0.155.1.` for the Codex sample; Settings displays the same normalized label as before. When `cliVersionLabel` returns `''`, Tasks uses the existing no-version text (`task-agent-discovery.service.ts:76`), never `Run through codex .`.
7. Phase 1 has a clear run-panel entry point/contract but no active launch/resume controls. Phase 1 is accepted without any TASK_2026_358 outcome.
7a. (Phase 2, requirements only) Phase 2 supports launch, observe, cancel/steer and resume after restart/session change, reuses an unchanged completed stage and invalidates a changed one.
8. Focus, labels, keyboard shortcuts, selection and confirmation flows remain usable by keyboard and screen reader.

## Non-functional constraints

- Electron first, with shared-host compatibility. Strict TypeScript for new code; typed, validated RPC boundaries; cross-library imports through public indexes.
- Standalone Angular OnPush components with `inject()`, signal inputs/outputs and store-owned state. Host calls only through `ClaudeRpcService` and registered message routing.
- Shared marked + DOMPurify renderer. No unsanitized `[innerHTML]`; validate file choices and constrain reads to the active workspace/task folder. Preserve URL safety and disk source of truth.

## Risks

- `DocFile` is intentionally closed (`task-spec.contract.ts:93`); extending reads must not create arbitrary path access.
- `prototype/` can contain binary files and needs separate eligibility rules.
- The markdown default assumes dark prose; light theme needs a rendered check.
- Phase-2 persistence/resume semantics require architecture against existing lane and SQLite contracts.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Deliver in two phases. | Combined implementation; staged delivery. | `decisions.md` D4 and TASK_2026_358 carrier classify runner as independent XL work. | Yes |
| Reuse shared markdown and choose theme-aware prose. | New renderer; shared renderer. | Existing Tasks block (`task-detail.component.ts:460`) and `variant='auto'` (`markdown-block.component.ts:51`). | Yes |
| Add constrained task-folder read for supported extra files. | Editor-only; arbitrary read; validated read. | Existing `tasks:getArtifact` accepts only `DocFile` (`task-index.service.ts:362`). | Yes |
| Preserve Start chat-prefill in phase 1. | Auto runner launch; current behavior. | `task-start.service.ts:32` documents review before send and no status write. | Yes |
