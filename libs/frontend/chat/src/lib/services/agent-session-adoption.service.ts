import { Injectable, Injector, computed, effect, inject } from '@angular/core';
import { ClaudeRpcService } from '@ptah-extension/core';
import {
  SessionId,
  type AgentSessionOpenedPayload,
} from '@ptah-extension/shared';
import {
  TabId,
  TabManagerService,
  type AgentSessionAdoptionMode,
} from '@ptah-extension/chat-state';
import type { TabState } from '@ptah-extension/chat-types';
import { SessionLoaderService } from './chat-store/session-loader.service';

/**
 * A late-adopted agent tab whose history has not been loaded and that may be
 * loaded now: bound to a session, not live, not mid-turn, and empty.
 *
 * A tab that already holds messages is never reloaded. `switchSession`
 * replaces the transcript wholesale (`applyResumingSession` clears
 * `messages`, then the on-disk JSONL is replayed; `staleSnapshot` applies only
 * to compaction reloads), so loading over turns that streamed in before the
 * first activation could lose an in-flight turn. Such a tab is live anyway:
 * every streamed turn passes `turn_state: generating`, which sets
 * `hasLiveSession`.
 */
function needsAgentHistoryLoad(tab: TabState | null): tab is TabState & {
  claudeSessionId: SessionId;
} {
  return (
    tab !== null &&
    tab.agentOrigin !== undefined &&
    tab.claudeSessionId !== null &&
    tab.hasLiveSession !== true &&
    tab.status === 'loaded' &&
    tab.messages.length === 0
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Validate an `AgentSessionOpenedPayload` received from the backend, either
 * as the `agentSession:opened` push or inside a `chat:agent-sessions` result
 * (TASK_2026_584). Returns `null` for anything that is not one; the caller
 * logs and drops it. Hand-written like the other wire parsers, to keep Zod
 * out of the initial bundle.
 */
export function parseAgentSessionOpenedPayload(
  value: unknown,
): AgentSessionOpenedPayload | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const p = value as Record<string, unknown>;
  const sessionId = p['sessionId'];
  const parentSessionId = p['parentSessionId'];
  const taskId = p['taskId'];
  if (
    !isNonEmptyString(p['tabId']) ||
    !isNonEmptyString(p['parentTabId']) ||
    !isNonEmptyString(p['workspaceRoot']) ||
    !isNonEmptyString(p['worktreePath']) ||
    typeof p['branch'] !== 'string' ||
    !isNonEmptyString(p['label']) ||
    typeof p['displayPrompt'] !== 'string' ||
    typeof p['startedAt'] !== 'number' ||
    !Number.isFinite(p['startedAt']) ||
    (sessionId !== null && !isNonEmptyString(sessionId)) ||
    (parentSessionId !== null && !isNonEmptyString(parentSessionId)) ||
    (taskId !== undefined && typeof taskId !== 'string')
  ) {
    return null;
  }
  return {
    tabId: p['tabId'],
    sessionId,
    parentTabId: p['parentTabId'],
    parentSessionId,
    workspaceRoot: p['workspaceRoot'],
    worktreePath: p['worktreePath'],
    branch: p['branch'],
    label: p['label'],
    ...(isNonEmptyString(taskId) ? { taskId } : {}),
    displayPrompt: p['displayPrompt'],
    startedAt: p['startedAt'],
  };
}

/**
 * AgentSessionAdoptionService — late adoption of agent-started child tabs
 * (TASK_2026_584).
 *
 * The `agentSession:opened` push reaches only a webview that is running when
 * the child starts. A webview that reloads, or a panel whose parent lives in
 * a workspace it had not loaded yet, asks the backend for the children still
 * live (`chat:agent-sessions`) and adopts the ones it is missing. Adoption is
 * `TabManagerService.adoptAgentSessionTab(..., 'late')`: idempotent and gated
 * on this panel holding the parent tab.
 *
 * Runs once at bootstrap and again on every active-workspace change, from a
 * single root effect on `activeWorkspacePath$` — no timer, no poll.
 *
 * A child this service adopted, or found already present, is remembered for
 * the page's lifetime, so a child tab the user closed is not reopened by the
 * next workspace switch. The set is bounded by the number of children started
 * while this page lives.
 */
@Injectable({ providedIn: 'root' })
export class AgentSessionAdoptionService {
  private readonly rpc = inject(ClaudeRpcService);
  private readonly tabManager = inject(TabManagerService);
  private readonly injector = inject(Injector);

  private readonly sessionLoader = inject(SessionLoaderService);

  private readonly settled = new Set<string>();
  /**
   * One-shot marker: agent tabs whose history load was started on this page.
   * Switching back to such a tab never reloads it. Cleared for a tab only
   * when its load fails, so the next activation can try again.
   */
  private readonly historyRequested = new Set<string>();
  private started = false;

  /**
   * `tabId|sessionId` of the active tab while it is a late-adopted agent tab
   * awaiting its history, else null. String-equal, so the effect below runs
   * once per activation, not on every streaming tick of the active tab.
   */
  private readonly pendingHistoryLoad = computed(() => {
    const tab = this.tabManager.activeTab();
    if (!needsAgentHistoryLoad(tab)) return null;
    if (this.tabManager.isTabStreaming(tab.id)) return null;
    return `${tab.id}|${tab.claudeSessionId}`;
  });

  /**
   * Install the workspace effect and the first-activation history effect.
   * Idempotent; called once from bootstrap. Two root effects in total — no
   * timer, observer or per-tab subscription.
   */
  start(): void {
    if (this.started) return;
    this.started = true;
    effect(
      () => {
        const workspaceRoot = this.tabManager.activeWorkspacePath$();
        void this.adoptLiveChildren(workspaceRoot);
      },
      { injector: this.injector },
    );
    effect(
      () => {
        const pending = this.pendingHistoryLoad();
        if (pending === null) return;
        const [tabId, sessionId] = pending.split('|');
        void this.loadAgentHistory(tabId, sessionId);
      },
      { injector: this.injector },
    );
  }

  /**
   * Load a late-adopted agent tab's history the first time it is shown
   * (TASK_2026_584). Without this the tab stays empty until the user finds
   * the session in the sidebar.
   *
   * Goes through `SessionLoaderService.switchSession` targeted at this tab and
   * NEVER with `activate: true`: `chat:resume` without it only reads the
   * session's JSONL, so a child still running in the backend is not touched.
   * Live events that arrive during the load are fenced by the history
   * replayer and applied after it.
   */
  async loadAgentHistory(tabId: string, sessionId: string): Promise<void> {
    if (this.historyRequested.has(tabId)) return;
    const targetTabId = TabId.safeParse(tabId);
    const session = SessionId.safeParse(sessionId);
    if (!targetTabId || !session) return;
    this.historyRequested.add(tabId);
    try {
      await this.sessionLoader.switchSession(session, { targetTabId });
    } catch (error: unknown) {
      // degradation-audit: optional-capability - the tab keeps working and
      // the sidebar can still load the session; the marker is cleared so the
      // next activation retries.
      this.historyRequested.delete(tabId);
      console.warn(
        '[AgentSessionAdoption] history load for agent tab failed:',
        error,
      );
    }
  }

  /**
   * Ask the backend for live children (scoped to `workspaceRoot` when one is
   * active) and adopt each one this panel is missing. Never throws: a failed
   * RPC leaves the children reachable from the sidebar.
   */
  async adoptLiveChildren(workspaceRoot: string | null): Promise<void> {
    let sessions: unknown;
    try {
      const result = await this.rpc.call(
        'chat:agent-sessions',
        workspaceRoot ? { workspaceRoot } : {},
      );
      if (!result.success) {
        console.warn(
          '[AgentSessionAdoption] chat:agent-sessions failed:',
          result.error,
        );
        return;
      }
      sessions = result.data?.sessions;
    } catch (error: unknown) {
      // degradation-audit: optional-capability - late adoption is a recovery
      // path; the missed children stay listed in the sidebar and the next
      // workspace switch asks again.
      console.warn('[AgentSessionAdoption] chat:agent-sessions threw:', error);
      return;
    }
    if (!Array.isArray(sessions)) return;

    for (const raw of sessions) {
      const descriptor = parseAgentSessionOpenedPayload(raw);
      if (!descriptor) {
        console.warn(
          '[AgentSessionAdoption] malformed agent session descriptor — dropped',
        );
        continue;
      }
      this.adopt(descriptor, 'late');
    }
  }

  /**
   * Adopt one child tab. Used by the `agentSession:opened` push (`live`) and
   * by {@link adoptLiveChildren} (`late`). A child already settled on this
   * page is skipped. Never throws: an adoption fault must not break the
   * message handler or the loop over the remaining descriptors.
   */
  adopt(
    descriptor: AgentSessionOpenedPayload,
    mode: AgentSessionAdoptionMode,
  ): void {
    if (this.settled.has(descriptor.tabId)) return;
    try {
      const outcome = this.tabManager.adoptAgentSessionTab(descriptor, mode);
      // `parent-absent` is NOT settled: the parent's workspace may simply not
      // be loaded yet, and the next workspace switch must try again.
      if (outcome === 'adopted' || outcome === 'exists') {
        this.settled.add(descriptor.tabId);
      }
    } catch (error: unknown) {
      // degradation-audit: optional-capability - one child's adoption fault
      // must not break the message handler or the remaining descriptors; the
      // child stays reachable from the sidebar.
      console.error('[AgentSessionAdoption] adoption failed:', error);
    }
  }
}
