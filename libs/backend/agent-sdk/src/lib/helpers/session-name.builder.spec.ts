import { buildSessionName, deriveWorkspaceLabel } from './session-name.builder';

describe('deriveWorkspaceLabel', () => {
  it.each([
    ['D:\\projects\\ptah-extension', 'ptah-extension'],
    ['D:\\projects\\ptah-extension\\', 'ptah-extension'],
    ['/home/me/projects/my-app', 'my-app'],
    ['my-app', 'my-app'],
  ])('reduces %s to its last segment', (input, expected) => {
    expect(deriveWorkspaceLabel(input)).toBe(expected);
  });

  it.each([
    ['undefined', undefined],
    ['empty', ''],
    ['separators only', '///'],
  ])('returns undefined for %s', (_label, input) => {
    expect(deriveWorkspaceLabel(input)).toBeUndefined();
  });
});

describe('buildSessionName', () => {
  it('composes prefix, workspace, role, task and suffix in order', () => {
    expect(
      buildSessionName({
        role: 'chat',
        taskId: 'TASK_2026_402',
        workspaceLabel: 'ptah-extension',
        uniqueSuffix: 'a5c7f1',
      }),
    ).toBe('ptah-ptah-extension-chat-task-2026-402-a5c7f1');
  });

  it('omits the task segment when there is no task', () => {
    expect(
      buildSessionName({
        role: 'chat',
        workspaceLabel: 'my-app',
        uniqueSuffix: 'abc123',
      }),
    ).toBe('ptah-my-app-chat-abc123');
  });

  it('omits the workspace segment when there is no label', () => {
    expect(buildSessionName({ role: 'chat', uniqueSuffix: 'abc123' })).toBe(
      'ptah-chat-abc123',
    );
  });

  it('lower-cases and collapses everything outside [a-z0-9-]', () => {
    expect(
      buildSessionName({
        role: 'Code   Reviewer!!',
        workspaceLabel: 'C:\\Projects\\My App',
        uniqueSuffix: '9F2B10',
      }),
    ).toBe('ptah-c-projects-my-app-code-reviewer-9f2b10');
  });

  it('never emits leading, trailing or doubled dashes', () => {
    const name = buildSessionName({
      role: '  --role--  ',
      workspaceLabel: '///',
      uniqueSuffix: '--abc--',
    });

    expect(name).toBe('ptah-role-abc');
    expect(name).not.toMatch(/--|^-|-$/);
  });

  it('caps the length and keeps the uniqueness suffix intact', () => {
    const name = buildSessionName({
      role: 'r'.repeat(120),
      workspaceLabel: 'w'.repeat(120),
      uniqueSuffix: 'abc123',
    });

    expect(name).toBeDefined();
    expect((name as string).length).toBeLessThanOrEqual(64);
    // Truncating the tail would trade a long name for a colliding one.
    expect(name as string).toMatch(/-abc123$/);
  });

  it.each([
    ['empty role', { role: '', uniqueSuffix: 'abc123' }],
    ['punctuation-only role', { role: '***', uniqueSuffix: 'abc123' }],
    ['empty suffix', { role: 'chat', uniqueSuffix: '' }],
    ['punctuation-only suffix', { role: 'chat', uniqueSuffix: '///' }],
  ])('returns undefined for %s rather than throwing', (_label, input) => {
    expect(buildSessionName(input)).toBeUndefined();
  });

  it('gives two sessions in one workspace different names', () => {
    const shared = { role: 'chat', workspaceLabel: 'ptah' };

    expect(buildSessionName({ ...shared, uniqueSuffix: '111111' })).not.toBe(
      buildSessionName({ ...shared, uniqueSuffix: '222222' }),
    );
  });
});
