/**
 * Ptah tray — the pause surface for background learning, with an optional
 * keep-alive (C5, TASK_2026_180; pause switches, TASK_2026_620 B-P).
 *
 * ## Why this file exists
 *
 * The tray is ALWAYS created. It carries two pause checkboxes — "Pause memory"
 * (`memory.enabled`) and "Pause skills" (`skillSynthesis.enabled`) — so the
 * user can stop background learning without opening a window. Its tooltip
 * names which switch is paused.
 *
 * Keep-alive is optional: `skillSynthesis.trayKeepalive` (ships `false`) lets
 * the app keep running with no windows open so the synthesis drain can keep
 * draining. With it off, closing the last window quits exactly as it did
 * before the tray existed. With it on, the user has **no window and no
 * dock/taskbar entry**, so the tray is the only remaining way to terminate the
 * process.
 *
 * ## R10 — the "Quit Ptah" item is UNCONDITIONAL, and its absence is a defect
 *
 * Two mechanisms enforce that, because one is not enough:
 *
 *   1. `buildTrayMenuTemplate()` emits the quit item as a plain literal. It is
 *      never behind a flag, a platform check or a ternary. Read the function —
 *      there is no code path through it that omits the item.
 *   2. `assertQuitItemPresent()` re-checks the built template and THROWS.
 *      `create()` runs it before returning, so a tray that somehow lost its quit
 *      item never becomes live — `create()` returns `null` instead, keep-alive
 *      stays off, and `window-all-closed` quits exactly as it does today.
 *
 * That second mechanism is why `handleWindowAllClosed()` below suppresses the
 * quit only when keep-alive is requested AND a LIVE tray exists. Reading the
 * setting alone would suppress the quit even when the tray failed to construct
 * (missing icon, Linux with no StatusNotifier host, sandboxed session) — which
 * is precisely the unkillable-background-process defect R10 names.
 *
 * ## The pause checkboxes write the MASTER switches, and only those
 *
 * Each checkbox writes exactly one key through `IWorkspaceProvider`:
 * `skillSynthesis.enabled` is the drain's FIRST gate (`skill-drain.service.ts`,
 * gate 1), and `memory.enabled` is the memory master. Neither write touches a
 * trigger sub-switch, so resuming restores whatever the user had configured.
 * Both keys are file-routed, so the write lands in `~/.ptah/settings.json` and
 * also pauses any other Ptah process sharing that file.
 *
 * ## Freshness
 *
 * The menu is rebuilt when an in-process `setConfiguration` changes either
 * switch (`onDidChangeConfiguration`), and again when the user is about to open
 * it (`mouse-enter`, `click`, `right-click`; Windows and macOS). An edit made by
 * another process fires no event, so the open-time refresh is what keeps it
 * current. Linux AppIndicator emits no tray events; there only in-process
 * changes refresh the menu.
 *
 * ## Platform placement
 *
 * `Tray` is Electron-only, so this lives in the app layer by construction and
 * never leaks into `libs/backend/**`. The settings write goes through the
 * `IWorkspaceProvider` port the app already uses — this file does NOT import
 * `skill-synthesis` or `memory-curator`.
 *
 * NOTE: this module must stay free of `import.meta`, or it stops being
 * importable under ts-jest (`module: commonjs` → TS1343). That is why the icon
 * path is passed in by `main.ts` rather than derived here.
 */

import { Menu, Tray } from 'electron';
import type { MenuItem, MenuItemConstructorOptions } from 'electron';

import {
  FILE_BASED_SETTINGS_KEYS,
  type IDisposable,
  type IWorkspaceProvider,
} from '@ptah-extension/platform-core';

/** The configuration section every Ptah setting lives under. */
export const PTAH_CONFIG_SECTION = 'ptah';

/**
 * Ships `false` (C0/B0.5). Read live: at tray creation for the log line, and
 * again at every `window-all-closed` to decide whether to suppress the quit.
 */
export const TRAY_KEEPALIVE_KEY = 'skillSynthesis.trayKeepalive';

/** The skills master switch — the drain's first gate. */
export const SKILL_SYNTHESIS_ENABLED_KEY = 'skillSynthesis.enabled';

/** The memory master switch. */
export const MEMORY_ENABLED_KEY = 'memory.enabled';

/** The two keys a pause checkbox may write. */
export type TrayPauseKey =
  typeof MEMORY_ENABLED_KEY | typeof SKILL_SYNTHESIS_ENABLED_KEY;

export const PAUSE_MEMORY_ITEM_LABEL = 'Pause memory';
export const PAUSE_SKILLS_ITEM_LABEL = 'Pause skills';
export const QUIT_ITEM_LABEL = 'Quit Ptah';
export const TRAY_TOOLTIP = 'Ptah';

/**
 * The slice of the logger this service uses. Structurally satisfied by
 * `Logger` from `vscode-core`; declared locally so the tray does not drag that
 * module into its own dependency graph for two method signatures.
 */
export interface TrayLogger {
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
}

/** The configuration operations the tray performs. */
export type TrayWorkspaceProvider = Pick<
  IWorkspaceProvider,
  'getConfiguration' | 'setConfiguration' | 'onDidChangeConfiguration'
>;

export interface TrayServiceOptions {
  readonly workspace: TrayWorkspaceProvider;
  /** Absolute path to the tray icon. Supplied by `main.ts` (see NOTE above). */
  readonly iconPath: string;
  readonly quit: () => void;
  readonly logger: TrayLogger;
}

/** `true` means the switch is off, i.e. the checkbox is checked. */
export interface TrayPauseState {
  readonly memoryPaused: boolean;
  readonly skillsPaused: boolean;
}

export interface TrayMenuTemplateOptions extends TrayPauseState {
  readonly onTogglePause: (key: TrayPauseKey, paused: boolean) => void;
  readonly onQuit: () => void;
}

/** The tooltip for a pause state: which switch, if any, is paused. */
export function trayTooltip(state: TrayPauseState): string {
  if (state.memoryPaused && state.skillsPaused) {
    return `${TRAY_TOOLTIP} — learning paused`;
  }
  if (state.memoryPaused) {
    return `${TRAY_TOOLTIP} — memory paused`;
  }
  if (state.skillsPaused) {
    return `${TRAY_TOOLTIP} — skills paused`;
  }
  return TRAY_TOOLTIP;
}

/**
 * Build the tray's context-menu template.
 *
 * R10: the "Quit Ptah" item is emitted unconditionally. There is exactly one
 * `return` and the quit item is a literal member of it — do not make it
 * conditional, and do not reorder it behind an early return.
 */
export function buildTrayMenuTemplate(
  options: TrayMenuTemplateOptions,
): MenuItemConstructorOptions[] {
  return [
    {
      label: PAUSE_MEMORY_ITEM_LABEL,
      type: 'checkbox',
      checked: options.memoryPaused,
      enabled: true,
      // Electron flips `checked` before firing `click`, so this reads the NEW
      // state rather than the one the template was built with.
      click: (item: MenuItem) =>
        options.onTogglePause(MEMORY_ENABLED_KEY, item.checked === true),
    },
    {
      label: PAUSE_SKILLS_ITEM_LABEL,
      type: 'checkbox',
      checked: options.skillsPaused,
      enabled: true,
      click: (item: MenuItem) =>
        options.onTogglePause(
          SKILL_SYNTHESIS_ENABLED_KEY,
          item.checked === true,
        ),
    },
    { type: 'separator' },
    {
      label: QUIT_ITEM_LABEL,
      enabled: true,
      click: () => options.onQuit(),
    },
  ];
}

/**
 * Throw unless the template carries a usable "Quit Ptah" item.
 *
 * "Usable" means present, not disabled, and actually wired to a handler — a
 * greyed-out or inert quit item is the same defect as a missing one.
 */
export function assertQuitItemPresent(
  template: readonly MenuItemConstructorOptions[],
): void {
  const quitItem = template.find((item) => item.label === QUIT_ITEM_LABEL);
  const usable =
    quitItem !== undefined &&
    quitItem.enabled !== false &&
    typeof quitItem.click === 'function';

  if (!usable) {
    throw new Error(
      `Ptah tray: menu has no usable "${QUIT_ITEM_LABEL}" item. Refusing to go ` +
        'live — a tray that suppresses window-all-closed without a working ' +
        'quit leaves an unkillable background process (R10).',
    );
  }
}

/**
 * The tray itself. Construct via `PtahTrayService.create()`, which returns
 * `null` rather than throwing: a tray that cannot be built must degrade to
 * "no keep-alive", never to "keep-alive with no way out".
 */
export class PtahTrayService {
  private tray: Tray | null;
  private configSubscription: IDisposable | null = null;
  /** The state the mounted menu was built from; `null` before the first build. */
  private appliedState: TrayPauseState | null = null;

  private constructor(
    private readonly options: TrayServiceOptions,
    tray: Tray,
  ) {
    this.tray = tray;
  }

  static create(options: TrayServiceOptions): PtahTrayService | null {
    let service: PtahTrayService | null = null;
    try {
      const tray = new Tray(options.iconPath);
      service = new PtahTrayService(options, tray);
      // Throws if the quit item is not usable — before the tray is handed back
      // and therefore before anything can treat keep-alive as available.
      service.applyMenu();
      service.subscribeToChanges(tray);
      options.logger.info(
        service.isKeepAliveRequested()
          ? '[Ptah Electron] Tray created (pause controls); keep-alive on — ' +
              'closing all windows leaves Ptah running'
          : '[Ptah Electron] Tray created (pause controls); keep-alive off — ' +
              'closing all windows quits',
      );
      return service;
    } catch (error: unknown) {
      // degradation-audit: optional-capability - the tray is an optional
      // pause/keep-alive surface; null is the R10 fail-safe the caller reads as
      // "no tray", so window-all-closed quits normally instead of hanging.
      service?.destroy();
      options.logger.warn(
        '[Ptah Electron] Tray unavailable — keep-alive disabled, ' +
          'window-all-closed will quit normally (R10 fail-safe):',
        error instanceof Error ? error.message : String(error),
      );
      return null;
    }
  }

  /**
   * Whether a real, undestroyed tray exists. Keep-alive needs this AND the
   * setting: the setting alone must never suppress the quit (R10).
   */
  isLive(): boolean {
    return this.tray !== null && !this.tray.isDestroyed();
  }

  /**
   * `skillSynthesis.trayKeepalive`, read live. A failed read answers `false`,
   * which means "quit" — the R10-safe direction.
   */
  isKeepAliveRequested(): boolean {
    try {
      return (
        this.options.workspace.getConfiguration<boolean>(
          PTAH_CONFIG_SECTION,
          TRAY_KEEPALIVE_KEY,
          false,
        ) === true
      );
    } catch (error: unknown) {
      // degradation-audit: reported - logged at warn through the injected Logger; an unreadable trayKeepalive answers false so window-all-closed quits (R10-safe), never strands a windowless process
      this.options.logger.warn(
        `[Ptah Electron] Tray could not read ${TRAY_KEEPALIVE_KEY}; ` +
          'treating keep-alive as off:',
        error instanceof Error ? error.message : String(error),
      );
      return false;
    }
  }

  /** Not wired into `will-quit`: Electron reclaims the tray on exit anyway. */
  destroy(): void {
    this.configSubscription?.dispose();
    this.configSubscription = null;
    if (this.tray !== null && !this.tray.isDestroyed()) {
      this.tray.destroy();
    }
    this.tray = null;
  }

  private subscribeToChanges(tray: Tray): void {
    this.configSubscription = this.options.workspace.onDidChangeConfiguration(
      (event) => {
        if (
          event.affectsConfiguration(
            `${PTAH_CONFIG_SECTION}.${MEMORY_ENABLED_KEY}`,
          ) ||
          event.affectsConfiguration(
            `${PTAH_CONFIG_SECTION}.${SKILL_SYNTHESIS_ENABLED_KEY}`,
          )
        ) {
          this.refreshMenu(false);
        }
      },
    );
    // Just before the menu can open. Cheap: the rebuild is skipped unless a
    // switch actually changed since the menu was last built. The listeners go
    // with the tray in `destroy()`.
    const refreshBeforeOpen = (): void => this.refreshMenu(false);
    tray.on('mouse-enter', refreshBeforeOpen);
    tray.on('click', refreshBeforeOpen);
    tray.on('right-click', refreshBeforeOpen);
  }

  private readPauseState(): TrayPauseState {
    const read = (key: TrayPauseKey): boolean =>
      this.options.workspace.getConfiguration<boolean>(
        PTAH_CONFIG_SECTION,
        key,
        true,
      ) === false;
    return {
      memoryPaused: read(MEMORY_ENABLED_KEY),
      skillsPaused: read(SKILL_SYNTHESIS_ENABLED_KEY),
    };
  }

  private applyMenu(): void {
    const state = this.readPauseState();
    const template = buildTrayMenuTemplate({
      ...state,
      onTogglePause: (key, paused) => {
        void this.togglePause(key, paused);
      },
      onQuit: () => this.options.quit(),
    });
    assertQuitItemPresent(template);
    if (this.tray === null || this.tray.isDestroyed()) return;
    this.tray.setContextMenu(Menu.buildFromTemplate(template));
    this.tray.setToolTip(trayTooltip(state));
    this.appliedState = state;
  }

  /**
   * Rebuild the menu from persisted state. `force` rebuilds even when the
   * persisted state matches the last build — needed after a click, because
   * Electron already flipped the live checkbox. Any failure leaves the PREVIOUS
   * menu mounted, which `create()` already proved carries a usable quit item.
   */
  private refreshMenu(force: boolean): void {
    try {
      if (!force && this.appliedState !== null) {
        const current = this.readPauseState();
        if (
          current.memoryPaused === this.appliedState.memoryPaused &&
          current.skillsPaused === this.appliedState.skillsPaused
        ) {
          return;
        }
      }
      this.applyMenu();
    } catch (error: unknown) {
      this.options.logger.warn(
        '[Ptah Electron] Tray menu refresh failed (non-fatal, previous menu ' +
          'retained):',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private async togglePause(key: TrayPauseKey, paused: boolean): Promise<void> {
    try {
      await this.options.workspace.setConfiguration(
        PTAH_CONFIG_SECTION,
        key,
        !paused,
      );
    } catch (error: unknown) {
      this.options.logger.warn(
        `[Ptah Electron] Tray pause toggle failed to persist ${key} ` +
          '(non-fatal):',
        error instanceof Error ? error.message : String(error),
      );
    }
    // Re-read after the write so a failed write visibly reverts the checkbox
    // rather than leaving the menu claiming a state that was never persisted.
    this.refreshMenu(true);
  }
}

/** The keys the tray touches, for the "actually routed to the file store" spec. */
export const TRAY_SETTINGS_KEYS = [
  TRAY_KEEPALIVE_KEY,
  SKILL_SYNTHESIS_ENABLED_KEY,
  MEMORY_ENABLED_KEY,
] as const;

/** Re-exported so the spec can assert routing without reaching past this module. */
export const ROUTED_FILE_SETTINGS_KEYS: ReadonlySet<string> =
  FILE_BASED_SETTINGS_KEYS;

export interface WindowAllClosedDeps {
  readonly platform: NodeJS.Platform;
  readonly quit: () => void;
  readonly hasLiveTray: () => boolean;
  /** `skillSynthesis.trayKeepalive`, read at close time. */
  readonly keepAliveRequested: () => boolean;
}

/**
 * The `window-all-closed` decision, lifted out of `main.ts` so it can be
 * asserted. (`main.ts` uses `import.meta` and is therefore not importable under
 * ts-jest — see the NOTE at the top of this file.) `main.ts` keeps only a
 * branch-free delegation to this function.
 *
 * Pre-change behaviour, which the default path must reproduce EXACTLY
 * (`main.ts:161-165` before C5):
 *
 * ```ts
 * app.on('window-all-closed', () => {
 *   if (process.platform !== 'darwin') {
 *     app.quit();
 *   }
 * });
 * ```
 *
 * The tray now always exists, so a live tray alone no longer means keep-alive:
 * with `trayKeepalive` off — the shipped default — this is that code and
 * nothing else.
 */
export function handleWindowAllClosed(deps: WindowAllClosedDeps): void {
  // macOS keeps the app resident with no windows; unchanged from before C5.
  if (deps.platform === 'darwin') {
    return;
  }

  // Keep-alive needs BOTH the setting and a live tray. The setting alone would
  // suppress the quit even when the tray failed to construct, stranding an
  // unkillable process (R10); the tray alone would stop every window close
  // from quitting now that the tray is always created.
  if (deps.keepAliveRequested() && deps.hasLiveTray()) {
    return;
  }

  deps.quit();
}
