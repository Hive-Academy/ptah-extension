import {
  RESOLVE_SYSTEM_PROMPT,
  buildResolveUserPrompt,
} from './resolve-prompt';

/**
 * The JSON block exactly as it stood at base `ebfc73321`. `resolve.schema.ts`
 * parses these fields, so the prompt rewrite (TASK_2026_563 M3, decision D3)
 * must leave it byte-identical.
 */
const BASE_JSON_BLOCK = `{
  "memories": [
    { "kind": "fact" | "preference" | "event" | "entity",
      "subject": string | null,
      "content": string,
      "salienceHint": number,
      "request": string | null,
      "investigated": string | null,
      "learned": string | null,
      "completed": string | null,
      "nextSteps": string | null,
      "type": "bugfix" | "feature" | "decision" | "discovery" | "refactor" | "change",
      "concepts": string[],   /* up to 5 short tags */
      "files": string[],
      "mergeTargetId": string | null /* id of the existing memory it refines, or null */
    }
  ]
}`;

/** The prompt with every run of whitespace collapsed, so wrapping never matters. */
const flat = RESOLVE_SYSTEM_PROMPT.replace(/\s+/g, ' ');

function jsonBlock(prompt: string): string {
  const start = prompt.indexOf('{\n  "memories"');
  const end = prompt.indexOf('\n}', start);
  return prompt.slice(start, end + 2);
}

describe('RESOLVE_SYSTEM_PROMPT', () => {
  it('keeps the JSON block byte-identical to the base', () => {
    expect(jsonBlock(RESOLVE_SYSTEM_PROMPT)).toBe(BASE_JSON_BLOCK);
  });

  it('no longer merges on a case-insensitive subject match', () => {
    expect(flat).not.toContain('subjects match (case-insensitive)');
  });

  it('merges a candidate that states the same thing under a differently worded subject', () => {
    expect(flat).toContain(
      'Set mergeTargetId to the id of an Existing memory when the candidate states the same fact, decision or preference about the same topic, even when the subjects are worded differently',
    );
    expect(flat).toContain(
      'Two different facts that only share a topic are not a merge.',
    );
    expect(flat).toContain('If unsure, set null.');
  });

  it('only allows ids from the Existing list as merge targets', () => {
    expect(flat).toContain(
      'Use only an id that appears in the Existing list; any other id is ignored and the candidate is stored as new.',
    );
    expect(flat).toContain(
      'only memories in the Existing list can be merge targets',
    );
    expect(flat).not.toContain('surface the memory a candidate really refines');
  });

  it('keeps the tool line and the final-message JSON rule', () => {
    expect(RESOLVE_SYSTEM_PROMPT).toContain('mcp__ptah__ptah_memory_search');
    expect(flat).toContain(
      'After the last tool result, your FINAL message must contain ONLY the JSON object.',
    );
  });
});

describe('buildResolveUserPrompt', () => {
  it('is unchanged: lists candidates and existing memories as JSON', () => {
    const drafts = [
      { kind: 'fact', subject: 'a', content: 'b', salienceHint: 0.5 },
    ];
    const related = [{ id: 'm1', subject: 'a', content: 'c' }];
    expect(buildResolveUserPrompt(drafts, related)).toBe(
      `Candidates:\n${JSON.stringify(drafts, null, 2)}\n\nExisting:\n${JSON.stringify(related, null, 2)}\n\nReturn ONLY the JSON object as your final message.`,
    );
  });
});
