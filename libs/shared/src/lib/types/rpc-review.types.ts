import type { z } from 'zod';
import type { ReviewRpcSchemas } from '@ptah-extension/review-contracts';

/** The wire shape is inferred from the authoritative Zod schemas. */
export type ReviewP1RpcMethod = Exclude<keyof typeof ReviewRpcSchemas,
  'review:verifyBot' | 'review:replaceBotToken' | 'review:removeBotToken'>;
export type ReviewRpcMethodRegistry = {
  [M in ReviewP1RpcMethod]: {
    params: z.input<(typeof ReviewRpcSchemas)[M]['params']>;
    result: z.output<(typeof ReviewRpcSchemas)[M]['result']>;
  };
};
export type ReviewP2RpcMethodRegistry = {
  'review:getBotIdentity': { params: Record<string, never>; result: { login: string; scopes: string[]; connectedAt: string; verifiedAt: string | null; tokenStorage: 'encrypted' | 'plaintext' } | null };
  'review:setBotToken': { params: { token: string }; result: { ok: true } };
  'review:clearBotToken': { params: Record<string, never>; result: { ok: true } };
  'review:rerun': { params: { attemptId: string; dryRun: boolean }; result: { attemptId: string } };
};
