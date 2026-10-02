/**
 * Zod schema for {@link FileEditRpcHandlers}.
 *
 * `file:saveContent` carries a caller-supplied path into the same policy that
 * `file:viewContent` uses, and then WRITES. The shape is checked before any
 * filesystem call. `.strict()` refuses unknown keys for the same reason as
 * `file-view-rpc.schema.ts`: a caller passing an option this handler does not
 * honour must hear "invalid", not have it silently dropped. There is no
 * `documentPath` here — a save always targets a file the user opened, so the
 * preview-link base hint has no meaning.
 *
 * `content` is bounded by the byte cap in the handler, not here, so that an
 * oversized buffer is reported as `too-large` rather than `invalid-request`.
 */
import { z } from 'zod';

const PATH_FIELD = z.string().min(1).max(4096);

export const FileSaveContentParamsSchema = z
  .object({
    path: PATH_FIELD,
    workspaceRoot: PATH_FIELD.optional(),
    content: z.string(),
    /** Lowercase hex sha256, exactly as `file:viewContent` reports it. */
    expectedSha256: z.string().regex(/^[0-9a-f]{64}$/),
    overwrite: z.boolean().optional(),
  })
  .strict();
