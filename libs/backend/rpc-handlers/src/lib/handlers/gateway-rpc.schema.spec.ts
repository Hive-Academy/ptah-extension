/**
 * gateway-rpc.schema.ts — unit tests for the Zod-based gateway helpers.
 *
 * Coverage:
 *   - `extractGatewayOrigin`: present, absent, non-string, null params.
 *
 * Source-under-test:
 *   `libs/backend/rpc-handlers/src/lib/handlers/gateway-rpc.schema.ts`
 */

import { extractGatewayOrigin } from './gateway-rpc.schema';

describe('extractGatewayOrigin', () => {
  it('returns the origin string when present', () => {
    expect(extractGatewayOrigin({ origin: 'webview-toggle' })).toBe(
      'webview-toggle',
    );
  });

  it('returns null when origin is absent', () => {
    expect(extractGatewayOrigin({ platform: 'telegram' })).toBeNull();
  });

  it('returns null when params is null', () => {
    expect(extractGatewayOrigin(null)).toBeNull();
  });

  it('returns null when params is undefined', () => {
    expect(extractGatewayOrigin(undefined)).toBeNull();
  });

  it('returns null when params is not an object', () => {
    expect(extractGatewayOrigin('string-params')).toBeNull();
    expect(extractGatewayOrigin(42)).toBeNull();
  });

  it('returns null when origin is not a string (drops invalid type)', () => {
    // origin must be a string — non-string values fail the schema and return null.
    expect(extractGatewayOrigin({ origin: 123 })).toBeNull();
    expect(extractGatewayOrigin({ origin: null })).toBeNull();
    expect(extractGatewayOrigin({ origin: { nested: 'obj' } })).toBeNull();
  });

  it('returns null for empty params object', () => {
    expect(extractGatewayOrigin({})).toBeNull();
  });

  it('preserves other params fields (passthrough)', () => {
    // The schema uses .passthrough(), so extra fields must not cause parse failure.
    const result = extractGatewayOrigin({
      origin: 'test-origin',
      platform: 'telegram',
      extra: 42,
    });
    expect(result).toBe('test-origin');
  });
});
