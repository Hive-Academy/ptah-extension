# Task Context - TASK_2026_597_ab22

## User Request

(2026-10-03) "after our latest updated to our usages and token consumptions, i can see it went well with our main
provider which is claude, but for codex, opencode and ollama cloud, cli tools i think we have a problem on how we spawn
it, or maybe the stuff we send and let it get access too ? specially with codex ... i burned about 5 percent of weekly
usage of claude , and about 12% in codex ?"

"this is very urgent and needs to be done percisely and cover all defects , as its causing my billing and token usage
and probably other users too and i think these fixes should cover it , lets do full orchestration but with our
subagents to avoid burning codex quota ?"

## Task Type

BUGFIX (urgent). Includes building the Ptah compaction layer from TASK_2026_561 Track A.

## Complexity

Complex

## Strategy

Full depth, FEATURE-shaped sequence because the scope builds new layers:
project-manager + researcher-expert (parallel) → Gate 1 → software-architect → Gate 2 → team-leader Mode 1 →
developers per batch (team-leader Mode 2 after each) → team-leader Mode 3 → Gate 3 QA.

## CLI Lanes

DISABLED by the user (2026-10-03): "with our subagents to avoid burning codex quota". Do not call ptah_agent_spawn or
any CLI lane in any phase. Every agent in this task must also honor this. Document reviews before Gates 1 and 2 are
same-side (Claude subagent) reviews; recorded reason: lanes disabled by the user at Gate 0.1.

## Evidence (measured 2026-10-03 from `~/.codex/sessions`, last 4 hours)

9 Codex lanes, all `originator=codex_sdk_ts`, `source=exec`. About 22M input tokens total, ~95% cached, output < 0.5%.

| Session                    | Turns | Input total | Cached | Output |
| -------------------------- | ----- | ----------- | ------ | ------ |
| 13:26:45 backend-developer | 74    | 9.59M       | 9.39M  | 36k    |
| 13:25:58                   | 37    | 3.34M       | 3.22M  | 14k    |
| 13:26:56                   | 29    | 2.50M       | 2.39M  | 10k    |
| 13:22:35                   | 27    | 2.48M       | 2.34M  | 12k    |
| 5 others                   | 3-22  | 0.1-2.1M    | ~90%   | —      |

Per-request input in the 74-turn lane grew 27,464 → 183,759 tokens. Six lanes ran in parallel 13:22-13:27.

Defects found (D-numbers are this task's IDs):

- D1. No default model. `turn_context` shows `model: gpt-6-astra, effort: medium`; `ptah.agentOrchestration.codexModel`
  is empty, so `resolveModel` (`agent-spawn-environment.service.ts:165`) sends none and Codex uses its frontier default.
  User decision: the architect proposes the default at Gate 2 (researcher checks available models and cost).
- D2. Whole-file reads persist in context. 61 `exec` calls such as `Get-Content <whole file>` with
  `max_output_tokens: 22000`; single tool outputs 30-41k chars. No `tool_output_token_limit`, no auto-compact budget.
  (= 561 A2/A4)
- D3. Fixed prefix about 25k tokens per request, from the first request:
  - `backend-developer` role block 34,608 chars, sent as `developer_instructions` (`codex-cli.adapter.ts:635-641`)
  - Codex base instructions 21,428 chars (Codex-owned)
  - Project-Specific Guidance 12,474 chars, added to every spawn by `getProjectGuidance()`
    (`agent-namespace.builder.ts:198`, `ptah-api-builder.service.ts:656`)
  - `config.features.tool_search_always_defer_mcp_tools = false` (`codex-cli.adapter.ts:632`) is global, so every tool
    of every MCP server loads on turn one, not only `ptah`
  - The spawned `codex exec` shares the user's `CODEX_HOME`, so it loads 12 desktop plugins (browser, computer-use,
    slack, google-calendar, documents, pdf, spreadsheets, presentations, ...), the `node_repl` MCP server, a
    `<recommended_plugins>` block and a `<multi_agent_role>` block
- D4. Parallel lanes multiply D3 and D2.
- D5. OpenCode / Ollama Cloud: not measured. `opencode-cli.adapter.ts:555` uses the same `buildTaskPrompt` (role +
  guidance + full ptah MCP tool list). Ollama Cloud may not cache the prefix → full price every turn. Must be measured.
- D6. Usage display: `handleTurnCompleted` (`codex-cli.adapter.ts:1113`) reports `inputTokens` including cached tokens
  with no cached field, unlike the Claude path. Check the ledger for consistent accounting (562 Wave 2.5).

## Scope (user decision 2026-10-03: "Token burn only")

IN:

- TASK_2026_561_9e57 Track A, items A0-A9 (see `../TASK_2026_561_9e57/context.md` § Track A). A0 includes fixing the
  fabricated 128k Ollama Cloud window.
- TASK_2026_562_4b1d Wave 2 items 1-6 (see `../TASK_2026_562_4b1d/context.md`).
- TASK_2026_562_4b1d Wave 4: 4.2 resume gate, 4.3 blocking waits + `tool_timeout_sec`, 4.4 lane call budget
  (APPROVED: steer at 40, stop at 60, repeat detector, block known-looping models, forbid nested Codex spawn_agent),
  4.6 Codex "Failed to parse item" defensive parse.
- D1-D6 above.
- 561 B7 doc gap: resumed Codex lane still resends the role on `developer_instructions`.

OUT:

- 561 Track B (B1-B6, B8, B9 and the rest of B7). Stays in TASK_2026_561 backlog.
- 562 Wave 4.1 (lane brief format) and 4.5 (agent definitions / opus pins / review mandate): NOT approved.
- Wave 0.5 MCP allowlist in `.claude/settings.local.json` (TASK_2026_560_2ae5).
- Not buildable on SDK 0.3.150 (406 §4.3): cancel/edit of a running compaction, history replacement, Codex parity.

## User Decisions (2026-10-03)

1. Scope: token burn only (above).
2. A1 Claude auto-compact default: GATE ON E2. Set a default only if experiment E2 proves the SDK honors
   `autoCompactWindow`.
3. Wave 4: only 4.4 approved (plus 4.2, 4.3, 4.6 which are not policy items).
4. Codex lane default model: the architect proposes at Gate 2, based on the researcher's evidence.
5. Live proof (2026-10-03, answer to Gate 1 review F1): "Small budgeted runs". At QA only, the senior-tester runs short
   scripted runs directly (`codex exec` / `opencode run`, cheap model, fixed small task, hard turn cap), before and
   after the fix. Budget: about 3-5 short runs per runtime. Ptah lanes (`ptah_agent_spawn`) stay disabled for all
   build work. "Before" baselines may also come from the existing rollouts in context.md § Evidence.
6. Gate 1 (2026-10-03): user replied "approved" to task-description.md revision 2 (review round 2 APPROVED). The Gate 1
   message proposed the N3 budget: at most 5 short headless runs each for Claude-side and for Ollama Cloud, at QA only.
   The user raised no objection, so it is recorded as accepted. Minor notes N1, N2, N4, N5, N6 go to the architect.
7. Gate 2 (2026-10-03): user replied "approved" to implementation-plan.md revision 2 (review round 2 APPROVED). This
   includes the lane and reviewer default `gpt-6-sol`, the budget defaults (120000 / 2500 / 40 / 60 / 20), the
   `inherit` effort, the `compaction.threshold` move to the file store with migration, and the `mimo-v2.6-flash-free`
   block.
8. Scope addition (2026-10-03, user: "can we include these to the current task as a last batch"). This is APPROVED by the
   user and changes the Gate 1/2 scope only by these items. Add them as the LAST batch(es) in batches.md (team-leader
   Mode 2 appends them; the numbering continues after Batch 35). Evidence: the Claude session measurement in § Handoff.
   - N1. Subagent prompt cache TTL. The SDK option `subagentPromptCacheTtl?: '5m' | '1h'` (agentSdkTypes.d.ts) is
     never set by Ptah. Add the setting `ptah.agentOrchestration.subagentPromptCacheTtl`: `'auto' | '5m' | '1h'`,
     default `auto`. `auto` sends `'1h'` for sessions that spawn subagents and leaves it unset otherwise. Set it in
     `sdk-query-options-builder.ts`. `CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL` (env) takes precedence in the SDK. Log
     the effective value. Measure with M before and after (cache-write tokens on resumes after more than 5 minutes).
     Note: the user set `CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL=1h` as a Windows user environment variable on
     2026-10-03 as the immediate fix. Show it in the UI when the env var overrides the setting.
   - N2. Resume gate for Claude subagents (extends Wave 4.2 from CLI lanes to Claude subagents). Ptah tracks the last
     activity per subagent and reports `cacheState: warm | cold` (with the effective TTL) in the agent status and in
     the orchestrator-facing tools. Guidance: resume when warm; start fresh with a short brief when cold.
   - N3. Tool allowlist per subagent type (the tool part of Wave 4.5 only; the opus pins and the review policy stay
     OUT). Subagents get only the MCP servers and tools that their type needs (for example, reviewers get no browser
     or firecrawl tools), using `strictMcpConfig` / per-agent tool lists. Measure the start prefix (today 34-44k,
     median 39.6k) before and after.
   - N4. Trim the injected text for subagents (562 Wave 2.6, applied to Claude subagents): no memory snapshot, symbol
     list or orchestration tables in a subagent prompt. Keep the role and the project rules.
   - N5. Lean orchestration rules in the skills (a small part of Wave 4.1). Encode the § Handoff lean rules 1-5 into
     `.claude/skills/orchestration` and the team-leader agent definition (and their codex/opencode mirrors if the repo
     keeps them in sync).
   - N6. Cost visibility. In the agent panel, show per agent: the context size, the cache state (warm/cold), and the
     cache read/write/output tokens with an estimated cost. Use the same data as M; this extends R7.
9. Scope addition (2026-10-03, user: "approved"). N7 + N8 go through an architect addendum and Gate 2 before any batch
   is added (after Batch 49).

- N7. Session and subagent budgets. Main session budget (user target about 50M raw tokens; subagent tokens not in
  the main limit by default, a "session + subagents" total shown for information). Per-subagent budget so the main
  agent decides resume vs fresh: resume only when warm AND context below a limit (provisional 150k); a per-subagent
  safety stop (provisional 3M weighted; final default calibrated from Batch 36 M `--subagents` data). Measure: the
  user prefers the provider-reported stats over a manual calculation ("utilize the current stats token and cost
  coming back from provider"). Reuse `SessionStatsOwnerService` (`'reported'` cost from `total_cost_usd` /
  `modelUsage.costUSD`, includes Task-subagent spend) and the usage ledger; weighted tokens (input 1, cache write
  1.25/2, cache read 0.1, output 5) only as the fallback where no cost is reported (proxied providers, Codex lanes).
- N8. Automated handoff and compaction workflow with clear user guidance. Stages: normal (<50%), tighten (>=50%:
  lower `autoCompactWindow` live), prepare handoff (>=80% or 3rd compaction: Ptah writes `handoff.md` with goal,
  decisions, changed files, open items, next action, task folder paths; banner + one button + preview), limit (100%:
  no new requests, one button to continue in a new session seeded with only the handoff). Reuses A6 rotation banner,
  A8 coordinator, Batch 23.4 live threshold, Batch 28 subagent monitor, Batches 40-41 warm/cold state.

11. Speed-up (2026-10-03, user: "fasten things up by reducing the amount of reviews ... get this task merged"):

- Review policy: RISK-BASED. No per-batch review. Each batch passes its scoped typecheck/lint/tests before commit.
  One code-logic review at the end of each phase on the combined diff. Batches that change only types, tests, docs
  or measurement get no review.
- Merge scope: SAVINGS-FIRST SUBSET in PR 1 = S1a (Batches 1-7 + 10) + N3 tool allowlist + N4 subagent text trim +
  N5 lean rules + A1 auto-compact. Every other batch moves to follow-up tasks.
- N7/N8 moves to a follow-up task. The addendum revision 1 and its REVISE review stay in the folder as input; the
  revision-2 run was stopped.

5. Rule kept from 561/562: agents never edit user-owned files (`~/.codex/config.toml`); Ptah features may write them only
   after explicit opt-in with a diff preview (561 A9 rules).

6. PR 2 scope (2026-10-04, after PR #634 merged): stage N1/N2/N6 = Batches 36-41 and 46-47. The open follow-ups stay
   with their owner stages (none is in an N1/N2/N6 file): PR1-M1 and F6-M1 (Task 34.2) with S4, PR1-M2 with S3
   (Batches 16/17), Task 9.3 with S1b. N7/N8 addendum revision 2 runs in parallel, then Gate 2. CLI lanes stay
   disabled. Decision 11 review policy and lean rules apply.
7. Gate 2 for N7/N8 (2026-10-04): user replied "approved" to implementation-plan-addendum-n7-n8.md revision 2 (review
   round 2 APPROVED, 14/15 RESOLVED, F10 PARTIAL). The recommended options apply: (1) budget unit TOKENS 50M as
   displayed; (2) count the displayed figure, per-subagent advice and safety stop built with Batches 28/36/37/40-41;
   (3) deterministic handoff from the transcript in `~/.ptah/handoffs/`, newest 50 kept; (4) at 100% pause after the
   current turn with "Allow 20% more" and "Continue in new session". The team-leader adds the F10 Batch 39 dependency
   note; the `sessionBudget.enabled` Moderate becomes a named later task.
8. S4 and token rules (2026-10-04, fourth session). The user chose stage S4. After measuring the session (tool M,
   see TASK_2026_613 context.md § Evidence) the user APPROVED these rules for every remaining batch:
   - R1 relay per agent run: a developer or reviewer stops at about 150k context (main trigger) or 60 tool calls
     (backup), writes a progress note in its report, and a FRESH agent continues from the note. Not for the main
     session (it uses the PR 3 session budget and handoff).
   - R2 batches of about 6 files (split larger batches before running them).
   - R3 the orchestrator commits a clean batch itself (report all green, no deviation to judge) after re-running
     only `di-lint:lint`, `degradation-audit:lint` and the scoped typecheck (all importers when a libs/shared type
     changes). The team-leader keeps decomposition, deviation calls and phase completion.
   - R4 Sonnet for mechanical roles (verify-and-commit, style review, batches that change only types, specs,
     fixtures or wiring). Opus for design, code-logic review and complex batches.
   - R5 short check output: `ptah_run_check` (4,000-character cap) or `| tail` / summary greps; re-run one failing
     spec, not the suite.
   Shipping these rules to all users (plugin assets, generated agents, Settings) is TASK_2026_613_8f34.
   Lesson: a limit in the prompt is advice only. Two developers ignored it (Batch 34: 165 calls, 310k context; S4-a
   fix round: 141 calls, 178k). TASK_2026_613 adds a hard `maxTurns`; until then the orchestrator states the limit
   and splits work small enough to fit it.
9. Wave D (2026-10-04, fifth session, one AskUserQuestion):
   - Setting keys: PULL S3 Batch 16 + Tasks 17.3-17.5 into Wave D, ahead of Batch 25. Task 17.1 (read-only AS14
     host check) runs too, because 17.3 depends on it. Tasks 16.1 and 17.2 (compaction RPC + migration) are part of
     Batch 16 / 17 as the team-leader decides; the user chose "Batch 16 + Tasks 17.3-17.5".
   - A6: REBUILD on the N8 pieces from #639. Batch 29 `seedPrompt` uses `session-handoff-builder`; Batch 31 builds
     on `session-budget-banner` (no second banner); Task 26.2 reuses the N8 `getContextUsage` read.
   - PR #642 CI fix `a806e6e17` (`requestCanvasTab` workspace path after the main merge) pushed with user approval.
10. Push/PR authorization (2026-10-04, fifth session, user): "push once the agent finishes and whenever we finish the
    task push and open a PR as well don't wait for my input on that". The orchestrator pushes the PR #642 review
    fixes when they are committed, and pushes + opens the Wave D PR at the end without asking.

## Workspace

- S4 worktree: `D:\projects\ptah-extension\.claude-worktrees\task-597-s4` (node_modules is a junction to the main
  checkout). Branch `fix/task-597-s4-lane-guards`, PR #642 (S4-a). Reuse this worktree and branch for S4 Wave D
  only if PR #642 is still open; once #642 merges, start Wave D on a NEW branch from the latest `origin/main`.
- 2026-10-04: PR #642 MERGED (`0a0438384`, includes the review fixes `50eb14bce`, `ccd8a8a9c`). Wave D continues in
  the same worktree on NEW branch `fix/task-597-s4-wave-d` (its base `ccd8a8a9c` is the parent of the #642 merge, so
  the PR diff is only the Wave D commits). The worktree was kept because Wave D agents were editing in it.
- PR 3 (merged as #639): branch `fix/task-597-session-budget`. PR 2 (merged as #637) and PR 1 (merged as #634):
  do not reuse them. The worktrees `.claude-worktrees/task-597-session-budget` and `task-597-followups` can be
  removed.
- Avoid the files of TASK_2026_609_c495: agent-generation services/templates, `.claude/agents`, the system-prompt
  parts of `sdk-query-options-builder.ts`.

## Handoff 4 (2026-10-04, end of fourth orchestration session)

- PR #639 (PR 3, N7/N8) MERGED (`518caa996`) after two CI fix rounds in this session: `a6a8af2ef` (handoff writer
  ENOTDIR warns once on Linux, banner `text-base-content-muted`, rejected budget action shown, sibling percent
  re-validation, settings read 5 s timeout, `sessionBudget.*` e2e fixtures, no `aria-busy` on the deferred
  placeholder) and `477c30b9b` (session-budget block moved below the roles summary, placeholder 44 px). Lanes used:
  codex and opencode (user enabled them for the #639 fixes only).
- PR #642 (S4-a) OPEN on `fix/task-597-s4-lane-guards`: Batches 24 `7099066f3`, 30.2 `539fed084`, 32 `384266a77`,
  33 `378688a1f`, 34 `7619f91ac`; phase review REVISE → fix round `746601373` (S1 run_check runs only in the
  caller's declared root and names it; S2 `resumeDecision` / `AgentResumeOutcome` on the spawn result and a
  `Resume:` line; M1 original task kept across fresh lanes; M2 curator watermark only after a pass ran, manual
  `/compact` never coalesced) → re-review APPROVED (`reviews/s4a-code-logic-rereview.md`). Style review APPROVED.
  `origin/main` (with #639) merged into the branch (`492b0762c`). TASK_2026_613_8f34 specs are in this PR.
- Named later tasks from S4-a: M3 (Codex lane with no rollout figure falls back to the turn total), M4 (`run_check`
  Nx process not killed on cancel or host exit), M5 (waits cannot be cancelled), M6 (idle-lane continuation and
  `spawnFromSdkHandle` skip the resume gate), re-review RM1 (`ptah_run_check` description still says "worktrees
  too" while HTTP refuses a worktree outside every open folder), RM2 (a worktree without `node_modules/nx` gets
  "Nx was not found"), style SM1 (900 s wait ceiling defined twice), SM2 (`openWorldHint: false` on run_check).
  PR #639 CI-fix review Moderates: sibling percent draft can auto-save before blur; `settings:set` keeps the 30 s
  default timeout.
- NEXT: S4 Wave D = Batches 25 → 26 → 27 → 28 → 29 → 30.1 → 31 in series, with 35 alongside (batches.md
  § S4 stage start). Status headers still read WAITS-FOR-#639; #639 is merged, so they are runnable. Two open
  decisions to ask the user at the start (one AskUserQuestion):
  1. Batches 25, 28, 29 and Task 35.3 need setting keys that S3 Batch 16 and Tasks 17.3-17.5 add (not in `libs/`
     yet). Pull Batch 16 + Tasks 17.3-17.5 into Wave D first, or reduce those tasks to hard-coded defaults?
  2. A6 (Batches 29, 30.1, 31) duplicates the N8 handoff builder and "Continue in new session" banner from #639.
     Drop A6, or rebuild it on the N8 pieces? Task 26.2 must reuse N8's `getContextUsage` read.
  Batch 28 also takes the per-subagent budget parts the N7/N8 addendum deferred (Component 10.1-10.3).
- After S4: S3 (12-22, owns PR1-M2), S1b (8-9 + Task 9.3), S2 (11), then the QA session (E2, N1 "after"
  measurement, screenshots for Batches 39/47/60/61, PR 3 scripted 2M-token run, transcript-fix check) and the named
  later tasks (PR2-M1..M5, PR2-B1, N7-M1, PR3-M1..M8, PR3-S1, plus the S4-a list above).
- Lessons: the PR 3 worktree e2e runs rewrite ~100 baseline PNGs under `.ptah/specs/TASK_2026_555/screenshots`;
  restore them before every commit (`git diff --name-only -- '*.png' | xargs -r git restore --`). A fresh worktree
  has no `node_modules`: create a junction to the main checkout (git ignores it). The commit hook takes up to
  5 minutes; run commits in the background. CI e2e failures that pass on Windows were layout or OS-specific
  (viewport fold, `fs.rm` ENOTDIR); read the CI log first and give the lane the failing locator.

## Handoff 3 (2026-10-04, end of third orchestration session)

- PR #637 (`fix/task-597-followups`, PR 2, decision 12): Batches 36-41, 46, 47, bug fix 47a (background named
  subagents showed "Transcript is not available yet") and the CodeRabbit fix. MERGED 2026-10-04 (`c179f3eb5`).
- PR #639 (`fix/task-597-session-budget`, PR 3, N7/N8, decision 13): Batches 50-61 and fix round, reviews APPROVED,
  rebased on `main` after #637. Open; the user merges it. Worktree `.claude-worktrees/task-597-session-budget`.
  The PR 2 worktree `.claude-worktrees/task-597-followups` can be removed.
- Open, in order of value:
  1. QA session (needs user approval, decisions 6/7): experiment E2 (does the runtime honour `autoCompactWindow`? A1
     defaults and the N8 tighten stage stay advisory until it passes); N1 "after" measurement with
     `CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL` cleared in the child run only (tool M `--subagents`, compare with
     `measurements/s9-subagent-baselines.md`: 19 resumes > 5 min, 3,544,590 cache-write tokens); visual-reviewer
     before/after screenshots (dark + light) for Batches 39, 47, 60, 61; manual check of the Batch 47a transcript fix;
     PR 3 scripted 2M-token session and one proxied-route run.
  2. Still DEFERRED stages (batches.md): S4 24-35 (largest lane saving; owns PR1-M1 and F6-M1 Task 34.2; component 10
     per-subagent budget waits for Batch 28), S3 12-22 (owns PR1-M2 with 16/17), S1b 8-9 + Task 9.3, S2 11.
  3. Named later tasks: PR2-M1..M5, PR2-B1 (backend `agentId` binding when SubagentStart has no `toolUseId`; covers
     foreground subagents and steer/stop), N7-M1 (`sessionBudget.enabled`), PR3-M1..M8, PR3-S1 (split chat-view and
     the stats chip).
- Lessons: `degradation-audit:lint` and `di-lint:lint` scan the whole working tree in the commit hook, so a batch with
  an unregistered `@inject` token or a swallowing catch blocks every commit in that worktree (Batch 54 committed with
  55). Fresh worktrees need `npx nx run ptah-electron:build-workspace-watch-host` for one platform-electron spec, and the
  Prisma client is not generated (`libs/api` typecheck fails; unrelated). Write commit messages with a Bash heredoc
  (PowerShell `Set-Content -Encoding utf8` adds a BOM that commitlint rejects).

## Handoff 2 (2026-10-03, end of second orchestration session)

- PR #634 (branch `fix/task-597-lane-token-burn`) holds the decision 11 PR 1 subset: Batches 1-7, 10, 23, 42-44,
  48-49 COMPLETE; 45 NO-OP; phase-end review APPROVED; CI fixes (manifest, Sonar S2871, chat popover `inherit`
  label) and the 4 CodeRabbit comments are pushed. The user merges #634.
- Remaining: every batch marked `DEFERRED (follow-up, decision 11)` in batches.md (S1b 8-9, S2 11, S3 12-22,
  S4 24-35, N1/N2/N6 36-41 and 46-47), N7/N8 (addendum rev 1 + REVISE review F1-F15; rev 2 run was stopped), the
  open Moderates (batches.md § PR 1 phase-end review, F6-M1/M2, Task 9.3), QA live proof (decisions 6/7) and
  experiment E2 (A1 defaults stay null until it passes).
- Related work in another session: TASK_2026_609_c495 (subagent setup + system prompt, branch
  `fix/task-609-subagent-setup`). Avoid its files.
- Lesson: scoped checks must include every project that imports a changed `libs/shared` type (the `chat` lib
  failed in CI only).

## Handoff (2026-10-03, end of first orchestration session)

State:

- COMPLETE on `fix/task-597-lane-token-burn`: Batch 2 `c9d50d681`, Batch 10 `5316cedb1`, Batch 1 `edb79b961`,
  Batch 5 `7f6b66e94`, Batch 3 `c83d4cc95` (5 of 35).
- Batch 4 (Codex adapter on the SDK path, component 3a + N-A): IN_PROGRESS. Its developer STOPPED when the previous
  session ended. Partial, uncommitted work is in the worktree (seen: `cli-adapter.interface.ts`, `cli-adapter.utils.ts`
  and its spec, `codex/__fixtures__/`, `codex-cli.adapter.ts` mid-rename of `resolveCodexNativeBinary`). Check
  `git status` and `git diff` first. Then start a FRESH backend-developer from the Batch 4 section of batches.md, told to
  continue from the partial diff. The Batch 3 review added one Batch 4 requirement (recorded in Task 4.3/4.4): the lane
  reader validates the three Codex budget values (safe integer >= 0, boolean) with a default fallback and one warning
  per key. Batch 4 verification must also run the `rpc-handlers` tests (`chat-session-auth.spec.ts` is red only
  because of the partial Batch 4 code).
- After Batch 4 is committed: Batches 6, 8 and 11 can run in parallel. Batch 7 follows Batch 6.

Lean rules (user request 2026-10-03, after measuring this session: 1,075 requests, 177M cache-read, 7.7M cache-write,
1.1M output. The cost drivers were contexts of 250-430k resent on every request, subagent 5-minute cache expiry on
resumes after long waits, a single long-lived team-leader at 348k, repeated fix rounds, and a 34-44k start prefix per
subagent):

1. Use a FRESH team-leader for every Mode 2/3 call. Give it only the batch report path and the review path. Never
   resume a long-lived team-leader.
2. Resume a developer or reviewer only when its last activity was less than 5 minutes ago (cache window). Otherwise
   start a fresh one with the batch section and the report paths.
3. Run ONE shipping-code review per batch (code-logic-reviewer). Do not add a style review unless the batch is mostly
   new public API.
4. Findings: Blocking and Serious are fixed in one fix round. A Moderate item is fixed only if it can break a lane
   config or lose data; otherwise it becomes a named later task. Minor items are recorded, not fixed. At most one fix
   round per batch, then a short re-review scoped to the fixes.
5. Keep orchestrator updates short. Do not send a status message for every notification.
6. CLI lanes stay disabled (decision 1).

## Conversation Summary

- Investigation on 2026-10-03 found D1-D6 from Codex session logs.
- The compaction layer (TASK_2026_561) was in backlog; only `tool-output-reducers` (TASK_2026_559) is merged on `main`.
- TASK_2026_408 phase 1 (context overflow + response.failed / response.incomplete mapping) is in PR #602 — check its
  state before the Codex compaction path is designed.
