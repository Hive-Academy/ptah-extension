# Batch 3 report — generic fleet mode

## Completion by task

| Task | Result and evidence |
| --- | --- |
| 3.1 | Created `fleet.md`. Entry and ID checks: lines 5–11; disk resume and completed-artifact no-op: 13–17; artifact-before-status and judge JSON: 19–36; exact batch cap and disjoint writes: 38–42; read-only judge, cited defects, two-round cap: 44–48; lane contract and quiet window: 50–54. |
| 3.2 | Reworked `git-standards.md` for repository-defined commitlint and hook rules (lines 5–9), a quiet commit window with pending-turn check (11–15), and the existing three-choice hook failure protocol (17–25). The `#hook-failure-protocol` anchor used by other references remains. |
| 3.3 | Updated `orchestrate.md` with ID validation before spawn and mode selection (lines 10–21), plus the fleet reference (37). Replaced stale help content in `orchestrate-help.md` with usage and one-ID behavior (7–17), fleet stages (23–32), and recovery guidance (34–36). |

## Fleet parity

| Old fleet skill section | New heading or owner |
| --- | --- |
| §1 Entry | `fleet.md` → Entry; `orchestrate.md` → Select the workflow. |
| §2 Harness limitation | `fleet.md` → Resume from disk (generic rule). The workflow-specific resume caveat remains for Batch 5's repo-local workflow edit. |
| §3 Artifact checkpoints | `fleet.md` → Checkpoints and Resume from disk. Judge artifact filename, all six JSON keys, artifact verification, status ownership, and respawn no-op are present. |
| §4 Disjoint-lib batching | `fleet.md` → Disjoint batching. The exact six-file/two-project/one-command cap is present. |
| §5 Commit window | `git-standards.md` → Quiet commit window; `fleet.md` → Commit window and lane mechanics. |
| §6 Commitlint gates | `git-standards.md` → Repository commit rules points to the user's local config. Repo-specific scope rules remain with Batch 5. |
| §7 Nx test rule | Batch 5 owns the repo-local rule; no Nx-only command entered the shipped plugin. |
| §8 Judge protocol | `fleet.md` → Judge protocol and Checkpoints. |
| §9 CLI agent lanes | `fleet.md` → Commit window and lane mechanics links to `agent-lanes/SKILL.md` §§1, 3, 4, 8 rather than copying its mechanics. |

The old `.claude/skills/fleet-orchestration/SKILL.md` was read as source and left untouched; Batch 5 owns its deletion. No git write was performed.

## Validation

Ran once: `npm run validate-skill 2>&1 | Select-Object -Last 40` (PowerShell). Exit code 1 is the expected remaining Batch 4 template work. Tail:

```text
Found 9 markdown files to validate
ERRORS (2):
  [CONTENT] libs\backend\agent-generation\templates\agents\team-leader.template.md:103
    Missing or out-of-order policy marker in Mode 1 — Decomposition: Recommended executor: CLI lane
  [CONTENT] libs\backend\agent-generation\templates\agents\team-leader.template.md:103
    Missing or out-of-order policy marker in Mode 1 — Decomposition: Subagent reason:
Validation Summary
  Files checked: 9
  Errors: 2
  Warnings: 0
  VALIDATION FAILED
```

All three former `fleet.md` errors are gone. A targeted search of `fleet.md` found no vendor names, `npx nx`, or commitlint scope enum. Scoped `ptah_get_diagnostics` reported Markdown coverage unavailable (`analyzed: 0`); the skill validator supplied the meaningful Markdown check.

## Plan-validation risks and edge cases

| Listed risk or edge case | Handling in this batch |
| --- | --- |
| R2-1 quota authority and unknown reset; resumed lane has a new agent ID | The fleet reference delegates live-lane discovery/recovery to `agent-lanes/SKILL.md` (line 54). Batch 2 owns the AT LIMIT, reset unknown, and lane-keyed exhaustion rules; this batch did not add a competing rule. |
| Queued message after a delivered signal | The quiet window checks for a pending queued lane turn before commit (`git-standards.md:13`). Batch 2 owns review supersession while a queued message is pending. |
| R2-2 document-gate escalation; R2-3 bullet markers; R2-4 roster removal | Batch 2 owns these rules. Fleet entry uses the normal document gates and lane contract (`fleet.md:9`), without reinstating a vendor roster. |
| Fixture hash pin and committed labels | Batch 6 owns the JSONL/manifest pair; neither was edited here. |
| Repo-local workflow worker status instruction | `fleet.md:36` assigns status writes only to orchestrator/team-leader after artifact checks. Batch 5 owns alignment of `.claude/workflows/fleet-fix.js`. |
| H1 expected-red validator state | This batch retired the three fleet errors; the tail above shows only two team-leader template errors for Batch 4. |
| Fixed vocabulary across parallel Batch 2 lanes | This batch links the shared lane contract and preserves its wording without creating a separate fallback vocabulary. |
| Plugin version/content manifest ordering | Batch 7 owns both after all content edits; neither was touched here. |
| Stored preference with no lane; stale or missing memory; unknown reset; same-family review | Batch 2 owns Gate 0.1 and lane recovery. Fleet mode uses those existing rules through its lane link (`fleet.md:9,54`). |
| Fleet invoked with one ID; IDs before spawn | One resolved ID continues normally, including an explicit “fleet” request; IDs must exist, be readable, and be distinct before spawn (`fleet.md:7–11`; `orchestrate.md:21`). |
| Respawned worker with complete artifact | It checks artifact completeness, then no-ops and reports (`fleet.md:17`). |
| Multiple Nx projects | Batch 5 owns the repo-local command and project-count check; the shipped reference uses only a generic scoped verification command (`fleet.md:40`). |

## Files created or modified

- `D:\projects\ptah-extension\.claude-worktrees\task-441-lanes-first-c89362de48e8\apps\ptah-extension-vscode\assets\plugins\ptah-core\skills\orchestration\references\fleet.md` — created.
- `D:\projects\ptah-extension\.claude-worktrees\task-441-lanes-first-c89362de48e8\apps\ptah-extension-vscode\assets\plugins\ptah-core\skills\orchestration\references\git-standards.md` — modified.
- `D:\projects\ptah-extension\.claude-worktrees\task-441-lanes-first-c89362de48e8\apps\ptah-extension-vscode\assets\plugins\ptah-core\commands\orchestrate.md` — modified.
- `D:\projects\ptah-extension\.claude-worktrees\task-441-lanes-first-c89362de48e8\apps\ptah-extension-vscode\assets\plugins\ptah-core\commands\orchestrate-help.md` — modified.
- `D:\projects\ptah-extension\.claude-worktrees\task-441-lanes-first-c89362de48e8\.ptah\specs\TASK_2026_441_7825\batch-3-report.md` — created.
