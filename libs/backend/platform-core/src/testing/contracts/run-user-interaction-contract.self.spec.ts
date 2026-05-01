import 'reflect-metadata';
import { createMockUserInteraction } from '../mocks/user-interaction.mock';
import { runUserInteractionContract } from './run-user-interaction-contract';

/**
 * Self-test: contract against the default (no-op) mock.
 *
 * The default mock returns `undefined` from every interactive surface, which
 * matches the "message dismissed / cancel pressed" branch. The `script` hook
 * is intentionally omitted so the contract falls into its "accept undefined"
 * codepath and still passes.
 */
runUserInteractionContract('createMockUserInteraction', () => ({
  provider: createMockUserInteraction(),
}));
