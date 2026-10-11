/**
 * Session handoff builder (TASK_2026_597 N8): each fact, each cap, the total
 * cap and seed, an empty transcript, no summary, and a rebuild after a
 * restart from the fixture transcript.
 */

import 'reflect-metadata';
import * as path from 'node:path';
import type { Logger } from '@ptah-extension/vscode-core';
import type { SessionBudgetState } from '@ptah-extension/shared';
import {
  createMockLogger,
  type MockLogger,
} from '@ptah-extension/shared/testing';
import { JsonlReaderService } from '../history/jsonl-reader.service';
import type {
  ContentBlock,
  SessionHistoryMessage,
} from '../history/history.types';
import {
  SESSION_HANDOFF_LIMITS,
  SESSION_HANDOFF_TAIL_BYTES,
  SessionHandoffBuilder,
  TRUNCATED_MARKER,
  assembleSessionHandoff,
  extractSessionHandoffFacts,
  sanitizeHandoffPath,
  sanitizeHandoffText,
} from './session-handoff-builder';

const SESSION_ID = '11111111-2222-4333-8444-555555555555';
const FIXTURES = path.join(__dirname, '__fixtures__');
const BUILT_AT = Date.UTC(2026, 9, 4, 12, 0, 0);

function user(
  content: string | readonly ContentBlock[],
  extra: Partial<SessionHistoryMessage> = {},
): SessionHistoryMessage {
  return { type: 'user', message: { role: 'user', content }, ...extra };
}

function assistantText(text: string): SessionHistoryMessage {
  return {
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'text', text }] },
  };
}

function toolUse(
  name: string,
  input: Record<string, unknown>,
): SessionHistoryMessage {
  return {
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [{ type: 'tool_use', id: `t-${name}`, name, input }],
    },
  };
}

const boundary: SessionHistoryMessage = {
  type: 'system',
  subtype: 'compact_boundary',
};

function todos(
  ...items: [content: string, status: string][]
): SessionHistoryMessage {
  return toolUse('TodoWrite', {
    todos: items.map(([content, status]) => ({
      content,
      status,
      activeForm: content,
    })),
  });
}

const meta = { sessionId: SESSION_ID, builtAt: BUILT_AT };

describe('extractSessionHandoffFacts', () => {
  it('ignores changed files, todos and assistant text at or before the compact boundary', () => {
    const facts = extractSessionHandoffFacts([
      toolUse('Edit', { file_path: 'before.ts' }),
      assistantText('before action'),
      todos(['before todo', 'pending']),
      boundary,
      toolUse('Edit', { file_path: 'after.ts' }),
      assistantText('after action'),
      todos(['after todo', 'pending']),
    ]);
    expect(facts.changedFiles).toEqual(['after.ts']);
    expect(facts.openItems).toEqual([{ content: 'after todo', status: 'pending' }]);
    expect(facts.nextAction).toEqual({ source: 'pending', text: 'after todo' });
  });
  it('uses the first user text after the latest compact boundary as the summary', () => {
    const facts = extractSessionHandoffFacts([
      user('first prompt'),
      boundary,
      user('old summary'),
      boundary,
      user('latest summary'),
      user('later prompt'),
    ]);
    expect(facts.summary).toBe('latest summary');
    expect(facts.firstPrompt).toBe('first prompt');
  });

  it('has no summary without a compact boundary', () => {
    const facts = extractSessionHandoffFacts([user('only prompt')]);
    expect(facts.summary).toBeNull();
    expect(facts.firstPrompt).toBe('only prompt');
  });

  it('skips meta, synthetic and tool-result-only user lines for the first prompt', () => {
    const facts = extractSessionHandoffFacts([
      user('caveat', { isMeta: true }),
      user('synthetic', { isSynthetic: true }),
      user([{ type: 'tool_result', tool_use_id: 'x', content: 'out' }]),
      user([{ type: 'text', text: 'real prompt' }]),
    ]);
    expect(facts.firstPrompt).toBe('real prompt');
  });

  it('collects unique Edit/Write/MultiEdit/NotebookEdit paths in first-change order', () => {
    const facts = extractSessionHandoffFacts([
      toolUse('Write', { file_path: 'a.ts' }),
      toolUse('Edit', { file_path: 'b.ts' }),
      toolUse('MultiEdit', { file_path: 'a.ts' }),
      toolUse('NotebookEdit', { notebook_path: 'n.ipynb' }),
      toolUse('Read', { file_path: 'read-only.ts' }),
      toolUse('Edit', { file_path: 42 }),
    ]);
    expect(facts.changedFiles).toEqual(['a.ts', 'b.ts', 'n.ipynb']);
  });

  it('keeps the not-completed items of the latest TodoWrite only', () => {
    const facts = extractSessionHandoffFacts([
      todos(['old', 'pending']),
      todos(
        ['done', 'completed'],
        ['doing', 'in_progress'],
        ['next', 'pending'],
      ),
    ]);
    expect(facts.openItems).toEqual([
      { content: 'doing', status: 'in_progress' },
      { content: 'next', status: 'pending' },
    ]);
  });

  it('ignores a malformed TodoWrite and malformed items', () => {
    const facts = extractSessionHandoffFacts([
      todos(['kept', 'pending']),
      toolUse('TodoWrite', { todos: 'not a list' }),
      toolUse('TodoWrite', {
        todos: [
          null,
          { content: 7, status: 'pending' },
          { content: 'ok', status: 'weird' },
          { content: 'valid', status: 'pending' },
        ],
      }),
    ]);
    expect(facts.openItems).toEqual([{ content: 'valid', status: 'pending' }]);
  });

  it('picks the next action: in-progress, else pending, else the last assistant text', () => {
    expect(
      extractSessionHandoffFacts([
        assistantText('said'),
        todos(['p', 'pending'], ['ip', 'in_progress']),
      ]).nextAction,
    ).toEqual({ source: 'in-progress', text: 'ip' });
    expect(
      extractSessionHandoffFacts([
        assistantText('said'),
        todos(['p', 'pending'], ['c', 'completed']),
      ]).nextAction,
    ).toEqual({ source: 'pending', text: 'p' });
    expect(
      extractSessionHandoffFacts([
        assistantText('first'),
        assistantText('last'),
        todos(['c', 'completed']),
      ]).nextAction,
    ).toEqual({ source: 'assistant', text: 'last' });
    expect(extractSessionHandoffFacts([]).nextAction).toBeNull();
  });

  it('finds task folders in text and tool inputs, either separator, unique', () => {
    const facts = extractSessionHandoffFacts([
      user('see .ptah/specs/TASK_2026_597_ab22/plan.md'),
      toolUse('Read', {
        file_path: 'D:\\repo\\.ptah\\specs\\TASK_2026_600\\task.md',
      }),
      assistantText('again .ptah/specs/TASK_2026_597_ab22'),
      assistantText('not a task: .ptah/specs/TASK_26_1'),
    ]);
    expect(facts.taskFolders).toEqual([
      '.ptah/specs/TASK_2026_597_ab22',
      '.ptah/specs/TASK_2026_600',
    ]);
  });
});

describe('sanitizers', () => {
  it('keeps newlines and tabs in text but drops other control characters', () => {
    expect(sanitizeHandoffText('a\r\nb\u0000c\u001b[31m\td\u0085')).toBe(
      'a\nbc[31m\td',
    );
  });

  it('makes a path one line with no backticks', () => {
    expect(sanitizeHandoffPath(' a`b\nc\u0007.ts ')).toBe("a'bc.ts");
  });
});

describe('assembleSessionHandoff', () => {
  it('renders the fixed sections in order', () => {
    const doc = assembleSessionHandoff([user('goal')], meta);
    const headings = doc.content
      .split('\n')
      .filter((line) => line.startsWith('#'));
    expect(headings).toEqual([
      '# Session handoff',
      '## Session',
      '## Goal',
      '## Decisions and current state',
      '## Changed files',
      '## Open items',
      '## Next action',
      '## How to continue',
    ]);
    expect(doc.content).toContain(`- Session: \`${SESSION_ID}\``);
    expect(doc.content).toContain('- Built: 2026-10-04T12:00:00.000Z');
    expect(doc.content).toContain('- Budget: not recorded');
    expect(doc.truncated).toBe(false);
    expect(doc.chars).toBe(doc.content.length);
    expect(doc.builtAt).toBe(BUILT_AT);
  });

  it('builds a complete document from an empty transcript', () => {
    const doc = assembleSessionHandoff([], meta);
    expect(doc.content).toContain('No user prompt found in the transcript.');
    expect(doc.content).toContain('No compaction summary in the transcript.');
    expect(doc.content).toContain(
      '- Task folders: none found in the transcript',
    );
    expect(doc.content).toContain('## Changed files\n\nNone recorded.');
    expect(doc.content).toContain('## Open items\n\nNone recorded.');
    expect(doc.content).toContain('## Next action\n\nNot recorded.');
    expect(doc.truncated).toBe(false);
  });

  it('uses the first prompt as the goal when there is no summary', () => {
    const doc = assembleSessionHandoff([user('build the budget')], meta);
    expect(doc.content).toContain('## Goal\n\n> build the budget');
    expect(doc.content).toContain('No compaction summary in the transcript.');
  });

  it('uses the summary for goal and state when one exists', () => {
    const doc = assembleSessionHandoff(
      [user('first'), boundary, user('the summary')],
      meta,
    );
    expect(doc.content).toContain(
      '## Decisions and current state\n\n> the summary',
    );
    expect(doc.content).not.toContain('> first');
  });

  it('renders transcript text as a block quote so it cannot open a section', () => {
    const doc = assembleSessionHandoff(
      [user('line one\n## Injected heading\n# Another')],
      meta,
    );
    expect(doc.content).toContain(
      '> line one\n> ## Injected heading\n> # Another',
    );
    expect(doc.content.split('\n')).not.toContain('## Injected heading');
  });

  it('caps the summary at 2,500 characters with a marker', () => {
    const doc = assembleSessionHandoff(
      [boundary, user('s'.repeat(3_000))],
      meta,
    );
    const quoted =
      /## Decisions and current state\n\n> (s+ \[truncated\])/.exec(
        doc.content,
      );
    expect(quoted?.[1].length).toBe(SESSION_HANDOFF_LIMITS.summaryChars);
    expect(doc.truncated).toBe(true);
  });

  it('caps the first prompt at 1,000 characters with a marker', () => {
    const doc = assembleSessionHandoff([user('p'.repeat(1_200))], meta);
    const quoted = /## Goal\n\n> (p+ \[truncated\])/.exec(doc.content);
    expect(quoted?.[1].length).toBe(SESSION_HANDOFF_LIMITS.firstPromptChars);
    expect(doc.truncated).toBe(true);
  });

  it('lists 50 changed files then "+N more"', () => {
    const lines = Array.from({ length: 53 }, (_, i) =>
      toolUse('Edit', { file_path: `f${i}.ts` }),
    );
    const doc = assembleSessionHandoff(lines, meta);
    expect(doc.content).toContain('- `f49.ts`\n- +3 more');
    expect(doc.content).not.toContain('`f50.ts`');
    expect(doc.truncated).toBe(true);
  });

  it('lists exactly 50 changed files without "+N more"', () => {
    const lines = Array.from({ length: 50 }, (_, i) =>
      toolUse('Edit', { file_path: `f${i}.ts` }),
    );
    const doc = assembleSessionHandoff(lines, meta);
    expect(doc.content).toContain('- `f49.ts`');
    expect(doc.content).not.toContain('more');
  });

  it('lists 20 open items then "+N more"', () => {
    const items = Array.from(
      { length: 22 },
      (_, i) => [`item ${i}`, 'pending'] as [string, string],
    );
    const doc = assembleSessionHandoff([todos(...items)], meta);
    expect(doc.content).toContain('- [pending] item 19\n- +2 more');
    expect(doc.content).not.toContain('item 20');
    expect(doc.truncated).toBe(true);
  });

  it('caps the next action at 800 characters', () => {
    const doc = assembleSessionHandoff([assistantText('n'.repeat(900))], meta);
    const quoted =
      /From the last assistant message:\n\n> (n+ \[truncated\])/.exec(
        doc.content,
      );
    expect(quoted?.[1].length).toBe(SESSION_HANDOFF_LIMITS.nextActionChars);
  });

  it('lists at most 5 task folders', () => {
    const text = Array.from(
      { length: 7 },
      (_, i) => `.ptah/specs/TASK_2026_00${i}`,
    ).join(' ');
    const doc = assembleSessionHandoff([user(text)], meta);
    expect(doc.content).toContain('`.ptah/specs/TASK_2026_004`');
    expect(doc.content).not.toContain('TASK_2026_005`');
    expect(doc.truncated).toBe(true);
  });

  it('holds the total at 8,000 characters and always keeps "How to continue"', () => {
    const lines = [
      boundary,
      user('s'.repeat(5_000)),
      ...Array.from({ length: 60 }, (_, i) =>
        toolUse('Edit', { file_path: `${'d/'.repeat(100)}file-${i}.ts` }),
      ),
      todos(
        ...Array.from(
          { length: 25 },
          (_, i) => [`${'t'.repeat(400)} ${i}`, 'pending'] as [string, string],
        ),
      ),
    ];
    const doc = assembleSessionHandoff(lines, meta);
    expect(doc.content.length).toBeLessThanOrEqual(
      SESSION_HANDOFF_LIMITS.totalChars,
    );
    expect(doc.content).toContain(`${TRUNCATED_MARKER}\n\n## How to continue`);
    expect(doc.content.endsWith('then work through the open items.\n')).toBe(
      true,
    );
    expect(doc.truncated).toBe(true);
    expect(doc.seed.length).toBeLessThanOrEqual(
      SESSION_HANDOFF_LIMITS.seedChars,
    );
    expect(doc.seed.endsWith(doc.content)).toBe(true);
  });

  it('builds a seed of preamble plus the whole document', () => {
    const doc = assembleSessionHandoff([user('goal')], meta);
    expect(
      doc.seed.startsWith('Continue the work of an earlier session.'),
    ).toBe(true);
    expect(doc.seed.endsWith(doc.content)).toBe(true);
    expect(doc.seed.length - doc.content.length).toBeLessThanOrEqual(
      SESSION_HANDOFF_LIMITS.seedChars - SESSION_HANDOFF_LIMITS.totalChars,
    );
  });

  it('renders the budget line', () => {
    const budget: SessionBudgetState = {
      sessionId: SESSION_ID,
      stage: 'handoff',
      unit: 'tokens',
      measure: 'tokens',
      used: 41_234_567,
      limit: 50_000_000,
      percent: 82.469,
      lowerBound: false,
      revision: 7,
      compactions: 2,
      extensions: 0,
      blocked: false,
    };
    expect(assembleSessionHandoff([], { ...meta, budget }).content).toContain(
      '- Budget: stage handoff; 41,234,567 tokens of 50,000,000 tokens (82%); compactions 2',
    );
    expect(
      assembleSessionHandoff([], {
        ...meta,
        budget: {
          ...budget,
          unit: 'cost',
          measure: 'cost-lower-bound',
          used: 12.5,
          limit: 30,
          lowerBound: true,
          percent: 41.6,
        },
      }).content,
    ).toContain('- Budget: stage handoff; ≥ $12.50 of $30.00 (41%)');
  });

  it('is deterministic for the same lines and metadata', () => {
    const lines = [user('goal'), toolUse('Write', { file_path: 'a.ts' })];
    expect(assembleSessionHandoff(lines, meta)).toEqual(
      assembleSessionHandoff(lines, meta),
    );
  });
});

describe('SessionHandoffBuilder', () => {
  let logger: MockLogger;

  function makeBuilder(sessionsDir: string | null = FIXTURES): {
    builder: SessionHandoffBuilder;
    reader: JsonlReaderService;
  } {
    const reader = new JsonlReaderService(logger as unknown as Logger);
    jest.spyOn(reader, 'findSessionsDirectory').mockResolvedValue(sessionsDir);
    return {
      builder: new SessionHandoffBuilder(logger as unknown as Logger, reader),
      reader,
    };
  }

  beforeEach(() => {
    logger = createMockLogger();
  });

  it('prepends a bounded agent handoff supplement to the successor seed', async () => {
    const { builder } = makeBuilder();
    const result = await builder.build({
      sessionId: SESSION_ID,
      workspacePath: 'D:/work/repo',
      agentHandoff: 'agent context',
    });
    expect(result.document.seed.startsWith('Agent handoff supplement:\nagent context')).toBe(true);
  });

  it('skips an agent supplement when the seed has no room for its marker', async () => {
    const { builder, reader } = makeBuilder();
    jest.spyOn(reader, 'readJsonlTail').mockResolvedValue([
      boundary,
      user('s'.repeat(5_000)),
      ...Array.from({ length: 60 }, (_, i) =>
        toolUse('Edit', { file_path: `${'d/'.repeat(100)}file-${i}.ts` }),
      ),
      todos(
        ...Array.from(
          { length: 25 },
          (_, i) => [`${'t'.repeat(400)} ${i}`, 'pending'] as [string, string],
        ),
      ),
    ]);

    const result = await builder.build({
      sessionId: SESSION_ID,
      workspacePath: 'D:/work/repo',
      agentHandoff: 'agent context that must not overflow the seed',
    });

    expect(result.document.seed).not.toContain('Agent handoff supplement:');
    expect(result.document.seed.length).toBeLessThanOrEqual(SESSION_HANDOFF_LIMITS.seedChars);
  });

  it('reads the fixture transcript tail and renders every fact', async () => {
    const { builder, reader } = makeBuilder();
    const tail = jest.spyOn(reader, 'readJsonlTail');
    const result = await builder.build({
      sessionId: SESSION_ID,
      workspacePath: 'D:/work/repo',
      builtAt: BUILT_AT,
    });

    expect(result.readError).toBeUndefined();
    expect(tail).toHaveBeenCalledWith(
      path.join(FIXTURES, `${SESSION_ID}.jsonl`),
      { maxBytes: SESSION_HANDOFF_TAIL_BYTES },
    );
    const { content } = result.document;
    expect(content).toContain('`.ptah/specs/TASK_2026_597_ab22`');
    expect(content).toContain(
      '> This session is being continued from a previous conversation.',
    );
    expect(content).toContain(
      '- `libs/backend/agent-sdk/src/lib/helpers/session-budget/session-budget-config.provider.ts`\n' +
        '- `libs/shared/src/lib/types/session-budget.types.ts`\n' +
        '- `notebooks/budget.ipynb`',
    );
    expect(content).toContain(
      '- [in progress] Write the provider\n- [pending] Spec the provider',
    );
    expect(content).toContain(
      'From the in-progress todo:\n\n> Write the provider',
    );
  });

  it('builds the same handoff after a restart (facts come only from the file)', async () => {
    const first = await makeBuilder().builder.build({
      sessionId: SESSION_ID,
      workspacePath: 'D:/work/repo',
      builtAt: BUILT_AT,
    });
    const afterRestart = await makeBuilder().builder.build({
      sessionId: SESSION_ID,
      workspacePath: 'D:/work/repo',
      builtAt: BUILT_AT,
    });
    expect(afterRestart).toEqual(first);
  });

  it('rejects a non-UUID id without touching the file system', async () => {
    const { builder, reader } = makeBuilder();
    const find = jest.spyOn(reader, 'findSessionsDirectory');
    const result = await builder.build({
      sessionId: '../../etc/passwd',
      workspacePath: 'D:/work/repo',
      builtAt: BUILT_AT,
    });
    expect(result.readError).toBe('invalid session id');
    expect(find).not.toHaveBeenCalled();
    expect(result.document.content).toContain('## How to continue');
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('passwd');
  });

  it('builds from no lines when the transcript is missing, warning once', async () => {
    const { builder } = makeBuilder();
    const request = {
      sessionId: 'aaaaaaaa-bbbb-4ccc-8ddd-000000000001',
      workspacePath: 'D:/work/repo',
      builtAt: BUILT_AT,
    };
    const first = await builder.build(request);
    await builder.build(request);
    expect(first.readError).toBe('transcript not found');
    expect(first.document.content).toContain('No user prompt found');
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('reports a missing sessions directory', async () => {
    const { builder } = makeBuilder(null);
    const result = await builder.build({
      sessionId: SESSION_ID,
      workspacePath: 'D:/nowhere',
      builtAt: BUILT_AT,
    });
    expect(result.readError).toBe('transcript directory not found');
  });
});
