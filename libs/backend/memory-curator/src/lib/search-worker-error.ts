/**
 * Error shape that crosses the search worker -> host process boundary.
 *
 * Structured clone keeps an `Error`'s message but not reliably its stack or
 * cause, and a library can hang arbitrary own properties (SQL text, bound
 * parameters) on an error. So the worker sends only name, message, stack and
 * the cause chain, each bounded, and the host rebuilds a real `Error` for its
 * logger.
 */
import { z } from 'zod';

const MAX_NAME_CHARS = 200;
const MAX_MESSAGE_CHARS = 2_000;
const MAX_STACK_CHARS = 8_000;
/** Causes kept below the top-level error. */
const MAX_CAUSE_DEPTH = 3;

export interface SerializedWorkerError {
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
  readonly cause?: SerializedWorkerError;
}

export const serializedWorkerErrorSchema: z.ZodType<SerializedWorkerError> = z.lazy(() =>
  z.object({
    name: z.string().max(MAX_NAME_CHARS),
    message: z.string().max(MAX_MESSAGE_CHARS),
    stack: z.string().max(MAX_STACK_CHARS).optional(),
    cause: serializedWorkerErrorSchema.optional(),
  }),
);

/** Bounded, transferable copy of `error`; own properties are never copied. */
export function serializeWorkerError(error: Error, depth = 0): SerializedWorkerError {
  const cause = depth < MAX_CAUSE_DEPTH ? serializeCause(error.cause, depth + 1) : undefined;
  return {
    name: error.name.slice(0, MAX_NAME_CHARS),
    message: error.message.slice(0, MAX_MESSAGE_CHARS),
    ...(typeof error.stack === 'string' ? { stack: error.stack.slice(0, MAX_STACK_CHARS) } : {}),
    ...(cause ? { cause } : {}),
  };
}

/** A real `Error` for the host logger, with the worker's stack and cause chain. */
export function rebuildWorkerError(serialized: SerializedWorkerError): Error {
  const error = serialized.cause
    ? new Error(serialized.message, { cause: rebuildWorkerError(serialized.cause) })
    : new Error(serialized.message);
  error.name = serialized.name;
  if (serialized.stack !== undefined) error.stack = serialized.stack;
  return error;
}

function serializeCause(cause: unknown, depth: number): SerializedWorkerError | undefined {
  if (cause === undefined || cause === null) return undefined;
  if (cause instanceof Error) return serializeWorkerError(cause, depth);
  // A non-Error cause keeps only its primitive text; objects may carry data.
  const text = typeof cause === 'string' || typeof cause === 'number' || typeof cause === 'boolean'
    ? String(cause)
    : `non-Error cause (${typeof cause})`;
  return { name: 'NonErrorCause', message: text.slice(0, MAX_MESSAGE_CHARS) };
}
