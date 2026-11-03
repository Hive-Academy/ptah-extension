# HANDOFF - TASK_2026_kimi_limits (Kimi Code plan usage and limits)

Date: 2026-11-01

## Goal

Show Kimi Code subscription usage and plan limits (5-hour, 7-day, optional monthly windows)
in `ptah_agent_list` and the Electron limits display, as for codex, opencode and Ollama Cloud.
Today Kimi shows "limits not tracked" because `PlanUsageService` has no `kimi-code` reader.

## Standing rule

Claude usage is high. Delegate to CLI lanes (`ptah_agent_list` -> `ptah_agent_spawn`) and
keep the main session thin. See "Usage: delegate heavily to CLI agent lanes" in
`C:\Users\abdal\.claude\CLAUDE.md`.

## Location

- Worktree: `D:\projects\ptah-extension\.claude-worktrees\kimi-code-plan-usage`
- Branch: `feat/kimi-code-plan-usage` (from `main` at 12a482782). Nothing committed, nothing pushed.
- `node_modules` is a junction to the main checkout. Never run `npm install` in the worktree.
  Before any future `git worktree remove`, run `cmd /c rmdir <worktree>\node_modules` first.
- Task folder (in worktree): `.ptah/specs/TASK_2026_kimi_limits/`
  - `research-report.md` - architecture, official API, owner cases, plan, risks
  - `implementation-notes.md` - codex lane notes, verify commands and results
  - `code-logic-review.md` - expected from the review lane (may be missing if it is still running)

## Done

1. Research (Kimi Code lane). Official API: `GET {kimiCodeBaseUrl}/usages` (`/coding/v1/usages`),
   Bearer token. Source: MoonshotAI/kimi-code commit a2afdbc7, `packages/oauth/src/managed-usage.ts`.
2. Implementation (codex lane, uncommitted). 14 files changed plus new
   `libs/backend/auth-providers/src/lib/quota/readers/kimi-code-plan-usage.reader.ts` and its spec.
   Touches `plan-usage.service.ts`, `provider-owner.resolver.ts`, `di/register.ts` (auth-providers),
   `plan-owner-read.ts`, `plan-limit-owner-discovery.service.ts`, `lane-limit-lookup.service.ts`,
   `ptah-cli-lane-plan-limits.ts` (cli-agent-runtime), `apps/ptah-electron/src/di/container.smoke.spec.ts`.
3. Verification by codex lane:
   - Reader spec 18/18 pass. Changed-project typechecks pass. CLI and Electron tests pass.
   - `npm run verify -- -p ptah-cli,ptah-extension-vscode -t typecheck,test`: 44/44 pass.
   - `auth-providers:test`: 4 failures, Windows `EPERM` temp cleanup in
     `translation-proxy.sdk.integration.spec.ts` (claimed unrelated, NOT confirmed on main).
   - `auth-providers:lint`: fails on unchanged `libs/backend/auth-providers/package.json:9`
     (unused `@ptah-extension/persistence-sqlite` declaration). File unchanged, so pre-existing.

## Review result (done)

Review lane (Kimi Code, code-logic-reviewer, agent `708a4499-2e52-4bc7-bf5d-afba15818fff`)
wrote `code-logic-review.md`: 7/10, APPROVE WITH FIXES. Lane completed (exit 0). To re-review the
fixes in the same context, resume it with CLI session ID `966d6888-6abb-499a-8328-b8c17e80921a`. Endpoint host is OK
(`api.kimi.ai/coding/v1` is an official host and matches `kimi-code-provider-entry.ts:123-142`).
Findings to fix (details and file:line in the review, section "Findings"):

1. SERIOUS - Main Kimi OAuth sessions bypass the new shared-connection owner resolver
   (wrong owner path for the main session).
2. SERIOUS - The contradiction guard rejects valid responses that have an unrelated zero window.
   Reject only the window that contradicts the legacy fields.
3. MINOR - Legacy value and ratio coercion accepts malformed data; parse strictly with Zod.

## Open points to check

1. `/usages` acceptance of a Kimi API key (not OAuth) is unverified.
3. False zero `used_ratio` (Kimi issues #3908, #3951): the reader rejects a zero when legacy
   `usage.used` is positive. Confirm the tests cover it.
4. Confirm whether the `EPERM` failures also happen on `main`.

## Next steps

1. Read `code-logic-review.md`. Fix the 3 findings above, with a regression test for each, by
   resuming the codex lane:
   `ptah_agent_spawn { cli: "codex", resume_session_id: "01a1950a-801b-7b00-9e87-4809432b2553", task: "..." }`.
2. Re-verify only changed projects:
   `npm run verify -- -p auth-providers,cli-agent-runtime,ptah-electron` and
   `npm run verify -- -p ptah-cli,ptah-extension-vscode -t typecheck,test`.
3. Inspect `git status` and full diff. Stage task files by explicit path (include the task folder
   `.ptah/specs/TASK_2026_kimi_limits/`). Read `.commitlintrc.json` for scopes. Commit in the
   foreground, e.g. `feat(auth-providers,cli-agent-runtime): read kimi code plan usage`.
4. Push and `gh pr create` against `main` in one background command. PR body: `## Summary`,
   `## Test plan` with real results, including the EPERM and lint notes.
5. Watch CI and reviews with `gh`, fix findings, push again. Report PR URL, head, CI and review state.

## Side note

The Kimi research lane first wrote its report into the untracked
`.ptah/specs/TASK_2026_motion_investigation/` in the main checkout. It was moved out. If that
folder had an older `research-report.md`, the lane overwrote it and it cannot be recovered.
