# Batch 30 fix report (verification round 1)

Text-only edits in the asset copy, then mirrored. No fence, example body, catalog.md or PTAH_UI_HINT touched. No git run.

## Edits (asset copy)

Base: D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\apps\ptah-extension-vscode\assets\plugins\ptah-core\skills\ptah-surface-authoring\

1. `references\ptah-ui.md:144`
   - Before: `- \`list $agents\` lists \`name\`. A table or list shows at most 1,000 rows and ends with a "+N more" note when rows are left out.`
   - After: `- \`list $agents\` lists \`name\`. A table shows at most 1,000 rows and ends with a "+N more" note when rows are left out. A \`list $agents\` shows the first 1,000 names with no "+N more" note.`
   - Basis: `ptah-ui-resolver.ts` agentsRows sets the note for rows; the `$limits` line (162) left unchanged.
2. `SKILL.md:20`
   - Before: `... widens \`$agents\` from this turn to the whole session.`
   - After: `... widens \`$agents\` from this turn to every turn of the session up to and including the block's own turn, never a later one.`
   - Basis: `ptah-ui-agents-source.ts:171-172` (`firstTurn` 0 .. `turnIndex`).
3. `references\ptah-ui.md:145`
   - Before: `- Rows are ordered by turn, then by start time within the turn, then by key.`
   - After: same sentence plus ` Rows with no known start time sort last within their turn.`
   - Basis: `compareScopedRows` (`ptah-ui-agents-source.ts:326-334`, null start sorts after known).

## Mirror

Copied SKILL.md and references\ptah-ui.md over D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\.claude\skills\ptah-surface-authoring\ (catalog.md unchanged).

## Checks (one at a time)

- `diff -r apps/.../ptah-surface-authoring .claude/skills/ptah-surface-authoring`: no output, exit 0.
- `ptah-ui-compactness.spec.ts` (mapper command as given): 1 suite passed, 31 tests passed.

## Changed files

- D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\apps\ptah-extension-vscode\assets\plugins\ptah-core\skills\ptah-surface-authoring\SKILL.md
- D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\apps\ptah-extension-vscode\assets\plugins\ptah-core\skills\ptah-surface-authoring\references\ptah-ui.md
- D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\.claude\skills\ptah-surface-authoring\SKILL.md
- D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\.claude\skills\ptah-surface-authoring\references\ptah-ui.md
