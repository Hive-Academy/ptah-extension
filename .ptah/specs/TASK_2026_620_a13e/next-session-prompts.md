# Prompts for the two next sessions (2026-10-07)

Start both from a top-level session (a child session cannot start sessions: `depth-exceeded`).

## Session 1 — finish TASK_2026_620 and open the PR

`ptah_session_start` arguments: branch `feat/task-620-memory-skills-bench-s3`, baseRef
`feat/task-620-memory-skills-bench-s2`, taskId `TASK_2026_620_a13e`, taskFolder
`.ptah/specs/TASK_2026_620_a13e`, label `TASK 620 finish + PR`.

Task:

> Continue TASK_2026_620 (memory and skills benchmark-first quality program) to the end and open the
> PR. You are the orchestrator. Your branch starts at the tip of feat/task-620-memory-skills-bench-s2;
> commit all further 620 work on your branch. The task folder is `.ptah/specs/TASK_2026_620_a13e/`
> inside YOUR worktree; never create task files in `D:\projects\ptah-extension\.ptah\specs`.
>
> Read first: `HANDOFF.md` section "RESUME HERE" (exact state and next steps), `context.md` (last
> section: user decisions of 2026-10-07 — panel data flow approved for U1/U2/U4; B24/recording gate =
> message 619 before each bench and wait for its OK + ask the user to refresh the Codex login just
> before recordings), `batches.md` "Addendum batches", `design-addendum-codex-recording-and-model-panel.md`.
>
> Remaining work, in order:
> 1. Finish model-panel labelling (private data under C:\Users\abdal\AppData\Local\ptah-mcp-bench; never
>    commit it): validate U2 r2 parts 1/4/5 (4 and 5 look like rubber-stamp all-accepts: re-run once
>    with the strict per-item instruction if so), U2 Glm adjudication, U4 trigger-label Glm
>    adjudication (23 skills, pick 5+5 of 10+10, blinded A/B, exclude prompts naming a skill id), then
>    private panel manifests (`panelManifestSchema`) and merged label files for B25.
> 2. Add the `--codex-auth-source` CLI flag in `run-memory-skills.entry.ts` (A1 added only the
>    `RunMemorySkillsOptions` field), with spec and codex review.
> 3. Four Codex/terra recordings (extraction.v1, B18 curator, scope-write, funnel.v1): provider
>    openai-codex, model gpt-5.6-terra, isolated Codex auth. Message the 619 session first (ListAgents)
>    and wait for its OK; ask the user to refresh the Codex login just before the run.
> 4. U3 after the B24 replay; B24 (message 619 first), B25 (freeze labels; fix F-005; reach 15
>    abstention cases), B26 close-out.
> 5. Open the PR (base rule in context.md:134-135: draft against the 619 branch if 619 has not merged,
>    else rebase and target main). ASK THE USER BEFORE ANY PUSH. PR body ends with
>    `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
>
> Lane facts: r1 = grok (grok-4.7, xAI); r2 = antigravity with model `gemini-3.1-pro` and effort
> `high` (its default is claude-sonnet-4-6 = Anthropic: always pass the Gemini model); max 2
> antigravity lanes at once (HTTP 429 quota); adjudicator = Glm ptah-cli (glm-5.3-flash:cloud), short
> tasks, fresh spawns. Implementor lanes grok; reviewer lanes codex (tell them to redirect jest output
> to a temp file and read its tail); max 2 revise rounds. Validate every lane output yourself; tell
> lanes to keep scratch files out of the repo and check `git status` after each lane.
>
> Standing rules (repeat in every lane prompt): memory-safe verification per CLAUDE.md (only changed
> projects; `npx jest -c <lib>/jest.config.ts <spec...> --coverage=false --maxWorkers=2`; never
> workspace-wide, never nx run-many, never build/serve/e2e/package; --parallel=1; one heavy check at a
> time); never the full `nx run mcp-bench:test`; never edit 619-owned `tools/mcp-bench/src/scorecard/`,
> `transport/`, `corpus/`, `suites/question-sets.ts`, `bench-data.ts`; use
> `npx tsc -p tools/mcp-bench/tsconfig.json --noEmit` instead of ptah_get_diagnostics; re-run every
> check yourself before you commit; commit per batch with only that batch's files; end commit messages
> with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. If you add a node_modules junction
> for jest, remove it with `cmd /c rmdir` (never recursive delete) before you finish.

## Session 2 — session-budget handoff workflow fix

`ptah_session_start` arguments: branch `fix/session-budget-handoff-workflow`, baseRef `main`,
label `Session handoff workflow`. Use `/orchestrate` (BUGFIX/FEATURE, Full depth).

Task:

> /orchestrate Fix the session-budget "Continue in new session" flow so it is a proper workflow.
>
> User request: "start when a message turn finishes and compact the session in the background where
> the agent generates a handoff document, then close the current session and start a new one. The
> current flow is not correct: lots of notifications stack on each other and the agent keeps working
> until exceeding the limit." Also: "this popup shows while the agent is working and doesn't send
> before it shows the continue in new session".
>
> Wanted flow: (1) trigger only at the END of a message turn, never mid-turn; (2) in the background,
> the agent compacts the session and writes the handoff document; (3) the current session closes;
> (4) a new session starts, seeded with the handoff. One flow per session; no stacked prompts or
> notifications; a queued user message is sent (or carried into the new session), never lost.
>
> Observed defects (TASK_2026_620 child session, 2026-10-07): the budget popup appears while the agent
> is still working; the pending message is not sent before the prompt appears; budget notifications
> stack; the agent keeps working past the limit because lane completions and peer messages keep
> starting new turns.
>
> Code pointers: `libs/frontend/chat/src/lib/services/session-budget-actions.service.ts:139-194`
> (preview-handoff / write-handoff / openTabForHandoff),
> `libs/frontend/chat/src/lib/components/molecules/notifications/session-budget-banner.component.ts`,
> `libs/backend/rpc-handlers/src/lib/handlers/session-budget-rpc.handlers.ts`,
> `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:170-183,460-483`
> (`refuseIfBudgetReached`, `SESSION_BUDGET_REACHED_MESSAGE`),
> `libs/backend/agent-sdk/src/lib/helpers/session-budget/session-handoff-builder.ts`,
> `libs/shared/src/lib/types/session-budget.types.ts`. Prior work: TASK_2026_597 (N7, F3).
> Consider also how lane-completion and peer-message turns interact with the budget (they should
> queue behind the handoff, not start new work past the limit).
>
> Rules: follow CLAUDE.md memory-safe verification (only changed projects, jest
> `--maxWorkers=2`, nx `--parallel=1`, no workspace-wide checks, no build/serve/e2e/package). Present
> the plan to the user before implementation. Ask before any push.
