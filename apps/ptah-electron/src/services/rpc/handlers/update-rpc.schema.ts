/**
 * Zod schemas for {@link UpdateRpcHandlers}.
 *
 * All update RPC methods accept empty payloads. Schemas are kept here so they
 * can be unit-tested in isolation without spinning up the full handler surface.
 */

import { z } from 'zod';

/** Validated shape for the `update:get-state` RPC method. */
export const UpdateGetStateSchema = z.object({});

export type UpdateGetStateInput = z.infer<typeof UpdateGetStateSchema>;

/** Validated shape for the `update:check-now` RPC method. */
export const UpdateCheckNowSchema = z.object({});

export type UpdateCheckNowInput = z.infer<typeof UpdateCheckNowSchema>;

/** Validated shape for the `update:download-now` RPC method. */
export const UpdateDownloadNowSchema = z.object({});

export type UpdateDownloadNowInput = z.infer<typeof UpdateDownloadNowSchema>;

/** Validated shape for the `update:install-now` RPC method. */
export const UpdateInstallNowSchema = z.object({});

export type UpdateInstallNowInput = z.infer<typeof UpdateInstallNowSchema>;
