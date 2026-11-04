import {
  CAPTURED_EVENT_TYPES,
  HistoryMarkSchema,
  SESSION_EVENT_TYPES,
  WORKER_LIMITS,
  WORKER_RECORD_SCHEMAS,
  WORKER_RECORD_TYPES,
  checkSessionRecord,
  encodeFrame,
  eventId,
  isSessionEventType,
  isWorkerRecordType,
  parseClientFrame,
  parseWorkerFrame,
  type ClientFrame,
  type WorkerFrame,
} from './frames';
import { workerError } from './errors';

const PROTOCOL_ERROR = { code: 4400, reason: 'protocol-error' };
const PRE_AUTH = WORKER_LIMITS.maxPayloadPreAuthBytes;
const AUTHENTICATED = WORKER_LIMITS.maxPayloadBytes;

function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** A client frame whose text is exactly `bytes` UTF-8 bytes, filled with `fill`. */
function clientFrameOfBytes(bytes: number, fill: string): string {
  const empty = encodeFrame({
    v: 1,
    kind: 'req',
    id: 'r',
    method: 'chat.send',
    params: { text: '' },
  });
  const room = bytes - utf8Bytes(empty);
  const fillBytes = utf8Bytes(fill);
  const text =
    fill.repeat(Math.floor(room / fillBytes)) + 'x'.repeat(room % fillBytes);
  const framed = encodeFrame({
    v: 1,
    kind: 'req',
    id: 'r',
    method: 'chat.send',
    params: { text },
  });
  expect(utf8Bytes(framed)).toBe(bytes);
  return framed;
}

const historyEvent = {
  id: 'evt-1',
  eventType: 'text_delta',
  timestamp: 1_700_000_000_000,
  sessionId: 's-1',
  messageId: 'm-1',
  delta: 'hello',
  blockIndex: 0,
};

function evt(type: string, payload: unknown, seq = 1): string {
  return JSON.stringify({
    v: 1,
    kind: 'evt',
    sessionId: 's-1',
    epoch: 'e-1',
    seq,
    type,
    ts: 1,
    payload,
  });
}

describe('session event types (W7)', () => {
  it('is the captured list followed by the worker record list', () => {
    expect(SESSION_EVENT_TYPES).toEqual([
      ...CAPTURED_EVENT_TYPES,
      ...WORKER_RECORD_TYPES,
    ]);
    expect(new Set(SESSION_EVENT_TYPES).size).toBe(SESSION_EVENT_TYPES.length);
  });

  it('includes every W7 logged type, worker:history-mark among them', () => {
    expect([...SESSION_EVENT_TYPES].sort()).toEqual(
      [
        'chat:chunk',
        'chat:complete',
        'chat:error',
        'permission:request',
        'permission:auto-resolved',
        'permission:session-cleanup',
        'session:turnEnded',
        'session:turnFailed',
        'session:id-resolved',
        'chat:sessionEnded',
        'session:stats',
        'worker:baseline',
        'worker:history-mark',
        'worker:turn.begin',
        'worker:turn.end',
        'worker:turn.interrupted',
        'worker:permission.answered',
      ].sort(),
    );
  });

  it('has exactly one record schema per worker record type', () => {
    expect(Object.keys(WORKER_RECORD_SCHEMAS).sort()).toEqual(
      [...WORKER_RECORD_TYPES].sort(),
    );
  });

  it('classifies types', () => {
    expect(isSessionEventType('chat:chunk')).toBe(true);
    expect(isSessionEventType('session:stats-live')).toBe(false);
    expect(isWorkerRecordType('worker:history-mark')).toBe(true);
    expect(isWorkerRecordType('chat:chunk')).toBe(false);
    expect(isWorkerRecordType(undefined)).toBe(false);
  });

  it('builds the event id as epoch:seq', () => {
    expect(eventId('e-1', 7)).toBe('e-1:7');
  });
});

describe('HistoryMark', () => {
  it('accepts a count with a last event id or null', () => {
    expect(
      HistoryMarkSchema.safeParse({ count: 0, lastEventId: null }).success,
    ).toBe(true);
    expect(
      HistoryMarkSchema.safeParse({ count: 3, lastEventId: 'm-3' }).success,
    ).toBe(true);
  });

  it('rejects negative or fractional counts and empty ids', () => {
    expect(
      HistoryMarkSchema.safeParse({ count: -1, lastEventId: null }).success,
    ).toBe(false);
    expect(
      HistoryMarkSchema.safeParse({ count: 1.5, lastEventId: null }).success,
    ).toBe(false);
    expect(
      HistoryMarkSchema.safeParse({ count: 1, lastEventId: '' }).success,
    ).toBe(false);
    expect(HistoryMarkSchema.safeParse({ count: 1 }).success).toBe(false);
  });
});

describe('checkSessionRecord', () => {
  const mark = { count: 1, lastEventId: 'evt-1' };

  it('accepts a valid baseline and history mark', () => {
    expect(
      checkSessionRecord('worker:baseline', {
        events: [historyEvent],
        historyMark: mark,
      }),
    ).toEqual({
      ok: true,
      payload: { events: [historyEvent], historyMark: mark },
    });
    expect(
      checkSessionRecord('worker:history-mark', {
        historyMark: mark,
        turnId: 't-1',
      }).ok,
    ).toBe(true);
  });

  it.each([
    [
      'a text_delta without messageId',
      { ...historyEvent, messageId: undefined },
    ],
    [
      'a text_delta without blockIndex',
      { ...historyEvent, blockIndex: undefined },
    ],
    ['an unknown eventType', { ...historyEvent, eventType: 'text_typo' }],
    [
      'a tool_result without isError',
      {
        id: 'evt-2',
        eventType: 'tool_result',
        timestamp: 1,
        messageId: 'm-1',
        toolCallId: 't-1',
        output: 'ok',
      },
    ],
    ['a wrong-typed optional base field', { ...historyEvent, source: 'disk' }],
  ])('rejects a baseline holding %s', (_label, event) => {
    expect(
      checkSessionRecord('worker:baseline', {
        events: [event],
        historyMark: mark,
      }),
    ).toEqual({ ok: false, reason: 'invalid-payload' });
  });

  it('accepts other union members and keeps their optional fields', () => {
    const toolStart = {
      id: 'evt-3',
      eventType: 'tool_start',
      timestamp: 1,
      messageId: 'm-1',
      toolCallId: 't-1',
      toolName: 'Read',
      isTaskTool: false,
      toolInput: { path: 'a.ts' },
    };
    const turnState = {
      id: 'evt-4',
      eventType: 'turn_state',
      timestamp: 2,
      messageId: 'turn-state-s-1',
      phase: 'idle',
      revision: 3,
      backgroundTasks: [],
      sessionCrons: [],
      terminalReason: null,
    };
    expect(
      checkSessionRecord('worker:baseline', {
        events: [toolStart, turnState],
        historyMark: mark,
      }),
    ).toEqual({
      ok: true,
      payload: { events: [toolStart, turnState], historyMark: mark },
    });
  });

  it('rejects a malformed history mark record', () => {
    expect(
      checkSessionRecord('worker:history-mark', { historyMark: mark }),
    ).toEqual({
      ok: false,
      reason: 'invalid-payload',
    });
    expect(
      checkSessionRecord('worker:history-mark', {
        historyMark: { count: 'one', lastEventId: null },
        turnId: 't-1',
      }).ok,
    ).toBe(false);
  });

  it('rejects a baseline whose events are not flat stream events', () => {
    expect(
      checkSessionRecord('worker:baseline', {
        events: [{ id: 'x' }],
        historyMark: mark,
      }).ok,
    ).toBe(false);
  });

  it('validates turn markers and permission answers', () => {
    expect(checkSessionRecord('worker:turn.begin', { turnId: 't-1' }).ok).toBe(
      true,
    );
    expect(checkSessionRecord('worker:turn.end', {}).ok).toBe(false);
    expect(
      checkSessionRecord('worker:turn.interrupted', { turnId: 't-1' }).ok,
    ).toBe(true);
    expect(
      checkSessionRecord('worker:permission.answered', {
        requestId: 'r-1',
        decision: 'allow',
        by: 'Laptop',
      }).ok,
    ).toBe(true);
    expect(
      checkSessionRecord('worker:permission.answered', {
        requestId: 'r-1',
        decision: 'always_allow',
        by: 'Laptop',
      }).ok,
    ).toBe(false);
  });

  it('passes captured events through unchanged', () => {
    const payload = { sessionId: 's-1', anything: [1, 2] };
    expect(checkSessionRecord('chat:chunk', payload)).toEqual({
      ok: true,
      payload,
    });
  });

  it('rejects a type outside the list', () => {
    expect(checkSessionRecord('session:stats-live', {})).toEqual({
      ok: false,
      reason: 'unknown-type',
    });
  });
});

describe('parseClientFrame', () => {
  const frame: ClientFrame = {
    v: 1,
    kind: 'req',
    id: 'req-1',
    method: 'machine.info',
    params: {},
  };

  it('round-trips a request', () => {
    expect(parseClientFrame(encodeFrame(frame), PRE_AUTH)).toEqual({
      ok: true,
      frame,
    });
  });

  it('leaves unknown method names to the gateway', () => {
    const parsed = parseClientFrame(
      encodeFrame({ ...frame, method: 'chat:start' }),
      PRE_AUTH,
    );
    expect(parsed.ok).toBe(true);
  });

  it.each([
    ['not JSON', '{nope'],
    ['a JSON array', '[]'],
    ['the wrong version', JSON.stringify({ ...frame, v: 2 })],
    ['the wrong kind', JSON.stringify({ ...frame, kind: 'res' })],
    ['an empty id', JSON.stringify({ ...frame, id: '' })],
    [
      'an over-long id',
      JSON.stringify({
        ...frame,
        id: 'x'.repeat(WORKER_LIMITS.maxRequestIdLength + 1),
      }),
    ],
    ['an empty method', JSON.stringify({ ...frame, method: '' })],
  ])('maps %s to close 4400 protocol-error', (_label, text) => {
    expect(parseClientFrame(text, PRE_AUTH)).toEqual({
      ok: false,
      close: PROTOCOL_ERROR,
    });
  });

  it('accepts a frame of exactly the pre-auth bound in UTF-8 bytes', () => {
    const text = clientFrameOfBytes(PRE_AUTH, 'é');
    expect(parseClientFrame(text, PRE_AUTH).ok).toBe(true);
  });

  it('counts UTF-8 bytes, not UTF-16 units, against the bound', () => {
    // 'é' is 1 UTF-16 unit and 2 UTF-8 bytes: under 4 KiB by .length, over it on the wire.
    const text = clientFrameOfBytes(PRE_AUTH + 1, 'é');
    expect(text.length).toBeLessThanOrEqual(PRE_AUTH);
    expect(parseClientFrame(text, PRE_AUTH)).toEqual({
      ok: false,
      close: PROTOCOL_ERROR,
    });
    expect(parseClientFrame(text, AUTHENTICATED).ok).toBe(true);
  });

  it('counts a surrogate pair as 4 bytes at the bound', () => {
    expect(
      parseClientFrame(clientFrameOfBytes(PRE_AUTH, '😀'), PRE_AUTH).ok,
    ).toBe(true);
    expect(
      parseClientFrame(clientFrameOfBytes(PRE_AUTH + 1, '😀'), PRE_AUTH).ok,
    ).toBe(false);
  });

  it('applies the post-auth bound of 1 MiB with 3-byte characters', () => {
    expect(
      parseClientFrame(clientFrameOfBytes(AUTHENTICATED, '€'), AUTHENTICATED)
        .ok,
    ).toBe(true);
    expect(
      parseClientFrame(
        clientFrameOfBytes(AUTHENTICATED + 1, '€'),
        AUTHENTICATED,
      ).ok,
    ).toBe(false);
  });
});

describe('parseWorkerFrame', () => {
  it('round-trips result and error responses', () => {
    const result: WorkerFrame = {
      v: 1,
      kind: 'res',
      id: 'r',
      ok: true,
      result: { a: 1 },
    };
    expect(parseWorkerFrame(encodeFrame(result))).toEqual({
      ok: true,
      frame: result,
    });

    const error: WorkerFrame = {
      v: 1,
      kind: 'res',
      id: 'r',
      ok: false,
      error: workerError('TURN_IN_FLIGHT', { detail: { turnId: 't-1' } }),
    };
    expect(parseWorkerFrame(encodeFrame(error))).toEqual({
      ok: true,
      frame: error,
    });
  });

  it('rejects an error frame with an unknown code', () => {
    const text = JSON.stringify({
      v: 1,
      kind: 'res',
      id: 'r',
      ok: false,
      error: { code: 'NOPE', message: 'x' },
    });
    expect(parseWorkerFrame(text)).toEqual({
      ok: false,
      close: PROTOCOL_ERROR,
    });
  });

  it('accepts a captured event and a valid history mark event', () => {
    expect(parseWorkerFrame(evt('chat:chunk', { sessionId: 's-1' })).ok).toBe(
      true,
    );
    expect(
      parseWorkerFrame(
        evt('worker:history-mark', {
          historyMark: { count: 2, lastEventId: 'm-2' },
          turnId: 't-1',
        }),
      ).ok,
    ).toBe(true);
  });

  it.each([
    ['an unknown event type', evt('session:stats-live', {})],
    [
      'a malformed worker record',
      evt('worker:history-mark', { turnId: 't-1' }),
    ],
    ['seq 0', evt('chat:chunk', {}, 0)],
    ['a fractional seq', evt('chat:chunk', {}, 1.5)],
  ])('maps an event with %s to close 4400', (_label, text) => {
    expect(parseWorkerFrame(text)).toEqual({
      ok: false,
      close: PROTOCOL_ERROR,
    });
  });

  it('validates control payloads', () => {
    const ctl = (type: string, payload: unknown) =>
      JSON.stringify({ v: 1, kind: 'ctl', type, payload });

    expect(
      parseWorkerFrame(ctl('resync-required', { sessionId: 's-1' })).ok,
    ).toBe(true);
    expect(
      parseWorkerFrame(
        ctl('session-state', {
          sessionId: 's-1',
          degraded: 'log-write-failed',
        }),
      ).ok,
    ).toBe(true);
    expect(parseWorkerFrame(ctl('goodbye', { reason: 'shutdown' })).ok).toBe(
      true,
    );

    expect(parseWorkerFrame(ctl('resync-required', {}))).toEqual({
      ok: false,
      close: PROTOCOL_ERROR,
    });
    expect(
      parseWorkerFrame(ctl('session-state', { sessionId: 's', degraded: 'x' }))
        .ok,
    ).toBe(false);
    expect(parseWorkerFrame(ctl('reboot', {})).ok).toBe(false);
  });

  it('maps a baseline with a malformed history event to close 4400', () => {
    const text = evt('worker:baseline', {
      events: [{ ...historyEvent, messageId: undefined }],
      historyMark: { count: 1, lastEventId: 'evt-1' },
    });
    expect(parseWorkerFrame(text)).toEqual({
      ok: false,
      close: PROTOCOL_ERROR,
    });
  });

  it('refuses a frame over 1 MiB in UTF-8 bytes that is under it in UTF-16 units', () => {
    const text = evt('chat:chunk', { text: 'é'.repeat(AUTHENTICATED / 2) });
    expect(text.length).toBeLessThan(AUTHENTICATED);
    expect(parseWorkerFrame(text)).toEqual({
      ok: false,
      close: PROTOCOL_ERROR,
    });
  });

  it('maps a client request sent by a worker to close 4400', () => {
    const text = JSON.stringify({
      v: 1,
      kind: 'req',
      id: 'r',
      method: 'hello',
      params: {},
    });
    expect(parseWorkerFrame(text)).toEqual({
      ok: false,
      close: PROTOCOL_ERROR,
    });
  });
});
