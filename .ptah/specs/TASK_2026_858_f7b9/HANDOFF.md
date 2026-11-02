# HANDOFF — TASK_2026_858_f7b9 Remote workers and a mobile-first Ptah PWA

## Goal
One interface controls Ptah on several LAN machines (Horus, Anubis, Chappie) and, as a product
feature, an installable mobile-first PWA beside Ptah that users reach from anywhere (start/watch
sessions, approve tool use, notifications; reference: t3code remote access). Gatsby serves only the
`d3:4b` decision model through an SSH tunnel. Full orchestration workflow; **no code changes before
the user approves the plan at Gate 2**.

Earlier background (fleet table, SSH aliases, Council verdict, code gaps):
`/home/amun/ptah-extension/.claude-worktrees/remote-workers/.ptah/specs/council-remote-machines/HANDOFF.md`
(the previous session's handoff; still accurate for fleet state).

## Done (this session, 2026-11-01)
- **Chappie `d3:4b` benchmark** (pull finished, blob size 5157835328 verified). `POST /v1/systemone`
  with `/tmp/s1.json`: Chappie cold 11.8 s, warm 5.5 / 5.9 s; Gatsby cold 22–28 s, warm ~11.2 s.
  Same answer (o1, p=0.9994). Chappie ~2x faster, but it also runs Ptah (≈5 GB RAM left with the
  model loaded) and has no `OLLAMA_KEEP_ALIVE` (model unloads after 5 min). Vulkan test not run.
  Moving the model is user decision O4 — not done.
- **Worktree** `/home/amun/ptah-extension/.claude-worktrees/remote-workers`, branch
  `chore/remote-workers`, rebased on `origin/main` `12a482782`. `node_modules` symlinked. No commits;
  `.ptah/specs/TASK_2026_858_f7b9/` and `council-remote-machines/` are untracked.
- **Task folder** `TASK_2026_858_f7b9` created (task.md, context.md, decisions.md with 7 rows).
- **Gate 0.1**: lanes enabled; approval `lane-review` for Gates 1/1.7, user for Gate 2. Lanes at the
  time: codex (confirmed room, weekly 79%), kimi code, grok, antigravity (limits unknown); Ollama Code
  AT LIMIT until 2026-11-02 00:00 UTC; copilot/claude disabled.
- **Gate 1 PASSED** — `task-description.md` (project-manager subagent), codex review APPROVED after
  2 rounds (`task-description-review.md`). Phases: 0 Measure, 1 one worker from Electron over SSH,
  2 Fleet + Tailscale, 3 PWA, 4 Cloudflare Tunnel + Access. Recommended path is conditional on U1–U5.
- **Gate 1.7 PASSED** — `design-spec.md` + `prototype/` (29 dark/light screenshots), ui-ux-designer
  subagent; codex review APPROVED after 1 round (`design-spec-review.md`; the fresh lane rewrote that
  file, so initial findings survive only in design-spec.md's Revision log). Machines view = new
  top-level Electron navbar tab on `ptah-glass` / `ptah-glass-light` tokens.
- **Gate 2 plan** — `implementation-plan.md` (~1230 lines, software-architect subagent). Architecture:
  `ptah worker serve` on the existing CLI composition root; loopback HTTP+WebSocket `/rpc` (port
  41873) with its own ~12-method versioned table, method+resource authorization before handlers;
  per-session JSONL event log (log before send); Electron main is the Phase 1 client via
  `ssh -W`; renderer keeps `ClaudeRpcService` over IPC with `machines:*` methods; new libs
  `libs/worker-protocol`, `libs/backend/worker-runtime`, `libs/backend/remote-machines`,
  `libs/frontend/machines-ui`; batches C1–C10 plus a scaffold batch.
  - codex review: initial REVISE (1 Blocking driver lock, 7 Serious) → round 1 REVISE (Blocking:
    `better-sqlite3@13.0.3` needs Node >=22 — I verified; Horus has Node v20.20.2 and
    `apps/ptah-cli/package.json:45` says `>=20.12`; Serious: stranded lock on failed release;
    transcript misses a desktop turn between remote turns).
  - Architect round 2 written (Revision log "Round 2" at ~line 1227): lock = kernel-held per-session
    socket (no native module); release retry + `ptah worker locks release`; transcript refresh on
    every attach. Architect says the worker still needs Node >=22 because the CLI session store
    already loads `better-sqlite3`, and added user question **Q6** (raise CLI `engines` floor).
    I did not verify Q6 is in the file (`grep Q6` found nothing — check).
  - **The final codex re-review of round 2 has NOT run** — the user rejected that spawn. Gate 2 is
    not passed.
- Architect subagent was stopped by the budget monitor after it returned round 2; its handoff
  record is set `dismissed`.

## Open problems and decisions (user)
1. Gate 2: run the final codex re-review of round 2 (option 1), or present Gate 2 without it and
   say round 2 is unreviewed (option 2). The user was asked; no answer yet.
2. Gate 2 user decisions, to ask in ONE AskUserQuestion bundle (max 4 questions; group them):
   U1 Phase 1 slice, U2 exposure model, U3 push content, U4 PWA hosting, U5 licensing (task-description
   "User decisions (reserved)"); plan Clarifications Q1 (design 4.9), Q5 (U5 coverage), Q6 (Node 22
   floor); design clarification (pairing-failure attempts count); resource budget B1–B5 approval.
3. Operational (not code), unanswered: O1 copy Ptah/Claude config to workers; O2 rebind worker
   Ollama to loopback; O3 upgrade Chappie Ptah 0.1.60→0.1.70; O4 move `d3:4b` to Chappie;
   O5 Ethernet + slow download; O6 configure decision model in Ptah (kind custom,
   `http://127.0.0.1:11435`, 20 s). Ptah's `ptah_route_decide` fails with `provider-error` until O6.
4. Unrelated pending record from another session (landing live-demo replay, PR #873):
   `/home/amun/ptah-extension/.ptah/subagent-handoffs/20261101T012956132Z-68a08f9d4e4281c0-toolu_017auvRcM2WbwVGoVT5gC714-bc961db6.handoff.md`
   — left pending; not part of this task. Ask the user before continuing it.
5. Ptah defect seen: `ptah_outcome_report` rejects worktree absolute paths as "escapes workspace";
   `subagent:<id>` runIds sometimes "not found".

## Key files
- `/home/amun/ptah-extension/.claude-worktrees/remote-workers/.ptah/specs/TASK_2026_858_f7b9/task-description.md` — approved requirements, U1–U5, O1–O6.
- `.../TASK_2026_858_f7b9/design-spec.md`, `prototype/` — approved Machines view design.
- `.../TASK_2026_858_f7b9/implementation-plan.md` — plan; round 2 unreviewed.
- `.../TASK_2026_858_f7b9/implementation-plan-review.md` — codex review with initial + Round 1 sections.
- `.../TASK_2026_858_f7b9/decisions.md`, `context.md` — orchestration log (add Gate 2 rows).
- `/home/amun/ptah-extension/.claude-worktrees/remote-workers/.ptah/specs/council-remote-machines/HANDOFF.md` — fleet state and Council background.

## Background work
None running. No lanes, subagents or child sessions are live. Last codex review lane CLI Session ID
`01a194fe-2854-7081-883d-d82b05c181b9` (resumable, but its context exceeds 60k, so Ptah will start a
fresh lane with a brief).

## Next steps
1. Ask the user: final codex re-review of round 2, or Gate 2 now (open problem 1).
2. If re-review: spawn codex (`cli: codex`, `taskKind: review`, `workingDirectory` = worktree,
   `deliverables` = implementation-plan-review.md, timeout 1800000). Check only the 3 open round-1
   items, the socket lock (abstract vs filesystem socket, stale files, permissions, SIGSTOP holder,
   Electron/CLI path agreement), the Node 22 claim (where the CLI loads better-sqlite3), Q6. Add a
   `## Round 2 re-review`. This is past the 2-round cap: if still REVISE, take open items to the user.
3. Present Gate 2 to the user as a plain message (author, reviewer, verdict, open items, lane-
   introduced constraints) plus ONE AskUserQuestion bundle (open problem 2). Wait for `APPROVED`.
4. After approval: rename branch to `feat/remote-workers` before first push (decisions.md row 4),
   invoke team-leader MODE 1 for `batches.md`, then implement. Commit the task folder with the first
   batch. Verify each batch only with `npm run verify -- -p <changed projects>` (plus dependent
   hosts); never workspace-wide, never build/serve/dev/e2e/package.
5. Fleet operations only after the user answers O1–O6. Back up anything replaced on a machine;
   check `pgrep -f /opt/Ptah/ptah-desktop` before upgrading Ptah.

## Update 2026-11-02 (pause for app restart)
- Gate 2 APPROVED. Worktree recreated: `.claude-worktrees/remote-workers`, branch `feat/remote-workers` from main 8ca24c134 (old worktree was removed externally; task folder restored from `~/ptah-worktree-archive/2026-11-01/`). Nothing committed yet.
- Team-leader Mode 1 blocked on native Codex runtime bypassing SessionRegistry. Architect Round 4 amended the plan for claude-sdk-only scope, but the user then chose "hook native Codex too" (decisions row 14). Next: architect Round 5 adds lifecycle notifications to the native Codex runtime (C4a), keep/drop Round 4's C6 refusal, design the rewind-path lock (:2170); then team-leader Mode 1 again.
- O6 applied: `~/.ptah/settings.json` decisionModel custom/127.0.0.1:11435/d3:4b, timeout 30000 (backup `settings.json.bak-2026-11-02-o6`). App needed a restart to load it. Pending fleet op: OLLAMA_KEEP_ALIVE on Gatsby (back up the service config first). After restart, test with `ptah_route_decide` pre-flight.
