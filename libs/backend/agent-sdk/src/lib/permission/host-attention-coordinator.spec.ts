import 'reflect-metadata';
import { AgentId, MESSAGE_TYPES, workspaceIdFromPath, type SdkTerminalReason } from '@ptah-extension/shared';
import type {
  IHostAttentionNotifications,
  IWorkspaceProvider,
  SafeHostAttentionNotice,
} from '@ptah-extension/platform-core';
import { Logger } from '@ptah-extension/vscode-core';
import { SessionMetadataStore, type SessionMetadata } from '../session-metadata-store';
import { HostAttentionCoordinator, isFailureTerminalReason } from './host-attention-coordinator';

const terminalReasonFailures = {
  blocking_limit: true,
  rapid_refill_breaker: true,
  prompt_too_long: true,
  image_error: true,
  model_error: true,
  api_error: true,
  malformed_tool_use_exhausted: true,
  aborted_streaming: false,
  aborted_tools: false,
  stop_hook_prevented: false,
  hook_stopped: false,
  tool_deferred: false,
  tool_deferred_unavailable: false,
  max_turns: false,
  background_requested: false,
  budget_exhausted: true,
  structured_output_retry_exhausted: true,
  turn_setup_failed: true,
  completed: false,
} satisfies Record<SdkTerminalReason, boolean>;

describe('isFailureTerminalReason', () => {
  it.each(Object.entries(terminalReasonFailures))('%s => %s', (reason, expected) => {
    expect(isFailureTerminalReason(reason as SdkTerminalReason)).toBe(expected);
  });
  it('treats no terminal reason as neutral', () => {
    expect(isFailureTerminalReason(null)).toBe(false);
  });
});

const target = {
  workspaceId: workspaceIdFromPath('/workspace'),
  sessionId: 'session-1',
};
const request = {
  id: 'request-1',
  timestamp: 10,
  sessionId: 'session-1',
  tabId: 'tab-1',
  question: 'secret question',
  body: 'secret body',
  prompt: 'secret prompt',
  toolInput: { password: 'secret value' },
  toolArgs: 'secret arguments',
  error: 'secret raw error',
};

function setup(name: string | undefined = 'Planning session') {
  const presented: SafeHostAttentionNotice[] = [];
  const host: IHostAttentionNotifications = {
    present: jest.fn((notice) => { presented.push(notice); }),
    resolve: jest.fn(),
    isEligible: jest.fn(() => true),
    open: jest.fn(),
    dispose: jest.fn(),
  };
  const settings = new Map<string, unknown>();
  const workspace: IWorkspaceProvider = {
    getWorkspaceFolders: () => ['/workspace'],
    getWorkspaceRoot: () => '/workspace',
    getConfiguration: <T>(section: string, key: string, fallback?: T): T | undefined =>
      section === 'ptah' && settings.has(key) ? settings.get(key) as T : fallback,
    setConfiguration: jest.fn(async () => undefined),
    onDidChangeConfiguration: () => ({ dispose: jest.fn() }),
    onDidChangeWorkspaceFolders: () => ({ dispose: jest.fn() }),
  };
  const metadata = Object.create(SessionMetadataStore.prototype) as SessionMetadataStore;
  const record: SessionMetadata = {
    sessionId: 'session-1', workspaceId: '/workspace', name: name ?? '',
    createdAt: 1, lastActiveAt: 1, totalCost: 0,
    totalTokens: { input: 0, output: 0 },
  };
  metadata.get = jest.fn(async () => record);
  metadata.getAll = jest.fn(async () => []);
  const logger = Object.create(Logger.prototype) as Logger;
  logger.warn = jest.fn();
  logger.debug = jest.fn();
  const coordinator = new HostAttentionCoordinator(host, workspace, metadata, logger);
  return { coordinator, host, settings, presented, logger, metadata, workspace };
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('HostAttentionCoordinator', () => {
  it('exposes pending safe requests independently of native presentation', async () => {
    const { coordinator, settings } = setup();
    settings.set('notifications.hostEnabled', false);
    coordinator.observe(MESSAGE_TYPES.PERMISSION_REQUEST, request);
    await settle();
    const notices = coordinator.pendingNotices();
    expect(notices).toEqual([expect.objectContaining({
      key: 'permission:request-1', generation: 10,
      sessionTitle: 'Planning session',
    })]);
    expect(JSON.stringify(notices)).not.toContain('secret');
    coordinator.resolve('permission:request-1', 10);
    expect(coordinator.pendingNotices()).toEqual([]);
  });

  it('issues one notice per generation and replaces a newer generation', async () => {
    const { coordinator, host, presented } = setup();
    coordinator.observe(MESSAGE_TYPES.PERMISSION_REQUEST, request);
    coordinator.observe(MESSAGE_TYPES.PERMISSION_REQUEST, request);
    await settle();
    expect(presented).toHaveLength(1);
    coordinator.observe(MESSAGE_TYPES.PERMISSION_REQUEST, { ...request, timestamp: 11 });
    await settle();
    expect(presented).toHaveLength(2);
    expect(host.resolve).toHaveBeenCalledWith('permission:request-1', 10);
    coordinator.resolve('permission:request-1', 10);
    expect(host.resolve).toHaveBeenCalledTimes(1);
    coordinator.resolve('permission:request-1', 11);
    expect(host.resolve).toHaveBeenCalledWith('permission:request-1', 11);
  });

  it('reads request and failure settings separately at issue time', async () => {
    const { coordinator, settings, presented } = setup();
    settings.set('notifications.hostEnabled', false);
    coordinator.observe(MESSAGE_TYPES.PERMISSION_REQUEST, request);
    await settle();
    expect(presented).toHaveLength(0);
    coordinator.presentFailure('failed-turn', 1, 'session', target);
    await settle();
    expect(presented).toHaveLength(0);
    settings.set('notifications.failureHostEnabled', true);
    coordinator.presentFailure('failed-turn', 2, 'session', target);
    await settle();
    expect(presented).toHaveLength(1);
    expect(presented[0].kind).toBe('failure');
    expect(presented[0].key).toMatch(/^c:/);
  });

  it('uses authoritative title, truncates code points, and falls back for untitled sessions', async () => {
    const long = `${'A'.repeat(79)}😀extra`;
    const { coordinator, presented } = setup(long);
    coordinator.observe(MESSAGE_TYPES.ASK_USER_QUESTION_REQUEST, request);
    await settle();
    expect(presented[0].sessionTitle).toBe(`${'A'.repeat(79)}😀`);
    const fallback = setup('  ');
    fallback.coordinator.observe(MESSAGE_TYPES.PERMISSION_REQUEST, request);
    await settle();
    expect(fallback.presented[0].sessionTitle).toBe('Ptah session');
  });

  it('excludes private request fields, ignores unknown types and drops invalid payloads', async () => {
    const { coordinator, presented, logger } = setup();
    coordinator.observe('other:event', request);
    coordinator.observe(MESSAGE_TYPES.PERMISSION_REQUEST, { id: 5 });
    coordinator.observe(MESSAGE_TYPES.PERMISSION_REQUEST, request);
    await settle();
    expect(presented).toHaveLength(1);
    expect(logger.warn).toHaveBeenCalledWith('[HostAttentionCoordinator] Invalid request payload');
    const serialized = JSON.stringify(presented);
    for (const secret of ['secret question', 'secret body', 'secret prompt', 'secret value', 'secret arguments', 'secret raw error']) {
      expect(serialized).not.toContain(secret);
    }
  });

  it('checks host eligibility and logs only error names on port failure', async () => {
    const { coordinator, host, logger, presented } = setup();
    jest.mocked(host.isEligible).mockReturnValueOnce(false);
    coordinator.observe(MESSAGE_TYPES.PERMISSION_REQUEST, request);
    await settle();
    expect(presented).toHaveLength(0);
    jest.mocked(host.present).mockImplementationOnce(() => { throw new TypeError('secret raw error'); });
    coordinator.observe(MESSAGE_TYPES.PERMISSION_REQUEST, { ...request, timestamp: 11 });
    await settle();
    expect(logger.warn).toHaveBeenCalledWith('[HostAttentionCoordinator] present failed', { errorName: 'TypeError' });
  });

  it('keeps ownerless MCP approvals in-app without claiming a generation', async () => {
    const { coordinator, host } = setup();
    coordinator.observe(MESSAGE_TYPES.PERMISSION_REQUEST, { id: 'mcp', timestamp: 1 });
    await settle();
    expect(coordinator.pendingNotices()).toEqual([]);
    expect(host.present).not.toHaveBeenCalled();
    expect(host.resolve).not.toHaveBeenCalled();
  });

  it('routes lane permissions through their parent metadata', async () => {
    const { coordinator, metadata, presented } = setup();
    const parent = await metadata.get('session-1');
    const agentId = AgentId.from('11111111-2222-4333-8444-555555555555');
    jest.mocked(metadata.getAll).mockResolvedValue([{ ...parent!, cliSessions: [{
      cliSessionId: 'cli-1', cli: 'codex', agentId, task: 'Test lane',
      startedAt: '2026-01-01T00:00:00.000Z', status: 'running',
    }] }]);
    coordinator.observe(MESSAGE_TYPES.AGENT_MONITOR_PERMISSION_REQUEST, {
      requestId: 'lane-request', agentId, timestamp: 20,
    });
    await settle();
    expect(presented[0]).toMatchObject({ kind: 'lane-permission', target: { sessionId: 'session-1' } });
  });

  it('does not resurrect a request resolved during metadata lookup', async () => {
    const { coordinator, metadata, presented } = setup();
    let finish: ((value: Awaited<ReturnType<SessionMetadataStore['get']>>) => void) | undefined;
    jest.mocked(metadata.get).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    coordinator.observe(MESSAGE_TYPES.PERMISSION_REQUEST, request);
    coordinator.resolve('permission:request-1', 10);
    finish?.(null);
    await settle();
    expect(presented).toEqual([]);
    expect(coordinator.pendingNotices()).toEqual([]);
  });

  it('releases session failures on a new turn', async () => {
    const { coordinator, settings, host, presented } = setup();
    settings.set('notifications.failureHostEnabled', true);
    await coordinator.presentSessionFailure('session-1', 23);
    await settle();
    expect(presented[0]).toMatchObject({ kind: 'failure', target: { sessionId: 'session-1' } });
    coordinator.releaseSessionFailure('session-1');
    expect(host.resolve).toHaveBeenCalledWith(presented[0].key, 23);
  });

  it('drops a failure key when the host gate is off so the same generation can be retried', async () => {
    const { coordinator, settings, presented } = setup();
    coordinator.presentFailure('failed-turn', 42, 'session', target);
    await settle();
    settings.set('notifications.failureHostEnabled', true);
    coordinator.presentFailure('failed-turn', 42, 'session', target);
    await settle();
    expect(presented).toHaveLength(1);
  });

  it('evicts failure keys before live requests at capacity', async () => {
    const { coordinator, settings, host } = setup();
    settings.set('notifications.failureHostEnabled', true);
    coordinator.observe(MESSAGE_TYPES.PERMISSION_REQUEST, request);
    await settle();
    for (let index = 0; index < 256; index++) {
      coordinator.presentFailure(`failure-${index}`, index + 1, 'session', target);
    }
    await settle();
    expect(coordinator.pendingNotices()).toHaveLength(1);
    expect(host.resolve).not.toHaveBeenCalledWith('permission:request-1', 10);
  });

  it('logs ownerless drops without identifiers and does not present after release during lookup', async () => {
    const { coordinator, metadata, logger, presented } = setup();
    jest.mocked(metadata.get).mockResolvedValueOnce(null);
    await coordinator.presentSessionFailure('missing-secret-session', 5);
    expect(logger.debug).toHaveBeenCalledWith('[HostAttentionCoordinator] Session failure dropped: owner unavailable');
    jest.mocked(metadata.get).mockResolvedValueOnce(null);
    coordinator.observe(MESSAGE_TYPES.PERMISSION_REQUEST, { ...request, id: 'secret-request' });
    await settle();
    expect(logger.debug).toHaveBeenCalledWith('[HostAttentionCoordinator] Request dropped: owner metadata unavailable');
    let finish: ((value: Awaited<ReturnType<SessionMetadataStore['get']>>) => void) | undefined;
    jest.mocked(metadata.get).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const pending = coordinator.presentSessionFailure('session-1', 6);
    coordinator.releaseSessionFailure('session-1');
    finish?.(await setup().metadata.get('session-1'));
    await pending;
    expect(presented).toEqual([]);
  });

  it('routes a failed lane through its recorded parent and skips an unowned lane', async () => {
    const { coordinator, metadata, settings, presented, logger } = setup();
    settings.set('notifications.failureHostEnabled', true);
    const parent = await metadata.get('session-1');
    jest.mocked(metadata.get).mockResolvedValue(parent);
    await coordinator.presentLaneFailure('agent-1', 'session-1', 30);
    await settle();
    expect(presented[0]).toMatchObject({ label: 'Lane failed', target: { sessionId: 'session-1' } });
    await coordinator.presentLaneFailure('agent-2', undefined, 31);
    expect(presented).toHaveLength(1);
    expect(logger.debug).toHaveBeenCalledWith('[HostAttentionCoordinator] Lane failure dropped: owner unavailable');
  });

  it('releases the current lane failure generation', async () => {
    const { coordinator, host, settings } = setup();
    settings.set('notifications.failureHostEnabled', true);
    await coordinator.presentLaneFailure('agent-1', 'session-1', 30);
    await settle();
    coordinator.releaseLaneFailure('agent-1');
    expect(host.resolve).toHaveBeenCalledWith(`c:${workspaceIdFromPath('lane:agent-1')}`, 30);
  });

  it('bounds live requests and expires stale pending snapshots', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_000);
    try {
      const { coordinator, host } = setup();
      for (let index = 0; index < 260; index++) {
        coordinator.observe(MESSAGE_TYPES.PERMISSION_REQUEST, {
          ...request, id: `request-${index}`, timestamp: index + 1,
        });
      }
      await settle();
      expect(coordinator.pendingNotices()).toHaveLength(256);
      expect(host.resolve).toHaveBeenCalledWith('permission:request-0', 1);
      now.mockReturnValue(1_000 + 2 * 60 * 60 * 1000 + 1);
      expect(coordinator.pendingNotices()).toEqual([]);
    } finally {
      now.mockRestore();
    }
  });

  it('uses the default for malformed settings and removes title controls', async () => {
    const { coordinator, settings, presented } = setup('A\nB\u0000C');
    settings.set('notifications.hostEnabled', 'invalid');
    coordinator.observe(MESSAGE_TYPES.PERMISSION_REQUEST, request);
    await settle();
    expect(presented[0].sessionTitle).toBe('A B C');
  });
});
