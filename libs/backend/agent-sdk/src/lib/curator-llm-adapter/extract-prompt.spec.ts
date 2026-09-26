import {
  EXTRACT_SYSTEM_PROMPT,
  buildExtractUserPrompt,
} from './extract-prompt';

/**
 * The JSON schema block exactly as it stood at base `ebfc73321`. The parser in
 * `extract.schema.ts` reads these fields, so the prompt rewrite (TASK_2026_563
 * M4) must not move a single character of it.
 */
const BASE_SCHEMA_BLOCK = `{
  "memories": [
    { "kind": "fact" | "preference" | "event" | "entity",
      "subject": string | null,
      "content": string,
      "salienceHint": number, /* 0..1 */
      "request": string | null,        /* what the user asked for */
      "investigated": string | null,   /* what was explored / read / searched */
      "learned": string | null,        /* findings / insights / root causes */
      "completed": string | null,      /* what was actually done / changed */
      "nextSteps": string | null,      /* follow-ups, open questions, TODOs */
      "type": "bugfix" | "feature" | "decision" | "discovery" | "refactor" | "change",
      "concepts": string[],            /* up to 5 short tags (lowercase, kebab-case) */
      "files": string[]                /* repo-relative file paths referenced */
    }
  ]
}`;

/** Field names the base schema block declares, in order. */
const BASE_FIELDS = [
  'memories',
  'kind',
  'subject',
  'content',
  'salienceHint',
  'request',
  'investigated',
  'learned',
  'completed',
  'nextSteps',
  'type',
  'concepts',
  'files',
];

/** The prompt with every run of whitespace collapsed, so wrapping never matters. */
const flat = EXTRACT_SYSTEM_PROMPT.replace(/\s+/g, ' ');

function schemaBlock(prompt: string): string {
  const start = prompt.indexOf('{\n  "memories"');
  const end = prompt.indexOf('\n}', start);
  return prompt.slice(start, end + 2);
}

describe('EXTRACT_SYSTEM_PROMPT', () => {
  it('keeps the JSON schema block byte-identical to the base', () => {
    expect(schemaBlock(EXTRACT_SYSTEM_PROMPT)).toBe(BASE_SCHEMA_BLOCK);
  });

  it('keeps the schema field list identical to the base', () => {
    const fields = [
      ...schemaBlock(EXTRACT_SYSTEM_PROMPT).matchAll(/"([A-Za-z]+)":/g),
    ].map((m) => m[1]);
    expect(fields).toEqual(BASE_FIELDS);
  });

  it('asks only for durable knowledge', () => {
    expect(flat).toContain(
      'extract only DURABLE knowledge — facts, decisions, preferences and lessons that will still be true and useful in a future, unrelated conversation.',
    );
  });

  it('no longer offers a bare product or service name as a subject example', () => {
    expect(EXTRACT_SYSTEM_PROMPT).not.toContain('"auth-service"');
    expect(EXTRACT_SYSTEM_PROMPT).not.toContain('"ptah"');
  });

  it('defines stable topic subjects and forbids ids, branches and dates in them', () => {
    expect(EXTRACT_SYSTEM_PROMPT).toContain('\nSUBJECTS\n');
    expect(flat).toContain('Lowercase kebab-case, 2 to 5 words');
    expect(flat).toContain('"sqlite-migration-conventions"');
    expect(flat).toContain(
      'Never a bare repository, product, app or service name',
    );
    expect(flat).toContain(
      'Never a task id, ticket, PR or batch number, branch or worktree name, date or commit hash.',
    );
  });

  it('tells the model to search existing memories and reuse their subject key exactly', () => {
    expect(EXTRACT_SYSTEM_PROMPT).toContain('mcp__ptah__ptah_memory_search');
    expect(flat).toContain('reuse its subject key EXACTLY');
    expect(flat).toContain('never invent a variant spelling');
    expect(flat).toContain(
      'search before choosing a subject; reuse the exact subject key of the best-matching existing memory; do not re-extract what is already remembered.',
    );
  });

  it('names the three DO NOT EXTRACT classes and the lesson carve-out', () => {
    expect(flat).toContain(
      'DO NOT EXTRACT (return fewer memories, or an empty "memories" array)',
    );
    expect(flat).toContain('1. Transient events:');
    expect(flat).toContain('2. Task, worktree or branch chatter:');
    expect(flat).toContain(
      '3. Restatements of rules already stored in the repository:',
    );
    expect(flat).toContain('The file is the source of truth.');
    expect(flat).toContain(
      'If such a passage contains a real lesson or root cause, extract only that lesson under its topic subject, without the task id, PR number, commit hash or date.',
    );
    expect(flat).toContain(
      'Skip transient chit-chat, code that is already in the repo, and anything private to a single message.',
    );
  });

  it('describes an event as a lasting change, never a status report', () => {
    expect(flat).toContain('Never a status report.');
    expect(EXTRACT_SYSTEM_PROMPT).not.toContain('migrated DB on');
  });

  it('keeps the final-message JSON rule', () => {
    expect(flat).toContain(
      'After the last tool result, your FINAL message must contain ONLY the JSON object. A tool call is never the end of your work — the JSON is.',
    );
    expect(EXTRACT_SYSTEM_PROMPT.endsWith('the JSON is.')).toBe(true);
  });
});

describe('buildExtractUserPrompt', () => {
  it('is unchanged: wraps the transcript and restates the JSON-only rule', () => {
    expect(buildExtractUserPrompt('hello')).toBe(
      'Transcript:\n"""\nhello\n"""\n\nReturn ONLY the JSON object as your final message.',
    );
  });
});
