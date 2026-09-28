/**
 * TASK_2026_533 Task 3.1 — the `:serverRef` codec (implementation plan D1).
 */

import type { McpServerOrigin } from '@ptah-extension/shared';
import { decodeServerRef, encodeServerRef, type ServerRef } from './server-ref';

/** Every `McpServerOrigin` member (`mcp-directory.types.ts:240-245`). */
const ALL_ORIGINS = [
  'harness-config',
  'claude-user',
  'smithery',
  'oauth',
  'claude-connector',
] as const satisfies readonly McpServerOrigin[];

describe('encodeServerRef / decodeServerRef — round trip', () => {
  const keys = [
    'sentry',
    'shopify-dev-mcp',
    'node_repl',
    '@scope/server',
    'claude.ai Gmail',
    'ns:server',
    'a:b:c',
    'trailing:',
    ':leading',
  ];

  for (const origin of ALL_ORIGINS) {
    for (const serverKey of keys) {
      it(`round-trips ${origin} + ${JSON.stringify(serverKey)}`, () => {
        const ref: ServerRef = { origin, serverKey };
        expect(decodeServerRef(encodeServerRef(ref))).toEqual(ref);
      });
    }
  }
});

describe('encodeServerRef', () => {
  it.each<[ServerRef, string]>([
    [{ origin: 'claude-user', serverKey: 'sentry' }, 'claude-user:sentry'],
    [{ origin: 'smithery', serverKey: 'ns:server' }, 'smithery:ns:server'],
    [
      { origin: 'claude-connector', serverKey: 'claude.ai Gmail' },
      'claude-connector:claude.ai Gmail',
    ],
  ])('encodes %j as %s', (ref, expected) => {
    expect(encodeServerRef(ref)).toBe(expected);
  });
});

describe('decodeServerRef — splits at the FIRST colon', () => {
  it.each<[string, ServerRef]>([
    ['oauth:a:b', { origin: 'oauth', serverKey: 'a:b' }],
    ['harness-config:x', { origin: 'harness-config', serverKey: 'x' }],
    ['smithery::', { origin: 'smithery', serverKey: ':' }],
  ])('decodes %s', (raw, expected) => {
    expect(decodeServerRef(raw)).toEqual(expected);
  });
});

describe('decodeServerRef — malformed input is null', () => {
  it.each<[string, string | null | undefined]>([
    ['null', null],
    ['undefined', undefined],
    ['empty string', ''],
    ['no separator', 'sentry'],
    ['a bare static source path', 'smithery'],
    ['empty key', 'claude-user:'],
    ['empty origin', ':sentry'],
    ['unknown origin', 'npm:sentry'],
    ['origin in the wrong case', 'Claude-User:sentry'],
    ['an Object.prototype member as origin', 'constructor:sentry'],
    ['whitespace-padded origin', ' oauth:sentry'],
  ])('%s → null', (_label, raw) => {
    expect(decodeServerRef(raw)).toBeNull();
  });
});
