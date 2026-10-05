import type { CliOutputSegment } from '@ptah-extension/shared';
import {
  LaneBudgetGuard,
  laneBudgetSteerMessage,
  type LaneBudgetAction,
  type LaneBudgetThresholds,
} from './lane-budget-guard';

const DEFAULTS: LaneBudgetThresholds = {
  steerAt: 40,
  stopAt: 60,
  repeatAt: 20,
};

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

describe('LaneBudgetGuard', () => {
  it('steers once at 40 calls and stops at 60 with tool-call-budget', () => {
    const guard = new LaneBudgetGuard(DEFAULTS);
    const segments = Array.from({ length: 80 }, (_, i) => distinct(i));

    expect(run(guard, segments)).toEqual([
      {
        at: 40,
        action: { kind: 'steer', message: laneBudgetSteerMessage(40) },
      },
      { at: 60, action: { kind: 'stop', stopReason: 'tool-call-budget' } },
    ]);
  });

  it('uses the exact steer text', () => {
    expect(laneBudgetSteerMessage(40)).toBe(
      'You have made 40 tool calls. Stop exploring, finish the deliverable now, and report.',
    );
  });

  it('stops with repeat-call when one identical call reaches 20', () => {
    const guard = new LaneBudgetGuard(DEFAULTS);
    const segments = Array.from({ length: 30 }, () =>
      call('read', { toolInput: { path: 'same.ts' } }),
    );

    expect(run(guard, segments)).toEqual([
      { at: 20, action: { kind: 'stop', stopReason: 'repeat-call' } },
    ]);
  });

  it('honours custom thresholds', () => {
    const guard = new LaneBudgetGuard({ steerAt: 3, stopAt: 5, repeatAt: 4 });
    const segments = Array.from({ length: 10 }, (_, i) => distinct(i));

    expect(run(guard, segments)).toEqual([
      { at: 3, action: { kind: 'steer', message: laneBudgetSteerMessage(3) } },
      { at: 5, action: { kind: 'stop', stopReason: 'tool-call-budget' } },
    ]);

    const repeating = new LaneBudgetGuard({
      steerAt: 3,
      stopAt: 50,
      repeatAt: 4,
    });
    expect(
      run(
        repeating,
        Array.from({ length: 10 }, () => call('bash', { toolArgs: 'ls' })),
      ),
    ).toEqual([
      { at: 3, action: { kind: 'steer', message: laneBudgetSteerMessage(3) } },
      { at: 4, action: { kind: 'stop', stopReason: 'repeat-call' } },
    ]);
  });

  it('ignores segments that are not tool calls', () => {
    const guard = new LaneBudgetGuard({ steerAt: 1, stopAt: 2, repeatAt: 2 });
    const others: CliOutputSegment[] = [
      { type: 'text', content: 'hi' },
      { type: 'tool-result', content: 'ok', toolName: 'read' },
      { type: 'thinking', content: '...' },
    ];
    expect(run(guard, [...others, ...others])).toEqual([]);
    expect(guard.toolCallCount).toBe(0);
  });

  it('treats toolInput with reordered keys as the same call', () => {
    const guard = new LaneBudgetGuard({ steerAt: 99, stopAt: 99, repeatAt: 2 });
    expect(
      guard.observe(call('grep', { toolInput: { pattern: 'x', path: 'a' } })),
    ).toEqual({ kind: 'none' });
    expect(
      guard.observe(call('grep', { toolInput: { path: 'a', pattern: 'x' } })),
    ).toEqual({ kind: 'stop', stopReason: 'repeat-call' });
  });

  it('keys on toolArgs without toolInput, and on the name alone without either', () => {
    const byArgs = new LaneBudgetGuard({
      steerAt: 99,
      stopAt: 99,
      repeatAt: 2,
    });
    expect(byArgs.observe(call('bash', { toolArgs: 'ls' }))).toEqual({
      kind: 'none',
    });
    expect(byArgs.observe(call('bash', { toolArgs: 'pwd' }))).toEqual({
      kind: 'none',
    });
    expect(byArgs.observe(call('bash', { toolArgs: 'ls' }))).toEqual({
      kind: 'stop',
      stopReason: 'repeat-call',
    });

    const byName = new LaneBudgetGuard({
      steerAt: 99,
      stopAt: 99,
      repeatAt: 2,
    });
    expect(byName.observe(call('todo'))).toEqual({ kind: 'none' });
    expect(byName.observe(call('todo'))).toEqual({
      kind: 'stop',
      stopReason: 'repeat-call',
    });
  });

  it('returns none for every segment after a stop', () => {
    const guard = new LaneBudgetGuard({ steerAt: 99, stopAt: 2, repeatAt: 99 });
    run(guard, [distinct(1), distinct(2)]);
    expect(run(guard, [distinct(3), distinct(4)])).toEqual([]);
  });

  it('leaves file-edit calls out of the repeat check but counts them in the budget', () => {
    const guard = new LaneBudgetGuard({ steerAt: 99, stopAt: 30, repeatAt: 3 });
    // Codex file changes carry only the path, so normal edits share a key.
    const edits = Array.from({ length: 30 }, (_, i) =>
      call(i % 2 === 0 ? 'Edit' : 'write', {
        toolInput: { file_path: 'same.ts' },
      }),
    );

    expect(run(guard, edits)).toEqual([
      { at: 30, action: { kind: 'stop', stopReason: 'tool-call-budget' } },
    ]);
  });

  describe('reset (a new caller task)', () => {
    it('clears counts, repeats and the one-time steer', () => {
      const guard = new LaneBudgetGuard({ steerAt: 2, stopAt: 4, repeatAt: 3 });
      expect(run(guard, [distinct(1), distinct(1), distinct(2)])).toEqual([
        { at: 2, action: { kind: 'steer', message: laneBudgetSteerMessage(2) } },
      ]);

      guard.reset();
      expect(guard.toolCallCount).toBe(0);

      // Same repeated key and the steer again, both counted from zero.
      expect(run(guard, [distinct(1), distinct(1), distinct(3)])).toEqual([
        { at: 2, action: { kind: 'steer', message: laneBudgetSteerMessage(2) } },
      ]);
    });

    it('does not revive a guard that already asked for a stop', () => {
      const guard = new LaneBudgetGuard({ steerAt: 99, stopAt: 2, repeatAt: 99 });
      run(guard, [distinct(1), distinct(2)]);
      guard.reset();
      expect(run(guard, [distinct(3), distinct(4)])).toEqual([]);
    });
  });

  describe('glob loops (Batch 10 finding b)', () => {
    it('a long run of identical glob calls stops at the repeat threshold', () => {
      const guard = new LaneBudgetGuard(DEFAULTS);
      const segments = Array.from({ length: 200 }, () =>
        call('glob', { toolInput: { pattern: '**/*.ts', path: 'libs' } }),
      );

      expect(run(guard, segments)).toEqual([
        { at: 20, action: { kind: 'stop', stopReason: 'repeat-call' } },
      ]);
    });

    it('glob calls with varied args stop at the call budget', () => {
      const guard = new LaneBudgetGuard(DEFAULTS);
      const segments = Array.from({ length: 200 }, (_, i) =>
        call('glob', { toolInput: { pattern: `**/*.${i}.ts` } }),
      );

      expect(run(guard, segments)).toEqual([
        {
          at: 40,
          action: { kind: 'steer', message: laneBudgetSteerMessage(40) },
        },
        { at: 60, action: { kind: 'stop', stopReason: 'tool-call-budget' } },
      ]);
    });
  });
});
