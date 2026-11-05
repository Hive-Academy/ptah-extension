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
 * validate the id, surface mode, MCP tool profile and account selection fields (the
 * selection reuses the strict shared `ProviderAccountSelectionSchema`, so a
 * malformed shape is rejected rather than passed through) and trust the rest of the static
 * `ChatStartParams`/`ChatContinueParams`/`ChatResumeParams`/`ChatAbortParams`
 * types past this boundary.
 */

import { z } from 'zod';
import {
  HISTORY_PAGE_MAX_EVENTS,
  MCP_TOOL_PROFILES,
  UUID_REGEX,
} from '@ptah-extension/shared';
import { ProviderAccountSelectionSchema } from '@ptah-extension/shared/schemas';

/** Maximum renderer-supplied persona length at the RPC boundary. */
export const SYSTEM_PROMPT_MAX_LENGTH = 16 * 1024;
const SystemPromptSchema = z
  .string({ error: 'systemPrompt must be a string' })
  .max(SYSTEM_PROMPT_MAX_LENGTH, 'systemPrompt exceeds maximum length')
  .optional();

const HistoryPageSizeSchema = z
  .number()
  .int()
  .min(1)
  .max(HISTORY_PAGE_MAX_EVENTS);

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
 * per `ChatStartParams` docs); surface mode and MCP tool profile are optional.
 */
export const ChatStartParamsSchema = z
  .object({
    tabId: uuidString('tabId'),
    options: z
      .object({ systemPrompt: SystemPromptSchema })
      .passthrough()
      .optional(),
    surfaceMode: z.boolean().optional(),
    mcpToolProfile: z.enum(MCP_TOOL_PROFILES).optional(),
    ptahUiFence: z.boolean().optional(),
    accountSelection: ProviderAccountSelectionSchema.optional(),
  })
  .passthrough();

/**
 * `chat:continue` params — both `tabId` and `sessionId` are required
 * (the SDK needs a real session UUID to resume; the tab UUID drives webview
 * event routing).
 */
const QueuedPayloadSchema = z.object({
  prompt: z.string({ error: 'prompt must be a string' }).min(1).max(1024 * 1024),
  files: z.array(z.string().min(1).max(4096)).max(64).optional(),
  images: z.array(z.object({
    data: z.string().min(1).max(20 * 1024 * 1024),
    mediaType: z.string().min(1).max(128),
  }).strict()).max(16).optional(),
});

export const ChatContinueParamsSchema = z
  .object({
    clientMessageId: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[A-Za-z0-9_-]+$/)
      .optional(),
    systemPrompt: SystemPromptSchema,
    tabId: uuidString('tabId'),
    sessionId: uuidString('sessionId'),
    surfaceMode: z.boolean().optional(),
    mcpToolProfile: z.enum(MCP_TOOL_PROFILES).optional(),
    ptahUiFence: z.boolean().optional(),
    accountSelection: ProviderAccountSelectionSchema.optional(),
    /** Backend-owned follow-up (TASK_2026_884). */
    queueIntent: z.literal('next-turn').optional(),
  })
  .passthrough()
  .superRefine((value, ctx) => {
    if (value.queueIntent !== undefined) {
      const parsed = QueuedPayloadSchema.safeParse(value);
      if (!parsed.success) for (const issue of parsed.error.issues)
        ctx.addIssue({ code: 'custom', path: issue.path, message: issue.message });
    }
    // A held follow-up is addressed by its id for its whole life (state
    // events, withdraw, steer), so a queued send must carry a real UUID.
    if (
      value.queueIntent !== undefined &&
      (value.clientMessageId === undefined ||
        !UUID_REGEX.test(value.clientMessageId))
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['clientMessageId'],
        message: 'clientMessageId must be a UUID v4 when queueIntent is set',
      });
    }
  });

/** `chat:queued-list` params (TASK_2026_884). Unknown fields are rejected. */
export const ChatQueuedListParamsSchema = z
  .object({
    sessionId: uuidString('sessionId'),
    tabId: uuidString('tabId'),
  })
  .strict();

/**
 * `chat:queued-withdraw` / `chat:queued-steer` params (TASK_2026_884). Only a
 * UUID follow-up can be held, so the id is validated as one.
 */
export const ChatQueuedItemParamsSchema = z
  .object({
    sessionId: uuidString('sessionId'),
    tabId: uuidString('tabId'),
    clientMessageId: uuidString('clientMessageId'),
  })
  .strict();

/**
 * `chat:resume` params — both `tabId` and `sessionId` are required.
 */
export const ChatResumeParamsSchema = z
  .object({
    systemPrompt: SystemPromptSchema,
    tabId: uuidString('tabId'),
    sessionId: uuidString('sessionId'),
    ptahUiFence: z.boolean().optional(),
    historyBlockOwners: z.literal(true).optional(),
    historyPage: z
      .object({ maxEvents: HistoryPageSizeSchema })
      .strict()
      .optional(),
    accountSelection: ProviderAccountSelectionSchema.optional(),
  })
  .passthrough();

/** v2 viewport preferences. Unknown fields are rejected at this boundary. */
export const ChatSetStreamViewportParamsSchema = z
  .object({
    protocolVersion: z.literal(2),
    focusedTabId: uuidString('focusedTabId').optional(),
    visibleTabIds: z.array(uuidString('visibleTabIds')).max(128),
    resyncTabIds: z.array(uuidString('resyncTabIds')).max(128).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (new Set(value.visibleTabIds).size !== value.visibleTabIds.length) {
      ctx.addIssue({
        code: 'custom',
        message: 'visibleTabIds must not contain duplicates',
      });
    }
    if (
      value.resyncTabIds &&
      new Set(value.resyncTabIds).size !== value.resyncTabIds.length
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'resyncTabIds must not contain duplicates',
      });
    }
  });

/** Side-effect-free older-history page request. */
export const ChatHistoryPageParamsSchema = z
  .object({
    sessionId: uuidString('sessionId'),
    cursor: z.string().min(1).max(4096),
    maxEvents: HistoryPageSizeSchema.optional(),
    workspacePath: z.string().min(1).optional(),
  })
  .strict();

/** Longest workspace path accepted by the carry-over methods. */
const CARRY_OVER_WORKSPACE_PATH_MAX_LENGTH = 4096;
/** Longest tab name accepted by `chat:carry-over`. */
const CARRY_OVER_NAME_MAX_LENGTH = 200;

/**
 * `chat:carry-over-check` params. Read-only eligibility probe for the banner
 * button. Unknown fields are rejected at this boundary.
 */
export const ChatCarryOverCheckParamsSchema = z
  .object({
    sessionId: uuidString('sessionId'),
    workspacePath: z.string().min(1).max(CARRY_OVER_WORKSPACE_PATH_MAX_LENGTH),
  })
  .strict();

/**
 * `chat:carry-over` params. Starts a new session for `tabId` on the active
 * provider from the refused session's history. Unknown fields are rejected.
 */
export const ChatCarryOverParamsSchema = z
  .object({
    sessionId: uuidString('sessionId'),
    tabId: uuidString('tabId'),
    workspacePath: z.string().min(1).max(CARRY_OVER_WORKSPACE_PATH_MAX_LENGTH),
    name: z.string().max(CARRY_OVER_NAME_MAX_LENGTH).optional(),
    ptahUiFence: z.boolean().optional(),
    /** Per-launch id stamped on this launch's session resolution (R1). */
    requestId: uuidString('requestId').optional(),
  })
  .strict();

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

/**
 * `chat:pending-questions` params — `sessionId` is required. The handler uses
 * it as a lookup key against the live AskUserQuestion registry, so a
 * malformed id must be rejected here rather than silently matching nothing.
 */
export const ChatPendingQuestionsParamsSchema = z
  .object({
    sessionId: uuidString('sessionId'),
  })
  .passthrough();
