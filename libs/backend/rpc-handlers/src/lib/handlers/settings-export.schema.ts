/**
 * Zod schema for the settings:import RPC boundary.
 *
 * `PtahSettingsExportSchema` validates the structure of a user-supplied
 * settings export file before any of its fields are accessed.  The handler
 * at `settings-rpc.handlers.ts` replaces the former unchecked
 * `parsedData as PtahSettingsExport` cast with `.safeParse()` against this
 * schema.
 *
 * Version semantics (Q4 decision — Option B):
 *   - `version` MUST be a positive integer present in the payload.
 *   - If `version > CURRENT_SETTINGS_EXPORT_VERSION` the handler returns an
 *     error envelope; older versions are accepted (forward-compatible defaults
 *     supplied via `.passthrough()` on the outer schema).
 *   - The schema uses `.passthrough()` so exports produced by older Ptah
 *     versions that lack unknown fields are not rejected.
 *
 * SECURITY: This file intentionally avoids logging or exposing actual values
 * from the payload — that responsibility belongs to the handler.
 */

import { z } from 'zod';
import { SETTINGS_EXPORT_VERSION } from '@ptah-extension/agent-sdk';

/** The current schema version understood by this build of Ptah. */
export const CURRENT_SETTINGS_EXPORT_VERSION = SETTINGS_EXPORT_VERSION;

/**
 * Zod schema for `PtahSettingsExport`.
 *
 * Uses `.passthrough()` so that export files produced by older Ptah versions
 * (which may lack fields added in future revisions) are not rejected.  The
 * version-too-high guard in the handler provides the forward-compat rejection
 * path for exports from *newer* versions.
 */
export const PtahSettingsExportSchema = z
  .object({
    /** Schema version — must be a positive integer. */
    version: z.number().int().positive(),

    /** ISO 8601 timestamp. */
    exportedAt: z.string(),

    /** Which platform produced the export. */
    source: z.enum(['vscode', 'electron', 'cli']),

    /** Optional license key. */
    licenseKey: z.string().optional(),

    /** Authentication credentials. */
    auth: z
      .object({
        apiKey: z.string().optional(),
        providerKeys: z.record(z.string(), z.string()).optional(),
      })
      .passthrough(),

    /** Non-sensitive configuration values. */
    config: z.record(z.string(), z.unknown()),
  })
  .passthrough();

export type PtahSettingsExportInput = z.infer<typeof PtahSettingsExportSchema>;
