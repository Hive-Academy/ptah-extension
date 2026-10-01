/**
 * Specs for buildSessionOrganizationNamespace (TASK_2026_580, D12).
 *
 * Covers:
 *   - linkTask records on the resolved SDK session with source 'agent' and the
 *     default role 'primary'
 *   - an explicit 'related' role, and the workspace-root hint pass-through
 *   - Zod rejection of a bad taskId, a bad role, and a caller-supplied
 *     sessionId (the caller is never an argument)
 *   - organization-unavailable without a recorder (VS Code)
 *   - unattributed-caller when the caller does not resolve
 *   - link-failed when a faulty recorder throws
 */

import {
  buildSessionOrganizationNamespace,
  type SessionOrganizationNamespaceDependencies,
  type SessionTaskLinkRecorderLike,
} from './session-organization-namespace.builder';

const SDK_ID = '5f0c1d2e-sdk-session';
const ROOT = 'D:\\ws';
const TASK_ID = 'TASK_2026_580_9f77';

function makeRecorder(): SessionTaskLinkRecorderLike & { linkTask: jest.Mock } {
  return { linkTask: jest.fn() };
}

function makeDeps(
  overrides: Partial<SessionOrganizationNamespaceDependencies> = {},
): SessionOrganizationNamespaceDependencies {
  return {
    resolveCallerSessionId: () => SDK_ID,
    getRecorder: () => undefined,
    getWorkspaceRootHint: () => ROOT,
    ...overrides,
  };
}

describe('buildSessionOrganizationNamespace — linkTask', () => {
  it('links the calling SDK session as primary with source agent by default', () => {
    const recorder = makeRecorder();
    const ns = buildSessionOrganizationNamespace(
      makeDeps({ getRecorder: () => recorder }),
    );

    const out = ns.linkTask({ taskId: TASK_ID });

    expect(out).toEqual({
      ok: true,
      sessionId: SDK_ID,
      taskId: TASK_ID,
      role: 'primary',
    });
    expect(recorder.linkTask).toHaveBeenCalledTimes(1);
    expect(recorder.linkTask).toHaveBeenCalledWith({
      sessionId: SDK_ID,
      workspaceRootHint: ROOT,
      taskId: TASK_ID,
      role: 'primary',
      source: 'agent',
    });
  });

  it('passes an explicit related role through', () => {
    const recorder = makeRecorder();
    const out = buildSessionOrganizationNamespace(
      makeDeps({ getRecorder: () => recorder }),
    ).linkTask({ taskId: TASK_ID, role: 'related' });

    expect(out).toEqual(expect.objectContaining({ ok: true, role: 'related' }));
    expect(recorder.linkTask).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'related', source: 'agent' }),
    );
  });

  it('omits workspaceRootHint when no workspace root resolves', () => {
    const recorder = makeRecorder();
    buildSessionOrganizationNamespace(
      makeDeps({
        getRecorder: () => recorder,
        getWorkspaceRootHint: () => undefined,
      }),
    ).linkTask({ taskId: TASK_ID });

    expect(recorder.linkTask.mock.calls[0][0]).not.toHaveProperty(
      'workspaceRootHint',
    );
  });

  it.each([
    ['a missing taskId', {}],
    ['undefined args', undefined],
    ['an empty taskId', { taskId: '' }],
    ['a traversal taskId', { taskId: '../escape' }],
    ['a nested taskId', { taskId: 'a/b' }],
    ['an unknown role', { taskId: TASK_ID, role: 'owner' }],
    ['a caller-supplied sessionId', { taskId: TASK_ID, sessionId: 'other' }],
  ])('rejects %s as invalid-args without recording', (_label, args) => {
    const recorder = makeRecorder();
    const resolve = jest.fn(() => SDK_ID);
    const out = buildSessionOrganizationNamespace(
      makeDeps({ getRecorder: () => recorder, resolveCallerSessionId: resolve }),
    ).linkTask(args);

    expect(out).toEqual(
      expect.objectContaining({ ok: false, error: 'invalid-args' }),
    );
    expect(recorder.linkTask).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
  });

  it('returns organization-unavailable when the host has no recorder', () => {
    const out = buildSessionOrganizationNamespace(makeDeps()).linkTask({
      taskId: TASK_ID,
    });

    expect(out).toEqual(
      expect.objectContaining({ ok: false, error: 'organization-unavailable' }),
    );
  });

  it.each([
    ['undefined', undefined],
    ['an empty string', ''],
  ])(
    'returns unattributed-caller when the caller resolves to %s',
    (_label, resolved) => {
      const recorder = makeRecorder();
      const out = buildSessionOrganizationNamespace(
        makeDeps({
          getRecorder: () => recorder,
          resolveCallerSessionId: () => resolved,
        }),
      ).linkTask({ taskId: TASK_ID });

      expect(out).toEqual(
        expect.objectContaining({ ok: false, error: 'unattributed-caller' }),
      );
      expect(recorder.linkTask).not.toHaveBeenCalled();
    },
  );

  it('returns link-failed when a faulty recorder throws', () => {
    const recorder = makeRecorder();
    recorder.linkTask.mockImplementation(() => {
      throw new Error('recorder boom');
    });
    const out = buildSessionOrganizationNamespace(
      makeDeps({ getRecorder: () => recorder }),
    ).linkTask({ taskId: TASK_ID });

    expect(out).toEqual({
      ok: false,
      error: 'link-failed',
      message: 'recorder boom',
    });
  });
});
