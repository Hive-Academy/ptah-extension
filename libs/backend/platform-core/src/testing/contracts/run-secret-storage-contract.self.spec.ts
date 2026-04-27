import 'reflect-metadata';
import { createMockSecretStorage } from '../mocks/secret-storage.mock';
import { runSecretStorageContract } from './run-secret-storage-contract';

runSecretStorageContract('createMockSecretStorage', () =>
  createMockSecretStorage(),
);
