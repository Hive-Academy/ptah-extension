# Task Context - TASK_2026_864_1376

## User Request

"also another thing i used codex as my main provider, but after i saved that ai team builder run
as a draft and returned to first page it shows as if it can't check for claude code installation
why is that ? and if we also rely on codex installation for open ai providers , should we include
that into our workflow like ask users to download it if they want to use codex at the first page as
well and auto detect it same as we do with claude and users ( like what i didi ) can choose
whatever connection they want"

## Task Type

FEATURE (provider-aware readiness) + BUGFIX (false "cannot check" error).

## Complexity

Complex. Crosses onboarding (frontend), provider settings state (frontend core), auth providers
and RPC handlers (backend).

## Strategy

Full FEATURE flow: PM (task-description.md + parity-inventory.md, because the readiness banner,
strip and Get ready step are redesigned) → ui-ux-designer (readiness surfaces) → cross-side review
→ Gate 1.7 → software-architect → team-leader → developers → code-logic review → visual review in
Electron.

## Evidence gathered before the task (orchestrator, read-only)

- Readiness is Claude-only: `libs/frontend/onboarding/src/lib/ready/claude-readiness.store.ts`
  `deriveClaudeReadiness` reads only the `cli === 'claude'` row from `agent:detectClis` and the
  result of `provider:getAmbientClaudeStatus`. It feeds `ClaudeReadinessBannerComponent`, the ready
  strip and `ReadyClaudeStepPage` (`/onboarding/ready`). The onboarding home re-reads it on each
  visit (`onboarding-home.component.ts:419-421`).
- False error: dev log at 2026-11-03T13:09:49Z shows `[event-loop] lag maxMs 5578` in the Electron
  main process, then `agent:detectClis` 6.0 s and `provider:getAmbientClaudeStatus` 10.2 s. The
  probe (`libs/backend/auth-providers/src/lib/accounts/claude-ambient-login-status.ts`) runs
  `claude --version` (10 s) then `claude auth status` (10 s), budget 20 s, deadline 25 s. From a
  shell `claude auth status` takes 0.55 s. Most probable result: `unknown/timeout` → store view
  `error`. The log does not record the reason value; confirm. The source of the 5.6 s main-process
  block is unknown (it coincided with the draft save and the return to the home page).
- The user's main provider was Codex (native Codex runtime). Codex lanes exist (`codex` CLI
  detected by `CliDetection`). Look for an existing Codex auth or status probe before adding one.

## Constraints (CLAUDE.md, repeat to every agent and lane)

- Electron first. Renderer is `apps/ptah-extension-webview`. Visual reviews in Electron only.
- Keep provider CLI lanes and the benchmark's `platform-cli` and `cli-engine` libraries working.
- Verify only with `npm run verify -- -p <changed projects>`; never workspace-wide; never build,
  serve, e2e or package targets unless asked.
- Worktree: `/home/amun/ptah-extension/.claude-worktrees/provider-readiness`
  (branch `feat/provider-readiness`). Only the orchestrator commits and pushes.

## CLI Lanes

Gate 0.1: no stored preference. `codex` lane installed with confirmed room. Mode: `enabled`.
Approval mode: `lane-review` (cross-side reviewer: `codex` lane).

## Conversation Summary

- User approved the plan. This task runs in parallel with TASK_2026_863_3855.
