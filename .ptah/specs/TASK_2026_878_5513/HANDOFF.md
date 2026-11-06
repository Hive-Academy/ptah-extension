# HANDOFF — TASK_2026_878_5513 (+ program TASK_2026_881_5b75), session 4 state

Worktree W: /home/amun/ptah-extension/.claude-worktrees/memory-skills-dead-actions
Branch: fix/memory-skills-dead-actions. Merged origin/main 0abc5e54c in bd83117de. NOT pushed. No PR.

## Goal
User: the Memory & Skills tab is a black box ("Harvest now", code-index "Re-index", "Run curator now"
appear to do nothing). Full authority, full-auto, verified with seeded dummy data.

## Session 4 facts
- main took migrations 0067-0069. OUR migration is now **0070_indexing_last_run** (renamed in the
  merge commit bd83117de; all max-version specs expect 70). Plan/batches text saying 0066/0067 = 0070.
- A stray `/tmp/.ptah` (MCP spill folder, not ours, may belong to another live session; NOT deleted)
  makes harness-root tests in rpc-handlers and ptah-electron treat /tmp as root. Run tests with
  `TMPDIR=/var/tmp/b878`. plugin-rpc.handlers.session-notice.spec.ts hard-codes /tmp and still fails
  while /tmp/.ptah exists (environmental). Tell the user they can remove /tmp/.ptah.
- TMPDIR also moves the verify lock (os.tmpdir()/ptah-verify-lock). ALWAYS add
  `PTAH_VERIFY_LOCK_DIR=/tmp/ptah-verify-lock` with TMPDIR=/var/tmp/b878 so the machine-wide lock
  is shared. Earlier session-4 runs missed this and used a private lock (/var/tmp/b878/...).
- Pre-existing on main (confirmed by running on main): `@ptah-extension/persistence-sqlite:lint`
  (no-restricted-syntax in 0057/0058) and `ptah-extension-webview:lint` ("Static imports of
  lazy-loaded libraries" in unchanged app files).
- Known intermittent tests (unchanged files, pass alone): BootScanRunner "does not re-admit an
  unchanged given_up generation", observation-queue.store slow-transaction, mcp-bench
  snapshot-audits / launchBenchHost, chat-transcript.change-set (5 s timeouts under load).
- `--testPathPatterns` must be used with `-t test`, otherwise lint/typecheck also get it and fail.
- User decision (session 4): the `tool-failure` event keeps its snippet; the backend redacts secrets
  (libs/backend/memory-curator/src/lib/triggers/redact-secrets.ts).

## Commits on the branch (all verified at lib level; hooks passed)
0abc1127c B1, be69b31ba B2, 530250423 B9, 45928ea45 B10, 16be14004 B3 (+mcp-bench cassette-miss fix),
bb7557c41 B4, 10b55178d B5, 50d5e0f8b B7, d158fdffe B8, 910244851 B11, b8606532c B12, b880203e6 B15,
1b2d0bd98 B16, 630e5a893 B17, bd83117de merge+0070, 4029d354f redact (phase A fix),
5da43d62c indexing last-run fixes (phase B fixes + bounded correction), 46b2a0c92 document reviews
(phase C fix), b02948f9a B13, 470c9daed B14, 6daf37e76 B18, cfdf00172 B6, e9d75bafc B19 docs.

## Reviews (codex lanes; implementers were claude)
- Phase A: code-logic-review-phase-a.md (REVISE 6/10, 1 finding) → fixed.
- Phase B/C: code-logic-review-phase-bc.md (REVISE 5/10) → round 1 code-logic-review-fixes.md →
  round 2 code-logic-review-fixes-r2.md (all items resolved, 1 new) → bounded correction →
  code-logic-review-bounded.md (REVISE 7/10). Revise cap reached. Two Moderate items OPEN and
  reported, not fixed: open-review-items.md (cross-process race between read and UPDATE of
  last_run_json; readRow swallows read errors). User decides: this PR or follow-up.
- UI phase (B6, B13, B14, B18): code-logic-review-phase-ui.md (REVISE 5/10, 5 findings) → round 1
  fixes a29242802 → -r1.md (REVISE 7/10, 5 resolved, 1 new race) → round 2 fix → -r2.md (REVISE
  7/10, 1 new stale-state path) → bounded correction (split status/action generations), committed
  with round 2 in d6a5a97a3 → -bounded.md APPROVED 9/10. UI phase closed.
- Batch 19 docs: docs/development/memory-skills-evaluation.md (codex lane), spot-checked, committed.

## Final scoped verify (16 projects, shared lock, after d6a5a97a3 except the last spec edit,
   which workspace-indexing verify covered separately): only failures are
   persistence-sqlite:lint, ptah-extension-webview:lint (pre-existing on main),
   rpc-handlers session-notice (/tmp/.ptah environmental) and mcp-bench snapshot-audits
   "passes mem.liveness.audit..." 5 s timeout, which ALSO FAILS ALONE ON MAIN (pre-existing).

## Next steps
1. (done)
2. (done) Final scoped verify (background, TMPDIR=/var/tmp/b878):
   `npm run verify -- -p @ptah-extension/persistence-sqlite,@ptah-extension/memory-curator,@ptah-extension/shared,@ptah-extension/rpc-handlers,@ptah-extension/thoth-runtime,@ptah-extension/skill-synthesis,mcp-bench,@ptah-extension/ui,@ptah-extension/chat,@ptah-extension/core,@ptah-extension/webview-e2e-harness,@ptah-extension/memory-curator-ui,@ptah-extension/workspace-indexing,@ptah-extension/skill-synthesis-ui,ptah-electron,ptah-extension-webview`
3. NEEDS USER: launching Electron dev and seeding the dev DB (~/.ptah/state) is a dev target
   (CLAUDE.md forbids unless the user asks). Visual review in Electron only: "before" screenshots (dark+light) from the branch base 6638ed29c
   (or main) and "after" from W of Memory diagnostics, Code index, Skills specs/Harvest, Settings
   curator picker, with seeded dummy data. visual-reviewer subagent. Show the user.
4. Commit .ptah/specs/TASK_2026_878_5513 (exclude review-input/*.patch if large), push in the
   background, open PR to main (Summary, Test plan with real results, open items, pre-existing
   failures), watch CI with gh. Never merge or force-push.
5. 881 M1/M2/M4 planning after the 878 PR; M3 build only after the PR is out.

## Background work at the time of writing
- ui-builder (frontend-developer subagent) on UI review round 1. No CLI lanes running.
- Peer session TASK_2026_879_9809 opened PR #953 (head 0ffb89ac3); it needs nothing from us.
  Never edit its files (lane-routing, lane-outcomes, subagent outcome recording,
  platform-core file-settings-manager.ts, outcome-report.tool.ts).
