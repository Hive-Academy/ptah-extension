import 'reflect-metadata';
import { createMockStateStorage } from '../mocks/state-storage.mock';
import { runStateStorageContract } from './run-state-storage-contract';

runStateStorageContract('createMockStateStorage', () =>
  createMockStateStorage(),
);
