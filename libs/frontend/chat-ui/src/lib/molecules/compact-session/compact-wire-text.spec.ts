import { shortenRowText } from './compact-wire-text';

describe(shortenRowText.name, () => {
  it('keeps the leading verb while shortening a deep path token', () => {
    const row =
      'Reading .claude-worktrees/feat-task-494-apps-page-98c5a1802772/libs/backend/vscode-core/src/lib/logger.ts';

    expect(shortenRowText(row, 120)).toBe('Reading …/lib/logger.ts');
  });

  it('shortens a deep path even when the text fits the length budget', () => {
    expect(shortenRowText('Edit libs/frontend/chat-ui/logger.ts', 120)).toBe(
      'Edit …/chat-ui/logger.ts',
    );
  });

  it('shortens Windows backslash paths the same way', () => {
    expect(
      shortenRowText(
        'Read D:\\projects\\ptah-extension\\libs\\frontend\\logger.ts',
        120,
      ),
    ).toBe('Read …\\frontend\\logger.ts');
  });

  it('leaves a two-segment path untouched', () => {
    expect(shortenRowText('Read libs/logger.ts', 100)).toBe(
      'Read libs/logger.ts',
    );
  });

  it('leaves URLs untouched', () => {
    expect(
      shortenRowText('Fetch https://example.com/a/b/c for details', 100),
    ).toBe('Fetch https://example.com/a/b/c for details');
  });

  it('shortens several path tokens independently and keeps the words between them', () => {
    expect(
      shortenRowText('Diff libs/a/b/old.ts against libs/x/y/new.ts', 100),
    ).toBe('Diff …/b/old.ts against …/y/new.ts');
  });

  it('cuts non-path text from the right when it overflows the budget', () => {
    expect(shortenRowText('Turn completed and settled', 15)).toBe(
      'Turn completed…',
    );
  });

  it('applies the length cap after path shortening', () => {
    const row = 'Turn finished ' + 'a/'.repeat(60) + 'result.log';
    const result = shortenRowText(row, 20);

    expect(result.length).toBeLessThanOrEqual(20);
    expect(result.startsWith('Turn finished')).toBe(true);
    expect(result.endsWith('…')).toBe(true);
  });

  it('returns empty text for a non-positive budget', () => {
    expect(shortenRowText('anything', 0)).toBe('');
  });
});
