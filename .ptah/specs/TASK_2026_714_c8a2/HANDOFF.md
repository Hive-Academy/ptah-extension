# Session handoff — TASK_2026_714_c8a2 (session 34)

Written 2026-10-31. Replaces the session 33 handoff (read it with
`git show ce6d949f4:.ptah/specs/TASK_2026_714_c8a2/HANDOFF.md`; its Goal, Rules and history stay valid).
Older handoffs: session 32 `180c7ef68`, session 31 `82e5b4455`, session 24 `44e3b1102` (full goal, PR table),
Electron live-test procedure `e10bb860a` (all `git show <sha>:.ptah/specs/TASK_2026_714_c8a2/HANDOFF.md`).

W = `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration`
(branch `feat/codex-runtime-integration`, DRAFT PR #823
https://github.com/Hive-Academy/ptah-extension/pull/823, do not merge).
T = `W\.ptah\specs\TASK_2026_714_c8a2\`. Work ONLY in W; the main checkout `D:\projects\ptah-extension`
stays clean on `main`.

## Goal (short)

One Codex App Server runtime (`@ptah-extension/codex-runtime`) for Ptah main chat, gateways and CLI lanes;
then Removal B (P10, `@openai/codex-sdk` lanes) and Removal A (P15). Electron first. Native UI contracts
identical to Claude's; gaps fixed only in the backend translation layer; no frontend Codex special case; no
second proxy; NEVER strip/revert/comment out MCP.

Routing (standing, user): codex (model `gpt-6-sol`, never `gpt-6.1-terra`) implements. A `claude` CLI lane
(`cli: claude`, role `code-logic-reviewer`) reviews codex code. Code the coordinator writes itself is reviewed
by a codex lane (different family). The coordinator runs verify, commit and push itself.

Lane limits at end of session 34: codex weekly ~55% (resets 2026-11-04 07:03 UTC); claude CLI works (limit not
tracked); Glm, grok AT LIMIT; opencode monthly 100% (resets 2026-11-04); Kimi unknown, do not use. Codex
"resumes" above ~60k tokens or idle > 600 s become fresh lanes: always give self-contained tasks (task files in T).

## Done in session 34 (all pushed; head 932dbeb92)

| Commit | Subject |
| --- | --- |
| 509815329 | Merge origin/main (bd8aac4d5) — from session 33, now pushed |
| c5b940b7f, ce6d949f4 | docs: session 33 handoff and D27 |
| 6e3fef4ef | test(rpc-handlers): stub resume-state registry in native chat specs |
| 5af6608b6 | Merge origin/main (4e2d1eb5e) |
| 39b483904 | test(rpc-handlers): match main's injection and hydration contracts |
| 932dbeb92 | feat(electron,cli-agent-runtime,agent-sdk): wire native Codex lanes (10d.E) |

- CI on 932dbeb92: CI success, Electron/Webview/CLI E2E success, MCP Bench skipped. PR MERGEABLE (BLOCKED =
  draft). CI on 39b483904 failed only `di-lint` (10c injected CODEX_ADAPTER_FACTORY, 10d.E registers it) — fixed
  by 932dbeb92.
- Windows-only local test failures (NOT branch defects; Linux CI test shards pass): rpc-handlers lineage
  path-separator specs (chat-session-agent-child, -resume-activate, -session-folder, session-folder.spec.ts —
  all main's unchanged specs) and agent-sdk `plugin-loader.service.capabilities.spec.ts:324` symlink EPERM.
  Expect them in every local rpc-handlers / agent-sdk run; ignore them, do not change them.
- 10d.E: two codex revise rounds + one coordinator spec correction. Reviews: T\code-logic-review-10d-E-r1.md
  (REVISE 6/10), -r2.md (claude APPROVED 8/10), T\code-logic-review-10d-E-coordinator-fix.md (codex APPROVED
  8/10). Lane identities carry `consumer: 'lane'` (excluded from chat listings/lookup/resume). D27 implemented in
  `apps/ptah-electron/src/di/codex-lane-composition.ts` (`resolveElectronCodexLaneRuntime`).

## In progress (uncommitted in W): batches 10d.C and 10d.V

Task files: T\task-10d-common-rules.md, T\task-10d-C.md, T\task-10d-V.md. Decision **D28** (coordinator,
reversible, stated in the task files, NOT yet in decisions.md — add the row when committing): VS Code dev
default = `context.extensionMode === Development`; CLI/TUI bind the native factory only when the lane parity
gate admits `lane` (gate closed -> legacy SDK lane). Note: `CodexParityGate.isEnabled` is typed to return
`false` (codex-parity-gate.ts:222) — "gate admitted" spec cases must replace it with Object.defineProperty (see
apps/ptah-electron/src/di/codex-runtime-composition.spec.ts:192-207).

10d.V (VS Code) — files: apps/ptah-extension-vscode/src/di/codex-lane-runtime-composition.ts (+spec, new),
phase-2-libraries.ts, container.ts, container.smoke.spec.ts, surface-composition.spec.ts (chat guard: only the
lane file is exempt from the `registerCodexRuntime|CODEX_RUNTIME_TOKENS` check). Reports T\batch-10d-V-report.md,
T\batch-10d-V-fix-1-report.md. **Verify PASSED**: `npm run verify -- -t test,lint -p ptah-extension-vscode` rc=0
"34 tasks: 34 succeeded"; typecheck,lint passed earlier.

10d.C (CLI/TUI) — files: libs/backend/cli-engine/src/lib/codex-lane-runtime-composition.ts (+spec, new),
container.ts, surface-composition.spec.ts, libs/backend/cli-engine/package.json (+`@ptah-extension/codex-runtime`
workspace dep; no install needed), apps/ptah-cli/src/di/container.smoke.spec.ts. Report T\batch-10d-C-report.md.
**Verify**: typecheck,lint PASSED (10 tasks); `cli-engine:test` FAILED (log
`C:\Users\abdal\.nx\8b7110c7390b9603\cache\terminalOutputs\10622603071588573055`):
1. codex-lane-runtime-composition.spec.ts does not compile: TS2345 MockLogger -> Logger at :122,139,166,185,210,
   231,264,294,324; TS2352 casts to CodexContext at :195,288 (need a type-safe fake, no `as unknown as`);
   TS2322 at :79 `get: async (id) => rows.get(id)` must return `null`, not `undefined`.
2. surface-composition.spec.ts guard "CLI legacy Codex composition (Batch 8e)" forbids
   `readCodexDevRouteOverride|registerCodexRuntime|CODEX_RUNTIME_TOKENS|devRoute:` in CLI sources and now hits
   the new lane file. Same fix as 10d.V: exempt only codex-lane-runtime-composition.ts from the
   registerCodexRuntime/CODEX_RUNTIME_TOKENS part; keep devRoute and chat-host-binding checks for it.
   How 10d.V's specs got a Logger without a cast: see apps/ptah-extension-vscode/src/di/codex-lane-runtime-composition.spec.ts.

Review: claude lane `5743b460-1a04-4340-a405-ffdb3389784f` reviews 10d.C + 10d.V together ->
T\code-logic-review-10d-CV.md (see Background work). It was asked to check: D27/D28 routing, R1/D26, R3,
'lane' marker, one CODEX_HOME, SHA-256 executable check in detect() (both hosts hash the binary against
findCodexExecutablePin instead of a `--version` spawn — cost and visible mismatch), disposal, the VS Code chat
guard, cross-platform specs, duplication across 3 host files.

**Review result (arrived before handoff):** T\code-logic-review-10d-CV.md — 10d.C 7/10 APPROVED, 10d.V 7/10
APPROVED. Routing D27/D28, R1/D26, R3, lane marker, one CODEX_HOME, disposal and the VS Code chat guard exemption
are correct. Defects to fix BEFORE the lane gate opens (read file:line in the review):
- C-1 (moderate): CLI `open()` fabricates binary.sha256/versionOutput from the pin (cli-engine
  codex-lane-runtime-composition.ts:228-231), so verifyCodexBinary compares the pin with itself; spec :279-310
  passes with a 'fixture' file.
- V-1 (moderate): VS Code hashes the 357 MB codex.exe twice per spawn and twice per catalog probe, no cache
  (vscode codex-lane-runtime-composition.ts:67-81,153,184). Electron caches by path/size/mtime.
- Minor: C-2 explicit-path mismatch between probe and open; C-3/V-4 mismatch logged with only errorClass, VS Code
  has no spec for digest mismatch / missing pin; V-2 a dispose error hides the open error; V-3 the gate-admitted
  routing spec cannot fail; C-4 no user-MCP home case, TUI case is source text only; C-5 (see review);
  C-6/V-6 three-way duplication.
- Reviewer recommendation (coordinator agrees): ONE shared, cached executable-inspect helper (path+size+mtime
  cache, real digest, visible mismatch) in a host-neutral lib (public index export; no vscode/electron import),
  used by CLI and VS Code (Electron may adopt it later). It fixes C-1, C-5 and V-1.
- 10d.C is NOT committable yet: its verify failures above also remain.

## Background work

- None. The claude review lane `5743b460` finished (deliverable written). No verify, watcher, codex lane or
  child session runs.

## Next steps (in order)

1. Build the codex fix tasks (task files in T, self-contained, hard rules first). Suggested split so lanes stay
   file-disjoint: (a) one lane adds the shared cached inspect helper in a host-neutral lib + spec, then
   (b) per-host lanes adopt it: 10d.C = the two verify failures above + C-1..C-5; 10d.V = V-1..V-4. Run (a)
   first, then (b) C and V in parallel. This is revise round 1 of 2 per batch.
2. Verify (background, timeout >= 90 min, read rc and "N tasks:"), two stages to fail fast:
   `npm run verify -- -t typecheck,lint -p cli-engine,ptah-cli,ptah-tui,ptah-extension-vscode,cli-agent-runtime,codex-runtime,degradation-audit,di-lint`
   then `npm run verify -- -t test -p <same list>`. Spec files are only compiled by the test target.
3. claude re-review -> commit 10d.C + 10d.V + D28 row in T\decisions.md (stage explicit paths; include the T
   task/report/review files) -> push in the background -> watch CI with
   `gh run list --branch feat/codex-runtime-integration --limit 8 --json headSha,status,conclusion,name,databaseId --jq '.[] | ...'`
   and `gh pr view 823 --json headRefOid,mergeable,mergeStateStatus --jq '"\(.headRefOid[0:9]) \(.mergeable) \(.mergeStateStatus)"'`.
   Re-merge origin/main if CONFLICTING.
4. 10d.P parity proof per T\plan-p10.md (section 10d.P) + T\plan-p10-review.md (R1-R4). A live/paid App Server
   run needs explicit user authorization: stop and ask before it.
5. 10e, 10f (Removal B) per plan-p10.md, only after a signed 10d.P proof. Then P14 (incl. GAP-3), D9, P15.

## Rules (repeat to every lane)

CLAUDE.md applies. Scoped `npm run verify -- -p ...` only, under the FIFO lock, in the background, timeout
>= 90 min; read rc and the "N tasks:" line; failed task logs are in
`C:\Users\abdal\.nx\8b7110c7390b9603\cache\terminalOutputs\<id>`. Include `degradation-audit` (and `di-lint`
for DI changes) when a batch adds a catch or an @inject. Never build/serve/e2e except an approved Electron live
run. Never npm ci/install in a worktree. No `any`, `as unknown as`, `@ts-ignore`, `eslint-disable`; bracket
`process.env['X']`; swallowing catches need `// degradation-audit: optional-capability|reported - <reason>`.
Specs must pass on Windows and Linux (paths via resolve/tmpdir; homes via normalizeCodexHomeKey). Lanes never
verify, commit, push or call ptah_get_diagnostics; say so in the first lines of each lane task; deliverable
paths absolute; tell lanes not to convert line endings (a codex lane once broke a regex that way). Never commit,
push or merge while a lane edits W or a verify runs. Commit in the foreground (commitlint scopes from
.commitlintrc.json, subject <= 72, body lines <= 100, no BOM, message via file + `git commit -F`, trailer
`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`); push in the background. Strip BOMs only from files
lanes wrote. No PR merge, force push, history rewrite, branch deletion or worktree removal (merging main INTO
the branch is allowed). Do not edit ~/.ptah/settings.json or ~/.codex/config.toml. NEVER strip MCP. jq is not
installed: use `gh --jq`.
