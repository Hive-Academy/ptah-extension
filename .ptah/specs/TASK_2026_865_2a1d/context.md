# Task Context - TASK_2026_865_2a1d

## User Request

New FEATURE task: "Continue with <provider>" carry-over after a provider switch (Electron first).

Problem: after the user switches the active connection (e.g. Claude Code -> Codex, from onboarding
stage 1 or the Providers page), continuing a conversation that started on the old provider is
refused with AUTH_REQUIRED and the chat shows only a re-auth banner. Commit a9497540e (2026-11-02,
on main) retired the Codex translation proxy that used to let `/compact` summarise the old
conversation with the new provider; its message calls the refusal an intended behavior change. The
user relied on "compact with the new provider" and wants it back in a supported form.

User decisions (already made, do not re-ask):

- Trigger: ONE "Continue with <provider>" button on the existing re-auth banner. Not automatic.
- Keep the AUTH_REQUIRED refusal on the resume path as is; it is what shows the banner. The button
  is a new, explicit action. Claude (old provider) is never called after the switch.

Starting design (smallest viable, from the architect of TASK_2026_864_1376 — see "### Scope note for
the orchestrator" in
/home/amun/ptah-extension/.claude-worktrees/provider-readiness/.ptah/specs/TASK_2026_864_1376/implementation-plan.md
(line 1319) and row 36 of its decisions.md):

- Host reads the old conversation with `readSessionHistory` (session-history-reader.service.ts:350)
  and cuts it to a fixed size.
- It starts a new chat on the active provider whose first turn summarises the old conversation, then
  the user continues there.
- `ChatContinueResult` (or a new RPC) carries the carry-over; the chat screen links the new chat to
  the same tab and shows a short notice.
- Estimated 8-10 files in 4-5 projects (shared, agent-sdk, rpc-handlers, chat, maybe chat-state).

Coordination: parallel task TASK_2026_864_1376 (worktree
/home/amun/ptah-extension/.claude-worktrees/provider-readiness, branch feat/provider-readiness) adds
provider readiness to onboarding and a test that continuing a pre-switch conversation returns
AUTH_REQUIRED. Do not change that refusal's contract. Do not edit files under libs/frontend/onboarding
or the Codex sign-in code.

Rules: CLAUDE.md (scoped `npm run verify -- -p <projects>` only; no build/serve/e2e/package;
Electron first; visual reviews in Electron, dark + light). Banner change is a UI change with no new
surface: before/after screenshots instead of a prototype. Approval mode lane-review with a codex lane
as cross-side reviewer; escalate on REVISE after round 2, on removals, or on scope questions. Record
every decision in decisions.md. Commit foreground; push + PR background; no merges or force pushes.

Session contract: child session "Provider switch carry-over" of parent session
f5947a72-948a-498d-b157-6d9924d6dc80. Worktree
/home/amun/ptah-extension/.claude-worktrees/feat-provider-switch-carryover-9f3f79992765, branch
feat/provider-switch-carryover. AskUserQuestion unavailable: decide and record. The user owns merge,
PR and worktree cleanup (contract overrides CLAUDE.md's PR authorization: commit on this branch only).

## Task Type

FEATURE

## Complexity

Complex (4-5 projects, backend + renderer, cross-provider transcript transfer)

## Strategy

FEATURE, Full depth, no designer (no new surface: one button on an existing banner), no separate
research (evidence already gathered in TASK_2026_864_1376's scope note).
Sequence: project-manager → codex cross-side review → Gate 1 → software-architect → codex
cross-side review → Gate 2 → team-leader Mode 1/2/3 → code-logic review (codex, cross-family) →
visual-reviewer before/after screenshots (Electron, dark + light) → commit.

## CLI Lanes

- Preference source: current request ("Approval mode lane-review with a codex lane as cross-side
  reviewer"). Memory search returned no stored preference.
- Mode: enabled. Approval mode: lane-review.
- ptah_agent_list (2026-11-03): codex installed, confirmed room (weekly 34%); Ollama Code
  available (weekly 84%); kimi code available (unknown); antigravity, grok installed (unknown);
  copilot, claude disabled; cursor, opencode, pi not installed.
- Cross-side reviewer for documents and code: codex lane (different family from Claude subagents).

## Conversation Summary

See decisions.md.
