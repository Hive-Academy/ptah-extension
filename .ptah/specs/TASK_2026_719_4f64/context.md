# Task Context - TASK_2026_719_4f64

## User Request

"i do have 2 accounts and i would like to test adding 2 accounts, and use one for the main chat and
another one for a claude cli lane? you can test both as well i can help u login to each one and u can
use haiku to test and make sure all works seamlessly"

Then, after PR #820 and the user's other PRs merged: "lets continue".
User decisions (TASK_2026_712_5d7c D41): lift the D7 release hold fully; start from latest main.

## Task Type

FEATURE

## Complexity

Complex

## Strategy

Full: PM → researcher → architect → team-leader → developers (Claude subagents) → QA → live
Electron test with the user (two real accounts, Haiku). Electron first.

## CLI Lanes

- Mode `enabled`, approval `lane-review` (see decisions.md D1).
- Roster at Gate 0.1 (2026-10-25): codex installed, confirmed room (weekly 3%); antigravity installed
  (limit reader failed); grok installed (API key, no plan); Glm ptah-cli available; opencode AT
  LIMIT; copilot disabled; cursor and pi not installed.
- Use: codex lanes without a role for cross-side document and code reviews. Implementation by
  Claude subagents (at most 6 files each).

## Conversation Summary

- Predecessor: TASK_2026_712_5d7c (Batches 1-35, PRs #808 and #820 merged). Its task folder is on
  main at `.ptah/specs/TASK_2026_712_5d7c/` (decisions D1-D41, implementation-plan.md, HANDOFF.md).
- What blocks named use today (verified on the #820 code):
  - `libs/backend/auth-providers/src/lib/accounts/claude-account-command.ts:109` `authorization()`
    always returns `release-held`; `environment()` (line 114) always throws `unsupported-source`.
  - `libs/backend/auth-providers/src/lib/accounts/provider-account.service.ts:78` admission always
    refuses `release-held`; `libs/backend/auth-providers/src/lib/di/register.ts:165-175` fallback port
    refuses too.
  - D37: the stored Claude lane selection is not read at spawn
    (`libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts`).
  - D22: the chat RPC has no `accountSelection`.
- The user signs in to each account personally; the agent never sees or stores credentials.
