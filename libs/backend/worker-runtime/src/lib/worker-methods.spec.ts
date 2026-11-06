import {
  REMOTE_METHODS,
  WORKER_METHOD_SCHEMAS,
  type WorkerGrant,
} from '@ptah-extension/worker-protocol';
import { WorkerSessionIndex } from './worker-session-index';
import { WorkerAuthorizer } from './worker-authorizer';
import {
  dispatchWorkerMethod,
  WORKER_METHODS,
  type WorkerHandlers,
} from './worker-methods';

const inside: WorkerGrant = { machineId: 'machine', workspaceIds: ['inside'] };
const index = new WorkerSessionIndex(async (workspaceId) =>
  workspaceId === 'inside' ? ['inside-session'] : ['outside-session'],
);
const authorizer = new WorkerAuthorizer('machine', index);
const valid = (
  method: (typeof REMOTE_METHODS)[number],
  id: string,
): unknown => {
  switch (method) {
    case 'sessions.list':
      return { workspaceId: id };
    case 'session.attach':
      return { sessionId: id };
    case 'session.detach':
      return { sessionId: id };
    case 'session.start':
      return { workspaceId: id, prompt: 'hello' };
    case 'session.continue':
      return { sessionId: id, prompt: 'hello' };
    case 'session.stop':
      return { sessionId: id };
    case 'permission.respond':
      return { sessionId: id, requestId: 'request', decision: 'deny' };
    default:
      return {};
  }
};

describe('WORKER_METHODS', () => {
  it('matches the protocol remote surface', () => {
    expect(Object.keys(WORKER_METHODS).sort()).toEqual(
      [...REMOTE_METHODS].sort(),
    );
  });

  it.each(REMOTE_METHODS)(
    '%s authorizes before invoking a handler',
    async (method) => {
      const handler = jest.fn(async () => ({}));
      const handlers = Object.fromEntries(
        REMOTE_METHODS.map((name) => [name, handler]),
      ) as unknown as WorkerHandlers;
      const resource = method === 'sessions.list' || method === 'session.start';
      const outside = resource ? 'outside' : 'outside-session';
      const missing = resource ? 'missing' : 'missing-session';
      if (resource || 'sessionId' in (valid(method, outside) as object)) {
        const outsideResult = await dispatchWorkerMethod(
          method,
          valid(method, outside),
          inside,
          authorizer,
          handlers,
        );
        const missingResult = await dispatchWorkerMethod(
          method,
          valid(method, missing),
          inside,
          authorizer,
          handlers,
        );
        expect(outsideResult).toEqual({
          ok: false,
          error: expect.objectContaining({ code: 'NOT_FOUND_OR_FORBIDDEN' }),
        });
        expect(missingResult).toEqual(outsideResult);
      } else {
        const wrongMachine = await dispatchWorkerMethod(
          method,
          valid(method, outside),
          { ...inside, machineId: 'other' },
          authorizer,
          handlers,
        );
        expect(wrongMachine).toEqual({
          ok: false,
          error: expect.objectContaining({ code: 'NOT_FOUND_OR_FORBIDDEN' }),
        });
      }
      expect(handler).not.toHaveBeenCalled();
      // The inside resource reaches result validation, proving the grant check passed.
      await dispatchWorkerMethod(
        method,
        valid(method, resource ? 'inside' : 'inside-session'),
        inside,
        authorizer,
        handlers,
      );
      expect(handler).toHaveBeenCalledTimes(1);
    },
  );

  it('rejects invalid params and unknown methods before handlers', async () => {
    const handler = jest.fn();
    const handlers = Object.fromEntries(
      REMOTE_METHODS.map((name) => [name, handler]),
    ) as unknown as WorkerHandlers;
    expect(
      (await dispatchWorkerMethod('unknown', {}, inside, authorizer, handlers))
        .ok,
    ).toBe(false);
    expect(
      (
        await dispatchWorkerMethod(
          'session.continue',
          { sessionId: 'inside-session', prompt: '' },
          inside,
          authorizer,
          handlers,
        )
      ).ok,
    ).toBe(false);
    expect(handler).not.toHaveBeenCalled();
    expect(
      WORKER_METHOD_SCHEMAS['permission.respond'].params.safeParse({
        sessionId: 'inside-session',
        requestId: 'r',
        decision: 'always_allow',
      }).success,
    ).toBe(false);
  });
});

it('keeps a typed refusal code from a handler and hides any other failure', async () => {
  const handlers = Object.fromEntries(
    REMOTE_METHODS.map((name) => [name, jest.fn()]),
  ) as unknown as Record<string, jest.Mock>;
  handlers['workspaces.list'].mockRejectedValue(
    Object.assign(new Error('busy'), { code: 'WORKER_BUSY' }),
  );
  handlers['machine.info'].mockRejectedValue(
    Object.assign(new Error('private path'), { code: 'CODEX_UNAVAILABLE' }),
  );
  const typed = await dispatchWorkerMethod(
    'workspaces.list',
    {},
    inside,
    authorizer,
    handlers as unknown as WorkerHandlers,
  );
  expect(typed).toMatchObject({ ok: false, error: { code: 'WORKER_BUSY' } });
  const hidden = await dispatchWorkerMethod(
    'machine.info',
    {},
    inside,
    authorizer,
    handlers as unknown as WorkerHandlers,
  );
  expect(hidden).toMatchObject({ ok: false, error: { code: 'INTERNAL' } });
  expect(JSON.stringify(hidden)).not.toContain('private path');
});
