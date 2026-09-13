import 'reflect-metadata';
import type {
  AgentId,
  CliOutputSegment,
  FlatStreamEventUnion,
} from '@ptah-extension/shared';
import { AgentOutputBuffer } from './agent-output-buffer.service';
import {
  BUFFER_LOW_WATER_SIZE,
  MAX_ACCUMULATED_SEGMENTS,
  MAX_ACCUMULATED_STREAM_EVENTS,
  MAX_BUFFER_SIZE,
  OUTPUT_FLUSH_INTERVAL,
  STREAM_EVENTS_CAP_SLACK,
  countNewlines,
} from './agent-process-manager-helpers';
import type { TrackedAgent } from './tracked-agent';

const AGENT_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-000000000001';

type BufferArgs = ConstructorParameters<typeof AgentOutputBuffer>;

function makeBuffer(): {
  buffer: AgentOutputBuffer;
  logger: {
    info: jest.Mock;
    warn: jest.Mock;
    error: jest.Mock;
    debug: jest.Mock;
  };
} {
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };
  return {
    buffer: new AgentOutputBuffer(logger as unknown as BufferArgs[0]),
    logger,
  };
}

function makeTracked(): TrackedAgent {
  return {
    info: {
      agentId: AGENT_ID as AgentId,
      cli: 'codex',
      task: 'task',
      workingDirectory: 'D:\\projects\\workspace-a',
      status: 'running',
      startedAt: new Date(0).toISOString(),
    },
    process: null,
    stdoutBuffer: '',
    stderrBuffer: '',
    stdoutLineCount: 0,
    stderrLineCount: 0,
    truncated: false,
    hasExited: false,
    subprocessReleased: false,
    accumulatedSegments: [],
    accumulatedStreamEvents: [],
    streamCapLogged: false,
    pendingMessages: [],
  };
}

function flushTimersOf(buffer: AgentOutputBuffer): Map<string, NodeJS.Timeout> {
  return (buffer as unknown as { flushTimers: Map<string, NodeJS.Timeout> })
    .flushTimers;
}

const textEvent = (): FlatStreamEventUnion =>
  ({ eventType: 'text_delta' }) as unknown as FlatStreamEventUnion;

describe('AgentOutputBuffer', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('appendOutput()', () => {
    const LINE = `${'x'.repeat(1023)}\n`;

    it('trims a saturated buffer to the low-water mark and keeps the line count in step', () => {
      const { buffer } = makeBuffer();
      const tracked = makeTracked();
      const onFlushDue = jest.fn();

      for (let i = 0; i < 1025; i++) {
        buffer.appendOutput(AGENT_ID, tracked, 'stdout', LINE, onFlushDue);
      }

      expect(tracked.stdoutBuffer.length).toBeLessThanOrEqual(
        BUFFER_LOW_WATER_SIZE,
      );
      expect(tracked.stdoutBuffer.length).toBeLessThan(MAX_BUFFER_SIZE);
      expect(tracked.truncated).toBe(true);
      expect(tracked.stdoutLineCount).toBe(countNewlines(tracked.stdoutBuffer));
    });

    it('counts stderr lines into its own buffer', () => {
      const { buffer } = makeBuffer();
      const tracked = makeTracked();

      buffer.appendOutput(AGENT_ID, tracked, 'stderr', 'a\nb\n', jest.fn());

      expect(tracked.stderrBuffer).toBe('a\nb\n');
      expect(tracked.stderrLineCount).toBe(2);
      expect(tracked.stdoutBuffer).toBe('');
      expect(tracked.truncated).toBe(false);
    });

    it("arms one unref'd flush timer that calls the manager's callback", () => {
      const { buffer } = makeBuffer();
      const tracked = makeTracked();
      const onFlushDue = jest.fn();

      buffer.appendOutput(AGENT_ID, tracked, 'stdout', 'one\n', onFlushDue);
      buffer.appendOutput(AGENT_ID, tracked, 'stdout', 'two\n', onFlushDue);

      const timer = flushTimersOf(buffer).get(AGENT_ID);
      expect(timer).toBeDefined();
      expect(timer?.hasRef()).toBe(false);

      jest.advanceTimersByTime(OUTPUT_FLUSH_INTERVAL);
      expect(onFlushDue).toHaveBeenCalledTimes(1);
    });
  });

  describe('appendSegment()', () => {
    it('stops accumulating for persistence at the segment cap but still queues the delta', () => {
      const { buffer } = makeBuffer();
      const tracked = makeTracked();
      const segment: CliOutputSegment = { type: 'tool-call', content: 'x' };

      for (let i = 0; i < MAX_ACCUMULATED_SEGMENTS + 3; i++) {
        buffer.appendSegment(AGENT_ID, tracked, segment, jest.fn());
      }

      expect(tracked.accumulatedSegments).toHaveLength(
        MAX_ACCUMULATED_SEGMENTS,
      );
      const delta = buffer.takeDelta(AGENT_ID, tracked);
      expect(delta?.segments).toHaveLength(MAX_ACCUMULATED_SEGMENTS + 3);
    });
  });

  describe('appendStreamEvent()', () => {
    it('re-caps only past the slack and logs the cap once', () => {
      const { buffer, logger } = makeBuffer();
      const tracked = makeTracked();
      const onFlushDue = jest.fn();
      const limit = MAX_ACCUMULATED_STREAM_EVENTS + STREAM_EVENTS_CAP_SLACK;

      for (let i = 0; i < limit; i++) {
        buffer.appendStreamEvent(AGENT_ID, tracked, textEvent(), onFlushDue);
      }
      expect(tracked.accumulatedStreamEvents).toHaveLength(limit);
      expect(logger.debug).not.toHaveBeenCalled();

      buffer.appendStreamEvent(AGENT_ID, tracked, textEvent(), onFlushDue);
      expect(tracked.accumulatedStreamEvents.length).toBeLessThanOrEqual(
        MAX_ACCUMULATED_STREAM_EVENTS,
      );
      expect(tracked.streamCapLogged).toBe(true);

      for (let i = 0; i < STREAM_EVENTS_CAP_SLACK + 1; i++) {
        buffer.appendStreamEvent(AGENT_ID, tracked, textEvent(), onFlushDue);
      }
      expect(logger.debug).toHaveBeenCalledTimes(1);
    });

    it('queues the event even when the record is gone', () => {
      const { buffer } = makeBuffer();

      buffer.appendStreamEvent(AGENT_ID, undefined, textEvent(), jest.fn());

      expect(buffer.takeDelta(AGENT_ID, makeTracked())?.streamEvents).toEqual([
        textEvent(),
      ]);
    });
  });

  describe('takeDelta()', () => {
    it('merges consecutive text segments and clears what it hands back', () => {
      const { buffer } = makeBuffer();
      const tracked = makeTracked();
      const onFlushDue = jest.fn();

      buffer.appendOutput(AGENT_ID, tracked, 'stdout', 'out', onFlushDue);
      buffer.appendOutput(AGENT_ID, tracked, 'stderr', 'err', onFlushDue);
      buffer.appendSegment(
        AGENT_ID,
        tracked,
        { type: 'text', content: 'Hello ' },
        onFlushDue,
      );
      buffer.appendSegment(
        AGENT_ID,
        tracked,
        { type: 'text', content: 'world' },
        onFlushDue,
      );

      const delta = buffer.takeDelta(AGENT_ID, tracked);

      expect(delta).toEqual(
        expect.objectContaining({
          agentId: AGENT_ID,
          stdoutDelta: 'out',
          stderrDelta: 'err',
          segments: [{ type: 'text', content: 'Hello world' }],
        }),
      );
      expect(delta).not.toHaveProperty('streamEvents');
      expect(flushTimersOf(buffer).has(AGENT_ID)).toBe(false);
      expect(buffer.takeDelta(AGENT_ID, tracked)).toBeUndefined();
    });

    it('hands back nothing when the record is gone', () => {
      const { buffer } = makeBuffer();
      const tracked = makeTracked();

      buffer.appendOutput(AGENT_ID, tracked, 'stdout', 'out', jest.fn());

      expect(buffer.takeDelta(AGENT_ID, undefined)).toBeUndefined();
      expect(flushTimersOf(buffer).has(AGENT_ID)).toBe(false);
    });
  });

  describe('discard()', () => {
    it('clears the flush timer and the pending delta', () => {
      const { buffer } = makeBuffer();
      const tracked = makeTracked();
      const onFlushDue = jest.fn();

      buffer.appendOutput(AGENT_ID, tracked, 'stdout', 'out', onFlushDue);
      buffer.discard(AGENT_ID);

      expect(flushTimersOf(buffer).has(AGENT_ID)).toBe(false);
      jest.advanceTimersByTime(OUTPUT_FLUSH_INTERVAL * 2);
      expect(onFlushDue).not.toHaveBeenCalled();
      expect(buffer.takeDelta(AGENT_ID, tracked)).toBeUndefined();
    });
  });
});
