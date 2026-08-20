/**
 * ContextRpcHandlers schema — unit specs.
 *
 * This file used to lock in an "intentionally empty" contract: no Zod, all
 * validation deferred downstream. TASK_2026_200 replaced that with real
 * schemas, because the params grew a `workspaceRoot` that selects which
 * workspace's files come back — a renderer-supplied value that ends up in
 * `path.resolve`, i.e. exactly the kind of field the lib's mandatory-schema
 * rule exists for. The old spec required that any such change ship with
 * coverage at the same time; this is that coverage.
 *
 * The two contracts worth holding onto:
 *   - **Shape only, no policy.** These parsers reject malformed input; they do
 *     NOT default or clamp. `context-rpc.handlers.spec.ts` asserts the handler
 *     forwards params verbatim, and that must stay true.
 *   - **`''` is not "no opinion".** Absent `workspaceRoot` means "process-global
 *     active folder"; an empty string would `path.resolve` to the process CWD
 *     and quietly answer for the wrong tree, so it is rejected.
 *
 * Source-under-test:
 *   `libs/backend/rpc-handlers/src/lib/handlers/context-rpc.schema.ts`
 */

import 'reflect-metadata';

import {
  parseContextGetAllFilesParams,
  parseContextGetFileSuggestionsParams,
} from './context-rpc.schema';

describe('context-rpc.schema', () => {
  describe('parseContextGetAllFilesParams', () => {
    it('accepts a fully populated payload and returns it verbatim', () => {
      const parsed = parseContextGetAllFilesParams({
        includeImages: true,
        limit: 250,
        workspaceRoot: 'D:\\proj-b',
      });

      expect(parsed).toEqual({
        includeImages: true,
        limit: 250,
        workspaceRoot: 'D:\\proj-b',
      });
    });

    it('accepts an empty payload — omitted params are legal on this method', () => {
      expect(parseContextGetAllFilesParams({})).toEqual({});
    });

    it('treats undefined / null params as an empty payload rather than rejecting', () => {
      // Older webview builds and internal callers can invoke with no params at
      // all; that has always been legal and must not become a hard failure.
      expect(parseContextGetAllFilesParams(undefined)).toEqual({});
      expect(parseContextGetAllFilesParams(null)).toEqual({});
    });

    it('does not inject defaults — bounding stays the orchestration layer job', () => {
      const parsed = parseContextGetAllFilesParams({});
      expect(parsed).not.toBeNull();
      expect(Object.keys(parsed as object)).toEqual([]);
    });

    it('strips unknown keys instead of rejecting them (forward/backward compat)', () => {
      const parsed = parseContextGetAllFilesParams({
        limit: 10,
        someFutureField: 'whatever',
      });

      expect(parsed).toEqual({ limit: 10 });
    });

    it('rejects an empty-string workspaceRoot — absent means global, "" does not', () => {
      expect(parseContextGetAllFilesParams({ workspaceRoot: '' })).toBeNull();
    });

    it('rejects a non-string workspaceRoot', () => {
      expect(parseContextGetAllFilesParams({ workspaceRoot: 42 })).toBeNull();
      expect(parseContextGetAllFilesParams({ workspaceRoot: null })).toBeNull();
      expect(
        parseContextGetAllFilesParams({ workspaceRoot: { path: 'D:\\x' } }),
      ).toBeNull();
      expect(
        parseContextGetAllFilesParams({ workspaceRoot: ['D:\\x'] }),
      ).toBeNull();
    });

    it('rejects malformed includeImages / limit', () => {
      expect(
        parseContextGetAllFilesParams({ includeImages: 'yes' }),
      ).toBeNull();
      expect(parseContextGetAllFilesParams({ limit: -1 })).toBeNull();
      expect(parseContextGetAllFilesParams({ limit: 1.5 })).toBeNull();
      expect(parseContextGetAllFilesParams({ limit: '100' })).toBeNull();
    });
  });

  describe('parseContextGetFileSuggestionsParams', () => {
    it('accepts a fully populated payload and returns it verbatim', () => {
      expect(
        parseContextGetFileSuggestionsParams({
          query: 'auth',
          limit: 20,
          workspaceRoot: '/proj-b',
        }),
      ).toEqual({ query: 'auth', limit: 20, workspaceRoot: '/proj-b' });
    });

    it('accepts an empty payload and undefined params', () => {
      expect(parseContextGetFileSuggestionsParams({})).toEqual({});
      expect(parseContextGetFileSuggestionsParams(undefined)).toEqual({});
    });

    it('preserves an empty-string query (the "top N" contract), unlike workspaceRoot', () => {
      // `query: ''` is meaningful — it means "no filter". `workspaceRoot: ''`
      // is not; the asymmetry is deliberate.
      expect(parseContextGetFileSuggestionsParams({ query: '' })).toEqual({
        query: '',
      });
      expect(
        parseContextGetFileSuggestionsParams({ workspaceRoot: '' }),
      ).toBeNull();
    });

    it('rejects a non-string workspaceRoot and a non-string query', () => {
      expect(
        parseContextGetFileSuggestionsParams({ workspaceRoot: 7 }),
      ).toBeNull();
      expect(parseContextGetFileSuggestionsParams({ query: 7 })).toBeNull();
    });

    it('rejects a malformed limit', () => {
      expect(parseContextGetFileSuggestionsParams({ limit: -5 })).toBeNull();
    });
  });
});
