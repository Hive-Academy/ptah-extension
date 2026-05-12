import 'reflect-metadata';
import { createMockMasterKeyProvider } from '../mocks/master-key-provider.mock';
import { runMasterKeyProviderContract } from './run-master-key-provider-contract';

runMasterKeyProviderContract(
  'createMockMasterKeyProvider',
  () => createMockMasterKeyProvider(),
  // No makeStateRoot — mock has no file-backed state; cross-restart test is skipped.
);
