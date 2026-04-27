/**
 * SetupRpcSchema — unit specs (TASK_2025_294 W2.B4).
 *
 * Surface under test: `./setup-rpc.schema.ts`, which is intentionally an
 * empty-export module (see the file header there for rationale — the
 * setup handler reuses `ProjectAnalysisZodSchema` from
 * `@ptah-extension/agent-generation`; it does not define any inline
 * schemas of its own).
 *
 * This spec exists so:
 *   1. The "every handler has a paired schema spec" invariant from
 *      TASK_2025_294 holds across the rpc-handlers library.
 *   2. A future PR that accidentally adds a Zod schema to
 *      `setup-rpc.schema.ts` without wiring tests has a pre-existing
 *      file to extend.
 *   3. The empty-module contract is locked in — if someone deletes the
 *      file, the spec fails with a clear import-resolution error.
 */

import 'reflect-metadata';

import * as setupRpcSchema from './setup-rpc.schema';

describe('setup-rpc.schema', () => {
  it('is an intentionally empty module (no Zod schemas exported)', () => {
    const ownKeys = Object.keys(setupRpcSchema);
    expect(ownKeys).toEqual([]);
  });

  it('can be imported without side effects', () => {
    expect(setupRpcSchema).toBeDefined();
    expect(typeof setupRpcSchema).toBe('object');
  });
});
