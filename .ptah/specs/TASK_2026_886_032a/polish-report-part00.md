# Backlog polish report, part 00 (TASK_2026_886_032a)

Polisher: backlog-polisher-00. Input: `work/polish-part00.txt` (37 tasks). Base: `origin/main` 390808edf.
Method: read each `task.md`, skim the other files in the folder, check the concrete claims with a
few targeted greps, then edit `task.md` with Edit only. No `status:` line was changed (checked
with `git diff`). No absolute workstation paths were written.

## Counts

| Item | Count |
|---|---|
| Tasks polished (`task.md` edited, `updated:` set, `## Current state (2026-11-07)` added) | 37 |
| Tasks unchanged (already current) | 0 |
| History files that got the out-of-date note | 14 files in 11 tasks |

History files with the note: TASK_2026_155 (`task-description.md`, `implementation-plan.md`),
TASK_2026_241 (`context.md`), TASK_2026_246 (`context.md`), TASK_2026_279 (`context.md`),
TASK_2026_313 (`context.md`), TASK_2026_338 (`context.md`), TASK_2026_362
(`implementation-plan.md`, `batches.md`, `task-description.md`), TASK_2026_386 (`context.md`),
TASK_2026_388 (`batches.md`), TASK_2026_423_bc0d (`context.md`), TASK_2026_428_8f87 (`context.md`).

## Table

| Task ID | What changed (one line) | Removed old claims (short) | Confidence |
|---|---|---|---|
| TASK_2026_155 | Imperative title; scope is the Electron-only /goal stack; added Description and state | VS Code and CLI host containers in the plan | high |
| TASK_2026_241 | Narrowed to an optional group-by-target view | "nothing aggregates Smithery/OAuth lists" (done in `e4dc3c03c`) | high |
| TASK_2026_246 | Batch 0 marked done; current file sizes; open batches listed | 1642-line figure, lib `CLAUDE.md:51`, VS Code consumer | high |
| TASK_2026_266 | Short title and description; work list with current paths | none wrong; dated row counts flagged as history | high |
| TASK_2026_269 | Remaining work is the watcher-driven regenerate; mitigations noted | drift figures stated as current | high |
| TASK_2026_274 | Current `spawnCli`/`probeCliVersion` lines | "all three hosts are plain Node", `cli-adapter.utils.ts:202-230` | high |
| TASK_2026_275 | Current sizes (1055 / 1035 lines) | 961 and 706 line figures | high |
| TASK_2026_276 | Work list; workspace decision shown as `given` uv today | none wrong | high |
| TASK_2026_279 | Marker plus adoption only; deep verify and blocked repair marked done elsewhere | `ptah harness doctor` CLI, deep-verify item, lib `CLAUDE.md` | med |
| TASK_2026_281 | spawnFromSdkHandle item closed for the Ptah CLI path; current file size 1066 | 909-line figure, spawnFromSdkHandle gap | med |
| TASK_2026_284 | Narrowed to a `pi` target plus an opencode skills/commands decision | "opencode gets no harness" (done in `849cf7108`), tribunal lanes | high |
| TASK_2026_289 | Decision task with yes/no outcomes | none wrong | high |
| TASK_2026_292 | `>-` description; next-turn field work list with paths | Tribunal duplicate-tile symptom | high |
| TASK_2026_300 | Narrowed to bare `path:line` and fenced diffs | "five extensions", file links not clickable, "WEB product" wording | high |
| TASK_2026_302 | Current spec approach (source pinning) and the files to change | "mirror the override snippet verbatim" | high |
| TASK_2026_311 | Refund gap with current lines; `provider-unsupported` refund noted | "refunds only on network-backoff" | high |
| TASK_2026_313 | Narrowed to the Marketplace badge e2e | Dashboard card cap half, `ptah-extension-vscode-e2e` | high |
| TASK_2026_338 | Electron-only shutdown wiring plus the race fix, current lines | VS Code `deactivate()` / `PtahExtension.dispose()`, `shutdown.ts:103-144` | high |
| TASK_2026_339 | Paths and lines for both callers and the default param | `--activate` read as a CLI flag | high |
| TASK_2026_355 | Current counts (131 in 8 files) and a per-file list | 344 in 65 files | high |
| TASK_2026_358 | `>-` description; work list with current paths | tribunal lanes | med |
| TASK_2026_362 | Reframed as merge-or-park decision; branch 6051 commits behind | "1,228 behind", VS Code/CLI/TUI composition roots | high |
| TASK_2026_369 | Work list with current transformer and marker lines | `chat-view.component.html:54` | high |
| TASK_2026_386 | Narrowed to create-PR and merge actions; shipped pieces listed | Monaco replacement, `@codemirror/merge`, missing launcher and ref diff | med |
| TASK_2026_388 | Short description; skip removed-host steps in `batches.md` | VS Code and CLI DI files as work items | high |
| TASK_2026_391 | Narrowed to the text/Zod-fail arm; tools-only and silent marked done | fall-through covering all no-JSON outcomes | high |
| TASK_2026_407 | Reproduce-first plan with a cancel-if-not-reproduced exit | none wrong | med |
| TASK_2026_415 | Two items with current call sites and fs lines | none wrong | high |
| TASK_2026_422_dee6 | Fallback-only bug; `acknowledgeUserPrompt` mitigation noted | `~1541` line, "always the first bubble" | high |
| TASK_2026_423_bc0d | Retargeted from the codex-sdk path to the Ptah-owned app-server process | SDK `CodexExec.run` kill path | med |
| TASK_2026_424_b6bf | Current loop and status-case lines | `~347` line | high |
| TASK_2026_425_b4f3 | Current boundary call sites and finalization file | none wrong | med |
| TASK_2026_428_8f87 | Two existing primitives named; list of untrapped dialogs | "showModal() is rejected", "none traps focus", PR #500 dialog as open | med |
| TASK_2026_429_ba4e | Narrowed to the not-found text and a stuck signal | "completed agent vanishes" (TTL and restore done), polling pain (PR #555) | med |
| TASK_2026_436_7729 | Role channel marked done; core prompt and instructions facet remain | "lanes get only the enhanced prompt in the task message" | med |
| TASK_2026_447_035a | Two fix options with paths; unused `rebuildConceptsIndex` noted | none wrong | high |
| TASK_2026_450_8383 | Fixes landed; remaining is a CI-history check or a root-cause fix | flat 15 s deadline, `stress.harness.ts:734` | med |

## Status proposals

| Task ID | Proposed status | Evidence |
|---|---|---|
| TASK_2026_241 | done (or keep backlog only if a group-by-target view is still wanted) | `e4dc3c03c`; `libs/backend/cli-agent-runtime/src/lib/mcp-directory/mcp-install.service.ts:381-583` merges harness-config, claude-user, smithery and oauth rows; `installed-servers-page.component.ts:172` filters by origin and target |
| TASK_2026_362 | cancelled or blocked (user decision: rebuild or park) | branch `feat/native-agent-loop-pi-ai` is 15 commits ahead and 6051 behind `origin/main`; none of its seven libs exist on main |
| TASK_2026_450_8383 | done, if CI shows no AC-7 failure since 2026-09-20 | `c0670a9e8`, `aacf99591`, `7a225c06f` changed the harness; derived timeout at `workspace-watch-host.stress.harness.ts:746-751` |
| TASK_2026_407 | cancelled, if it does not reproduce on current main | streaming path rebuilt (#751, #830/#844, #847); no reproduction on record |
| TASK_2026_386 | keep backlog, narrowed (or split the create-PR/merge actions into a new task and close this one) | git dock `239f8013e`, `git:reviewChanges`, `git:turnChangeSets`, `IEditorLauncher` + Electron adapter, `editor:*` RPCs all on main |

## Unclear

| Task ID | What could not be checked |
|---|---|
| TASK_2026_407 | No reproduction; investigation-only task. |
| TASK_2026_450_8383 | CI flake history after 2026-09-20 (no CI access in this pass). |
| TASK_2026_423_bc0d | Whether the PowerShell child outlives `codex.exe` on the app-server path needs a Windows measurement. |
| TASK_2026_424_b6bf | Whether the Cursor stream ends after a terminal status needs a live run. |
| TASK_2026_429_ba4e | Defect 2 (finished agent never reaching `completed`) per adapter was not re-measured. |
| TASK_2026_428_8f87 | The 9 untrapped files come from a grep; some may hold the class without being a dialog. |
| TASK_2026_386 | The full acceptance list in `context.md` was not walked item by item. |
| TASK_2026_369, TASK_2026_391, TASK_2026_429_ba4e, TASK_2026_436_7729 | Frontmatter has no `id:` field. Left as is per the brief (keep fields as they are). |
