/**
 * Tray service — R10, the two pause checkboxes, freshness and the keep-alive
 * copy (TASK_2026_180 B5.1.1 / B5.1.3; TASK_2026_620 B-P P5).
 *
 * The load-bearing group is "R10 — the quit item". Suppressing
 * `window-all-closed` without a working quit leaves an unkillable background
 * process, so every path that produces a menu is asserted to carry a usable
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

import type { ConfigurationChangeEvent } from '@ptah-extension/platform-core';

import {
  PtahTrayService,
  buildTrayMenuTemplate,
  assertQuitItemPresent,
  trayTooltip,
  PAUSE_MEMORY_ITEM_LABEL,
  PAUSE_SKILLS_ITEM_LABEL,
  QUIT_ITEM_LABEL,
  TRAY_TOOLTIP,
  PTAH_CONFIG_SECTION,
  MEMORY_ENABLED_KEY,
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
  readonly quit: jest.Mock;
  readonly info: jest.Mock;
  readonly warn: jest.Mock;
  readonly subscriptionDispose: jest.Mock;
  /** Fire `onDidChangeConfiguration` for a full `ptah.<key>` key. */
  fireChange(fullKey: string): void;
  listenerCount(): number;
}

function makeHarness(
  overrides: {
    memoryEnabled?: boolean;
    skillsEnabled?: boolean;
    keepAlive?: boolean;
    iconPath?: string;
  } = {},
): Harness {
  // Stateful on purpose: `getConfiguration` must observe what
  // `setConfiguration` wrote, or the menu rebuild after a toggle silently
  // re-reads the ORIGINAL state.
  const store = new Map<string, unknown>([
    [MEMORY_ENABLED_KEY, overrides.memoryEnabled ?? true],
    [SKILL_SYNTHESIS_ENABLED_KEY, overrides.skillsEnabled ?? true],
  ]);
  if (overrides.keepAlive !== undefined) {
    store.set(TRAY_KEEPALIVE_KEY, overrides.keepAlive);
  }
  const listeners = new Set<(e: ConfigurationChangeEvent) => void>();
  const subscriptionDispose = jest.fn();

  const fireChange = (fullKey: string): void => {
    // The real provider's matcher (`electron-workspace-provider.ts`).
    const event: ConfigurationChangeEvent = {
      affectsConfiguration: (s: string) =>
        fullKey === s ||
        fullKey.startsWith(s + '.') ||
        s.startsWith(fullKey + '.'),
    };
    for (const listener of [...listeners]) listener(event);
  };

  const getConfiguration = jest.fn(
    <T>(_section: string, key: string, fallback?: T): T | undefined =>
      store.has(key) ? (store.get(key) as T) : fallback,
  );
  const setConfiguration = jest
    .fn()
    .mockImplementation(
      async (section: string, key: string, value: unknown): Promise<void> => {
        store.set(key, value);
        fireChange(`${section}.${key}`);
      },
    );
  const onDidChangeConfiguration = jest.fn(
    (listener: (e: ConfigurationChangeEvent) => void) => {
      listeners.add(listener);
      return {
        dispose: () => {
          subscriptionDispose();
          listeners.delete(listener);
        },
      };
    },
  );
  const quit = jest.fn();
  const info = jest.fn();
  const warn = jest.fn();

  return {
    store,
    getConfiguration,
    setConfiguration,
    quit,
    info,
    warn,
    subscriptionDispose,
    fireChange,
    listenerCount: () => listeners.size,
    options: {
      workspace: {
        getConfiguration,
        setConfiguration,
        onDidChangeConfiguration,
      },
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
  skillsPaused: false,
  onTogglePause: jest.fn(),
  onQuit: jest.fn(),
};

// ---------------------------------------------------------------------------
// R10 — the "Quit Ptah" item is unconditional and usable
// ---------------------------------------------------------------------------

describe('R10 — the tray menu always carries a usable "Quit Ptah" item', () => {
  it.each([
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ])(
    'emits the quit item when memoryPaused=%s skillsPaused=%s',
    (memoryPaused, skillsPaused) => {
      const template = buildTrayMenuTemplate({
        ...noopTemplateOptions,
        memoryPaused,
        skillsPaused,
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

  it.each([PAUSE_MEMORY_ITEM_LABEL, PAUSE_SKILLS_ITEM_LABEL])(
    'still carries a usable quit item after "%s" is toggled',
    async (label) => {
      const harness = makeHarness();
      PtahTrayService.create(harness.options);

      clickItem(itemLabelled(mountedTemplate(), label), { checked: true });
      await flushMicrotasks();

      expect(
        electronMock.Menu.buildFromTemplate.mock.calls.length,
      ).toBeGreaterThanOrEqual(2);
      const quitItem = itemLabelled(mountedTemplate(), QUIT_ITEM_LABEL);
      expect(quitItem.enabled).toBe(true);
      clickItem(quitItem);
      expect(harness.quit).toHaveBeenCalledTimes(1);
    },
  );

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
// The two pause checkboxes — each writes its own master switch, nothing else
// ---------------------------------------------------------------------------

describe('"Pause memory" and "Pause skills" checkboxes', () => {
  it('renders both as checkboxes, before the separator and the quit item', () => {
    PtahTrayService.create(makeHarness().options);

    const template = mountedTemplate();
    expect(template.map((item) => item.label ?? item.type)).toEqual([
      PAUSE_MEMORY_ITEM_LABEL,
      PAUSE_SKILLS_ITEM_LABEL,
      'separator',
      QUIT_ITEM_LABEL,
    ]);
    expect(itemLabelled(template, PAUSE_MEMORY_ITEM_LABEL).type).toBe(
      'checkbox',
    );
    expect(itemLabelled(template, PAUSE_SKILLS_ITEM_LABEL).type).toBe(
      'checkbox',
    );
  });

  it.each([
    [true, true, false, false],
    [false, true, true, false],
    [true, false, false, true],
    [false, false, true, true],
  ])(
    'renders memory.enabled=%s skillSynthesis.enabled=%s as memory checked=%s, skills checked=%s',
    (memoryEnabled, skillsEnabled, memoryChecked, skillsChecked) => {
      PtahTrayService.create(
        makeHarness({ memoryEnabled, skillsEnabled }).options,
      );

      const template = mountedTemplate();
      expect(itemLabelled(template, PAUSE_MEMORY_ITEM_LABEL).checked).toBe(
        memoryChecked,
      );
      expect(itemLabelled(template, PAUSE_SKILLS_ITEM_LABEL).checked).toBe(
        skillsChecked,
      );
    },
  );

  it.each<[string, string, boolean, boolean]>([
    [PAUSE_MEMORY_ITEM_LABEL, MEMORY_ENABLED_KEY, true, false],
    [PAUSE_MEMORY_ITEM_LABEL, MEMORY_ENABLED_KEY, false, true],
    [PAUSE_SKILLS_ITEM_LABEL, SKILL_SYNTHESIS_ENABLED_KEY, true, false],
    [PAUSE_SKILLS_ITEM_LABEL, SKILL_SYNTHESIS_ENABLED_KEY, false, true],
  ])(
    '"%s" writes ONLY %s (checked=%s → value %s)',
    async (label, key, checked, expectedValue) => {
      const harness = makeHarness({
        memoryEnabled: checked,
        skillsEnabled: checked,
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
// Freshness — settings-change event, refresh on open, listener disposal
// ---------------------------------------------------------------------------

describe('the menu stays current with the persisted switches', () => {
  it('refreshes when another surface writes a switch in-process', () => {
    const harness = makeHarness();
    PtahTrayService.create(harness.options);

    // e.g. the Thoth Memory tab writing through the same provider.
    harness.store.set(MEMORY_ENABLED_KEY, false);
    harness.fireChange(`${PTAH_CONFIG_SECTION}.${MEMORY_ENABLED_KEY}`);

    expect(
      itemLabelled(mountedTemplate(), PAUSE_MEMORY_ITEM_LABEL).checked,
    ).toBe(true);
    expect(lastTray().tooltip).toBe(`${TRAY_TOOLTIP} — memory paused`);
  });

  it('ignores a change to an unrelated key', () => {
    const harness = makeHarness();
    PtahTrayService.create(harness.options);

    harness.fireChange(`${PTAH_CONFIG_SECTION}.memory.triggers.idle.enabled`);

    expect(electronMock.Menu.buildFromTemplate).toHaveBeenCalledTimes(1);
  });

  it.each(['mouse-enter', 'click', 'right-click'])(
    'picks up a value changed with no event on "%s"',
    (event) => {
      const harness = makeHarness();
      PtahTrayService.create(harness.options);

      // Another process edited ~/.ptah/settings.json: no event fires.
      harness.store.set(SKILL_SYNTHESIS_ENABLED_KEY, false);
      lastTray().emit(event);

      expect(
        itemLabelled(mountedTemplate(), PAUSE_SKILLS_ITEM_LABEL).checked,
      ).toBe(true);
      expect(lastTray().tooltip).toBe(`${TRAY_TOOLTIP} — skills paused`);
    },
  );

  it('does not rebuild on open when nothing changed', () => {
    PtahTrayService.create(makeHarness().options);

    lastTray().emit('mouse-enter');
    lastTray().emit('right-click');

    expect(electronMock.Menu.buildFromTemplate).toHaveBeenCalledTimes(1);
  });

  it('disposes the settings listener on destroy', () => {
    const harness = makeHarness();
    const service = PtahTrayService.create(harness.options);
    expect(harness.listenerCount()).toBe(1);

    service?.destroy();

    expect(harness.subscriptionDispose).toHaveBeenCalledTimes(1);
    expect(harness.listenerCount()).toBe(0);
    harness.fireChange(`${PTAH_CONFIG_SECTION}.${MEMORY_ENABLED_KEY}`);
    expect(electronMock.Menu.buildFromTemplate).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Keep-alive mode — the create log and the live read
// ---------------------------------------------------------------------------

describe('keep-alive mode', () => {
  it('logs keep-alive OFF by default — closing all windows quits', () => {
    const harness = makeHarness();

    const service = PtahTrayService.create(harness.options);

    expect(harness.info).toHaveBeenCalledWith(
      '[Ptah Electron] Tray created (pause controls); keep-alive off — ' +
        'closing all windows quits',
    );
    expect(service?.isKeepAliveRequested()).toBe(false);
  });

  it('logs keep-alive ON when trayKeepalive is true', () => {
    const harness = makeHarness({ keepAlive: true });

    const service = PtahTrayService.create(harness.options);

    expect(harness.info).toHaveBeenCalledWith(
      '[Ptah Electron] Tray created (pause controls); keep-alive on — ' +
        'closing all windows leaves Ptah running',
    );
    expect(service?.isKeepAliveRequested()).toBe(true);
  });

  it('never logs the old "keep-alive active" line', () => {
    const harness = makeHarness();
    PtahTrayService.create(harness.options);

    const lines = harness.info.mock.calls.map((call) => String(call[0]));
    expect(lines.some((line) => line.includes('keep-alive active'))).toBe(
      false,
    );
  });

  it('reads trayKeepalive live, not once at creation', () => {
    const harness = makeHarness({ keepAlive: false });
    const service = PtahTrayService.create(harness.options);

    harness.store.set(TRAY_KEEPALIVE_KEY, true);

    expect(service?.isKeepAliveRequested()).toBe(true);
  });

  it('answers "off" (quit) when the setting cannot be read', () => {
    const harness = makeHarness();
    const service = PtahTrayService.create(harness.options);
    harness.getConfiguration.mockImplementation(() => {
      throw new Error('settings unreadable');
    });

    expect(service?.isKeepAliveRequested()).toBe(false);
    expect(harness.warn).toHaveBeenCalledTimes(1);
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

  it('uses the same key strings the pipelines read', () => {
    // Hardcoded here rather than imported: the app layer must not import
    // `skill-synthesis` or `memory-curator`. This asserts the strings did not
    // drift.
    expect(SKILL_SYNTHESIS_ENABLED_KEY).toBe('skillSynthesis.enabled');
    expect(MEMORY_ENABLED_KEY).toBe('memory.enabled');
    expect(TRAY_KEEPALIVE_KEY).toBe('skillSynthesis.trayKeepalive');
  });
});

// ---------------------------------------------------------------------------
// Tooltip — identifies the icon and names the paused switch
// ---------------------------------------------------------------------------

describe('tray tooltip', () => {
  it.each([
    [false, false, 'Ptah'],
    [true, false, 'Ptah — memory paused'],
    [false, true, 'Ptah — skills paused'],
    [true, true, 'Ptah — learning paused'],
  ])(
    'memoryPaused=%s skillsPaused=%s → "%s"',
    (memoryPaused, skillsPaused, expected) => {
      expect(trayTooltip({ memoryPaused, skillsPaused })).toBe(expected);
    },
  );

  it('is set on the tray at creation from the persisted state', () => {
    PtahTrayService.create(
      makeHarness({ memoryEnabled: false, skillsEnabled: false }).options,
    );

    expect(lastTray().tooltip).toBe('Ptah — learning paused');
  });

  it('follows a toggle from the tray itself', async () => {
    const harness = makeHarness();
    PtahTrayService.create(harness.options);
    expect(lastTray().tooltip).toBe(TRAY_TOOLTIP);

    clickItem(itemLabelled(mountedTemplate(), PAUSE_SKILLS_ITEM_LABEL), {
      checked: true,
    });
    await flushMicrotasks();

    expect(lastTray().tooltip).toBe('Ptah — skills paused');
  });
});
