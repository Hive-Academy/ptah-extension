import type { ExecutionNode } from '@ptah-extension/shared';
import { extractMessageSummary, summarizeExecutionNodes } from './message-summary.utils';

describe('summarizeExecutionNodes', () => {
  it('counts only parent tools and files when agent children are absent', () => {
    const parent = text('parent');
    const task: ExecutionNode = {
      ...text('task'), type: 'tool', toolName: 'Task',
      toolInput: { description: 'Delegate' }, children: [],
    };
    const write: ExecutionNode = {
      ...text('write'), type: 'tool', toolName: 'Write',
      toolInput: { file_path: 'parent.ts' }, children: [],
    };
    expect(summarizeExecutionNodes([{ ...parent, children: [task, write] }]))
      .toEqual({ toolCount: 2, filesChanged: 1 });
  });
  it('counts nested tools and distinct file paths across roots', () => {
    const tool = (id: string, file: string): ExecutionNode => ({
      id, type: 'tool', status: 'complete', content: '', isCollapsed: false,
      toolInput: { file_path: file }, children: [],
    });
    expect(summarizeExecutionNodes([
      { ...text('root'), children: [tool('a', 'one.ts'), tool('b', 'one.ts')] },
      tool('c', 'two.ts'),
    ])).toEqual({ toolCount: 3, filesChanged: 2 });
    expect(summarizeExecutionNodes([])).toEqual({ toolCount: 0, filesChanged: 0 });
  });
});

function text(content: string): ExecutionNode {
  return {
    id: 'text',
    type: 'text',
    status: 'complete',
    content,
    isCollapsed: false,
    children: [],
  };
}

const display = (body: string): string =>
  '```ptah-ui display\n' + body + '\n```';

describe('extractMessageSummary', () => {
  it('keeps the default header when there is no text node', () => {
    expect(extractMessageSummary(null).title).toBe('Assistant response');
  });

  it.each([
    ['keeps plain prose', 'The recap   is\nready.', 'The recap is ready.'],
    ['strips inline-code delimiters from the collapsed title', 'Updated `sub` package.', 'Updated sub package.'],
    [
      'keeps prose before a display fence',
      'The recap is ready.\n' + display('title Recap\ngrid 2\n  card Changes'),
      'The recap is ready.',
    ],
    [
      'keeps prose after an inline ptah-ui fence',
      '```ptah-ui\ncard Changes\n```\nThe recap is ready.',
      'The recap is ready.',
    ],
    [
      'drops an unclosed display fence through the end of streamed text',
      'The recap is ready.\n```ptah-ui display\ntitle Recap\ngrid 2',
      'The recap is ready.',
    ],
    [
      'joins prose around a fence with one space',
      'Before\n' + display('title Recap') + '\nafter.',
      'Before after.',
    ],
    [
      'keeps a ptah-ui mention that is not a fence',
      'Use a ```ptah-ui block for recaps.',
      'Use a ```ptah-ui block for recaps.',
    ],
    [
      'keeps other fence languages',
      '```ptah-ui-other\ncard X\n```',
      '```ptah-ui-other card X ```',
    ],
    [
      'uses a display title when the fence is the entire text node',
      display('title Recap\ngrid 2\n  card Changes'),
      'Display: Recap',
    ],
    [
      'keeps grammar keywords inside the title',
      display('title Card table text chart\nstats\n  Files | 3'),
      'Display: Card table text chart',
    ],
    [
      'takes the title from the first of adjacent fences',
      display('title First\nnote info | a') +
        '\n' +
        display('title Second\nnote info | b'),
      'Display: First',
    ],
    [
      'ignores a title that is not the first body line',
      display('grid 2\n  card A\ntitle Late'),
      'Display',
    ],
    [
      'uses Display when an untitled fence is the entire text node',
      display('grid 2\n  card Changes'),
      'Display',
    ],
  ])('%s', (_description, content, expectedTitle) => {
    const summary = extractMessageSummary(text(content));

    expect(summary.title).toBe(expectedTitle);
    expect(summary.description).toBeNull();
  });
});
