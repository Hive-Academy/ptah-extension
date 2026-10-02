/**
 * `AgentReportRouter` — child → parent delivery with limits (TASK_2026_402).
 *
 * The property every test here defends: the router NEVER reports a delivery it
 * did not make. A refusal carries a named reason, writes no tile segment, and
 * consumes no burst budget.
 */
import 'reflect-metadata';

import { AgentProcessInfo, CliOutputSegment } from '@ptah-extension/shared';
import type { Logger } from '@ptah-extension/vscode-core';
import type { AgentProcessManager } from './agent-process-manager.service';
import {
  AGENT_REPORT_BURST_LIMIT,
  AGENT_REPORT_BURST_WINDOW_MS,
  AGENT_REPORT_HISTORY_SIZE,
  AgentReportRouter,
  MAX_AGENT_REPORT_LENGTH,
  type AgentReportInput,
} from './agent-report-router.service';
import { SessionChildRegistry } from '../session-children/session-child.registry';

const PARENT = '11111111-2222-4333-8444-555555555555';
const AGENT_ID = 'agent-abc';

function createLogger(): jest.Mocked<Logger> {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as jest.Mocked<Logger>;
}

function createInfo(overrides: Partial<AgentProcessInfo> = {}) {
  return {
    agentId: AGENT_ID,
    cli: 'codex',
    task: 'do a thing',
    workingDirectory: '/ws',
    status: 'running',
    startedAt: new Date().toISOString(),
    parentSessionId: PARENT,
    displayName: 'Codex CLI',
    ...overrides,
  } as unknown as AgentProcessInfo;
}

interface Harness {
  router: AgentReportRouter;
  logger: jest.Mocked<Logger>;
  findAgentInfo: jest.Mock;
  recordAgentNote: jest.Mock<void, [string, CliOutputSegment]>;
  markReportDelivered: jest.Mock<void, [string]>;
  isSessionActive: jest.Mock;
  sendMessageToSession: jest.Mock;
}

function createHarness(
  options: {
    info?: AgentProcessInfo | undefined;
    sessionActive?: boolean;
    withAdapter?: boolean;
    sendImpl?: () => Promise<void>;
  } = {},
): Harness {
  const logger = createLogger();
  const findAgentInfo = jest.fn(() => options.info ?? createInfo());
  const recordAgentNote = jest.fn();
  const markReportDelivered = jest.fn();
  const manager = {
    findAgentInfo,
    recordAgentNote,
    markReportDelivered,
  } as unknown as AgentProcessManager;

  const isSessionActive = jest.fn(() => options.sessionActive !== false);
  const sendMessageToSession = jest.fn(
    options.sendImpl ?? (() => Promise.resolve()),
  );
  const adapter =
    options.withAdapter === false
      ? null
      : ({ isSessionActive, sendMessageToSession } as never);

  return {
    router: new AgentReportRouter(logger, manager, adapter),
    logger,
    findAgentInfo,
    recordAgentNote,
    markReportDelivered,
    isSessionActive,
    sendMessageToSession,
  };
}

describe('AgentReportRouter.deliver', () => {
  describe('the happy path', () => {
    it('sends exactly one turn with the peer origin and writes exactly one tile segment', async () => {
      const h = createHarness();

      const result = await h.router.deliver({
        agentId: AGENT_ID,
        message: 'blocked on a missing credential',
        summary: 'blocked',
      });

      expect(result).toEqual({ delivered: true, parentSessionId: PARENT });
      expect(h.sendMessageToSession).toHaveBeenCalledTimes(1);
      const [sessionId, content, opts] = h.sendMessageToSession.mock.calls[0];
      expect(sessionId).toBe(PARENT);
      expect(content).toContain(`<agent-report agent-id="${AGENT_ID}"`);
      expect(content).toContain('cli="codex"');
      expect(content).toContain('blocked on a missing credential');
      expect(content.endsWith('</agent-report>')).toBe(true);
      expect(opts.origin).toEqual({
        kind: 'peer',
        from: `ptah-agent:${AGENT_ID}`,
        name: 'codex · Codex CLI',
      });

      expect(h.recordAgentNote).toHaveBeenCalledTimes(1);
      // Counted for the completion signal's `reportsDelivered`, and only on a
      // delivery (TASK_2026_515).
      expect(h.markReportDelivered).toHaveBeenCalledTimes(1);
      expect(h.markReportDelivered).toHaveBeenCalledWith(AGENT_ID);
      const [notedAgentId, segment] = h.recordAgentNote.mock.calls[0];
      expect(notedAgentId).toBe(AGENT_ID);
      expect(segment.type).toBe('info');
      expect(segment.content).toContain('blocked');
    });

    it('escapes quotes in the envelope attributes so the shape cannot be rewritten', async () => {
      const h = createHarness({
        info: createInfo({ ptahCliName: 'a "quoted" & <angled> name' }),
      });

      await h.router.deliver({ agentId: AGENT_ID, message: 'hi' });

      const content = h.sendMessageToSession.mock.calls[0][1] as string;
      expect(content).toContain(
        'agent="a &quot;quoted&quot; &amp; &lt;angled&gt; name"',
      );
    });

    it('renders the body once when the summary equals the message (TASK_2026_466 defect 3)', async () => {
      const h = createHarness();

      await h.router.deliver({
        agentId: AGENT_ID,
        message: 'STEP2: done',
        summary: 'STEP2: done',
      });

      const content = h.sendMessageToSession.mock.calls[0][1] as string;
      expect(content).toBe(
        `<agent-report agent-id="${AGENT_ID}" agent="Codex CLI" cli="codex">\n` +
          'STEP2: done\n' +
          '</agent-report>',
      );
    });

    it('renders the body once when the summary differs from the message only by whitespace', async () => {
      const h = createHarness();

      await h.router.deliver({
        agentId: AGENT_ID,
        message: 'STEP2: done',
        summary: '  STEP2: done  ',
      });

      const content = h.sendMessageToSession.mock.calls[0][1] as string;
      expect(content).toBe(
        `<agent-report agent-id="${AGENT_ID}" agent="Codex CLI" cli="codex">\n` +
          'STEP2: done\n' +
          '</agent-report>',
      );
    });

    it('renders both the summary and the message when they differ (TASK_2026_466 defect 3)', async () => {
      const h = createHarness();

      await h.router.deliver({
        agentId: AGENT_ID,
        message: 'codex received the queued message',
        summary: 'Queued message delivered',
      });

      const content = h.sendMessageToSession.mock.calls[0][1] as string;
      expect(content).toBe(
        `<agent-report agent-id="${AGENT_ID}" agent="Codex CLI" cli="codex">\n` +
          'Queued message delivered\n\n' +
          'codex received the queued message\n' +
          '</agent-report>',
      );
    });
  });

  describe('refusals', () => {
    it('refuses an empty agent id as unattributed-caller', async () => {
      const h = createHarness();

      const result = await h.router.deliver({ agentId: '', message: 'hi' });

      expect(result).toEqual({
        delivered: false,
        reason: 'unattributed-caller',
      });
      expect(h.sendMessageToSession).not.toHaveBeenCalled();
      expect(h.recordAgentNote).not.toHaveBeenCalled();
      expect(h.logger.warn).toHaveBeenCalled();
    });

    it('refuses an unknown agent id as unattributed-caller', async () => {
      const h = createHarness();
      h.findAgentInfo.mockReturnValue(undefined);

      const result = await h.router.deliver({
        agentId: 'ghost',
        message: 'hi',
      });

      expect(result.reason).toBe('unattributed-caller');
      expect(h.sendMessageToSession).not.toHaveBeenCalled();
    });

    it('refuses when no parent was recorded at spawn', async () => {
      const h = createHarness({
        info: createInfo({ parentSessionId: undefined }),
      });

      const result = await h.router.deliver({
        agentId: AGENT_ID,
        message: 'x',
      });

      expect(result).toEqual({
        delivered: false,
        reason: 'no-parent-recorded',
      });
      expect(h.sendMessageToSession).not.toHaveBeenCalled();
    });

    it('refuses when the recorded parent never resolved to a real session id', async () => {
      // A tab id, not a session uuid: `resolveParentSessionId` never backfilled
      // it, so there is nothing to deliver into.
      const h = createHarness({
        info: createInfo({ parentSessionId: 'tab-7' }),
      });

      const result = await h.router.deliver({
        agentId: AGENT_ID,
        message: 'x',
      });

      expect(result.reason).toBe('no-parent-recorded');
    });

    it('refuses when the parent session is no longer active', async () => {
      const h = createHarness({ sessionActive: false });

      const result = await h.router.deliver({
        agentId: AGENT_ID,
        message: 'x',
      });

      expect(result).toEqual({
        delivered: false,
        reason: 'parent-session-not-active',
      });
      expect(h.sendMessageToSession).not.toHaveBeenCalled();
      expect(h.recordAgentNote).not.toHaveBeenCalled();
    });

    it('refuses a body over the size cap without consulting session state', async () => {
      const h = createHarness();

      const result = await h.router.deliver({
        agentId: AGENT_ID,
        message: 'x'.repeat(MAX_AGENT_REPORT_LENGTH + 1),
      });

      expect(result).toEqual({ delivered: false, reason: 'report-too-large' });
      expect(h.isSessionActive).not.toHaveBeenCalled();
      expect(h.sendMessageToSession).not.toHaveBeenCalled();
    });

    it('accepts a body exactly at the cap', async () => {
      const h = createHarness();

      const result = await h.router.deliver({
        agentId: AGENT_ID,
        message: 'x'.repeat(MAX_AGENT_REPORT_LENGTH),
      });

      expect(result.delivered).toBe(true);
    });

    it('refuses once the burst limit is reached, and lets the window clear it', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-09-12T00:00:00Z'));
      try {
        const h = createHarness();

        for (let i = 0; i < AGENT_REPORT_BURST_LIMIT; i++) {
          const ok = await h.router.deliver({
            agentId: AGENT_ID,
            // Distinct bodies so the repeat suppressor is not what refuses.
            message: `report ${i}`,
          });
          expect(ok.delivered).toBe(true);
        }

        const refused = await h.router.deliver({
          agentId: AGENT_ID,
          message: 'one too many',
        });
        expect(refused).toEqual({ delivered: false, reason: 'rate-limited' });
        expect(h.sendMessageToSession).toHaveBeenCalledTimes(
          AGENT_REPORT_BURST_LIMIT,
        );

        jest.setSystemTime(Date.now() + AGENT_REPORT_BURST_WINDOW_MS + 1);
        const after = await h.router.deliver({
          agentId: AGENT_ID,
          message: 'one too many',
        });
        expect(after.delivered).toBe(true);
      } finally {
        jest.useRealTimers();
      }
    });

    it('counts deliveries beyond the body ring, so the limit is not silently capped', async () => {
      // Regression: the burst counter and the identical-repeat ring were ONE
      // list bounded by AGENT_REPORT_HISTORY_SIZE, so any burst limit above
      // that size could never fire. With the measured limit of 30 against an
      // 8-entry ring, that bug is the difference between a rate limit and no
      // rate limit at all.
      expect(AGENT_REPORT_BURST_LIMIT).toBeGreaterThan(
        AGENT_REPORT_HISTORY_SIZE,
      );
      const h = createHarness();

      for (let i = 0; i < AGENT_REPORT_HISTORY_SIZE + 2; i++) {
        const ok = await h.router.deliver({
          agentId: AGENT_ID,
          message: `report ${i}`,
        });
        expect(ok.delivered).toBe(true);
      }
      // Every one of them still counts against the burst budget.
      expect(h.sendMessageToSession).toHaveBeenCalledTimes(
        AGENT_REPORT_HISTORY_SIZE + 2,
      );
    });

    it('suppresses a byte-identical repeat', async () => {
      const h = createHarness();

      expect(
        (await h.router.deliver({ agentId: AGENT_ID, message: 'same' }))
          .delivered,
      ).toBe(true);
      const second = await h.router.deliver({
        agentId: AGENT_ID,
        message: 'same',
      });

      expect(second).toEqual({ delivered: false, reason: 'duplicate-report' });
      expect(h.sendMessageToSession).toHaveBeenCalledTimes(1);
      expect(h.recordAgentNote).toHaveBeenCalledTimes(1);
    });

    it('keys the limits per agent, so one child cannot starve another', async () => {
      const h = createHarness();
      h.findAgentInfo.mockImplementation((id: string) =>
        createInfo({ agentId: id as AgentProcessInfo['agentId'] }),
      );

      expect(
        (await h.router.deliver({ agentId: 'agent-a', message: 'same' }))
          .delivered,
      ).toBe(true);
      expect(
        (await h.router.deliver({ agentId: 'agent-b', message: 'same' }))
          .delivered,
      ).toBe(true);
    });

    it('refuses with chat-runtime-unavailable when no agent adapter is registered', async () => {
      const h = createHarness({ withAdapter: false });

      const result = await h.router.deliver({
        agentId: AGENT_ID,
        message: 'x',
      });

      expect(result).toEqual({
        delivered: false,
        reason: 'chat-runtime-unavailable',
      });
      expect(h.recordAgentNote).not.toHaveBeenCalled();
    });

    it('reports delivery-failed and writes no tile note when the injection throws', async () => {
      const h = createHarness({
        sendImpl: () => Promise.reject(new Error('session closed mid-send')),
      });

      const result = await h.router.deliver({
        agentId: AGENT_ID,
        message: 'x',
      });

      expect(result).toEqual({ delivered: false, reason: 'delivery-failed' });
      expect(h.recordAgentNote).not.toHaveBeenCalled();
      expect(h.logger.warn).toHaveBeenCalledWith(
        '[AgentReportRouter] Report refused',
        expect.objectContaining({
          reason: 'delivery-failed',
          detail: 'session closed mid-send',
        }),
      );
    });

    it('does not spend burst budget on a refused call', async () => {
      const h = createHarness({ sessionActive: false });

      for (let i = 0; i < AGENT_REPORT_BURST_LIMIT + 3; i++) {
        const r = await h.router.deliver({
          agentId: AGENT_ID,
          message: `n ${i}`,
        });
        expect(r.reason).toBe('parent-session-not-active');
      }

      h.isSessionActive.mockReturnValue(true);
      const ok = await h.router.deliver({ agentId: AGENT_ID, message: 'now' });
      expect(ok.delivered).toBe(true);
    });
  });
});

/*
 * Child chat sessions started with `ptah_session_start` (TASK_2026_584).
 */
describe('AgentReportRouter.deliver — session child', () => {
  const CHILD = 'aaaaaaaa-2222-4333-8444-555555555555';
  const CHILD_SDK = 'bbbbbbbb-2222-4333-8444-555555555555';
  const PARENT_SDK = 'cccccccc-2222-4333-8444-555555555555';

  function createSessionHarness(
    options: {
      activeIds?: readonly string[];
      sendImpl?: () => Promise<void>;
      withRegistry?: boolean;
    } = {},
  ) {
    const logger = createLogger();
    const manager = {
      findAgentInfo: jest.fn(),
      recordAgentNote: jest.fn(),
      markReportDelivered: jest.fn(),
    } as unknown as AgentProcessManager;
    const active = new Set(options.activeIds ?? [PARENT]);
    const isSessionActive: jest.Mock = jest.fn((id: string) => active.has(id));
    const sendMessageToSession: jest.Mock = jest.fn(
      options.sendImpl ?? (() => Promise.resolve()),
    );
    const registry = new SessionChildRegistry();
    const reservation = registry.reserveSlot(3);
    if (!reservation) throw new Error('expected a slot');
    registry.add(
      {
        childSessionId: CHILD,
        sdkSessionId: CHILD_SDK,
        parentSessionId: PARENT,
        parentSdkSessionId: PARENT_SDK,
        label: 'auth-fix',
        task: 'fix auth',
        branch: 'feat/auth-fix',
        baseRef: 'abc',
        workspaceRoot: '/ws',
        worktreePath: '/ws-wt/auth-fix',
        deliverables: [],
        subagentPtahTools: 'available',
        startedAt: '2026-10-01T10:00:00.000Z',
        turnsSettled: 0,
        reportsDelivered: 0,
        reportsRefused: 0,
      },
      reservation,
    );
    const router = new AgentReportRouter(
      logger,
      manager,
      { isSessionActive, sendMessageToSession } as never,
      options.withRegistry === false ? null : registry,
    );
    return {
      router,
      registry,
      manager,
      active,
      isSessionActive,
      sendMessageToSession,
    };
  }

  it('delivers into the recorded parent tab with the ptah-session envelope and origin', async () => {
    const h = createSessionHarness();

    const result = await h.router.deliver({
      childSessionId: CHILD,
      message: 'tests pass, opening the PR draft',
      summary: 'tests pass',
    });

    expect(result).toEqual({ delivered: true, parentSessionId: PARENT });
    expect(h.sendMessageToSession).toHaveBeenCalledTimes(1);
    const [sessionId, content, opts] = h.sendMessageToSession.mock.calls[0];
    expect(sessionId).toBe(PARENT);
    expect(content).toBe(
      `<agent-report agent-id="${CHILD}" agent="auth-fix" cli="ptah-session">\n` +
        'tests pass\n\ntests pass, opening the PR draft\n</agent-report>',
    );
    expect(opts.origin).toEqual({
      kind: 'peer',
      from: `ptah-session:${CHILD}`,
      name: 'session · auth-fix',
    });
    expect(h.registry.get(CHILD)?.reportsDelivered).toBe(1);
    // A session child has no agent tile; the process manager is not touched.
    expect(h.manager.recordAgentNote).not.toHaveBeenCalled();
    expect(h.manager.markReportDelivered).not.toHaveBeenCalled();
  });

  it('resolves a report sent under the child SDK id to the same child', async () => {
    const h = createSessionHarness();

    const result = await h.router.deliver({
      childSessionId: CHILD_SDK,
      message: 'hello',
    });

    expect(result.delivered).toBe(true);
    expect(h.sendMessageToSession.mock.calls[0][1]).toContain(
      `agent-id="${CHILD}"`,
    );
  });

  it('keeps an agent input with childSessionId: undefined on the agent path', async () => {
    const h = createSessionHarness();
    const info = createInfo();
    (h.manager.findAgentInfo as jest.Mock).mockReturnValue(info);

    const result = await h.router.deliver({
      agentId: AGENT_ID,
      childSessionId: undefined,
      message: 'from a lane',
    } as unknown as AgentReportInput);

    expect(result).toEqual({ delivered: true, parentSessionId: PARENT });
    expect(h.manager.findAgentInfo).toHaveBeenCalledWith(AGENT_ID);
    expect(h.sendMessageToSession.mock.calls[0][1]).toContain('cli="codex"');
    expect(h.registry.get(CHILD)?.reportsDelivered).toBe(0);
  });

  it('refuses an unknown child as unattributed-caller', async () => {
    const h = createSessionHarness();

    const result = await h.router.deliver({
      childSessionId: '12345678-2222-4333-8444-555555555555',
      message: 'hi',
    });

    expect(result).toEqual({ delivered: false, reason: 'unattributed-caller' });
    expect(h.sendMessageToSession).not.toHaveBeenCalled();
  });

  it('refuses every child report when no registry is present', async () => {
    const h = createSessionHarness({ withRegistry: false });

    const result = await h.router.deliver({
      childSessionId: CHILD,
      message: 'hi',
    });

    expect(result.reason).toBe('unattributed-caller');
  });

  it('refuses an over-size body before consulting the parent', async () => {
    const h = createSessionHarness();

    const result = await h.router.deliver({
      childSessionId: CHILD,
      message: 'x'.repeat(MAX_AGENT_REPORT_LENGTH + 1),
    });

    expect(result.reason).toBe('report-too-large');
    expect(h.isSessionActive).not.toHaveBeenCalled();
  });

  it('counts and does not queue a report while the parent is not live', async () => {
    const h = createSessionHarness({ activeIds: [] });

    const result = await h.router.deliver({
      childSessionId: CHILD,
      message: 'long body\nsecond line',
    });

    expect(result).toEqual({
      delivered: false,
      reason: 'parent-session-not-active',
    });
    expect(h.sendMessageToSession).not.toHaveBeenCalled();
    const child = h.registry.get(CHILD);
    expect(child?.reportsRefused).toBe(1);
    expect(child?.lastRefusedReport).toBe('long body');
    expect(child?.reportsDelivered).toBe(0);

    // Nothing was queued: the parent coming back does not replay it.
    h.active.add(PARENT);
    expect(h.sendMessageToSession).not.toHaveBeenCalled();
  });

  it('records the given summary as the last refused report', async () => {
    const h = createSessionHarness({ activeIds: [] });

    await h.router.deliver({
      childSessionId: CHILD,
      message: 'body',
      summary: '  blocked on creds ',
    });

    expect(h.registry.get(CHILD)?.lastRefusedReport).toBe('blocked on creds');
  });

  it('delivers to the parent SDK id when the recorded parent tab is gone', async () => {
    const h = createSessionHarness({ activeIds: [PARENT_SDK] });

    const result = await h.router.deliver({
      childSessionId: CHILD,
      message: 'hi',
    });

    expect(result).toEqual({ delivered: true, parentSessionId: PARENT_SDK });
    expect(h.sendMessageToSession.mock.calls[0][0]).toBe(PARENT_SDK);
  });

  it('applies the shared burst limit under its own session key', async () => {
    const h = createSessionHarness();

    for (let i = 0; i < AGENT_REPORT_BURST_LIMIT; i++) {
      const r = await h.router.deliver({
        childSessionId: CHILD,
        message: `n ${i}`,
      });
      expect(r.delivered).toBe(true);
    }
    const over = await h.router.deliver({
      childSessionId: CHILD,
      message: 'one too many',
    });

    expect(over).toEqual({ delivered: false, reason: 'rate-limited' });
    expect(h.registry.get(CHILD)?.reportsDelivered).toBe(
      AGENT_REPORT_BURST_LIMIT,
    );
  });

  it('refuses an identical repeat as duplicate-report', async () => {
    const h = createSessionHarness();

    await h.router.deliver({ childSessionId: CHILD, message: 'same' });
    const again = await h.router.deliver({
      childSessionId: CHILD,
      message: 'same',
    });

    expect(again.reason).toBe('duplicate-report');
    expect(h.sendMessageToSession).toHaveBeenCalledTimes(1);
  });

  it('reports delivery-failed and counts nothing when the runtime rejects the turn', async () => {
    const h = createSessionHarness({
      sendImpl: () => Promise.reject(new Error('session busy')),
    });

    const result = await h.router.deliver({
      childSessionId: CHILD,
      message: 'x',
    });

    expect(result.reason).toBe('delivery-failed');
    expect(h.registry.get(CHILD)?.reportsDelivered).toBe(0);
    expect(h.registry.get(CHILD)?.reportsRefused).toBe(0);
  });
});
