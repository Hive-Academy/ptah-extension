// session-tool-args.schema reads MAX_AGENT_MESSAGE_LENGTH from
// tool-description.builder, whose workspace-intelligence import needs the
// reflect polyfill.
import 'reflect-metadata';
import type { Logger } from '@ptah-extension/vscode-core';
import type {
  SessionChildCompletionEnvelope,
  SessionChildSnapshot,
} from '@ptah-extension/cli-agent-runtime';
import type { SessionNamespace } from '../namespace-builders/session-namespace.builder';
import { MAX_AGENT_MESSAGE_LENGTH } from './tool-description.builder';
import {
  SessionReadArgsSchema,
  SessionSendArgsSchema,
  SessionStartArgsSchema,
  SessionStatusArgsSchema,
  SessionStopArgsSchema,
} from './session-tool-args.schema';
import {
  SESSION_TOOL_NAMES,
  buildSessionReadTool,
  buildSessionSendTool,
  buildSessionStartTool,
  buildSessionStatusTool,
  buildSessionStopTool,
  type SessionToolName,
} from './session-tools';
import {
  HELD_COMPLETIONS_HEADING,
  handleSessionToolCall,
} from './session-tool-handlers';

const PARITY = [
  [buildSessionStartTool, SessionStartArgsSchema, ['branch', 'task']],
  [buildSessionSendTool, SessionSendArgsSchema, ['message', 'sessionId']],
  [buildSessionStatusTool, SessionStatusArgsSchema, []],
  [buildSessionReadTool, SessionReadArgsSchema, ['sessionId']],
  [buildSessionStopTool, SessionStopArgsSchema, ['sessionId']],
] as const;

describe('session tool definitions', () => {
  it.each(PARITY)(
    '%p advertises exactly the keys its schema accepts, closed, with the right required set',
    (build, schema, required) => {
      const tool = build();
      expect(Object.keys(tool.inputSchema.properties).sort()).toEqual(
        Object.keys(schema.shape).sort(),
      );
      expect([...(tool.inputSchema.required ?? [])].sort()).toEqual([
        ...required,
      ]);
      expect(
        (tool.inputSchema as Record<string, unknown>)['additionalProperties'],
      ).toBe(false);
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.inputSchema).not.toHaveProperty('$schema');
    },
  );

  it('lists the five names in order', () => {
    expect(PARITY.map(([build]) => build().name)).toEqual([
      ...SESSION_TOOL_NAMES,
    ]);
  });

  it('marks status and read read-only only', () => {
    expect(buildSessionStatusTool().annotations?.readOnlyHint).toBe(true);
    expect(buildSessionReadTool().annotations?.readOnlyHint).toBe(true);
    expect(buildSessionStartTool().annotations).toBeUndefined();
    expect(buildSessionStopTool().annotations).toBeUndefined();
  });

  it('is deterministic: two builds serialise byte-identically', () => {
    for (const [build] of PARITY) {
      expect(JSON.stringify(build())).toBe(JSON.stringify(build()));
    }
  });
});

describe('session tool schemas', () => {
  it('rejects every caller, parent or permission key', () => {
    for (const key of [
      'callerSessionId',
      'parentSessionId',
      'permissionLevel',
      'worktreePath',
    ]) {
      expect(
        SessionStartArgsSchema.safeParse({ task: 't', branch: 'b', [key]: 'x' })
          .success,
      ).toBe(false);
    }
  });

  it('bounds the task and the label', () => {
    expect(
      SessionStartArgsSchema.safeParse({
        task: 'x'.repeat(MAX_AGENT_MESSAGE_LENGTH + 1),
        branch: 'b',
      }).success,
    ).toBe(false);
    expect(
      SessionStartArgsSchema.safeParse({
        task: 't',
        branch: 'b',
        label: 'l'.repeat(61),
      }).success,
    ).toBe(false);
  });

  it.each([
    ['TASK_2026_584', true],
    ['TASK_2026_584_5e7a', true],
    ['TASK_2026_58', false],
    ['task_2026_584', false],
    ['TASK_2026_584_XYZW', false],
  ])('taskId %s -> %p', (taskId, ok) => {
    expect(
      SessionStartArgsSchema.safeParse({ task: 't', branch: 'b', taskId })
        .success,
    ).toBe(ok);
  });

  it.each([
    ['.ptah/specs/TASK_2026_584', true],
    ['../outside', false],
    ['a/../../b', false],
    ['/abs/path', false],
    ['C:\\abs', false],
    ['\\\\server\\share', false],
  ])('taskFolder %s -> %p', (taskFolder, ok) => {
    expect(
      SessionStartArgsSchema.safeParse({ task: 't', branch: 'b', taskFolder })
        .success,
    ).toBe(ok);
  });

  it('caps deliverables at 20', () => {
    const base = { task: 't', branch: 'b' };
    expect(
      SessionStartArgsSchema.safeParse({
        ...base,
        deliverables: Array.from({ length: 20 }, (_, i) => `d${i}`),
      }).success,
    ).toBe(true);
    expect(
      SessionStartArgsSchema.safeParse({
        ...base,
        deliverables: Array.from({ length: 21 }, (_, i) => `d${i}`),
      }).success,
    ).toBe(false);
  });

  it('accepts the three send modes only', () => {
    for (const mode of ['queue', 'steer', 'if-idle']) {
      expect(
        SessionSendArgsSchema.safeParse({ sessionId: 's', message: 'm', mode })
          .success,
      ).toBe(true);
    }
    expect(
      SessionSendArgsSchema.safeParse({
        sessionId: 's',
        message: 'm',
        mode: 'now',
      }).success,
    ).toBe(false);
  });

  it('bounds tailKiB to an integer 1..256', () => {
    for (const [tailKiB, ok] of [
      [1, true],
      [256, true],
      [0, false],
      [257, false],
      [1.5, false],
    ] as const) {
      expect(
        SessionReadArgsSchema.safeParse({ sessionId: 's', tailKiB }).success,
      ).toBe(ok);
    }
  });
});

/* ------------------------------------------------------------------------- */

const CHILD: SessionChildSnapshot = {
  childSessionId: 'c-1',
  parentSessionId: 'p-1',
  label: 'parser fix',
  branch: 'feat/x',
  baseRef: 'a'.repeat(40),
  workspaceRoot: '/repo',
  worktreePath: '/repo/.worktrees/feat-x',
  deliverables: [],
  status: 'working',
  subagentPtahTools: 'available',
  startedAt: '2026-10-01T12:00:00.000Z',
  turnsSettled: 0,
  reportsDelivered: 0,
  reportsRefused: 0,
};

const HELD: SessionChildCompletionEnvelope = {
  childSessionId: 'c-1',
  turn: 2,
  verdict: 'unverified',
  text: '<agent-lane-completed cli="ptah-session" turn="2"/>',
};

function logger(): Logger & { warn: jest.Mock } {
  return { warn: jest.fn() } as unknown as Logger & { warn: jest.Mock };
}

function fakeSession(
  overrides: Partial<SessionNamespace> = {},
  held: readonly SessionChildCompletionEnvelope[] = [],
): SessionNamespace & { takeHeldCompletions: jest.Mock } {
  return {
    start: jest.fn().mockResolvedValue({ ok: true, child: CHILD }),
    send: jest
      .fn()
      .mockResolvedValue({ delivered: true, effect: 'started-turn' }),
    status: jest.fn().mockResolvedValue({ ok: true, children: [CHILD] }),
    read: jest.fn().mockResolvedValue({
      ok: true,
      result: {
        child: CHILD,
        transcript: 'TRANSCRIPT',
        truncated: false,
        available: true,
      },
    }),
    stop: jest
      .fn()
      .mockResolvedValue({ ok: true, child: { ...CHILD, status: 'stopped' } }),
    ...overrides,
    takeHeldCompletions: jest.fn(() => held),
  } as SessionNamespace & { takeHeldCompletions: jest.Mock };
}

const call = (
  name: SessionToolName,
  args: unknown,
  session: SessionNamespace,
  log = logger(),
) => handleSessionToolCall(name, args, session, log);

describe('handleSessionToolCall', () => {
  it('a zod failure is isError naming the field, and the namespace is not called', async () => {
    const session = fakeSession();
    const reply = await call('ptah_session_start', { task: 't' }, session);

    expect(reply.isError).toBe(true);
    expect(reply.text).toMatch(/invalid ptah_session_start arguments: branch/);
    expect(reply.text).toMatch(/Required: "task" and "branch"/);
    expect(session.start).not.toHaveBeenCalled();
  });

  it('forwards no caller from the arguments (a caller key is rejected)', async () => {
    const session = fakeSession();
    const reply = await call(
      'ptah_session_status',
      { callerSessionId: 'someone-else' },
      session,
    );
    expect(reply.isError).toBe(true);
    expect(session.status).not.toHaveBeenCalled();
  });

  it('renders a started child with its handle, branch and worktree', async () => {
    const session = fakeSession();
    const reply = await call(
      'ptah_session_start',
      { task: 'fix', branch: 'feat/x' },
      session,
    );
    expect(session.start).toHaveBeenCalledWith({
      task: 'fix',
      branch: 'feat/x',
    });
    expect(reply.isError).toBe(false);
    expect(reply.text).toMatch(/sessionId c-1/);
    expect(reply.text).toMatch(/feat\/x/);
    expect(reply.text).toMatch(/\/repo\/\.worktrees\/feat-x/);
  });

  it('a plain refusal is a plain-text answer with code and detail', async () => {
    const session = fakeSession({
      start: jest.fn().mockResolvedValue({
        ok: false,
        refusal: 'cap-reached',
        detail: '3 child sessions are already live',
      }),
    });
    const reply = await call(
      'ptah_session_start',
      { task: 't', branch: 'b' },
      session,
    );
    expect(reply).toEqual({
      isError: false,
      text: 'ptah_session_start refused (cap-reached): 3 child sessions are already live',
    });
  });

  it.each(['session-start-failed', 'worktree-failed'])(
    '%s is isError with the rollback table',
    async (refusal) => {
      const session = fakeSession({
        start: jest.fn().mockResolvedValue({
          ok: false,
          refusal,
          detail: 'host refused',
          rollback: [
            { step: 'remove-worktree', ok: true },
            { step: 'delete-branch', ok: false, detail: 'locked' },
          ],
        }),
      });
      const reply = await call(
        'ptah_session_start',
        { task: 't', branch: 'b' },
        session,
      );
      expect(reply.isError).toBe(true);
      expect(reply.text).toMatch(new RegExp(`refused \\(${refusal}\\)`));
      expect(reply.text).toMatch(/\| remove-worktree \| done \|/);
      expect(reply.text).toMatch(/\| delete-branch \| FAILED \| locked \|/);
    },
  );

  it('defaults nothing itself: send passes mode through (namespace defaults it)', async () => {
    const session = fakeSession();
    await call(
      'ptah_session_send',
      { sessionId: 'c-1', message: 'go' },
      session,
    );
    expect(session.send).toHaveBeenCalledWith({
      childSessionId: 'c-1',
      message: 'go',
      mode: undefined,
    });
  });

  it('a send refusal states the reason verbatim', async () => {
    const session = fakeSession({
      send: jest.fn().mockResolvedValue({
        delivered: false,
        reason: 'busy',
        detail: 'the child is mid-turn',
      }),
    });
    const reply = await call(
      'ptah_session_send',
      { sessionId: 'c-1', message: 'go', mode: 'if-idle' },
      session,
    );
    expect(reply).toEqual({
      isError: false,
      text: 'Message NOT delivered to c-1 (busy): the child is mid-turn',
    });
  });

  it('status with no children says so; a lookup refusal is plain text', async () => {
    const empty = fakeSession({
      status: jest.fn().mockResolvedValue({ ok: true, children: [] }),
    });
    expect((await call('ptah_session_status', {}, empty)).text).toBe(
      'This session has no child sessions.',
    );

    const refused = fakeSession({
      status: jest.fn().mockResolvedValue({
        ok: false,
        reason: 'not-a-child-of-caller',
        detail: 'c-9 belongs to another session',
      }),
    });
    expect(
      await call('ptah_session_status', { sessionId: 'c-9' }, refused),
    ).toEqual({
      isError: false,
      text: 'ptah_session_status refused (not-a-child-of-caller): c-9 belongs to another session',
    });
  });

  it('stop states that tab, transcript, worktree and branch remain', async () => {
    const reply = await call(
      'ptah_session_stop',
      { sessionId: 'c-1' },
      fakeSession(),
    );
    expect(reply.text).toMatch(/tab, its transcript, the worktree/);
    expect(reply.text).toMatch(/branch feat\/x remain/);
  });

  describe('held completions', () => {
    it('appends the held block to every tool, once', async () => {
      const args: Record<SessionToolName, unknown> = {
        ptah_session_start: { task: 't', branch: 'b' },
        ptah_session_send: { sessionId: 'c-1', message: 'm' },
        ptah_session_status: {},
        ptah_session_read: { sessionId: 'c-1' },
        ptah_session_stop: { sessionId: 'c-1' },
      };
      for (const name of SESSION_TOOL_NAMES) {
        const session = fakeSession({}, [HELD]);
        const reply = await call(name, args[name], session);
        expect(session.takeHeldCompletions).toHaveBeenCalledTimes(1);
        expect(reply.text).toContain(HELD_COMPLETIONS_HEADING);
        expect(reply.text).toContain(HELD.text);
      }
    });

    it('appends nothing when nothing is held', async () => {
      const reply = await call('ptah_session_status', {}, fakeSession());
      expect(reply.text).not.toContain(HELD_COMPLETIONS_HEADING);
    });

    it('also appends to an error result', async () => {
      const reply = await call(
        'ptah_session_start',
        {},
        fakeSession({}, [HELD]),
      );
      expect(reply.isError).toBe(true);
      expect(reply.text).toContain(HELD.text);
    });

    it('read puts the held block BEFORE the transcript so a prefix cut keeps it', async () => {
      const reply = await call(
        'ptah_session_read',
        { sessionId: 'c-1' },
        fakeSession({}, [HELD]),
      );
      expect(reply.text.indexOf(HELD.text)).toBeLessThan(
        reply.text.indexOf('TRANSCRIPT'),
      );
    });

    it('a failing take is logged and the reply still goes out', async () => {
      const session = fakeSession();
      session.takeHeldCompletions.mockImplementation(() => {
        throw new Error('registry gone');
      });
      const log = logger();
      const reply = await call('ptah_session_status', {}, session, log);
      expect(reply.isError).toBe(false);
      expect(reply.text).toMatch(/c-1/);
      expect(log.warn).toHaveBeenCalledWith(
        expect.stringMatching(/registry gone/),
      );
    });
  });

  it('a thrown namespace error (no spawner) is isError naming the cause', async () => {
    const session = fakeSession({
      start: jest
        .fn()
        .mockRejectedValue(new Error('Agent sessions are unavailable')),
    });
    const reply = await call(
      'ptah_session_start',
      { task: 't', branch: 'b' },
      session,
    );
    expect(reply).toEqual({
      isError: true,
      text: 'ptah_session_start failed: Agent sessions are unavailable',
    });
  });
});
