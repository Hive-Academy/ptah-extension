/**
 * Wire envelope, session event types and worker record schemas (plan W1, W7).
 *
 * Frames are JSON text, validated with zod at both ends. A frame that is not
 * JSON or does not match the envelope is a protocol error: the receiver closes
 * the connection with 4400 `protocol-error` ({@link parseClientFrame},
 * {@link parseWorkerFrame}).
 *
 * A client frame is checked for its envelope only. Method names, params and
 * results are validated one layer up, against the method table
 * (`methods.ts`), so that an unknown method after authentication can be
 * answered `INVALID_PARAMS` (W6) instead of tearing the connection down. A
 * worker frame is also checked for the payloads this protocol defines:
 * control payloads and worker records ({@link WORKER_RECORD_SCHEMAS}).
 */

import { z } from 'zod';
import type {
  FlatStreamEventUnion,
  MessageType,
  PermissionRequest,
} from '@ptah-extension/shared';
import {
  WORKER_CLOSE_CODES,
  WorkerErrorSchema,
  workerClose,
  type WorkerClose,
} from './errors';

/** Envelope version. Changes only with {@link PROTOCOL_VERSION}-level breaks. */
export const FRAME_VERSION = 1;

/** Limits (plan W1). */
export const WORKER_LIMITS = Object.freeze({
  /** Largest frame accepted before authentication, in bytes. */
  maxPayloadPreAuthBytes: 4 * 1024,
  /** Largest frame accepted after authentication, in bytes. */
  maxPayloadBytes: 1024 * 1024,
  /** Requests a connection may have in flight at once. */
  maxInFlightRequests: 64,
  /** A connection must authenticate within this time. */
  authTimeoutMs: 10_000,
  /** Client ping interval. */
  pingIntervalMs: 20_000,
  /** A missing pong after this long drops the connection. */
  pongTimeoutMs: 10_000,
  /** Per-call client timeout. */
  callTimeoutMs: 30_000,
  /** Longest client-generated request id. */
  maxRequestIdLength: 64,
});

// ---------------------------------------------------------------------------
// Session event types (W7). The single list the writer, reader and reducer use.
// ---------------------------------------------------------------------------

/** Push events captured from the local backend and logged per session. */
export const CAPTURED_EVENT_TYPES = [
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
] as const satisfies readonly MessageType[];

/** Records the worker writes itself (never routed through the push tap). */
export const WORKER_RECORD_TYPES = [
  'worker:baseline',
  'worker:history-mark',
  'worker:turn.begin',
  'worker:turn.end',
  'worker:turn.interrupted',
  'worker:permission.answered',
] as const;

export const SESSION_EVENT_TYPES = [
  ...CAPTURED_EVENT_TYPES,
  ...WORKER_RECORD_TYPES,
] as const;

export type CapturedEventType = (typeof CAPTURED_EVENT_TYPES)[number];
export type WorkerRecordType = (typeof WORKER_RECORD_TYPES)[number];
export type SessionEventType = (typeof SESSION_EVENT_TYPES)[number];

const SESSION_EVENT_TYPE_SET: ReadonlySet<string> = new Set(
  SESSION_EVENT_TYPES,
);
const WORKER_RECORD_TYPE_SET: ReadonlySet<string> = new Set(
  WORKER_RECORD_TYPES,
);

export function isSessionEventType(value: unknown): value is SessionEventType {
  return typeof value === 'string' && SESSION_EVENT_TYPE_SET.has(value);
}

export function isWorkerRecordType(value: unknown): value is WorkerRecordType {
  return typeof value === 'string' && WORKER_RECORD_TYPE_SET.has(value);
}

// ---------------------------------------------------------------------------
// History events (W8 baseline). The worker's local history reader produces
// FlatStreamEventUnion members; the wire checks the discriminant and each
// member's required fields before the renderer trusts them.
// ---------------------------------------------------------------------------

type FlatStreamEventType = FlatStreamEventUnion['eventType'];

/** Fields every flat stream event carries, with the optional ones typed. */
const FlatStreamEventBaseSchema = z.object({
  id: z.string().min(1),
  timestamp: z.number(),
  messageId: z.string(),
  sessionId: z.string().optional(),
  source: z.enum(['stream', 'complete', 'history', 'hook']).optional(),
  parentToolUseId: z.string().optional(),
  toolCallId: z.string().optional(),
  blockIndex: z.number().optional(),
});

function flatEvent<Shape extends z.ZodRawShape>(shape: Shape) {
  return FlatStreamEventBaseSchema.extend(shape);
}

/** One schema per member of {@link FlatStreamEventUnion}, keyed by `eventType`. */
const FLAT_STREAM_EVENT_SCHEMAS = {
  message_start: flatEvent({ role: z.enum(['user', 'assistant']) }),
  text_delta: flatEvent({ delta: z.string(), blockIndex: z.number() }),
  thinking_start: flatEvent({ blockIndex: z.number() }),
  thinking_delta: flatEvent({ delta: z.string(), blockIndex: z.number() }),
  tool_start: flatEvent({
    toolCallId: z.string(),
    toolName: z.string(),
    isTaskTool: z.boolean(),
  }),
  tool_delta: flatEvent({ toolCallId: z.string(), delta: z.string() }),
  tool_result: flatEvent({
    toolCallId: z.string(),
    output: z.unknown(),
    isError: z.boolean(),
  }),
  agent_start: flatEvent({ toolCallId: z.string(), agentType: z.string() }),
  message_complete: flatEvent({}),
  message_delta: flatEvent({
    tokenUsage: z.object({ input: z.number(), output: z.number() }),
  }),
  signature_delta: flatEvent({
    blockIndex: z.number(),
    signature: z.string(),
  }),
  compaction_start: flatEvent({
    trigger: z.enum(['manual', 'auto']),
    preTokens: z.number(),
  }),
  compaction_complete: flatEvent({ trigger: z.enum(['manual', 'auto']) }),
  background_agent_started: flatEvent({
    toolCallId: z.string(),
    agentType: z.string(),
  }),
  background_agent_completed: flatEvent({
    toolCallId: z.string(),
    agentId: z.string(),
  }),
  background_agent_stopped: flatEvent({
    toolCallId: z.string(),
    agentId: z.string(),
  }),
  background_tasks_snapshot: flatEvent({
    sessionId: z.string(),
    tasks: z.array(
      z.object({
        taskId: z.string(),
        taskType: z.string(),
        description: z.string(),
        status: z.literal('running'),
      }),
    ),
  }),
  agent_progress: flatEvent({
    parentToolUseId: z.string(),
    taskId: z.string(),
    description: z.string(),
    totalTokens: z.number(),
    toolUses: z.number(),
    durationMs: z.number(),
  }),
  agent_status: flatEvent({
    parentToolUseId: z.string(),
    taskId: z.string(),
    status: z.enum([
      'pending',
      'running',
      'completed',
      'failed',
      'killed',
      'paused',
    ]),
  }),
  agent_completed: flatEvent({
    parentToolUseId: z.string(),
    taskId: z.string(),
    status: z.enum(['completed', 'failed', 'stopped']),
    summary: z.string(),
    outputFile: z.string(),
  }),
  turn_state: flatEvent({
    phase: z.enum([
      'generating',
      'awaiting-background',
      'sleeping',
      'idle',
      'failed',
    ]),
    revision: z.number(),
    backgroundTasks: z.array(z.unknown()),
    sessionCrons: z.array(z.unknown()),
    terminalReason: z.string().nullable(),
  }),
} as const satisfies Record<FlatStreamEventType, z.ZodType>;

function isFlatStreamEventType(value: unknown): value is FlatStreamEventType {
  return (
    typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(FLAT_STREAM_EVENT_SCHEMAS, value)
  );
}

function isFlatStreamEvent(value: unknown): value is FlatStreamEventUnion {
  if (typeof value !== 'object' || value === null || !('eventType' in value)) {
    return false;
  }
  const { eventType } = value;
  return (
    isFlatStreamEventType(eventType) &&
    FLAT_STREAM_EVENT_SCHEMAS[eventType].safeParse(value).success
  );
}

/**
 * A history event: `eventType` names a {@link FlatStreamEventUnion} member and
 * the value carries that member's required fields. The event passes through
 * unchanged (optional fields the renderer reads stay in place).
 */
export const FlatStreamEventSchema = z.custom<FlatStreamEventUnion>(
  isFlatStreamEvent,
  { message: 'expected a flat stream event' },
);

// ---------------------------------------------------------------------------
// Worker record payloads (W7 "Worker record serialization", W8).
// ---------------------------------------------------------------------------

/** Identifies a history state: how many events, and the last event's id. */
export const HistoryMarkSchema = z.object({
  count: z.number().int().min(0),
  lastEventId: z.string().min(1).nullable(),
});

export type HistoryMark = z.infer<typeof HistoryMarkSchema>;

const TurnIdSchema = z.string().min(1).max(128);

export const BaselineRecordSchema = z.object({
  events: z.array(FlatStreamEventSchema),
  historyMark: HistoryMarkSchema,
});

export const HistoryMarkRecordSchema = z.object({
  historyMark: HistoryMarkSchema,
  turnId: TurnIdSchema,
});

export const TurnBeginRecordSchema = z.object({ turnId: TurnIdSchema });
export const TurnEndRecordSchema = z.object({ turnId: TurnIdSchema });
export const TurnInterruptedRecordSchema = z.object({ turnId: TurnIdSchema });

export const PermissionAnsweredRecordSchema = z.object({
  requestId: z.string().min(1).max(256),
  decision: z.enum(['allow', 'deny']),
  /** Who answered: the paired client's name, for the transcript. */
  by: z.string().min(1).max(128),
});

export type BaselineRecord = z.infer<typeof BaselineRecordSchema>;
export type HistoryMarkRecord = z.infer<typeof HistoryMarkRecordSchema>;
export type TurnBeginRecord = z.infer<typeof TurnBeginRecordSchema>;
export type TurnEndRecord = z.infer<typeof TurnEndRecordSchema>;
export type TurnInterruptedRecord = z.infer<typeof TurnInterruptedRecordSchema>;
export type PermissionAnsweredRecord = z.infer<
  typeof PermissionAnsweredRecordSchema
>;

/** One schema per worker record type. The writer and the reader both use it. */
export const WORKER_RECORD_SCHEMAS = {
  'worker:baseline': BaselineRecordSchema,
  'worker:history-mark': HistoryMarkRecordSchema,
  'worker:turn.begin': TurnBeginRecordSchema,
  'worker:turn.end': TurnEndRecordSchema,
  'worker:turn.interrupted': TurnInterruptedRecordSchema,
  'worker:permission.answered': PermissionAnsweredRecordSchema,
} as const satisfies Record<WorkerRecordType, z.ZodType>;

/** Typed payloads for the event types the client renders specially. */
export interface SessionEventPayloadMap {
  'permission:request': PermissionRequest;
  'worker:baseline': BaselineRecord;
  'worker:history-mark': HistoryMarkRecord;
  'worker:turn.begin': TurnBeginRecord;
  'worker:turn.end': TurnEndRecord;
  'worker:turn.interrupted': TurnInterruptedRecord;
  'worker:permission.answered': PermissionAnsweredRecord;
}

export type SessionRecordCheck =
  | { readonly ok: true; readonly payload: unknown }
  | { readonly ok: false; readonly reason: 'unknown-type' | 'invalid-payload' };

/**
 * Check one log record before append or after read (W7). A type outside
 * {@link SESSION_EVENT_TYPES} or a worker record whose payload fails its
 * schema is rejected; the caller turns that into an append failure (write)
 * or a corrupt log (read). Captured events pass through unchanged: their
 * shape belongs to the local backend.
 */
export function checkSessionRecord(
  type: string,
  payload: unknown,
): SessionRecordCheck {
  if (!isSessionEventType(type)) {
    return { ok: false, reason: 'unknown-type' };
  }
  if (!isWorkerRecordType(type)) {
    return { ok: true, payload };
  }
  const parsed = WORKER_RECORD_SCHEMAS[type].safeParse(payload);
  return parsed.success
    ? { ok: true, payload: parsed.data }
    : { ok: false, reason: 'invalid-payload' };
}

/** Event id (W1): `${epoch}:${seq}`. */
export function eventId(epoch: string, seq: number): string {
  return `${epoch}:${seq}`;
}

// ---------------------------------------------------------------------------
// Envelope schemas (W1).
// ---------------------------------------------------------------------------

const RequestIdSchema = z.string().min(1).max(WORKER_LIMITS.maxRequestIdLength);
const SessionIdSchema = z.string().min(1).max(256);
const EpochSchema = z.string().min(1).max(64);

/**
 * Client request. `method` is any non-empty name here; whether it exists and
 * whether it is allowed in the connection's state is the gateway's decision
 * (4403 before authentication, `INVALID_PARAMS` after).
 */
export const ClientFrameSchema = z.object({
  v: z.literal(FRAME_VERSION),
  kind: z.literal('req'),
  id: RequestIdSchema,
  method: z.string().min(1).max(64),
  params: z.unknown(),
});

export type ClientFrame = z.infer<typeof ClientFrameSchema>;

export const ResultFrameSchema = z.object({
  v: z.literal(FRAME_VERSION),
  kind: z.literal('res'),
  id: RequestIdSchema,
  ok: z.literal(true),
  result: z.unknown(),
});

export const ErrorFrameSchema = z.object({
  v: z.literal(FRAME_VERSION),
  kind: z.literal('res'),
  id: RequestIdSchema,
  ok: z.literal(false),
  error: WorkerErrorSchema,
});

export const EventFrameSchema = z.object({
  v: z.literal(FRAME_VERSION),
  kind: z.literal('evt'),
  sessionId: SessionIdSchema,
  epoch: EpochSchema,
  seq: z.number().int().min(1),
  type: z.string().min(1).max(64),
  ts: z.number(),
  payload: z.unknown(),
});

export const CONTROL_TYPES = [
  'resync-required',
  'session-state',
  'goodbye',
] as const;

export type ControlType = (typeof CONTROL_TYPES)[number];

export const ControlFrameSchema = z.object({
  v: z.literal(FRAME_VERSION),
  kind: z.literal('ctl'),
  type: z.enum(CONTROL_TYPES),
  payload: z.unknown(),
});

export const WorkerFrameSchema = z.union([
  ResultFrameSchema,
  ErrorFrameSchema,
  EventFrameSchema,
  ControlFrameSchema,
]);

export type ResultFrame = z.infer<typeof ResultFrameSchema>;
export type ErrorFrame = z.infer<typeof ErrorFrameSchema>;
export type EventFrame = z.infer<typeof EventFrameSchema>;
export type ControlFrame = z.infer<typeof ControlFrameSchema>;
export type ResponseFrame = ResultFrame | ErrorFrame;
export type WorkerFrame = z.infer<typeof WorkerFrameSchema>;

// ---------------------------------------------------------------------------
// Control payloads (W7: resync and degraded state; W1 goodbye on shutdown).
// ---------------------------------------------------------------------------

export const ResyncRequiredPayloadSchema = z.object({
  sessionId: SessionIdSchema,
});

export const SessionStatePayloadSchema = z.object({
  sessionId: SessionIdSchema,
  degraded: z.literal('log-write-failed').optional(),
});

export const GoodbyePayloadSchema = z.object({
  reason: z.enum(['shutdown', 'revoked']),
});

export const CONTROL_PAYLOAD_SCHEMAS = {
  'resync-required': ResyncRequiredPayloadSchema,
  'session-state': SessionStatePayloadSchema,
  goodbye: GoodbyePayloadSchema,
} as const satisfies Record<ControlType, z.ZodType>;

export type ResyncRequiredPayload = z.infer<typeof ResyncRequiredPayloadSchema>;
export type SessionStatePayload = z.infer<typeof SessionStatePayloadSchema>;
export type GoodbyePayload = z.infer<typeof GoodbyePayloadSchema>;

// ---------------------------------------------------------------------------
// Encode and parse.
// ---------------------------------------------------------------------------

export type FrameParse<T> =
  | { readonly ok: true; readonly frame: T }
  | { readonly ok: false; readonly close: WorkerClose };

const PROTOCOL_ERROR = workerClose(WORKER_CLOSE_CODES.PROTOCOL_ERROR);

/** Serialize a frame as one JSON text message. */
export function encodeFrame(frame: ClientFrame | WorkerFrame): string {
  return JSON.stringify(frame);
}

/**
 * Parse an inbound client frame; malformed or oversized input maps to close
 * 4400. `maxBytes` is the bound for the connection's phase:
 * {@link WORKER_LIMITS.maxPayloadPreAuthBytes} before authentication,
 * {@link WORKER_LIMITS.maxPayloadBytes} after. It is checked in UTF-8 bytes
 * before the text is parsed.
 */
export function parseClientFrame(
  text: string,
  maxBytes: number,
): FrameParse<ClientFrame> {
  return parseWith(ClientFrameSchema, text, maxBytes);
}

/**
 * Parse an inbound worker frame; malformed input maps to close 4400.
 *
 * Beyond the envelope, the payloads the protocol itself defines are checked
 * here: `ctl` payloads against {@link CONTROL_PAYLOAD_SCHEMAS}, and `evt`
 * frames against {@link checkSessionRecord} (a type outside
 * {@link SESSION_EVENT_TYPES}, or a worker record whose payload fails its
 * schema). Both sides negotiated the same protocol version, so either is a
 * broken peer, not version skew.
 *
 * Text over `maxBytes` UTF-8 bytes is refused before it is parsed.
 */
export function parseWorkerFrame(
  text: string,
  maxBytes: number = WORKER_LIMITS.maxPayloadBytes,
): FrameParse<WorkerFrame> {
  const parsed = parseWith(WorkerFrameSchema, text, maxBytes);
  if (!parsed.ok) {
    return parsed;
  }
  const { frame } = parsed;
  if (frame.kind === 'ctl') {
    const payload = CONTROL_PAYLOAD_SCHEMAS[frame.type].safeParse(
      frame.payload,
    );
    return payload.success
      ? { ok: true, frame: { ...frame, payload: payload.data } }
      : { ok: false, close: PROTOCOL_ERROR };
  }
  if (frame.kind === 'evt') {
    const record = checkSessionRecord(frame.type, frame.payload);
    return record.ok
      ? { ok: true, frame: { ...frame, payload: record.payload } }
      : { ok: false, close: PROTOCOL_ERROR };
  }
  return parsed;
}

function parseWith<T>(
  schema: z.ZodType<T>,
  text: string,
  maxBytes: number,
): FrameParse<T> {
  if (!fitsUtf8Bytes(text, maxBytes)) {
    return { ok: false, close: PROTOCOL_ERROR };
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    // Not JSON at all: the same protocol error as a JSON value with the wrong
    // shape. The SyntaxError text is never sent or needed.
    return { ok: false, close: PROTOCOL_ERROR };
  }
  const parsed = schema.safeParse(json);
  return parsed.success
    ? { ok: true, frame: parsed.data }
    : { ok: false, close: PROTOCOL_ERROR };
}

/**
 * Whether `text` encodes to at most `maxBytes` UTF-8 bytes, as the socket
 * sends it. A UTF-16 code unit takes 1 to 3 bytes and a surrogate pair 4, so
 * the length alone settles most inputs; the rest are counted, stopping at the
 * bound. A lone surrogate counts 3 bytes, the size of the U+FFFD it is sent as.
 */
function fitsUtf8Bytes(text: string, maxBytes: number): boolean {
  if (text.length > maxBytes) {
    return false;
  }
  if (text.length * 3 <= maxBytes) {
    return true;
  }
  let bytes = 0;
  for (let i = 0; i < text.length; i += 1) {
    const unit = text.charCodeAt(i);
    if (unit < 0x80) {
      bytes += 1;
    } else if (unit < 0x800) {
      bytes += 2;
    } else if (
      unit >= 0xd800 &&
      unit <= 0xdbff &&
      i + 1 < text.length &&
      isLowSurrogate(text.charCodeAt(i + 1))
    ) {
      bytes += 4;
      i += 1;
    } else {
      bytes += 3;
    }
    if (bytes > maxBytes) {
      return false;
    }
  }
  return true;
}

function isLowSurrogate(unit: number): boolean {
  return unit >= 0xdc00 && unit <= 0xdfff;
}
