import { segmentPtahUi } from '@ptah-extension/shared/mcp-apps-contracts/surface';
import {
  hasPtahUiDisplayFenceLine,
  hasPtahUiFenceLine,
} from './ptah-ui-fence-line';

const BODY = 'stats\n  stat "Tests" 1\n';

describe('hasPtahUiFenceLine', () => {
  it.each([
    ['```ptah-ui\n', true],
    ['```ptah-ui display\n', true],
    ['```ptah-ui display release\n', true],
    ['intro\n```ptah-ui display release   \r\nbody', true],
    ['intro\n```ptah-ui display', true],
    ['```ptah-ui displayed\n', false],
    ['```ptah-ui display two words\n', false],
    ['  ```ptah-ui display x\n', false],
    ['```ptah-ui x\n', false],
  ])('%j -> %s', (input, expected) => {
    expect(hasPtahUiFenceLine(input)).toBe(expected);
  });
});

describe('hasPtahUiDisplayFenceLine', () => {
  it.each([
    ['```ptah-ui display\n', true],
    ['```ptah-ui display release\n', true],
    ['```ptah-ui display v1.2_rc-3\n', true],
    ['intro\n```ptah-ui display release  \r\nbody', true],
    ['intro\n```ptah-ui display   ', true],
    ['```ptah-ui display\r', true],
    ['```ptah-ui\n```\n\n```ptah-ui display\n', true],
    // Inline openers are not display openers.
    ['```ptah-ui\n', false],
    ['```ptah-ui   \r\nbody', false],
    // Not an opener the segmenter accepts.
    ['```ptah-ui displayed\n', false],
    ['```ptah-ui  display\n', false],
    ['```ptah-ui display  release\n', false],
    ['```ptah-ui display two words\n', false],
    ['```ptah-ui display\r \n', false],
    ['  ```ptah-ui display\n', false],
    ['```ptah-ui-x display\n', false],
    ['text ```ptah-ui display\n', false],
    ['<ptah-ui-block raw="```ptah-ui display"></ptah-ui-block>', false],
    ['', false],
  ])('%j -> %s', (input, expected) => {
    expect(hasPtahUiDisplayFenceLine(input)).toBe(expected);
  });

  /**
   * The gate is a superset of the segmenter's display fences (decision #26:
   * a display fence is a segment with `target === 'display'`): every text in
   * which `segmentPtahUi` finds one passes, and a text with inline fences only
   * does not.
   */
  it.each([
    '```ptah-ui display\n' + BODY + '```\n',
    '```ptah-ui display release\n' + BODY + '```\n',
    'Intro.\r\n\r\n```ptah-ui display release  \r\n' + BODY + '```\r\n',
    '```ptah-ui\n' +
      BODY +
      '```\n\nThen:\n```ptah-ui display a.b-c_1\n' +
      BODY +
      '```',
  ])('passes every text the segmenter finds a display fence in: %j', (text) => {
    const displayFences = segmentPtahUi(text).filter(
      (segment) => segment.kind === 'fence' && segment.target === 'display',
    );
    expect(displayFences.length).toBeGreaterThan(0);
    expect(hasPtahUiDisplayFenceLine(text)).toBe(true);
  });

  it('rejects a text whose only fences are inline (absent target)', () => {
    const text = '```ptah-ui\n' + BODY + '```\n\n```ptah-ui\n' + BODY + '```\n';
    const fences = segmentPtahUi(text).filter(
      (segment) => segment.kind === 'fence',
    );
    expect(fences).toHaveLength(2);
    expect(
      fences.every((segment) => segment.kind === 'fence' && !segment.target),
    ).toBe(true);
    expect(hasPtahUiDisplayFenceLine(text)).toBe(false);
  });
});
