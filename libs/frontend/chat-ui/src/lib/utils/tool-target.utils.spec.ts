import {
  countLines,
  describeToolChips,
  describeToolTarget,
  formatTimeout,
  splitMcpToolName,
  displayToolName,
  isJustToolName,
  isPtahMcpToolName,
  shortenToolPath,
  toolStatusBadgeClass,
  truncateToolText,
} from './tool-target.utils';

describe('tool-target.utils', () => {
  describe('describeToolTarget', () => {
    it.each([
      [
        'Read',
        { file_path: 'D:\\repo\\src\\app\\main.ts' },
        '.../app/main.ts',
        'D:\\repo\\src\\app\\main.ts',
        true,
      ],
      [
        'Write',
        { file_path: '/repo/src/lib/a.ts', content: 'x' },
        '.../lib/a.ts',
        '/repo/src/lib/a.ts',
        true,
      ],
      [
        'Edit',
        { file_path: 'src/a.ts', old_string: 'a', new_string: 'b' },
        'src/a.ts',
        'src/a.ts',
        true,
      ],
      ['Read', { file_path: 'a.ts' }, 'a.ts', 'a.ts', true],
      ['Read', { file_path: '' }, '...', '', true],
      [
        'WebFetch',
        { url: 'https://example.com/docs?q=1', prompt: 'Summarise' },
        'example.com/docs',
        'https://example.com/docs?q=1',
        false,
      ],
      ['WebSearch', { query: 'angular signals' }, 'angular signals', 'angular signals', false],
      [
        'Agent',
        { description: 'Review the diff', prompt: 'p', subagent_type: 'x' },
        'Review the diff',
        'Review the diff',
        false,
      ],
      [
        'Bash',
        { command: 'npm test', description: 'Run the tests' },
        'Run the tests',
        'npm test',
        false,
      ],
      [
        'Bash',
        { command: 'x'.repeat(50) },
        'x'.repeat(40) + '...',
        'x'.repeat(50),
        false,
      ],
      ['Bash', { command: '' }, '...', '', false],
      [
        'Grep',
        { pattern: 'p'.repeat(35) },
        'p'.repeat(30) + '...',
        'p'.repeat(35),
        false,
      ],
      ['Glob', { pattern: '**/*.ts' }, '**/*.ts', '**/*.ts', false],
      [
        'mcp__ptah__ptah_search_files',
        { __summary: 'Search for tests' },
        'Search for tests',
        'Search for tests',
        false,
      ],
      ['Custom', { __summary: '' }, 'Custom', '', false],
      ['MysteryTool', { path: '/secret/a.txt' }, 'MysteryTool', '', false],
      ['MysteryTool', undefined, 'MysteryTool', '', false],
    ] as const)('%s %j -> short %s', (toolName, input, short, full, isPath) => {
      expect(describeToolTarget(toolName, input)).toMatchObject({
        short,
        full,
        // Untruncated: the Bash description wins, else the full target.
        text:
          toolName === 'Bash' && input && 'description' in input
            ? input.description
            : full,
        isPath,
      });
    });

    // The Input section leaves out exactly these keys (shown by the header).
    it.each([
      ['Read', { file_path: '/a.ts' }, ['file_path']],
      ['Write', { file_path: '/a.ts', content: 'x' }, ['file_path']],
      ['Bash', { command: 'ls', timeout: 5 }, ['command', 'description']],
      ['PowerShell', { command: 'dir', description: 'List' }, ['command', 'description']],
      ['Grep', { pattern: 'x', path: 'src' }, ['pattern']],
      ['Glob', { pattern: '*.ts' }, ['pattern']],
      ['WebFetch', { url: 'https://a.b', prompt: 'p' }, ['url']],
      ['WebSearch', { query: 'q' }, ['query']],
      ['Task', { description: 'd', prompt: 'p' }, ['description']],
      ['Agent', { description: 'd', prompt: 'p' }, ['description']],
      ['mcp__x__tool', { __summary: 's', other: 1 }, ['__summary']],
      ['Custom', { description: 'not an agent' }, []],
      ['MysteryTool', undefined, []],
    ] as const)('%s %j shows keys %j', (toolName, input, keys) => {
      expect(describeToolTarget(toolName, input).keys).toEqual(keys);
    });
  });

  describe('describeToolTarget: TodoWrite', () => {
    it('summarises the todo list as "n of m done"', () => {
      const target = describeToolTarget('TodoWrite', {
        todos: [
          { content: 'a', status: 'completed', activeForm: 'A' },
          { content: 'b', status: 'in_progress', activeForm: 'B' },
          { content: 'c', status: 'pending', activeForm: 'C' },
        ],
      });

      expect(target).toMatchObject({ short: '1 of 3 done', keys: ['todos'] });
    });
  });

  describe('describeToolChips', () => {
    it.each([
      [
        'Bash',
        { command: 'ls', run_in_background: true, timeout: 3_600_000 },
        ['background', '60 min'],
        ['run_in_background', 'timeout'],
      ],
      ['Bash', { command: 'ls', run_in_background: false }, [], ['run_in_background']],
      ['Read', { file_path: '/a.ts', offset: 1, limit: 60 }, ['lines 1-60'], ['offset', 'limit']],
      ['Read', { file_path: '/a.ts', offset: 40 }, ['from line 40'], ['offset']],
      ['Write', { file_path: '/a.ts', content: 'a\nb\n' }, ['2 lines'], []],
      [
        'Grep',
        { pattern: 'x', path: 'src/', glob: '*.ts', '-i': true },
        ['in src/', '*.ts', '-i'],
        ['path', 'glob', '-i'],
      ],
      [
        'Agent',
        { description: 'd', prompt: 'p', subagent_type: 'frontend-developer' },
        ['frontend-developer'],
        ['subagent_type'],
      ],
      ['mcp__x__tool', { name: 'n'.repeat(50), id: 'abc' }, [], []],
      ['MysteryTool', undefined, [], []],
    ] as const)('%s %j -> chips %j', (toolName, input, chips, keys) => {
      expect(describeToolChips(toolName, input)).toEqual({ chips, keys });
    });

    it('consumes __parseError, which the header warning shows', () => {
      expect(describeToolChips('Bash', { __parseError: 'bad' }).keys).toEqual([
        '__parseError',
      ]);
    });
  });

  describe('splitMcpToolName', () => {
    it.each([
      ['mcp__orchestrator__ListAgents', { server: 'orchestrator', tool: 'ListAgents' }],
      ['mcp__a__b__c', { server: 'a', tool: 'b__c' }],
      ['mcp_____x', { server: '_', tool: 'x' }],
      ['mcp__server__', null],
      ['mcp__server', null],
      ['mcp__a__b\nc', null],
      ['mcp__a\r\n__b', null],
      ['mcp__a__b\u2028c', null],
      ['mcp__ptah__workspace_analyze', null],
      ['ptah-ptah_search_files', null],
      ['Bash', null],
    ] as const)('%s -> %j', (toolName, expected) => {
      expect(splitMcpToolName(toolName)).toEqual(expected);
    });
  });

  describe('formatTimeout and countLines', () => {
    it.each([
      [3_600_000, '60 min'],
      [90_000, '90 s'],
      [500, '500 ms'],
    ])('formats %d ms as %s', (ms, text) => {
      expect(formatTimeout(ms)).toBe(text);
    });

    it.each([
      ['', 0],
      ['a', 1],
      ['a\n', 1],
      ['a\r\nb\rc\nd', 4],
    ])('counts %j as %d lines', (text, lines) => {
      expect(countLines(text)).toBe(lines);
    });
  });

  describe('isJustToolName', () => {
    it.each([
      ['ListAgents', 'ListAgents', true],
      ['listagents', 'ListAgents', true],
      ['', 'ListAgents', true],
      ['workspace analyze', 'mcp__ptah__workspace_analyze', true],
      ['ListAgents', 'mcp__orchestrator__ListAgents', true],
      ['List the agents', 'ListAgents', false],
      ['Run the tests', 'Bash', false],
    ] as const)('%j for %s -> %s', (label, toolName, expected) => {
      expect(isJustToolName(label, toolName)).toBe(expected);
    });
  });

  it.each([
    ['mcp__ptah__workspace_analyze', true, 'workspace analyze'],
    ['ptah-ptah_search_files', true, 'search files'],
    ['mcp__other__tool', false, 'mcp__other__tool'],
    ['Bash', false, 'Bash'],
  ])('names %s (ptah=%s) as %s', (toolName, ptah, display) => {
    expect(isPtahMcpToolName(toolName)).toBe(ptah);
    expect(displayToolName(toolName)).toBe(display);
  });

  it.each([
    ['complete', 'badge-success'],
    ['streaming', 'badge-info'],
    ['error', 'badge-error'],
    ['pending', 'badge-ghost'],
    ['interrupted', 'badge-ghost'],
  ] as const)('maps status %s to %s', (status, badge) => {
    expect(toolStatusBadgeClass(status)).toBe(badge);
  });

  it('shortens paths and truncates text totally', () => {
    expect(shortenToolPath(undefined)).toBe('');
    expect(shortenToolPath('a/b')).toBe('a/b');
    expect(shortenToolPath('a\\b\\c')).toBe('.../b/c');
    expect(truncateToolText(undefined, 5)).toBe('');
    expect(truncateToolText('abcdef', 5)).toBe('abcde...');
    expect(truncateToolText('abc', 5)).toBe('abc');
  });
});
