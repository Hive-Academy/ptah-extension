import type { Page } from '@playwright/test';
import type { Director } from './director';

export type ConfigSurfaceId = 'thoth' | 'setup-hub' | 'marketplace' | 'settings';

const TRIGGER = '[data-test="config-menu-trigger"]';
const ITEMS = '[data-test^="config-menu-item-"]';
const SILENT_TIMEOUT = 2_000;

/** Enter a configuration surface with every required click recorded by the camera. */
export async function openConfigSurface(
  page: Page,
  director: Director,
  id: ConfigSurfaceId,
): Promise<void> {
  const item = page.locator(`[data-test="config-menu-item-${id}"]`);
  if (!(await item.isVisible())) {
    await director.click(page.locator(TRIGGER));
    await item.waitFor({ state: 'visible' });
  }
  await director.click(item);
}

/** Raw, guarded menu opening; an already open menu is left open. */
async function openMenuSilently(page: Page): Promise<boolean> {
  try {
    const item = page.locator(ITEMS).first();
    if (await item.isVisible()) return true;
    const trigger = page.locator(TRIGGER);
    if (!(await trigger.isVisible())) return false;
    await trigger.click({ timeout: SILENT_TIMEOUT });
    await item.waitFor({ state: 'visible', timeout: SILENT_TIMEOUT });
    return true;
  } catch {
    return false;
  }
}

/** Escape from a visible menu item so cleanup also works if focus moved. */
async function closeMenuSilently(page: Page): Promise<void> {
  const item = page.locator(ITEMS).first();
  if (await item.isVisible().catch(() => false)) {
    await item.press('Escape', { timeout: SILENT_TIMEOUT }).catch(() => undefined);
  }
}

/** Navigate only: raw, visibility-guarded actions that never fail pre-warm. */
export async function openConfigSurfaceSilently(
  page: Page,
  id: ConfigSurfaceId,
): Promise<boolean> {
  try {
    const item = page.locator(`[data-test="config-menu-item-${id}"]`);
    if (!(await item.isVisible())) {
      if (!(await openMenuSilently(page))) return false;
      await item.waitFor({ state: 'visible', timeout: SILENT_TIMEOUT });
    }
    if (!(await item.isVisible())) return false;
    await item.click({ timeout: SILENT_TIMEOUT });
    return true;
  } catch {
    return false;
  } finally {
    await closeMenuSilently(page);
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
    if (!(await openMenuSilently(page))) return null;
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
  } finally {
    await closeMenuSilently(page);
  }
}
