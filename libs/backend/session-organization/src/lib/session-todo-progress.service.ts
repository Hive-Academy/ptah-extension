/**
 * Session todo progress — persists the latest main-thread TodoWrite snapshot
 * of each session (decisions.md D5), so the task view and the session card
 * show progress for sessions not loaded in any tab and after a restart.
 *
 * Source: `PostToolUse` with `toolName === 'TodoWrite'`, `success`, and no
 * `agentId` (a subagent's todos are its own). The tool input is parsed with
 * Zod at this boundary; anything else is ignored. The snapshot is written
 * (organization row and progress in one transaction) and a change emitted
 * only when `done`, `total` or the in-progress label changed, so a repeated
 * TodoWrite causes no push.
 *
 * `start()` / `dispose()` are synchronous and idempotent.
 */
import { inject, injectable } from 'tsyringe';
import { z } from 'zod';
import {
  PLATFORM_TOKENS,
  type IDisposable,
  type IOutputChannel,
} from '@ptah-extension/platform-core';
import { SDK_TOKENS, type PostToolUsePayload } from '@ptah-extension/agent-sdk';
import type { SessionTodoProgress } from '@ptah-extension/shared';
import { SESSION_ORGANIZATION_TOKENS } from './di/tokens';
import type { SessionOrganizationService } from './session-organization.service';
import type { SessionOrganizationStore } from './session-organization.store';
import type { SessionOrganizationPostToolUseSource } from './session-organization-capture.service';

const LOG_PREFIX = '[SessionOrganization]';

/** Longest in-progress label stored. */
const MAX_IN_PROGRESS_LABEL = 200;

const TodoWriteInputSchema = z.object({
  todos: z
    .array(
      z.object({
        content: z.string(),
        status: z.enum(['pending', 'in_progress', 'completed']),
        activeForm: z.string().optional(),
      }),
    )
    .max(500),
});

type TodoWriteInput = z.infer<typeof TodoWriteInputSchema>;

export type TodoProgressOrganizationService = Pick<
  SessionOrganizationService,
  'commitCapture'
>;
export type TodoProgressStore = Pick<
  SessionOrganizationStore,
  'upsertTodoProgress'
>;

/** Done / total / in-progress label of one TodoWrite input. */
export function toTodoProgress(
  input: TodoWriteInput,
  updatedAt: number,
): SessionTodoProgress {
  const active = input.todos.find((todo) => todo.status === 'in_progress');
  const label = (active?.activeForm?.trim() || active?.content.trim()) ?? '';
  return {
    done: input.todos.filter((todo) => todo.status === 'completed').length,
    total: input.todos.length,
    inProgress:
      label.length > 0 ? label.slice(0, MAX_IN_PROGRESS_LABEL) : null,
    updatedAt,
  };
}

@injectable()
export class SessionTodoProgressService implements IDisposable {
  private release: (() => void) | null = null;

  constructor(
    @inject(SESSION_ORGANIZATION_TOKENS.SERVICE)
    private readonly service: TodoProgressOrganizationService,
    @inject(SESSION_ORGANIZATION_TOKENS.STORE)
    private readonly store: TodoProgressStore,
    @inject(SDK_TOKENS.SDK_POST_TOOL_USE_CALLBACK_REGISTRY)
    private readonly postToolUse: SessionOrganizationPostToolUseSource,
    @inject(PLATFORM_TOKENS.OUTPUT_CHANNEL)
    private readonly output: IOutputChannel,
  ) {}

  /** Subscribe host-wide. Idempotent; a throwing subscribe propagates. */
  start(): void {
    if (this.release !== null) return;
    this.release = this.postToolUse.register((payload) =>
      this.onPostToolUse(payload),
    );
  }

  /** Release the subscription. Idempotent. */
  dispose(): void {
    const release = this.release;
    this.release = null;
    release?.();
  }

  private onPostToolUse(payload: PostToolUsePayload): void {
    if (payload.toolName !== 'TodoWrite' || !payload.success) return;
    if (payload.agentId !== undefined) return;
    const parsed = TodoWriteInputSchema.safeParse(payload.toolInput);
    if (!parsed.success) {
      this.output.appendLine(
        `${LOG_PREFIX} todoProgress ignored for ${payload.sessionId}: TodoWrite input did not parse`,
      );
      return;
    }
    const progress = toTodoProgress(parsed.data, payload.timestamp);
    void this.service.commitCapture(
      'todoProgress',
      payload.sessionId,
      payload.workspaceRoot,
      (root, now) =>
        this.store.upsertTodoProgress(root, payload.sessionId, progress, now)
          ? [payload.sessionId]
          : [],
    );
  }
}
