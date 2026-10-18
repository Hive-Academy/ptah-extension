import {
  createMockSecretStorage,
  type MockSecretStorage,
} from '@ptah-extension/platform-core/testing';
import type { LaneRoutingLogger } from '../lane-routing-logger';
import { DecisionModelKeys, type DecisionKeySlot } from './decision-model.keys';
import {
  DECISION_MODEL_CUSTOM_SECRET_KEY,
  DECISION_MODEL_JEV_SECRET_KEY,
  OLLAMA_CLOUD_SECRET_KEY,
} from './decision-model.types';

/** A value that must never appear in a log line or an error. */
const SENTINEL = 'sk-sentinel-4b1d-never-logged';
const ORIGIN_A = 'https://gateway-a.example';
const ORIGIN_B = 'https://gateway-b.example';

function fakeLogger(): jest.Mocked<LaneRoutingLogger> {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

interface Harness {
  readonly keys: DecisionModelKeys;
  readonly secrets: MockSecretStorage;
  readonly logger: jest.Mocked<LaneRoutingLogger>;
}

function harness(seed: Record<string, string> = {}): Harness {
  const secrets = createMockSecretStorage({ seed });
  const logger = fakeLogger();
  return { keys: new DecisionModelKeys(secrets, logger), secrets, logger };
}

function customValue(origin: string, key: string): string {
  return JSON.stringify({ origin, key });
}

/** Every argument the logger received, serialised for a substring search. */
function loggedText(logger: jest.Mocked<LaneRoutingLogger>): string {
  return JSON.stringify([
    logger.debug.mock.calls,
    logger.info.mock.calls,
    logger.warn.mock.calls,
    logger.error.mock.calls,
  ]);
}

describe('DecisionModelKeys', () => {
  describe('slot names (7.3)', () => {
    it('uses the literal secret keys', () => {
      expect(DECISION_MODEL_JEV_SECRET_KEY).toBe('ptah.laneRouting.jevApiKey');
      expect(DECISION_MODEL_CUSTOM_SECRET_KEY).toBe(
        'ptah.laneRouting.customEndpointApiKey',
      );
      expect(OLLAMA_CLOUD_SECRET_KEY).toBe('ptah.auth.provider.ollama-cloud');
    });
  });

  describe('jev', () => {
    it('stores a trimmed key and reads it back', async () => {
      const h = harness();
      await h.keys.set('jev', `  ${SENTINEL}  `);
      expect(h.secrets.__state.entries.get(DECISION_MODEL_JEV_SECRET_KEY)).toBe(
        SENTINEL,
      );
      await expect(h.keys.get('jev')).resolves.toBe(SENTINEL);
      await expect(h.keys.has('jev')).resolves.toBe(true);
    });

    it('ignores an origin', async () => {
      const h = harness({ [DECISION_MODEL_JEV_SECRET_KEY]: SENTINEL });
      await expect(h.keys.get('jev', ORIGIN_B)).resolves.toBe(SENTINEL);
    });

    it('reads a blank stored value as no key', async () => {
      const h = harness({ [DECISION_MODEL_JEV_SECRET_KEY]: '   ' });
      await expect(h.keys.get('jev')).resolves.toBeNull();
      await expect(h.keys.has('jev')).resolves.toBe(false);
    });

    it.each([null, '', '   '])('set(%j) deletes the key', async (value) => {
      const h = harness({ [DECISION_MODEL_JEV_SECRET_KEY]: SENTINEL });
      await h.keys.set('jev', value);
      expect(h.secrets.__state.entries.has(DECISION_MODEL_JEV_SECRET_KEY)).toBe(
        false,
      );
      expect(h.secrets.store).not.toHaveBeenCalled();
    });
  });

  describe('custom (DC3 origin binding)', () => {
    it('stores JSON { origin, key } bound to the origin of the given URL', async () => {
      const h = harness();
      await h.keys.set('custom', ` ${SENTINEL} `, `${ORIGIN_A}/gw/v1`);
      const raw = h.secrets.__state.entries.get(
        DECISION_MODEL_CUSTOM_SECRET_KEY,
      );
      expect(raw).toBeDefined();
      expect(JSON.parse(raw ?? '')).toEqual({ origin: ORIGIN_A, key: SENTINEL });
    });

    it('returns the key only for the matching origin', async () => {
      const h = harness({
        [DECISION_MODEL_CUSTOM_SECRET_KEY]: customValue(ORIGIN_A, SENTINEL),
      });
      await expect(h.keys.get('custom', ORIGIN_A)).resolves.toBe(SENTINEL);
      await expect(h.keys.get('custom', `${ORIGIN_A}/gw`)).resolves.toBe(
        SENTINEL,
      );
      await expect(h.keys.get('custom', ORIGIN_B)).resolves.toBeNull();
      await expect(
        h.keys.get('custom', 'http://gateway-a.example'),
      ).resolves.toBeNull();
      await expect(
        h.keys.get('custom', 'https://gateway-a.example:8443'),
      ).resolves.toBeNull();
      await expect(h.keys.get('custom')).resolves.toBeNull();
      await expect(h.keys.get('custom', 'not a url')).resolves.toBeNull();
    });

    it('has() binds to the origin when one is given, else reports any stored key', async () => {
      const h = harness({
        [DECISION_MODEL_CUSTOM_SECRET_KEY]: customValue(ORIGIN_A, SENTINEL),
      });
      await expect(h.keys.has('custom', ORIGIN_A)).resolves.toBe(true);
      await expect(h.keys.has('custom', ORIGIN_B)).resolves.toBe(false);
      await expect(h.keys.has('custom')).resolves.toBe(true);
    });

    it('has() is false when nothing is stored', async () => {
      const h = harness();
      await expect(h.keys.has('custom')).resolves.toBe(false);
      await expect(h.keys.has('custom', ORIGIN_A)).resolves.toBe(false);
    });

    it.each([undefined, '', 'not a url', 'file:///tmp/x'])(
      'refuses a non-blank key without a usable origin (%j), without the key in the error',
      async (origin) => {
        const h = harness();
        const failure = h.keys.set('custom', SENTINEL, origin);
        await expect(failure).rejects.toThrow(/origin/);
        await failure.catch((error: unknown) => {
          expect(String(error)).not.toContain(SENTINEL);
        });
        expect(h.secrets.store).not.toHaveBeenCalled();
      },
    );

    it.each([null, '', '  '])(
      'set(%j) deletes the key with or without an origin',
      async (value) => {
        const h = harness({
          [DECISION_MODEL_CUSTOM_SECRET_KEY]: customValue(ORIGIN_A, SENTINEL),
        });
        await h.keys.set('custom', value);
        expect(
          h.secrets.__state.entries.has(DECISION_MODEL_CUSTOM_SECRET_KEY),
        ).toBe(false);
      },
    );

    it.each([
      ['not JSON', `{${SENTINEL}`],
      ['a plain string', SENTINEL],
      ['missing origin', JSON.stringify({ key: SENTINEL })],
      ['extra field', JSON.stringify({ origin: ORIGIN_A, key: SENTINEL, x: 1 })],
      ['blank key', customValue(ORIGIN_A, '   ')],
      ['origin that is not a URL', customValue('nowhere', SENTINEL)],
    ])(
      'reads an invalid stored value (%s) as no key and warns without the value',
      async (_label, raw) => {
        const h = harness({ [DECISION_MODEL_CUSTOM_SECRET_KEY]: raw });
        await expect(h.keys.get('custom', ORIGIN_A)).resolves.toBeNull();
        await expect(h.keys.has('custom')).resolves.toBe(false);
        expect(h.logger.warn).toHaveBeenCalled();
        expect(loggedText(h.logger)).not.toContain(SENTINEL);
        expect(loggedText(h.logger)).not.toContain(raw);
      },
    );
  });

  describe('snapshot and restore', () => {
    it.each<[DecisionKeySlot, string]>([
      ['jev', DECISION_MODEL_JEV_SECRET_KEY],
      ['custom', DECISION_MODEL_CUSTOM_SECRET_KEY],
    ])('%s: restores the exact raw value after a change', async (slot, secretKey) => {
      const raw =
        slot === 'jev' ? SENTINEL : customValue(ORIGIN_A, SENTINEL);
      const h = harness({ [secretKey]: raw });
      const snapshot = await h.keys.snapshot(slot);
      await h.keys.set(slot, 'replacement-key', ORIGIN_B);
      expect(h.secrets.__state.entries.get(secretKey)).not.toBe(raw);
      await h.keys.restore(slot, snapshot);
      expect(h.secrets.__state.entries.get(secretKey)).toBe(raw);
    });

    it.each<[DecisionKeySlot, string]>([
      ['jev', DECISION_MODEL_JEV_SECRET_KEY],
      ['custom', DECISION_MODEL_CUSTOM_SECRET_KEY],
    ])('%s: a null snapshot restores "no key"', async (slot, secretKey) => {
      const h = harness();
      const snapshot = await h.keys.snapshot(slot);
      expect(snapshot).toBeNull();
      await h.keys.set(slot, 'replacement-key', ORIGIN_B);
      expect(h.secrets.__state.entries.has(secretKey)).toBe(true);
      await h.keys.restore(slot, snapshot);
      expect(h.secrets.__state.entries.has(secretKey)).toBe(false);
    });

    it('touches only its own slot', async () => {
      const h = harness({
        [DECISION_MODEL_JEV_SECRET_KEY]: 'jev-key',
        [OLLAMA_CLOUD_SECRET_KEY]: 'cloud-key',
      });
      await h.keys.restore('custom', null);
      expect(h.secrets.__state.entries.get(DECISION_MODEL_JEV_SECRET_KEY)).toBe(
        'jev-key',
      );
      expect(h.secrets.__state.entries.get(OLLAMA_CLOUD_SECRET_KEY)).toBe(
        'cloud-key',
      );
    });
  });

  describe('readOllamaCloudKey (D1, DC1)', () => {
    it('reads the shared provider slot, trimmed', async () => {
      const h = harness({
        'ptah.auth.provider.ollama-cloud': `  ${SENTINEL}\n`,
      });
      await expect(h.keys.readOllamaCloudKey()).resolves.toBe(SENTINEL);
      expect(h.secrets.get).toHaveBeenCalledWith(
        'ptah.auth.provider.ollama-cloud',
      );
    });

    it.each([undefined, '', '   '])(
      'reads %j as no key',
      async (stored) => {
        const h = harness(
          stored === undefined
            ? {}
            : { 'ptah.auth.provider.ollama-cloud': stored },
        );
        await expect(h.keys.readOllamaCloudKey()).resolves.toBeNull();
      },
    );

    it('sees a changed key on the next read (no cache, 1.4)', async () => {
      const h = harness({ [OLLAMA_CLOUD_SECRET_KEY]: 'first' });
      await expect(h.keys.readOllamaCloudKey()).resolves.toBe('first');
      h.secrets.__state.seed(OLLAMA_CLOUD_SECRET_KEY, 'second');
      await expect(h.keys.readOllamaCloudKey()).resolves.toBe('second');
      h.secrets.__state.entries.delete(OLLAMA_CLOUD_SECRET_KEY);
      await expect(h.keys.readOllamaCloudKey()).resolves.toBeNull();
    });

    it('never writes the provider slot', async () => {
      const h = harness({ [OLLAMA_CLOUD_SECRET_KEY]: SENTINEL });
      await h.keys.readOllamaCloudKey();
      await h.keys.set('jev', 'x');
      await h.keys.set('custom', 'y', ORIGIN_A);
      await h.keys.set('jev', null);
      await h.keys.set('custom', null);
      await h.keys.restore('jev', null);
      await h.keys.restore('custom', null);
      const touched = [
        ...h.secrets.store.mock.calls.map(([key]) => key),
        ...h.secrets.delete.mock.calls.map(([key]) => key),
      ];
      expect(touched).not.toContain(OLLAMA_CLOUD_SECRET_KEY);
    });
  });

  describe('secret store failure', () => {
    it('propagates a rejected read to the caller', async () => {
      const h = harness();
      const failure = new Error('keychain locked');
      h.secrets.get.mockRejectedValue(failure);
      await expect(h.keys.get('jev')).rejects.toBe(failure);
      await expect(h.keys.has('custom')).rejects.toBe(failure);
      await expect(h.keys.readOllamaCloudKey()).rejects.toBe(failure);
    });
  });

  describe('sentinel key (1.6)', () => {
    it('never logs a key across every operation', async () => {
      const h = harness({
        [OLLAMA_CLOUD_SECRET_KEY]: SENTINEL,
        [DECISION_MODEL_JEV_SECRET_KEY]: SENTINEL,
      });
      await h.keys.set('custom', SENTINEL, ORIGIN_A);
      await h.keys.has('jev');
      await h.keys.get('jev');
      await h.keys.has('custom', ORIGIN_A);
      await h.keys.get('custom', ORIGIN_A);
      await h.keys.get('custom', ORIGIN_B);
      const snapshot = await h.keys.snapshot('custom');
      await h.keys.restore('custom', snapshot);
      await h.keys.readOllamaCloudKey();
      await h.keys.set('jev', null);
      expect(loggedText(h.logger)).not.toContain(SENTINEL);
    });
  });
});
