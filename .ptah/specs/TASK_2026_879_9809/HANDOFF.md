# HANDOFF — TASK_2026_879_9809 (2026-11-05)

## Goal

Fix the decision-model (System One, `d3:4b`) data gaps so routing decisions are fed real data and are observable:
- send `pastOutcomes` to the model,
- give subagent runs real verdicts,
- log every route decision,
- make the pre-flight depth question usable,
- fix the settings reload bug,
- make `ptah_outcome_report` accept absolute in-workspace paths.

User decisions:
- Include a host-side subagent verdict producer (decisions.md row 10).
- FULL AUTO for this session and the peer: build, test and verify end to end, dummy data allowed, coordinate with the peer (row 11).
- Standing CLAUDE.md authorization: commit, push and open/update the PR, then watch CI and reviews. No merge or force push.

## BLOCKER: disk almost full

`/` is at 100% (109G size, ~975M free) as of 2026-11-05 ~00:15Z. One write already failed with ENOSPC. Verify runs and the pre-push build gate need space.

The largest candidates were NOT created by this task, so ask the user before deleting any of them:
- `~/.nx` (8.6G, the shared Nx cache)
- `/tmp/ptah-asar` (1.6G)
- `/tmp/ptah-desktop_2.0.0_amd64.deb` (574M)

Run `df -h /` first.

## Ops state (already done, not code)

- The decision model is served from Chappie. The user unit `~/.config/systemd/user/ptah-chappie-ollama.service` tunnels 127.0.0.1:11435 to chappie:11434. The Gatsby unit is disabled but its file is kept.
- Chappie Ollama has `OLLAMA_KEEP_ALIVE=-1` (`/etc/systemd/system/ollama.service.d/keepalive.conf`; backup `override.conf.bak-20261104`).
- `~/.ptah/settings.json` is unchanged: custom, http://127.0.0.1:11435, d3:4b, 60000 ms. The running app still uses 30 s until restart.

## Done

- Worktree `/home/amun/ptah-extension/.claude-worktrees/decision-model-data-gaps`, branch `fix/decision-model-data-gaps` (from main 7e0b461c8). **NOT pushed, no PR yet.**
- Commits:
  - `f55424480 fix(platform-core): reload settings after atomic file replacement`
  - `47c88526e fix(lane-outcomes): verify subagent WROTE deliverables on stop`
  - `309fde9e6 fix(lane-routing): send past outcomes and log each route decision`
  - `049fcc6da fix(lane-routing): describe pre-flight depth options`
  - `559b7e356 fix(vscode-lm-tools,lane-outcomes): accept absolute report paths`
  - `2cb6b0063 test(scripts): add lane outcome seeder and live past-outcome check`
  - `b1e51523c docs(lane-routing): add TASK_2026_879_9809 specs`
- Verification at HEAD b1e51523c:
  - `npm run verify -- -p @ptah-extension/lane-routing,@ptah-extension/lane-outcomes,@ptah-extension/vscode-lm-tools,@ptah-extension/platform-core` → 12/12.
  - Host `-t test,typecheck -p ptah-electron,@ptah-extension/cli-engine` → 10/10 (earlier).
  - platform-electron and platform-cli lint/typecheck green.
  - Known unrelated flake: platform-electron `electron-state-storage-commit-store.spec.ts` (N2) 5 s timeouts under load (decisions row 27).
- Live evidence (rows 30 and 33), with `check-past-outcomes-live.mjs --live --ab` on a skewed seed at equal scores:
  - With pastOutcomes: confidence 0.995.
  - Without: 0.096, which falls back to ranking.
- Reviews:
  - Gate 2: codex APPROVED.
  - P1: claude APPROVED 8/10; fixes are in 309fde9e6.
  - Final PR review: ollama-cloud APPROVED 8/10 (`code-logic-review-final.md`), with 1 Moderate and 4 Minor.

## In progress (UNCOMMITTED, UNVERIFIED)

A fix round for the 5 final-review findings was written by a subagent that stopped when the previous session ended. It wrote no report and ran no verify.

1. Moderate, watcher latch: `libs/backend/platform-core/src/file-settings-manager.ts` + `file-settings-manager.error-paths.spec.ts`.
2. A host report must not override a `failed` verdict that has a failureClass: `lane-outcomes/src/lib/store/lane-outcome.store.ts` + the in-memory and sqlite store specs.
3. Directories are not deliverables: `lane-outcomes/src/lib/deliverable-check.ts` + spec.
4. Markdown `- WROTE:` / `**WROTE:**` forms: `lane-outcomes/src/lib/wrote-lines.parser.ts` + spec.
5. Seeder HOME fallback: `scripts/dev/seed-lane-outcomes.mjs`, `check-past-outcomes-live.mjs`, and a NEW `scripts/dev/seed-lane-outcomes.spec.ts`. Check whether any Jest/Nx project runs a spec under `scripts/`; if none does, move it or delete it.

Also uncommitted: `context.md`, `decisions.md` (antigravity limit, decision 34), the untracked `code-logic-review-final.md`, and this HANDOFF.md.

## Open problems and decisions

- Lane limits: grok exhausted (402, resets 2026-11-10); antigravity exhausted (429, ~6.6 d); kimi AT LIMIT; Ollama Code 98% weekly. codex has room (~61%), but its sandbox cannot reach the Nx socket, so the orchestrator runs verify for codex work.
- Peer session `skills and memory` (TASK_2026_878_5513 / TASK_2026_881_5b75) left the session list. The undelivered note is `.ptah/specs/TASK_2026_879_9809/peer-note-TASK_2026_878_5513.md`. Send it and the PR link when the peer is reachable (ListAgents). Ownership: this task owns lane-routing, lane-outcomes, platform-core file-settings-manager and vscode-lm-tools outcome-report. Never touch the peer's memory/skills/indexing/codex files.
- The pending handoff `/home/amun/ptah-extension/.ptah/subagent-handoffs/20261104T214520753Z-...handoff.md` is TASK_2026_858 (remote workers Batch 21). It was intentionally left pending.
- Follow-ups after the PR:
  - a P1 Minor in `lane-routing/src/lib/pipeline/phase-plan.ts` (code-logic-review-p1.md);
  - export the `'outside-root'` constant;
  - the commit-store timeout flake.

## Key files

- `.ptah/specs/TASK_2026_879_9809/implementation-plan.md` — the approved design.
- `.ptah/specs/TASK_2026_879_9809/decisions.md` — decisions 1-34.
- `.ptah/specs/TASK_2026_879_9809/code-logic-review-final.md` — the findings the uncommitted round fixes.
- `libs/backend/lane-routing/src/lib/route-decide.service.ts` — emits the `[lane-routing] route decided` log.
- `libs/backend/lane-outcomes/src/lib/deliverable-check.ts` — the shared realpath containment check.
- `scripts/dev/seed-lane-outcomes.mjs`, `scripts/dev/check-past-outcomes-live.mjs` — the dummy-data harness.

## Background work

None running. The Ollama Code final reviewer can be resumed for the scoped re-review with `resume_session_id: cbb94e27-5c70-4c2f-8d0e-b81f5a3037fb` (ptahCliId `pc-f3384f72-a556-4ab4-b2b1-7e1e028f22cb`).

## Next steps

1. Resolve disk space with the user (see BLOCKER).
2. Review the uncommitted diff against the 5 findings, and fix the `scripts/dev/*.spec.ts` placement.
3. Verify:
   - `npm run verify -- -p @ptah-extension/platform-core,@ptah-extension/lane-outcomes,@ptah-extension/vscode-lm-tools`
   - `npm run verify -- -t test,typecheck -p ptah-electron,@ptah-extension/cli-engine`
   - `npm run verify -- -t typecheck -p @ptah-extension/platform-electron,@ptah-extension/platform-cli`
   - `node scripts/dev/seed-lane-outcomes.mjs --db ~/.ptah/state/ptah.sqlite` must refuse with exit 2.
4. Commit in the foreground, staging by explicit path. Read `.commitlintrc.json` first. Subject ≤ 72, body lines ≤ 100, trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Use a separate docs commit for the specs.
5. Run a scoped re-review of the fix commits by a non-claude family (Ollama Code resume, or codex).
6. Push in the background: `git push -u origin fix/decision-model-data-gaps && gh pr create --base main`, with a title under 70 characters, `## Summary`, `## Test plan` (real results, the live A/B numbers, the flake), ending with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
7. Watch CI and reviews with `gh`. Fix confirmed defects with new commits. Report the PR URL, head, CI and review state, and send the peer the note.
