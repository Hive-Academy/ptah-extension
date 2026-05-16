/**
 * Zod schemas for {@link ChatRpcHandlers}.
 *
 * Defense-in-depth at the chat RPC boundary. Follow-up to NODE-NESTJS-3Y:
 * `TypeError: Invalid SessionId format: tab_1778939573732_w43e75q` thrown
 * from `sdk-query-options-builder.ts:583` when an old-format tabId reached
 * the SDK adapter. The frontend root cause was fixed in commit `955dbc18`,
 * but any future bad ID from any caller (CLI, MCP, IPC, an outdated webview)
 * must fail cleanly at the RPC boundary rather than deep inside the SDK.
 *
 * Every chat method that carries a `tabId` or `sessionId` validates it as a
 * UUID v4 here. The shared `UUID_REGEX` from `branded.types` is reused so
 * the schema stays in lockstep with `SessionId.validate` / `TabId.validate`.
 *
 * On refine failure the global RPC dispatcher in
 * `libs/backend/vscode-core/src/messaging/rpc-handler.ts` catches the
 * ZodError and returns a `{ success: false, error }` response to the
 * webview — no crash propagates to the host process or to Sentry.
 *
 * Schemas use `.passthrough()` so unknown fields (model selection, files,
 * thinking config, …) are preserved verbatim for the handler body; we only
 * validate the id fields and trust the rest of the static
 * `ChatStartParams`/`ChatContinueParams`/`ChatResumeParams`/`ChatAbortParams`
 * types past this boundary.
 */

import { z } from 'zod';
import { UUID_REGEX } from '@ptah-extension/shared';

/**
 * UUID v4 string accepted by `SessionId.validate` / `TabId.validate`.
 *
 * Shared by all four schemas below so a single regex change in
 * `branded.types.ts` propagates here automatically.
 */
const uuidString = (label: string) =>
  z
    .string({ error: `${label} must be a string` })
    .refine((value) => UUID_REGEX.test(value), {
      message: `${label} must be a UUID v4`,
    });

/**
 * `chat:start` params — `tabId` is required (REQUIRED for new conversations
 * per `ChatStartParams` docs); everything else is opaque to the schema.
 */
export const ChatStartParamsSchema = z
  .object({
    tabId: uuidString('tabId'),
  })
  .passthrough();

/**
 * `chat:continue` params — both `tabId` and `sessionId` are required
 * (the SDK needs a real session UUID to resume; the tab UUID drives webview
 * event routing).
 */
export const ChatContinueParamsSchema = z
  .object({
    tabId: uuidString('tabId'),
    sessionId: uuidString('sessionId'),
  })
  .passthrough();

/**
 * `chat:resume` params — both `tabId` and `sessionId` are required.
 */
export const ChatResumeParamsSchema = z
  .object({
    tabId: uuidString('tabId'),
    sessionId: uuidString('sessionId'),
  })
  .passthrough();

/**
 * `chat:abort` params — `sessionId` is required. The current
 * `ChatAbortParams` shape only carries `sessionId`; we still validate it
 * with `.passthrough()` so any future addition of `tabId` (Unit-B territory)
 * does not lose its validation when wired in.
 */
export const ChatAbortParamsSchema = z
  .object({
    sessionId: uuidString('sessionId'),
  })
  .passthrough();
