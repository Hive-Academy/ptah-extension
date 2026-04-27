/**
 * QualityRpcSchema — unit specs (TASK_2025_294 W2.B6).
 *
 * The quality handler has no Zod schemas (see `quality-rpc.schema.ts` — exports
 * are intentionally empty). This spec exists so the schema-file contract is
 * uniform across every handler: every `*.handlers.ts` has a paired
 * `*.schema.ts` with a paired `*.schema.spec.ts`, even when the schema is a
 * no-op.
 *
 * The handler's `format` allow-list (markdown/json/csv) is inline in
 * `quality-rpc.handlers.ts` and covered by `quality-rpc.handlers.spec.ts`.
 *
 * Source-under-test: `libs/backend/rpc-handlers/src/lib/handlers/quality-rpc.schema.ts`
 */

import * as schema from './quality-rpc.schema';

describe('quality-rpc.schema', () => {
  it('exports no runtime schemas (intentionally empty)', () => {
    const exported = Object.keys(schema).filter((k) => k !== 'default');
    expect(exported).toEqual([]);
  });
});
