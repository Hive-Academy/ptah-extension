/**
 * SessionRpcSchema — unit specs.
 *
 * Surface under test: `./session-rpc.schema.ts`, which is intentionally an
 * empty-export module (see the file header there for rationale — the
 * session handler does not use inline Zod schemas; it relies on static
 * TS types from `@ptah-extension/shared` plus inline guards).
 *
 * This spec exists so:
 *   1. The "every handler has a paired schema spec" invariant holds across
 *      the rpc-handlers library.
 *   2. A future PR that accidentally adds a Zod schema to
 *      `session-rpc.schema.ts` without wiring tests has a pre-existing
 *      file to extend (forcing the author to think about coverage).
 *   3. The empty-module contract is locked in — if someone deletes the
 *      file, the spec fails with a clear import-resolution error.
 */

import 'reflect-metadata';

import * as sessionRpcSchema from './session-rpc.schema';
import { AgentJsonlFirstLineSchema } from './session-rpc.handlers';

describe('session-rpc.schema', () => {
  it('is an intentionally empty module (no Zod schemas exported)', () => {
    const ownKeys = Object.keys(sessionRpcSchema);
    expect(ownKeys).toEqual([]);
  });

  it('can be imported without side effects', () => {
    expect(sessionRpcSchema).toBeDefined();
    expect(typeof sessionRpcSchema).toBe('object');
  });
});

// ---------------------------------------------------------------------------
// AgentJsonlFirstLineSchema — JSONL first-line validation
//
// This schema is exported from session-rpc.handlers.ts and guards the
// JSON.parse path that previously admitted any parsed value unchecked.
// ---------------------------------------------------------------------------

describe('AgentJsonlFirstLineSchema', () => {
  it('parses a valid first-line object with a sessionId string', () => {
    const result = AgentJsonlFirstLineSchema.safeParse({
      sessionId: 'abc123',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sessionId).toBe('abc123');
    }
  });

  it('allows extra fields alongside sessionId (passthrough)', () => {
    const result = AgentJsonlFirstLineSchema.safeParse({
      sessionId: 'abc123',
      type: 'message',
      content: 'hello',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an object with no sessionId field', () => {
    const result = AgentJsonlFirstLineSchema.safeParse({ type: 'message' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain('sessionId');
    }
  });

  it('rejects when sessionId is not a string', () => {
    const result = AgentJsonlFirstLineSchema.safeParse({ sessionId: 42 });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain('sessionId');
    }
  });

  it('rejects null', () => {
    const result = AgentJsonlFirstLineSchema.safeParse(null);
    expect(result.success).toBe(false);
  });

  it('rejects a plain string (not an object)', () => {
    const result = AgentJsonlFirstLineSchema.safeParse('{"sessionId":"abc"}');
    expect(result.success).toBe(false);
  });

  it('rejects an empty object', () => {
    const result = AgentJsonlFirstLineSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});
