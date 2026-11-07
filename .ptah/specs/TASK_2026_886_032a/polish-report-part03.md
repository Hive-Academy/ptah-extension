# Backlog polish report, part 03 (TASK_2026_886_032a)

Polisher: backlog-polisher-03. Scope: 28 task folders from `work/polish-part03.txt`.
No `status:` line was changed. No git, npm, nx or verify commands were run.

## Counts

- Polished: 28 (every `task.md` now has `updated: 2026-11-07`, a `>-` description, a
  `## Description` and a `## Current state (2026-11-07)` section).
- Unchanged (already current): 0.
- Notes added to history files: 6 (`context.md` of 637, 641, 645, 647, 664, 720).

## Changes

| Task | What changed | Removed old claims | Confidence |
|---|---|---|---|
| TASK_2026_635_5ea5 | Epic body plus child status list; 458 retargeted to the `cli-engine` container | "CLI crash" as a CLI-app issue; the CLI app is gone, but `cli-engine` still boots memory for worker-host and mcp-bench | med |
| TASK_2026_636_0add | Epic body plus child status list and bench location | none (all children open) | med |
| TASK_2026_637_e30b | Title "TUI storage" changed to "locale"; current Thoth tabs; children listed | TUI storage child (TUI removed, PR #892); formatSnapshot locale (already done, `cfdf00172`) | high |
| TASK_2026_638_7a8e | Epic body; current file sizes (1041/1051/1565) and dead resolve-prompt evidence | old line counts 1049/1539 | high |
| TASK_2026_640_11a5 | Epic body; closed vs open children with paths | CLI proxy placeholder child (564 cancelled); harness settings child (280 done) | med |
| TASK_2026_641_bf2b | Re-scoped to the memory UI locale only; exact `file:line` list; acceptance | TUI MemoryPanel half (`apps/ptah-tui` removed); formatSnapshot (done in `cfdf00172`, PR #957) | high |
| TASK_2026_642_fb22 | Explicit 4-step scope with current paths and the typecheck target line | none; confirmed the dead file has no importer and specs are not type-checked | high |
| TASK_2026_643_5210 | Table with 2026-11-07 line counts; rules; start condition not met | stale counts 1049/1539 | high |
| TASK_2026_645_6aaa | Full Part A/B scope on the Rail board; deliverable; pass criteria | "after 629 merges" blocker; Grid board and `gridstack-item` tree check | high |
| TASK_2026_647_1b0f | Epic narrowed to the single child 651 | 680 and 682 as open children (both cancelled after PR #877); Tribunal usage note | high |
| TASK_2026_651_2fb8 | Retargeted to the onboarding Analyze step; non-tab surface evidence | "Setup Wizard" view as the UI (replaced by onboarding, PR #877) | med |
| TASK_2026_661_6b5f | Data-window and coverage facts (subagent rows only); how to read the retired report | none; added that CLI-lane rows store `skillsLoaded: null` | med |
| TASK_2026_663_50d4 | Narrowed to §D role conflict and the OpenCode quota check | OpenCode `--standalone` (done `b33535508`); grok `ptah_web_search` (done `b0e9a54d7`) | med |
| TASK_2026_664_0ec1 | Four exact broadcaster sites; safe-kind helper to reuse | `vscode-core` `webview-manager.ts` (VS Code host only; Electron uses its own adapter, which logs `error.name`) | high |
| TASK_2026_665_17ac | Exact `failureText` lines and expected fix | none; noted that the handoff branch is already safe | high |
| TASK_2026_666_00cc | Schema bounds and the unvalidated namespace path with lines | none | high |
| TASK_2026_667_af48 | Gap restated: renderer ack only; premise re-check first | "the caller cannot tell the start failed" (the adapter returns `started: false` to the spawner); tab-close item (done in PR #724) | med |
| TASK_2026_668_dd07 | Current line 1909; start condition met | old line "about 922-925"; "start after PR 724/725" (both merged) | high |
| TASK_2026_669_fc71 | Exact map lines; where to prune; in-flight read caveat | none | high |
| TASK_2026_670_3d09 | Exact keys and lines, including the `provider.<id>.baseUrl` pattern; import bypass check | none | high |
| TASK_2026_671_d4dc | Per-key evidence table | "codexAutoApprove read by nothing" corrected: it now has RPC plumbing but no behaviour | high |
| TASK_2026_672_af5a | File list with current lines; start condition met | "start after PR #726" (merged) | high |
| TASK_2026_673_467a | Exact read/await/write lines in `collect` | none | high |
| TASK_2026_704_8918 | Steps begin with a DevTools check on main; static-search result | single-session layout as the place to reproduce (removed in PR #777) | low |
| TASK_2026_715_6cba | Start condition met; store is Claude-only; per-home seam paths | "start only after 712/714 merge" (both done) | high |
| TASK_2026_720_6f98 | Scope cut to items still open | revise rounds ignored; no lane/model score UI; null token columns; tools not shipped (all done: PR #954, `2d1c69dd2`) | med |
| TASK_2026_887_65e5 | Concrete scope for 11c and 13a-13b; 14b restated as a live Electron check | 14a parity-gate ledger (`codex-parity-gate.ts` deleted in `3736b79d5`); `PTAH_CODEX_RUNTIME_DEV` procedure | high |
| TASK_2026_888_36b0 | Design plan location and open questions; adapter capability lines | "was never started" (a design-only plan exists, unapproved) | high |

## Status proposals

| Task | Proposed status | Evidence |
|---|---|---|
| TASK_2026_647_1b0f | cancelled (or done), with TASK_2026_651_2fb8 kept as a standalone task | Only child left is 651. TASK_2026_680_bc6c and TASK_2026_682_f705 are `cancelled`. Phases 1-3 merged (PRs #733, #736, #732, #763). |
| TASK_2026_667_af48 | cancelled, if the user does not want a renderer acknowledgement | The agent-side caller already gets `{ started: false, error }` (`libs/backend/rpc-handlers/src/lib/chat/session/child-chat-session-host.adapter.ts:128,188`; `libs/backend/cli-agent-runtime/src/lib/session-children/session-spawner.service.ts:412-413`). Item 2 was fixed in PR #724. |
| TASK_2026_704_8918 | cancelled, if a DevTools check on main shows no NG0956 | The reported layout was removed by PR #777. No identity-tracked object loop found in a static search. |

## Unclear

| Task | What could not be checked |
|---|---|
| TASK_2026_704_8918 | Whether NG0956 still appears. It needs the Electron app with DevTools; not run here. |
| TASK_2026_663_50d4 | Whether an OpenCode quota error reaches the lane outcome as a usage-limit failure kind; needs a trace of the error path or a live lane. |
| TASK_2026_661_6b5f | The real start date of local `skillsLoaded` rows; needs the user's database. |
| TASK_2026_642_fb22 | The current number of hidden spec type errors; needs a spec `tsc` run (not allowed here). The three secondary TASK_2026_571 items were not re-checked. |
| TASK_2026_635_5ea5 | Whether TASK_2026_458_39c2 is already fixed: `register-thoth-libraries.spec.ts:152` tests a fallback when Track 1 throws. Child line numbers in `context.md` were not re-checked. |
| TASK_2026_667_af48 | The optional `pr724-review-r2.md` moderates (parked-tab coverage, `/clear` reply race) were not re-checked. |
| TASK_2026_720_6f98 | Item 4 leftovers (`skill_session_verdicts` writer, vestigial catalog fields) were only spot-checked; `enhance()` callers changed in PR #954 and were not traced. |
