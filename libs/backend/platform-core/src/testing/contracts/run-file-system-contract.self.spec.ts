/**
 * Self-test: run the file-system contract against `createMockFileSystemProvider`.
 *
 * If this spec ever fails, either the mock drifted from the interface contract
 * or the contract added an invariant the mock doesn't implement. Fixing one
 * side without the other is a blocking regression for downstream consumers.
 */

import 'reflect-metadata';
import { createMockFileSystemProvider } from '../mocks/file-system-provider.mock';
import { runFileSystemContract } from './run-file-system-contract';

runFileSystemContract('createMockFileSystemProvider', () =>
  createMockFileSystemProvider(),
);
