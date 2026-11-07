import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  workerError,
  type WorkerError,
  type WorkerErrorCode,
} from '@ptah-extension/worker-protocol';
import type { RpcMethodParams, RpcMethodResult } from '@ptah-extension/shared';
import { redactText } from './redact';

type LocalMethod =
  'session:list' | 'chat:start' | 'chat:continue' | 'chat:abort';
export interface RpcHandlerPort {
  handleMessage(message: {
    method: string;
    params: unknown;
    correlationId: string;
  }): Promise<unknown>;
}
export type RpcCall<T> =
  { ok: true; value: T } | { ok: false; error: WorkerError };
export interface RpcSpec<T> {
  readonly result: z.ZodType<T>;
  readonly nested?: (
    data: T,
  ) =>
    | { ok: true; value: T }
    | { ok: false; errorCode?: string; error?: string; detail?: unknown };
}
const Envelope = z.discriminatedUnion('success', [
  z.object({ success: z.literal(true), data: z.unknown() }),
  z.object({
    success: z.literal(false),
    errorCode: z.string().optional(),
    error: z.string().optional(),
    detail: z.unknown().optional(),
  }),
]);
const Nested = z
  .object({
    success: z.boolean(),
    errorCode: z.string().optional(),
    error: z.string().optional(),
    providerId: z.string().optional(),
    enqueued: z.literal(true).optional(),
  })
  .passthrough();
const chatSpec: RpcSpec<z.infer<typeof Nested>> = {
  result: Nested,
  nested: (data) =>
    data.success
      ? { ok: true, value: data }
      : {
          ok: false,
          errorCode: data.errorCode,
          error: data.error,
          detail: { providerId: data.providerId },
        },
};
export const IN_PROCESS_SPECS = {
  'session:list': {
    result: z
      .object({
        sessions: z.array(
          z
            .object({
              id: z.string(),
              name: z.string(),
              messageCount: z.number(),
              createdAt: z.number(),
              lastActivityAt: z.number(),
              isActive: z.boolean(),
              providerId: z.string().optional(),
            })
            .passthrough(),
        ),
        total: z.number(),
        hasMore: z.boolean(),
      })
      .passthrough(),
  },
  'chat:start': chatSpec,
  'chat:continue': chatSpec,
  'chat:abort': chatSpec,
} as const;
const ERROR_MAP: Readonly<Record<string, WorkerErrorCode>> = {
  AUTH_REQUIRED: 'NO_PROVIDER_READY',
  UNAUTHORIZED_WORKSPACE: 'NOT_FOUND_OR_FORBIDDEN',
  SESSION_DRIVEN_ELSEWHERE: 'SESSION_DRIVEN_ELSEWHERE',
  SESSION_DRIVER_LOCK_UNAVAILABLE: 'DRIVER_LOCK_UNAVAILABLE',
  SESSION_ATTACHED_TO_GATEWAY: 'SESSION_DRIVEN_ELSEWHERE',
};

export class InProcessRpc {
  constructor(
    private readonly handler: RpcHandlerPort,
    private readonly log: (ref: string, error: string) => void = () =>
      undefined,
  ) {}

  async call<M extends LocalMethod>(
    method: M,
    params: RpcMethodParams<M>,
    spec: RpcSpec<RpcMethodResult<M>>,
  ): Promise<RpcCall<RpcMethodResult<M>>> {
    try {
      const response = Envelope.safeParse(
        await this.handler.handleMessage({
          method,
          params,
          correlationId: randomUUID(),
        }),
      );
      if (!response.success)
        return this.failure(undefined, 'Malformed RPC envelope');
      if (!response.data.success)
        return this.failure(
          response.data.errorCode,
          response.data.error,
          response.data.detail,
        );
      const parsed = spec.result.safeParse(response.data.data);
      if (!parsed.success)
        return this.failure(undefined, 'Malformed RPC result');
      if (spec.nested) {
        const nested = spec.nested(parsed.data);
        if (!nested.ok)
          return this.failure(nested.errorCode, nested.error, nested.detail);
        return { ok: true, value: nested.value };
      }
      return { ok: true, value: parsed.data };
    } catch (error) {
      return this.failure(
        undefined,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private failure(
    code?: string,
    raw?: string,
    detail?: unknown,
  ): RpcCall<never> {
    const ref = randomUUID();
    this.log(ref, redactText(raw ?? 'Unknown RPC failure'));
    return {
      ok: false,
      error: workerError(ERROR_MAP[code ?? ''] ?? 'INTERNAL', { ref, detail }),
    };
  }
}
