/**
 * Self-spec: smoke-tests `runHttpServerProviderContract` against the mock.
 *
 * The mock does NOT bind a real TCP socket, so sendsRealRequests is false.
 * This validates the handle-shape and close-idempotency invariants without
 * requiring network access in CI.
 */
import { createMockHttpServerProvider } from '../mocks/http-server-provider.mock';
import { runHttpServerProviderContract } from './run-http-server-provider-contract';

runHttpServerProviderContract('createMockHttpServerProvider', () => ({
  provider: createMockHttpServerProvider(),
  sendsRealRequests: false,
}));
