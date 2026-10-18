import {
  CustomEndpointSelectionSchema,
  DecisionModelSelectionSchema,
  DecisionModelUnsupportedMarkSchema,
  OllamaCloudSelectionSchema,
} from './decision-model.types';

/** A value that must never be echoed in an issue text. */
const SENTINEL = 'sk-sentinel-9c2e-never-echoed';

/** Paths of every issue the schema reported for a rejected input. */
function issuePaths(input: unknown): string[] {
  const result = DecisionModelSelectionSchema.safeParse(input);
  if (result.success) {
    throw new Error('expected the selection to be refused');
  }
  return result.error.issues.map((issue) => issue.path.join('.'));
}

function issueText(input: unknown): string {
  const result = DecisionModelSelectionSchema.safeParse(input);
  if (result.success) {
    throw new Error('expected the selection to be refused');
  }
  return JSON.stringify(result.error.issues);
}

describe('DecisionModelSelectionSchema: ollama-cloud and custom kinds (2.1)', () => {
  describe('both kinds parse', () => {
    it('accepts an ollama-cloud selection', () => {
      expect(
        DecisionModelSelectionSchema.parse({
          kind: 'ollama-cloud',
          model: 'clef:27b',
        }),
      ).toEqual({ kind: 'ollama-cloud', model: 'clef:27b' });
    });

    it('accepts a custom selection and normalises its base URL', () => {
      expect(
        DecisionModelSelectionSchema.parse({
          kind: 'custom',
          baseUrl: 'HTTPS://Gateway.Example:443/gw///',
          model: 'laya-1',
        }),
      ).toEqual({
        kind: 'custom',
        baseUrl: 'https://gateway.example/gw',
        model: 'laya-1',
      });
    });

    it('accepts a plain-http custom base URL (the key rule is a save-time check, not a schema one)', () => {
      expect(
        CustomEndpointSelectionSchema.parse({
          kind: 'custom',
          baseUrl: 'http://192.168.1.20:11434',
          model: 'm',
        }),
      ).toEqual({
        kind: 'custom',
        baseUrl: 'http://192.168.1.20:11434',
        model: 'm',
      });
    });

    it('trims the model of both kinds', () => {
      expect(
        OllamaCloudSelectionSchema.parse({
          kind: 'ollama-cloud',
          model: '  clef:27b  ',
        }).model,
      ).toBe('clef:27b');
      expect(
        CustomEndpointSelectionSchema.parse({
          kind: 'custom',
          baseUrl: 'https://gateway.example',
          model: '  m  ',
        }).model,
      ).toBe('m');
    });

    it('keeps the existing kinds unchanged (Jev default applied)', () => {
      expect(DecisionModelSelectionSchema.parse({ kind: 'unset' })).toEqual({
        kind: 'unset',
      });
      expect(
        DecisionModelSelectionSchema.parse({ kind: 'ollama', model: 'nimble' }),
      ).toEqual({ kind: 'ollama', model: 'nimble' });
      expect(DecisionModelSelectionSchema.parse({ kind: 'jev' })).toEqual({
        kind: 'jev',
        model: 'jev-1.13.0',
      });
      expect(
        DecisionModelSelectionSchema.parse({
          kind: 'structured',
          providerId: 'ollama',
          model: 'm',
        }),
      ).toEqual({ kind: 'structured', providerId: 'ollama', model: 'm' });
    });
  });

  describe('extra keys are refused', () => {
    it.each([
      ['ollama-cloud', { kind: 'ollama-cloud', model: 'm' }],
      [
        'custom',
        { kind: 'custom', baseUrl: 'https://gateway.example', model: 'm' },
      ],
    ])('refuses an unknown key on a %s selection', (_kind, base) => {
      const result = DecisionModelSelectionSchema.safeParse({
        ...base,
        extra: true,
      });
      expect(result.success).toBe(false);
      expect(issueText({ ...base, extra: true })).toContain('extra');
    });

    it.each([
      ['ollama-cloud', { kind: 'ollama-cloud', model: 'm' }],
      [
        'custom',
        { kind: 'custom', baseUrl: 'https://gateway.example', model: 'm' },
      ],
    ])(
      'refuses an apiKey field on a %s selection and never echoes its value',
      (_kind, base) => {
        const input = { ...base, apiKey: SENTINEL };

        expect(DecisionModelSelectionSchema.safeParse(input).success).toBe(
          false,
        );
        expect(issueText(input)).not.toContain(SENTINEL);
      },
    );

    it('refuses a base URL on an ollama-cloud selection', () => {
      expect(
        DecisionModelSelectionSchema.safeParse({
          kind: 'ollama-cloud',
          model: 'm',
          baseUrl: 'https://gateway.example',
        }).success,
      ).toBe(false);
    });
  });

  describe('an empty or oversized model is refused on the model path', () => {
    it.each([
      ['ollama-cloud', { kind: 'ollama-cloud' }],
      ['custom', { kind: 'custom', baseUrl: 'https://gateway.example' }],
    ])('%s: empty model', (_kind, base) => {
      expect(issuePaths({ ...base, model: '' })).toEqual(['model']);
    });

    it.each([
      ['ollama-cloud', { kind: 'ollama-cloud' }],
      ['custom', { kind: 'custom', baseUrl: 'https://gateway.example' }],
    ])('%s: model of 128 characters passes, 129 is refused', (_kind, base) => {
      expect(
        DecisionModelSelectionSchema.safeParse({
          ...base,
          model: 'm'.repeat(128),
        }).success,
      ).toBe(true);
      expect(issuePaths({ ...base, model: 'm'.repeat(129) })).toEqual([
        'model',
      ]);
    });

    it('a missing model is refused on the model path', () => {
      expect(issuePaths({ kind: 'ollama-cloud' })).toEqual(['model']);
    });
  });

  describe('a bad base URL is refused on the baseUrl path', () => {
    it.each([
      ['empty', ''],
      ['relative', '/v1/systemone'],
      ['no scheme', 'gateway.example'],
      ['not http', 'ftp://gateway.example'],
      ['userinfo', `https://user:${SENTINEL}@gateway.example`],
      ['query', `https://gateway.example/gw?token=${SENTINEL}`],
      ['fragment', `https://gateway.example/gw#${SENTINEL}`],
      ['no host', 'https://'],
    ])('custom: %s', (_label, baseUrl) => {
      const input = { kind: 'custom', baseUrl, model: 'm' };

      expect(issuePaths(input)).toEqual(['baseUrl']);
      // The fixed issue text never repeats what the user typed.
      expect(issueText(input)).not.toContain(SENTINEL);
    });

    it('a missing base URL is refused on the baseUrl path', () => {
      expect(issuePaths({ kind: 'custom', model: 'm' })).toEqual(['baseUrl']);
    });

    it('reports both fields when both are bad', () => {
      expect(
        issuePaths({ kind: 'custom', baseUrl: 'nope', model: '' }).sort(),
      ).toEqual(['baseUrl', 'model']);
    });
  });

  describe('the kind discriminator', () => {
    it('refuses an unknown kind on the kind path', () => {
      expect(issuePaths({ kind: 'ollama_cloud', model: 'm' })).toEqual([
        'kind',
      ]);
    });
  });

  describe('the persisted unsupported mark embeds the new kinds', () => {
    it.each([
      [{ kind: 'ollama-cloud', model: 'clef:27b' }],
      [{ kind: 'custom', baseUrl: 'https://gateway.example', model: 'm' }],
    ])('round-trips a mark for %j', (selection) => {
      const mark = {
        selection,
        baseUrl: 'https://gateway.example',
        detail: 'endpoint does not serve /v1/systemone',
        at: 1_000,
      };

      expect(DecisionModelUnsupportedMarkSchema.parse(mark)).toEqual(mark);
    });
  });
});
