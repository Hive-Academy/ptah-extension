/**
 * AutocompleteRpcHandlers schema — unit specs (TASK_2025_294 W2.B5).
 *
 * Surface under test: the schema module is intentionally empty — the
 * autocomplete handler validates its params via `@ptah-extension/shared` TS
 * types plus a `params.query || ''` fallback, not via Zod.
 *
 * This spec exists so the empty-schema contract is locked in: if a future
 * change adds a `z.object({...})` export here, test coverage must be added at
 * the same time rather than left for "later". The assertion is minimal but
 * meaningful — importing the module must succeed and produce no runtime
 * exports beyond the documented empty contract.
 *
 * Source-under-test:
 *   `libs/backend/rpc-handlers/src/lib/handlers/autocomplete-rpc.schema.ts`
 */

import 'reflect-metadata';

import * as AutocompleteRpcSchema from './autocomplete-rpc.schema';

describe('autocomplete-rpc.schema (empty-contract lock)', () => {
  it('module loads without side-effects', () => {
    // If the schema module ever throws on import (circular dep, missing peer),
    // this assertion flags it before the handler spec picks it up.
    expect(AutocompleteRpcSchema).toBeDefined();
  });

  it('exports nothing runtime-visible (intentional — no Zod validation yet)', () => {
    // Filter out anything TS adds for namespace interop (`default`, Symbol
    // tags) and assert the remaining keys are empty. A future batch adding
    // `z.object({...})` will fail this and force coverage updates.
    const runtimeKeys = Object.keys(AutocompleteRpcSchema).filter(
      (k) => k !== 'default' && k !== '__esModule',
    );
    expect(runtimeKeys).toEqual([]);
  });
});
