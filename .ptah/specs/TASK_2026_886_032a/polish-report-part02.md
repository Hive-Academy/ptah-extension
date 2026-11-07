# Polish report, part 02 (TASK_2026_886_032a, phase 2)

List: `.ptah/specs/TASK_2026_886_032a/work/polish-part02.txt` (29 tasks).

## Counts

- Polished: 29 (every `task.md` has a `>-` description, `updated: '2026-11-07T00:00:00.000Z'`,
  a `## Description` with the remaining work and a `## Current state (2026-11-07)` section).
- Unchanged (already current): 0.
- Notes added to history files: 15 (`context.md` of 572, 579, 581, 587, 598, 599, 604, 607, 608,
  611, 613, 619, 624, 630, plus `TASK_2026_619_af7f/handoff.md`).
- No `status:` line changed (`git diff` shows 0 changed `status:` lines). All 29 frontmatters
  parse as YAML.

## Table

| Task ID | What changed | Removed old claims | Confidence |
| --- | --- | --- | --- |
| TASK_2026_562_4b1d | Scope cut to Waves 2.6, 4.1, 4.2; title retargeted | 2.1/2.4/2.5 handed to 634; 2.2, 2.3, 4.3-4.5 marked done; 4.6 (Codex SDK parse error) flagged as likely obsolete (lanes use `codex-app-server-lane.adapter.ts`) | med |
| TASK_2026_565_e8e4 | Description and current anchors (`embedder-worker.ts:231,260-294`) | Old line range 277-295 only | high |
| TASK_2026_566_9a50 | Decision task restated; anchor `merge-candidate-collector.ts:187` | `../TASK_2026_563` path (folder retired) replaced with git-history ref | high |
| TASK_2026_567_90d4 | Prompt location `extract-prompt.ts:1,54`; later commits named | Retired 563 path | med |
| TASK_2026_568_3933 | Scope plus RPC anchors | Retired 563 path | med |
| TASK_2026_572_07c4 | Re-scoped to the Electron memory UI only; title changed | CLI subcommand and `ptah interact rpc.call` (CLI removed, PR #892) | high |
| TASK_2026_573_e2bf | Opener anchor (`retention-sqlite.test-support.ts:50-71`), no forced fallback, no unpin spec | none wrong; made concrete | med |
| TASK_2026_577_cbfb | Scope summarised; anchors re-verified (0048 migration, `memory.store.ts:912`, schema `:119`, `start-thoth-cron.ts`) | "26.7K memories" snapshot dropped from description; old `memory.store.ts:940-946` lines | high |
| TASK_2026_579_f2e2 | Scope summarised with current lines (`sdk-internal-query.curator-llm.ts:225,279-301,649,672`) | Stale line numbers 231-249, 403-414, 495-501 | high |
| TASK_2026_581_2af1 | Both defects kept; current anchors | AI Team Builder composer note (harness builder view removed, PR #877) | med |
| TASK_2026_585_3704 | QA steps restated; paid-call approval added | none wrong | med |
| TASK_2026_587_bffd | Body rewritten to the 10-30 new scope | Old body (durable ledger, skill funnel, evidence cards, "tabs become task pages"); "storage health appears nowhere" (now in `storage-health-panel.component.ts`) | high |
| TASK_2026_598_e8df | Remaining reset sites listed with lines | Body claim "ConfigWatcher ends every live session on any key write" (PR #720 scoped it); "all three hosts" / VS Code live check | high |
| TASK_2026_599_8684 | Anchors `rpc-handler.ts:229,255`, `agent-rpc.handlers.ts:386-390` | CLI formatter, TUI and CLI E2E clients (removed, PR #892) | high |
| TASK_2026_601_d4a1 | Both gaps with current anchors | none wrong | high |
| TASK_2026_602_0427 | Clarified it is the Settings provider setup wizard; anchors `:684-689,:499`, `connection-check.ts:159-166` | Old line ~270 and ~108-124; "CLI client" | high |
| TASK_2026_603_b573 | Defect 1 open; defect 2 partly done | "folder already gone" warning (now silent); old line ranges | high |
| TASK_2026_604_e720 | New size table (7 files over cap, styles.css 4084) | Old line counts (729/761/1010/2260); "close to the cap" status of three files | high |
| TASK_2026_605_3772 | Anchors in the three `project.json` files | "local verify command the agents use" made concrete (`npm run verify`) | high |
| TASK_2026_607_7158 | Re-scoped to the active workspace name; title changed | "Hide Workspaces" rail label (gone; rail tab label fixed in `82b79b348`, `c89ca28b9`) | high |
| TASK_2026_608_a141 | Current styles.css anchors (`:418,:422-448,:1053-1078`) | "both hosts" captures; old line 630-633 | med |
| TASK_2026_611_8fe7 | Open items regrouped; sizes and anchors refreshed | FU-1 (done in `a621f0323`), R-1 (obsolete), `agent-selection.component.ts` (gone), retired 609 folder path | med |
| TASK_2026_613_8f34 | Remaining rules only; paths moved to `plugins/ptah-core` | `apps/ptah-extension-vscode/assets/plugins/...` (VS Code app removed); batch-size rule marked done | high |
| TASK_2026_618_c8f4 | Steps and anchors (`:45,:332,:338`, `git-watcher.service.ts:953`) | none wrong | high |
| TASK_2026_619_af7f | Phase 2 scope only; eager set anchor `protocol-dispatcher.ts:706` | Old body still describing Phase 1 as work | med |
| TASK_2026_622_2d05 | Questions kept; anchors `sqlite-connection.service.ts:524-541` | CLI app as the Electron alternative; old lines 522-552/526 | high |
| TASK_2026_624_d671 | Memory-only scope; `--host-timeout-ms` marked existing | Four recordings incl. `funnel-record-v1`, U3, Batch 24/26 wording; skills suites (deleted in #788) | med |
| TASK_2026_630_2250 | Open items only, with re-check against PR #943 | Items 1, 2, 5 and the avatar spec-title fix (done); "1,886+ lines" (now 2143) | med |
| TASK_2026_634_daec | Stage list in task.md; B.1 flagged for re-check | `../TASK_2026_614`/`../TASK_2026_597` paths (retired) replaced with git refs | med |

## Status proposals

None. No task in this list is fully done, obsolete or a duplicate. Partial overlaps:

| Task ID | Proposed status | Evidence |
| --- | --- | --- |
| TASK_2026_562_4b1d | keep backlog (scope already cut) | Waves 2.1/2.4/2.5 are owned by TASK_2026_634_daec Stage A.1; the rest is open |

## Unclear

| Task ID | What could not be checked |
| --- | --- |
| TASK_2026_562_4b1d | Wave 2.6 (injected-text trimming) not measured; whether Wave 4.6 is fully obsolete with the app-server lane |
| TASK_2026_581_2af1 | Root cause of the live-update defect (hypotheses only; no repro run) |
| TASK_2026_585_3704 | Manual live QA; needs paid turns |
| TASK_2026_598_e8df | Whether `ConfigWatcher` still ends sessions on non-active provider writes outside the PR #720 path |
| TASK_2026_607_7158, TASK_2026_608_a141 | Contrast in the current themes (needs axe in Electron) |
| TASK_2026_611_8fe7 | FU-7(b), FU-9 (new location of the confirm path), FU-3/FU-6 layout, T-1 test failures |
| TASK_2026_619_af7f | Whether the `cli-headless` bench host still builds after PR #892 |
| TASK_2026_622_2d05 | Whether Electron crashes on quit after vector writes |
| TASK_2026_630_2250 | Items 7 and 8 against the unified display panel (PR #943) |
| TASK_2026_634_daec | Stage H items H.1-H.14 one by one; A.3-A.5 and B.2 |
