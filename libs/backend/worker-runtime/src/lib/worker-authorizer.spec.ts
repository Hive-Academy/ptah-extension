import { WorkerAuthorizer } from './worker-authorizer';
import { WorkerSessionIndex } from './worker-session-index';

it('uses identical refusal for excluded and missing sessions', async () => {
  const index = new WorkerSessionIndex(async (workspaceId) =>
    workspaceId === 'inside' ? ['inside-session'] : ['outside-session'],
  );
  const authorizer = new WorkerAuthorizer('machine', index);
  const grant = { machineId: 'machine', workspaceIds: ['inside'] };
  expect(
    await authorizer.check(grant, [
      { kind: 'session', sessionId: 'inside-session' },
    ]),
  ).toBeUndefined();
  const outside = await authorizer.check(grant, [
    { kind: 'session', sessionId: 'outside-session' },
  ]);
  const missing = await authorizer.check(grant, [
    { kind: 'session', sessionId: 'missing-session' },
  ]);
  expect(outside).toEqual(missing);
  expect(outside?.code).toBe('NOT_FOUND_OR_FORBIDDEN');
});
