# PR #582 round 3 — CodeRabbit lane report (glm)

Worktree: `D:\projects\ptah-extension\.claude-worktrees\skills-design-gate`
Branch: `docs/skills-design-gate-parity`

| Comment id | File:line | Change |
|---|---|---|
| 4086482638 | `.ptah/specs/TASK_2026_535/task.md:45` | Removed the duplicate `agent_id` from the `run_id` parenthetical. `run_id` is now `(primary key)` and a single `agent_id (nullable, indexed)` column follows. |
| 4086482645 | `.ptah/specs/TASK_2026_537/task.md:49` | Added to the `typesafe` adapter bullet: the configured endpoint must be `https:`; the adapter rejects a non-https URL before it attaches the key. The redirect rule stays. |
| 4086482653 | `.ptah/specs/TASK_2026_537/task.md:73-79` | Replaced "passing holdout eval" with per-flag ship criteria on the holdout set for `replacesExistingSurface`, `touchesUiSurface`, `changesPersistedSettings`: strict false-negative bound (e.g. recall ≥ 0.95) plus a calibration criterion (e.g. ECE ≤ 0.05); exact numbers confirmed at the research gate; thresholds do not ship until every gate-driving flag meets them. Detecting TASK_2026_523 stays a required case (also covered in Acceptance). |
| 4086482661 | `.ptah/specs/TASK_2026_538/task.md:19,31` | PR #581 reworded as merged; base is `main`, "depends on #581" stays. Migration: an existing secret is kept and the plain setting is still deleted; the plain value is copied only when no secret exists. |

Verification: `git diff --check` exit 0; headings keep a blank line after them; only the three named task spec files changed (diff --stat confirms).

## Re-apply after concurrent restore

Another lane restored the three spec files to HEAD at 22:50:14, after the first report. The same
four fixes were re-applied and verified against HEAD with read-only git only.

| Item | File:line | Change |
|---|---|---|
| 4086482638 | `.ptah/specs/TASK_2026_535/task.md:45` | `run_id` (primary key), single `agent_id (nullable, indexed)` column; duplicate removed. |
| 4086482645 | `.ptah/specs/TASK_2026_537/task.md:49` | `typesafe` adapter: configured endpoint must be `https:`; non-https URL rejected before the key is attached. |
| 4086482653 | `.ptah/specs/TASK_2026_537/task.md:73-79` | Per-flag holdout ship criteria: strict false-negative bound (e.g. recall ≥ 0.95) + calibration criterion (e.g. ECE ≤ 0.05), exact numbers confirmed at the research gate, thresholds ship only when every gate-driving flag meets them; TASK_2026_523 stays required. |
| 4086482661 | `.ptah/specs/TASK_2026_538/task.md:19,31` | PR #581 reworded as merged, base `main` ("depends on #581" kept); migration keeps an existing secret, still deletes the plain setting, copies the value only when no secret exists. |
| New (orchestrator) | `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/agent-lanes/SKILL.md:71-73` | §3 item 7 (Git): two added lines — never run `restore`, `checkout -- <path>`, `stash`, `reset`, `clean`; a change the lane did not make belongs to another writer — report it, never revert it. |

Verification after re-apply: `git diff --check` exit 0; `git diff --stat -- .ptah/specs` shows all
three spec files differing from HEAD (plus SKILL.md, 222 lines, within the 230-line cap); no
commits; no other skill, template or mirror touched.