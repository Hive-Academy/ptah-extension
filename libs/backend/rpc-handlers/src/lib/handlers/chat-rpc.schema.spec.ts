/**
 * ChatRpcSchema — unit specs (TASK_2025_294 W2.B6).
 *
 * The chat handler has no Zod schemas (see `chat-rpc.schema.ts` — exports are
 * intentionally empty). This spec exists so the schema-file contract is
 * uniform across every handler: every `*.handlers.ts` has a paired
 * `*.schema.ts` with a paired `*.schema.spec.ts`, even when the schema is a
 * no-op.
 *
 * If a future task introduces Zod validation for chat RPC params, its
 * schemas — and the tests that lock them in — belong here.
 *
 * Source-under-test: `libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.schema.ts`
 */

import * as schema from './chat-rpc.schema';

describe('chat-rpc.schema', () => {
  it('exports no runtime schemas (intentionally empty)', () => {
    // The module parses cleanly and exposes no named exports. This asserts
    // the W2.B6 extraction contract — chat RPC params are validated via
    // TypeScript types and inline guards, not Zod. Any future addition to
    // this file should come with real tests on the new export.
    const exported = Object.keys(schema).filter((k) => k !== 'default');
    expect(exported).toEqual([]);
  });
});
