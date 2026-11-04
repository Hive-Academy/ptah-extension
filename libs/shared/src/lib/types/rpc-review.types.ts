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
