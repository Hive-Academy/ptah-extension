/**
 * ContextRpcHandlers schema — unit specs.
 *
 * Surface under test: the schema module is intentionally empty — the context
 * handler defers validation to the downstream `ContextOrchestrationService`
 * and relies on `@ptah-extension/shared` TS types at the boundary.
 *
 * This spec exists so the empty-schema contract is locked in: if a future
 * change adds a `z.object({...})` export here (e.g. to bound `limit` or
 * reject path-traversal patterns in `query`), test coverage must be added at
 * the same time rather than left for "later".
 *
 * Source-under-test:
 *   `libs/backend/rpc-handlers/src/lib/handlers/context-rpc.schema.ts`
 */

import 'reflect-metadata';

import * as ContextRpcSchema from './context-rpc.schema';

describe('context-rpc.schema (empty-contract lock)', () => {
  it('module loads without side-effects', () => {
    expect(ContextRpcSchema).toBeDefined();
  });

  it('exports nothing runtime-visible (intentional — no Zod validation yet)', () => {
    const runtimeKeys = Object.keys(ContextRpcSchema).filter(
      (k) => k !== 'default' && k !== '__esModule',
    );
    expect(runtimeKeys).toEqual([]);
  });
});
