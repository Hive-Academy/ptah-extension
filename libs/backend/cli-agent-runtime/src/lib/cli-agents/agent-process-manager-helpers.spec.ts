import {
  BUFFER_LOW_WATER_SIZE,
  MAX_BUFFER_SIZE,
  trimBufferToLowWater,
} from './agent-process-manager-helpers';

describe('trimBufferToLowWater', () => {
  it('does not leave a lone surrogate when the no-newline cut splits a pair', () => {
    const prefix = 'x'.repeat(MAX_BUFFER_SIZE - BUFFER_LOW_WATER_SIZE);
    const tail = `${'y'.repeat(BUFFER_LOW_WATER_SIZE - 3)}\u{1f680}`;
    const result = trimBufferToLowWater(`${prefix}\u{1f600}${tail}`);

    expect(result.trimmed).toBe(true);
    expect(result.buffer).toBe(tail);
    let sawSurrogatePair = false;
    for (const character of result.buffer) {
      const codeUnit = character.charCodeAt(0);
      if (codeUnit >= 0xd800 && codeUnit <= 0xdfff) {
        sawSurrogatePair = true;
        expect(character).toHaveLength(2);
      }
    }
    expect(sawSurrogatePair).toBe(true);
  });

  it('continues to cut at the next newline boundary', () => {
    const cutFrom = MAX_BUFFER_SIZE - BUFFER_LOW_WATER_SIZE + 1;
    const prefix = `first\n${'x'.repeat(cutFrom - 'first\n'.length)}`;
    const boundaryLine = 'partial\n';
    const tail = 'y'.repeat(BUFFER_LOW_WATER_SIZE - boundaryLine.length);
    const result = trimBufferToLowWater(`${prefix}${boundaryLine}${tail}`);

    expect(result).toEqual({
      buffer: tail,
      linesDropped: 2,
      trimmed: true,
    });
  });
});
