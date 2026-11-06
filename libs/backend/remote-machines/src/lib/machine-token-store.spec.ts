import type { ISecretStorage } from '@ptah-extension/platform-core';
import { MachineTokenStore } from './machine-token-store';

it('stores machine tokens only through secret storage and warns on plaintext', async () => {
  const secrets = {
    get: jest.fn(async () => 'token'),
    store: jest.fn(async () => undefined),
    delete: jest.fn(async () => undefined),
    storageMode: () => 'plaintext' as const,
  } as unknown as ISecretStorage;
  const tokens = new MachineTokenStore(secrets);
  await tokens.set('machine-1', 'token');
  expect(secrets.store).toHaveBeenCalledWith(
    'remote-machine:machine-1:token',
    'token',
  );
  expect(await tokens.get('machine-1')).toBe('token');
  expect(tokens.warning()).toMatch(/plain text/);
  await tokens.delete('machine-1');
  expect(secrets.delete).toHaveBeenCalledWith('remote-machine:machine-1:token');
});
