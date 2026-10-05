/**
 * Fixtures for the plan-limits visual scenario (TASK_2026_596, Phase 6
 * visual review).
 *
 * The host and RPC plumbing is NOT copied: `installHost` and
 * `installRpcAutoResponder` are imported from `../marketplace/marketplace.fixtures`,
 * the harness's one shared copy of that mechanism. This file adds only what
 * the plan-limit surfaces need on top of it:
 *
 * - `installWorkspaceHost` — the VS Code host config plus `workspaceRoot`
 *   and, for chat, the pop-out `initialSessionId` that makes
 *   `TabManagerService` queue a `switchSession` on boot
 *   (`tab-manager.service.ts:619-632`). `vscodeHostConfig` sets no
 *   `workspaceRoot`, and `switchSession` throws without one
 *   (`session-loader.service.ts:792-797`).
 * - The plan-limit snapshots, shaped by `plan-limit.types.ts` and reusing the
 *   data of `stats-limit-view-model.spec.ts` and
 *   `provider-account-card.component.spec.ts`.
 * - The lane runs: two restored runs carried by `chat:resume.cliSessions`
 *   (restored runs always have `usageTotals: null`,
 *   `agent-monitor.store.ts:1204`) and three live runs pushed as
 *   `agent-monitor:spawned` / `agent-monitor:output` / `agent-monitor:exited`,
 *   the only path that folds usage totals (`agent-monitor.store.ts:880-888`).
 *
 * Only types come from `@ptah-extension/shared`; a value import breaks the
 * Playwright transform (see `../marketplace/capability-toggles.e2e.spec.ts:28-37`).
 */
import type { Page } from '@playwright/test';
import type {
  AgentOutputDelta,
  AgentProcessInfo,
  ChatResumeResult,
  CliSessionReference,
  FlatStreamEventUnion,
  PlanLimitOwnerSnapshot,
  PlanLimitsSnapshot,
  PlanLimitWindow,
  QuotaOwnerRef,
  SessionStatsEntry,
} from '@ptah-extension/shared';
import {
  baseMarketplaceFixtures,
  installHost,
  rpcError,
} from '../marketplace/marketplace.fixtures';

// ---------------------------------------------------------------------------
// Fixed clock and zone
// ---------------------------------------------------------------------------

/** Monday 5 Oct 2026 12:00 UTC — the instant `stats-limit-view-model.spec.ts` uses. */
export const NOW = Date.UTC(2026, 9, 5, 12, 0);
/** Every capture renders in this zone, so reset times read the same on any machine. */
export const TIME_ZONE = 'UTC';
export const LOCALE = 'en-GB';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

/** A v4 UUID: `SessionId.from` rejects anything else (`branded.types.ts:39`). */
export const SESSION_ID = '5960a190-596a-4b19-8a19-0a19596a0a19';
export const SESSION_NAME = 'Quota resets review';
const WORKSPACE_ROOT = 'C:\\ptah-e2e-ws-a';

/**
 * VS Code host config plus a workspace root (the dashboard's analytics card
 * shows "No workspace detected" without one) and, for the chat surface, the
 * pop-out session fields. MUST run after `installPostMessageBridge` and before
 * `page.goto`. Init scripts run in registration order, so the merge below
 * sees the config `installHost` set.
 */
export async function installWorkspaceHost(
  page: Page,
  initialView: 'chat' | 'analytics',
): Promise<void> {
  await installHost(page, 'vscode', initialView);
  await page.addInitScript(
    (extra: Record<string, unknown>) => {
      const w = window as unknown as { ptahConfig?: Record<string, unknown> };
      w.ptahConfig = { ...(w.ptahConfig ?? {}), ...extra };
    },
    {
      workspaceRoot: WORKSPACE_ROOT,
      workspaceName: 'ptah-e2e-ws-a',
      ...(initialView === 'chat'
        ? { initialSessionId: SESSION_ID, initialSessionName: SESSION_NAME }
        : {}),
    },
  );
}

/**
 * Sets the theme before the app reads it (`thoth-feed-visual.e2e.spec.ts:297`)
 * and dismisses the Thoth first-run popover, which otherwise sits over the
 * top of the chat tile (`app-state.service.ts:114`, stored as `'true'` at :1146).
 */
export async function installTheme(page: Page, theme: string): Promise<void> {
  await page.addInitScript((value: string) => {
    try {
      localStorage.setItem('ptah-theme', value);
      localStorage.setItem('ptah-thoth-first-run-dismissed', 'true');
    } catch {
      // Storage can be unavailable on the initial about:blank document.
    }
  }, theme);
}

// ---------------------------------------------------------------------------
// Quota owners (stats-limit-view-model.spec.ts:37-46)
// ---------------------------------------------------------------------------

function ownerRef(
  providerId: string,
  identityKind: QuotaOwnerRef['identityKind'],
  fingerprint: string,
  label: string,
): QuotaOwnerRef {
  return {
    key: `${providerId}#${identityKind}:${fingerprint}`,
    providerId,
    identityKind,
    label,
  };
}

/** The session's own account. */
export const CLAUDE_A = ownerRef('claude-cli', 'account', 'aaa', 'Claude account');
/** Same provider, another account: a restored run recorded before an account switch. */
export const CLAUDE_B = ownerRef('claude-cli', 'account', 'bbb', 'Claude account');
/** Another provider's account. */
export const CODEX = ownerRef('openai-codex', 'cli-store', 'ccc', 'Codex account');
/** Identity could not be determined (a proxy route). */
export const PROXY = ownerRef('unknown', 'unknown', 'ppp', 'Unknown owner');

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------

/** 5-hour window near its limit (stats-limit-view-model.spec.ts:460-480). */
const FIVE_HOUR_NEAR: PlanLimitWindow = {
  key: 'five_hour',
  kind: 'five_hour',
  label: '5-hour',
  used: { kind: 'percent', percent: 94 },
  usedSource: 'provider-api',
  resetsAt: NOW + 3 * HOUR + 10 * MIN,
  resetSource: 'provider-api',
  lastResetAt: NOW - 2 * HOUR,
  observedAt: NOW - MIN,
};

/** Weekly window with room. */
const WEEKLY_OK: PlanLimitWindow = {
  key: 'weekly',
  kind: 'weekly',
  label: 'Weekly',
  used: { kind: 'percent', percent: 40 },
  usedSource: 'provider-api',
  resetsAt: NOW + 3 * DAY,
  resetSource: 'provider-api',
  lastResetAt: NOW - 4 * DAY,
  observedAt: NOW - MIN,
};

/** Opus-only weekly window at its limit, read from an error, reset known (spec :74-88). */
const WEEKLY_OPUS_AT_LIMIT: PlanLimitWindow = {
  key: 'weekly_model:opus',
  kind: 'weekly_model',
  label: 'Weekly · Opus',
  modelScope: 'opus',
  used: { kind: 'percent', percent: 100 },
  usedSource: 'provider-api',
  resetsAt: NOW + 2 * DAY,
  resetSource: 'provider-api',
  lastResetAt: NOW - 5 * DAY,
  exhaustion: {
    observedAt: NOW - 10 * MIN,
    source: 'error-derived',
    resetsAt: NOW + 2 * DAY,
  },
  observedAt: NOW - MIN,
};

/** Window known, reset known, used unknown (card spec state 4 "weekly usage unknown"). */
const MONTHLY_USED_UNKNOWN: PlanLimitWindow = {
  key: 'monthly',
  kind: 'monthly',
  label: 'Monthly',
  resetsAt: NOW + 26 * DAY,
  resetSource: 'provider-api',
  observedAt: NOW - 2 * MIN,
};

/** A reset after the last observation: usage unknown (view-model spec :517-539, card state 14). */
const RESET_PASSED_USAGE_UNKNOWN: PlanLimitWindow = {
  key: 'other:sonnet-burst',
  kind: 'other',
  label: 'Burst',
  used: { kind: 'percent', percent: 80 },
  usedSource: 'provider-api',
  resetsAt: NOW - 40 * MIN,
  resetSource: 'provider-api',
  observedAt: NOW - 68 * MIN,
};

// ---------------------------------------------------------------------------
// Owner snapshots
// ---------------------------------------------------------------------------

/** Session owner, before the push: no Opus exhaustion yet observed. */
function claudeA(windows: readonly PlanLimitWindow[]): PlanLimitOwnerSnapshot {
  return {
    owner: CLAUDE_A,
    status: 'available',
    fetchedAt: NOW - MIN,
    windowSetEstablished: true,
    windows,
    ownerEvidence: [],
    // A provider retry delay (view-model spec :567-590, card state 8).
    cooldown: { until: NOW + 14 * MIN, observedAt: NOW - MIN },
  };
}

/** Past owner known only from saved evidence (view-model spec :603-624). */
const CLAUDE_B_SNAPSHOT: PlanLimitOwnerSnapshot = {
  owner: CLAUDE_B,
  status: 'service-unavailable',
  windowSetEstablished: false,
  windows: [
    {
      ...WEEKLY_OK,
      used: { kind: 'percent', percent: 60 },
    },
  ],
  ownerEvidence: [],
};

/**
 * Different provider with an estimated-limit note (view-model spec :697-735;
 * card spec "an estimated limit hit is informational"), plus Codex's
 * Activity block (card state 3).
 */
const CODEX_SNAPSHOT: PlanLimitOwnerSnapshot = {
  owner: CODEX,
  status: 'available',
  fetchedAt: NOW - 2 * MIN,
  windowSetEstablished: true,
  windows: [
    {
      key: 'five_hour',
      kind: 'five_hour',
      label: '5-hour',
      used: { kind: 'percent', percent: 38 },
      usedSource: 'provider-api',
      resetsAt: NOW + 4 * HOUR,
      resetSource: 'provider-api',
      lastResetAt: NOW - HOUR,
      observedAt: NOW - 2 * MIN,
    },
    {
      key: 'weekly',
      kind: 'weekly',
      label: 'Weekly',
      used: { kind: 'percent', percent: 12 },
      usedSource: 'provider-api',
      resetsAt: NOW + 5 * DAY,
      resetSource: 'provider-api',
      lastResetAt: NOW - HOUR,
      observedAt: NOW - 2 * MIN,
    },
  ],
  ownerEvidence: [
    { observedAt: NOW - MIN, source: 'estimated', resetsAt: NOW + HOUR },
  ],
  account: { planType: 'plus' },
  activity: { lifetimeTokens: '9007199254740993', dailyUsage: [] },
};

/** Owner whose identity is unknown: no windows are ever borrowed for it. */
const PROXY_SNAPSHOT: PlanLimitOwnerSnapshot = {
  owner: PROXY,
  status: 'no-usage-source',
  windowSetEstablished: false,
  windows: [],
  ownerEvidence: [],
};

const SESSION_WINDOWS_BEFORE: readonly PlanLimitWindow[] = [
  FIVE_HOUR_NEAR,
  WEEKLY_OK,
  MONTHLY_USED_UNKNOWN,
  RESET_PASSED_USAGE_UNKNOWN,
];

/**
 * `provider:getPlanLimits` answer. The session runs Sonnet, so the collapsed
 * alert is "Near · 5-hour 94%". Older than {@link PUSHED_SNAPSHOT}, so a re-load
 * answered after the push is dropped by the store's `generatedAt` guard.
 */
export const RPC_SNAPSHOT: PlanLimitsSnapshot = {
  generatedAt: NOW - 2 * MIN,
  owners: [
    claudeA(SESSION_WINDOWS_BEFORE),
    CLAUDE_B_SNAPSHOT,
    CODEX_SNAPSHOT,
    PROXY_SNAPSHOT,
  ],
  sessionOwners: {
    [SESSION_ID]: { ownerKey: CLAUDE_A.key, modelScope: 'sonnet' },
  },
};

/**
 * `planLimits:changed` push: the session switched to Opus and the host's ledger
 * saw the Opus weekly exhaustion, so the alert turns to "At limit".
 */
export const PUSHED_SNAPSHOT: PlanLimitsSnapshot = {
  generatedAt: NOW - MIN,
  owners: [
    claudeA([...SESSION_WINDOWS_BEFORE, WEEKLY_OPUS_AT_LIMIT]),
    CLAUDE_B_SNAPSHOT,
    CODEX_SNAPSHOT,
    PROXY_SNAPSHOT,
  ],
  sessionOwners: {
    [SESSION_ID]: { ownerKey: CLAUDE_A.key, modelScope: 'opus' },
  },
};

/**
 * Dashboard card snapshot: every owner of the push, so the card shows the
 * at-limit model window, used-unknown, reset-passed, cooldown, the estimate
 * note, the no-usage-source owner and the Codex Activity block.
 */
export const DASHBOARD_SNAPSHOT: PlanLimitsSnapshot = {
  ...PUSHED_SNAPSHOT,
  sessionOwners: {},
};

// ---------------------------------------------------------------------------
// Session transcript and stats (`chat:resume`)
// ---------------------------------------------------------------------------

function iso(instant: number): string {
  return new Date(instant).toISOString();
}

/** One history message: start, one text block, complete. */
function historyMessage(
  messageId: string,
  role: 'user' | 'assistant',
  text: string,
  timestamp: number,
): FlatStreamEventUnion[] {
  const base = {
    sessionId: SESSION_ID,
    source: 'history' as const,
    messageId,
    timestamp,
  };
  const complete: FlatStreamEventUnion =
    role === 'assistant'
      ? {
          ...base,
          id: `${messageId}-complete`,
          eventType: 'message_complete',
          stopReason: 'end_turn',
          tokenUsage: { input: 18_200, output: 2_400 },
          cost: 0.42,
          model: 'claude-opus-4-1',
        }
      : { ...base, id: `${messageId}-complete`, eventType: 'message_complete' };
  return [
    { ...base, id: `${messageId}-start`, eventType: 'message_start', role },
    {
      ...base,
      id: `${messageId}-text`,
      eventType: 'text_delta',
      delta: text,
      blockIndex: 0,
    },
    complete,
  ];
}

const HISTORY_EVENTS: FlatStreamEventUnion[] = [
  ...historyMessage(
    'msg-user-1',
    'user',
    'Review the quota reset handling and spawn lanes for docs and review.',
    NOW - 70 * MIN,
  ),
  ...historyMessage(
    'msg-assistant-1',
    'assistant',
    'Started a docs lane and a review lane. The 5-hour window is close to its limit, so I kept the lanes small.',
    NOW - 69 * MIN,
  ),
];

const SESSION_STATS: SessionStatsEntry = {
  sessionId: SESSION_ID,
  model: 'claude-opus-4-1',
  totalCost: 0.42,
  knownCost: 0.42,
  tokens: { input: 18_200, output: 2_400, cacheRead: 41_000, cacheCreation: 3_100 },
  tokenCount: 64_700,
  messageCount: 1,
  status: 'ok',
};

/** Restored runs: their tokens and cost restore as unknown (null totals). */
const RESTORED_CLI_SESSIONS: CliSessionReference[] = [
  {
    // Recorded on account B before the account switch: "Different owner".
    cliSessionId: 'cli-restored-1',
    cli: 'ptah-cli',
    agentId: 'agent-restored-claude-b' as CliSessionReference['agentId'],
    task: 'Draft the reset notes for the changelog',
    startedAt: iso(NOW - 3 * HOUR),
    status: 'completed',
    quotaOwner: CLAUDE_B,
  },
  {
    // Older record without an owner: "Unknown owner · owner not recorded".
    cliSessionId: 'cli-restored-2',
    cli: 'copilot',
    agentId: 'agent-restored-no-owner' as CliSessionReference['agentId'],
    task: 'Check the copy of the limits alert',
    startedAt: iso(NOW - 2 * HOUR),
    status: 'completed',
  },
];

export const CHAT_RESUME_RESULT: ChatResumeResult = {
  success: true,
  sessionId: SESSION_ID as ChatResumeResult['sessionId'],
  events: HISTORY_EVENTS,
  historyPage: { olderCursor: null },
  stats: SESSION_STATS,
  cliSessions: RESTORED_CLI_SESSIONS,
};

// ---------------------------------------------------------------------------
// Live lane runs (`agent-monitor:*` pushes)
// ---------------------------------------------------------------------------

/** One host -> webview message, in the shape `bridge.inject` takes. */
export interface HostMessage {
  readonly type: string;
  readonly payload: unknown;
}

function liveRun(
  over: Pick<AgentProcessInfo, 'agentId' | 'cli' | 'task' | 'startedAt'> &
    Partial<AgentProcessInfo>,
): AgentProcessInfo {
  return {
    workingDirectory: WORKSPACE_ROOT,
    status: 'running',
    parentSessionId: SESSION_ID,
    ...over,
  };
}

function usageOutput(
  agentId: AgentProcessInfo['agentId'],
  usage: NonNullable<AgentOutputDelta['segments']>[number]['usage'],
): HostMessage {
  const delta: AgentOutputDelta = {
    agentId,
    stdoutDelta: '',
    stderrDelta: '',
    timestamp: NOW - 5 * MIN,
    segments: [{ type: 'info', content: 'Usage reported', usage }],
  };
  return { type: 'agent-monitor:output', payload: delta };
}

const DOCS_RUN = liveRun({
  agentId: 'agent-live-docs' as AgentProcessInfo['agentId'],
  cli: 'ptah-cli',
  displayName: 'Claude',
  role: 'docs',
  model: 'claude-sonnet-4-5',
  task: 'Document the reset-time rules',
  startedAt: iso(NOW - 40 * MIN),
  quotaOwner: CLAUDE_A,
});

const REVIEW_RUN = liveRun({
  agentId: 'agent-live-review' as AgentProcessInfo['agentId'],
  cli: 'codex',
  displayName: 'Codex',
  role: 'review',
  model: 'gpt-5.5-codex',
  task: 'Review the plan-limits store',
  startedAt: iso(NOW - 35 * MIN),
  quotaOwner: CODEX,
});

const PROXY_RUN = liveRun({
  agentId: 'agent-live-proxy' as AgentProcessInfo['agentId'],
  cli: 'opencode',
  displayName: 'OpenCode',
  model: 'kimi-k2',
  task: 'Scan the proxy route for limit headers',
  startedAt: iso(NOW - 20 * MIN),
  quotaOwner: PROXY,
});

/**
 * Pushed after the session settles (`loadCliSessions` drops non-running cards
 * of a session it restores, so pushing earlier would lose the exited run).
 * Docs keeps running; review completes; the proxy run fails on quota.
 */
export const LIVE_LANE_MESSAGES: readonly HostMessage[] = [
  { type: 'agent-monitor:spawned', payload: DOCS_RUN },
  usageOutput(DOCS_RUN.agentId, {
    model: 'claude-sonnet-4-5',
    inputTokens: 12_400,
    outputTokens: 3_100,
    totalTokens: 15_500,
    costUsd: 0.21,
  }),
  { type: 'agent-monitor:spawned', payload: REVIEW_RUN },
  usageOutput(REVIEW_RUN.agentId, {
    model: 'gpt-5.5-codex',
    inputTokens: 8_200,
    outputTokens: 1_900,
    totalTokens: 10_100,
    costUsd: 0.07,
  }),
  {
    type: 'agent-monitor:exited',
    payload: {
      ...REVIEW_RUN,
      status: 'completed',
      exitCode: 0,
      completedAt: iso(NOW - 10 * MIN),
    },
  },
  { type: 'agent-monitor:spawned', payload: PROXY_RUN },
  // Tokens known, cost not reported: "cost unknown" for this run only.
  usageOutput(PROXY_RUN.agentId, { inputTokens: 2_300, outputTokens: 400 }),
  {
    type: 'agent-monitor:exited',
    payload: {
      ...PROXY_RUN,
      status: 'failed',
      exitCode: 1,
      failureKind: 'quota',
      completedAt: iso(NOW - 12 * MIN),
    },
  },
];

/** Number of lane tiles the session's five runs group into (cli:role). */
export const EXPECTED_LANE_TILES = 5;

/**
 * A second Codex login, recorded by no earlier run. Spawning a run on it
 * changes the chat surface's owner-key scope, which is the chat view's only
 * trigger for a new `provider:getPlanLimits` pull (it has no Refresh button).
 */
const CODEX_SECOND = ownerRef('openai-codex', 'cli-store', 'ddd', 'Codex account');

/** Spawn that makes the chat surface pull once more (the refresh-failed state). */
export const PULL_TRIGGER_MESSAGE: HostMessage = {
  type: 'agent-monitor:spawned',
  payload: liveRun({
    agentId: 'agent-live-second-codex' as AgentProcessInfo['agentId'],
    cli: 'codex',
    displayName: 'Codex',
    role: 'tests',
    model: 'gpt-5.5-codex',
    task: 'Run the plan-limits specs',
    startedAt: iso(NOW - 2 * MIN),
    quotaOwner: CODEX_SECOND,
  }),
};

// ---------------------------------------------------------------------------
// RPC answers
// ---------------------------------------------------------------------------

/**
 * The marketplace base set (workspace, plugins, harness health — what the
 * VS Code shell and the dashboard already need) plus the session and
 * plan-limit reads. `session:cli-sessions` answers EMPTY: `chat:resume`
 * already restored the cards, and a second non-empty restore would drop the
 * live runs that exited.
 */
/**
 * Mid-test switch for the `provider:getPlanLimits` answer. The resolver runs
 * in the Playwright process and reads this object on every call, so setting
 * `failPulls` makes the next pull a failed RPC while the page keeps the
 * snapshot it already holds (the refresh-failed state).
 */
export interface PlanLimitsRpcControl {
  failPulls: boolean;
}

export function planLimitsFixtures(
  snapshot: PlanLimitsSnapshot,
  control: PlanLimitsRpcControl = { failPulls: false },
): Record<string, unknown> {
  return {
    ...baseMarketplaceFixtures([WORKSPACE_ROOT]),
    'provider:getPlanLimits': () =>
      control.failPulls ? rpcError('usage read failed') : snapshot,
    'session:list': {
      sessions: [
        {
          id: SESSION_ID,
          name: SESSION_NAME,
          messageCount: 2,
          createdAt: NOW - 70 * MIN,
          lastActivityAt: NOW - 5 * MIN,
          isActive: false,
        },
      ],
      total: 1,
      hasMore: false,
    },
    'session:load': { sessionId: SESSION_ID, messages: [], agentSessions: [] },
    'chat:resume': CHAT_RESUME_RESULT,
    'session:cli-sessions': { cliSessions: [] },
  };
}
