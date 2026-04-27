/**
 * `VscodeStateStorage` — contract against the shared `IStateStorage` suite.
 *
 * Backed at runtime by `vscode.Memento`; under test we inject an in-memory
 * Memento test double so the Memento semantics (get/update/keys) are observable
 * without VS Code's extension host.
 */

import 'reflect-metadata';
import { runStateStorageContract } from '@ptah-extension/platform-core/testing';
import { VscodeStateStorage } from './vscode-state-storage';
import {
  __resetVscodeTestDouble,
  InMemoryMemento,
} from '../../__mocks__/vscode';

beforeEach(() => {
  __resetVscodeTestDouble();
});

runStateStorageContract(
  'VscodeStateStorage',
  () =>
    new VscodeStateStorage(
      new InMemoryMemento() as unknown as import('vscode').Memento,
    ),
);

describe('VscodeStateStorage — VS Code-specific behaviour', () => {
  it('delegates keys() to the injected Memento', () => {
    const memento = new InMemoryMemento();
    const provider = new VscodeStateStorage(
      memento as unknown as import('vscode').Memento,
    );
    expect(provider.keys()).toEqual([]);
  });
});
