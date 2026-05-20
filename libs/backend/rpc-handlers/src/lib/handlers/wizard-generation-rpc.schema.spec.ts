/**
 * WizardGenerationRpcSchema — unit specs.
 *
 * The wizard-generation handler has no Zod schemas (see
 * `wizard-generation-rpc.schema.ts` — exports are intentionally empty). This
 * spec exists so the schema-file contract is uniform across every handler:
 * every `*.handlers.ts` has a paired `*.schema.ts` with a paired
 * `*.schema.spec.ts`, even when the schema is a no-op.
 *
 * Inline guards (`selectedAgentIds` non-empty, `itemId` present, boolean
 * `enabled`) are covered by `wizard-generation-rpc.handlers.spec.ts`.
 *
 * Source-under-test: `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-rpc.schema.ts`
 */

import * as schema from './wizard-generation-rpc.schema';

describe('wizard-generation-rpc.schema', () => {
  it('exports no runtime schemas (intentionally empty)', () => {
    const exported = Object.keys(schema).filter((k) => k !== 'default');
    expect(exported).toEqual([]);
  });
});
