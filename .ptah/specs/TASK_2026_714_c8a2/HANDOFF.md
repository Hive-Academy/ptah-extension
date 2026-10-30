# Session handoff — TASK_2026_714_c8a2 (session 31)

Written 2026-10-30. Replaces the session 30 handoff (read it with
`git show 361264382:.ptah/specs/TASK_2026_714_c8a2/HANDOFF.md`; its Goal, Rules and lane spec traps
are still valid). The full Goal, PR table, older open items, key-file list and Rules are in the
session 24 handoff: `git show 44e3b1102:.ptah/specs/TASK_2026_714_c8a2/HANDOFF.md`. The Electron
live-test procedure is in `git show e10bb860a:.ptah/specs/TASK_2026_714_c8a2/HANDOFF.md`
(section "Electron live-test procedure (run from W)") and T\live-test-p8k.md / T\live-test-p8l.md.

W = `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration`
(branch `feat/codex-runtime-integration`, DRAFT PR #823
https://github.com/Hive-Academy/ptah-extension/pull/823, do not merge).
T = `W\.ptah\specs\TASK_2026_714_c8a2\`. Work ONLY in W (absolute paths or `git -C W`); the main
checkout `D:\projects\ptah-extension` must stay clean on `main`.

## Goal (short)

One Codex App Server runtime (`@ptah-extension/codex-runtime`) for Ptah main chat, gateways and
CLI lanes; then Removal B (P10, `@openai/codex-sdk` lanes) and Removal A (P15, Claude SDK + Codex
translation proxy for Codex main chat). Electron first. Native UI contracts identical to Claude's;
fix gaps only in the backend translation layer; no frontend Codex special case; no second proxy;
NEVER strip/revert/comment out MCP.

User routing instruction (standing): use Codex (model `gpt-6-sol`, never `gpt-6.1-terra`), grok and
Kimi Code CLI lanes heavily and REPLACE Claude subagents for implementation, reviews and planning.
grok implements -> Kimi Code reviews (ptahCliId `pc-10e5a6b5-b237-4c72-a213-3202bd30d1fe`,
modelTier opus; fallback codex); codex implements -> grok reviews. Check `ptah_agent_list` first.
The coordinator runs verify, commit and push itself.

Lane limits at handoff (session 31):
- Kimi Code: two 429 "rate limit exceeded" failures (17:00 UTC), reset unknown. Skipped for the
  rest of session 31. Re-check with ptah_agent_list; one short probe review is reasonable.
- grok: weekly 97% (resets 2026-11-03 17:40 UTC); one list read showed "API key, no plan", so grok
  can bill per request. Use it only for short reviews.
- codex: weekly ~40% (resets 2026-11-04 07:03 UTC). Main implementer.
- For a coordinator correction, codex is a valid reviewer (different family from claude).

## Done in session 31 (all pushed; PR #823 head fe775e379)

| Commit | Subject |
| --- | --- |
| 361264382 | fix(agent-sdk,rpc-handlers): answer Codex chat:continue at admission (8r-6, G9) |
| 34d675d62 | feat(codex-runtime,cli-agent-runtime): type the Codex lane config (10b.0a) |
| 440fa5eb8 | feat(codex-runtime): send the typed lane config and a pre-turn reject (10b.0b) |
| fe775e379 | feat(cli-agent-runtime): project Codex lane controls into the profile (10b.0c) |

- 8r-6: spec fix lane + coordinator correction of a recursive jest mock
  (codex-chat-adapter.spec.ts). Reviews in T (review-8r-6-spec-fix*.md).
- 10b.0a: lanes now resolve to D26 (approval never, workspace-write in the lane cwd, no network)
  at every level; chat/gateway fingerprint pinned by a literal (R2). Legacy lanes used
  danger-full-access + never, so D26 is stricter.
- 10b.0b: lane thread frames carry buildCodexLaneThreadConfig (single lane MCP source);
  CodexPreTurnConfigRejectedError (exported); codex-app-server-process.ts close() keeps a typed
  CodexProcessFailureError with the pending method when the child already exited (exit code,
  signalCode or exitObserved) — coordinator correction, review-10b-0b-correction.md APPROVE 9/10.
  Note: buildCodexThreadConfig (codex-mcp-config.ts) is NOT exported from the codex-runtime index.
- 10b.0c: lane bridge projects every requirement into settings.lane; handler map per key.
- Verify: every batch passed its R2 list (codex-runtime, cli-agent-runtime, agent-sdk,
  rpc-handlers, gateway-chat-bridge, ptah-electron; cli-engine for 10b.0c) and the 3 host
  typechecks. CI: 361264382 one flaky frontend failure (stdout-visibility.spec.ts, passed on
  re-run and locally); 34d675d62 and 440fa5eb8 19 pass / 4 skipped; fe775e379 watched at handoff.
- Executor change: the plan named grok for 10b.0c; codex implemented it (grok near limit, Kimi
  429). Batch 10b is split into 10b-1 (adapter core) and 10b-2 (config retry, model rejection,
  catalog, effort, binary/credentials), same new files, sequential.

## Background work

- CLI lane `38145f3b-200a-453b-855a-8fb4a4881745` (codex gpt-6-sol): RUNNING at handoff. Batch
  10b-1, creates `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/
  codex-app-server-lane.adapter.ts` + spec (and maybe small helper files). Deliverable
  `T\batch-10b-1-report.md`. It edits W: do not commit or push until it ends. If it times out,
  take its CLI Session ID from ONE ptah_agent_status call and resume with full instructions
  (resumes become fresh lanes when context is large).
- Background CI watcher on fe775e379 (session-local; re-check with
  `gh pr checks 823 --json bucket --jq 'group_by(.bucket)|map({(.[0].bucket):length})|add'`).
- No verify running, no child session.

## Next steps (in order)

1. When lane 38145f3b ends: read `T\batch-10b-1-report.md` and `git -C W status --short`; check
   the files stay inside scope and follow R1 (decline every approval request, no command text in
   the output line), queue-only flags, no `@openai/codex-sdk` import.
2. Independent review (grok short review or Kimi if it has recovered; codex is the implementer
   so not codex); deliverable `T\review-10b-1.md`. Revise cap 2 lane rounds, then one bounded
   coordinator correction + independent review.
3. Verify (background, timeout >= 90 min):
   `npm run verify -- -p cli-agent-runtime,codex-runtime,cli-engine,ptah-electron` then
   `npm run verify -- -t typecheck -p ptah-extension-vscode,ptah-cli,ptah-tui`.
   Read rc and the "N tasks:" line; failure logs at
   `C:\Users\abdal\.nx\8b7110c7390b9603\cache\terminalOutputs\<id>`.
4. Commit 10b-1 (foreground, explicit paths, BOM strip, `git commit -F`, scope
   `cli-agent-runtime`), push in the background (one commit at a time if GitHub returns Internal
   Server Error), watch CI.
5. Then 10b-2 (codex), 10c, 10d.E/C/V, 10d.P (parity proof; live/paid run needs coordinator
   authorization at the plan stop point), 10e, 10f per T\plan-p10.md + T\plan-p10-review.md (R1-R4).
   Then P14 (incl. GAP-3: Codex chat gets the user's MCP servers from `~/.claude.json` via
   cli-agent-runtime mcp-directory/claude-user-mcp.reader.ts), D9, P15 Removal A. G4 spike stays on
   hold (no proof a non-null environmentId is local). A later live run re-checks G3, G7
   (Plan-mode change) and G9 with a turn longer than 120 s.

## Rules (unchanged; repeat to every lane)

CLAUDE.md applies. Scoped `npm run verify -- -p ...` only, in the background, timeout >= 90 min.
Never build/serve/e2e except the approved Electron live run. Never npm ci/install in a worktree.
No `any`, `as unknown as`, `@ts-ignore`, `eslint-disable`. Lanes never verify, commit, push or call
ptah_get_diagnostics; say so in the first lines of each lane task; deliverable paths absolute.
Never commit while any lane edits W (read-only review lanes are fine). Commit in the foreground
(commitlint scopes, subject <= 72, body lines <= 100, no BOM, message via file + `git commit -F`,
trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`); push in the background, and
not while a lane edits W (the pre-push build gate reads the working tree). No merge of the PR,
force push, history rewrite, branch deletion or worktree removal (merging main INTO the branch is
allowed). Do not edit ~/.ptah/settings.json (except the live-test backup/restore) or
~/.codex/config.toml. NEVER strip MCP. Use `gh --jq`. Strip UTF-8 BOMs from lane-written files.
Lane spec traps to repeat: no assignment to readonly mock properties (Object.defineProperty); no
bracket access to private members; Promise resolves via `new Promise<void>((resolve) => ...)`;
explicit `let f: () => void = () => undefined` typing; no pending real timers or promises at test
end; no excess properties in typed object literals; `import 'reflect-metadata';` first in specs
that load tsyringe; capture a jest mock's implementation with getMockImplementation() before
replacing it (a saved mock reference recurses); Jest `toHaveProperty('a.b')` is a nested path, use
`toHaveProperty(['a.b'])` for a literal dotted key. A static lane review is not a test run: always
verify after an APPROVE.
