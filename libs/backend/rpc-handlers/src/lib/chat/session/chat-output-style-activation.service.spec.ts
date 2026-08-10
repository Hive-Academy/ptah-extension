/**
 * `ChatOutputStyleActivationService` — the per-session activation composition
 * (TASK_2026_197 Batch 5, Req 5.1/5.2/5.3/5.6).
 *
 * The REAL `OutputStyleActivationResolver` is used rather than a mock: the
 * whole value of this class is that it feeds that predicate the right inputs
 * and maps its three-member result onto disjoint fields. Mocking the predicate
 * would test the mock.
 */

import 'reflect-metadata';

import { OutputStyleActivationResolver } from '@ptah-extension/output-styles';
import { OUTPUT_STYLE_SELECTED_NAME_DEF } from '@ptah-extension/settings-core';
import type { OutputStyleEntry } from '@ptah-extension/shared';

import { ChatOutputStyleActivationService } from './chat-output-style-activation.service';

const SELECTED_KEY = OUTPUT_STYLE_SELECTED_NAME_DEF.key;
const LOCALHOST = 'http://127.0.0.1:51830';

function entry(patch: Partial<OutputStyleEntry> = {}): OutputStyleEntry {
  return {
    name: 'Terse',
    tier: 'user',
    description: 'Short answers.',
    keepCodingInstructions: false,
    editable: true,
    deletable: true,
    body: 'Answer tersely.',
    ...patch,
  };
}

interface Harness {
  service: ChatOutputStyleActivationService;
  discover: jest.Mock;
  warn: jest.Mock;
}

function makeService(options: {
  selected?: unknown;
  selectionThrows?: boolean;
  styles?: readonly OutputStyleEntry[];
  discoveryThrows?: boolean;
  baseUrl?: string;
}): Harness {
  const warn = jest.fn();
  const logger = { warn, info: jest.fn(), debug: jest.fn(), error: jest.fn() };

  const discover = jest.fn(async () => {
    if (options.discoveryThrows) throw new Error('scan exploded');
    return { styles: options.styles ?? [], invalid: [], active: null };
  });

  const settingsStore = {
    readGlobal: jest.fn(() => {
      if (options.selectionThrows) throw new Error('store exploded');
      return options.selected;
    }),
  };

  const service = new ChatOutputStyleActivationService(
    logger as never,
    { discover } as never,
    new OutputStyleActivationResolver(),
    settingsStore as never,
    undefined,
    options.baseUrl === undefined
      ? undefined
      : ({ ANTHROPIC_BASE_URL: options.baseUrl } as never),
  );

  return { service, discover, warn };
}

describe('ChatOutputStyleActivationService.resolveSessionFields', () => {
  describe('no style', () => {
    it('returns no fields when nothing is selected', async () => {
      const { service, discover } = makeService({ selected: '' });

      await expect(service.resolveSessionFields('/repo')).resolves.toEqual({});
      // Not even a directory scan — nothing to resolve.
      expect(discover).not.toHaveBeenCalled();
    });

    it('treats the literal "default" as no selection (Req 2.4 / G4b)', async () => {
      const { service, discover } = makeService({ selected: 'default' });

      await expect(service.resolveSessionFields('/repo')).resolves.toEqual({});
      expect(discover).not.toHaveBeenCalled();
    });

    it('returns no fields when the selection no longer resolves (E5)', async () => {
      const { service } = makeService({
        selected: 'Gone',
        styles: [entry({ name: 'Terse' })],
      });

      await expect(service.resolveSessionFields('/repo')).resolves.toEqual({});
    });

    it('ignores a shadowed entry — the SDK would use the higher tier', async () => {
      const { service } = makeService({
        selected: 'Terse',
        styles: [entry({ tier: 'user', shadowed: true })],
      });

      await expect(service.resolveSessionFields('/repo')).resolves.toEqual({});
    });
  });

  describe('flag path (the primary mechanism)', () => {
    it('sets only outputStyleName for a project-tier style', async () => {
      const { service } = makeService({
        selected: 'Terse',
        styles: [entry({ tier: 'project' })],
        baseUrl: LOCALHOST,
      });

      const fields = await service.resolveSessionFields('/repo');

      expect(fields).toEqual({ outputStyleName: 'Terse' });
      expect('outputStyleBody' in fields).toBe(false);
    });

    it('sets only outputStyleName for a user-tier style on a remote provider', async () => {
      const { service } = makeService({
        selected: 'Terse',
        styles: [entry({ tier: 'user' })],
        baseUrl: 'https://api.anthropic.com',
      });

      const fields = await service.resolveSessionFields('/repo');

      expect(fields).toEqual({ outputStyleName: 'Terse' });
    });

    it('treats an absent base URL as not-localhost', async () => {
      const { service } = makeService({
        selected: 'Terse',
        styles: [entry({ tier: 'user' })],
      });

      await expect(service.resolveSessionFields('/repo')).resolves.toEqual({
        outputStyleName: 'Terse',
      });
    });

    it('sets outputStyleName for a built-in, which carries no body', async () => {
      const { service } = makeService({
        selected: 'Explanatory',
        styles: [
          entry({
            name: 'Explanatory',
            tier: 'builtin',
            body: undefined,
            editable: false,
            deletable: false,
          }),
        ],
        baseUrl: LOCALHOST,
      });

      await expect(service.resolveSessionFields('/repo')).resolves.toEqual({
        outputStyleName: 'Explanatory',
      });
    });
  });

  describe('inject path (the narrow fallback)', () => {
    it('sets only outputStyleBody for a user-tier style on a localhost provider', async () => {
      const { service } = makeService({
        selected: 'Terse',
        styles: [entry({ tier: 'user', body: 'Answer tersely.' })],
        baseUrl: LOCALHOST,
      });

      const fields = await service.resolveSessionFields('/repo');

      expect(fields).toEqual({ outputStyleBody: 'Answer tersely.' });
      // R3: the two paths are complements of one boolean and must stay
      // physically disjoint all the way to the SDK.
      expect('outputStyleName' in fields).toBe(false);
    });

    it('also matches a literal "localhost" base URL', async () => {
      const { service } = makeService({
        selected: 'Terse',
        styles: [entry({ tier: 'user' })],
        baseUrl: 'http://localhost:4000/v1',
      });

      const fields = await service.resolveSessionFields('/repo');

      expect(fields).toEqual({ outputStyleBody: 'Answer tersely.' });
    });

    it('returns no fields when the body would be empty', async () => {
      const { service } = makeService({
        selected: 'Terse',
        styles: [entry({ tier: 'user', body: '   ' })],
        baseUrl: LOCALHOST,
      });

      await expect(service.resolveSessionFields('/repo')).resolves.toEqual({});
    });
  });

  describe('never fatal', () => {
    it('degrades to no style when discovery throws', async () => {
      const { service, warn } = makeService({
        selected: 'Terse',
        discoveryThrows: true,
      });

      await expect(service.resolveSessionFields('/repo')).resolves.toEqual({});
      expect(warn).toHaveBeenCalled();
    });

    it('degrades to no style when the settings store throws', async () => {
      const { service, warn } = makeService({ selectionThrows: true });

      await expect(service.resolveSessionFields('/repo')).resolves.toEqual({});
      expect(warn).toHaveBeenCalled();
    });

    it('degrades to no style when the stored value is not a string', async () => {
      const { service } = makeService({ selected: 42 });

      await expect(service.resolveSessionFields('/repo')).resolves.toEqual({});
    });
  });

  describe('never cached (Req 5.6)', () => {
    it('re-reads the selection and re-scans on every call', async () => {
      const { service, discover } = makeService({
        selected: 'Terse',
        styles: [entry({ tier: 'project' })],
      });

      await service.resolveSessionFields('/repo');
      await service.resolveSessionFields('/repo');

      expect(discover).toHaveBeenCalledTimes(2);
    });

    it('scopes discovery to the workspace it was given', async () => {
      const { service, discover } = makeService({
        selected: 'Terse',
        styles: [entry({ tier: 'project' })],
      });

      await service.resolveSessionFields('/other-repo');

      expect(discover).toHaveBeenCalledWith({
        workspaceRoot: '/other-repo',
        activeName: 'Terse',
      });
    });
  });
});
