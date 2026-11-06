import { WorkerSessionIndex } from './worker-session-index';

it('only scans granted workspaces and refreshes after a miss', async () => {
  const list = jest.fn(async (workspaceId: string) =>
    workspaceId === 'inside' ? ['inside-session'] : ['outside-session'],
  );
  const index = new WorkerSessionIndex(list);
  const grant = { machineId: 'machine', workspaceIds: ['inside'] };
  expect(await index.workspaceOf('outside-session', grant)).toBeUndefined();
  expect(list).toHaveBeenCalledWith('inside');
  expect(list).not.toHaveBeenCalledWith('outside');
  expect(await index.workspaceOf('inside-session', grant)).toBe('inside');
});
