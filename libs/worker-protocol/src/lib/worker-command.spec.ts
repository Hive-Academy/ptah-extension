import { WORKER_REMOTE_COMMAND } from './worker-command';

it('uses the packaged worker entry point', () => {
  expect(WORKER_REMOTE_COMMAND).toBe('/opt/Ptah/resources/bin/ptah-worker');
});
