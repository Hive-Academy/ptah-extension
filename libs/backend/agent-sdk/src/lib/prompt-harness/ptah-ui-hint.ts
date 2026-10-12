/**
 * Compact, on-demand pointer for Electron coding sessions. The skill carries
 * the normative grammar and examples so this prompt remains inexpensive: it
 * names the `display [id]` target, the id-update rule and every host source,
 * and stays within 100 tokens (TASK_2026_623 R8.1).
 */
export const PTAH_UI_HINT = `Use \`\`\`ptah-ui blocks for compact turn summaries, stats, changed files, test results or charts in Ptah Electron; \`\`\`ptah-ui display [id] shows one in the side panel, and reusing an id updates it in place. Reference $diff $tests $usage $agents $limits; the host supplies real values—never type them yourself. Load the ptah-surface-authoring skill for grammar and examples.`;
