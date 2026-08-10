/**
 * OutputStyleStore specs.
 *
 * Four behaviours the plan calls out by name, plus the Result-object contract
 * they all depend on:
 *
 *   - `refresh()` populates every signal from a mocked `ClaudeRpcService`
 *   - a failed `activate()` rolls back the previous selection and sets `error`
 *     (Req 2.7)
 *   - `save()` triggers a refresh, so a new style appears without a reload
 *     (Req 3.6)
 *   - `activate()` does NOT auto-fire after `save()` (Req 3.7)
 *
 * `ClaudeRpcService.call()` returns a Result object rather than throwing, so
 * every stub below returns `{ isSuccess, data, error }` — never a rejection.
 */

import { TestBed } from '@angular/core/testing';
import { ClaudeRpcService } from '@ptah-extension/core';
import type {
  ActiveOutputStyleState,
  InvalidOutputStyle,
  OutputStyleEntry,
} from '@ptah-extension/shared';
import { OutputStyleStore } from './output-style.store';

type RpcStub = { isSuccess: () => boolean; data?: unknown; error?: string };

const BUILT_IN_DEFAULT: OutputStyleEntry = {
  name: 'default',
  tier: 'builtin',
  description: 'The agent behaves exactly as it does with no style chosen.',
  keepCodingInstructions: true,
  editable: false,
  deletable: false,
  immutableReason: 'built-in',
};

const USER_STYLE: OutputStyleEntry = {
  name: 'Simplified Technical English',
  tier: 'user',
  description: 'Short sentences, plain words.',
  keepCodingInstructions: true,
  editable: true,
  deletable: true,
  fileName: 'simplified-technical-english.md',
  relativePath: '~/.claude/output-styles/simplified-technical-english.md',
};

const PROJECT_SHADOWED: OutputStyleEntry = {
  ...USER_STYLE,
  tier: 'project',
  relativePath: '.claude/output-styles/simplified-technical-english.md',
  shadowed: true,
};

const INVALID_ENTRY: InvalidOutputStyle = {
  fileName: 'broken.md',
  relativePath: '.claude/output-styles/broken.md',
  tier: 'project',
  error: {
    code: 'UNRECOGNIZED_KEY',
    key: 'theme',
    validKeys: [
      'name',
      'description',
      'keep-coding-instructions',
      'force-for-plugin',
    ],
    message: 'The key "theme" is not part of the output-style schema.',
  },
  openable: true,
};

const NO_SELECTION: ActiveOutputStyleState = {
  name: null,
  tier: null,
  missing: false,
};

describe('OutputStyleStore', () => {
  let call: jest.Mock;
  let store: OutputStyleStore;

  /** Per-method stub table; anything unset falls back to a generic success. */
  let responses: Record<string, RpcStub>;

  const ok = (data: unknown): RpcStub => ({ isSuccess: () => true, data });

  function listResult(
    styles: readonly OutputStyleEntry[],
    active: ActiveOutputStyleState = NO_SELECTION,
    invalid: readonly InvalidOutputStyle[] = [],
  ): RpcStub {
    return ok({ styles, invalid, active });
  }

  beforeEach(() => {
    responses = {
      'outputStyle:list': listResult([BUILT_IN_DEFAULT, USER_STYLE]),
      'outputStyle:diagnose': ok({
        decision: { path: 'none' },
        visibleTiers: ['builtin', 'user', 'project'],
        activeName: null,
        activeMissing: false,
      }),
    };

    call = jest.fn((method: string) =>
      Promise.resolve(responses[method] ?? ok({ success: true })),
    );

    TestBed.configureTestingModule({
      providers: [
        OutputStyleStore,
        { provide: ClaudeRpcService, useValue: { call } },
      ],
    });

    store = TestBed.inject(OutputStyleStore);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  describe('refresh()', () => {
    it('populates styles, invalid entries, the selection and the decision', async () => {
      responses['outputStyle:list'] = listResult(
        [BUILT_IN_DEFAULT, USER_STYLE],
        { name: 'Simplified Technical English', tier: 'user', missing: false },
        [INVALID_ENTRY],
      );
      responses['outputStyle:diagnose'] = ok({
        decision: {
          path: 'inject',
          body: '# style',
          styleName: 'Simplified Technical English',
        },
        visibleTiers: ['builtin', 'project'],
        activeName: 'Simplified Technical English',
        activeMissing: false,
      });

      await store.refresh();

      expect(call).toHaveBeenCalledWith('outputStyle:list', {});
      expect(call).toHaveBeenCalledWith('outputStyle:diagnose', {});
      expect(store.styles()).toHaveLength(2);
      expect(store.invalid()).toEqual([INVALID_ENTRY]);
      expect(store.activeName()).toBe('Simplified Technical English');
      expect(store.decision()?.path).toBe('inject');
      expect(store.usingFallbackInjection()).toBe(true);
      expect(store.loading()).toBe(false);
      expect(store.error()).toBeNull();
    });

    it('surfaces a transport failure and clears the loading flag', async () => {
      responses['outputStyle:list'] = {
        isSuccess: () => false,
        error: 'RPC timeout: outputStyle:list',
      };

      await store.refresh();

      expect(store.error()).toBe('RPC timeout: outputStyle:list');
      expect(store.loading()).toBe(false);
    });

    it('flags a cross-tier name collision from the shadowed entries (E4)', async () => {
      responses['outputStyle:list'] = listResult([
        USER_STYLE,
        PROJECT_SHADOWED,
      ]);

      await store.refresh();

      expect(store.hasCollision()).toBe(true);
      expect(store.collidingNames()).toEqual(['Simplified Technical English']);
    });

    it('reports a selection that no longer resolves as missing (E5)', async () => {
      responses['outputStyle:list'] = listResult([BUILT_IN_DEFAULT], {
        name: 'Deleted Style',
        tier: null,
        missing: true,
      });

      await store.refresh();

      expect(store.activeMissing()).toBe(true);
      expect(store.activeName()).toBe('Deleted Style');
    });
  });

  describe('activate()', () => {
    beforeEach(async () => {
      await store.refresh();
      call.mockClear();
    });

    it('persists the name and keeps the optimistic selection on success', async () => {
      responses['outputStyle:activate'] = ok({
        success: true,
        decision: { path: 'flag', styleName: 'Simplified Technical English' },
      });

      const applied = await store.activate('Simplified Technical English');

      expect(applied).toBe(true);
      expect(call).toHaveBeenCalledWith('outputStyle:activate', {
        name: 'Simplified Technical English',
      });
      expect(store.activeName()).toBe('Simplified Technical English');
      expect(store.active()?.tier).toBe('user');
      expect(store.decision()).toEqual({
        path: 'flag',
        styleName: 'Simplified Technical English',
      });
      expect(store.error()).toBeNull();
    });

    it('sends null for the default sentinel and clears the selection', async () => {
      responses['outputStyle:activate'] = ok({
        success: true,
        decision: { path: 'none' },
      });

      await store.activate(null);

      expect(call).toHaveBeenCalledWith('outputStyle:activate', { name: null });
      expect(store.activeName()).toBeNull();
    });

    it('rolls back to the previous selection and sets error when the write fails (Req 2.7)', async () => {
      responses['outputStyle:activate'] = ok({
        success: true,
        decision: { path: 'none' },
      });
      await store.activate('Simplified Technical English');
      const previous = store.active();

      responses['outputStyle:activate'] = ok({
        success: false,
        decision: { path: 'none' },
        error: {
          code: 'SETTINGS_MALFORMED',
          message:
            '.claude/settings.json is not valid JSON, so it was left untouched.',
          path: '.claude/settings.json',
        },
      });

      const applied = await store.activate('default');

      expect(applied).toBe(false);
      expect(store.active()).toEqual(previous);
      expect(store.activeName()).toBe('Simplified Technical English');
      expect(store.error()).toBe(
        '.claude/settings.json is not valid JSON, so it was left untouched.',
      );
      expect(store.saving()).toBe(false);
    });

    it('rolls back on a transport failure too', async () => {
      responses['outputStyle:activate'] = {
        isSuccess: () => false,
        error: 'RPC timeout: outputStyle:activate',
      };

      const applied = await store.activate('Simplified Technical English');

      expect(applied).toBe(false);
      expect(store.activeName()).toBeNull();
      expect(store.error()).toBe('RPC timeout: outputStyle:activate');
    });
  });

  // -------------------------------------------------------------------------
  // Opt-in CLI parity (B7, §4.1). The invariant is the third case: the parity
  // write is advisory, so its failure must leave the selection where the user
  // put it. `activate()` reads only `data.success` when deciding to roll back.
  // -------------------------------------------------------------------------

  describe('activate() with CLI parity', () => {
    beforeEach(async () => {
      await store.refresh();
      call.mockClear();
    });

    it('sends NO parity key at all when the user did not opt in (default OFF)', async () => {
      responses['outputStyle:activate'] = ok({
        success: true,
        decision: { path: 'flag', styleName: 'Simplified Technical English' },
      });

      await store.activate('Simplified Technical English');

      expect(call).toHaveBeenCalledWith('outputStyle:activate', {
        name: 'Simplified Technical English',
      });
      expect(store.parityOutcome()).toBeNull();
      expect(store.parityWrittenPath()).toBeNull();
      expect(store.parityWarning()).toBeNull();
    });

    it('forwards the opt-in request and names the file that was written', async () => {
      responses['outputStyle:activate'] = ok({
        success: true,
        decision: { path: 'flag', styleName: 'Simplified Technical English' },
        parity: {
          written: true,
          writtenPath: '.claude/settings.json',
          tier: 'project',
        },
      });

      const applied = await store.activate('Simplified Technical English', {
        enabled: true,
        tier: 'project',
      });

      expect(applied).toBe(true);
      expect(call).toHaveBeenCalledWith('outputStyle:activate', {
        name: 'Simplified Technical English',
        parity: { enabled: true, tier: 'project' },
      });
      expect(store.parityWrittenPath()).toBe('.claude/settings.json');
      expect(store.parityWarning()).toBeNull();
    });

    it('keeps the selection when only the parity write fails (§4.1)', async () => {
      responses['outputStyle:activate'] = ok({
        success: true,
        decision: { path: 'flag', styleName: 'Simplified Technical English' },
        parity: {
          written: false,
          tier: 'project',
          error: {
            code: 'SETTINGS_MALFORMED',
            message:
              '.claude/settings.json is not valid JSON. Ptah did not change it.',
            path: '.claude/settings.json',
          },
        },
      });

      const applied = await store.activate('Simplified Technical English', {
        enabled: true,
        tier: 'project',
      });

      // The selection stands.
      expect(applied).toBe(true);
      expect(store.activeName()).toBe('Simplified Technical English');
      expect(store.decision()).toEqual({
        path: 'flag',
        styleName: 'Simplified Technical English',
      });
      // The failure is a warning, not the error banner that means "not applied".
      expect(store.error()).toBeNull();
      expect(store.parityWarning()).toBe(
        '.claude/settings.json is not valid JSON. Ptah did not change it.',
      );
      expect(store.parityWrittenPath()).toBeNull();
    });

    it('never surfaces an absolute host path from a parity failure (Req 7.6)', async () => {
      responses['outputStyle:activate'] = ok({
        success: true,
        decision: { path: 'none' },
        parity: {
          written: false,
          tier: 'user',
          error: {
            code: 'WRITE_FAILED',
            message: '~/.claude/settings.json could not be written.',
            path: '~/.claude/settings.json',
          },
        },
      });

      await store.activate(null, { enabled: true, tier: 'user' });

      expect(store.parityWarning()).not.toMatch(/[A-Za-z]:[\\/]/);
      expect(store.parityWarning()).toContain('~/.claude/settings.json');
    });

    it('clears a stale outcome before the next activation', async () => {
      responses['outputStyle:activate'] = ok({
        success: true,
        decision: { path: 'none' },
        parity: {
          written: true,
          writtenPath: '.claude/settings.json',
          tier: 'project',
        },
      });
      await store.activate(null, { enabled: true, tier: 'project' });
      expect(store.parityWrittenPath()).toBe('.claude/settings.json');

      responses['outputStyle:activate'] = ok({
        success: true,
        decision: { path: 'flag', styleName: 'Simplified Technical English' },
      });
      await store.activate('Simplified Technical English');

      expect(store.parityOutcome()).toBeNull();
    });

    it('dismissParityOutcome() clears the note without touching the selection', async () => {
      responses['outputStyle:activate'] = ok({
        success: true,
        decision: { path: 'flag', styleName: 'Simplified Technical English' },
        parity: {
          written: true,
          writtenPath: '.claude/settings.json',
          tier: 'project',
        },
      });
      await store.activate('Simplified Technical English', {
        enabled: true,
        tier: 'project',
      });

      store.dismissParityOutcome();

      expect(store.parityOutcome()).toBeNull();
      expect(store.activeName()).toBe('Simplified Technical English');
    });
  });

  describe('save()', () => {
    const saveParams = {
      tier: 'user' as const,
      name: 'Brief',
      description: 'Fewer words.',
      keepCodingInstructions: true,
      body: 'Answer in at most three sentences.',
    };

    it('refreshes so the new style appears without a reload (Req 3.6)', async () => {
      responses['outputStyle:save'] = ok({
        success: true,
        path: '~/.claude/output-styles/brief.md',
      });
      responses['outputStyle:list'] = listResult([BUILT_IN_DEFAULT]);

      responses['outputStyle:list'] = listResult([
        BUILT_IN_DEFAULT,
        {
          ...USER_STYLE,
          name: 'Brief',
          description: 'Fewer words.',
          fileName: 'brief.md',
        },
      ]);

      const error = await store.save(saveParams);

      expect(error).toBeNull();
      expect(call).toHaveBeenCalledWith('outputStyle:save', saveParams);
      expect(call).toHaveBeenCalledWith('outputStyle:list', {});
      expect(store.styles().map((style) => style.name)).toContain('Brief');
    });

    it('does not activate the saved style (Req 3.7)', async () => {
      responses['outputStyle:save'] = ok({ success: true });

      await store.save(saveParams);

      expect(call).not.toHaveBeenCalledWith(
        'outputStyle:activate',
        expect.anything(),
      );
      expect(store.activeName()).toBeNull();
    });

    it('returns the typed operation error so the editor can offer an overwrite', async () => {
      responses['outputStyle:save'] = ok({
        success: false,
        error: {
          code: 'FILE_EXISTS',
          message: 'A style file with that name already exists in this tier.',
        },
      });

      const error = await store.save(saveParams);

      expect(error).toEqual({
        code: 'FILE_EXISTS',
        message: 'A style file with that name already exists in this tier.',
      });
      expect(store.error()).toBe(
        'A style file with that name already exists in this tier.',
      );
      expect(store.saving()).toBe(false);
    });
  });

  describe('remove()', () => {
    it('deletes by name and tier, then re-reads the list', async () => {
      responses['outputStyle:delete'] = ok({
        success: true,
        clearedActive: true,
      });

      const removed = await store.remove(
        'Simplified Technical English',
        'user',
      );

      expect(removed).toBe(true);
      expect(call).toHaveBeenCalledWith('outputStyle:delete', {
        name: 'Simplified Technical English',
        tier: 'user',
      });
      expect(call).toHaveBeenCalledWith('outputStyle:list', {});
    });

    it('reports a failure without re-reading the list', async () => {
      responses['outputStyle:delete'] = ok({
        success: false,
        clearedActive: false,
        error: {
          code: 'IMMUTABLE',
          message: 'Built-in styles cannot be deleted.',
        },
      });

      const removed = await store.remove('Learning', 'user');

      expect(removed).toBe(false);
      expect(store.error()).toBe('Built-in styles cannot be deleted.');
      expect(call).not.toHaveBeenCalledWith('outputStyle:list', {});
    });
  });

  describe('copyToProjectTier()', () => {
    it('reads the user-tier style and re-saves it into the project tier (Req 5.5)', async () => {
      responses['outputStyle:get'] = ok({
        style: { ...USER_STYLE, body: '# Style\n\nShort sentences.' },
      });
      responses['outputStyle:save'] = ok({ success: true });

      const error = await store.copyToProjectTier(
        'Simplified Technical English',
      );

      expect(error).toBeNull();
      expect(call).toHaveBeenCalledWith('outputStyle:get', {
        name: 'Simplified Technical English',
        tier: 'user',
      });
      expect(call).toHaveBeenCalledWith('outputStyle:save', {
        tier: 'project',
        name: 'Simplified Technical English',
        description: 'Short sentences, plain words.',
        keepCodingInstructions: true,
        body: '# Style\n\nShort sentences.',
        overwrite: true,
      });
    });
  });
});
