/**
 * Tray service — R10, the memory pause checkbox and freshness.
 *
 * The load-bearing group is "R10 — the quit item". Suppressing
 * Every path that produces a menu is asserted to carry a usable
 * "Quit Ptah" item, and the guard that refuses to go live without one is
 * asserted directly.
 */

import type { MenuItem, MenuItemConstructorOptions } from 'electron';

/**
 * `apps/ptah-electron/__mocks__/electron.ts` has no `Tray` and its `Menu`
 * discards the template. Both are replaced here, per that file's own header.
 * Everything is created inside the factory because `jest.mock` is hoisted above
 * the module body — referencing an outer `class` from the factory would hit its
 * TDZ.
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
    readonly listeners = new Map<string, Array<() => void>>();
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
    on(event: string, listener: () => void): this {
      const list = this.listeners.get(event) ?? [];
      list.push(listener);
      this.listeners.set(event, list);
      return this;
    }
    emit(event: string): void {
      if (this.destroyed) return;
      for (const listener of this.listeners.get(event) ?? []) listener();
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
  trayTooltip,
  PAUSE_MEMORY_ITEM_LABEL,
  QUIT_ITEM_LABEL,
  TRAY_TOOLTIP,
  PTAH_CONFIG_SECTION,
  MEMORY_ENABLED_KEY,
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
  readonly listeners: Map<string, Array<() => void>>;
  emit(event: string): void;
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
    ((m: Partial<MenuItem>) => void) | undefined;
  if (typeof click !== 'function') {
    throw new Error(`menu item "${String(item.label)}" has no click handler`);
  }
  click(menuItem);
}

async function flushMicrotasks(turns = 5): Promise<void> {
  for (let i = 0; i < turns; i += 1) {
    await Promise.resolve();
  }
}

interface Harness {
  readonly options: TrayServiceOptions;
  readonly store: Map<string, unknown>;
  readonly getConfiguration: jest.Mock;
  readonly setConfiguration: jest.Mock;
  readonly watchSetting: jest.Mock;
  readonly quit: jest.Mock;
  readonly info: jest.Mock;
  readonly warn: jest.Mock;
  readonly subscriptionDispose: jest.Mock;
  /**
   * Fire the file-settings watcher for `key`, as `PtahFileSettingsManager`
   * does after its own `set()` and after a cross-process `fs.watch` diff.
   */
  fireChange(key: string): void;
  /** Another process edited ~/.ptah/settings.json: value lands, watcher fires. */
  externalEdit(key: string, value: unknown): void;
  watcherCount(): number;
}

function makeHarness(
  overrides: {
    memoryEnabled?: boolean;
    iconPath?: string;
  } = {},
): Harness {
  // Stateful on purpose: `getConfiguration` must observe what
  // `setConfiguration` wrote, or the menu rebuild after a toggle silently
  // re-reads the ORIGINAL state.
  const store = new Map<string, unknown>([
    [MEMORY_ENABLED_KEY, overrides.memoryEnabled ?? true],
  ]);
  const watchers = new Map<string, Set<() => void>>();
  const subscriptionDispose = jest.fn();

  const fireChange = (key: string): void => {
    for (const watcher of [...(watchers.get(key) ?? [])]) watcher();
  };

  const getConfiguration = jest.fn(
    <T>(_section: string, key: string, fallback?: T): T | undefined =>
      store.has(key) ? (store.get(key) as T) : fallback,
  );
  const setConfiguration = jest
    .fn()
    .mockImplementation(
      async (_section: string, key: string, value: unknown): Promise<void> => {
        store.set(key, value);
        fireChange(key);
      },
    );
  const watchSetting = jest.fn((key: string, onChange: () => void) => {
    const set = watchers.get(key) ?? new Set<() => void>();
    set.add(onChange);
    watchers.set(key, set);
    return {
      dispose: () => {
        subscriptionDispose();
        watchers.get(key)?.delete(onChange);
      },
    };
  });
  const quit = jest.fn();
  const info = jest.fn();
  const warn = jest.fn();

  return {
    store,
    getConfiguration,
    setConfiguration,
    watchSetting,
    quit,
    info,
    warn,
    subscriptionDispose,
    fireChange,
    externalEdit: (key, value) => {
      store.set(key, value);
      fireChange(key);
    },
    watcherCount: () =>
      [...watchers.values()].reduce((total, set) => total + set.size, 0),
    options: {
      workspace: { getConfiguration, setConfiguration },
      watchSetting,
      iconPath: overrides.iconPath ?? WORKING_ICON_PATH,
      quit,
      logger: { info, warn },
    },
  };
}

beforeEach(() => {
  electronMock.__trayInstances.length = 0;
  electronMock.Menu.buildFromTemplate.mockClear();
});

const noopTemplateOptions = {
  memoryPaused: false,
  onTogglePause: jest.fn(),
  onQuit: jest.fn(),
};

// ---------------------------------------------------------------------------
// R10 — the "Quit Ptah" item is unconditional and usable
// ---------------------------------------------------------------------------

describe('R10 — the tray menu always carries a usable "Quit Ptah" item', () => {
  it.each([false, true])(
    'emits the quit item when memoryPaused=%s',
    (memoryPaused) => {
      const template = buildTrayMenuTemplate({
        ...noopTemplateOptions,
        memoryPaused,
      });

      const quitItem = itemLabelled(template, QUIT_ITEM_LABEL);
      expect(quitItem.enabled).toBe(true);
      expect(typeof quitItem.click).toBe('function');
    },
  );

  it('wires the quit item to the quit callback', () => {
    const onQuit = jest.fn();
    const template = buildTrayMenuTemplate({ ...noopTemplateOptions, onQuit });

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

  it('still carries a usable quit item after memory is toggled', async () => {
    const harness = makeHarness();
    PtahTrayService.create(harness.options);

    clickItem(itemLabelled(mountedTemplate(), PAUSE_MEMORY_ITEM_LABEL), {
      checked: true,
    });
    await flushMicrotasks();

    expect(
      electronMock.Menu.buildFromTemplate.mock.calls.length,
    ).toBeGreaterThanOrEqual(2);
    const quitItem = itemLabelled(mountedTemplate(), QUIT_ITEM_LABEL);
    expect(quitItem.enabled).toBe(true);
    clickItem(quitItem);
    expect(harness.quit).toHaveBeenCalledTimes(1);
  });

  describe('assertQuitItemPresent rejects every unusable shape', () => {
    it('throws when the quit item is absent', () => {
      expect(() =>
        assertQuitItemPresent([
          { label: PAUSE_MEMORY_ITEM_LABEL, click: jest.fn() },
        ]),
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
        assertQuitItemPresent(buildTrayMenuTemplate(noopTemplateOptions)),
      ).not.toThrow();
    });
  });

  it('degrades to no tray — never to a tray without a quit — when construction fails', () => {
    const harness = makeHarness({ iconPath: electronMock.__FAILING_ICON_PATH });

    const service = PtahTrayService.create(harness.options);

    // Tray construction failure leaves last-window quit behavior intact.
    expect(service).toBeNull();
    expect(harness.warn).toHaveBeenCalledTimes(1);
    expect(String(harness.warn.mock.calls[0][0])).toMatch(/R10 fail-safe/);
  });

  it('reports itself as not live once destroyed', () => {
    const service = PtahTrayService.create(makeHarness().options);
    expect(service?.isLive()).toBe(true);

    service?.destroy();

    expect(service?.isLive()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The memory pause checkbox writes its master switch
// ---------------------------------------------------------------------------

describe('"Pause memory" checkbox', () => {
  it('renders before the separator and the quit item', () => {
    PtahTrayService.create(makeHarness().options);

    const template = mountedTemplate();
    expect(template.map((item) => item.label ?? item.type)).toEqual([
      PAUSE_MEMORY_ITEM_LABEL,
      'separator',
      QUIT_ITEM_LABEL,
    ]);
    expect(itemLabelled(template, PAUSE_MEMORY_ITEM_LABEL).type).toBe(
      'checkbox',
    );
  });

  it.each([[true, false], [false, true]])(
    'renders memory.enabled=%s as checked=%s',
    (memoryEnabled, memoryChecked) => {
      PtahTrayService.create(makeHarness({ memoryEnabled }).options);

      const template = mountedTemplate();
      expect(itemLabelled(template, PAUSE_MEMORY_ITEM_LABEL).checked).toBe(
        memoryChecked,
      );
    },
  );

  it.each<[string, string, boolean, boolean]>([
    [PAUSE_MEMORY_ITEM_LABEL, MEMORY_ENABLED_KEY, true, false],
    [PAUSE_MEMORY_ITEM_LABEL, MEMORY_ENABLED_KEY, false, true],
  ])(
    '"%s" writes ONLY %s (checked=%s → value %s)',
    async (label, key, checked, expectedValue) => {
      const harness = makeHarness({
        memoryEnabled: checked,
      });
      PtahTrayService.create(harness.options);

      clickItem(itemLabelled(mountedTemplate(), label), { checked });
      await flushMicrotasks();

      // One write, one key: no trigger sub-switch, no second "off" concept.
      expect(harness.setConfiguration).toHaveBeenCalledTimes(1);
      expect(harness.setConfiguration).toHaveBeenCalledWith(
        PTAH_CONFIG_SECTION,
        key,
        expectedValue,
      );
    },
  );

  it('survives a failed write, logs it, stays live, and reverts the checkbox', async () => {
    const harness = makeHarness({ memoryEnabled: true });
    harness.setConfiguration.mockRejectedValue(
      new Error('settings file locked'),
    );
    const service = PtahTrayService.create(harness.options);

    clickItem(itemLabelled(mountedTemplate(), PAUSE_MEMORY_ITEM_LABEL), {
      checked: true,
    });
    await flushMicrotasks();

    expect(harness.warn).toHaveBeenCalledTimes(1);
    expect(String(harness.warn.mock.calls[0][0])).toContain(MEMORY_ENABLED_KEY);
    expect(service?.isLive()).toBe(true);
    // Rebuilt from the unchanged persisted value, even though it equals the
    // state the previous menu was built from.
    expect(electronMock.Menu.buildFromTemplate).toHaveBeenCalledTimes(2);
    expect(
      itemLabelled(mountedTemplate(), PAUSE_MEMORY_ITEM_LABEL).checked,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Freshness — file-settings watcher (in-process AND external), refresh on
// open, intent-based clicks on a stale menu, subscription disposal
// ---------------------------------------------------------------------------

describe('the menu stays current with the persisted switch', () => {
  it('subscribes to the memory key through the file-settings watcher', () => {
    const harness = makeHarness();
    PtahTrayService.create(harness.options);

    const watchedKeys = harness.watchSetting.mock.calls.map(
      (call) => call[0] as string,
    );
    expect(watchedKeys).toEqual([MEMORY_ENABLED_KEY]);
  });

  it('refreshes the checkbox and tooltip on an EXTERNAL edit of settings.json (no tray event needed)', () => {
    const harness = makeHarness();
    PtahTrayService.create(harness.options);

    // Another process (a second Ptah, the CLI, a hand edit) paused memory. The
    // cross-process fs.watch diff fires the watcher; no tray event fires —
    // which is the Linux AppIndicator case.
    harness.externalEdit(MEMORY_ENABLED_KEY, false);

    expect(
      itemLabelled(mountedTemplate(), PAUSE_MEMORY_ITEM_LABEL).checked,
    ).toBe(true);
    expect(lastTray().tooltip).toBe(`${TRAY_TOOLTIP} — memory paused`);

  });

  it('refreshes when another surface writes a switch in-process', async () => {
    const harness = makeHarness({ memoryEnabled: false });
    PtahTrayService.create(harness.options);

    // Another surface writes through the same provider.
    await harness.options.workspace.setConfiguration(
      PTAH_CONFIG_SECTION,
      MEMORY_ENABLED_KEY,
      true,
    );

    expect(
      itemLabelled(mountedTemplate(), PAUSE_MEMORY_ITEM_LABEL).checked,
    ).toBe(false);
    expect(lastTray().tooltip).toBe(TRAY_TOOLTIP);
  });

  it.each(['mouse-enter', 'click', 'right-click'])(
    'backstop: picks up a value changed with no watcher callback on "%s"',
    (event) => {
      const harness = makeHarness();
      PtahTrayService.create(harness.options);

      // The watcher was lost (PtahFileSettingsManager gave up after retries).
      harness.store.set(MEMORY_ENABLED_KEY, false);
      lastTray().emit(event);

      expect(
        itemLabelled(mountedTemplate(), PAUSE_MEMORY_ITEM_LABEL).checked,
      ).toBe(true);
      expect(lastTray().tooltip).toBe(`${TRAY_TOOLTIP} — memory paused`);
    },
  );

  it('does not rebuild on open when nothing changed', () => {
    PtahTrayService.create(makeHarness().options);

    lastTray().emit('mouse-enter');
    lastTray().emit('right-click');

    expect(electronMock.Menu.buildFromTemplate).toHaveBeenCalledTimes(1);
  });

  it.each<[string, string, boolean]>([
    [PAUSE_MEMORY_ITEM_LABEL, MEMORY_ENABLED_KEY, true],
    [PAUSE_MEMORY_ITEM_LABEL, MEMORY_ENABLED_KEY, false],
  ])(
    'a click on a STALE "%s" writes the clicked intent, not a toggle of the file value',
    async (label, key, checkedAfterClick) => {
      // The menu is built from the initial state...
      const harness = makeHarness({
        memoryEnabled: !checkedAfterClick,
      });
      PtahTrayService.create(harness.options);
      // ...then the file changes with NO watcher callback, so the menu is stale.
      harness.store.set(MEMORY_ENABLED_KEY, checkedAfterClick);

      // Electron flips the stale checkbox and reports the NEW checked state.
      clickItem(itemLabelled(mountedTemplate(), label), {
        checked: checkedAfterClick,
      });
      await flushMicrotasks();

      // paused = checked ⇒ enabled = !checked. A toggle of the file value would
      // have written the opposite.
      expect(harness.setConfiguration).toHaveBeenCalledTimes(1);
      expect(harness.setConfiguration).toHaveBeenCalledWith(
        PTAH_CONFIG_SECTION,
        key,
        !checkedAfterClick,
      );
      // Re-read and rebuilt after the write.
      expect(itemLabelled(mountedTemplate(), label).checked).toBe(
        checkedAfterClick,
      );
    },
  );

  it('disposes the watcher subscription on destroy', () => {
    const harness = makeHarness();
    const service = PtahTrayService.create(harness.options);
    expect(harness.watcherCount()).toBe(1);

    service?.destroy();

    expect(harness.subscriptionDispose).toHaveBeenCalledTimes(1);
    expect(harness.watcherCount()).toBe(0);
    harness.externalEdit(MEMORY_ENABLED_KEY, false);
    expect(electronMock.Menu.buildFromTemplate).toHaveBeenCalledTimes(1);
  });

  it('destroys the tray when watcher registration throws', () => {
    const harness = makeHarness();
    harness.watchSetting.mockImplementation(() => {
      throw new Error('watch failed');
    });

    const service = PtahTrayService.create(harness.options);

    expect(service).toBeNull();
    expect(harness.subscriptionDispose).not.toHaveBeenCalled();
    expect(lastTray().isDestroyed()).toBe(true);
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

  it('uses the memory master key', () => {
    expect(MEMORY_ENABLED_KEY).toBe('memory.enabled');
  });
});

// ---------------------------------------------------------------------------
// Tooltip — identifies the icon and names the paused switch
// ---------------------------------------------------------------------------

describe('tray tooltip', () => {
  it.each([
    [false, 'Ptah'],
    [true, 'Ptah — memory paused'],
  ])(
    'memoryPaused=%s → "%s"',
    (memoryPaused, expected) => {
      expect(trayTooltip({ memoryPaused })).toBe(expected);
    },
  );

  it('is set on the tray at creation from the persisted state', () => {
    PtahTrayService.create(
      makeHarness({ memoryEnabled: false }).options,
    );

    expect(lastTray().tooltip).toBe('Ptah — memory paused');
  });

  it('follows a toggle from the tray itself', async () => {
    const harness = makeHarness();
    PtahTrayService.create(harness.options);
    expect(lastTray().tooltip).toBe(TRAY_TOOLTIP);

    clickItem(itemLabelled(mountedTemplate(), PAUSE_MEMORY_ITEM_LABEL), {
      checked: true,
    });
    await flushMicrotasks();

    expect(lastTray().tooltip).toBe('Ptah — memory paused');
  });
});
