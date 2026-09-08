---
title: >-
  Batch 4.4 implementation report — remove the editor RPC surface,
  capabilities and push types
---

# Batch 4.4 — backend-developer report

## Outcome

GREEN. `npm run typecheck:all` passes for all 93 projects, the 13-project test
run passes (1 pre-existing flaky timeout, confirmed flaky by re-run), and lint
is clean (0 errors) across the 5 named projects. Phase 4 commit window closes.

## Files modified

**Contract removal (the batch's named files):**

- `libs/shared/src/lib/types/rpc.types.ts` — removed the `import type { EditorRevertFilesParams, EditorRevertFilesResult }` block, all 9 `editor:*` entries from `RpcMethodRegistry` (`revertFiles`, `openFile`, `saveFile`, `getFileTree`, `getDirectoryChildren`, `createFile`, `createFolder`, `renameItem`, `deleteItem`), and their 9 mirrored entries in `RPC_METHOD_ENTRIES`. Kept the `export * from './rpc/rpc-editor.types'` line — it still carries `SessionMetadataChangedNotification`.
- `libs/shared/src/lib/types/rpc/rpc-editor.types.ts` — removed `EditorRevertFilesParams`/`EditorRevertFilesResult` and rewrote the file header; `SessionMetadataChangedNotification`/`SessionMetadataChangeKind` (unrelated, actively used by `agent-sdk`) are untouched. Left the filename as-is — renaming risked touching more consumers than this batch owns.
- `libs/shared/src/lib/types/messages/message-constants.ts` — removed `EDITOR_TAB_CONTENT_REVERTED`, `FILE_TREE_CHANGED`, `EDITOR_REREAD_OPEN_TABS`. **`FILE_CONTENT_CHANGED` kept** (confirmed present, see below).
- `libs/shared/src/lib/types/messages/payload-map.ts` — removed `FileTreeChangedPayload` and `EditorRereadOpenTabsPayload` types plus their two map entries. `FileContentChangedPayload` and its map entry kept untouched.
- `libs/backend/rpc-handlers/src/lib/host-profile/manifest.ts` — deleted the `EDITOR_PANE_METHODS` const and the two `host.editorRevert` / `host.editorPane` manifest entries. `host.fileOpen` is now the only host-owned entry.
- `libs/backend/rpc-handlers/src/lib/host-profile/capabilities.ts` — removed `editorRevert` and `editorHost` from `RPC_CAPABILITIES`.
- `libs/backend/vscode-core/src/messaging/rpc-handler.ts` — removed the `'editor:'` entry from `ALLOWED_METHOD_PREFIXES`.
- `apps/ptah-electron/src/rpc-host-profile.ts` — removed the `EditorRpcHandlers` import, `editorRevert`/`editorHost` capability flags, and both `host.editorRevert`/`host.editorPane` `hostHandlers` entries.
- `apps/ptah-extension-vscode/src/rpc-host-profile.ts` — removed the `EditorRpcHandlers` import (kept `FileRpcHandlers`), the `editorRevert` capability flag, and the `host.editorRevert` `hostHandlers` entry.
- `apps/ptah-extension-vscode/src/di/phase-3-handlers.ts` — removed the `EditorRpcHandlers` import and its `container.registerSingleton(EditorRpcHandlers)` line.
- `libs/backend/cli-engine/src/lib/rpc/expected-absent.ts` — removed `editorRevert`/`editorHost` from `EXPECTED_ABSENT_CAPABILITIES`; updated the header comment ("no editor pane" phrase removed). `CLI_ONLY_ABSENT_CAPABILITIES` (`filePicker`) untouched — third list, no editor entries to begin with.
- `apps/ptah-extension-vscode/src/di/expected-absent.ts` — removed `editorHost` from `EXPECTED_ABSENT_CAPABILITIES`.
- `libs/backend/cli-engine/src/lib/rpc/rpc-surface.spec.ts` — removed the 9 `editor:*` entries from `CLI_EXPECTED_ABSENT_METHODS` and rewrote the header comment (it previously explained `editor:revertFiles` as a "declared but never registered" method; now correctly states the whole editor surface is gone from `RPC_METHOD_NAMES`).
- `apps/ptah-extension-vscode/src/di/rpc-surface.spec.ts` — removed the 8 `editor:*` entries from `VSCODE_EXPECTED_ABSENT_METHODS` (vscode never excluded `editor:revertFiles` — it serves it — so that one was never in this list) and updated the header comment.

**Not named in the batch text, edited as a necessary consequence (all verified against real compile/test failures before touching):**

- `apps/ptah-electron/src/services/rpc/handlers/index.ts` — **deleted**, plus its now-empty parent directory `apps/ptah-electron/src/services/rpc/handlers/`. See "The empty barrel" below.
- `libs/backend/rpc-handlers/src/lib/host-profile/host-profile.ts` — removed `editorRevert: false, editorHost: false,` from the `ALL_DISABLED` capability literal. Not in the batch's file list, but `capabilities.ts`'s `RPC_CAPABILITIES` and this file's `ALL_DISABLED: HostCapabilities` object must stay in lockstep — an object literal with extra keys not on `HostCapabilities` is a compile error.
- `libs/backend/rpc-handlers/src/lib/host-profile/resolve-handler-plan.spec.ts` — rewrote the three fixtures that used `'host.editorRevert'`/`'host.editorPane'` as test keys. See "The resolve-handler-plan.spec.ts consequence" below.
- `apps/ptah-extension-webview/src/app/git-status-message-routing.spec.ts` — removed the `fileTreeChanged`/`editorRereadOpenTabs` `WIRE` constants and the two assertions against `MESSAGE_TYPES.FILE_TREE_CHANGED`/`MESSAGE_TYPES.EDITOR_REREAD_OPEN_TABS`; updated the header comment. This file (an untracked, uncommitted retarget of the old `editor-message-routing.spec.ts`, already on disk before I started) still referenced the two removed constants by name — a real `TS2339` had I left it. `FILE_CONTENT_CHANGED` assertion kept.

## The empty barrel (`apps/ptah-electron/src/services/rpc/handlers/index.ts`)

**Deleted outright**, not kept as a valid empty module. Reasoning:

- After removing the `EditorRpcHandlers` import from `apps/ptah-electron/src/rpc-host-profile.ts` (the only file in this batch that referenced it), I grepped the whole `apps/ptah-electron` tree for `services/rpc/handlers` and found **zero remaining code importers** — only doc-comment mentions in `CLAUDE.md` and task specs.
- Batch 4.2's own report already documented this file as "now empty" and left it as a dangling `.ts` file with only a JSDoc explaining why — that's what produced the `TS2306: File ... is not a module` error this batch was asked to fix.
- An empty barrel with no importers is dead weight, not a seam anyone builds on next: nothing in the manifest, capability or host-profile system expects a host to keep a local RPC-handler barrel once its last class moves out. Keeping a stub `export {}` would satisfy the compiler but leave a permanently-empty file and an empty directory for no reason — the "replace, do not accumulate" rule.
- Directory `apps/ptah-electron/src/services/rpc/handlers/` was removed along with it (it contained nothing else).

## `FILE_CONTENT_CHANGED` survives

Confirmed twice: (1) it was never touched by any of my edits — I only removed `EDITOR_TAB_CONTENT_REVERTED`, `FILE_TREE_CHANGED`, `EDITOR_REREAD_OPEN_TABS`; (2) post-edit grep of `libs/shared/src/lib/types/messages/message-constants.ts` shows `FILE_CONTENT_CHANGED: 'file:content-changed',` present at line 247, and its `FileContentChangedPayload` type/map entry in `payload-map.ts` is untouched. `DiffTabsService`'s subscription is unaffected — I did not open `libs/frontend/git-ui` (out of scope for this batch; that file's own separate `EditorService` import question belongs to Batch 4.1's open item, not this one).

## Manifest / capability / host-profile / expected-absent consistency

`assertManifestInvariants` requires the manifest to partition `RPC_METHOD_NAMES` exactly. I removed the two host-owned manifest entries (`host.editorRevert`, `host.editorPane`) and the corresponding 9 `editor:*` methods from `RpcMethodRegistry`/`RPC_METHOD_ENTRIES` in the same pass, so the partition stays exact — verified by `npm run typecheck:all` passing (the manifest's `satisfies readonly RpcHandlerManifestEntry[]` and the `RpcMethodName[]` methods arrays are compile-time checked against the registry) and by both hosts' `rpc-surface.spec.ts` `partitions the RPC registry with no overlap or gap` tests passing. The two capabilities (`editorRevert`, `editorHost`) were removed from `RPC_CAPABILITIES` in the same pass as their manifest entries, `ALL_DISABLED`, both host profiles' capability flags, and both expected-absent capability lists — no host profile references a capability that no longer exists, and no manifest entry requires one either. I did not land any of these files independently; all edits went in before running verification once.

## The `resolve-handler-plan.spec.ts` consequence

This file (not in the batch's list) tests `resolveRpcHandlerPlan`'s two boot-time guards using the **real** manifest, deliberately (per its own header comment) rather than a synthetic one. Its fixtures used `'host.editorRevert'`/`'host.editorPane'` as the "host-owned" test keys — and its own comment already flagged this: _"The editor entries are the last ones out ... which makes them the stable choice here."_ Removing the editor manifest entries leaves `host.fileOpen` as the **only** entry in `HostOwnedRpcHandlerKey`, which is a real, structural consequence of this batch (not a coincidence I introduced) — a fixture pinned to `'host.editorPane'` no longer type-checks.

Three of the four tests retarget cleanly onto `host.fileOpen` (capability `fileOpen`) with no loss of coverage. The fourth — "constructs each class once even when it serves several entries" — needed a different approach: with only one host-owned key left, two DISTINCT host-owned keys sharing one class is no longer expressible against the real manifest. I retargeted it to prove the same `seen`-set dedup branch in `register-rpc-surface.ts` fires across a **lib-owned and a host-owned** entry that happen to share a constructor: `'agent'` has `requires: []` (always in the plan), so assigning its real `AgentRpcHandlers` class as the `host.fileOpen` override too forces both manifest entries onto the same ctor, and the assertion (`plan.filter(step => step.ctor === shared)).toHaveLength(1)`) still exercises the real dedup logic against the real manifest — no synthetic manifest introduced.

## Post-edit re-read confirmation (pre-commit hook stash hazard)

I did not run any git command that could trigger the stash hazard (no commit, no `git add`). `git status --porcelain` after all edits confirms every intended file is `M` (modified) or `D` (deleted, for the barrel) and nothing reverted to HEAD:

```
 M apps/ptah-electron/src/rpc-host-profile.ts
 D apps/ptah-electron/src/services/rpc/handlers/index.ts
 M apps/ptah-extension-vscode/src/di/expected-absent.ts
 M apps/ptah-extension-vscode/src/di/phase-3-handlers.ts
 M apps/ptah-extension-vscode/src/di/rpc-surface.spec.ts
 M apps/ptah-extension-vscode/src/rpc-host-profile.ts
 M apps/ptah-extension-vscode/src/services/rpc/handlers/index.ts   (from Batch 4.2 — untouched by me)
 M libs/backend/cli-engine/src/lib/rpc/expected-absent.ts
 M libs/backend/cli-engine/src/lib/rpc/rpc-surface.spec.ts
 M libs/backend/rpc-handlers/src/lib/host-profile/capabilities.ts
 M libs/backend/rpc-handlers/src/lib/host-profile/host-profile.ts
 M libs/backend/rpc-handlers/src/lib/host-profile/manifest.ts
 M libs/backend/rpc-handlers/src/lib/host-profile/resolve-handler-plan.spec.ts
 M libs/backend/vscode-core/src/messaging/rpc-handler.ts
 M libs/shared/src/lib/types/messages/message-constants.ts
 M libs/shared/src/lib/types/messages/payload-map.ts
 M libs/shared/src/lib/types/rpc.types.ts
 M libs/shared/src/lib/types/rpc/rpc-editor.types.ts
?? apps/ptah-extension-webview/src/app/git-status-message-routing.spec.ts   (untracked — pre-existing retarget from another session; I edited it further)
```

I also directly grepped every file I edited for the removed identifiers (`editorRevert`, `editorHost`, `EditorRpcHandlers`, `EDITOR_PANE_METHODS`, `'editor:'`, `EDITOR_TAB_CONTENT_REVERTED`/`FILE_TREE_CHANGED`/`EDITOR_REREAD_OPEN_TABS`) after all edits and confirmed zero remaining matches in `libs/backend/rpc-handlers/src/lib/host-profile/`, `libs/backend/vscode-core/src/messaging/rpc-handler.ts`, and `libs/shared/src/lib/types/messages/message-constants.ts`, and confirmed `FILE_CONTENT_CHANGED` is present.

## Verification — real output

### 1. `npm run typecheck:all`

**GREEN.**

```
NX   Successfully ran target typecheck for 93 projects
```

No errors. This is a full re-run after all edits landed; the three starting errors (`ptah-electron` TS2306, `ptah-extension-vscode` TS2305 x2) are gone and no new errors appeared anywhere in the 93-project graph.

### 2. `npx nx run-many -t test -p @ptah-extension/git-ui @ptah-extension/chat @ptah-extension/chat-ui @ptah-extension/core @ptah-extension/tasks-ui @ptah-extension/rpc-handlers @ptah-extension/vscode-core @ptah-extension/platform-core @ptah-extension/cli-engine @ptah-extension/shared ptah-electron ptah-extension-vscode ptah-extension-webview`

Header confirmed: `NX Running target test for 13 projects:`. Per-project results:

| Project                         | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@ptah-extension/shared`        | 54/54 suites, 1254/1254 tests — PASS                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `@ptah-extension/platform-core` | 29/29 suites, 530 passed + 4 todo / 534 — PASS                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `@ptah-extension/core`          | 26/26 suites, 596/596 — PASS                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `@ptah-extension/chat-ui`       | 23/23 suites, 131/131 — PASS                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `@ptah-extension/git-ui`        | 10/10 suites, 231/231 — PASS                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `@ptah-extension/chat`          | 64/64 suites, 990 passed + 2 skipped / 992 — PASS                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `@ptah-extension/rpc-handlers`  | **1 of 91 suites FAILED**: `skills-sh-legacy-adoption.spec.ts` — `Exceeded timeout of 5000 ms` on `is idempotent — a second sweep finds nothing left to do`. Unrelated to this batch (skills.sh legacy adoption, no editor/RPC-contract code in its path). **Re-ran in isolation** (`npx nx run @ptah-extension/rpc-handlers:test --testPathPattern=skills-sh-legacy-adoption`) — passed clean, 91/91 suites, 2687/2718 (31 skipped), 0 failed. Confirmed flaky, matching the same timeout-flake pattern the prior batch (4.2/4.3) reported for two _different_ tests in this same suite. |
| `@ptah-extension/tasks-ui`      | 17/17 suites, 584/584 — PASS                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `ptah-extension-webview`        | 8/8 suites, 143/143 — PASS                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `@ptah-extension/vscode-core`   | 28/28 suites, 484/484 — PASS                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `ptah-electron`                 | 29 of 30 suites (1 skipped, pre-existing e2e-gated skip, unrelated), 385 passed + 4 skipped / 389 — PASS                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `@ptah-extension/cli-engine`    | 17/17 suites, 169/169 — PASS                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `ptah-extension-vscode`         | 4/4 suites, 33/33 — PASS                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

Only the one flaky timeout in `rpc-handlers`, confirmed non-reproducing on re-run.

### 3. `npx nx run-many -t lint -p ptah-electron ptah-extension-vscode @ptah-extension/shared @ptah-extension/rpc-handlers @ptah-extension/vscode-core`

**GREEN.** `NX Successfully ran target lint for 5 projects` — 0 errors. All warnings are pre-existing `max-lines`/`no-unused-vars`/`no-non-null-assertion` warnings in files this batch never touched (`chat-session.service.ts`, `agent-rpc.handlers.ts`, `auth-rpc.handlers.ts`, `config-rpc.handlers.ts`, `setup-rpc.handlers.ts`, `skills-synthesis-rpc.handlers.ts`, `electron-browser-capabilities.ts`, etc.).

## Plan deviations

1. Deleted `apps/ptah-electron/src/services/rpc/handlers/index.ts` and its now-empty parent directory outright, rather than leaving a valid-but-empty module. Justified above.
2. Edited `libs/backend/rpc-handlers/src/lib/host-profile/host-profile.ts` (`ALL_DISABLED`) — required to keep `HostCapabilities`/`RPC_CAPABILITIES` in lockstep; not in the batch's file list but a direct, provable compile-time consequence of the `capabilities.ts` edit the batch did name.
3. Retargeted `libs/backend/rpc-handlers/src/lib/host-profile/resolve-handler-plan.spec.ts`'s fixtures off the now-deleted editor manifest keys, including redesigning the "constructs each class once" test since only one host-owned key remains post-batch. Not in the batch's file list, but a real compile failure (`'host.editorRevert'`/`'host.editorPane'` no longer satisfy `HostOwnedRpcHandlerKey`) that would otherwise leave the rpc-handlers test target red.
4. Edited `apps/ptah-extension-webview/src/app/git-status-message-routing.spec.ts` — an untracked file already on disk before this batch started (a retarget of the deleted `editor-message-routing.spec.ts`, apparently landed by whatever session resolved Batch 4.1's stop). It still asserted on the two now-removed `MESSAGE_TYPES` constants, which would have been a real `TS2339`/test failure in the `ptah-extension-webview` project this batch's acceptance list explicitly names.

## Out-of-scope observations

- `apps/ptah-electron-e2e/src/specs/git-watcher.spec.ts` asserts on the literal string `'file:tree-changed'` being broadcast by `GitWatcherService` in the real Electron main process — that broadcast was removed in Batch 4.3. This is a Playwright e2e spec (not part of the `test` target or this batch's acceptance list, and not exercised by `npm run typecheck:all` failing since it uses string literals, not the removed `MESSAGE_TYPES` constant), so it did not block this batch, but it will fail at `nx e2e ptah-electron-e2e` runtime until someone updates or removes it. Flagging per Batch 4.2/4.3's own precedent of flagging `perf-m3-watcher-churn.{md,script.mjs}` as stale.
- `libs/frontend/git-ui/src/lib/services/diff-tabs.service.spec.ts:32`'s `EditorService` import (flagged as an open question in Batch 4.1's report) is still unresolved — out of this batch's scope (`libs/frontend/git-ui` is not in Batch 4.4's file list) and belongs to whoever closes out Batch 4.1's remaining question.
- The pre-existing flaky-timeout pattern in `@ptah-extension/rpc-handlers` (`skills-sh-legacy-adoption.spec.ts` this run; `setup-rpc.handlers.spec.ts`/`voice-rpc.handlers.spec.ts` in the prior batch's run) looks systemic — a shared `5000ms` default timeout under machine load across several unrelated spec files in this project, worth a look independent of TASK_2026_385.
