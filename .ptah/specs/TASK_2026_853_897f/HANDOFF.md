# HANDOFF — TASK_2026_853_897f (session prefix diet), Phase D

Written 2026-10-31 ~18:05 UTC. Supersedes every earlier HANDOFF.md copy.

## Goal
Cut Ptah's fixed session prefix in four phases, each its own PR (implementation-plan.md:3-5):
**A** built-ins default-off, **B** hide claude.ai-synced skills, **C** remove duplicate prompt
text, **D** workspace scope as install default (Batches 17–35, 41, 36–40, then F-D4 after
screenshots). Specs in this folder: `batches.md`, `implementation-plan.md`, `decisions.md`
(#1–#63), `reports/batch-N.json`.

User decisions: claude backend-developer subagents implement, codex reviews (#52); skip kimi.
Phase D gets ONE independent codex code-logic + style review over the combined D diff, plus
visual review after Batch 40, before the initial push.

## Done
- Phase A #854, B #862, C #863: merged. CLI-lane PR #865: merged (2026-10-31).
- Phase D: worktree `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet-d`,
  branch `feat/session-prefix-diet-d`, NOT pushed, PR will target `main`. Commits:
  - `850dc070c` B17, `19987358a` merge origin/main, `60d9d8db8` B21, `6da2753b5` B20,
    `e08435c34` B18, `4cea6c6d0` B19
  - `284ec9cdc` B22 manifest builder: retired clones inactive, workspace skills.sh exemption
  - `d770661a6` B23 retirement removal proofs (hash + git ls-files, real-git fixtures)
  - `50f95cf31` B24 reconciler/health carry retirement outcomes; workspaceRoot to builder
  - `1f9bf8beb` B24a fix: ClaudeTarget uses shared `targets/retirement-proof.ts` (decision #59)
  - `1f24b89a5` degradation-audit markers for B22 fail-open catches
  - `5f862502f` B25 skills.sh workspace/global roots, metadata v2, `verifyOwnedRoot`, Make global
  - Verify evidence per batch is in `reports/batch-22..25.json` and `batch-24a.json`. Last
    combined V-RPC (with 24a): 68 tasks, 67 ok, only known webview lint failed.
    `degradation-audit:lint` exit 0 after markers.

## In progress (uncommitted in the D worktree — subagents were killed at 18:01 UTC)
Batches 26, 28, 29 ran in parallel (decision #62: each runs only its scoped spec; coordinator
runs ONE combined verify, then commits each batch separately). All three subagents ended
with the old process; their completeness is UNKNOWN — inspect each diff against its batch
acceptance in batches.md before verifying.
- **Batch 26** (agent-sdk loader): `libs/backend/agent-sdk/src/lib/helpers/plugin-loader.service.ts`,
  `plugin-loader.service.spec.ts`, `apps/ptah-electron/src/activation/plugin-activation.ts`.
  A scoped test run `npm run verify -- -t test -p @ptah-extension/agent-sdk -- --testPathPatterns=plugin-loader`
  exited 0 at 17:57 (/tmp/tpd-b26-test.log); a later replay was SIGTERM'd. Typecheck not run.
- **Batch 28** (MCP directory): `mcp-directory-rpc.handlers.ts|schema.ts|handlers.spec.ts`,
  `harness/io/harness-mcp-install.service.ts`, new `harness-mcp-install.service.spec.ts`, plus
  cross-owner `libs/shared/src/lib/types/rpc.types.ts` (adds `mcpDirectory:makeGlobal` to
  `RpcMethodRegistry` + `RPC_METHOD_ENTRIES`, decision #63). Tests never ran (SIGTERM in queue).
- **Batch 29** (external-plugin MCP): `plugin-rpc.handlers.ts|schema.ts|handlers.spec.ts`,
  `external-plugin-mcp.service.ts|.spec.ts`. Tests never ran.
- `decisions.md` has uncommitted rows #62 and #63 — commit them with the first of these batches.

## Open problems and decisions
- Known non-batch failures (ignore): 2 tests in harness-sync `agent-workspace-scope.spec.ts`
  (environmental: `/home/amun/projects/.ptah` exists — never touch it); `ptah-extension-webview:lint`
  (pre-existing); `ptah-electron` git-watcher timing tests under machine load (pass alone).
- Lock contention: other sessions (onboarding-module, plugin-session-root, ptahcode-rebrand)
  hold verify slots for long; H-set verifies take ~45 min.
- Lane-completion signals for TASK_2026_ONBOARDING lanes reached this session; they are not
  ours (possible routing bug; user told). User may open a separate task about lanes rarely
  spawning subagents.
- Worktrees `session-prefix-diet-cifix` and merged B/C/cli-lane worktrees: remove only with
  user authorization.

## Key files
- `.../TASK_2026_853_897f/batches.md` — batch scope/acceptance (paths say `session-prefix-diet/`; substitute `session-prefix-diet-d/`); contract lines 52-86.
- `.../TASK_2026_853_897f/decisions.md` — #56-#63 are the Phase D integration contracts.
- `.../reports/batch-24.json` — result schema for Batch 33 (migration ledger).
- `.../reports/batch-25.json` — `verifyOwnedRoot` / makeGlobal contract and Batch 26/27/33 follow-ups.
- `libs/backend/harness-sync/src/lib/targets/retirement-proof.ts` — shared hash+git proof.
- `libs/backend/rpc-handlers/src/lib/skills-sh/skills-sh-source-root.ts` — `verifyOwnedRoot`.

## Background work
None alive. The three subagents (B26, B28, B29) are lost; only their file edits remain.
No CLI lanes or child sessions were started by this session.

## Next steps
1. In the D worktree, review the B26, B28, B29 diffs against batches.md (lines 429-475) and the
   follow-ups in reports/batch-22/24/25.json (B26: skip retired ids for GLOBAL roots only,
   workspace discovery via `workspacePluginsDir(ws)`, never in `buildMirrorSources`, keep
   `.staging-ptah-skillssh-*` excluded). Finish any missing part with a fresh
   backend-developer subagent per batch (file-disjoint, scoped tests only).
2. Scoped tests (one at a time is fine):
   `npm run verify -- -t test -p @ptah-extension/rpc-handlers -- --testPathPatterns='mcp-directory-rpc|harness-mcp-install|plugin-rpc|external-plugin-mcp' > /tmp/tpd-b2829-test.log 2>&1`
3. ONE combined verify (background, one completion wait, save + filter):
   `npm run verify -- -p @ptah-extension/shared,@ptah-extension/agent-sdk,@ptah-extension/rpc-handlers,ptah-electron,ptah-extension-vscode,ptah-cli,ptah-tui,@ptah-extension/cli-engine,ptah-extension-webview > /tmp/tpd-b26-29-verify.log 2>&1`
   Then `node scripts/verify.mjs --exec --task degradation-audit -- npx nx run degradation-audit:lint --skip-nx-cache --output-style=static` (must exit 0; add `// degradation-audit: optional-capability|reported - <reason>` markers to new swallowing catches).
4. Write reports/batch-26.json, -28.json, -29.json; commit B26, B28 (with rpc.types.ts), B29
   separately in the foreground (scopes from `.commitlintrc.json`, e.g. `agent-sdk`,
   `rpc-handlers`, `shared`).
5. Batch 27 (skills.sh RPC; depends on 25–26; also joins `skillsSh:makeGlobal` into
   rpc.types.ts like #63; fix stale `SKILLS_SH_SCOPE` comment in
   `harness/io/harness-skill-install.service.ts:26`). V-RPC verify.
6. Continue 30–35, 41, 36–40 (decisions #60/#62: never verify while another batch's edits are
   unfinished; parallel batches run scoped specs, then one cohort verify). Then the codex Phase D
   review (code-logic + style), Electron visual review dark/light, F-D4 after screenshots,
   push in background, open PR to main, watch CI/reviews.

## Rules (repeat to every subagent and lane)
- Worktrees only. Verify only with `npm run verify -- -p <changed + dependent hosts>`; never
  workspace-wide or nx run-many; save output to a file and filter it; Jest flags only on `-t test`.
- Other heavy commands: `node scripts/verify.mjs --exec --task <name> -- <cmd>`.
- No build/serve/e2e except Electron screenshot launches. Electron first; keep all hosts compiling.
- Never stage node_modules links or `.ptah/specs/TASK_2026_854_8f0d/`.
- No DB deletion, settings/account changes or credential use without asking. Do not touch `/home/amun/projects/.ptah`.
- Never merge, force-push, or remove worktrees. Commit each batch in the foreground; push in the background. Append decisions to decisions.md.
