/**
 * Zod request schemas for the `outputStyle:` RPC namespace (TASK_2026_197).
 *
 * Every handler parses its params through the matching schema at the trust
 * boundary, before it touches discovery, the file writer or the settings store.
 * A rejection here is an `INVALID_PARAMS` `RpcUserError` and nothing else runs.
 *
 * ## Why the name guard lives in the SCHEMA and not just in the writer
 *
 * `slugifyStyleName` is already the security boundary for what may become a
 * path segment, and `OutputStyleFileWriter.save` calls it. But `get`, `delete`
 * and `activate` reach the filesystem through a directory SCAN keyed on the
 * frontmatter `name`, and a scan is a filesystem call. Plan §13 requires that
 * traversal and reserved-device-name payloads be rejected "before any FS call",
 * so the same guard is lifted to the boundary and applied to every method that
 * accepts a style name. The guard is IMPORTED, never restated — two guards over
 * the same value that disagree about what a name is would be worse than one.
 *
 * A consequence worth stating: a name containing `:` is rejected here. That is
 * correct for every method this namespace exposes — `${plugin}:${style}`
 * identifiers belong to the deferred plugin tier, which Ptah does not
 * enumerate and never activates.
 */
import { z } from 'zod';
import { slugifyStyleName } from '@ptah-extension/output-styles';

const workspaceRoot = z.string().min(1).optional();

/** All four tiers. `plugin` is accepted for reads so the surface stays total. */
const tierEnum = z.enum(['builtin', 'user', 'project', 'plugin']);

/** The two tiers Ptah may write a style FILE into (Req 3.3). */
const writableTierEnum = z.enum(['user', 'project']);

/** The three `.claude/settings*.json` files an opt-in parity write can target (E2). */
const settingsTierEnum = z.enum(['user', 'project', 'local']);

/**
 * A style name that is safe to turn into, or to look up as, a file.
 *
 * The predicate is the slug guard's verdict, not a re-statement of its rules.
 * The message is intentionally generic — the handler collapses every schema
 * failure into one `INVALID_PARAMS` `RpcUserError`, exactly as `tasks:` does,
 * so a per-issue string would never reach a client anyway.
 */
const styleName = z
  .string()
  .refine(
    (value) => slugifyStyleName(value).ok,
    'A style name cannot contain path separators, colons, control characters, "..", or a reserved Windows device name.',
  );

export const OutputStyleListParamsSchema = z.object({ workspaceRoot });

export const OutputStyleGetParamsSchema = z.object({
  workspaceRoot,
  name: styleName,
  tier: tierEnum,
});

/**
 * `parity` is the OPT-IN CLI-parity request (§4.1, §4.2, R6).
 *
 * `.optional()` is load-bearing rather than convenience: a client that says
 * nothing about parity is saying "do not touch my settings files", and the
 * handler's `runParity` never reaches `ClaudeSettingsWriter` for an absent or
 * `enabled: false` request. Default OFF is therefore a property of the wire
 * contract, not a default value someone could change.
 */
export const OutputStyleActivateParamsSchema = z.object({
  workspaceRoot,
  name: styleName.nullable(),
  parity: z.object({ enabled: z.boolean(), tier: settingsTierEnum }).optional(),
});

export const OutputStyleSaveParamsSchema = z.object({
  workspaceRoot,
  tier: writableTierEnum,
  name: styleName,
  description: z.string(),
  keepCodingInstructions: z.boolean(),
  body: z.string(),
  originalName: styleName.optional(),
  // E8 guard stamps, echoed back from `outputStyle:get`. Non-negative because
  // both are counters (epoch ms, byte length), and a negative one would mean
  // the client fabricated it.
  expectedMtime: z.number().int().nonnegative().optional(),
  expectedByteLength: z.number().int().nonnegative().optional(),
  overwrite: z.boolean().optional(),
});

export const OutputStyleDeleteParamsSchema = z.object({
  workspaceRoot,
  name: styleName,
  tier: writableTierEnum,
});

export const OutputStyleDiagnoseParamsSchema = z.object({ workspaceRoot });
