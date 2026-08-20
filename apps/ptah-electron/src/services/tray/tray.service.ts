/**
 * Ptah tray — the keep-alive surface for background skill synthesis (C5,
 * TASK_2026_180 batch B5.1).
 *
 * ## Why this file exists
 *
 * `skillSynthesis.trayKeepalive` lets the app keep running with no windows open
 * so the synthesis drain can keep draining. Suppressing `window-all-closed` is
 * the easy half; the hard half is that once it is suppressed the user has **no
 * window and no dock/taskbar entry** — the tray is the only remaining way to
 * terminate the process.
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
 * That second mechanism is why `handleWindowAllClosed()` below gates on a LIVE
 * TRAY rather than on the `trayKeepalive` setting. Reading the setting would
 * suppress the quit even when the tray failed to construct (missing icon, Linux
 * with no StatusNotifier host, sandboxed session) — which is precisely the
 * unkillable-background-process defect R10 names.
 *
 * ## The "Pause background learning" checkbox writes the MASTER switch
 *
 * It writes `skillSynthesis.enabled` — the drain's FIRST gate
 * (`skill-drain.service.ts`, gate 1, "Nothing above it"), so a paused drain
 * reads nothing and spends nothing. This is decision Q-B option A: deliberately
 * NOT a second "off" concept, and deliberately NOT a `trayPaused` key. The
 * accepted trade-off is that pausing from the tray also pauses a VS Code window
 * sharing the same `~/.ptah/settings.json`.
 *
 * ## Platform placement
 *
 * `Tray` is Electron-only, so this lives in the app layer by construction and
 * never leaks into `libs/backend/**`. The settings write goes through the
 * `IWorkspaceProvider` port the app already uses — this file does NOT import
 * `skill-synthesis`.
 *
 * NOTE: this module must stay free of `import.meta`, or it stops being
 * importable under ts-jest (`module: commonjs` → TS1343). That is why the icon
 * path is passed in by `main.ts` rather than derived here.
 */

import { Menu, Tray } from 'electron';
import type { MenuItem, MenuItemConstructorOptions } from 'electron';

import {
  FILE_BASED_SETTINGS_KEYS,
  type IWorkspaceProvider,
} from '@ptah-extension/platform-core';

/** The configuration section every Ptah setting lives under. */
export const PTAH_CONFIG_SECTION = 'ptah';

/**
 * Ships `false` (C0/B0.5). Read once at startup; the tray is created only when
 * it is explicitly on, which is what makes C5 purely additive.
 */
export const TRAY_KEEPALIVE_KEY = 'skillSynthesis.trayKeepalive';

/**
 * The drain's first gate — and therefore the one thing "pause" is allowed to
 * write. Both keys are asserted to be members of `FILE_BASED_SETTINGS_KEYS` by
 * the spec: an unrouted key fails in the WRITE direction only, silently.
 */
export const SKILL_SYNTHESIS_ENABLED_KEY = 'skillSynthesis.enabled';

export const PAUSE_ITEM_LABEL = 'Pause background learning';
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

/** The only two configuration operations the tray performs. */
export type TrayWorkspaceProvider = Pick<
  IWorkspaceProvider,
  'getConfiguration' | 'setConfiguration'
>;

export interface TrayServiceOptions {
  readonly workspace: TrayWorkspaceProvider;
  /** Absolute path to the tray icon. Supplied by `main.ts` (see NOTE above). */
  readonly iconPath: string;
  readonly quit: () => void;
  readonly logger: TrayLogger;
}

export interface TrayMenuTemplateOptions {
  /** `true` when `skillSynthesis.enabled` is off. */
  readonly paused: boolean;
  readonly onTogglePause: (paused: boolean) => void;
  readonly onQuit: () => void;
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
      label: PAUSE_ITEM_LABEL,
      type: 'checkbox',
      checked: options.paused,
      enabled: true,
      // Electron flips `checked` before firing `click`, so this reads the NEW
      // state rather than the one the template was built with.
      click: (item: MenuItem) => options.onTogglePause(item.checked === true),
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

  private constructor(
    private readonly options: TrayServiceOptions,
    tray: Tray,
  ) {
    this.tray = tray;
  }

  static create(options: TrayServiceOptions): PtahTrayService | null {
    try {
      const tray = new Tray(options.iconPath);
      const service = new PtahTrayService(options, tray);
      // Throws if the quit item is not usable — before the tray is handed back
      // and therefore before anything can treat keep-alive as available.
      service.applyMenu();
      tray.setToolTip(TRAY_TOOLTIP);
      options.logger.info(
        '[Ptah Electron] Tray keep-alive active — closing all windows will ' +
          'leave Ptah running; use the tray to quit',
      );
      return service;
    } catch (error: unknown) {
      options.logger.warn(
        '[Ptah Electron] Tray unavailable — keep-alive disabled, ' +
          'window-all-closed will quit normally (R10 fail-safe):',
        error instanceof Error ? error.message : String(error),
      );
      return null;
    }
  }

  /**
   * Whether a real, undestroyed tray exists. This — not the `trayKeepalive`
   * setting — is what may suppress the quit.
   */
  isLive(): boolean {
    return this.tray !== null && !this.tray.isDestroyed();
  }

  /** Not wired into `will-quit`: Electron reclaims the tray on exit anyway. */
  destroy(): void {
    if (this.tray !== null && !this.tray.isDestroyed()) {
      this.tray.destroy();
    }
    this.tray = null;
  }

  /** `true` when the master switch is off. */
  private isPaused(): boolean {
    const enabled = this.options.workspace.getConfiguration<boolean>(
      PTAH_CONFIG_SECTION,
      SKILL_SYNTHESIS_ENABLED_KEY,
      true,
    );
    return enabled === false;
  }

  private applyMenu(): void {
    const template = buildTrayMenuTemplate({
      paused: this.isPaused(),
      onTogglePause: (paused) => {
        void this.togglePause(paused);
      },
      onQuit: () => this.options.quit(),
    });
    assertQuitItemPresent(template);
    this.tray?.setContextMenu(Menu.buildFromTemplate(template));
  }

  /**
   * Rebuild the menu from persisted state. Any failure leaves the PREVIOUS
   * menu mounted, which `create()` already proved carries a usable quit item.
   */
  private refreshMenu(): void {
    try {
      this.applyMenu();
    } catch (error: unknown) {
      this.options.logger.warn(
        '[Ptah Electron] Tray menu refresh failed (non-fatal, previous menu ' +
          'retained):',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private async togglePause(paused: boolean): Promise<void> {
    try {
      await this.options.workspace.setConfiguration(
        PTAH_CONFIG_SECTION,
        SKILL_SYNTHESIS_ENABLED_KEY,
        !paused,
      );
    } catch (error: unknown) {
      this.options.logger.warn(
        '[Ptah Electron] Tray pause toggle failed to persist ' +
          `${SKILL_SYNTHESIS_ENABLED_KEY} (non-fatal):`,
        error instanceof Error ? error.message : String(error),
      );
    }
    // Re-read after the write so a failed write visibly reverts the checkbox
    // rather than leaving the menu claiming a state that was never persisted.
    this.refreshMenu();
  }
}

/** The keys the tray touches, for the "actually routed to the file store" spec. */
export const TRAY_SETTINGS_KEYS = [
  TRAY_KEEPALIVE_KEY,
  SKILL_SYNTHESIS_ENABLED_KEY,
] as const;

/** Re-exported so the spec can assert routing without reaching past this module. */
export const ROUTED_FILE_SETTINGS_KEYS: ReadonlySet<string> =
  FILE_BASED_SETTINGS_KEYS;

export interface WindowAllClosedDeps {
  readonly platform: NodeJS.Platform;
  readonly quit: () => void;
  readonly hasLiveTray: () => boolean;
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
 * With no live tray — the shipped default, since `trayKeepalive` is `false` and
 * no tray is created — this is that code and nothing else.
 */
export function handleWindowAllClosed(deps: WindowAllClosedDeps): void {
  // macOS keeps the app resident with no windows; unchanged from before C5.
  if (deps.platform === 'darwin') {
    return;
  }

  // The ONLY thing permitted to suppress the quit. Gating on the
  // `trayKeepalive` setting instead would suppress it even when the tray failed
  // to construct, stranding an unkillable process (R10).
  if (deps.hasLiveTray()) {
    return;
  }

  deps.quit();
}
