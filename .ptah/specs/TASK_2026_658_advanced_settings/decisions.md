
## 2026-10-14 — A1 max limits (user decision)
- User approved the proposed A1 limits exactly as in implementation-plan.md (table rows 56-81).
- Source: AskUserQuestion answer "Approve as proposed". Branch: feat/advanced-settings-ui
  (worktree .claude-worktrees/feat-advanced-settings-ui, off origin/main 4f571f8d1).

## 2026-10-14 — codex review (code-logic-review.md, 6/10) fix round
- Fix Serious 1 in the UI: never render backend error text under a field; show the card's
  fixed status strings. The client validator already refuses out-of-range values, so the
  backend validator message is not needed in practice. Host `settings:set` exception text
  for other callers is pre-existing and out of scope.
- Fix Serious 2: an independent 5 s deadline around each group read, so Retry appears even
  when the host bridge never becomes ready.
- Defer Moderate 3 (malformed success read without `value`): no data loss, a later task.

## 2026-10-14 — visual review (visual-review.md, NEEDS_FIX 7/10)
- Fix Serious 1 (validation error unstyled, no light-theme border, not announced) and
  Moderate 3 (static "Enabled" beside a toggle shows a wrong state when off).
- Follow-ups in the PR body: Moderate 2 (9 px restart badge), Moderate 4 (card in card,
  empty status row), Minor items (thousands separators, "Saved {label}." grammar, chevron).
- After the fix, a fresh visual check of the error and toggle states (dark + light).

## 2026-10-14 (session 4) — wrong help text for compaction.subagentHandoffTokens
- Evidence: subagent-budget-monitor.ts (main) stops the subagent when its context reaches this
  size and hands the parent a handoff. The help text said the result is "summarised". Text-only
  fix before the PR (docs-only change: no code review per orchestration rule 3).
