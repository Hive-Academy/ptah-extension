/**
 * Zod schemas for {@link UpdateRpcHandlers}.
 *
 * The read and trigger methods accept empty payloads; `update:mark-downloaded`
 * carries the version the user downloaded. Schemas are kept here so they can be
 * unit-tested in isolation without spinning up the full handler surface.
 */

import { z } from 'zod';

/** Validated shape for the `update:get-state` RPC method. */
export const UpdateGetStateSchema = z.object({});

export type UpdateGetStateInput = z.infer<typeof UpdateGetStateSchema>;

/** Validated shape for the `update:check-now` RPC method. */
export const UpdateCheckNowSchema = z.object({});

export type UpdateCheckNowInput = z.infer<typeof UpdateCheckNowSchema>;

/**
 * Validated shape for the `update:mark-downloaded` RPC method.
 *
 * The version reaches a persisted store key, so it is bounded here rather than
 * accepted as an arbitrary string.
 */
export const UpdateMarkDownloadedSchema = z.object({
  version: z.string().min(1).max(64),
});

export type UpdateMarkDownloadedInput = z.infer<
  typeof UpdateMarkDownloadedSchema
>;
