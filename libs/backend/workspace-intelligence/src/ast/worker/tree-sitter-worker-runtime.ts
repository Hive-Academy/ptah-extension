/**
 * Worker-side request handling for the tree-sitter worker process: validate
 * a request, run it on the in-process engine, post one result for it.
 * Transport-free, so specs drive it without a utility process.
 */
import { Result } from '@ptah-extension/shared';
import type {
  TreeSitterEngine,
  TreeSitterLogger,
} from '../tree-sitter-engine';
import { boundAstForTransport } from './ast-transport-bounds';
import {
  boundedLogMessage,
  serializeParserError,
  treeSitterWorkerRequestSchema,
  type TreeSitterWorkerOutbound,
  type TreeSitterWorkerRequest,
  type TreeSitterWorkerValue,
} from './tree-sitter-worker.protocol';

export type TreeSitterWorkerEngine = Pick<
  TreeSitterEngine,
  'queryMulti' | 'query' | 'parse'
>;

type Post = (message: TreeSitterWorkerOutbound) => void;

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/** Engine logging as `log` messages for the host logger. */
export function createForwardingLogger(post: Post): TreeSitterLogger {
  return {
    debug: (message) =>
      post({ kind: 'log', level: 'debug', message: boundedLogMessage(message) }),
    info: (message) =>
      post({ kind: 'log', level: 'info', message: boundedLogMessage(message) }),
    warn: (message) =>
      post({ kind: 'log', level: 'warn', message: boundedLogMessage(message) }),
    error: (message, error) =>
      post({
        kind: 'log',
        level: 'error',
        message: boundedLogMessage(message),
        ...(error ? { error: serializeParserError(error) } : {}),
      }),
  };
}

export class TreeSitterWorkerRuntime {
  constructor(
    private readonly engine: TreeSitterWorkerEngine,
    private readonly post: Post,
  ) {}

  /** Never rejects: every failure becomes an error result or a log. */
  async handle(raw: unknown): Promise<void> {
    const parsed = treeSitterWorkerRequestSchema.safeParse(raw);
    if (!parsed.success) {
      this.rejectInvalid(raw, parsed.error.message);
      return;
    }
    const request = parsed.data;
    let outcome: Result<TreeSitterWorkerValue, Error>;
    try {
      outcome = await this.run(request);
    } catch (error: unknown) {
      outcome = Result.err(toError(error));
    }
    const value = outcome.value;
    this.post(
      value
        ? { kind: 'result', id: request.id, ok: true, value }
        : {
            kind: 'result',
            id: request.id,
            ok: false,
            error: serializeParserError(
              outcome.error ?? new Error(`${request.op} returned no value`),
            ),
          },
    );
  }

  private async run(
    request: TreeSitterWorkerRequest,
  ): Promise<Result<TreeSitterWorkerValue, Error>> {
    switch (request.op) {
      case 'queryMulti': {
        const result = await this.engine.queryMulti(
          request.content,
          request.language,
          request.queries,
        );
        const map = result.value;
        if (!map) return Result.err(this.failure(result.error, request));
        return Result.ok({
          op: 'queryMulti',
          entries: [...map.entries()],
          quality: {
            parseStatus: map.parseStatus,
            errorNodeCount: map.errorNodeCount,
            errorNodeCountCapped: map.errorNodeCountCapped,
          },
        });
      }
      case 'query': {
        const result = await this.engine.query(
          request.content,
          request.language,
          request.queryString,
        );
        const matches = result.value;
        if (!matches) return Result.err(this.failure(result.error, request));
        return Result.ok({ op: 'query', matches });
      }
      case 'parse': {
        const result = await this.engine.parse(request.content, request.language);
        const ast = result.value;
        if (!ast) return Result.err(this.failure(result.error, request));
        // Bounded here, in the worker, so the host never receives more
        // than it can deserialise and check within a main-loop slice.
        return Result.ok({ op: 'parse', ast: boundAstForTransport(ast) });
      }
    }
  }

  private failure(
    error: Error | undefined,
    request: TreeSitterWorkerRequest,
  ): Error {
    return error ?? new Error(`${request.op} failed without an error`);
  }

  /**
   * A request that fails validation still gets a reply when its id is
   * readable, so the host fails that request now instead of at its timeout.
   */
  private rejectInvalid(raw: unknown, issue: string): void {
    const error = new Error(`Invalid tree-sitter worker request: ${issue}`);
    const id =
      typeof raw === 'object' && raw !== null && 'id' in raw ? raw.id : undefined;
    if (typeof id === 'number' && Number.isInteger(id) && id >= 0) {
      this.post({
        kind: 'result',
        id,
        ok: false,
        error: serializeParserError(error),
      });
      return;
    }
    this.post({
      kind: 'log',
      level: 'error',
      message: boundedLogMessage(error.message),
      error: serializeParserError(error),
    });
  }
}
