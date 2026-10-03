/**
 * The one Settings capture path (TASK_2026_555 Batches 36c.f/i, 51.6), shared by every settings spec that writes
 * screenshots. Before each capture:
 * - the page is settled: no `aria-busy`, spinner or loading row;
 * - the pointer moves to the page corner, so no hover state is captured (e.g. the Retry button a tab click left the
 *   pointer on, or a focused row button in the Advanced tables);
 * - animations are finished, not caught mid-flight (`animations: 'disabled'`; e.g. daisyUI's checkmark bounce on a
 *   freshly built matrix).
 *
 * Per-batch captures are `current-*`. The `baseline-*` "before" images are written only on an explicit
 * `SETTINGS_CAPTURE_BASELINE=1` run.
 */
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { waitForSettled } from './settings.fixtures';

const CAPTURE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../../../.ptah/specs/TASK_2026_555/screenshots/angular');
const CAPTURE_KIND = process.env['SETTINGS_CAPTURE_BASELINE'] === '1' ? 'baseline' : 'current';

export function capturePath(name: string, host: string, theme: string): string {
  return join(CAPTURE_DIR, `${CAPTURE_KIND}-${name}-${host}-${theme}-1024x768.png`);
}

export async function capture(page: Page, name: string, host: string, theme: string): Promise<void> {
  mkdirSync(CAPTURE_DIR, { recursive: true });
  await waitForSettled(page);
  await page.mouse.move(0, 0);
  await page.screenshot({ path: capturePath(name, host, theme), animations: 'disabled' });
}
