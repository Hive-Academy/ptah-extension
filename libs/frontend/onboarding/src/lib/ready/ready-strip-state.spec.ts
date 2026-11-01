import { readyStripSettingsWord } from './ready-strip-state';

const EARLY = '2026-10-01T10:00:00.000Z';
const LATE = '2026-10-02T10:00:00.000Z';

describe('readyStripSettingsWord', () => {
  it.each([
    ['no flag', undefined, true, 'next'],
    ['empty flag', {}, true, 'next'],
    ['settingsAt only', { settingsAt: EARLY }, false, 'done'],
    ['settingsAt only, on Home', { settingsAt: EARLY }, true, 'done'],
    [
      'settingsAt newer than skippedAt',
      { settingsAt: LATE, skippedAt: EARLY },
      true,
      'done',
    ],
    [
      'settingsAt equal to skippedAt',
      { settingsAt: EARLY, skippedAt: EARLY },
      true,
      'done',
    ],
    [
      'skippedAt newer, on Home',
      { settingsAt: EARLY, skippedAt: LATE },
      true,
      'skipped',
    ],
    [
      'skippedAt newer, off Home',
      { settingsAt: EARLY, skippedAt: LATE },
      false,
      'next',
    ],
    ['skippedAt only, on Home', { skippedAt: EARLY }, true, 'skipped'],
    ['skippedAt only, off Home', { skippedAt: EARLY }, false, 'next'],
    ['claudeAt only', { claudeAt: EARLY }, true, 'next'],
  ] as const)('%s', (_n, flag, onHome, word) => {
    expect(readyStripSettingsWord(flag, onHome)).toBe(word);
  });
});
