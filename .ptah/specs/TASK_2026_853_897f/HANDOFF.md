# HANDOFF — TASK_2026_853_897f (session prefix diet)

## Goal
Cut Ptah's ~48.9k-token fixed session prefix in four phases:
- **A**: unused Claude Code built-in tools/skills default-off (per-item toggles in Advanced settings).
- **B**: hide terminal-only and claude.ai-synced skills.
- **C**: remove duplicate prompt text.
- **D**: workspace scope as install default.

Gate 2 (plan) is approved. Specs: `implementation-plan.md`, `batches.md`, `decisions.md` (#1–#37) in this folder.
User decision (this session): N5 fixed outside the review cap, then commit Phase A **without another review round**.

## Done
- No commits on `feat/session-prefix-diet` yet (`git log main..HEAD` is empty).
- Batch 1 (A0 spikes) reports: `reports/a0-*.md`, evidence in `evidence/`.
- Phase A Batches 2–8 + review fixes F1–F3, N1–N4 (codex) and N5 (me) are implemented, **uncommitted**.
- Phase A token measurement: PASS (main −3,820, subagent −1,841), `evidence/phase-a-tokens`. AC2 agent-deny probe: PASS.
- Combined 12-project verify (`/tmp/tpd-phaseA-full-verify.log`, started before R2b/N5 edits):
  82 tasks, 81 succeeded, 1 failed = `ptah-extension-webview:lint` (pre-existing circular dependency
  with command-center, also fails on main — not task-related).
- Review history: `code-logic-review.md` (R0, R1, R2, R2b), decision #37.

## In progress
- R2b + N5 edits were made after the combined verify started. Only agent-sdk and cli-agent-runtime
  need re-verifying (discovery file `claude-skill-name-discovery.ts` ~line 235 and spec fixtures).
- Dev renderer must be rebuilt (last build failed with TS2345 before `agent:setClaudeBuiltin` was
  registered in RpcMethodRegistry — now fixed). Log: `/tmp/tpd-renderer-build.log`.
- AFTER screenshots for Phase A card not taken yet.

## Open problems and decisions
- Prettier may flag `agent-rpc.handlers.ts` + spec; lint-staged formats on commit.
- Phase B must widen the `agent:setClaudeBuiltin` skill-id check to include synced skills (decision #37).
- Side finding to offer user later: `agent:getConfig` cold-start timeout.
- Accepted: CLI `config-set` race (decision #37).

## Key files (worktree root `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet`)
- `libs/backend/agent-sdk/src/lib/helpers/claude-skill-name-discovery.ts` — same-name skill collision guard.
- `libs/backend/agent-sdk/src/lib/helpers/claude-builtin-catalog.ts` — built-in catalog + `withoutCollidingBuiltinSkillDenials`.
- `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts` — wires disallowedTools/skillOverrides/settingSources.
- `libs/backend/cli-agent-runtime/src/lib/ptah-cli/helpers/ptah-cli-spawn-options.service.ts`, `.../claude-cli.adapter.ts` — CLI lane path.
- `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts` — atomic `agent:setClaudeBuiltin`.
- `libs/shared/src/lib/types/rpc/rpc-agents.types.ts`, `rpc.types.ts` — RPC contract registration.
- `libs/frontend/chat/src/lib/settings/pro-features/claude-builtins-config.component.ts` — settings card UI.
- `libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/settings-advanced.entries.ts` — ADV-25; reachability count 139.
- `.ptah/specs/TASK_2026_853_897f/reports/a0-electron-before.md` — isolated Electron launch recipe (CDP 9333, temp HOME/XDG/PTAH_DB_PATH, unset PTAH_E2E/NODE_ENV/ELECTRON_RUN_AS_NODE, dismiss "Update available" with "Later").

## Background work
None. No lanes, child sessions or subagents running.

## Next steps
1. Re-verify the late edits:
   `npm run verify -- -p @ptah-extension/agent-sdk,@ptah-extension/cli-agent-runtime > /tmp/tpd-r2b-verify.log 2>&1; tail -20 /tmp/tpd-r2b-verify.log`
2. Rebuild renderer under lock:
   `node scripts/verify.mjs --exec --task tpd-renderer -- npx nx copy-renderer-dev ptah-electron > /tmp/tpd-renderer-build.log 2>&1`
   (main bundle may also need a rebuild for the new RPC handler). Launch isolated Electron per
   `reports/a0-electron-before.md` (not under the lock), have visual-reviewer capture dark + light
   of Advanced settings → "Claude Code tools & skills" into `evidence/`.
3. Commit Phase A in the foreground: read `.commitlintrc.json`; subject ≤72, body lines ≤100;
   stage explicit paths from `git status` (all M/?? files above), plus `.ptah/specs/TASK_2026_853_897f/`.
   **Never stage** `.ptah/specs/TASK_2026_854_8f0d/` or node_modules links. End with
   `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
4. Phase B (Batches 9–12), Phase C (13–16), Phase D (17–35, 41, 36–40) per `batches.md`; review each phase
   (codex cross-review via agent-lanes; cap 2 rounds + 1 bounded correction). Then F-D4 AFTER screenshots.
5. Push in background, `gh pr create` against main (body ends with
   `🤖 Generated with [Claude Code](https://claude.com/claude-code)`), watch CI.
