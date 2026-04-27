/**
 * SubagentRpcSchema — unit specs (TASK_2025_294 W2.B4).
 *
 * Surface under test: `./subagent-rpc.schema.ts`, which is intentionally
 * an empty-export module (see the file header there for rationale — the
 * subagent handler validates its params via static TS types from
 * `@ptah-extension/shared` with only trivial optional-field presence
 * checks).
 *
 * This spec exists so:
 *   1. The "every handler has a paired schema spec" invariant from
 *      TASK_2025_294 holds across the rpc-handlers library.
 *   2. A future PR that accidentally adds a Zod schema to
 *      `subagent-rpc.schema.ts` without wiring tests has a pre-existing
 *      file to extend.
 *   3. The empty-module contract is locked in — if someone deletes the
 *      file, the spec fails with a clear import-resolution error.
 */

import 'reflect-metadata';

import * as subagentRpcSchema from './subagent-rpc.schema';

describe('subagent-rpc.schema', () => {
  it('is an intentionally empty module (no Zod schemas exported)', () => {
    const ownKeys = Object.keys(subagentRpcSchema);
    expect(ownKeys).toEqual([]);
  });

  it('can be imported without side effects', () => {
    expect(subagentRpcSchema).toBeDefined();
    expect(typeof subagentRpcSchema).toBe('object');
  });
});
