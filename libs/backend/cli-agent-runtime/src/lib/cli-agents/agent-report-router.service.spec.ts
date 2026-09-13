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
} from './agent-report-router.service';

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
  const manager = {
    findAgentInfo,
    recordAgentNote,
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

      const result = await h.router.deliver({ agentId: 'ghost', message: 'hi' });

      expect(result.reason).toBe('unattributed-caller');
      expect(h.sendMessageToSession).not.toHaveBeenCalled();
    });

    it('refuses when no parent was recorded at spawn', async () => {
      const h = createHarness({
        info: createInfo({ parentSessionId: undefined }),
      });

      const result = await h.router.deliver({ agentId: AGENT_ID, message: 'x' });

      expect(result).toEqual({ delivered: false, reason: 'no-parent-recorded' });
      expect(h.sendMessageToSession).not.toHaveBeenCalled();
    });

    it('refuses when the recorded parent never resolved to a real session id', async () => {
      // A tab id, not a session uuid: `resolveParentSessionId` never backfilled
      // it, so there is nothing to deliver into.
      const h = createHarness({ info: createInfo({ parentSessionId: 'tab-7' }) });

      const result = await h.router.deliver({ agentId: AGENT_ID, message: 'x' });

      expect(result.reason).toBe('no-parent-recorded');
    });

    it('refuses when the parent session is no longer active', async () => {
      const h = createHarness({ sessionActive: false });

      const result = await h.router.deliver({ agentId: AGENT_ID, message: 'x' });

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

      const result = await h.router.deliver({ agentId: AGENT_ID, message: 'x' });

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

      const result = await h.router.deliver({ agentId: AGENT_ID, message: 'x' });

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
