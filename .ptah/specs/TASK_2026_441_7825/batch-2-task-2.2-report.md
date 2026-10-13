# Batch 2 Task 2.2 report

## Deliverable

Modified in place: `D:\projects\ptah-extension\.claude-worktrees\task-441-lanes-first-c89362de48e8\apps\ptah-extension-vscode\assets\plugins\ptah-core\skills\agent-lanes\SKILL.md`

## Quality requirements and evidence

- §4 per-turn rule: line 103 says one `<agent-lane-completed>` signal per lane turn; lines 124-127 say a queued `ptah_agent_message` turn can change the deliverable, the later signal supersedes the earlier one, and review waits while a queued message is pending.
- §4 completion: lines 97-99 and 111-120 declare `deliverables`, use the pushed signal as the wake, read status/output, and verify file contents. Lines 119-123 reject missing or empty files, permit one status/read check if push is unavailable, and prohibit timers, watchers, and repeated checks.
- §5 recovery: lines 137-140 classify failures and name the readable limit evidence as the `ptah_agent_list` `AT LIMIT` row with reset time or `reset unknown`, together with lane output. Lines 142-148 record lane identity/family/reset in run-local `context.md`, key exhaustion by lane, forbid force-spawn, order `other family same capability` → `same family other provider/model` → `subagent` with `Subagent reason`, skip unknown-reset lanes for the run, and allow a fresh confirmed-room row to override. Lines 150-157 give the one-resume or narrower-respawn non-limit path, move after two failures, require cause/reset reporting, and prohibit silently replacing a user pin. No `failureKind` claim remains.
- §6 routing: lines 167 and 170 route decision artifacts to Document gates and shipping code to a different-family reviewer. Lines 172-184 keep opposite-side document review, gate verdicts, same-side → user, REVISE at cap → user, and proposed removal → user. Lines 185-193 require independent different-family shipping-code review regardless of side, record `Review family`, and require a specific reason plus weaker-evidence label for same-family or subagent fallback. Lines 168-170 and 194-203 retain parity, write-path trace, visual screenshots, `file:line` defects, two-round cap, and scoped checks.
- Generic wording: lines 19-34 use live-row placeholders and no named-vendor roster.

## Grep self-check

- Exact fixed-vocabulary matches: `Document gates` (167, 172), `Shipping code` (170, 185), `other family same capability` and `same family other provider/model` (145), `subagent` (145), `Subagent reason` (146), `Review family` (188), `reset unknown` (139), `AT LIMIT` (139). Each `rg -n -F` check exited 0.
- Per-turn marker matches: exact `one <agent-lane-completed> signal per lane turn` with backticks in source (103), `later signal` and `supersedes` (125), `pending` (126). Each grep exited 0.
- Banned grep exited 1 with no matches for `CLI author.{0,12}subagent`, `Code that will ship.{0,80}cross-side`, `failureKind`, or `cross-side review`.
- Document escalation grep found `same-side` (176-181), `REVISE at the cap` (181), and `proposed removal goes to the user` (182). Preservation grep also found `file:line` (195), revision cap (196), visual evidence (169), and scoped checks (202).

## Risk handling and verification boundary

- R2-1: the readable AT LIMIT list row plus lane output replaces the plan's unexposed typed failure field (139-140).
- decisions.md #9: the queued-message drain and later-signal rule prevent review of an earlier version (124-127).
- R2-2: all three document-gate escalation sentences remain in §6 (180-182).
- R2-3: both review categories are bold-labelled bullets (172, 185), matching the validator's bullet markers.
- Parallel Batch 2 vocabulary: every exact shared string was grep-checked above. The concurrent orchestration files and tracked `.claude` mirrors were untouched.
- Scoped `ptah_get_diagnostics` reported unavailable for this Markdown file (`analyzed: 0`). As instructed, no validator, build, test, or workspace-wide command was run; the team-leader owns validator verification.
