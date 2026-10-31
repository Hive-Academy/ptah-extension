# Task: batch 10d.E revision 2 (TASK_2026_714_c8a2) — final revise round

HARD RULES (read first):
- Do NOT run verify, tests, typecheck, lint, build, nx, npm or ptah_get_diagnostics. The coordinator runs all checks.
- Do NOT commit, push, stash, reset, restore, checkout or clean. Never revert a change you did not make.
- Never strip, revert or comment out MCP.
- Work only in W = D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration. Use absolute paths.
- Do not convert line endings of whole files. Edit only the lines you must change. Never edit a regex
  or string literal that the item does not name.
- No `any`, `as unknown as`, `@ts-ignore`, `eslint-disable`. UTF-8 without BOM.

## Objective

Fix the 3 new defects of the re-review, plus any coordinator verify failures listed below. Keep all
revision 1 work (the re-review marked defects 2-7 fixed).

## Inputs

- Re-review: W\.ptah\specs\TASK_2026_714_c8a2\code-logic-review-10d-E-r1.md ("New defects" 1-3)
- Revision 1 report: W\.ptah\specs\TASK_2026_714_c8a2\batch-10d-E-revision-1-report.md
- Plan R3: W\.ptah\specs\TASK_2026_714_c8a2\plan-p10-review.md

## Work items

1. (major) W\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\codex\codex-app-server-lane.adapter.ts:184
   `parseOutput` now uses `/\n(?!\n)/g`, which deletes every single newline from lane output.
   Restore `/\r(?!\n)/g` (the committed version). Add a case to
   codex-app-server-lane.adapter.spec.ts: `"line 1\nline 2\r\n"` keeps both newlines and a bare
   `"a\rb"` becomes `"ab"`.
2. (minor) W\apps\ptah-electron\src\di\codex-lane-composition.spec.ts:216-244 — the R3 case cannot
   fail (it compares values with themselves on a static fake context, and open is mocked).
   Rewrite it so it can fail: snapshot (deep copy) each opened context's profile and policy
   (fingerprint, turnPermissionLevel, sandbox/approval policy) right after it opens, then open the
   other consumer and a second lane with other options, then compare each context with its own
   snapshot. Use objects that a shared-state bug would really change (for example, use the real
   per-scope profile objects returned by the composition, not a single static fake). Cover both
   directions (chat first, lane first).
3. (minor) W\libs\backend\agent-sdk\src\lib\session-metadata-store.spec.ts:350-376 covers only the
   legacy store path. Add the same lane-row exclusion case for the records-backed (SQLite
   repository) store path, using the existing fixtures in that spec (around :894-912 or :2043).

COORDINATOR VERIFY FAILURES (fix these too, if any): see the section "Verify failures" at the end
of this file. If the section says "none", skip it.

## Scope

Only the three files named above, plus files named in "Verify failures". Do not modify anything else.

## Deliverable

**Deliverable**: D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\.ptah\specs\TASK_2026_714_c8a2\batch-10d-E-revision-2-report.md
Write it first as a skeleton, then fill it in: per item, files and lines changed, status.
Reply only `WROTE: <absolute path>` plus a one-line headline. Call ptah_agent_report once before the
final message.

## Verify failures
none (the coordinator stopped the verify before it reported; it runs after this round).
