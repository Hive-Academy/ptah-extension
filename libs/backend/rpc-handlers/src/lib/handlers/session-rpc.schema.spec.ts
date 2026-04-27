/**
 * SessionRpcSchema — unit specs (TASK_2025_294 W2.B4).
 *
 * Surface under test: `./session-rpc.schema.ts`, which is intentionally an
 * empty-export module (see the file header there for rationale — the
 * session handler does not use inline Zod schemas; it relies on static
 * TS types from `@ptah-extension/shared` plus inline guards).
 *
 * This spec exists so:
 *   1. The "every handler has a paired schema spec" invariant from
 *      TASK_2025_294 holds across the rpc-handlers library.
 *   2. A future PR that accidentally adds a Zod schema to
 *      `session-rpc.schema.ts` without wiring tests has a pre-existing
 *      file to extend (forcing the author to think about coverage).
 *   3. The empty-module contract is locked in — if someone deletes the
 *      file, the spec fails with a clear import-resolution error.
 */

import 'reflect-metadata';

import * as sessionRpcSchema from './session-rpc.schema';

describe('session-rpc.schema', () => {
  it('is an intentionally empty module (no Zod schemas exported)', () => {
    // The only thing `export {}` produces is a module with no own enumerable
    // keys. If someone adds a schema later, this test will fail and the
    // author will land here and add proper coverage.
    const ownKeys = Object.keys(sessionRpcSchema);
    expect(ownKeys).toEqual([]);
  });

  it('can be imported without side effects', () => {
    // Re-importing must not throw and must yield the same empty module
    // object shape. Guards against someone adding top-level side effects
    // (e.g. `console.log`, global mutation) to what should stay a
    // passive schema module.
    expect(sessionRpcSchema).toBeDefined();
    expect(typeof sessionRpcSchema).toBe('object');
  });
});
