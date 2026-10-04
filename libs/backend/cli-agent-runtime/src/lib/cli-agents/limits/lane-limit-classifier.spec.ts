/**
 * Lane limit classifier (TASK_2026_596, Component 10) — fixtures F34-F40.
 *
 * Instants are pinned in UTC so the clock-time resets are deterministic.
 */
import {
  classifyLaneLimit,
  laneLimitEvidence,
  RETRY_AT_REGEX,
  USAGE_LIMIT_REGEX,
} from './lane-limit-classifier';

const UTC = 'UTC';
/** 2026-10-04T12:00:00Z */
const NOON = Date.UTC(2026, 9, 4, 12, 0, 0);
const HOUR = 60 * 60 * 1000;

function classify(cliOrProvider: string, ...texts: string[]) {
  return classifyLaneLimit({ cliOrProvider, texts, observedAt: NOON, tz: UTC });
}

describe('classifyLaneLimit', () => {
  describe('F34 — Claude "limit reached ∙ resets <clock>"', () => {
    it('names the 5-hour window and resolves the reset to the next 2am', () => {
      expect(classify('ptah-cli', '5-hour limit reached ∙ resets 2am')).toEqual(
        {
          failureKind: 'quota',
          windowKey: 'five_hour',
          resetsAt: Date.UTC(2026, 9, 5, 2, 0, 0),
          resetSource: 'error-derived',
          pattern: 'claude-limit-reached',
        },
      );
    });

    it('names the weekly window', () => {
      expect(
        classify('anthropic', 'Weekly limit reached ∙ resets 5pm'),
      ).toMatchObject({ windowKey: 'weekly', resetsAt: NOON + 5 * HOUR });
    });

    it('scopes a model-named weekly window to its family', () => {
      expect(
        classify('anthropic', 'Opus weekly limit reached ∙ resets 1pm'),
      ).toMatchObject({
        windowKey: 'weekly_model:opus',
        modelScope: 'opus',
        resetsAt: NOON + HOUR,
      });
    });

    it('reads the reset in the zone the message names', () => {
      expect(
        classify(
          'anthropic',
          '5-hour limit reached ∙ resets 3pm (Europe/Berlin)',
        ),
      ).toMatchObject({ resetsAt: Date.UTC(2026, 9, 4, 13, 0, 0) });
    });

    it('is owner-level when no window is named', () => {
      const result = classify('anthropic', 'Limit reached ∙ resets 2am');
      expect(result).toMatchObject({ failureKind: 'quota' });
      expect(result?.windowKey).toBeUndefined();
    });
  });

  describe('F35 — Codex "usage limit … try again at <clock>"', () => {
    it('resolves the retry clock to the next occurrence', () => {
      expect(
        classify(
          'codex',
          "You've hit your usage limit. Upgrade to Pro or try again at 5:05 PM.",
        ),
      ).toEqual({
        failureKind: 'quota',
        resetsAt: Date.UTC(2026, 9, 4, 17, 5, 0),
        resetSource: 'error-derived',
        pattern: 'codex-usage-limit',
      });
    });

    it('keeps the reset unknown when the retry names a date it cannot place', () => {
      const result = classify(
        'codex',
        'usage limit reached; try again at Oct 9th, 2026 5:05 PM',
      );
      expect(result).toMatchObject({ failureKind: 'quota' });
      expect(result?.resetsAt).toBeUndefined();
    });

    it('matches the summary line sdk-error-summary produces', () => {
      expect(
        classify('codex', 'Codex usage limit reached. Try again at 17:05.'),
      ).toMatchObject({ resetsAt: Date.UTC(2026, 9, 4, 17, 5, 0) });
    });
  });

  describe('F36 — Antigravity "RESOURCE_EXHAUSTED … reset after <duration>" (provisional)', () => {
    it('resolves the relative duration', () => {
      expect(
        classify(
          'antigravity',
          'Error 429 RESOURCE_EXHAUSTED: quota exceeded, reset after 144h24m50s.',
        ),
      ).toEqual({
        failureKind: 'quota',
        resetsAt: NOON + (144 * 3600 + 24 * 60 + 50) * 1000,
        resetSource: 'error-derived',
        pattern: 'antigravity-resource-exhausted',
      });
    });

    it('does not classify RESOURCE_EXHAUSTED without a reset duration', () => {
      expect(classify('antigravity', 'RESOURCE_EXHAUSTED')).toBeNull();
    });
  });

  it('F37 — OpenCode "Free usage exceeded" is owner evidence (provisional)', () => {
    expect(
      classify('opencode', 'Error: Free usage exceeded for this model'),
    ).toEqual({
      failureKind: 'quota',
      resetSource: 'error-derived',
      pattern: 'opencode-free-usage',
    });
  });

  describe('F38 — Ollama 429 (provisional)', () => {
    it('classifies a 429 with a limit wording', () => {
      expect(
        classify('ollama-cloud', 'status 429: Too Many Requests'),
      ).toMatchObject({ failureKind: 'quota', pattern: 'ollama-429' });
    });

    it('reaches a ptah-cli lane, whose provider is not known at exit', () => {
      expect(
        classify('ptah-cli', 'HTTP 429 - weekly usage limit exceeded'),
      ).toMatchObject({ pattern: 'ollama-429' });
    });

    it('ignores a bare 429 in ordinary output', () => {
      expect(
        classify('ollama-cloud', 'src/app.ts:429: const x = 1;'),
      ).toBeNull();
    });
  });

  describe('F39 — capacity, timeouts and auth are not quota (Req 3.9)', () => {
    it.each([
      [
        'antigravity',
        'RESOURCE_EXHAUSTED: MODEL_CAPACITY_EXHAUSTED, reset after 30s',
      ],
      ['antigravity', 'MODEL_CAPACITY_EXHAUSTED: no capacity for gemini-3-pro'],
      ['codex', 'Error: request timed out after 600000ms'],
      ['ptah-cli', 'Request timeout: the operation timed out'],
      ['codex', '401 Unauthorized: invalid authentication credentials'],
      ['ptah-cli', 'authentication_error: invalid x-api-key'],
      ['opencode', 'Error: not logged in. Run `opencode auth login`.'],
    ])('%s: %s → null', (cli, text) => {
      expect(classify(cli, text)).toBeNull();
    });
  });

  it('F40 — Codex token-count events with no quota fields give no window', () => {
    const turnCompleted = JSON.stringify({
      type: 'turn.completed',
      usage: { input_tokens: 1200, cached_input_tokens: 0, output_tokens: 80 },
    });
    expect(classify('codex', turnCompleted)).toBeNull();
  });

  describe('per-CLI wordings', () => {
    it("does not read another vendor's wording on a lane", () => {
      expect(classify('codex', 'Free usage exceeded')).toBeNull();
      expect(classify('opencode', 'usage limit reached')).toBeNull();
      expect(
        classify('antigravity', '5-hour limit reached ∙ resets 2am'),
      ).toBeNull();
    });

    it('returns null for a CLI with no wordings', () => {
      expect(classify('copilot', 'usage limit reached')).toBeNull();
    });

    it('checks texts in order and returns the first match', () => {
      expect(
        classify(
          'ptah-cli',
          '',
          'status 429 too many requests',
          '5-hour limit reached ∙ resets 2am',
        ),
      ).toMatchObject({ pattern: 'ollama-429' });
    });
  });
});

describe('laneLimitEvidence', () => {
  it('builds an exhausted window when the window is named', () => {
    const classification = classify(
      'ptah-cli',
      '5-hour limit reached ∙ resets 2am',
    );
    if (!classification) throw new Error('expected a classification');
    const resetsAt = Date.UTC(2026, 9, 5, 2, 0, 0);

    expect(laneLimitEvidence(classification, NOON)).toEqual({
      kind: 'window',
      window: {
        key: 'five_hour',
        kind: 'five_hour',
        label: '5-hour session',
        resetsAt,
        resetSource: 'error-derived',
        exhaustion: {
          observedAt: NOON,
          source: 'error-derived',
          resetsAt,
          resetSource: 'error-derived',
        },
        observedAt: NOON,
      },
    });
  });

  it('labels a model-scoped weekly window', () => {
    const classification = classify(
      'anthropic',
      'Opus weekly limit reached ∙ resets 1pm',
    );
    if (!classification) throw new Error('expected a classification');

    const evidence = laneLimitEvidence(classification, NOON);
    expect(evidence).toMatchObject({
      kind: 'window',
      window: {
        key: 'weekly_model:opus',
        kind: 'weekly_model',
        label: 'Weekly · Opus',
        modelScope: 'opus',
        exhaustion: { modelScope: 'opus' },
      },
    });
  });

  it('builds owner evidence without a reset when none was given', () => {
    const classification = classify('opencode', 'Free usage exceeded');
    if (!classification) throw new Error('expected a classification');

    expect(laneLimitEvidence(classification, NOON)).toEqual({
      kind: 'owner',
      evidence: { observedAt: NOON, source: 'error-derived' },
    });
  });
});

describe('shared Codex patterns', () => {
  it('keeps the wording sdk-error-summary relies on', () => {
    expect(USAGE_LIMIT_REGEX.test('You have hit your Usage Limit')).toBe(true);
    expect(RETRY_AT_REGEX.exec('try again at 5:05 PM.')?.[1]).toBe('5:05 PM');
  });
});
