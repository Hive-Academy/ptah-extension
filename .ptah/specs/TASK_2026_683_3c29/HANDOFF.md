# HANDOFF — TASK_2026_683_3c29 (motion), PR #739 (TASK_2026_674 + 681 leftovers), TASK_2026_685 (lane header)

Written 2026-10-17 at the user's request (session token budget). Three worktrees. Read this file first,
then `implementation-plan.md` (this folder; approved, U1-U6 and D1-D12 are binding).

## 0. Rules to keep
- CLAUDE.md memory-safe checks: scoped `-p`, `--parallel=1`, Jest `--maxWorkers=2`, ONE heavy check at a time.
  NEVER pass `--maxWorkers` to `typecheck` (ngc fails with TS5023).
- Implementers = codex lanes (`ptah_agent_list` first; load the agent-lanes skill). Reviewers = Claude subagents.
  Lanes never commit. Commit in the foreground; push (+ `gh pr create`) as ONE background command.
- Electron is a shared slot. Announce "Electron: <task> launching, port <n>" to the other sessions (ListAgents ->
  SendMessage) and "Electron: free" after. Live peers at hand-off: `ptah-ptah-extension-task-679-session-lis-56eb530000s402qggi70y0f`
  (679 took the slot at ~21:00 and promised to send "Electron: free"), `...task-646-decision-mo-b0349f0000s402qggi70y0c`.
- Build/e2e only as approved: U4 = one renderer build + the Electron perf spec, before (M0) and after (M1).
- No local-only branch at the end: push + PR every finished branch and report the link.
- Ask the user only about removals, scope changes, irreversible actions.

## 1. PR #739 — TASK_2026_674/675/676 + TASK_2026_681 leftovers (DONE, waiting for review/merge)
- https://github.com/Hive-Academy/ptah-extension/pull/739, branch `fix/chat-transcript-followups`,
  worktree `D:\projects\ptah-extension\.claude-worktrees\chat-transcript-followups`. Pushed head `9298b391e`. Clean.
- Contains: the resync fixes (674/675/676), L1-L7, the TASK_2026_683 task spec + approved plan + reviews,
  the TASK_2026_685 task spec, a merge of `main` (PR #736, `ff9ec5fec`), and the L2 decision.
- Checks after the merge (all PASS): `typecheck,lint,test -p chat canvas`. Visual review PASS_WITH_NOTES
  (`.ptah/specs/TASK_2026_674_fa33/visual-review.md`).
- L2 (user chose "add to PR #739"): the switch to `SESSION_EMBED_CHROME` is NOT possible — Canvas focus gets
  `'full'` like any embed, the Rail card gets no token (`canvas-detail-transcript.component.ts:22-29`,
  `reports/batch-L2-signal.md`). Kept `RAIL_TRANSCRIPT_RETENTION`; comment updated (`9298b391e`). PR body updated.
- Task statuses in the branch: 674/675/676 `in_review`, 677 `done`. After the merge: set 674/675/676 `done`.

## 2. TASK_2026_683_3c29 — smooth navigation and session-switch motion (IN PROGRESS)
Worktree `D:\projects\ptah-extension\.claude-worktrees\nav-session-motion`, branch `feat/nav-session-motion`
(= main 6c0490f1f, NO commits yet, everything uncommitted, task folder untracked). Local only.

### Decisions (user, this session)
- Plan approved at the review cap with U5 (visible-only cascade: `afterNextRender({earlyRead, write})`, pure
  `selectVisibleEntrance`) and U6 (Electron-only measurement; VS Code S7 evidence = follow-up).
- B0 extra fix pass beyond the cap: approved. B8 dropped (M0: F7 not seen). B7 NEEDED (M0: F6 confirmed).
- Orchestrator decisions: restored `transition.skipTransition()` for same-surface / reduced-motion navigations
  (plan D1); a lane had replaced it with 0 s transitions, which would snapshot every session switch. Dev builds log
  the skipped transition's rejected `ready` promise (Router `transition.ready.catch(console.error)`); accepted.
  Added the eslint-disable line to the `markdown` stub in `chat-transcript.session-enter.spec.ts` (same as siblings).

### Batch state
| Batch | State | Evidence |
| --- | --- | --- |
| B0 recorder `apps/ptah-electron-e2e/src/specs/perf/nav-session-motion.perf.spec.ts` | written; probe fix 4 done (probeVersion 2), NOT yet reviewed; typecheck+lint PASS | reports/batch-B0*.md, code-logic-review-B0*.md, code-logic-review-B1B2.md (B0 section) |
| M0 | `measurements/m0.json` (102 windows) is STALE: no probeVersion -> M1 rejects it. MUST be recorded again | measurements/m0-summary.md |
| B1 router VT + tracker (`libs/frontend/core/src/lib/routing/surface-view-transitions.ts`, app.config.ts) | done + fix round 1 + orchestrator skip fix; core 16/16 VT spec, core tests 1267/1267, routing spec 75/75 | code-logic-review-B1B2.md, reports/batch-B1*.md |
| B2 tokens + VT CSS + Electron naming (`styles.css`, `electron-shell.component.ts`) | done + fix (name only while `html.ptah-vt-active`; group durations); shell spec 3/3 | same |
| B3 guarded URL correction (`chat-tab-route-sync.service.ts`) | done, spec 32/32; review APPROVED 8.5 | code-logic-review-B3B4.md |
| B4 transcript entrance (`organisms/transcript/*`, `transcript-entrance.ts`) | done; transcript specs 19 suites / 229 tests; review APPROVED 8.5 | same |
| B3/B4 fix (lane `0baf6f3e`) | SEE SECTION 2b | reports/batch-B3B4-fix.md |
| B5 ChatView edge + CV-2.1 removal (lane `7dcfaab5`) | SEE SECTION 2b | reports/batch-B5.md |
| B6 canvas motion | NOT STARTED — only after PR #739 merges (rebase on main; touches canvas-rail-board, canvas-lane-view) | plan "### B6" |
| B7 F6 first-frame scroll | NOT STARTED — after the B3/B4 fix (owns chat-transcript.component.*) | plan "### B7", m0-summary.md |
| M1 | NOT STARTED | plan "## Measurement plan" |
Last combined checks: `typecheck` PASS for core + chat; `lint` chat 0 errors (51 warnings), core PASS.

### 2b. B3/B4 fix and B5
Both ended before the hand-off; results are in "Lane results at hand-off" at the end of this file.

### Next steps (in order)
1. Read the B3/B4-fix and B5 reports; verify: `chat-transcript.component.ts` <= 1398 lines (main size), the
   removal grep of CV-2.1 names is empty, no `offsetWidth` left.
2. One heavy check (from the worktree): 
   `npx nx run-many -t typecheck,lint -p core chat --parallel=1` then
   `npx jest -c libs/frontend/chat/jest.config.ts libs/frontend/chat/src/lib/components/organisms/transcript libs/frontend/chat/src/lib/components/templates/chat-view libs/frontend/chat/src/lib/services/chat-tab-route-sync.service.spec.ts --coverage=false --maxWorkers=2`
   (finally `npx nx test chat --parallel=1 --maxWorkers=2` once before the commit).
3. Claude `code-logic-reviewer` on B5 + the B3/B4 fix + the B0 probe fix (fix4).
4. B7 (codex lane) after step 3: F6 first-frame scroll, plan "### B7"; evidence in m0-summary.md (S4: rAF 2 at
   scrollTop 0, jump of 965-5755 px; frames s4-02-000..004). Then review.
5. RE-RECORD M0 BEFORE ANY REBUILD. The Electron dist in this worktree (`dist/apps/ptah-electron`, built
   2026-10-16 22:58) is still the BASE code. Wait for "Electron: free", announce, then:
   `PTAH_MOTION_LABEL=m0 PTAH_MOTION_OVERWRITE=1 npx playwright test --config=apps/ptah-electron-e2e/playwright.config.ts src/specs/perf/nav-session-motion.perf.spec.ts`
   (PTAH_MOTION_ASSERT unset). Check `m0.json`: `complete: true`, `probeVersion: 2`, 102 windows. Note: the
   background task exit code is the `echo`; read `exit=` in the log.
6. Commit the batches in the foreground (scopes from .commitlintrc.json: core, chat, webview, e2e, task-specs;
   subject <= 72; body lines <= 100; end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`).
7. After PR #739 merges: merge/rebase main into `feat/nav-session-motion`, then B6 (codex) + review.
8. M1: `npx nx build-dev ptah-electron --parallel=1 && npx nx copy-renderer-dev ptah-electron --parallel=1`
   (approved build), then `PTAH_MOTION_LABEL=m1 PTAH_MOTION_ASSERT=1 npx playwright test ...` (same spec).
   Visual review of the frame strips (dark + light) vs M0. Report long tasks per U2.
9. Push + `gh pr create --base main` (one background command); body ends with
   `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. Set task.md status.

### Follow-ups to record (PR body / tasks)
- TASK_2026_629 row 74 (U2): render-caused long tasks on session switch before any motion code — S2 10/10 windows
  > 50 ms (max 292 ms), S4 3/3 (303 ms), S6 reduced motion 331 ms; start 1-12 ms after the click.
- VS Code S7 evidence (U6). Tracker has no timeout for a transition that never settles (review B3B4 minor).
- `chat-view.component.ts` / `chat-transcript.component.ts` remain over the 700-line lint limit (pre-existing).

## 3. TASK_2026_685_64f4 — one execution header for CLI lanes and subagents (PROOF IN PROGRESS)
- Task filed in PR #739 (`ff2dadef3`). Proof branch `docs/lane-header-proof`, worktree
  `D:\projects\ptah-extension\.claude-worktrees\docs-lane-header-proof-451ab2d3f2f3`, 2 local commits
  (`e24703b29` analysis + prototype, `6bf3ebeb9` capture list). LOCAL ONLY, no PR. Child session stopped.
- Findings: duration "71h 18m" = restored CLI lane has no `completedAt` (`CliSessionReference` does not store it,
  `agent-monitor.store.ts:1708-1736`), so card (`agent-card.component.ts:157-164`) and inspector (`:329-332`) show
  `now - startedAt`. Proposed removals (USER APPROVAL NEEDED): header status badges, separate duration text,
  subagent bubble header/footer in the lane view. Prototype: `.ptah/specs/TASK_2026_685_64f4/prototype/index.html`.
- Next: (a) delete the two pointer files at `.ptah/specs/TASK_2026_685_64f4/.ptah/specs/TASK_2026_685_64f4/`
  (wrong deliverable path artifacts); (b) when Electron is free (after M0), a `visual-reviewer` takes the 19
  shots listed in `visual-proof.md` "## Screenshots" using the harness in
  `.claude-worktrees/clean-session-followups/.ptah/tmp/` (`a1117-launcher.mjs`, private profile copy, port 9351) and
  the CURRENT dist of `chat-transcript-followups` (do not build); (c) commit, push, open a docs PR; (d) show the
  user the proof + proposed removals; implementation only after PR #739 merges and coordinated with 683 B6.

### 3b. User scope decision for 685 (2026-10-17, made in the child session's tab; commit `c47a670ac`, not pushed)
- CLI lanes and SDK subagents show the SAME real-time message stream while they run, rendered exactly like the main
  agent (ExecutionNode tree, `ptah-execution-node`).
- A subagent stays OUT of the main orchestration execution tree (memory/resources) and gets its own independent live
  execution tree, shown in its lane.
- APPROVED REMOVALS: the "View transcript" action (`inline-agent-bubble` :322-330 and :963-981, inspector actions menu
  :38, `session-agent-tray.service` :101-108, `background-agent-strip` :331-337), the lane fallback "Live agent
  unavailable. Showing saved transcript." (`canvas-lane-view` :155-163 + its load logic), and the
  `subagent:transcript` overlay path.
- Gap: today the lane finds the subagent node inside the tab's main tree (`canvas-lane-view` :245-257); the tree
  builder nests subagent messages under the parent (`execution-tree-builder.service` :319). Open: a subagent from an
  earlier session needs its own tree rebuilt from saved structured events (like `buildTreeFromSegments` for CLI
  lanes), not from the text-only transcript.
- This now overlaps TASK_2026_633 (live background subagent output after the parent turn). Plan 685 and 633 together
  (one architect pass) before any code; both start after PR #739 merges. The prototype PNGs still show the old
  transcript icon; the HTML prototype is updated.
- The 685 branch now has 3 local commits (`e24703b29`, `6bf3ebeb9`, `c47a670ac`).

## 4. Other chat UI candidates (user asked)
632 (backend, any time); 633 after PR #739 merges; 685 implementation after #739; 653 after 679 and 683 merge.

## Lane results at hand-off
Nothing runs at hand-off: all lanes, subagents and the 685 child session have ended.

- **B3/B4 fix** (codex `0baf6f3e`, CLI session `01a14689-ae14-7c10-9df2-0fa27bae014b`) — `reports/batch-B3B4-fix.md`. DONE, not yet
  reviewed. B3-1: a correction invalidated by a later navigation is reconciled after NavigationCancel /
  NavigationError (router idle, still on a mismatched chat URL). B4-1: specs for the real 6-slot cap, retained
  A->B->A multi-slot, read-phase purity, cleanup on falling edge and destroy. File size: entrance logic moved to NEW
  `libs/frontend/chat/src/lib/components/organisms/transcript/transcript-session-entrance.ts`;
  `chat-transcript.component.ts` 1491 -> 1396 lines (main 1398). Minor: one visibility walk via the pure selector,
  zero-height slots ignored, lazy rect reads capped at 24. Lane Jest: route-sync 34/34, transcript 234/234.
  The lane also edited the pure `transcript-entrance.ts` (+ spec): the reviewer must confirm the U5 signature
  is unchanged and the function is still pure. Left open by the lane (listed in its report): the tracker timeout
  for a transition that never settles (core, out of its scope) and minor B3 coverage refinements.
- **B5** (codex `7dcfaab5`, CLI session `01a14689-eade-7ab3-b9d1-ee441789ce03`) — `reports/batch-B5.md`. DONE, not yet reviewed. Tab-id keyed 400 ms outside-zone
  `enteringTabId`, `[entering]` bound, inspector `.st-r` retimed to global tokens, CV-2.1 removed (removal grep and
  `offsetWidth` grep: no hits). `chat-view.component.ts` 2110 -> 2075 lines. NEW
  `templates/chat-view.session-enter.spec.ts` 5/5 — but the lane CHANGED two timer-count assertions after they
  failed (126/128 first run): the reviewer must confirm the assertions were not weakened. The full chat-view spec
  scope was not re-run after that change.
- Unreviewed so far: B0 probe fix 4, B3/B4 fix, B5. One Claude `code-logic-reviewer` pass covers all three (step 3).
- Lane CLI session IDs (resume with `resume_session_id` if a fix goes back to the same lane): B0 fix4
  `01a14684-2371-7090-ad23-8ff85f6c7090`, B1/B2 fix `01a14683-f266-76c1-b7e2-b9015453bf21`, B3
  `01a1467e-b79a-78a3-887e-47faebec000f`, B4 `01a1467e-fe4c-7331-834e-357c263d7773`. Resumes over ~60k tokens start a
  fresh lane with a handoff brief, so always give complete instructions.

### Uncommitted files in `feat/nav-session-motion` (all belong to this task)
Modified: `apps/ptah-extension-webview/src/app/app.config.ts`, `.../webview-routing.spec.ts`, `.../styles.css`;
`libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.{ts,html,css}`,
`transcript-slot.directive.ts`; `libs/frontend/chat/src/lib/components/templates/chat-view.component.{ts,html,css}`,
`electron-shell.component.ts`; `libs/frontend/chat/src/lib/components/organisms/message-bubble.component.html`;
`libs/frontend/chat/src/lib/services/chat-tab-route-sync.service{,.spec}.ts`; `libs/frontend/core/src/lib/routing/index.ts`.
New: `apps/ptah-electron-e2e/src/specs/perf/nav-session-motion.perf.spec.ts`; `core/.../routing/surface-view-transitions{,.spec}.ts`;
`chat/.../transcript/{transcript-entrance{,.spec},transcript-session-entrance,chat-transcript.session-enter.spec}.ts`;
`chat/.../templates/{chat-view.session-enter.spec,electron-shell.view-transition.spec}.ts`; task folder
`.ptah/specs/TASK_2026_683_3c29/` (plan, reviews, reports/, measurements/ incl. ~1,400 PNG frames — decide before
committing whether to commit the frame strips or only m0/m1 json + summaries; the 674 PR committed screenshots).

### Local-only branches at hand-off (user rule: no orphaned branches)
- `feat/nav-session-motion` — no commits yet (work uncommitted, in progress).
- `docs/lane-header-proof` — 3 commits, not pushed; real-app screenshots still missing (section 3, 3b).
