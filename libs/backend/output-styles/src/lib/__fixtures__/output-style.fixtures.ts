/**
 * Test fixtures for the output-style surface.
 *
 * MARKETPLACE (BLOCKING): every fixture is an inline TypeScript string
 * constant. There is deliberately NO `.md` fixture file anywhere in this lib.
 * A `.md` asset under `libs/` would depend on `.vscodeignore` coverage to stay
 * out of the shipped VSIX; a `.ts` constant removes the question entirely.
 *
 * Keep these free of trademarked AI product names — they are here to exercise
 * the parser, not to reproduce vendor copy.
 */

/** File name the STE fixture is stored under in the reference project. */
export const STE_FILE_NAME = 'simplified-technical-english.md';

/**
 * The reference fixture (Req 8.1/8.2/8.4): a valid three-key style whose
 * frontmatter `name` differs from its filename, so it also proves E1.
 */
export const STE_FIXTURE = `---
name: Simplified Technical English
description: Writes all responses in ASD-STE100 Simplified Technical English - short sentences, approved words, active voice.
keep-coding-instructions: true
---

# Simplified Technical English

Write user-facing text according to ASD-STE100 Simplified Technical English (STE), Issue 9.

## Vocabulary

- Use words from the approved dictionary when possible.
- Use each approved word only with its approved meaning.
`;

/** No frontmatter `description`, so the description must be DERIVED (Req 1.4). */
export const DERIVED_DESCRIPTION_FIXTURE = `---
name: Terse
---

# Terse

Keep every answer to the shortest form that still answers the question.

A second paragraph that must not appear in the derived description.
`;

/** A body whose first paragraph is longer than the 160-character cap. */
export const LONG_BODY_FIXTURE = `---
name: Verbose
---

${'This first paragraph is deliberately long so the derived description has to be truncated. '.repeat(4)}
`;

/** camelCase spelling of `keep-coding-instructions`, which the SDK also accepts. */
export const CAMEL_CASE_FIXTURE = `---
name: Camel
description: Uses the camelCase spelling the SDK normalises on read.
keepCodingInstructions: true
---

Body of the camelCase style.
`;

/** `keep-coding-instructions` absent — must resolve to `false` ("replaces"). */
export const KEEP_INSTRUCTIONS_ABSENT_FIXTURE = `---
name: Replaces
description: Leaves the key out entirely.
---

Body of the style that replaces the coding instructions.
`;

/** Explicit `false` — same verdict as absent. */
export const KEEP_INSTRUCTIONS_FALSE_FIXTURE = `---
name: ReplacesExplicitly
description: Sets the key to false.
keep-coding-instructions: false
---

Body of the style that replaces the coding instructions explicitly.
`;

/** A fifth key. The strict schema must reject it and NAME it (Req 7.2). */
export const UNRECOGNIZED_KEY_FIXTURE = `---
name: Themed
description: Carries a key the strict schema does not accept.
theme: dark
---

Body of the invalid style.
`;

/** Frontmatter that will not parse as YAML at all (Req 7.3). */
export const MALFORMED_YAML_FIXTURE = `---
name: Broken
description: [unclosed
tags
---

Body of the unparseable style.
`;

/** A known key holding the wrong type. */
export const WRONG_TYPE_FIXTURE = `---
name: Typed
description: Carries a boolean where a boolean is not expected.
keep-coding-instructions: sometimes
---

Body of the wrongly typed style.
`;

/** No frontmatter block at all — valid, name falls back to the filename (E1). */
export const NO_FRONTMATTER_FIXTURE = `# Plain

A style file with no frontmatter block at all.
`;
