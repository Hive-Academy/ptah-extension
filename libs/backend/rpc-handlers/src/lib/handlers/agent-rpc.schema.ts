/**
 * Zod schemas for {@link AgentRpcHandlers}.
 *
 * The `agent:*` namespace had no schema file at all. `agent:resumeCliSession`
 * declared an inline TypeScript param type and validated nothing at runtime —
 * and a static type describes what a caller is SUPPOSED to send, not what it
 * can send. `''` is a `string`, so `cliSessionId: ''` satisfied the declared
 * type and the handler went on to resume a CLI session that no id names
 * (TASK_2026_296; this is one of the two doors an empty session id came
 * through).
 *
 * On parse failure the handler's own `catch` returns
 * `{ success: false, error }` — the exact shape
 * `AgentMonitorStore.resumeAgentWithMessage` already reads — so a rejection
 * surfaces as a failed resume with the offending field named. Nothing
 * propagates: the backend transport wraps every handler
 * (`libs/backend/vscode-core/src/messaging/rpc-handler.ts`) and the frontend
 * client's `call()` has no reject path, so an unhandled rejection is
 * structurally impossible at both call sites.
 *
 * `.passthrough()` is the house rule established by `chat-rpc.schema.ts`, NOT
 * `.strict()`: an outdated webview that sends one extra field must not have
 * its whole call rejected. Only the declared fields are validated; the rest is
 * trusted past this boundary.
 */

import { z } from 'zod';
import { SYSTEM_CLI_TYPES } from '@ptah-extension/shared';
import type { CliType } from '@ptah-extension/shared';

/**
 * Every value `CliType` admits, derived from `SYSTEM_CLI_TYPES` — the declared
 * single source of truth — so a seventh adapter cannot become spawnable
 * without also becoming resumable. `ptah-cli` is appended because it is
 * deliberately not a member of the system family: those agents are
 * user-configured providers addressed by `ptahCliId`, not a binary name.
 */
const CLI_TYPES = [
  ...SYSTEM_CLI_TYPES,
  'ptah-cli',
] as const satisfies readonly CliType[];

/**
 * `agent:resumeCliSession` params.
 *
 * `.min(1)` on `cliSessionId` IS correct here. This method carries no
 * "empty means something" rule: it resumes a named CLI session, and an empty
 * name resumes nothing. Both in-app callers already refuse a missing id before
 * calling (`agent-monitor.store.ts`, `agent-card.component.ts`), so an empty
 * one can only reach here from a caller that is already wrong — which is
 * exactly what a boundary schema is for.
 *
 * Contrast {@link SubagentQuerySchema} in `subagent-rpc.schema.ts`, where
 * `.min(1)` would be a DEFECT: `chat:subagent-query` answers a present-but-empty
 * `sessionId` deliberately, with an empty result. The asymmetry is the point;
 * do not harmonise the two.
 *
 * The optional ids take `.min(1)` for the same reason as `cliSessionId`:
 * `parentSessionId: ''` is not "no parent", it is a parent that identifies no
 * session. Absence travels as the field being absent.
 */
export const AgentResumeCliSessionParamsSchema = z
  .object({
    cliSessionId: z
      .string({ error: 'cliSessionId must be a string' })
      .min(1, 'cliSessionId is required'),
    cli: z.enum(CLI_TYPES, { error: 'cli must be a known CLI type' }),
    task: z
      .string({ error: 'task must be a string' })
      .min(1, 'task is required'),
    parentSessionId: z
      .string({ error: 'parentSessionId must be a string' })
      .min(1, 'parentSessionId must not be empty')
      .optional(),
    ptahCliId: z
      .string({ error: 'ptahCliId must be a string' })
      .min(1, 'ptahCliId must not be empty')
      .optional(),
    previousAgentId: z
      .string({ error: 'previousAgentId must be a string' })
      .min(1, 'previousAgentId must not be empty')
      .optional(),
  })
  .passthrough();

export type AgentResumeCliSessionInput = z.infer<
  typeof AgentResumeCliSessionParamsSchema
>;
