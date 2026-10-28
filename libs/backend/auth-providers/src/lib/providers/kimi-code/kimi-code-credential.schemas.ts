/**
 * Zod schemas for the Kimi Code CLI credential boundary: the token file under
 * `~/.kimi-code/credentials/` and the OAuth refresh response.
 *
 * Both use `.passthrough()` so a write-back preserves every field the CLI
 * stores, including ones this code does not know.
 */
import { z } from 'zod';

/** Scope value the Kimi Code CLI writes into its token file. */
export const KIMI_CODE_TOKEN_SCOPE = 'kimi-code';

/** `~/.kimi-code/credentials/<name>.json`. `expires_at` is unix seconds. */
export const kimiCodeTokenFileSchema = z
  .object({
    access_token: z.string().min(1),
    refresh_token: z.string().min(1),
    expires_at: z.number().finite(),
    scope: z.string(),
    token_type: z.string(),
    expires_in: z.number().finite().optional(),
  })
  .passthrough();

export type KimiCodeTokenFile = z.infer<typeof kimiCodeTokenFileSchema>;

/**
 * `POST {oauth_host}/api/oauth/token` success body.
 *
 * The verified contract rotates the pair on every refresh: a non-empty
 * `refresh_token` and a positive `expires_in` (seconds) are required, and the
 * expiry is computed as now + `expires_in`. A body without them is malformed
 * and nothing is persisted. If the server rotated the pair server-side and
 * still sent such a body, the old refresh token is consumed and the user has
 * to run `kimi login` again; that cannot be recovered locally.
 */
export const kimiCodeRefreshResponseSchema = z
  .object({
    access_token: z.string().min(1),
    refresh_token: z.string().min(1),
    expires_in: z.number().positive().finite(),
    token_type: z.string().optional(),
    scope: z.string().optional(),
  })
  .passthrough();

export type KimiCodeRefreshResponse = z.infer<
  typeof kimiCodeRefreshResponseSchema
>;

/**
 * `<token file>.ptah-refresh.lock` and its takeover guard
 * `<lock>.takeover`: written by Ptah only. `owner` is a random nonce per
 * acquisition, so a process releases only the file it created. `pid` is the
 * writer's process id, used to tell a dead guard holder from a paused one;
 * files written before it existed have none.
 */
export const kimiCodeRefreshLockSchema = z
  .object({
    owner: z.string().min(1),
    pid: z.number().int().positive().optional(),
  })
  .passthrough();

/** OAuth error body (`{ "error": "invalid_grant" }`). */
export const kimiCodeOAuthErrorSchema = z.object({ error: z.string() });

/** `~/.kimi-code/device_id`: UUID-shaped, else the header is omitted. */
export const kimiCodeDeviceIdSchema = z
  .string()
  .trim()
  .regex(/^[0-9A-Fa-f]{8}-?[0-9A-Fa-f]{4}-?[0-9A-Fa-f]{4}-?[0-9A-Fa-f]{4}-?[0-9A-Fa-f]{12}$/);

/** `~/.kimi-code/region`. */
export const kimiCodeRegionSchema = z.enum(['global', 'mainland-cn']);

export type KimiCodeRegion = z.infer<typeof kimiCodeRegionSchema>;
