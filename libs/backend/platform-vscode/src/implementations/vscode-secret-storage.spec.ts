/**
 * `VscodeSecretStorage` — contract against the shared `ISecretStorage` suite.
 *
 * The provider wraps a `vscode.SecretStorage` passed by the host. For tests we
 * inject the mock's `InMemorySecretStorage` so round-trip assertions observe
 * real state without touching the OS keychain.
 */

import 'reflect-metadata';
import { runSecretStorageContract } from '@ptah-extension/platform-core/testing';
import { VscodeSecretStorage } from './vscode-secret-storage';
import {
  __resetVscodeTestDouble,
  InMemorySecretStorage,
} from '../../__mocks__/vscode';

beforeEach(() => {
  __resetVscodeTestDouble();
});

runSecretStorageContract(
  'VscodeSecretStorage',
  () =>
    new VscodeSecretStorage(
      new InMemorySecretStorage() as unknown as import('vscode').SecretStorage,
    ),
);

describe('VscodeSecretStorage — VS Code-specific behaviour', () => {
  it('dispose unsubscribes from the underlying onDidChange', async () => {
    const backing = new InMemorySecretStorage();
    const provider = new VscodeSecretStorage(
      backing as unknown as import('vscode').SecretStorage,
    );
    const seen: string[] = [];
    const sub = provider.onDidChange((e) => seen.push(e.key));

    await backing.store('k1', 'v1');
    expect(seen).toContain('k1');

    provider.dispose();
    await backing.store('k2', 'v2');
    // After dispose, provider does not bridge events from the backing store.
    expect(seen).not.toContain('k2');
    sub.dispose();
  });
});
