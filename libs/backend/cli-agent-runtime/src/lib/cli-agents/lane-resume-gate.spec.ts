import type { IOutputChannel } from '@ptah-extension/platform-core';
import {
  HANDOFF_FINAL_TEXT_MAX_CHARS,
  LaneResumeGate,
  RESUME_GATE_MAX_CONTEXT_TOKENS,
  RESUME_GATE_MAX_IDLE_MS,
  buildLaneHandoffTask,
  collectHandoffCarryOver,
  type CodexRolloutUsageReader,
} from './lane-resume-gate';

const NOW = 1_800_000_000_000;

function fakeOutput(): IOutputChannel & { appendLine: jest.Mock } {
  return {
    name: 'Ptah',
    appendLine: jest.fn(),
    append: jest.fn(),
    clear: jest.fn(),
    show: jest.fn(),
    dispose: jest.fn(),
  };
}

function gateWith(reader: CodexRolloutUsageReader = jest.fn()) {
  const output = fakeOutput();
  const gate = new LaneResumeGate(output, reader, () => NOW);
  return { gate, output };
}

function rollout(tokens: number, modifiedAtMs = NOW - 1_000) {
  return jest.fn<ReturnType<CodexRolloutUsageReader>, [string]>(async () => ({
    file: '/codex/sessions/2026/10/04/rollout-x-thread.jsonl',
    lastRequestInputTokens: tokens,
    modifiedAtMs,
  }));
}

describe('LaneResumeGate', () => {
  describe('context boundary (60k)', () => {
    it('resumes at exactly the limit', async () => {
      const { gate } = gateWith(rollout(RESUME_GATE_MAX_CONTEXT_TOKENS));

      const result = await gate.evaluate({
        cli: 'codex',
        cliSessionId: 'thread',
        lastActivityAt: NOW - 1_000,
      });

      expect(result).toMatchObject({
        decision: 'resume',
        contextTokens: 60_000,
        source: 'rollout',
      });
    });

    it('starts fresh one token past the limit', async () => {
      const { gate } = gateWith(rollout(RESUME_GATE_MAX_CONTEXT_TOKENS + 1));

      const result = await gate.evaluate({
        cli: 'codex',
        cliSessionId: 'thread',
        lastActivityAt: NOW - 1_000,
      });

      expect(result.decision).toBe('fresh');
      expect(result.reason).toBe('last request 60001 tokens exceeds 60000');
    });
  });

  describe('idle boundary (10 minutes)', () => {
    it('resumes at exactly 10 minutes idle', async () => {
      const { gate } = gateWith();

      const result = await gate.evaluate({
        cli: 'copilot',
        cliSessionId: 's',
        lastActivityAt: NOW - RESUME_GATE_MAX_IDLE_MS,
        lastRequestContext: { tokens: 1_000, source: 'estimate' },
      });

      expect(result).toMatchObject({ decision: 'resume', idleMs: 600_000 });
    });

    it('starts fresh one millisecond past 10 minutes', async () => {
      const { gate } = gateWith();

      const result = await gate.evaluate({
        cli: 'copilot',
        cliSessionId: 's',
        lastActivityAt: NOW - RESUME_GATE_MAX_IDLE_MS - 1,
        lastRequestContext: { tokens: 1_000, source: 'estimate' },
      });

      expect(result.decision).toBe('fresh');
      expect(result.reason).toBe('idle 601s exceeds 600s');
    });

    it('uses the rollout modification time when the host knows no activity time', async () => {
      const { gate } = gateWith(rollout(1_000, NOW - 11 * 60_000));

      const result = await gate.evaluate({ cli: 'codex', cliSessionId: 't' });

      expect(result).toMatchObject({ decision: 'fresh', idleMs: 660_000 });
    });
  });

  describe('sources', () => {
    it('Codex: reads the rollout, never the streamed figure', async () => {
      const reader = rollout(20_000);
      const { gate } = gateWith(reader);

      const result = await gate.evaluate({
        cli: 'codex',
        cliSessionId: 'thread-9',
        lastActivityAt: NOW,
        // A per-turn sum, far over the limit: must not decide.
        lastRequestContext: { tokens: 300_000, source: 'estimate' },
      });

      expect(reader).toHaveBeenCalledWith('thread-9');
      expect(result).toMatchObject({
        decision: 'resume',
        contextTokens: 20_000,
        source: 'rollout',
      });
    });

    it('Codex: a missing rollout falls back to the estimate', async () => {
      const { gate, output } = gateWith(jest.fn(async () => null));

      const result = await gate.evaluate({
        cli: 'codex',
        cliSessionId: 'thread',
        lastActivityAt: NOW,
        lastRequestContext: { tokens: 70_000, source: 'estimate' },
      });

      expect(result).toMatchObject({
        decision: 'fresh',
        contextTokens: 70_000,
        source: 'estimate',
      });
      expect(output.appendLine.mock.calls[0][0]).toContain('no rollout figure');
    });

    it('Codex: an unreadable rollout falls back to the estimate and logs why', async () => {
      const { gate, output } = gateWith(
        jest.fn(async () => {
          throw new Error('EACCES: permission denied');
        }),
      );

      const result = await gate.evaluate({
        cli: 'codex',
        cliSessionId: 'thread',
        lastActivityAt: NOW,
      });

      expect(result).toMatchObject({
        decision: 'resume',
        contextTokens: null,
        source: 'estimate',
      });
      expect(output.appendLine.mock.calls[0][0]).toContain(
        'rollout unreadable: EACCES: permission denied',
      );
    });

    it('OpenCode: uses the recorded figure with its label, and reads no rollout', async () => {
      const reader = jest.fn();
      const { gate } = gateWith(reader);

      const result = await gate.evaluate({
        cli: 'opencode',
        cliSessionId: 'ses_1',
        lastActivityAt: NOW,
        lastRequestContext: { tokens: 61_000, source: 'estimate' },
      });

      expect(reader).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        decision: 'fresh',
        contextTokens: 61_000,
        source: 'estimate',
      });
    });

    it('a recorded `stream` figure keeps its label', async () => {
      const { gate } = gateWith();

      const result = await gate.evaluate({
        cli: 'opencode',
        cliSessionId: 'ses_1',
        lastActivityAt: NOW,
        lastRequestContext: { tokens: 5_000, source: 'stream' },
      });

      expect(result.source).toBe('stream');
    });

    it('no figure at all: labelled estimate, decided on idle time only', async () => {
      const { gate } = gateWith();

      const result = await gate.evaluate({
        cli: 'cursor',
        cliSessionId: 'c',
        lastActivityAt: NOW - 1_000,
      });

      expect(result).toEqual({
        decision: 'resume',
        reason: 'within the context and idle limits',
        contextTokens: null,
        source: 'estimate',
        idleMs: 1_000,
      });
    });
  });

  it('always logs the decision with its source', async () => {
    const { gate, output } = gateWith(rollout(61_000));

    await gate.evaluate({
      cli: 'codex',
      cliSessionId: 'thread-1',
      lastActivityAt: NOW - 30_000,
    });

    expect(output.appendLine).toHaveBeenCalledTimes(1);
    expect(output.appendLine.mock.calls[0][0]).toBe(
      '[LaneResumeGate] fresh: codex session thread-1 — last request 61000 tokens ' +
        'exceeds 60000 (context 61000 tokens, source: rollout, idle 30s)',
    );
  });
});

describe('collectHandoffCarryOver', () => {
  it('collects changed files once, in first-seen order, and the text tail', () => {
    const longText = 'a'.repeat(HANDOFF_FINAL_TEXT_MAX_CHARS) + 'END';

    const carry = collectHandoffCarryOver([
      { type: 'file-change', content: 'b.ts', changeKind: 'added' },
      { type: 'tool-call', content: 'x', toolName: 'shell' },
      { type: 'file-change', content: 'a.ts', changeKind: 'modified' },
      { type: 'file-change', content: 'b.ts', changeKind: 'modified' },
      { type: 'text', content: longText },
    ]);

    expect(carry.changedFiles).toEqual(['b.ts', 'a.ts']);
    expect(carry.finalText).toHaveLength(HANDOFF_FINAL_TEXT_MAX_CHARS);
    expect(carry.finalText.endsWith('END')).toBe(true);
  });
});

describe('buildLaneHandoffTask', () => {
  it('carries the new message, the original task, the final text and the changed files', () => {
    const task = buildLaneHandoffTask({
      message: 'Now add tests',
      reason: 'idle 900s exceeds 600s',
      sessionKnown: true,
      originalTask: 'Write the parser',
      finalText: 'Parser written.',
      changedFiles: ['src/parser.ts'],
    });

    expect(task).toBe(
      [
        '[LANE HANDOFF]',
        'A previous lane worked on this task. It was not resumed (idle 900s exceeds 600s), ' +
          'so this is a fresh lane with a short brief of the work that remains. ' +
          'Check the current state of the files below before changing them.',
        '',
        'Original task:',
        'Write the parser',
        '',
        'Files the previous lane changed:',
        '- src/parser.ts',
        '',
        "The previous lane's final text (last 2,000 characters):",
        'Parser written.',
        '[END LANE HANDOFF]',
        '',
        'New instruction:',
        'Now add tests',
      ].join('\n'),
    );
  });

  it('caps a final text passed in longer than the limit', () => {
    const task = buildLaneHandoffTask({
      message: 'm',
      reason: 'r',
      sessionKnown: true,
      finalText: 'x'.repeat(5_000),
      changedFiles: [],
    });

    expect(task).not.toContain('x'.repeat(HANDOFF_FINAL_TEXT_MAX_CHARS + 1));
    expect(task).toContain('x'.repeat(HANDOFF_FINAL_TEXT_MAX_CHARS));
  });

  it('says plainly that this host holds no record when the session is unknown', () => {
    const task = buildLaneHandoffTask({
      message: 'Carry on',
      reason: 'idle 900s exceeds 600s',
      sessionKnown: false,
      finalText: '',
      changedFiles: [],
    });

    expect(task).toContain(
      'This host holds no record of the previous lane (it ran in another window or before a restart)',
    );
    expect(task).toContain(
      'Original task:\n(unknown: this host holds no record of the previous lane)',
    );
    expect(task).not.toContain('(not available');
  });
});
