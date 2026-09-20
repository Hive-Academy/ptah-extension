import {
  buildSessionName,
  buildUniqueSuffix,
  deriveWorkspaceLabel,
} from './session-name.builder';

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

describe('buildUniqueSuffix — allocation id', () => {
  const ROUTING = 'abcdef01-2345-6789-abcd-ef0123456789';
  const HEAD = 6;
  const PID_WIDTH = 7;
  const HOST_START_WIDTH = 8;
  const HOST_START_EPOCH_MILLISECONDS = 1_577_836_800_000;

  it('encodes the pid at an EXACT width, so the fields stay self-delimiting', () => {
    // Round-2 review finding: `padStart` gives a MINIMUM width. At six the
    // encoding stopped being injective for a pid past 36^6 - 1 (2_176_782_335),
    // which is under the unsigned 32-bit maximum Windows can issue — (pid
    // `1000001`, seq `00`) and (pid `100000`, seq `100`) both spell
    // `100000100`. Seven holds 78_364_164_095.
    const pid = process.pid.toString(36);
    expect(pid.length).toBeLessThanOrEqual(PID_WIDTH);

    const suffix = buildUniqueSuffix(ROUTING);
    expect(suffix.slice(HEAD, HEAD + PID_WIDTH)).toBe(
      pid.padStart(PID_WIDTH, '0'),
    );
  });

  it('gives every allocation of this process the same host-start stamp', () => {
    const first = buildUniqueSuffix(ROUTING);
    const second = buildUniqueSuffix(ROUTING);
    const stamp = (value: string): string =>
      value.slice(HEAD + PID_WIDTH, HEAD + PID_WIDTH + HOST_START_WIDTH);

    expect(stamp(first)).toBe(stamp(second));
    expect(stamp(first)).toHaveLength(HOST_START_WIDTH);
    // Not the zero floor: that would mean the clock read before 2020 and the
    // field would separate nothing.
    expect(stamp(first)).not.toBe('0'.repeat(HOST_START_WIDTH));
  });

  it('encodes the process incarnation at millisecond resolution', () => {
    // An exact assertion, not a tolerance: a one-second tolerance accepts the
    // very implementation this field replaced, one that rounds the host start
    // to a whole second and so repeats across a same-second restart.
    const nowSpy = jest
      .spyOn(Date, 'now')
      .mockReturnValue(HOST_START_EPOCH_MILLISECONDS + 1_234_567);
    const uptimeSpy = jest.spyOn(process, 'uptime').mockReturnValue(0.567);

    try {
      jest.isolateModules(() => {
        // The stamp is read once, at module load, so the module has to be
        // loaded again under the mocked clock.

        const isolated = require('./session-name.builder') as {
          buildUniqueSuffix: (routingId: string) => string;
        };
        const stamp = isolated
          .buildUniqueSuffix(ROUTING)
          .slice(HEAD + PID_WIDTH, HEAD + PID_WIDTH + HOST_START_WIDTH);

        expect(stamp).toBe(
          (1_234_000).toString(36).padStart(HOST_START_WIDTH, '0'),
        );
      });
    } finally {
      nowSpy.mockRestore();
      uptimeSpy.mockRestore();
    }
  });

  it('keeps its counter on globalThis, so two copies of this module cannot repeat an id', () => {
    // A bundle can hold the CJS and ESM builds of one lib in a single process.
    // Module-scoped state would give each copy its own counter, and both would
    // mint the same pid, the same host-start stamp and the same sequence.
    const state = (
      globalThis as unknown as Record<symbol, { sequence: number }>
    )[Symbol.for('ptah.agent-sdk.session-name.alloc')];
    expect(state).toBeDefined();

    const before = state.sequence;
    buildUniqueSuffix(ROUTING);
    expect(state.sequence).toBe(before + 1);
  });

  it('stays dash-free, so the consumer last-dash role split is unmoved', () => {
    expect(buildUniqueSuffix(ROUTING)).not.toContain('-');
  });
});
