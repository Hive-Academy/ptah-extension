import { createWorkerRpcHostProfile } from './worker-host-profile';

it('uses the headless worker profile', () => {
  const profile = createWorkerRpcHostProfile();
  expect(profile.host).toBe('worker');
  expect(profile.platform).toBe('cli');
  expect(profile.capabilities.filePicker).toBe(false);
  expect(profile.assertOnDrift).toBe(false);
});
