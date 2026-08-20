/**
 * `skillSynthesis.<lane>.*` settings sub-tree specs.
 *
 * The two things worth pinning here are not the plumbing:
 *
 *  1. **The default is "inherit".** Every lane ships `provider: ''` /
 *     `model: ''`, which is what makes the whole feature invisible to an
 *     install that never opens the Lanes panel. A default that drifted to a
 *     concrete provider would silently repoint everyone's background work.
 *  2. **No provider id appears anywhere.** Asserted mechanically over the
 *     whole defaults table rather than by reading it, because "we did not
 *     hardcode a vendor" is exactly the kind of invariant that erodes one
 *     well-meaning edit at a time.
 */
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import { ANTHROPIC_PROVIDERS } from '@ptah-extension/shared';
import { SKILL_LANE_IDS, type SkillLaneId } from './lane.types';
import {
  SKILL_LANE_DEFAULTS,
  SKILL_LANE_FIELDS,
  SKILL_LANE_KEYS,
  SKILL_LANE_PREFIXES,
  flattenSkillLanes,
  maxLaneTimeoutMs,
  readSkillLane,
  readSkillLanes,
} from './skill-lane-config';

/**
 * A workspace whose `getConfiguration` serves `stored`, falling back to the
 * default the caller passed. Mirrors the real routing contract: an absent key
 * yields the caller's fallback, never `undefined`.
 */
function makeWorkspace(
  stored: Record<string, unknown> = {},
): IWorkspaceProvider {
  return {
    getConfiguration: jest.fn(
      (_section: string, key: string, fallback?: unknown) =>
        Object.prototype.hasOwnProperty.call(stored, key)
          ? stored[key]
          : fallback,
    ),
    getWorkspaceRoot: jest.fn(() => '/ws'),
  } as unknown as IWorkspaceProvider;
}

describe('SKILL_LANE_DEFAULTS', () => {
  it.each(SKILL_LANE_IDS)(
    'defaults lane %s to inherit-the-active-provider',
    (id) => {
      expect(SKILL_LANE_DEFAULTS[id].provider).toBe('');
      expect(SKILL_LANE_DEFAULTS[id].model).toBe('');
    },
  );

  it.each(SKILL_LANE_IDS)('stamps lane %s with its own id', (id) => {
    expect(SKILL_LANE_DEFAULTS[id].id).toBe(id);
  });

  it('contains no provider id from the registry, in any field', () => {
    // Global invariant 1. Lanes differ ONLY by declared capability.
    const serialized = JSON.stringify(SKILL_LANE_DEFAULTS).toLowerCase();
    const leaked = ANTHROPIC_PROVIDERS.map((p) => p.id).filter((id) =>
      serialized.includes(id.toLowerCase()),
    );
    expect(leaked).toEqual([]);
  });

  it.each(SKILL_LANE_IDS)('gives lane %s a usable timeout budget', (id) => {
    // A non-positive timeout arms an AbortController that fires before the
    // request leaves, turning every call on the lane into a fake timeout.
    expect(SKILL_LANE_DEFAULTS[id].timeoutMs).toBeGreaterThan(0);
    expect(SKILL_LANE_DEFAULTS[id].maxInputChars).toBeGreaterThan(0);
    expect(SKILL_LANE_DEFAULTS[id].maxPasses).toBeGreaterThanOrEqual(1);
  });

  it('gives every lane a longer budget than the module constants it replaces', () => {
    // SYNTHESIS_TIMEOUT_MS = 30_000 and JUDGE_TIMEOUT_MS = 15_000 were sized
    // for direct Anthropic; a proxied or self-hosted endpoint is routinely
    // several times slower on the same prompt, which is the whole reason
    // these became per-lane parameters.
    expect(SKILL_LANE_DEFAULTS.synthesis.timeoutMs).toBeGreaterThan(30_000);
    expect(SKILL_LANE_DEFAULTS.judge.timeoutMs).toBeGreaterThan(15_000);
  });

  it('leaves the input slices at the values the current code already uses', () => {
    // Truncation behaviour must not change for an install that edits nothing.
    expect(SKILL_LANE_DEFAULTS.synthesis.maxInputChars).toBe(8_000);
    expect(SKILL_LANE_DEFAULTS.judge.maxInputChars).toBe(3_000);
  });

  it('makes the archaeologist the only multi-pass lane', () => {
    expect(SKILL_LANE_DEFAULTS.archaeologist.maxPasses).toBeGreaterThan(1);
    expect(SKILL_LANE_DEFAULTS.archaeologist.toolUse).toBe('required');
    for (const id of SKILL_LANE_IDS.filter((l) => l !== 'archaeologist')) {
      expect(SKILL_LANE_DEFAULTS[id].maxPasses).toBe(1);
    }
  });

  it('reports the longest lane timeout for the drain TTL assertion', () => {
    expect(maxLaneTimeoutMs(SKILL_LANE_DEFAULTS)).toBe(
      Math.max(
        ...SKILL_LANE_IDS.map((id) => SKILL_LANE_DEFAULTS[id].timeoutMs),
      ),
    );
  });
});

describe('SKILL_LANE_KEYS', () => {
  it('declares four lanes × eight fields, all distinct', () => {
    const all = SKILL_LANE_IDS.flatMap((id) =>
      SKILL_LANE_FIELDS.map((f) => SKILL_LANE_KEYS[id][f]),
    );
    expect(all).toHaveLength(32);
    expect(new Set(all).size).toBe(32);
  });

  it.each(SKILL_LANE_IDS)('files every %s key under its own prefix', (id) => {
    for (const field of SKILL_LANE_FIELDS) {
      expect(SKILL_LANE_KEYS[id][field]).toBe(
        `${SKILL_LANE_PREFIXES[id]}.${field}`,
      );
    }
  });

  it('nests every key under the proven skillSynthesis. namespace', () => {
    for (const id of SKILL_LANE_IDS) {
      expect(SKILL_LANE_PREFIXES[id].startsWith('skillSynthesis.')).toBe(true);
    }
  });
});

describe('readSkillLane', () => {
  it('returns the defaults when nothing is persisted', () => {
    const ws = makeWorkspace();
    for (const id of SKILL_LANE_IDS) {
      expect(readSkillLane(ws, id)).toEqual(SKILL_LANE_DEFAULTS[id]);
    }
  });

  it('reads persisted values key by key', () => {
    const ws = makeWorkspace({
      [SKILL_LANE_KEYS.judge.provider]: 'some-registry-id',
      [SKILL_LANE_KEYS.judge.model]: 'some-model-id',
      [SKILL_LANE_KEYS.judge.defaultTier]: 'sonnet',
      [SKILL_LANE_KEYS.judge.structuredOutput]: 'parse',
      [SKILL_LANE_KEYS.judge.toolUse]: 'none',
      [SKILL_LANE_KEYS.judge.timeoutMs]: 5_000,
      [SKILL_LANE_KEYS.judge.maxInputChars]: 1_500,
      [SKILL_LANE_KEYS.judge.maxPasses]: 2,
    });
    expect(readSkillLane(ws, 'judge')).toEqual({
      id: 'judge',
      provider: 'some-registry-id',
      model: 'some-model-id',
      defaultTier: 'sonnet',
      structuredOutput: 'parse',
      toolUse: 'none',
      timeoutMs: 5_000,
      maxInputChars: 1_500,
      maxPasses: 2,
    });
  });

  it('does not let one lane read another lane s keys', () => {
    const ws = makeWorkspace({
      [SKILL_LANE_KEYS.judge.provider]: 'judge-only',
    });
    expect(readSkillLane(ws, 'judge').provider).toBe('judge-only');
    expect(readSkillLane(ws, 'synthesis').provider).toBe('');
  });

  it('trims whitespace off provider and model', () => {
    const ws = makeWorkspace({
      [SKILL_LANE_KEYS.replay.provider]: '  padded-id  ',
      [SKILL_LANE_KEYS.replay.model]: '  padded-model  ',
    });
    const cfg = readSkillLane(ws, 'replay');
    expect(cfg.provider).toBe('padded-id');
    expect(cfg.model).toBe('padded-model');
  });

  describe('hand-edited settings.json is a real boundary', () => {
    it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, 'soon', null])(
      'falls back to the default when timeoutMs is %p',
      (bad) => {
        const ws = makeWorkspace({
          [SKILL_LANE_KEYS.synthesis.timeoutMs]: bad,
        });
        expect(readSkillLane(ws, 'synthesis').timeoutMs).toBe(
          SKILL_LANE_DEFAULTS.synthesis.timeoutMs,
        );
      },
    );

    it('falls back when an enum field carries an unknown member', () => {
      const ws = makeWorkspace({
        [SKILL_LANE_KEYS.synthesis.structuredOutput]: 'yes-please',
        [SKILL_LANE_KEYS.synthesis.toolUse]: 'maybe',
        [SKILL_LANE_KEYS.synthesis.defaultTier]: 'gigantic',
      });
      const cfg = readSkillLane(ws, 'synthesis');
      expect(cfg.structuredOutput).toBe('sdk');
      expect(cfg.toolUse).toBe('none');
      expect(cfg.defaultTier).toBe('haiku');
    });
  });
});

describe('readSkillLanes', () => {
  it('returns all four lanes keyed by id', () => {
    const lanes = readSkillLanes(makeWorkspace());
    expect(Object.keys(lanes).sort()).toEqual([...SKILL_LANE_IDS].sort());
  });
});

describe('flattenSkillLanes', () => {
  it('turns a sparse patch into dotted key/value pairs', () => {
    expect(
      flattenSkillLanes({ judge: { provider: 'x', timeoutMs: 1_000 } }),
    ).toEqual([
      [SKILL_LANE_KEYS.judge.provider, 'x'],
      [SKILL_LANE_KEYS.judge.timeoutMs, 1_000],
    ]);
  });

  it('skips undefined so a partial write never blanks a stored value', () => {
    expect(
      flattenSkillLanes({ judge: { provider: 'x', model: undefined } }),
    ).toEqual([[SKILL_LANE_KEYS.judge.provider, 'x']]);
  });

  it('writes the empty string, which MEANS "inherit" and is not the same as absent', () => {
    expect(flattenSkillLanes({ judge: { provider: '' } })).toEqual([
      [SKILL_LANE_KEYS.judge.provider, ''],
    ]);
  });

  it('returns nothing for an empty patch', () => {
    expect(flattenSkillLanes({})).toEqual([]);
    expect(flattenSkillLanes({ judge: {} })).toEqual([]);
  });

  it('drops unknown lanes and unknown fields rather than persisting them', () => {
    const patch = {
      notALane: { provider: 'x' },
      judge: { provider: 'y', notAField: 'z' },
    } as unknown as Parameters<typeof flattenSkillLanes>[0];
    expect(flattenSkillLanes(patch)).toEqual([
      [SKILL_LANE_KEYS.judge.provider, 'y'],
    ]);
  });

  it('round-trips through readSkillLane', () => {
    const pairs = flattenSkillLanes({
      archaeologist: { provider: 'p', model: 'm', maxPasses: 7 },
    });
    const ws = makeWorkspace(Object.fromEntries(pairs));
    const cfg = readSkillLane(ws, 'archaeologist');
    expect(cfg.provider).toBe('p');
    expect(cfg.model).toBe('m');
    expect(cfg.maxPasses).toBe(7);
  });
});

describe('lane id union', () => {
  it('lists exactly the four stages that call an LLM', () => {
    const expected: SkillLaneId[] = [
      'archaeologist',
      'synthesis',
      'judge',
      'replay',
    ];
    expect([...SKILL_LANE_IDS]).toEqual(expected);
  });
});
