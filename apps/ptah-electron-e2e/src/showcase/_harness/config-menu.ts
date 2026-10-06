import type { Page } from '@playwright/test';
import type { Director } from './director';

export type ConfigSurfaceId = 'thoth' | 'setup-hub' | 'marketplace' | 'settings';

// Thoth, Marketplace and Settings are navbar icon buttons; Setup hub is a
// navbar tab with a workspace open and an icon button on the welcome screen.
// All keep the `config-menu-item-<id>` hook and are visible without opening
// anything.
const ITEMS = '[data-test^="config-menu-item-"]';
const SILENT_TIMEOUT = 2_000;

function itemFor(page: Page, id: ConfigSurfaceId) {
  return page.locator(`[data-test="config-menu-item-${id}"]`);
}

/** Enter a configuration surface with the click recorded by the camera. */
export async function openConfigSurface(
  page: Page,
  director: Director,
  id: ConfigSurfaceId,
): Promise<void> {
  const item = itemFor(page, id);
  await item.waitFor({ state: 'visible' });
  await director.click(item);
}

/** Navigate only: raw, visibility-guarded actions that never fail pre-warm. */
export async function openConfigSurfaceSilently(
  page: Page,
  id: ConfigSurfaceId,
): Promise<boolean> {
  try {
    const item = itemFor(page, id);
    if (!(await item.isVisible())) return false;
    await item.click({ timeout: SILENT_TIMEOUT });
    return true;
  } catch {
    return false;
  }
}

/**
 * Inspect the active configuration surface without navigating or camera beats.
 * Returns null both when no configuration surface is active and when detection
 * fails; callers must treat null as no captured configuration origin.
 */
export async function activeConfigSurface(
  page: Page,
): Promise<ConfigSurfaceId | null> {
  try {
    const item = page.locator(`${ITEMS}[aria-current="true"]`).first();
    if (!(await item.isVisible())) return null;
    const hook = await item.getAttribute('data-test', { timeout: SILENT_TIMEOUT });
    switch (hook) {
      case 'config-menu-item-thoth':
        return 'thoth';
      case 'config-menu-item-setup-hub':
        return 'setup-hub';
      case 'config-menu-item-marketplace':
        return 'marketplace';
      case 'config-menu-item-settings':
        return 'settings';
      default:
        return null;
    }
  } catch {
    return null;
  }
}
