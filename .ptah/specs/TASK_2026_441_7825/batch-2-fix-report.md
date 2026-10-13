# Batch 2 fix round 1

## Wording fixes

1. `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/orchestration/references/checkpoints.md:176,179` — Before: row 1 said `no preference | \`enabled\` | \`lane-review\``; row 4 said `No spawnable capable lane and no lane preference | \`disabled\` | \`user\``. After: row 1 says `no recorded preference | \`enabled\` | \`lane-review\``; row 4 says `No spawnable lane and no lane preference | \`disabled\` | \`user\``.
2. `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/orchestration/references/lane-assignment.md:35-38,40-43` (before) → `:35-37,39-44` (after) — Before: the bounded-batch lane default was in the preceding section; `## Batches on lanes` only restricted parallel execution to independent, file-disjoint tasks. After: `## Batches on lanes` names a CLI lane as the default executor for every bounded sequential or parallel batch when a capable lane is spawnable and the batch fits the cap; it keeps the parallel independence and file-disjointness condition and requires `Subagent reason` for a subagent executor. The duplicate batch-default sentence was removed from the preceding section.
3. `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/agent-lanes/SKILL.md:124-125` — Before: `queue-next-turn` appeared before `later signal`, while `queued` appeared after `supersedes`. After: `A message queued with \`ptah_agent_message\` runs as a new turn after a \`delivered\` signal and can change the deliverable again.` precedes `A later signal from the same agent supersedes an earlier one.` The earlier duplicate wording was replaced.

## Validator tail

The requested `npm run validate-skill 2>&1 | tail -40` pipeline could not start in PowerShell because `tail` is unavailable. The validator ran once using `npm run validate-skill 2>&1 | Select-Object -Last 40`:

```text
========================================
  Orchestration Skill Validation
========================================
Found 8 markdown files to validate

ERRORS (5):

  [REFERENCE] apps\ptah-extension-vscode\assets\plugins\ptah-core\skills\orchestration\SKILL.md:50
    Message: Broken link: "references/fleet.md" - file does not exist
    Suggestion: Check if the file path is correct. Expected: apps\ptah-extension-vscode\assets\plugins\ptah-core\skills\orchestration\references\fleet.md

  [REFERENCE] apps\ptah-extension-vscode\assets\plugins\ptah-core\skills\orchestration\SKILL.md:186
    Message: Broken link: "references/fleet.md" - file does not exist
    Suggestion: Check if the file path is correct. Expected: apps\ptah-extension-vscode\assets\plugins\ptah-core\skills\orchestration\references\fleet.md

  [CONTENT] apps\ptah-extension-vscode\assets\plugins\ptah-core\skills\orchestration\references\fleet.md
    Message: Required reference file missing: fleet.md
    Suggestion: Create reference file at apps\ptah-extension-vscode\assets\plugins\ptah-core\skills\orchestration\references\fleet.md

  [CONTENT] libs\backend\agent-generation\templates\agents\team-leader.template.md:103
    Message: Missing or out-of-order policy marker in Mode 1 — Decomposition: Recommended executor: CLI lane
    Suggestion: Place "Recommended executor: CLI lane" in Mode 1 — Decomposition, after the preceding required marker

  [CONTENT] libs\backend\agent-generation\templates\agents\team-leader.template.md:103
    Message: Missing or out-of-order policy marker in Mode 1 — Decomposition: Subagent reason:
    Suggestion: Place "Subagent reason:" in Mode 1 — Decomposition, after the preceding required marker

========================================
  Validation Summary
========================================
  Files checked: 8
  Errors: 5
  Warnings: 0

  VALIDATION FAILED
```

## Remaining errors

- `fleet.md` x3: two broken links in orchestration `SKILL.md` and the missing required reference file.
- Team-leader template markers x2: `Recommended executor: CLI lane` and `Subagent reason:` in Mode 1 — Decomposition.

The five remaining errors match the expected Batch 2 red list. No document-gate escalation text was edited.
