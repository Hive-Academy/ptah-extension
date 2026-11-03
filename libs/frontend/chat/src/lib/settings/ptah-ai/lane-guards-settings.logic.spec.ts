import {
  LANE_GUARD_DEFAULTS,
  LANE_GUARD_FIELDS,
  LANE_GUARD_KEYS,
  laneGuardFieldError,
  laneGuardFromConfig,
  laneGuardKeyInError,
  laneGuardWrite,
  parseLaneGuardInteger,
  type LaneGuardKey,
} from './lane-guards-settings.logic';

const saved = { ...LANE_GUARD_DEFAULTS };

function drafts(
  overrides: Partial<Record<LaneGuardKey, string>> = {},
): Record<LaneGuardKey, string> {
  return {
    laneRepeatCallStopAt: '20',
    ...overrides,
  };
}

describe('lane guard settings logic', () => {
  it('has only the repeat-call field, defaulting to 20', () => {
    expect(LANE_GUARD_KEYS).toEqual(['laneRepeatCallStopAt']);
    expect(LANE_GUARD_FIELDS.map((field) => field.key)).toEqual([
      'laneRepeatCallStopAt',
    ]);
    expect(LANE_GUARD_DEFAULTS).toEqual({ laneRepeatCallStopAt: 20 });
  });

  it('accepts a whole number at or above the field minimum', () => {
    expect(parseLaneGuardInteger('2', 2)).toEqual({ ok: true, value: 2 });
    expect(parseLaneGuardInteger(' 2_0 ', 2)).toEqual({ ok: true, value: 20 });
    expect(parseLaneGuardInteger('', 2)).toEqual({
      ok: false,
      error: 'Enter a value.',
    });
    expect(parseLaneGuardInteger('1.5', 2).ok).toBe(false);
    expect(parseLaneGuardInteger('1', 2).ok).toBe(false);
    expect(parseLaneGuardInteger('-3', 2).ok).toBe(false);
  });

  it('reports a field error below the repeat minimum', () => {
    expect(
      laneGuardFieldError(
        'laneRepeatCallStopAt',
        drafts({ laneRepeatCallStopAt: '1' }),
      ),
    ).toBe('Enter a whole number from 2.');
    expect(laneGuardFieldError('laneRepeatCallStopAt', drafts())).toBeNull();
  });

  it('writes a valid changed value and nothing for an invalid or unchanged one', () => {
    expect(
      laneGuardWrite(
        'laneRepeatCallStopAt',
        drafts({ laneRepeatCallStopAt: '4' }),
        saved,
      ),
    ).toEqual({ laneRepeatCallStopAt: 4 });
    expect(laneGuardWrite('laneRepeatCallStopAt', drafts(), saved)).toBeNull();
    expect(
      laneGuardWrite(
        'laneRepeatCallStopAt',
        drafts({ laneRepeatCallStopAt: '1' }),
        saved,
      ),
    ).toBeNull();
  });

  it('reads a host value and falls back to the default when it is out of range', () => {
    expect(laneGuardFromConfig('laneRepeatCallStopAt', 12)).toBe(12);
    expect(laneGuardFromConfig('laneRepeatCallStopAt', 1)).toBe(20);
    expect(laneGuardFromConfig('laneRepeatCallStopAt', 1.5)).toBe(20);
    expect(laneGuardFromConfig('laneRepeatCallStopAt', undefined)).toBe(20);
  });

  it('names the field inside a host rejection', () => {
    expect(laneGuardKeyInError('Unsupported laneRepeatCallStopAt value')).toBe(
      'laneRepeatCallStopAt',
    );
    expect(laneGuardKeyInError('host offline')).toBeNull();
  });
});
