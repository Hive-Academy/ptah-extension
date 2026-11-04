# Task Context - TASK_2026_873_f748

## User Request

"i've been utilizing codeRabbit very much for reviewing ptah ... with the heavy pushing workflow
i'm making, i think we need to build our own ptah-review workflow ... review most of our PRs who has
the highest comments from codeRabbit and understand what codeRabbit is looking for that we don't ...
i would like to have a way in ptah to build over our scheduled task feature and have an automated
review pipelines that's vast and reliable same as codeRabbit that gets triggered whenever we make a
PR and start reviewing it same way as codeRabbit does"

Follow-up: "go ahead" (start the orchestration after the research synthesis).

## Task Type

FEATURE

## Complexity

Complex (new backend library, persistence migration, GitHub adapter, lane orchestration, DI in
Electron and CLI, UI surface for review runs/settings).

## Strategy

FEATURE, Full depth: PM → [research done] → [designer → prototype → Gate 1.7 if a UI surface is
added] → architect → team-leader → QA.

## CLI Lanes

- Preference source: ptah_memory_search — `orchestration-executor-preference` (lanes first, codex
  first, cross-family review) and `lane-review-approval-mode`.
- Mode: `enabled`. Approval mode: `lane-review` (cross-side APPROVED passes Gates 1, 1.7, 2;
  removals, irreversible or outward actions, security/credential policy go to the user).
- `ptah_agent_list` at start (2026-11-03 ~17:30 UTC):
  - codex — installed, confirmed room (Weekly 38%).
  - kimi code (ptah-cli pc-10e5a6b5…) — AT LIMIT, reset unknown (error-derived). Skip this run.
  - Glm (ptah-cli) — AT LIMIT; session resets 20:00 UTC, weekly 97%.
  - grok — AT LIMIT, weekly resets 2026-11-03 17:40 UTC.
  - opencode — AT LIMIT monthly, resets 2026-11-04 11:44 UTC.
  - copilot, claude — disabled. cursor, pi — not installed. antigravity — installed, limit unknown.
- Known lane defect: in the research run the codex sandbox got `Access denied` for every write
  under D:\projects\ptah-extension (workingDirectory = main checkout). Writes to %TEMP% worked.
  Must be resolved or worked around before codex writes artifacts or code.
  - Resolved by evidence: with workingDirectory = this worktree, the PM lane (18564f96) wrote
    task-description.md normally. The denial applies to the main checkout only. Always give lanes
    the task worktree as workingDirectory.

## Conversation Summary

- Research (in `research/`): 200 recent PRs, 89 with CodeRabbit threads, 252 threads. Top 15 PRs:
  108 root findings, 95 resolved. Categories: Functional 72, Stability 16, Security 8, Data
  Integrity 7, Maintainability 3, Performance 2. Severity: 31 Major, 77 Minor, 0 Critical.
- CodeRabbit mechanics seen: walkthrough + sequence diagram, inline comments with severity,
  proposed diff and "Prompt for AI Agents", "Confirmed as addressed" follow-ups on new pushes,
  learnings, outside-diff comments, a Verify section. No evidence of named linters.
  `.coderabbit.yaml` only excludes `.ptah/specs/**` and `**/*.spec.ts`.
- Gap is timing/policy, not reviewer instructions. Quick win shipped separately as PR #910
  (final whole-PR review + fix local Minor findings).
- User decisions:
  1. Run on a dedicated Ubuntu machine with Ptah Electron as the reviewer; support a VPS too
     (→ host-neutral libs; Electron first, headless CLI daemon later).
  2. Publish mode: **auto-post** to GitHub.
  3. Quick win as a separate PR (done: #910).
- Orchestrator proposals made to the user (not yet user-approved as requirements): bot GitHub
  identity with narrow token; verify stage mandatory before auto-post; confidence threshold and
  inline-comment cap; trusted-author/repo allowlist; evaluation harness replaying the 15 PRs.
