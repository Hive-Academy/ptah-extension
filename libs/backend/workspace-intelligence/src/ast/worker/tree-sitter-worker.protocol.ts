/**
 * Messages between the host and the tree-sitter utility process.
 *
 * Both directions are validated where they arrive: the worker parses every
 * request, the host parses every reply before a caller sees it. Errors cross
 * as a bounded name/message/stack copy; a parser refusal keeps its reason so
 * `parserFailureReason` classifies a worker failure exactly as an in-process
 * one.
 */
import { z } from 'zod';
import type { CodePosition, GenericAstNode, SupportedLanguage } from '../ast.types';
import { GRAMMAR_FILE_MAP } from '../tree-sitter.config';
import { ParserRefusalError } from '../parser-refusal';
import {
  TRANSPORT_AST_LIMITS,
  UNBOUNDED_AST_LIMITS,
  isGenericAstNode,
} from './ast-transport-bounds';
import type { QueryCapture, QueryMatch } from '../tree-sitter-engine';

const MAX_NAME_CHARS = 200;
const MAX_MESSAGE_CHARS = 4_000;
const MAX_STACK_CHARS = 8_000;

const languageSchema = z.custom<SupportedLanguage>(
  (value) => typeof value === 'string' && Object.hasOwn(GRAMMAR_FILE_MAP, value),
  { message: 'unsupported tree-sitter language' },
);

const requestIdSchema = z.number().int().nonnegative();

const queryEntrySchema = z.object({ key: z.string(), queryString: z.string() });

export const treeSitterWorkerRequestSchema = z.discriminatedUnion('op', [
  z.object({
    kind: z.literal('request'),
    id: requestIdSchema,
    op: z.literal('queryMulti'),
    content: z.string(),
    language: languageSchema,
    queries: z.array(queryEntrySchema),
  }),
  z.object({
    kind: z.literal('request'),
    id: requestIdSchema,
    op: z.literal('query'),
    content: z.string(),
    language: languageSchema,
    queryString: z.string(),
  }),
  z.object({
    kind: z.literal('request'),
    id: requestIdSchema,
    op: z.literal('parse'),
    content: z.string(),
    language: languageSchema,
  }),
]);

export type TreeSitterWorkerRequest = z.infer<typeof treeSitterWorkerRequestSchema>;

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

/** A request before the client assigns its id. */
export type TreeSitterWorkerJob = DistributiveOmit<
  TreeSitterWorkerRequest,
  'id' | 'kind'
>;

const positionSchema: z.ZodType<CodePosition> = z.object({
  row: z.number(),
  column: z.number(),
});

/**
 * AST nodes are checked by an iterative guard, not a recursive schema: one
 * pass with no per-node allocation, so checking a reply costs little next
 * to deserialising it (see `ast-transport-bounds.ts`).
 */
const genericAstNodeSchema = z.custom<GenericAstNode>(
  (value) => isGenericAstNode(value, UNBOUNDED_AST_LIMITS),
  { message: 'invalid AST node' },
);

/** A `parse` reply's tree, re-checked against the worker's transport bound. */
const boundedAstSchema = z.custom<GenericAstNode>(
  (value) => isGenericAstNode(value, TRANSPORT_AST_LIMITS),
  { message: 'AST is not a tree within the transport bound' },
);

const captureSchema: z.ZodType<QueryCapture> = z.object({
  name: z.string(),
  node: genericAstNodeSchema,
  text: z.string(),
  startPosition: positionSchema,
  endPosition: positionSchema,
});

const matchSchema: z.ZodType<QueryMatch> = z.object({
  pattern: z.number(),
  captures: z.array(captureSchema),
});

const qualitySchema = z.object({
  parseStatus: z.enum(['ok', 'recovered', 'unknown']).optional(),
  errorNodeCount: z.number().nullable().optional(),
  errorNodeCountCapped: z.boolean().optional(),
});

/**
 * `queryMulti` returns a `Map` carrying parse-quality own properties; a
 * structured clone keeps the entries but drops those properties, so the reply
 * carries both explicitly and the host rebuilds the same object.
 */
export const treeSitterWorkerValueSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('queryMulti'),
    entries: z.array(z.tuple([z.string(), z.array(matchSchema)])),
    quality: qualitySchema,
  }),
  z.object({ op: z.literal('query'), matches: z.array(matchSchema) }),
  z.object({ op: z.literal('parse'), ast: boundedAstSchema }),
]);

export type TreeSitterWorkerValue = z.infer<typeof treeSitterWorkerValueSchema>;

export const serializedParserErrorSchema = z.object({
  name: z.string().max(MAX_NAME_CHARS),
  message: z.string().max(MAX_MESSAGE_CHARS),
  stack: z.string().max(MAX_STACK_CHARS).optional(),
  refusal: z.enum(['grammar-unavailable', 'too-large']).optional(),
});

export type SerializedParserError = z.infer<typeof serializedParserErrorSchema>;

/** Only the routing fields, read first so a bad body can still fail its own request. */
export const treeSitterWorkerResultEnvelopeSchema = z.object({
  kind: z.literal('result'),
  id: requestIdSchema,
});

export const treeSitterWorkerResultSchema = z.discriminatedUnion('ok', [
  z.object({
    kind: z.literal('result'),
    id: requestIdSchema,
    ok: z.literal(true),
    value: treeSitterWorkerValueSchema,
  }),
  z.object({
    kind: z.literal('result'),
    id: requestIdSchema,
    ok: z.literal(false),
    error: serializedParserErrorSchema,
  }),
]);

export type TreeSitterWorkerResult = z.infer<typeof treeSitterWorkerResultSchema>;

export const treeSitterWorkerLogSchema = z.object({
  kind: z.literal('log'),
  level: z.enum(['debug', 'info', 'warn', 'error']),
  message: z.string().max(MAX_MESSAGE_CHARS),
  error: serializedParserErrorSchema.optional(),
});

export type TreeSitterWorkerLog = z.infer<typeof treeSitterWorkerLogSchema>;

export type TreeSitterWorkerOutbound = TreeSitterWorkerResult | TreeSitterWorkerLog;

/** Bounded, clonable copy of `error`; own properties are never copied. */
export function serializeParserError(error: Error): SerializedParserError {
  return {
    name: error.name.slice(0, MAX_NAME_CHARS),
    message: error.message.slice(0, MAX_MESSAGE_CHARS),
    ...(typeof error.stack === 'string'
      ? { stack: error.stack.slice(0, MAX_STACK_CHARS) }
      : {}),
    ...(error instanceof ParserRefusalError ? { refusal: error.reason } : {}),
  };
}

/** A real `Error` (a `ParserRefusalError` for a refusal) with the worker's stack. */
export function rebuildParserError(serialized: SerializedParserError): Error {
  const error = serialized.refusal
    ? new ParserRefusalError(serialized.refusal, serialized.message)
    : new Error(serialized.message);
  error.name = serialized.name;
  if (serialized.stack !== undefined) error.stack = serialized.stack;
  return error;
}

/** Clip a log line to what the host accepts. */
export function boundedLogMessage(message: string): string {
  return message.slice(0, MAX_MESSAGE_CHARS);
}
