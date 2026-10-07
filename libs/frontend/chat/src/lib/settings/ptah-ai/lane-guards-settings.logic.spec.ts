import {
  LANE_GUARD_DEFAULTS,
  laneGuardFieldError,
  laneGuardFromConfig,
  laneGuardKeyInError,
  laneGuardPairError,
  laneGuardWrite,
  parseLaneGuardInteger,
  type LaneGuardKey,
} from './lane-guards-settings.logic';

const saved = { ...LANE_GUARD_DEFAULTS };

function drafts(
  overrides: Partial<Record<LaneGuardKey, string>> = {},
): Record<LaneGuardKey, string> {
  return {
    laneToolCallSteerAt: '40',
    laneToolCallStopAt: '60',
    laneRepeatCallStopAt: '20',
    ...overrides,
  };
}

describe('lane guard settings logic', () => {
  it('accepts a whole number at or above the field minimum', () => {
    expect(parseLaneGuardInteger('1', 1)).toEqual({ ok: true, value: 1 });
    expect(parseLaneGuardInteger(' 2_0 ', 2)).toEqual({ ok: true, value: 20 });
    expect(parseLaneGuardInteger('', 1)).toEqual({
      ok: false,
      error: 'Enter a value.',
    });
    expect(parseLaneGuardInteger('1.5', 1).ok).toBe(false);
    expect(parseLaneGuardInteger('0', 1).ok).toBe(false);
    expect(parseLaneGuardInteger('-3', 1).ok).toBe(false);
  });

  it('rejects a stop that is not greater than steer', () => {
    expect(laneGuardPairError(40, 60)).toBeNull();
    expect(laneGuardPairError(40, 40)).toBe(
      'Stop at must be greater than Steer at.',
    );
    expect(laneGuardPairError(70, 60)).toBe(
      'Stop at must be greater than Steer at.',
    );
    expect(
      laneGuardFieldError(
        'laneToolCallStopAt',
        drafts({ laneToolCallStopAt: '40' }),
      ),
    ).toBe('Stop at must be greater than Steer at.');
  });

  it('does not write an invalid pair and writes a valid changed pair together', () => {
    expect(
      laneGuardWrite(
        'laneToolCallSteerAt',
        drafts({ laneToolCallSteerAt: '70' }),
        saved,
      ),
    ).toBeNull();
    expect(
      laneGuardWrite(
        'laneToolCallStopAt',
        drafts({ laneToolCallSteerAt: '10', laneToolCallStopAt: '15' }),
        saved,
      ),
    ).toEqual({ laneToolCallSteerAt: 10, laneToolCallStopAt: 15 });
    expect(
      laneGuardWrite(
        'laneRepeatCallStopAt',
        drafts({ laneRepeatCallStopAt: '4' }),
        saved,
      ),
    ).toEqual({ laneRepeatCallStopAt: 4 });
    expect(laneGuardWrite('laneRepeatCallStopAt', drafts(), saved)).toBeNull();
  });

  it('reads a host value and falls back to the default when it is out of range', () => {
    expect(laneGuardFromConfig('laneToolCallSteerAt', 12)).toBe(12);
    expect(laneGuardFromConfig('laneToolCallSteerAt', 0)).toBe(40);
    expect(laneGuardFromConfig('laneToolCallStopAt', undefined)).toBe(60);
    expect(laneGuardFromConfig('laneRepeatCallStopAt', 1.5)).toBe(20);
  });

  it('names the field inside a host rejection', () => {
    expect(laneGuardKeyInError('Unsupported laneToolCallStopAt value')).toBe(
      'laneToolCallStopAt',
    );
    expect(laneGuardKeyInError('host offline')).toBeNull();
  });
});
