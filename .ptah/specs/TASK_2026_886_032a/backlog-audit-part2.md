# Backlog audit, part 2 (TASK_2026_886_032a)

Auditor: backlog-auditor-2. Code base: worktree `task-status-sweep` = origin/main `390808edf` (2026-11-07).
Input: `work/backlog-part2.txt` (77 tasks, all `status: backlog`). Read-only audit. Nothing was edited.

## Summary counts

| Verdict | Count |
|---|---|
| ALREADY_DONE | 15 |
| OBSOLETE | 4 |
| DUPLICATE | 0 |
| PARTIAL | 11 |
| STILL_VALID | 43 |
| UNCLEAR | 4 |
| **Total** | **77** |

Recommended status changes: 15 to `done`, 4 to `cancelled`. Keep the other 58 as `backlog`. Several
PARTIAL tasks need a re-scope note.

Changes since the 2026-10-30 backlog triage (`198256189`, `5e3911d68`) that drive most verdicts:

- PR #892 (`1cee6fafe`, 2026-11-02) removed the TUI, CLI (`apps/ptah-cli`) and VS Code hosts. CLI and TUI items are obsolete.
- PR #877 (2026-11-01) replaced the setup wizard and hub with `libs/frontend/onboarding` and deleted the harness builder view.
- `b69359901` (2026-11-03) moved the video tooling to the external nx-video workspace.
- PRs #855-#961 (2026-10-30 to 2026-11-07) delivered the 853-879 tasks. Their task.md files were never closed.

## Table

| Task ID | Title (short) | Verdict | Evidence | Recommended status | Confidence |
|---|---|---|---|---|---|
| TASK_2026_558_f761 | e2e must not write real ~/.gemini MCP config | STILL_VALID | `apps/ptah-electron-e2e/src/support/electron-launcher.ts` isolates userData and `PTAH_DB_PATH` but not HOME/USERPROFILE (lines 52-69, 110). The agy adapter writes `~/.gemini/config/mcp_config.json` with `HOME`-first resolution (`antigravity-cli.adapter.ts:615-636`). The leak was never confirmed on disk. | backlog | med |
| TASK_2026_560_2ae5 | Per-workspace/global MCP+skill on/off controls | PARTIAL | PR 1 batches landed (e.g. `e39b65b1e`, `c38a55204`). The 10-30 audit lists the PR 2 items as open: Codex/OpenCode/agy enforcement, Marketplace skills/plugins pages, schema-size measurement. The "CLI proxy", "CLI warning print" and "Ptah CLI unverified notice" items are now obsolete (PR #892). | backlog (re-scope) | med |
| TASK_2026_561_9e57 | Remaining TASK_2026_559 Track B follow-ups | PARTIAL | The compaction layer shipped (PRs #634, #647, #755). Track B items B1-B9 were not checked one by one (10-30 triage: PARTIAL). | backlog | low |
| TASK_2026_562_4b1d | Token efficiency (tokaudit Waves 2 and 4) | PARTIAL | Items 2.1, 2.4 and 2.5 are duplicated in TASK_2026_634_daec Stage A.1 (context.md triage). Items 2.6, 4.1, 4.2 and 4.6 are unique to this task and still open. | backlog (drop 2.1/2.4/2.5) | med |
| TASK_2026_564_87a6 | ptah-cli Anthropic proxy placeholder tools | OBSOLETE | Its target `apps/ptah-cli/src/services/proxy/anthropic-proxy.service.ts` was deleted in `1cee6fafe` (PR #892). There are no `skill__` placeholders left in `libs`. | cancelled | high |
| TASK_2026_565_e8e4 | Inert cross-encoder rerank | STILL_VALID | `embedder-worker.ts:260-295`: `rerank()` calls the default text-classification pipeline, and `extractScore` takes `entry[0].score`. There is no sigmoid or `function_to_apply`, and no fix commit (`softmax` grep returns nothing). | backlog | med |
| TASK_2026_566_9a50 | Tier-2 merge candidates D4 A vs B | STILL_VALID | Owner decision still pending. `merge-candidate-collector.ts:3,22-24` still has the shipped tier-2 policy. | backlog | med |
| TASK_2026_567_90d4 | Extract-prompt over-suppression | STILL_VALID | No tuning or re-measure commit since the 10-30 re-scope (`5e3911d68`). | backlog | low |
| TASK_2026_568_3933 | Classify/quarantine remaining sediment | STILL_VALID | No sediment classifier in `libs/backend/memory-curator/src` (grep returns nothing). | backlog | med |
| TASK_2026_572_07c4 | UI/CLI to list and restore quarantined memories | PARTIAL | The RPCs exist (`memory-rpc.handlers.ts:175-176`). The memory UI shows counts only (`storage-health-panel.component.ts:194-247`) and has no list or restore. The CLI subcommand half is obsolete (CLI host removed, PR #892). | backlog (re-scope to UI only) | high |
| TASK_2026_573_e2bf | Quarantine test gaps (node:sqlite, pin restore) | STILL_VALID | `quarantine.round-trip.spec.ts` accepts either opener (line 197) but has no unpin-then-restore case. Whether node:sqlite was actually exercised was not checked. | backlog | med |
| TASK_2026_577_cbfb | Scheduled reversible consolidation of near-dupes | STILL_VALID | No consolidation job in memory-curator (grep `consolidat` returns nothing). | backlog | med |
| TASK_2026_579_f2e2 | Curator provider fallback list | STILL_VALID | No fallback-provider logic in `memory-curator/src/lib/curator-llm` (grep returns nothing). | backlog | med |
| TASK_2026_581_2af1 | Apps page live transcript + chat-input composer | STILL_VALID | `apps-page.component.ts:214-224` still uses a plain `<textarea>`, not `ptah-chat-input`. The live-update half was not verified. | backlog | med |
| TASK_2026_582_a7db | Move video tooling to a new public repo | ALREADY_DONE | `b69359901` (2026-11-03): "video studio, HyperFrames tools, showcase manifest ... now live outside this repository (copied to the nx-video workspace)". `apps/ptah-video-studio` and `tools/hyperframes` are gone. The new repo's Nx plugin could not be checked from here. | done | med |
| TASK_2026_585_3704 | Live-session QA evidence for Apps page | STILL_VALID | Manual live QA. The Apps page still exists (`app.routes.ts:159`), and `fa30cf034` closed 494 but left these 3 items. | backlog | low |
| TASK_2026_587_bffd | Thoth Overview tab | STILL_VALID | `thoth.routes.ts:38-43` has no overview tab, and there is no "overview" in thoth-shell. | backlog | high |
| TASK_2026_598_e8df | Confirm before active-provider key change/login | STILL_VALID | `sdkAdapter.reset()` is still called with no session-count confirm at `interactive-login-methods.ts:87,243,270`, `kimi-code-login-methods.ts:118` and `connection-settings-methods.ts:135`. | backlog | med |
| TASK_2026_599_8684 | Fixed text for unexpected RPC errors | STILL_VALID | `libs/backend/vscode-core/src/messaging/rpc-handler.ts:246-256` still returns `error: errorObj.message`. | backlog | high |
| TASK_2026_600_42e6 | `ptah auth test` exit code | OBSOLETE | The CLI host (`apps/ptah-cli`) was removed in PR #892 (`1cee6fafe`). | cancelled | high |
| TASK_2026_601_d4a1 | Cursor split-key and agy status-line gaps | STILL_VALID | Filed after `21060eff4`. `AGY_STATUS_LINE_START` (`antigravity-cli.adapter.ts:235`) does not match "Please sign in", so the legacy parser still lists it as a model. Cursor `redactSegment` works per segment and has no cross-delta buffer. | backlog | med |
| TASK_2026_602_0427 | Unreadable key in setup wizard; stale check verdict | STILL_VALID | `providers-settings.component.ts:684-690` still has `wizardCredentialStored = hasKey === true`. `connection-check.ts` has no "superseded" result. This is the provider-connection wizard in Settings, not the removed setup wizard. | backlog | med |
| TASK_2026_603_b573 | Failed settings write lands with next save | STILL_VALID | `file-settings-manager.ts:147-175` rollback (from `d1b1469a3`, before the task was filed) restores the previous in-memory value. There is no persisted-snapshot tracking. | backlog | med |
| TASK_2026_604_e720 | Oversized settings files under 700 lines | STILL_VALID | The files grew: providers-settings-state.service.ts is 1056 lines, file-settings-manager.ts 836, settings-reachability.table.ts 1825 and styles.css 4084. | backlog | high |
| TASK_2026_605_3772 | Type-check chat/core/ui spec files in CI | STILL_VALID | `libs/frontend/{chat,core,ui}/project.json` typecheck runs `ngc --noEmit --project .../tsconfig.lib.json` only. There is no spec target. | backlog | high |
| TASK_2026_606_b6b7 | Normalised CLI version in tasks UI | ALREADY_DONE | `600ceae65` "normalize the CLI version label", merged in PR #917 (body cites TASK_2026_606_b6b7). | done | high |
| TASK_2026_607_7158 | Electron shell sidebar contrast | UNCLEAR | The "Hide Workspaces" label is no longer in the code, and the sidebar was reworked (#819, glass themes #805). The active-workspace colour needs re-measuring with axe. | backlog | low |
| TASK_2026_608_a141 | Settings focus/disabled/table-header styles | UNCLEAR | No targeted commit found. Settings was regrouped (#838) and themes changed since then. Needs a visual re-check. | backlog | low |
| TASK_2026_611_8fe7 | TASK_2026_609 follow-ups | UNCLEAR | Mixed list. The wizard edge cases are obsolete (#877 removed the wizard). The rest (harness snapshot, Windows key casing, Agents-tab layout) were not checked. | backlog (re-scope) | low |
| TASK_2026_613_8f34 | Ship token-saving rules to all users + Settings | STILL_VALID | No 150k/60-call relay rule or maxTurns in `plugins/ptah-core`. The 10-30 audit lists the same items as open. | backlog | med |
| TASK_2026_618_c8f4 | Robust linked-worktree re-listing test | STILL_VALID | `apps/ptah-electron/src/services/git-watcher.real-git.spec.ts:45` still has `PUSH_TIMEOUT_MS = 3_000`. The file has not changed since `a3450c372` (2026-10-06). | backlog | med |
| TASK_2026_619_af7f | Fix code-intel/memory MCP tools vs mcp-bench | PARTIAL | Phase 1 shipped in PR #672 (`ffeea1657`). Phase 2 (per-tool fixes, eager tool set) is open according to the 10-30 audit, and no later commits were found. | backlog | med |
| TASK_2026_622_2d05 | 0xC0000409 in SQLite close (WAL checkpoint) | STILL_VALID | `persistence-sqlite/src/lib/sqlite-connection.service.ts:524-530` still runs `wal_checkpoint(TRUNCATE)` at close. No fix commit found. | backlog | med |
| TASK_2026_624_d671 | Memory bench cassettes, provenance gate, scored run | STILL_VALID | Only a provenance comment exists (`recorded-curator-llm.ts:211`). No scored memory run is recorded, and the paid calls need user approval. | backlog | low |
| TASK_2026_630_2250 | Display panel follow-ups from 623 | PARTIAL | Items 1, 2 and 5 were done in PR #704 (`905419699`, `540633ddb`). Items 3, 4 and 6-9 are open. The unified display panel (PR #943) may make some of them obsolete. | backlog (re-check vs #943) | low |
| TASK_2026_634_daec | Remaining TASK_2026_614 token-burn stages | STILL_VALID | A 10-12 code check found no Stage A/B/C. No later commit cites 634 or 614 stages. | backlog | low |
| TASK_2026_635_5ea5 | Epic: memory reliability | STILL_VALID | The children are still open (622, 579, ...). The "CLI crash on memory registration" child is obsolete (PR #892). | backlog | med |
| TASK_2026_636_0add | Epic: memory quality measured | STILL_VALID | The children are open: 565, 566, 568, 577, 619 and 624. | backlog | med |
| TASK_2026_637_e30b | Epic: Thoth UI | PARTIAL | Children 587 and 572 (UI) are open. The TUI-storage child (641 TUI half) is obsolete after PR #892. | backlog | med |
| TASK_2026_638_7a8e | Epic: memory code health | STILL_VALID | The children are open: 642, 643 and 573. | backlog | med |
| TASK_2026_640_11a5 | Epic: skills distribution to CLIs | PARTIAL | The CLI-proxy-placeholder child (564) is obsolete. The other children (provenance markers, CLI-lane capability enforcement, pi target) were not checked. | backlog (re-scope) | low |
| TASK_2026_641_bf2b | TUI storage health + pin diagnostics locale | PARTIAL | The TUI half is obsolete (TUI removed, PR #892). The locale half is still open: `toLocaleString()` at `corpus-list.component.ts:296`, `memory-curator-tab.component.ts:409` and `timeline-view.component.ts:175`. | backlog (re-scope to locale) | high |
| TASK_2026_642_fb22 | memory-curator hygiene (dead resolve-prompt.ts, spec types) | STILL_VALID | `libs/backend/memory-curator/src/lib/curator-llm/resolve-prompt.ts` still exists. | backlog | med |
| TASK_2026_643_5210 | Split oversized memory-curator files | STILL_VALID | The files are now 1041 lines (memory.store.ts), 1051 (memory-curator.service.ts) and 1565 (memory-trigger.service.ts). | backlog | high |
| TASK_2026_645_6aaa | M-final memory measurement on Rail board | STILL_VALID | No measurements.md. 10-30 triage: PARTIAL premise; Rail board pane exists. | backlog | low |
| TASK_2026_647_1b0f | Epic: Setup Hub on chat sessions | PARTIAL | Child 680 and most of 682 are obsolete (builder view deleted, #877). Only 651 remains. The epic could close once 651 is re-filed as standalone. | backlog | low |
| TASK_2026_651_2fb8 | Analysis phases as visible chat sessions | STILL_VALID | `chat-routing/src/lib/stream-router.service.ts:229` still registers analysis phases as non-tab surfaces. Onboarding Analyze still uses setup-wizard stores (`onboarding/src/lib/analyze/analysis-step.store.ts`). | backlog (re-scope to onboarding) | low |
| TASK_2026_661_6b5f | Skill value metric (Gate 0) | STILL_VALID | Time-gated research (needs 30 days of outcome records). Not run. | backlog | low |
| TASK_2026_663_50d4 | Lane data quality | PARTIAL | OpenCode `--standalone` is done (`b33535508`), and the grok MCP attachment is done (`b0e9a54d7`). §D (deliverable vs role file) has no code found, and the quota failure kind needs a re-check. | backlog | med |
| TASK_2026_664_0ec1 | Raw error text in shared session logs | STILL_VALID | `vscode-core/src/api-wrappers/webview-manager.ts` (3) and `rpc-handlers/.../chat-stream-broadcaster.service.ts` (8) still log `error.message` patterns. | backlog | med |
| TASK_2026_665_17ac | ptah_session_send echoes raw thrown messages | STILL_VALID | `session-tool-handlers.ts:460-480`: `failureText` sanitizes only the handoff tool. Comment: "The other session tools keep the thrown message". | backlog | high |
| TASK_2026_666_00cc | MCP schema bounds for ptah.session.handoff | STILL_VALID | `session-namespace.builder.ts:157-160` forwards `input` unvalidated. `SessionHandoffArgsSchema` is applied only on the MCP path (`session-tool-handlers.ts:450`). | backlog | high |
| TASK_2026_667_af48 | Ack when a child session fails to start | STILL_VALID | `child-chat-session-host.adapter.ts:245-261`: `reportStartFailure` still only broadcasts `CHAT_ERROR`. The file is unchanged since the 10-30 triage that confirmed this item open. | backlog | med |
| TASK_2026_668_dd07 | Prompt excerpt in chat:continue stop log | STILL_VALID | `rpc-handlers/src/lib/chat/session/chat-session.service.ts:1909` still logs `prompt: prompt.substring(0, 80)`. | backlog | high |
| TASK_2026_669_fc71 | Prune per-session autopilot write counters | STILL_VALID | `frontend/core/src/lib/services/autopilot-state.service.ts:96` has the `sessionWrites` Map. It is set at 278-280 and never deleted. | backlog | high |
| TASK_2026_670_3d09 | Block renderer writes to secret settings keys | STILL_VALID | `settings-rpc.handlers.ts:79-81` denies only `agentOrchestration.decisionModel`. `gateway.*.tokenCipher` and provider endpoint keys are file-based keys (`file-settings-keys.ts:167,172,257,260`). | backlog | high |
| TASK_2026_671_d4dc | Remove dead settings keys | STILL_VALID | `memory.embeddingModel`, `searchTopK` and `searchAlpha` appear only in `file-settings-keys.ts:201-205,415`. `codexAutoApprove` is now referenced in `agent-rpc.handlers.ts` (re-check). | backlog | med |
| TASK_2026_672_af5a | Add compaction.subagentAutoStop setting | STILL_VALID | No such key in `file-settings-keys.ts`. Only `compaction.subagentStopWeightedTokens` (line 148) exists. | backlog | high |
| TASK_2026_673_467a | Serialize handoff pointer collection | STILL_VALID | `agent-sdk/src/lib/helpers/compaction/subagent-handoff-index.ts` has no per-cursor lock or serialization. | backlog | med |
| TASK_2026_680_bc6c | Open workflow-flagged session in builder page | OBSOLETE | PR #877 deleted the harness builder view. Proposals now run on a headless harness session controller in onboarding, and there is no builder page to open. | cancelled | med |
| TASK_2026_682_f705 | Open builder review items after 649 | OBSOLETE | Most items target `harness-builder-view.component.ts`, which PR #877 deleted. Some fixes landed 10-16 (`b36dbd648`, `6c74803e4`, `ff2ea4f81`). Only N6 (`harness-workflow-request.service.ts`, still present) might apply; re-file it if it still reproduces. | cancelled | low |
| TASK_2026_704_8918 | NG0956 track-by-identity warning | UNCLEAR | The reported layout was removed by #777. The only fix (`312b54f36`, canvas) is older than the report. Needs a DevTools check on current main, then cancel if the warning is gone (10-30 triage). | backlog | low |
| TASK_2026_715_6cba | Codex multi-account on App Server route | STILL_VALID | `auth-providers/src/lib/accounts/` has only `claude-*` account modules. The start condition is met (PR #823 Codex runtime merged). | backlog | med |
| TASK_2026_720_6f98 | Lane/skill scoring loop with user signals | STILL_VALID | `lane-outcomes` has no correction, escalation or AskUserQuestion inputs. It partly overlaps TASK_2026_879_9809 (PR #953), which fed pastOutcomes only. | backlog | low |
| TASK_2026_853_3401 | Published HTML artifacts visible, detach Display | ALREADY_DONE | PR #858 "detachable artifact display sidebar" was merged 2026-10-30, and its body cites TASK_2026_853_3401. | done | high |
| TASK_2026_854_52e8 | Auto-link sessions, tasks, worktrees, todos | ALREADY_DONE | PR #855 "link sessions to tasks automatically" was merged 2026-10-30 and cites the task. Follow-up PR #906. | done | high |
| TASK_2026_855_5dda | Per-session git view in git dock | ALREADY_DONE | PR #856 "scope the git dock to the active session" was merged 2026-10-30 and cites the task. | done | high |
| TASK_2026_871_0d04 | Revamp the Tasks UI | ALREADY_DONE | PR #917 (merged 2026-11-04, cites 871 and 606) and PR #926 (focus rings, `ebec74560`). | done | high |
| TASK_2026_874_93f0 | Reliable Electron welcome vitals | ALREADY_DONE | PR #922 was merged 2026-11-04 and cites the task (`b9b3a5d27`, `79647a6b2`). | done | high |
| TASK_2026_875_8be2 | Analyze hidden/under-marketed features | ALREADY_DONE | The research deliverables are in the folder (`hidden-features-analysis.md`, research-a/b/c). They were used by the README PR #934 and the landing PRs #940/#951. | done | med |
| TASK_2026_875_af9e | Make three unstable CI tests deterministic | ALREADY_DONE | PR #930 was merged 2026-11-04 and cites the task. | done | high |
| TASK_2026_876_4949 | Stop handed-off session, linked sessions sidebar | ALREADY_DONE | PR #942 was merged 2026-11-05 and cites the task (`0d6eb4a32`, `39b8c5764`). | done | high |
| TASK_2026_877_85fa | Refresh README (v2, hero video, screenshots) | ALREADY_DONE | PR #934 "refresh README for the v2 desktop launch" was merged 2026-11-04. The body has no task ID, but the title matches. | done | med |
| TASK_2026_878_5513 | Dead curator and re-index actions in Memory/Skills | ALREADY_DONE | PR #957 was merged 2026-11-06 and cites the task. `open-review-items.md` lists leftover Moderates; `a4ae02795` addressed the last-run race. File the rest separately if they still apply. | done | high |
| TASK_2026_878_eae4 | Revamp landing sections below hero | ALREADY_DONE | PRs #940 and #951 (both cite the task) and #961 were merged 2026-11-06/07. `round3-progress.md` says "complete". | done | high |
| TASK_2026_879_9809 | Feed lane outcomes to decision model | ALREADY_DONE | PR #953 was merged 2026-11-06 and cites the task. Follow-up PR #954. | done | high |
| TASK_2026_879_f5da | Unify the display panel | ALREADY_DONE | PR #943 was merged 2026-11-05 and cites the task (`9a58cc22a`, `dc32e8907`). | done | high |
