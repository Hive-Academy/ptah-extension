import type { CliOutputSegment } from '@ptah-extension/shared';
import {
  LaneBudgetGuard,
  type LaneBudgetAction,
  type LaneBudgetThresholds,
} from './lane-budget-guard';

const DEFAULTS: LaneBudgetThresholds = { repeatAt: 20 };

function call(
  toolName: string,
  extra: Partial<CliOutputSegment> = {},
): CliOutputSegment {
  return { type: 'tool-call', content: '', toolName, ...extra };
}

/** A distinct tool call per index, so no repeat threshold is reached. */
function distinct(i: number): CliOutputSegment {
  return call('read', { toolInput: { path: `file-${i}.ts` } });
}

/** Feed segments; return the index (1-based) and action of each non-`none`. */
function run(
  guard: LaneBudgetGuard,
  segments: readonly CliOutputSegment[],
): Array<{ at: number; action: LaneBudgetAction }> {
  const actions: Array<{ at: number; action: LaneBudgetAction }> = [];
  segments.forEach((segment, i) => {
    const action = guard.observe(segment);
    if (action.kind !== 'none') actions.push({ at: i + 1, action });
  });
  return actions;
}

const repeatStop = (repeats: number): LaneBudgetAction => ({
  kind: 'stop',
  stopReason: 'repeat-call',
  repeats,
});

describe('LaneBudgetGuard', () => {
  it('never steers or stops on the call count alone, but keeps counting', () => {
    const guard = new LaneBudgetGuard(DEFAULTS);
    const segments = Array.from({ length: 500 }, (_, i) => distinct(i));

    expect(run(guard, segments)).toEqual([]);
    expect(guard.toolCallCount).toBe(500);
  });

  it('stops with repeat-call when one identical call reaches 20', () => {
    const guard = new LaneBudgetGuard(DEFAULTS);
    const segments = Array.from({ length: 30 }, () =>
      call('read', { toolInput: { path: 'same.ts' } }),
    );

    expect(run(guard, segments)).toEqual([{ at: 20, action: repeatStop(20) }]);
    expect(guard.toolCallCount).toBe(20);
  });

  it('honours a custom repeat threshold', () => {
    const guard = new LaneBudgetGuard({ repeatAt: 4 });
    expect(
      run(
        guard,
        Array.from({ length: 10 }, () => call('bash', { toolArgs: 'ls' })),
      ),
    ).toEqual([{ at: 4, action: repeatStop(4) }]);
  });

  it('ignores segments that are not tool calls', () => {
    const guard = new LaneBudgetGuard({ repeatAt: 2 });
    const others: CliOutputSegment[] = [
      { type: 'text', content: 'hi' },
      { type: 'tool-result', content: 'ok', toolName: 'read' },
      { type: 'thinking', content: '...' },
    ];
    expect(run(guard, [...others, ...others])).toEqual([]);
    expect(guard.toolCallCount).toBe(0);
  });

  it('treats toolInput with reordered keys as the same call', () => {
    const guard = new LaneBudgetGuard({ repeatAt: 2 });
    expect(
      guard.observe(call('grep', { toolInput: { pattern: 'x', path: 'a' } })),
    ).toEqual({ kind: 'none' });
    expect(
      guard.observe(call('grep', { toolInput: { path: 'a', pattern: 'x' } })),
    ).toEqual(repeatStop(2));
  });

  it('keys on toolArgs without toolInput, and on the name alone without either', () => {
    const byArgs = new LaneBudgetGuard({ repeatAt: 2 });
    expect(byArgs.observe(call('bash', { toolArgs: 'ls' }))).toEqual({
      kind: 'none',
    });
    expect(byArgs.observe(call('bash', { toolArgs: 'pwd' }))).toEqual({
      kind: 'none',
    });
    expect(byArgs.observe(call('bash', { toolArgs: 'ls' }))).toEqual(
      repeatStop(2),
    );

    const byName = new LaneBudgetGuard({ repeatAt: 2 });
    expect(byName.observe(call('todo'))).toEqual({ kind: 'none' });
    expect(byName.observe(call('todo'))).toEqual(repeatStop(2));
  });

  it('returns none for every segment after a stop', () => {
    const guard = new LaneBudgetGuard({ repeatAt: 2 });
    run(guard, [distinct(1), distinct(1)]);
    expect(run(guard, [distinct(3), distinct(3)])).toEqual([]);
  });

  it('leaves file-edit calls out of the repeat check but counts them', () => {
    const guard = new LaneBudgetGuard({ repeatAt: 3 });
    // Codex file changes carry only the path, so normal edits share a key.
    const edits = Array.from({ length: 30 }, (_, i) =>
      call(i % 2 === 0 ? 'Edit' : 'write', {
        toolInput: { file_path: 'same.ts' },
      }),
    );

    expect(run(guard, edits)).toEqual([]);
    expect(guard.toolCallCount).toBe(30);
  });

  describe('reset (a new caller task)', () => {
    it('clears counts and repeats', () => {
      const guard = new LaneBudgetGuard({ repeatAt: 3 });
      expect(run(guard, [distinct(1), distinct(1), distinct(2)])).toEqual([]);

      guard.reset();
      expect(guard.toolCallCount).toBe(0);

      // The earlier two repeats of key 1 are forgotten.
      expect(run(guard, [distinct(1), distinct(1), distinct(3)])).toEqual([]);
      expect(run(guard, [distinct(1)])).toEqual([
        { at: 1, action: repeatStop(3) },
      ]);
    });

    it('does not revive a guard that already asked for a stop', () => {
      const guard = new LaneBudgetGuard({ repeatAt: 2 });
      run(guard, [distinct(1), distinct(1)]);
      guard.reset();
      expect(run(guard, [distinct(3), distinct(3)])).toEqual([]);
    });
  });

  describe('command segments (OpenCode shell calls)', () => {
    const command = (id: string | undefined, line = `ls ${id}`) =>
      ({
        type: 'command',
        content: '',
        toolName: line,
        ...(id !== undefined ? { toolCallId: id } : {}),
      }) as CliOutputSegment;

    it('OpenCode-style command segments are counted', () => {
      const guard = new LaneBudgetGuard(DEFAULTS);
      const segments = Array.from({ length: 80 }, (_, i) => command(`c${i}`));
      expect(run(guard, segments)).toEqual([]);
      expect(guard.toolCallCount).toBe(80);
    });

    it('OpenCode-style command segments with one command line trip the repeat stop', () => {
      const guard = new LaneBudgetGuard({ repeatAt: 3 });
      const segments = Array.from({ length: 5 }, (_, i) =>
        command(`c${i}`, 'ls'),
      );
      expect(run(guard, segments)).toEqual([{ at: 3, action: repeatStop(3) }]);
    });

    it('a tool-call plus a command with the same id counts once', () => {
      const guard = new LaneBudgetGuard(DEFAULTS);
      guard.observe(call('shell', { toolCallId: 'x1' }));
      guard.observe(command('x1'));
      expect(guard.toolCallCount).toBe(1);
    });

    it('ignores a command without a toolCallId and a repeated id', () => {
      const guard = new LaneBudgetGuard(DEFAULTS);
      guard.observe(command(undefined));
      guard.observe(command('y1'));
      guard.observe(command('y1'));
      expect(guard.toolCallCount).toBe(1);
    });

    it('reset() clears the counted ids', () => {
      const guard = new LaneBudgetGuard(DEFAULTS);
      guard.observe(command('z1'));
      guard.reset();
      guard.observe(command('z1'));
      expect(guard.toolCallCount).toBe(1);
    });
  });

  describe('glob loops (Batch 10 finding b)', () => {
    it('a long run of identical glob calls stops at the repeat threshold', () => {
      const guard = new LaneBudgetGuard(DEFAULTS);
      const segments = Array.from({ length: 200 }, () =>
        call('glob', { toolInput: { pattern: '**/*.ts', path: 'libs' } }),
      );

      expect(run(guard, segments)).toEqual([{ at: 20, action: repeatStop(20) }]);
    });

    it('glob calls with varied args are never stopped', () => {
      const guard = new LaneBudgetGuard(DEFAULTS);
      const segments = Array.from({ length: 200 }, (_, i) =>
        call('glob', { toolInput: { pattern: `**/*.${i}.ts` } }),
      );

      expect(run(guard, segments)).toEqual([]);
    });
  });
});
