/**
 * Multi-turn acceptance for host routing (TASK_2026_857, Component 16, F4).
 *
 * vague request → one nudge → the assistant proposes a scope → the user
 * agrees → one pre-flight on the agreed scope → one `Routing:` reminder for
 * the next turn, and no second nudge. `queue.take` stands in for the next
 * turn's `UserPromptSubmit` drain.
 */
import 'reflect-metadata';

// The real lm-tools barrel loads ESM-only workspace-intelligence modules that
// Jest cannot require. This mirrors `buildRouteCandidateSource` for an agent
// without a limit lookup.
jest.mock('@ptah-extension/vscode-lm-tools', () => ({
  buildRouteCandidateSource: (agent: {
    list(): Promise<unknown>;
    listRoles(): Promise<unknown>;
  }) => ({
    rows: () => agent.list(),
    limits: async () => null,
    roles: () => agent.listRoles(),
  }),
}));

import {
  createMockSecretStorage,
  createMockStateStorage,
  createMockWorkspaceProvider,
} from '@ptah-extension/platform-core/testing';
import {
  DecisionModelConfig,
  HostRoutingSetting,
  PreflightResultSchema,
  PreflightReuseCache,
  type LaneRoutingLogger,
  type RouteCandidateSource,
  type RouteDecideResult,
  type ScopeAssessment,
  type ScopeConversation,
} from '@ptah-extension/lane-routing';
import {
  NextTurnReminderQueue,
  type SdkAdapterTurnEndedEvent,
  type SessionIdResolvedPayload,
} from '@ptah-extension/agent-sdk';
import type { CliDetectionResult } from '@ptah-extension/shared';

import { HostRoutingCoordinator } from './host-routing.coordinator';
import { ROUTING_NUDGE_TEXT } from './routing-reminder.format';

const TAB = 'tab-mt';
const SDK = 'sdk-mt';
const TURN_1 = 'add retries to the uploader';
const PROPOSAL = 'Retry only network errors, 3 attempts with backoff?';
const TURN_2 = 'yes, use that approach';

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

function answer(
  settled: 'yes' | 'no',
  relation: 'new-task' | 'continuation' | null = null,
  material: 'yes' | 'no' | null = null,
): ScopeAssessment {
  const wrap = <T extends string>(value: T | null) =>
    value === null ? null : { value, confidence: 0.9 };
  return {
    kind: 'answered',
    engineering: { value: 'yes', confidence: 0.9 },
    settled: wrap(settled),
    relation: wrap(relation),
    materialChange: wrap(material),
    usage: { requests: 1, inputTokens: 5, outputTokens: 1, costUsd: null },
  };
}

const PREFLIGHT = PreflightResultSchema.parse({
  stage: 'pre-flight',
  taskType: {
    value: 'FEATURE',
    source: 'model',
    confidence: 0.86,
    fallbackCause: null,
    modelProposal: null,
  },
  depth: {
    value: 'Partial',
    source: 'model',
    confidence: 0.74,
    fallbackCause: null,
    modelProposal: null,
  },
  overallConfidence: 0.74,
  reasons: [],
  usage: { requests: 1, inputTokens: 10, outputTokens: 2, costUsd: null },
});

function harness() {
  const workspace = createMockWorkspaceProvider({
    config: {
      'ptah.agentOrchestration.decisionModel': {
        kind: 'ollama',
        model: 'nimble',
      },
    },
  });
  const laneLogger: LaneRoutingLogger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  const config = new DecisionModelConfig(
    workspace,
    createMockSecretStorage(),
    createMockStateStorage(),
    laneLogger,
  );
  const setting = new HostRoutingSetting(workspace, config);
  const cache = new PreflightReuseCache(setting);

  const sessionCallbacks: Array<
    (payload: SessionIdResolvedPayload) => void | Promise<void>
  > = [];
  const registry = {
    register: (
      callback: (payload: SessionIdResolvedPayload) => void | Promise<void>,
    ) => {
      sessionCallbacks.push(callback);
      return () => undefined;
    },
  };
  const turnListeners: Array<(event: SdkAdapterTurnEndedEvent) => void> = [];
  const events = {
    onTurnEnded: (listener: (event: SdkAdapterTurnEndedEvent) => void) => {
      turnListeners.push(listener);
      return () => undefined;
    },
  };
  const queue = new NextTurnReminderQueue(registry);

  const answers: ScopeAssessment[] = [];
  const assess = jest.fn(
    async (_conversation: ScopeConversation): Promise<ScopeAssessment> => {
      const next = answers.shift();
      if (next === undefined) throw new Error('unexpected scope check');
      return next;
    },
  );
  const decide = jest.fn(
    async (
      _args: unknown,
      _source: RouteCandidateSource,
    ): Promise<RouteDecideResult> => PREFLIGHT,
  );
  const agent = {
    list: async (): Promise<CliDetectionResult[]> => [
      { cli: 'codex', installed: true, messagingMode: 'none' },
    ],
    listRoles: async (): Promise<string[]> => ['backend-developer'],
  };
  const coordinator = new HostRoutingCoordinator(
    { warn: jest.fn(), debug: jest.fn() },
    setting,
    { assess },
    { decide },
    config,
    queue,
    { build: () => ({ agent }) },
    cache,
    events,
    registry,
  );

  return {
    coordinator,
    queue,
    assess,
    decide,
    answers,
    setOff: () =>
      workspace.__state.config.set(
        'ptah.agentOrchestration.hostRouting',
        false,
      ),
    resolveSession: () => {
      for (const callback of sessionCallbacks) {
        void callback({ tabId: TAB, realSessionId: SDK, timestamp: 1 });
      }
    },
    assistantReplied: (text: string) => {
      for (const listener of turnListeners) {
        listener({
          sessionId: SDK,
          cwd: '/ws',
          lastAssistantMessage: text,
          backgroundTasks: [],
          sessionCrons: [],
          terminalReason: null,
          timestamp: 2,
        });
      }
    },
  };
}

describe('host routing multi-turn acceptance', () => {
  it('vague → one nudge → agreed → routed → reminder on the next turn', async () => {
    const h = harness();

    // Turn 1 (start turn, no SDK id yet): vague engineering request.
    h.answers.push(answer('no'));
    h.coordinator.admitUserTurn({
      tabId: TAB,
      sessionId: null,
      prompt: TURN_1,
    });
    h.resolveSession();
    await flush();
    expect(h.decide).not.toHaveBeenCalled();
    h.assistantReplied(PROPOSAL);

    // Turn 2's prompt hook drains the nudge.
    expect(h.queue.take(SDK)).toBe(ROUTING_NUDGE_TEXT);

    // Turn 2: the user agrees with the assistant's proposal.
    h.answers.push(answer('yes', 'continuation', 'no'));
    h.coordinator.admitUserTurn({ tabId: TAB, sessionId: SDK, prompt: TURN_2 });
    await flush();

    const [conversation] = h.assess.mock.calls[1];
    expect(conversation).toEqual({
      turnText: TURN_2,
      previousUserTurn: TURN_1,
      lastAssistantReply: PROPOSAL,
      pendingScope: TURN_1,
      lastRoutedScope: null,
    });

    expect(h.decide).toHaveBeenCalledTimes(1);
    const [args] = h.decide.mock.calls[0];
    const parsed =
      typeof args === 'object' && args !== null && 'request' in args
        ? args.request
        : null;
    expect(typeof parsed).toBe('string');
    const request = String(parsed);
    expect(request).toContain(TURN_1);
    expect(request).toContain(PROPOSAL);
    expect(request.length).toBeLessThanOrEqual(8000);

    // Turn 3's prompt hook receives exactly one routing reminder.
    const reminder = h.queue.take(SDK);
    expect(reminder).toBe(
      'Routing: pre-flight taskType=FEATURE (model, 0.86); depth=Partial (model, 0.74). ' +
        'Available lanes: codex. Available subagents: backend-developer. ' +
        'Executor choice stays with gate-0.1 at plan approval.',
    );
    expect(h.queue.take(SDK)).toBeNull();

    // Turn 3: unchanged continuation; no second pre-flight, no nudge.
    h.answers.push(answer('no', 'continuation', 'no'));
    h.coordinator.admitUserTurn({
      tabId: TAB,
      sessionId: SDK,
      prompt: 'start please',
    });
    await flush();
    expect(h.decide).toHaveBeenCalledTimes(1);
    expect(h.queue.take(SDK)).toBeNull();
  });

  it('with the setting off the same conversation makes zero decision-model calls', async () => {
    const h = harness();
    h.setOff();
    h.coordinator.admitUserTurn({
      tabId: TAB,
      sessionId: null,
      prompt: TURN_1,
    });
    h.resolveSession();
    h.assistantReplied(PROPOSAL);
    h.coordinator.admitUserTurn({ tabId: TAB, sessionId: SDK, prompt: TURN_2 });
    await flush();
    expect(h.assess).not.toHaveBeenCalled();
    expect(h.decide).not.toHaveBeenCalled();
    expect(h.queue.take(SDK)).toBeNull();
  });
});
