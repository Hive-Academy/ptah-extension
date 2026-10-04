/**
 * Compact, on-demand pointer for Electron coding sessions. The skill carries
 * the normative grammar and examples so this prompt remains inexpensive.
 */
export const PTAH_UI_HINT = `Use \`\`\`ptah-ui:
\`\`\`ptah-ui
title Summary
stats
  Files | $diff.files
  Passed | $tests.passed
  Cost | $usage.cost
table
  Name | Value
  Status | ready
list
  - Complete
chart bar Changes
  Added | 3
\`\`\`
Kinds: title, stats, table, list, chart. $diff, $tests, $usage. Grammar: ptah-surface-authoring skill.`;
