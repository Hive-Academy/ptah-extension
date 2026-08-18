/**
 * Tray service — R10 and the pause checkbox (TASK_2026_180, B5.1.1 / B5.1.3).
 *
 * The load-bearing group is "R10 — the quit item". Suppressing
 * `window-all-closed` without a working quit leaves an unkillable background
 * process, so every path that produces a menu is asserted to carry a usable
 * "Quit Ptah" item, and the guard that refuses to go live without one is
 * asserted directly.
 */

import type { MenuItem, MenuItemConstructorOptions } from 'electron';

/**
 * `apps/ptah-electron/__mocks__/electron.ts` has no `Tray` (there was no tray
 * in the app before this batch) and its `Menu` discards the template. Both are
 * replaced here, per that file's own header. Everything is created inside the
 * factory because `jest.mock` is hoisted above the module body — referencing an
 * outer `class` from the factory would hit its TDZ.
 */
jest.mock('electron', () => {
  /** Constructing a tray with this path throws, standing in for a real failure. */
  const FAILING_ICON_PATH = '/does/not/exist/tray-icon.png';

  interface BuiltMenu {
    readonly template: readonly MenuItemConstructorOptions[];
  }

  class MockTray {
    contextMenu: BuiltMenu | null = null;
    tooltip: string | null = null;
    private destroyed = false;

    constructor(public readonly iconPath: string) {
      if (iconPath === FAILING_ICON_PATH) {
        throw new Error('Failed to load image from path');
      }
      instances.push(this);
    }

    setContextMenu(menu: BuiltMenu | null): void {
      this.contextMenu = menu;
    }
    setToolTip(tooltip: string): void {
      this.tooltip = tooltip;
    }
    isDestroyed(): boolean {
      return this.destroyed;
    }
    destroy(): void {
      this.destroyed = true;
    }
  }

  const instances: MockTray[] = [];

  return {
    Tray: MockTray,
    Menu: {
      buildFromTemplate: jest.fn(
        (template: readonly MenuItemConstructorOptions[]): BuiltMenu => ({
          template,
        }),
      ),
      setApplicationMenu: jest.fn(),
    },
    __trayInstances: instances,
    __FAILING_ICON_PATH: FAILING_ICON_PATH,
  };
});

import * as electron from 'electron';

import {
  PtahTrayService,
  buildTrayMenuTemplate,
  assertQuitItemPresent,
  PAUSE_ITEM_LABEL,
  QUIT_ITEM_LABEL,
  TRAY_TOOLTIP,
  PTAH_CONFIG_SECTION,
  SKILL_SYNTHESIS_ENABLED_KEY,
  TRAY_KEEPALIVE_KEY,
  TRAY_SETTINGS_KEYS,
  ROUTED_FILE_SETTINGS_KEYS,
  type TrayServiceOptions,
} from './tray.service';

// ---------------------------------------------------------------------------
// Mock accessors + helpers
// ---------------------------------------------------------------------------

interface MockTrayShape {
  readonly iconPath: string;
  contextMenu: {
    readonly template: readonly MenuItemConstructorOptions[];
  } | null;
  tooltip: string | null;
  isDestroyed(): boolean;
  destroy(): void;
}

const electronMock = electron as unknown as {
  Menu: { buildFromTemplate: jest.Mock };
  __trayInstances: MockTrayShape[];
  __FAILING_ICON_PATH: string;
};

const WORKING_ICON_PATH = '/app/assets/icons/png/32x32.png';

function lastTray(): MockTrayShape {
  const tray = electronMock.__trayInstances.at(-1);
  if (!tray) throw new Error('no Tray was constructed');
  return tray;
}

function mountedTemplate(): readonly MenuItemConstructorOptions[] {
  const menu = lastTray().contextMenu;
  if (!menu) throw new Error('no context menu was mounted');
  return menu.template;
}

function itemLabelled(
  template: readonly MenuItemConstructorOptions[],
  label: string,
): MenuItemConstructorOptions {
  const item = template.find((entry) => entry.label === label);
  if (!item) throw new Error(`no menu item labelled "${label}"`);
  return item;
}

/** Invoke a template item's `click`, standing in for Electron's dispatch. */
function clickItem(
  item: MenuItemConstructorOptions,
  menuItem: Partial<MenuItem> = {},
): void {
  const click = item.click as unknown as
    | ((m: Partial<MenuItem>) => void)
    | undefined;
  if (typeof click !== 'function') {
    throw new Error(`menu item "${String(item.label)}" has no click handler`);
  }
  click(menuItem);
}

interface Harness {
  readonly options: TrayServiceOptions;
  readonly getConfiguration: jest.Mock;
  readonly setConfiguration: jest.Mock;
  readonly quit: jest.Mock;
  readonly warn: jest.Mock;
}

function makeHarness(
  overrides: { enabled?: boolean; iconPath?: string } = {},
): Harness {
  // Stateful on purpose: `getConfiguration` must observe what
  // `setConfiguration` wrote, or the menu rebuild after a toggle silently
  // re-reads the ORIGINAL state and the "still has a quit item while paused"
  // assertion never reaches the paused branch it exists to cover.
  const store = new Map<string, unknown>([
    [SKILL_SYNTHESIS_ENABLED_KEY, overrides.enabled ?? true],
  ]);
  const getConfiguration = jest.fn(
    <T>(_section: string, key: string, fallback?: T): T | undefined =>
      store.has(key) ? (store.get(key) as T) : fallback,
  );
  const setConfiguration = jest
    .fn()
    .mockImplementation(
      async (_section: string, key: string, value: unknown): Promise<void> => {
        store.set(key, value);
      },
    );
  const quit = jest.fn();
  const warn = jest.fn();

  return {
    getConfiguration,
    setConfiguration,
    quit,
    warn,
    options: {
      workspace: { getConfiguration, setConfiguration },
      iconPath: overrides.iconPath ?? WORKING_ICON_PATH,
      quit,
      logger: { info: jest.fn(), warn },
    },
  };
}

beforeEach(() => {
  electronMock.__trayInstances.length = 0;
  electronMock.Menu.buildFromTemplate.mockClear();
});

// ---------------------------------------------------------------------------
// R10 — the "Quit Ptah" item is unconditional and usable
// ---------------------------------------------------------------------------

describe('R10 — the tray menu always carries a usable "Quit Ptah" item', () => {
  it.each([
    ['not paused', false],
    ['paused', true],
  ])('emits the quit item when %s', (_name, paused) => {
    const template = buildTrayMenuTemplate({
      paused,
      onTogglePause: jest.fn(),
      onQuit: jest.fn(),
    });

    const quitItem = itemLabelled(template, QUIT_ITEM_LABEL);
    expect(quitItem.enabled).toBe(true);
    expect(typeof quitItem.click).toBe('function');
  });

  it('wires the quit item to the quit callback', () => {
    const onQuit = jest.fn();
    const template = buildTrayMenuTemplate({
      paused: false,
      onTogglePause: jest.fn(),
      onQuit,
    });

    clickItem(itemLabelled(template, QUIT_ITEM_LABEL));

    expect(onQuit).toHaveBeenCalledTimes(1);
  });

  it('mounts a usable quit item on the real tray', () => {
    const harness = makeHarness();

    const service = PtahTrayService.create(harness.options);

    expect(service).not.toBeNull();
    const quitItem = itemLabelled(mountedTemplate(), QUIT_ITEM_LABEL);
    expect(quitItem.enabled).toBe(true);
    clickItem(quitItem);
    expect(harness.quit).toHaveBeenCalledTimes(1);
  });

  it('still carries a usable quit item after the pause checkbox is toggled', async () => {
    const harness = makeHarness({ enabled: true });
    PtahTrayService.create(harness.options);

    clickItem(itemLabelled(mountedTemplate(), PAUSE_ITEM_LABEL), {
      checked: true,
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(electronMock.Menu.buildFromTemplate).toHaveBeenCalledTimes(2);
    const quitItem = itemLabelled(mountedTemplate(), QUIT_ITEM_LABEL);
    expect(quitItem.enabled).toBe(true);
    clickItem(quitItem);
    expect(harness.quit).toHaveBeenCalledTimes(1);
  });

  describe('assertQuitItemPresent rejects every unusable shape', () => {
    it('throws when the quit item is absent', () => {
      expect(() =>
        assertQuitItemPresent([{ label: PAUSE_ITEM_LABEL, click: jest.fn() }]),
      ).toThrow(/no usable "Quit Ptah" item/);
    });

    it('throws when the quit item is disabled', () => {
      expect(() =>
        assertQuitItemPresent([
          { label: QUIT_ITEM_LABEL, enabled: false, click: jest.fn() },
        ]),
      ).toThrow(/no usable "Quit Ptah" item/);
    });

    it('throws when the quit item has no click handler', () => {
      expect(() =>
        assertQuitItemPresent([{ label: QUIT_ITEM_LABEL, enabled: true }]),
      ).toThrow(/no usable "Quit Ptah" item/);
    });

    it('accepts the template the service actually builds', () => {
      expect(() =>
        assertQuitItemPresent(
          buildTrayMenuTemplate({
            paused: false,
            onTogglePause: jest.fn(),
            onQuit: jest.fn(),
          }),
        ),
      ).not.toThrow();
    });
  });

  it('degrades to no tray — never to a tray without a quit — when construction fails', () => {
    const harness = makeHarness({ iconPath: electronMock.__FAILING_ICON_PATH });

    const service = PtahTrayService.create(harness.options);

    // `null` means `handleWindowAllClosed` sees no live tray and quits normally.
    expect(service).toBeNull();
    expect(harness.warn).toHaveBeenCalledTimes(1);
    expect(String(harness.warn.mock.calls[0][0])).toMatch(/R10 fail-safe/);
  });

  it('reports itself as not live once destroyed, releasing the quit suppression', () => {
    const service = PtahTrayService.create(makeHarness().options);
    expect(service?.isLive()).toBe(true);

    service?.destroy();

    expect(service?.isLive()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// B5.1.3 — the checkbox writes the master switch, and nothing else
// ---------------------------------------------------------------------------

describe('"Pause background learning" toggles skillSynthesis.enabled', () => {
  it('renders as a checkbox with the agreed label', () => {
    PtahTrayService.create(makeHarness().options);

    const pauseItem = itemLabelled(mountedTemplate(), PAUSE_ITEM_LABEL);
    expect(pauseItem.type).toBe('checkbox');
  });

  it.each([
    ['unchecked while synthesis is enabled', true, false],
    ['checked while synthesis is disabled', false, true],
  ])('is %s', (_name, enabled, expectedChecked) => {
    PtahTrayService.create(makeHarness({ enabled }).options);

    expect(itemLabelled(mountedTemplate(), PAUSE_ITEM_LABEL).checked).toBe(
      expectedChecked,
    );
  });

  it('writes skillSynthesis.enabled=false when the user checks "pause"', async () => {
    const harness = makeHarness({ enabled: true });
    PtahTrayService.create(harness.options);

    clickItem(itemLabelled(mountedTemplate(), PAUSE_ITEM_LABEL), {
      checked: true,
    });
    await Promise.resolve();

    expect(harness.setConfiguration).toHaveBeenCalledWith(
      PTAH_CONFIG_SECTION,
      SKILL_SYNTHESIS_ENABLED_KEY,
      false,
    );
  });

  it('writes skillSynthesis.enabled=true when the user unchecks "pause"', async () => {
    const harness = makeHarness({ enabled: false });
    PtahTrayService.create(harness.options);

    clickItem(itemLabelled(mountedTemplate(), PAUSE_ITEM_LABEL), {
      checked: false,
    });
    await Promise.resolve();

    expect(harness.setConfiguration).toHaveBeenCalledWith(
      PTAH_CONFIG_SECTION,
      SKILL_SYNTHESIS_ENABLED_KEY,
      true,
    );
  });

  it('introduces no second "off" concept — the master switch is the only key written', async () => {
    const harness = makeHarness({ enabled: true });
    PtahTrayService.create(harness.options);

    clickItem(itemLabelled(mountedTemplate(), PAUSE_ITEM_LABEL), {
      checked: true,
    });
    await Promise.resolve();

    expect(harness.setConfiguration).toHaveBeenCalledTimes(1);
    const writtenKeys = harness.setConfiguration.mock.calls.map(
      (call) => call[1] as string,
    );
    expect(writtenKeys).toEqual([SKILL_SYNTHESIS_ENABLED_KEY]);
    expect(writtenKeys).not.toContain('skillSynthesis.trayPaused');
  });

  it('survives a failed write, logs it, and stays live', async () => {
    const harness = makeHarness({ enabled: true });
    harness.setConfiguration.mockRejectedValue(
      new Error('settings file locked'),
    );
    const service = PtahTrayService.create(harness.options);

    clickItem(itemLabelled(mountedTemplate(), PAUSE_ITEM_LABEL), {
      checked: true,
    });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(harness.warn).toHaveBeenCalledTimes(1);
    expect(String(harness.warn.mock.calls[0][0])).toContain(
      SKILL_SYNTHESIS_ENABLED_KEY,
    );
    expect(service?.isLive()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Settings routing — an unrouted key is dropped on WRITE with no error
// ---------------------------------------------------------------------------

describe('the tray writes keys that are actually routed to the file store', () => {
  it.each(TRAY_SETTINGS_KEYS)(
    '%s is a member of FILE_BASED_SETTINGS_KEYS',
    (key) => {
      expect(ROUTED_FILE_SETTINGS_KEYS.has(key)).toBe(true);
    },
  );

  it('uses the same key strings the drain reads', () => {
    // Hardcoded here rather than imported: the app layer must not import
    // `skill-synthesis`. This asserts the strings did not drift.
    expect(SKILL_SYNTHESIS_ENABLED_KEY).toBe('skillSynthesis.enabled');
    expect(TRAY_KEEPALIVE_KEY).toBe('skillSynthesis.trayKeepalive');
  });
});

describe('tray identity', () => {
  it('sets a tooltip so the icon is identifiable', () => {
    PtahTrayService.create(makeHarness().options);

    expect(lastTray().tooltip).toBe(TRAY_TOOLTIP);
  });
});
