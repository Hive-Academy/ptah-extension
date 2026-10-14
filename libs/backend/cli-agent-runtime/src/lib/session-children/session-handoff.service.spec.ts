/**
 * SessionHandoffService (TASK_2026_655).
 *
 * Real: a tsyringe child container holding the fake host port (pattern
 * `session-spawner.service.spec.ts`) and a temp workspace folder with the
 * handoff file on disk. Fake: the child registry, lifecycle, workspace,
 * output channel, adapter and MCP status.
 */
import 'reflect-metadata';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { container as rootContainer, type DependencyContainer } from 'tsyringe';
import {
  SESSION_HANDOFF_START_FAILED_DETAIL,
  SESSION_HANDOFF_START_TIMEOUT_DETAIL,
  SESSION_HANDOFF_START_TIMEOUT_MS,
  SessionHandoffService,
} from './session-handoff.service';
import type { SessionHandoffRequest } from './session-handoff.port';
import type {
  ChildChatSessionStartOutcome,
  HandoffChatSessionStartInput,
} from './child-chat-session-host.port';
import { CLI_AGENT_RUNTIME_TOKENS } from '../di/tokens';

const CALLER = '11111111-2222-4333-8444-555555555555';
const CALLER_SDK = '22222222-3333-4444-8555-666666666666';
const CALLER_NEW_TAB = '33333333-4444-4555-8666-777777777777';
const PROMPT = 'Continue TASK_X from HANDOFF.md: finish batch 3.';

interface FakeRecord {
  tabId: string;
  realSessionId: string | null;
  config: { projectPath?: string; workspaceId?: string; sessionName?: string };
  permissionLevel: string;
  currentModel: string;
}

let root: string;
let outside: string;
let handoffPath: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'ptah-handoff-root-'));
  outside = mkdtempSync(join(tmpdir(), 'ptah-handoff-outside-'));
  handoffPath = join(root, 'HANDOFF.md');
  writeFileSync(handoffPath, '# Handoff\n');
  mkdirSync(join(root, 'a-directory'));
  writeFileSync(join(outside, 'HANDOFF.md'), '# Elsewhere\n');
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

function makeHarness() {
  const records = new Map<string, FakeRecord>();
  const addRecord = (record: FakeRecord) => {
    records.set(record.tabId, record);
    if (record.realSessionId) records.set(record.realSessionId, record);
  };
  addRecord({
    tabId: CALLER,
    realSessionId: CALLER_SDK,
    config: {
      projectPath: root,
      workspaceId: root,
      sessionName: 'Refactor auth',
    },
    permissionLevel: 'yolo',
    currentModel: 'claude-sonnet-4-5',
  });
  const lifecycle = { find: jest.fn((id: string) => records.get(id)) };
  const children = new Set<string>();
  const registry = {
    isChild: jest.fn((id: string | undefined) => !!id && children.has(id)),
  };
  const workspace = { getWorkspaceFolders: jest.fn(() => [root]) };
  const lines: string[] = [];
  const output = { appendLine: jest.fn((line: string) => lines.push(line)) };
  const adapter = { isSessionActive: jest.fn(() => true) };
  const mcpStatus = { getPort: jest.fn((): number | null => 4321) };
  const host = {
    startChildSession: jest.fn(),
    startHandoffSession: jest.fn(
      async (
        input: HandoffChatSessionStartInput,
      ): Promise<ChildChatSessionStartOutcome> => {
        // The new session is an ordinary chat session the lifecycle now knows.
        addRecord({
          tabId: input.tabId,
          realSessionId: null,
          config: {
            projectPath: input.cwd,
            workspaceId: input.workspaceRoot,
            sessionName: input.sessionName,
          },
          permissionLevel: input.permissionLevel ?? 'ask',
          currentModel: input.model ?? '',
        });
        return { started: true, uiAnnounced: true };
      },
    ),
  };

  const containerWith = (hostValue: unknown): DependencyContainer => {
    const scope = rootContainer.createChildContainer();
    if (hostValue !== null) {
      scope.register(CLI_AGENT_RUNTIME_TOKENS.CHILD_CHAT_SESSION_HOST, {
        useValue: hostValue,
      });
    }
    return scope;
  };

  const build = (
    overrides: {
      adapter?: unknown;
      container?: DependencyContainer | null;
      mcpStatus?: unknown;
    } = {},
  ) =>
    new SessionHandoffService(
      registry as never,
      lifecycle as never,
      workspace as never,
      output as never,
      ('adapter' in overrides ? overrides.adapter : adapter) as never,
      'container' in overrides
        ? (overrides.container ?? null)
        : containerWith(host),
      ('mcpStatus' in overrides ? overrides.mcpStatus : mcpStatus) as never,
    );

  const request = (
    overrides: Partial<SessionHandoffRequest> = {},
  ): SessionHandoffRequest => ({
    callerSessionId: CALLER,
    handoffPath,
    prompt: PROMPT,
    ...overrides,
  });

  return {
    service: build(),
    build,
    request,
    host,
    records,
    addRecord,
    children,
    workspace,
    lines,
    output,
    mcpStatus,
  };
}

describe('SessionHandoffService', () => {
  it('starts a top-level session in the caller cwd with its permission, model and descriptor', async () => {
    const h = makeHarness();

    const result = await h.service.handoff(h.request());

    expect(result).toEqual({
      ok: true,
      tabId: expect.any(String),
      label: 'Continued: Refactor auth',
      workspaceRoot: root,
      cwd: root,
      tabOpened: true,
    });
    expect(h.host.startHandoffSession).toHaveBeenCalledTimes(1);
    const input = h.host.startHandoffSession.mock.calls[0][0];
    expect(input).toEqual({
      tabId: result.ok ? result.tabId : '',
      workspaceRoot: root,
      cwd: root,
      prompt: PROMPT,
      sessionName: 'Continued: Refactor auth',
      model: 'claude-sonnet-4-5',
      permissionLevel: 'yolo',
      descriptor: {
        tabId: input.tabId,
        fromTabId: CALLER,
        fromSessionId: CALLER_SDK,
        workspaceRoot: root,
        cwd: root,
        label: 'Continued: Refactor auth',
        displayPrompt: PROMPT,
        startedAt: expect.any(Number),
      },
    });
    expect(input.tabId).not.toBe(CALLER);
    expect(h.host.startChildSession).not.toHaveBeenCalled();
  });

  it('uses a given label, truncated to 60 characters', async () => {
    const h = makeHarness();

    const result = await h.service.handoff(
      h.request({ label: 'x'.repeat(80) }),
    );

    expect(result.ok && result.label).toHaveLength(60);
  });

  it('omits the model when the caller has none, and reports a tab no webview took', async () => {
    const h = makeHarness();
    const caller = h.records.get(CALLER);
    if (caller) caller.currentModel = '';
    h.host.startHandoffSession.mockResolvedValueOnce({
      started: true,
      uiAnnounced: false,
    });

    const result = await h.service.handoff(h.request());

    expect(result).toMatchObject({ ok: true, tabOpened: false });
    expect(h.host.startHandoffSession.mock.calls[0][0]).not.toHaveProperty(
      'model',
    );
  });

  it('never logs the prompt text', async () => {
    const h = makeHarness();

    await h.service.handoff(h.request());
    await h.service.handoff(h.request());

    expect(h.lines).toHaveLength(2);
    expect(h.lines.every((line) => line.startsWith('[SessionHandoff]'))).toBe(
      true,
    );
    expect(h.lines.join('\n')).not.toContain(PROMPT);
  });

  describe('refusals', () => {
    it('chat-runtime-unavailable: no host registered', async () => {
      const h = makeHarness();
      const service = h.build({ container: null });

      await expect(service.handoff(h.request())).resolves.toMatchObject({
        ok: false,
        refusal: 'chat-runtime-unavailable',
      });
    });

    it('chat-runtime-unavailable: no agent adapter', async () => {
      const h = makeHarness();
      const service = h.build({ adapter: null });

      await expect(service.handoff(h.request())).resolves.toMatchObject({
        ok: false,
        refusal: 'chat-runtime-unavailable',
      });
    });

    it.each([
      ['no caller id', undefined],
      ['a malformed caller id', 'not-a-session'],
      ['a caller with no live session', CALLER_NEW_TAB],
    ])('unattributed-caller: %s', async (_name, callerSessionId) => {
      const h = makeHarness();

      await expect(
        h.service.handoff(h.request({ callerSessionId })),
      ).resolves.toMatchObject({ ok: false, refusal: 'unattributed-caller' });
      expect(h.host.startHandoffSession).not.toHaveBeenCalled();
    });

    it.each([
      ['its tab id', CALLER],
      ['its SDK id', CALLER_SDK],
    ])('child-session: a child caller, known by %s', async (_name, id) => {
      const h = makeHarness();
      h.children.add(id);

      await expect(h.service.handoff(h.request())).resolves.toMatchObject({
        ok: false,
        refusal: 'child-session',
      });
      expect(h.host.startHandoffSession).not.toHaveBeenCalled();
    });

    it.each([
      ['no MCP status', null],
      ['a port-less MCP status', { getPort: () => null }],
    ])('mcp-unavailable: %s', async (_name, mcpStatus) => {
      const h = makeHarness();
      const service = h.build({ mcpStatus });

      await expect(service.handoff(h.request())).resolves.toMatchObject({
        ok: false,
        refusal: 'mcp-unavailable',
      });
    });

    it('no-workspace: the caller has no cwd', async () => {
      const h = makeHarness();
      const caller = h.records.get(CALLER);
      if (caller) caller.config = { sessionName: 'x' };

      await expect(h.service.handoff(h.request())).resolves.toMatchObject({
        ok: false,
        refusal: 'no-workspace',
      });
    });

    it('no-workspace: the caller cwd is outside the open folders', async () => {
      const h = makeHarness();
      const caller = h.records.get(CALLER);
      if (caller) caller.config = { projectPath: outside, workspaceId: root };

      await expect(h.service.handoff(h.request())).resolves.toMatchObject({
        ok: false,
        refusal: 'no-workspace',
        detail: expect.stringContaining(outside),
      });
    });

    it.each([
      ['a relative path', () => 'HANDOFF.md'],
      ['a missing file', () => join(root, 'MISSING.md')],
      ['a directory', () => join(root, 'a-directory')],
      ['a file outside the open folders', () => join(outside, 'HANDOFF.md')],
    ])('handoff-file-missing: %s', async (_name, path) => {
      const h = makeHarness();

      const result = await h.service.handoff(
        h.request({ handoffPath: path() }),
      );

      expect(result).toMatchObject({
        ok: false,
        refusal: 'handoff-file-missing',
        detail: expect.stringContaining(path()),
      });
      expect(h.host.startHandoffSession).not.toHaveBeenCalled();
    });

    it('handoff-file-missing: the detail carries a safe error kind, not the fs message', async () => {
      const h = makeHarness();
      const path = join(root, 'MISSING.md');

      const result = await h.service.handoff(h.request({ handoffPath: path }));

      expect(result).toMatchObject({
        ok: false,
        refusal: 'handoff-file-missing',
      });
      const detail = (result as { detail: string }).detail;
      expect(detail).not.toContain('no such file');
      expect(detail).toContain('could not be read');
      expect(detail).not.toContain('stat ');
    });

    it('session-start-failed: the host did not start the session', async () => {
      const h = makeHarness();
      h.host.startHandoffSession.mockResolvedValueOnce({
        started: false,
        error: 'workspace is unsafe',
      });

      await expect(h.service.handoff(h.request())).resolves.toEqual({
        ok: false,
        refusal: 'session-start-failed',
        detail: SESSION_HANDOFF_START_FAILED_DETAIL,
      });
    });

    it('session-start-failed: the host threw', async () => {
      const h = makeHarness();
      h.host.startHandoffSession.mockRejectedValueOnce(new Error('kaput'));

      await expect(h.service.handoff(h.request())).resolves.toEqual({
        ok: false,
        refusal: 'session-start-failed',
        detail: SESSION_HANDOFF_START_FAILED_DETAIL,
      });
    });

    it.each([
      [
        'throws',
        (): Promise<ChildChatSessionStartOutcome> =>
          Promise.reject(new TypeError(`could not send: ${PROMPT}`)),
      ],
      [
        'reports',
        (): Promise<ChildChatSessionStartOutcome> =>
          Promise.resolve({ started: false, error: `bad input ${PROMPT}` }),
      ],
      [
        'throws (prompt in message, name and code)',
        (): Promise<ChildChatSessionStartOutcome> => {
          const error = Object.assign(new Error(`could not send: ${PROMPT}`), {
            code: `E_${PROMPT}`,
          });
          error.name = `Quoting ${PROMPT}`;
          return Promise.reject(error);
        },
      ],
    ])(
      'session-start-failed: a host that %s an error quoting the prompt leaks it nowhere',
      async (_name, outcome) => {
        const h = makeHarness();
        h.host.startHandoffSession.mockImplementationOnce(outcome);

        const result = await h.service.handoff(h.request());

        expect(result).toEqual({
          ok: false,
          refusal: 'session-start-failed',
          detail: SESSION_HANDOFF_START_FAILED_DETAIL,
        });
        expect(JSON.stringify(result)).not.toContain(PROMPT);
        expect(h.output.appendLine).toHaveBeenCalled();
        for (const [line] of h.output.appendLine.mock.calls) {
          expect(line).not.toContain(PROMPT);
          expect(line).not.toContain('could not send');
        }
      },
    );

    it('already-handed-off: a second call names the earlier tab', async () => {
      const h = makeHarness();
      const first = await h.service.handoff(h.request());
      if (!first.ok) throw new Error('first handoff should start');

      const second = await h.service.handoff(h.request());

      expect(second).toEqual({
        ok: false,
        refusal: 'already-handed-off',
        detail: expect.stringContaining(first.tabId),
      });
      expect(h.host.startHandoffSession).toHaveBeenCalledTimes(1);
    });

    it('already-handed-off: the same SDK session from a new tab', async () => {
      const h = makeHarness();
      await h.service.handoff(h.request());
      h.addRecord({
        tabId: CALLER_NEW_TAB,
        realSessionId: CALLER_SDK,
        config: { projectPath: root },
        permissionLevel: 'ask',
        currentModel: '',
      });

      await expect(
        h.service.handoff(h.request({ callerSessionId: CALLER_NEW_TAB })),
      ).resolves.toMatchObject({ ok: false, refusal: 'already-handed-off' });
    });

    it('already-handed-off: a concurrent second call while the first starts', async () => {
      const h = makeHarness();
      let release: () => void = () => undefined;
      h.host.startHandoffSession.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = () => resolve({ started: true, uiAnnounced: true });
          }),
      );

      const first = h.service.handoff(h.request());
      // Let the first call pass its awaited file check and reach the host.
      while (h.host.startHandoffSession.mock.calls.length === 0) {
        await new Promise((resolve) => setImmediate(resolve));
      }
      const second = await h.service.handoff(h.request());
      release();

      expect(second).toMatchObject({
        ok: false,
        refusal: 'already-handed-off',
      });
      await expect(first).resolves.toMatchObject({ ok: true });
    });

    it('already-handed-off: a concurrent call by the SDK id while the tab id call starts', async () => {
      const h = makeHarness();
      let release: () => void = () => undefined;
      h.host.startHandoffSession.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = () => resolve({ started: true, uiAnnounced: true });
          }),
      );

      const first = h.service.handoff(h.request({ callerSessionId: CALLER }));
      while (h.host.startHandoffSession.mock.calls.length === 0) {
        await new Promise((resolve) => setImmediate(resolve));
      }
      const second = await h.service.handoff(
        h.request({ callerSessionId: CALLER_SDK }),
      );
      release();

      expect(second).toEqual({
        ok: false,
        refusal: 'already-handed-off',
        detail: 'a handoff from this session is already in progress',
      });
      await expect(first).resolves.toMatchObject({ ok: true });
      expect(h.host.startHandoffSession).toHaveBeenCalledTimes(1);
    });

    it('a failed start does not count as a handoff', async () => {
      const h = makeHarness();
      h.host.startHandoffSession.mockResolvedValueOnce({
        started: false,
        error: 'boom',
      });
      await h.service.handoff(h.request());

      await expect(h.service.handoff(h.request())).resolves.toMatchObject({
        ok: true,
      });
    });
  });

  describe('a host start that does not settle in time', () => {
    beforeEach(() => {
      jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
    });
    afterEach(() => {
      jest.useRealTimers();
    });

    const flush = () => new Promise((resolve) => setImmediate(resolve));

    /** Runs a handoff past its deadline; the host start settles on `settle`. */
    async function startHanging(h: ReturnType<typeof makeHarness>) {
      let settle: (outcome: ChildChatSessionStartOutcome) => void = () =>
        undefined;
      h.host.startHandoffSession.mockImplementationOnce(
        () =>
          new Promise<ChildChatSessionStartOutcome>((resolve) => {
            settle = resolve;
          }),
      );
      const pending = h.service.handoff(h.request());
      while (h.host.startHandoffSession.mock.calls.length === 0) {
        await flush();
      }
      jest.advanceTimersByTime(SESSION_HANDOFF_START_TIMEOUT_MS);
      return {
        result: await pending,
        settle: (o: ChildChatSessionStartOutcome) => settle(o),
      };
    }

    it('refuses at the deadline, saying it may still open late', async () => {
      const h = makeHarness();

      const { result } = await startHanging(h);

      expect(result).toEqual({
        ok: false,
        refusal: 'session-start-failed',
        detail: SESSION_HANDOFF_START_TIMEOUT_DETAIL,
      });
      expect(SESSION_HANDOFF_START_TIMEOUT_DETAIL).toContain(
        'may still open late',
      );
      expect(jest.getTimerCount()).toBe(0);
    });

    it('keeps the caller reserved until a late success, then records it', async () => {
      const h = makeHarness();
      const { settle } = await startHanging(h);

      await expect(
        h.service.handoff(h.request({ callerSessionId: CALLER_SDK })),
      ).resolves.toEqual({
        ok: false,
        refusal: 'already-handed-off',
        detail: 'a handoff from this session is already in progress',
      });

      settle({ started: true, uiAnnounced: true });
      await flush();
      const lateTab = h.host.startHandoffSession.mock.calls[0][0].tabId;

      await expect(h.service.handoff(h.request())).resolves.toEqual({
        ok: false,
        refusal: 'already-handed-off',
        detail: `this session already handed off to tab ${lateTab}`,
      });
      expect(h.host.startHandoffSession).toHaveBeenCalledTimes(1);
    });

    it('frees the caller after a late failure', async () => {
      const h = makeHarness();
      const { settle } = await startHanging(h);

      settle({ started: false, error: 'boom' });
      await flush();

      await expect(h.service.handoff(h.request())).resolves.toMatchObject({
        ok: true,
      });
      expect(h.host.startHandoffSession).toHaveBeenCalledTimes(2);
    });
  });

  describe('an output channel that throws', () => {
    const throwing = () => {
      throw new Error('channel closed');
    };

    it('still resolves a successful start', async () => {
      const h = makeHarness();
      h.output.appendLine.mockImplementation(throwing);

      await expect(h.service.handoff(h.request())).resolves.toMatchObject({
        ok: true,
        tabOpened: true,
      });
      expect(h.host.startHandoffSession).toHaveBeenCalledTimes(1);
    });

    it('still resolves the refusal already decided', async () => {
      const h = makeHarness();
      h.output.appendLine.mockImplementation(throwing);

      await expect(
        h.service.handoff(h.request({ handoffPath: 'HANDOFF.md' })),
      ).resolves.toMatchObject({
        ok: false,
        refusal: 'handoff-file-missing',
      });
    });
  });

  it('a session started by a handoff can itself hand off', async () => {
    const h = makeHarness();
    const first = await h.service.handoff(h.request());
    if (!first.ok) throw new Error('first handoff should start');

    const second = await h.service.handoff(
      h.request({ callerSessionId: first.tabId }),
    );

    expect(second).toMatchObject({ ok: true, cwd: root });
    expect(h.host.startHandoffSession).toHaveBeenCalledTimes(2);
    expect(
      h.host.startHandoffSession.mock.calls[1][0].descriptor.fromTabId,
    ).toBe(first.tabId);
  });
});
