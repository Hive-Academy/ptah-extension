/**
 * Self-spec: smoke-tests `runPlatformCommandsContract` against
 * `createMockPlatformCommands` to verify the runner works.
 */
import { createMockPlatformCommands } from '../mocks/commands.mock';
import { runPlatformCommandsContract } from './run-platform-commands-contract';

runPlatformCommandsContract('createMockPlatformCommands', () =>
  createMockPlatformCommands(),
);
