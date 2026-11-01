import type { OnboardingReadyFlag } from '../first-run/onboarding-flag.service';

/** The state word of the strip's item 2 ("Providers and tools"). */
export type ReadyStripSettingsWord = 'next' | 'done' | 'skipped';

/**
 * Item 2's word (RD11): `done` when `settingsAt` is present and not older
 * than `skippedAt`; `skipped` only on Home, when `skippedAt` is present and
 * newer than `settingsAt`; otherwise `next`. ISO datetimes compare as text.
 */
export function readyStripSettingsWord(
  flag: OnboardingReadyFlag | undefined,
  onHome: boolean,
): ReadyStripSettingsWord {
  const settingsAt = flag?.settingsAt;
  const skippedAt = flag?.skippedAt;
  if (settingsAt && (!skippedAt || settingsAt >= skippedAt)) return 'done';
  if (onHome && skippedAt) return 'skipped';
  return 'next';
}
