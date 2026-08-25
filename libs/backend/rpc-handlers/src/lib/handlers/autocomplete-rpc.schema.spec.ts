/**
 * AutocompleteRpcHandlers schema — unit specs.
 *
 * This file used to lock in an "intentionally empty" contract. TASK_2026_200
 * replaced that with real schemas: the params grew a `workspaceRoot` that
 * selects which workspace's `.claude/agents` and `.claude/commands` are
 * scanned, and it is joined onto a filesystem path downstream — a boundary, so
 * it gets a schema. The old spec required coverage to ship alongside such a
 * change; this is that coverage.
 *
 * Contracts held here:
 *   - **`query` stays permissive.** The handler's long-standing
 *     `params.query || ''` fallback means "missing query → top N"; the schema
 *     must not pre-empt it by requiring or defaulting the field.
 *   - **`''` is not "no opinion" for `workspaceRoot`.** Absent means
 *     "process-global active folder"; `''` would resolve to the process CWD and
 *     scan the wrong tree.
 *
 * Source-under-test:
 *   `libs/backend/rpc-handlers/src/lib/handlers/autocomplete-rpc.schema.ts`
 */

import 'reflect-metadata';

import {
  parseAutocompleteAgentsParams,
  parseAutocompleteCommandsParams,
} from './autocomplete-rpc.schema';

describe('autocomplete-rpc.schema', () => {
  describe.each([
    ['parseAutocompleteAgentsParams', parseAutocompleteAgentsParams],
    ['parseAutocompleteCommandsParams', parseAutocompleteCommandsParams],
  ])('%s', (_name, parse) => {
    it('accepts a fully populated payload and returns it verbatim', () => {
      expect(
        parse({ query: 'debug', maxResults: 5, workspaceRoot: 'D:\\proj-b' }),
      ).toEqual({ query: 'debug', maxResults: 5, workspaceRoot: 'D:\\proj-b' });
    });

    it('accepts an empty payload, undefined and null', () => {
      expect(parse({})).toEqual({});
      expect(parse(undefined)).toEqual({});
      expect(parse(null)).toEqual({});
    });

    it('preserves an empty-string query so the "top N" fallback still fires', () => {
      expect(parse({ query: '' })).toEqual({ query: '' });
    });

    it('does not inject defaults for query or maxResults', () => {
      const parsed = parse({});
      expect(parsed).not.toBeNull();
      expect(Object.keys(parsed as object)).toEqual([]);
    });

    it('strips unknown keys instead of rejecting them', () => {
      expect(parse({ query: 'x', futureFlag: true })).toEqual({ query: 'x' });
    });

    it('rejects an empty-string workspaceRoot', () => {
      expect(parse({ workspaceRoot: '' })).toBeNull();
    });

    it('rejects a non-string workspaceRoot', () => {
      expect(parse({ workspaceRoot: 42 })).toBeNull();
      expect(parse({ workspaceRoot: null })).toBeNull();
      expect(parse({ workspaceRoot: ['D:\\x'] })).toBeNull();
    });

    it('rejects a non-string query and a malformed maxResults', () => {
      expect(parse({ query: 7 })).toBeNull();
      expect(parse({ maxResults: -1 })).toBeNull();
      expect(parse({ maxResults: 2.5 })).toBeNull();
      expect(parse({ maxResults: '20' })).toBeNull();
    });
  });
});
