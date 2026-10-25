# Session handoff — TASK_2026_714_c8a2 (session 7)

Written 2026-10-25. Replaces the session 6 handoff. No subagent, CLI lane or background command
of this session is running. Two branches are in flight: the runtime branch (this task) and a
separate fix branch for provider-switch defects found in a live Electron test.

## Goal

One Codex runtime for Ptah: the Codex App Server, shared by main chat, the messaging gateways and
CLI lanes through ONE core lib (`@ptah-extension/codex-runtime`) and thin adapters. Then DELETE the
two legacy paths: A = Claude Agent SDK + Codex translation proxy (main chat), B =
`@openai/codex-sdk` (CLI lanes). Claude behavior unchanged. Electron first. No runtime-selector
UI. Production stays behind the parity gate until parity is proven.

**User decision (this session):** the runtime PR will NOT be merged until the App Server path runs
main chat, gateways and lanes, with session handling and subagents working, AND paths A and B are
removed. Defects found on the way go out as SEPARATE small PRs that the user merges first; then
`main` is merged into the runtime branch.

## Merged

- PR #808 (TASK_2026_712, Claude multi-account) merged 2026-10-25.
- PR #809 (this task's foundation: P2 core, P3 2c, P4 3a/3c/3d/3b-partial, 9a, 10a, host
  tsconfigs) merged 2026-10-25 at `b73a6ff74`. main head at branch time: `16c6455e1`.

## Branch 1 — runtime: `feat/codex-runtime-integration`

- Worktree `D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration`, from
  `16c6455e1`. `node_modules` is a junction to the main checkout (never `npm ci`/`npm install`;
  remove it with `cmd /c rmdir node_modules` before any `git worktree remove`).
- **Not pushed, no PR yet.** 4 commits:

| Batch | Commit | What |
| --- | --- | --- |
| 5a | `085a9341d` | shared session-runtime identity/controls contracts; Zod schema on `@ptah-extension/shared/schemas` (main barrel stays Zod-free, guarded by `index.zod-free.spec.ts`) |
| 5b (old 3b.1) | `5a7e8f989` | home-aware Codex usage service; explicit homes go to an injected core client (registered null for now); default home unchanged |
| 5c | `953fee97d` | `resolveExecutionProfile` seam; same-home owner resolution; exports |
| 5d | `52e06df02` | P5 review fixes (resume ignores the current provider, normalized workspace paths, Codex-only seed models, default-home alias owner key) + both P5 reviews |

- Verification done by the team-leader (scoped): shared lint/test/typecheck pass;
  auth-providers + auth-providers-tokens typecheck pass, tests pass except the known Windows EPERM
  `translation-proxy.sdk.integration.spec.ts`, lint = the 3 errors already on main; typecheck of
  ptah-electron, ptah-extension-vscode, ptah-cli, ptah-tui pass; container.smoke tests pass.
- Reviews: `code-logic-review-p5.md` REVISE 6.5 (findings 1–3 fixed in 5d);
  `code-style-review-p5.md` APPROVED 7 (findings 1 and 3 fixed in 5d).
- **P5 gate is OPEN:** one code-logic re-review of `953fee97d..52e06df02` has not run.
- Untracked: `research-codex-gaps.md` (from the research agent, this session) — commit it with
  the next docs commit.
- Deviations recorded in `batches.md` as P5-D1..D6. Main one: 5b only routes NON-default homes to
  the core client. The default home cannot switch yet because the core client drops activity
  numbers, keys owners by accountId (not home+email, splitting #808 quota rows) and refuses any
  non-pinned Codex binary. These are parity items before the default home switches.
- Open items for later batches: identity schema accepts non-normalized strings (P6/P7 writers must
  normalize); no payload-map entry for `PERMISSION_PROMPT_CANCELLED` (8b); explicit homes not
  invalidated on auth-file change (P8); P8 must bind the real usage client before the usage
  service is first resolved; several new exports have no consumer until P6–P8.

## Branch 2 — fix: `fix/provider-switch-model-sync`

- Worktree `D:/projects/ptah-extension/.claude-worktrees/provider-switch-model-sync`, from
  `16c6455e1`, `node_modules` junction. **Uncommitted, not pushed, no PR.**
- Source: live Electron test this session (Codex main chat on legacy path A, Claude haiku and
  Codex luna paid runs, ~$0.07). Evidence + screenshots: `%TEMP%/ptah-live-test/` (`shots/`,
  `electron.log`, `settings.backup.json`). The test restored the 6 settings keys it changed.
- Defects and status:
  - **D1 fixed** — a saved non-tier model (e.g. `gpt-6-luna`) was never offered, so "Default"
    resolved to the opus tier. New `config-saved-model-option.ts`; `registerModelsList` matches
    tier aliases and appends/selects a saved model if the provider catalog has it.
  - **D2 fixed** — the open session's model list did not follow a provider switch (next send went
    to Anthropic with a Codex model id). `AuthStateService` now re-syncs models, effort and plan
    limits when `authMethod|activeProviderId` changes after an auth-status read; the picker drops
    a tab override the new list does not offer; the plan-limits card uses the new
    `activeProviderId`.
  - **D3 fixed** — `config:model-get` (a read) rewrote non-`claude-` values globally and wiped the
    workspace override. It is now a pure read.
  - **D4 left as is (decision)** — Codex tier auto-map stays provider-level/global (fills unset
    tiers only); making tiers per-workspace would touch `workspace-provider-profile-resolver.ts`
    (runtime branch). The "haiku shows Default" symptom is fixed by D1+D3.
- Changed files (all under that worktree):
  `libs/backend/rpc-handlers/src/lib/handlers/config-rpc.handlers.ts` (+`.spec.ts`),
  `libs/backend/rpc-handlers/src/lib/handlers/config-saved-model-option.ts` (new),
  `libs/frontend/core/src/lib/services/auth-state.service.ts` (+`.spec.ts`),
  `libs/frontend/core/src/lib/services/model-state.service.spec.ts`,
  `libs/frontend/chat/src/lib/components/molecules/chat-input/model-selector.component.ts` (+`.spec.ts`),
  `libs/frontend/dashboard/src/lib/components/provider-account-card/provider-account-card.component.ts` (+`.spec.ts`).
- Verification by the fixer: config-rpc tests pass; `-p rpc-handlers,core,chat,dashboard` → all
  test + typecheck pass, dashboard lint pass, but lint FAILS for core (2), chat (135, mostly
  "static imports of lazy-loaded libraries" for `@ptah-extension/shared`) and rpc-handlers — all
  reported in untouched lines/files, NOT yet compared with main; `-t typecheck -p ptah-electron`
  pass. Warnings only in changed files: `auth-state.service.ts` 794 lines (>700, was already
  over), unused `EffortLevel` import in `config-rpc.handlers.ts` (remove it).
- Not done: independent review, commit, push, PR, Electron rerun of the three scenarios.
- Left open: no host push event (changes from CLI/another window apply only on the next auth
  read); a restored tab can still show the old provider's model label (send uses the corrected
  model).
- User's real `~/.ptah/settings.json` has a stray top-level `authMethod = "some-value"` (likely
  leaked test data). Reported to the user; not changed. Do not edit without the user's go.

## Decisions this session (write them into `decisions.md` — not done yet)

1. Removal A (proxy), then Removal B (codex-sdk lanes), are IN SCOPE of this task, each after
   parity proof, each its own commit with proof.
2. The 8 remaining spike turns are APPROVED (≤30000 tokens/turn, ≤100000/run). Order: the gap
   spikes first (revert 2–3, file edit vs shell edit 1, native subagent 1), report what is left,
   then Always Allow different-command and remote MCP.
3. **Use native App Server features wherever they exist; build only where they do not.** Make them
   fit Ptah's UI and workflows. (User: "if they does why would we care to build our own".)
   - Subagents: NATIVE (`collabAgentToolCall`, `subAgentActivity`, `parentThreadId`; stable,
     default-on). Map to Ptah agent cards (`agent_start`/agent-end), keep child-thread events out
     of the main transcript, route child approvals through the Ptah approval bridge, rebuild cards
     from stored threads on resume. Personas: check whether Codex supports named agent roles; if
     yes wire Ptah agent files to it, if no report it as a gap (no workaround). Lanes currently
     disable subagents (`codex-lane-config.builder.ts:104`) — decide at the lane migration.
     The Ptah-owned spawn tool idea is DROPPED.
   - Sessions: NATIVE. Codex rollout JSONL in each CODEX_HOME `sessions/` is the single source of
     truth; history via `thread/read` → event translator; resume via `thread/resume`. Ptah keeps
     only its session metadata (title, workspace, provider, runtime, child agents) keyed by thread
     id. No Ptah JSONL copy.
   - History rollback: NATIVE `thread/revert {threadId, beforeTurnId}` (or `thread/fork`). The old
     -32600 came from `thread/rollback`, which refuses paginated threads and is removed by 0.163.
   - File rewind: NOT native → build a Ptah turn-start git shadow-tree checkpoint returning the
     existing `SessionRewindResult`.
4. A dev-only switch turns on the new runtime for main chat (parity gate stays closed for
   production) so the live Electron scenarios can be rerun on the new path.

See `research-codex-gaps.md` for the evidence behind 3 (schema lines, source URLs, sizes).

## Key files

- Plan/state: `batches.md`, `implementation-plan.md`, `decisions.md`, `native-route-evidence.md`,
  `research-codex-gaps.md`, `code-logic-review-p5.md`, `code-style-review-p5.md`, `batch-5*-report.md`.
- Gate: `libs/backend/codex-runtime/src/lib/di/registration.ts` (throws 'Codex production routing
  disabled by parity gate'), `libs/backend/codex-runtime/src/lib/codex-parity-gate.ts` (ledger
  still needs the reviewed 7a2–7f update).
- Subagent mapping: `libs/backend/codex-runtime/src/lib/codex-event-translator.ts:324` (collab items → generic rows today).
- Protocol: `libs/backend/codex-runtime/src/lib/protocol/codex-app-server-protocol.schema.json`.

## Next steps (in order)

1. **Fix branch first** (in `.claude-worktrees/provider-switch-model-sync`):
   1. Compare the lint failures with main: in a temp worktree on `origin/main`, or check whether
      the errors are in untouched lines — `npm run verify -- -t lint -p @ptah-extension/core,@ptah-extension/chat,@ptah-extension/rpc-handlers`.
      Do not raise baselines; only errors this branch adds must be fixed. Remove the unused
      `EffortLevel` import.
   2. Independent review (code-logic-reviewer) of the diff.
   3. Commit (foreground, explicit paths, `.commitlintrc.json`), e.g.
      `fix(rpc-handlers,core,chat,dashboard): sync models on provider switch`.
   4. Push + `gh pr create` in the background; watch CI and reviews; report the PR URL.
   5. Electron rerun of the 3 scenarios (procedure below) on the fix branch.
2. **Runtime branch** (in `.claude-worktrees/codex-runtime-integration`):
   1. Spawn a code-logic re-review of `953fee97d..52e06df02` (scope: p5 logic findings 1–3, style
      findings 1 and 3) → `code-logic-review-p5-fixes.md`. Fix-round cap is reached: if it
      rejects, report the defects instead of another round.
   2. Write the decisions above into `decisions.md`; commit it with `research-codex-gaps.md`.
   3. Push and open the PR against main (draft is fine, the user will not merge it until A and B
      are removed). Watch CI.
   4. After the user merges the fix PR: `git merge origin/main` (no rebase/force), scoped checks.
   5. Re-invoke team-leader (Mode 2) with an updated plan: dev-only switch; P6, P7, P8 (8c needs a
      Claude frontend implementer + Codex reviewer + Electron visual review), 9b, 10b, 10c; native
      subagent mapping; session history via `thread/read` + `thread/revert`; file-rewind
      checkpoint; reviewed parity-gate ledger update; live Electron parity run on the new path;
      Removal A; Removal B (each removal only after parity proof).
   6. Spike turns (approved): gap spikes first, then report the remaining count.

## Verification rules (repeat to every lane)

- `npm run verify -- -p A,B` / `-t test -p A` (extra Jest flags after a second `--`). FIFO lock
  machine-wide; `node scripts/verify.mjs --status`. Other heavy commands:
  `node scripts/verify.mjs --exec --task <name> -- <cmd>`. Never workspace-wide, never positional
  `nx test A B`, never build/serve/e2e unless the user asks (the user asked for Electron dev runs).
- Known noise: `translation-proxy.sdk.integration.spec.ts` EPERM on Windows; pre-existing lint
  errors in auth-providers (3), cli-agent-runtime (5–6).

## Electron live-test procedure (worked this session, from the main checkout)

1. `node scripts/verify.mjs --exec --task electron-live-test -- npx nx build-dev ptah-electron`
2. `node scripts/copy-wasm.js dist/apps/ptah-electron`
3. `node scripts/verify.mjs --exec --task electron-live-test -- npx nx copy-renderer-dev ptah-electron`
4. `PTAH_NO_DEVTOOLS=1 PTAH_DB_PATH=… PTAH_SESSIONS_DB_PATH=… node apps/ptah-electron/scripts/launch.js --remote-debugging-port=9335 <ws>`
- Port 9335 (9333 belongs to other sessions). `--user-data-dir` is IGNORED in dev (`main.ts:62`
  forces the "Ptah Dev" profile) and `~/.ptah/settings.json` is real: back up settings first and
  restore the keys you change. Drive with Playwright `connectOverCDP`, scripts outside the repo.
- Paid runs: only `haiku` and Codex luna models, tiny prompts, ≤10 turns per run.
- Scenarios: (1) Codex main chat in a workspace; (2) switch provider in an open session → model
  list, selection, next send, plan limits update without reload; (3) two workspaces (Claude haiku
  / Codex luna) stay isolated for provider, model and sessions.
