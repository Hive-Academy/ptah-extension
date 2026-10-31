# HANDOFF — TASK_2026_853_897f (session prefix diet), Phase D

Written 2026-10-31 ~20:35 UTC. Supersedes every earlier HANDOFF.md copy.

## Goal
Cut Ptah's fixed session prefix in four phases, each its own PR (implementation-plan.md:3-5):
**A** built-ins default-off, **B** hide claude.ai-synced skills, **C** remove duplicate prompt
text, **D** workspace scope as install default (Batches 17–35, 41, 36–40, then F-D4 after
screenshots). Specs in this folder: `batches.md`, `implementation-plan.md`, `decisions.md`
(#1–#65), `reports/batch-N.json`.

User decisions: claude backend/frontend-developer subagents implement, codex reviews (#52);
skip kimi. Phase D gets ONE independent codex code-logic + style review over the combined D
diff, plus Electron visual review after Batch 40, before the initial push.

## Done
- Phase A #854, B #862, C #863, CLI-lane PR #865: merged.
- Phase D: worktree `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet-d`,
  branch `feat/session-prefix-diet-d`, NOT pushed, PR will target `main`. Commits so far:
  - `850dc070c` B17, `19987358a` merge origin/main, `60d9d8db8` B21, `6da2753b5` B20,
    `e08435c34` B18, `4cea6c6d0` B19, `284ec9cdc` B22, `d770661a6` B23, `50f95cf31` B24,
    `1f9bf8beb` B24a, `1f24b89a5` audit markers, `5f862502f` B25
  - `bf579c754` B26 feat(agent-sdk,electron): keep workspace skills.sh roots local
  - `fa16040f3` B28 feat(rpc-handlers,shared): default MCP directory installs to workspace
  - `4f6bca120` B29 feat(rpc-handlers): scope external-plugin MCP servers on consent
    - B26/28/29 cohort verify: 74 tasks, 73 ok, only known webview lint; audit exit 0.
  - `ebb9158bd` B27 feat(rpc-handlers,shared): default skills.sh installs to workspace
  - `310efe6e2` B30 feat(vscode-lm-tools): default harness installs to workspace scope
    (includes protocol-dispatcher.ts forwarding `scope`; install_mcp_server description
    shortened 1002 → ~700 chars to fit its 780 budget — never raise budgets in this task)
  - `a9b54d12d` B32 feat(agent-generation): report reaped user-layer clones by path
    - B27/30/32 cohort verify: 77 tasks; only webview lint + vscode-lm-tools:test failed;
      the latter was the description budget (fixed) + outliner timing under load; rerun of
      sweep/tool-description/outliner 218/218 exit 0; audit exit 0.

## In progress (uncommitted in the D worktree, implementation complete, NOT verified)
- **Batch 31** (help copy): `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/system-namespace.builders.ts|.spec.ts`.
  Scoped test 110/110 exit 0 (/tmp/tpd-b31-test.log). Report `reports/batch-31.json`.
- **Batch 33** (migration service + ledger): new folder
  `libs/backend/rpc-handlers/src/lib/install-scope/` (service + spec, 23/23 exit 0,
  /tmp/tpd-b33-test.log) and `libs/backend/agent-generation/src/index.ts` (reaper exports,
  decision #65; agent-generation typecheck exit 0). Report `reports/batch-33.json` has the full
  API, ledger schema, write→reader trace, deviations and the Batch 34/35 handoff.
- Report fixes for batch-27/30/32.json (verify text was PENDING in the committed copies) and
  decisions.md row #65 are uncommitted — commit them with Batch 31 or 33.
- The cohort verify for 31+33 was SIGTERM'd while queued (/tmp/tpd-b31-33-verify.log); it
  never ran. Both reports say `"combinedVerify": "PENDING"`.

## Open problems and decisions
- Known non-batch failures (ignore): 2 tests in harness-sync `agent-workspace-scope.spec.ts`
  (environmental; `/home/amun/projects/.ptah` exists — never touch it); `ptah-extension-webview:lint`
  (pre-existing); ptah-electron git-watcher timing and vscode-lm-tools outliner timing tests
  under machine load (pass alone).
- Batch 33 service is ~795 non-comment lines → `max-lines` lint WARNING (not error). Optional
  later split into `install-scope-ledger.ts`; not required.
- Batch 33 deviations accepted (see report): v1 MCP intents retired in ledger only; the service
  is a second writer of `.ptah-skillssh-retired.json` (boot-time, race theoretical).
- Batch 28 open item: pre-existing raw error text in install results (not changed).
- Lock contention: other worktrees (onboarding-module, feat-landing-live-demo, …) hold verify
  slots; cohort verifies take 30+ min including queue.
- Worktrees `session-prefix-diet-cifix` and merged B/C/cli-lane worktrees: remove only with
  user authorization.

## Key files
- `.../TASK_2026_853_897f/batches.md` — batch scope/acceptance (paths say `session-prefix-diet/`; use `session-prefix-diet-d/`); contracts lines 52-86; Batches 34+ from ~line 525.
- `.../TASK_2026_853_897f/decisions.md` — #56-#65 are the Phase D integration contracts.
- `.../reports/batch-33.json` — migration service API + Batch 34/35 handoff.
- `.../reports/batch-30.json` — harness tool scope contract.
- `libs/backend/rpc-handlers/src/lib/skills-sh/skills-sh-source-root.ts` — `verifyOwnedRoot`.

## Background work
None alive. All subagents finished and reported. No CLI lanes or child sessions.

## Next steps
1. In the D worktree, run ONE cohort verify for 31+33 (background, one completion wait):
   `npm run verify -- -p @ptah-extension/rpc-handlers,@ptah-extension/vscode-lm-tools,@ptah-extension/agent-generation,ptah-electron,ptah-extension-vscode,ptah-cli,ptah-tui,@ptah-extension/cli-engine > /tmp/tpd-b31-33-verify.log 2>&1`
   Filter: `grep -E "NX .*tasks|✖" /tmp/tpd-b31-33-verify.log`; failing task log path is printed
   under each ✖ (`~/.nx/.../terminalOutputs/...`).
   Then `node scripts/verify.mjs --exec --task degradation-audit -- npx nx run degradation-audit:lint --skip-nx-cache --output-style=static` (must exit 0).
2. Fill `combinedVerify` in batch-31/33.json (use node JSON edit, not sed — `|` breaks sed).
   Commit B31 (scope `vscode-lm-tools`) with batch-31.json + decisions.md + batch-27/30/32.json
   fixes; commit B33 (scope `rpc-handlers,agent-generation`) with batch-33.json. Foreground.
3. Batch 34 (senior-tester: fixture suite + notice RPC, new files in install-scope/), then
   Batch 35 + 41 as one integration cohort (registration in register-shared-rpc-handlers.ts,
   Electron boot-heavy-services trigger, VS Code expected-resolvable). Use batch-33.json handoff.
   35 needs rpc-allowlist and rpc-surface/container smoke to pass; verify 41 with
   `npm run verify -- -p ptah-extension-vscode,ptah-electron,@ptah-extension/rpc-handlers`.
4. Frontend 36–40 (frontend-developer subagents; 36 first, then 37/38/39 file-disjoint, 40
   after 34–35). Batch 39 needs the Batch 1 BEFORE screenshots to exist.
5. Codex Phase D review (code-logic + style) over `git diff main...HEAD`, Electron visual
   review dark/light, F-D4 after screenshots (`evidence/f-d4-after-{dark,light}.png`), then push
   in background, open PR to main, watch CI/reviews.

## Rules (repeat to every subagent and lane)
- Worktrees only. Verify only with `npm run verify -- -p <changed + dependent hosts>`; never
  workspace-wide or nx run-many; save output to a file and filter it; Jest flags only on `-t test`.
- Never verify while another batch's edits are unfinished (decisions #60/#62). Parallel batches
  run scoped specs only; coordinator runs one cohort verify, then commits each batch separately.
- Other heavy commands: `node scripts/verify.mjs --exec --task <name> -- <cmd>`.
- No build/serve/e2e except Electron screenshot launches. Electron first; keep all hosts compiling.
- Never stage node_modules links or `.ptah/specs/TASK_2026_854_8f0d/`.
- No DB deletion, settings/account changes or credential use without asking. Do not touch `/home/amun/projects/.ptah`.
- Never merge, force-push, or remove worktrees. Commit each batch in the foreground; push in the background. Append decisions to decisions.md.
