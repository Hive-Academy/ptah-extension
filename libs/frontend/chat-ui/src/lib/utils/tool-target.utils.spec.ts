import {
  describeToolTarget,
  displayToolName,
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
      expect(describeToolTarget(toolName, input)).toEqual({
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
