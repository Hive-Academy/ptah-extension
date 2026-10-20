import { inject, injectable } from 'tsyringe';
import { z } from 'zod';
import {
  attentionRequestKey,
  MESSAGE_TYPES,
  workspaceIdFromPath,
  type AttentionRequestKind,
  type AttentionTarget,
  type SdkTerminalReason,
} from '@ptah-extension/shared';
import {
  PLATFORM_TOKENS,
  type IHostAttentionIngress,
  type IHostAttentionNotifications,
  type IWorkspaceProvider,
  type SafeHostAttentionNotice,
} from '@ptah-extension/platform-core';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { SDK_TOKENS } from '../di/tokens';
import { SessionMetadataStore } from '../session-metadata-store';

const id = z.string().min(1);
const requestSchema = z.object({
  id,
  timestamp: z.number().int().nonnegative(),
  sessionId: id.optional(),
  tabId: id.optional(),
  surfaceMode: z.boolean().optional(),
});
const laneSchema = z.object({
  requestId: id,
  agentId: id,
  timestamp: z.number().int().nonnegative(),
});
const MAX_ENTRIES = 256;
const PENDING_TTL_MS = 2 * 60 * 60 * 1000;

const FAILURE_REASONS: ReadonlySet<SdkTerminalReason> = new Set([
  'api_error', 'model_error', 'image_error', 'budget_exhausted',
  'blocking_limit', 'rapid_refill_breaker', 'prompt_too_long',
  'turn_setup_failed', 'malformed_tool_use_exhausted',
  'structured_output_retry_exhausted',
]);

export function isFailureTerminalReason(reason: SdkTerminalReason | null): boolean {
  return reason !== null && FAILURE_REASONS.has(reason);
}

type Request = {
  kind: AttentionRequestKind;
  requestId: string;
  generation: number;
  sessionId?: string;
  tabId?: string;
  agentId?: string;
  surfaceMode?: boolean;
};

/** One native issue per live key/generation, independent of renderer fan-out. */
@injectable()
export class HostAttentionCoordinator implements IHostAttentionIngress {
  private readonly generations = new Map<string, number>();
  private readonly pending = new Map<string, SafeHostAttentionNotice>();
  private readonly claimedAt = new Map<string, number>();
  private readonly releasedSessionAt = new Map<string, number>();
  private readonly releasedLaneAt = new Map<string, number>();

  constructor(
    @inject(PLATFORM_TOKENS.HOST_ATTENTION_NOTIFICATIONS)
    private readonly host: IHostAttentionNotifications,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspace: IWorkspaceProvider,
    @inject(SDK_TOKENS.SDK_SESSION_METADATA_STORE)
    private readonly metadata: SessionMetadataStore,
    @inject(TOKENS.LOGGER)
    private readonly logger: Logger,
  ) {}

  observe(type: string, payload: unknown): void {
    this.prune();
    let request: Request;
    if (type === MESSAGE_TYPES.AGENT_MONITOR_PERMISSION_REQUEST) {
      const parsed = laneSchema.safeParse(payload);
      if (!parsed.success) {
        this.logger.warn('[HostAttentionCoordinator] Invalid request payload');
        return;
      }
      request = {
        kind: 'lane-permission',
        requestId: parsed.data.requestId,
        generation: parsed.data.timestamp,
        agentId: parsed.data.agentId,
      };
    } else if (
      type === MESSAGE_TYPES.PERMISSION_REQUEST ||
      type === MESSAGE_TYPES.ASK_USER_QUESTION_REQUEST
    ) {
      const parsed = requestSchema.safeParse(payload);
      if (!parsed.success) {
        this.logger.warn('[HostAttentionCoordinator] Invalid request payload');
        return;
      }
      request = {
        kind: type === MESSAGE_TYPES.PERMISSION_REQUEST ? 'permission' : 'question',
        requestId: parsed.data.id,
        generation: parsed.data.timestamp,
        sessionId: parsed.data.sessionId,
        tabId: parsed.data.tabId,
        surfaceMode: parsed.data.surfaceMode,
      };
    } else {
      return;
    }

    // MCP approval requests have no session or tab owner. Keep them in-app only.
    if (!request.sessionId && !request.tabId && !request.agentId) return;
    const key = attentionRequestKey(request.kind, request.requestId);
    if (!this.claim(key, request.generation)) return;
    this.prune();
    void this.issueRequest(key, request);
  }

  /** A matching resolution invalidates pending asynchronous title reads too. */
  resolve(key: string, generation: number): void {
    if (this.generations.get(key) !== generation) return;
    this.generations.delete(key);
    this.pending.delete(key);
    this.claimedAt.delete(key);
    try {
      this.host.resolve(key, generation);
    } catch (error: unknown) {
      this.logHostError('resolve', error);
    }
  }

  /** Renderer-safe request notices that remain authoritative until resolved. */
  pendingNotices(): readonly SafeHostAttentionNotice[] {
    this.prune();
    return [...this.pending.values()].map((notice) => ({
      ...notice,
      target: { ...notice.target },
    }));
  }

  /** Failure keys are local conditions and deliberately use the shared c: namespace. */
  presentFailure(
    conditionId: string,
    generation: number,
    scope: 'session' | 'lane' | 'task',
    target: AttentionTarget,
  ): void {
    this.prune();
    if (!conditionId || !Number.isSafeInteger(generation) || generation < 0) return;
    const key = `c:${workspaceIdFromPath(conditionId)}`;
    if (!this.claim(key, generation)) return;
    this.prune();
    void this.issueFailure(key, generation, scope, target);
  }

  /** The SDK result is the authoritative turn boundary. */
  async presentSessionFailure(sessionId: string, generation: number): Promise<void> {
    const releaseVersion = this.releasedSessionAt.get(sessionId);
    try {
      const record = await this.metadata.get(sessionId);
      if (releaseVersion !== this.releasedSessionAt.get(sessionId)) return;
      if (!record?.workspaceId) {
        this.logger.debug('[HostAttentionCoordinator] Session failure dropped: owner unavailable');
        return;
      }
      this.presentFailure(`turn:${sessionId}`, generation, 'session', {
        workspaceId: workspaceIdFromPath(record.workspaceId), sessionId,
      });
    } catch (error: unknown) {
      this.logHostError('prepare', error);
    }
  }

  /** Resolve a failed lane through its actual parent session, never an active workspace. */
  async presentLaneFailure(agentId: string, parentSessionId: string | undefined, generation: number): Promise<void> {
    const releaseVersion = this.releasedLaneAt.get(agentId);
    if (!parentSessionId) {
      this.logger.debug('[HostAttentionCoordinator] Lane failure dropped: owner unavailable');
      return;
    }
    try {
      const record = await this.metadata.get(parentSessionId);
      if (releaseVersion !== this.releasedLaneAt.get(agentId)) return;
      if (!record?.workspaceId || record.sessionId !== parentSessionId) {
        this.logger.debug('[HostAttentionCoordinator] Lane failure dropped: owner unavailable');
        return;
      }
      this.presentFailure(`lane:${agentId}`, generation, 'lane', {
        workspaceId: workspaceIdFromPath(record.workspaceId), sessionId: record.sessionId,
      });
    } catch (error: unknown) {
      this.logHostError('prepare', error);
    }
  }

  releaseSessionFailure(sessionId: string): void {
    this.releasedSessionAt.set(sessionId, (this.releasedSessionAt.get(sessionId) ?? 0) + 1);
    if (this.releasedSessionAt.size > MAX_ENTRIES) {
      const oldest = this.releasedSessionAt.keys().next().value;
      if (oldest !== undefined) this.releasedSessionAt.delete(oldest);
    }
    const key = `c:${workspaceIdFromPath(`turn:${sessionId}`)}`;
    const generation = this.generations.get(key);
    if (generation !== undefined) this.resolve(key, generation);
  }

  releaseLaneFailure(agentId: string): void {
    this.releasedLaneAt.set(agentId, (this.releasedLaneAt.get(agentId) ?? 0) + 1);
    if (this.releasedLaneAt.size > MAX_ENTRIES) {
      const oldest = this.releasedLaneAt.keys().next().value;
      if (oldest !== undefined) this.releasedLaneAt.delete(oldest);
    }
    const key = `c:${workspaceIdFromPath(`lane:${agentId}`)}`;
    const generation = this.generations.get(key);
    if (generation !== undefined) this.resolve(key, generation);
  }

  private prune(): void {
    const now = Date.now();
    for (const [key, claimedAt] of this.claimedAt) {
      if (now - claimedAt > PENDING_TTL_MS) this.drop(key);
    }
    while (this.generations.size > MAX_ENTRIES) {
      const oldest = [...this.generations.keys()].find((key) => key.startsWith('c:'))
        ?? this.generations.keys().next().value;
      if (oldest === undefined) break;
      this.drop(oldest);
    }
  }

  private drop(key: string): void {
    const generation = this.generations.get(key);
    if (generation !== undefined) this.resolve(key, generation);
  }

  private claim(key: string, generation: number): boolean {
    const current = this.generations.get(key);
    if (current !== undefined && generation <= current) return false;
    if (current !== undefined) this.generations.delete(key);
    this.generations.set(key, generation);
    this.claimedAt.set(key, Date.now());
    this.pending.delete(key);
    if (current !== undefined) {
      try {
        this.host.resolve(key, current);
      } catch (error: unknown) {
        this.logHostError('resolve', error);
      }
    }
    return true;
  }

  private async issueRequest(key: string, request: Request): Promise<void> {
    try {
      const records = request.agentId
        ? await this.metadata.getAll()
        : undefined;
      const record = request.agentId
        ? records?.find((item) => item.cliSessions?.some((ref) => ref.agentId === request.agentId))
        : request.sessionId || request.tabId
          ? await this.metadata.get(request.sessionId ?? request.tabId ?? '')
          : null;
      const workspacePath = record?.workspaceId;
      const sessionId = request.sessionId ?? record?.sessionId ?? request.tabId;
      if (!workspacePath || !sessionId) {
        this.logger.debug('[HostAttentionCoordinator] Request dropped: owner metadata unavailable');
        this.drop(key);
        return;
      }
      const target: AttentionTarget = {
        workspaceId: workspaceIdFromPath(workspacePath),
        sessionId,
        ...(request.tabId ? { tabId: request.tabId } : {}),
        ...(request.surfaceMode ? { surfaceMode: true } : {}),
      };
      const base = {
        key,
        generation: request.generation,
        actionLabel: 'Open Ptah' as const,
        sessionTitle: this.title(record?.name),
        target,
      };
      const notice: SafeHostAttentionNotice = request.kind === 'question'
        ? { ...base, kind: 'question', severity: 'info', label: 'Question needs an answer' }
        : { ...base, kind: request.kind, severity: 'warning', label: 'Permission needed' };
      if (this.generations.get(key) !== request.generation) return;
      this.pending.set(key, notice);
      this.presentIfCurrent(key, request.generation, 'notifications.hostEnabled', notice);
    } catch (error: unknown) {
      this.drop(key);
      this.logHostError('prepare', error);
    }
  }

  private async issueFailure(
    key: string,
    generation: number,
    scope: 'session' | 'lane' | 'task',
    target: AttentionTarget,
  ): Promise<void> {
    try {
      const record = await this.metadata.get(target.sessionId);
      const label = scope === 'lane' ? 'Lane failed' : scope === 'task' ? 'Task failed' : 'Session failed';
      const presented = this.presentIfCurrent(key, generation, 'notifications.failureHostEnabled', {
        key, generation, kind: 'failure', severity: 'error', label,
        actionLabel: 'Open Ptah', sessionTitle: this.title(record?.name), target,
      });
      if (!presented) this.drop(key);
    } catch (error: unknown) {
      this.drop(key);
      this.logHostError('prepare', error);
    }
  }

  private presentIfCurrent(
    key: string,
    generation: number,
    setting: string,
    notice: SafeHostAttentionNotice,
  ): boolean {
    if (this.generations.get(key) !== generation) return false;
    try {
      const enabled = this.workspace.getConfiguration<boolean>(
        'ptah', setting, setting === 'notifications.hostEnabled',
      );
      if ((typeof enabled === 'boolean' ? enabled : setting === 'notifications.hostEnabled') !== true || !this.host.isEligible()) return false;
      this.host.present(notice);
      return true;
    } catch (error: unknown) {
      // degradation-audit: optional-capability - a host notification is an
      // optional extra over the in-app bell; the error is logged and false
      // means "not shown", so the in-app request still reaches the user.
      this.logHostError('present', error);
      return false;
    }
  }

  private title(value: string | undefined): string {
    // eslint-disable-next-line no-control-regex -- strips control characters from host titles
    const title = value?.replace(/[\x00-\x1f\x7f-\x9f]/g, ' ').trim();
    if (!title) return 'Ptah session';
    let safe = '';
    for (const character of Array.from(title).slice(0, 80)) {
      if (safe.length + character.length > 120) break;
      safe += character;
    }
    return safe;
  }

  private logHostError(operation: string, error: unknown): void {
    this.logger.warn(`[HostAttentionCoordinator] ${operation} failed`, {
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
  }
}
