import type {
  AskUserQuestionRequest,
  PermissionRequest,
} from '@ptah-extension/shared';
import type { MonitoredAgent } from '@ptah-extension/chat-streaming';

export type NeedsYouItemKind = 'permission' | 'question' | 'lane-permission';

export interface NeedsYouItem {
  readonly key: string;
  readonly kind: NeedsYouItemKind;
  readonly requestId: string;
  readonly tabId: string;
  readonly sessionLabel: string;
  readonly requester: string;
  readonly agentId: string | null;
  readonly summary: string;
  readonly timestamp: number;
}

export interface NeedsYouTile {
  readonly tabId: string;
  readonly sessionId: string | null;
  readonly title: string;
}

export function buildNeedsYouItems(
  permissions: readonly PermissionRequest[],
  questions: readonly AskUserQuestionRequest[],
  laneAgents: readonly MonitoredAgent[],
  tiles: readonly NeedsYouTile[],
  targetTabsFor: (id: string) => readonly string[],
  questionTargetTabsFor: (id: string) => readonly string[] = targetTabsFor,
): NeedsYouItem[] {
  const items: NeedsYouItem[] = [];
  const resolve = (
    request: {
      readonly id: string;
      readonly tabId?: string;
      readonly sessionId?: string;
    },
    targets: (id: string) => readonly string[],
  ): NeedsYouTile | undefined =>
    tiles.find((tile) => tile.tabId === request.tabId) ??
    targets(request.id)
      .map((id) => tiles.find((tile) => tile.tabId === id))
      .find(Boolean) ??
    tiles.find(
      (tile) => request.sessionId && tile.sessionId === request.sessionId,
    );

  for (const request of permissions) {
    if (request.surfaceMode) continue;
    const tile = resolve(request, targetTabsFor);
    if (!tile) continue;
    items.push({
      key: `perm:${request.id}`,
      kind: 'permission',
      requestId: request.id,
      tabId: tile.tabId,
      sessionLabel: tile.title,
      requester: 'Session',
      agentId: null,
      summary: [request.toolName, request.description]
        .filter(Boolean)
        .join(' · '),
      timestamp: request.timestamp,
    });
  }
  for (const request of questions) {
    if (request.surfaceMode) continue;
    const tile = resolve(request, questionTargetTabsFor);
    if (!tile) continue;
    items.push({
      key: `q:${request.id}`,
      kind: 'question',
      requestId: request.id,
      tabId: tile.tabId,
      sessionLabel: tile.title,
      requester: 'Session',
      agentId: null,
      summary: request.questions[0]?.question ?? 'Question',
      timestamp: request.timestamp,
    });
  }
  for (const agent of laneAgents) {
    const tile = tiles.find(
      (tile) =>
        tile.sessionId !== null && agent.parentSessionId === tile.sessionId,
    );
    if (!tile) continue;
    for (const request of agent.permissionQueue) {
      items.push({
        key: `lane:${agent.agentId}:${request.requestId}`,
        kind: 'lane-permission',
        requestId: request.requestId,
        tabId: tile.tabId,
        sessionLabel: tile.title,
        requester: agent.displayName ?? agent.task,
        agentId: agent.agentId,
        summary: [request.toolName, request.description]
          .filter(Boolean)
          .join(' · '),
        timestamp: request.timestamp,
      });
    }
  }
  return items.sort(
    (a, b) => a.timestamp - b.timestamp || a.key.localeCompare(b.key),
  );
}
