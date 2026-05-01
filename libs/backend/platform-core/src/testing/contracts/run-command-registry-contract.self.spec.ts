import 'reflect-metadata';
import { createMockCommandRegistry } from '../mocks/command-registry.mock';
import { runCommandRegistryContract } from './run-command-registry-contract';

runCommandRegistryContract('createMockCommandRegistry', () =>
  createMockCommandRegistry(),
);
