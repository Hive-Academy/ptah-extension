/**
 * Compact, on-demand pointer for Electron coding sessions. The skill carries
 * the normative grammar and examples so this prompt remains inexpensive: it
 * names the `display [id]` target, the id-update rule and every host source,
 * and stays within 100 tokens (TASK_2026_623 R8.1).
 *
 * Codex chat must not use {@link PTAH_UI_HINT}: it has no skill instruction
 * source, and the load sentence makes the model search the filesystem.
 */
const PTAH_UI_HINT_SHARED = `Use \`\`\`ptah-ui blocks for compact turn summaries, stats, changed files, test results or charts in Ptah Electron; \`\`\`ptah-ui display [id] shows one in the side panel, and reusing an id updates it in place. Reference $diff $tests $usage $agents $limits; the host supplies real values—never type them yourself.`;

export const PTAH_UI_HINT = `${PTAH_UI_HINT_SHARED} Load the ptah-surface-authoring skill for grammar and examples.`;

/** Same sentences as {@link PTAH_UI_HINT}, without a skill-file lookup. */
export const PTAH_UI_HINT_CODEX = PTAH_UI_HINT_SHARED;
