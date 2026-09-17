/**
 * Zod schema for {@link FileViewRpcHandlers}.
 *
 * `file:viewContent` carries three caller-supplied path strings straight into
 * a path policy that will `realpath` and `stat` them, so the shape is checked
 * before any of that runs. `.strict()` matters here beyond tidiness: an
 * unknown key is a caller that believes it is passing an option this handler
 * honours, and silently ignoring it is how a "workspaceRoot" typo turns into a
 * read against the wrong base.
 *
 * The 4096-character cap is a denial-of-service bound, not a correctness one —
 * the path policy is the authority on what is actually resolvable.
 */
import { z } from 'zod';

const PATH_FIELD = z.string().min(1).max(4096);

export const FileViewContentParamsSchema = z
  .object({
    path: PATH_FIELD,
    workspaceRoot: PATH_FIELD.optional(),
    documentPath: PATH_FIELD.optional(),
  })
  .strict();
