/** Every platform link without a direct asset goes to the latest GitHub release. */
export const LATEST_RELEASE_URL = 'https://github.com/Hive-Academy/PtahCode/releases/latest';

/** Store listing for product 9N80K3HFX0JT (Windows releases from v2.0.0). */
export const MICROSOFT_STORE_URL = 'https://apps.microsoft.com/detail/9N80K3HFX0JT';

export type DesktopOs = 'windows' | 'macos' | 'linux';

export interface PlatformInfo {
  readonly id: DesktopOs;
  readonly name: string;
  /** 24 x 24 brand glyph path. */
  readonly icon: string;
}

const WINDOWS_ICON =
  'M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-12.9-1.801';
const MACOS_ICON =
  'M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z';
const LINUX_ICON =
  'M20.581 19.049c-.55-.446-.336-1.431-.907-1.917.553-3.365-.997-6.331-2.845-8.232-1.551-1.595-1.958-3.321-1.881-4.243.039-.467-.084-.986-.222-1.385-.869-.266-1.727-.312-2.712-.074-.105.378-.233.93-.198 1.459.077.922-.33 2.648-1.881 4.243-1.848 1.901-3.398 4.867-2.845 8.232-.571.486-.357 1.471-.907 1.917-1.37 1.112-.086 3.447 2.581 2.449 1.598-.597 2.21-2.18 2.258-3.256.175.015.354.024.536.024h.822c.182 0 .361-.009.536-.024.048 1.076.66 2.659 2.258 3.256 2.667.998 3.951-1.337 2.581-2.449zm-8.548-5.381c-.272 0-.492-.22-.492-.492s.22-.493.492-.493.493.221.493.493-.221.492-.493.492zm3.934 0c-.272 0-.492-.22-.492-.492s.22-.493.492-.493.493.221.493.493-.221.492-.493.492z';

export const PLATFORMS: Readonly<Record<DesktopOs, PlatformInfo>> = {
  windows: { id: 'windows', name: 'Windows', icon: WINDOWS_ICON },
  macos: { id: 'macos', name: 'macOS', icon: MACOS_ICON },
  linux: { id: 'linux', name: 'Linux', icon: LINUX_ICON },
};

/** The order of the top platform links (Windows, macOS, Linux). */
export const PLATFORM_ORDER: readonly PlatformInfo[] = [PLATFORMS.windows, PLATFORMS.macos, PLATFORMS.linux];

/** Navigator fields the detection reads; `userAgentData` exists only in Chromium. */
export interface NavigatorHints {
  readonly userAgent: string;
  readonly platform?: string;
  readonly userAgentData?: { readonly platform?: string; readonly mobile?: boolean };
}

/**
 * The desktop OS this browser runs on, or null for phones, tablets and
 * anything unrecognised (iPadOS and Android also report Mac and Linux).
 */
export function detectDesktopOs(nav: NavigatorHints): DesktopOs | null {
  const ua = nav.userAgent;
  if (nav.userAgentData?.mobile || /android|iphone|ipad|ipod|mobile/i.test(ua)) return null;
  const hint = `${nav.userAgentData?.platform ?? ''} ${nav.platform ?? ''} ${ua}`;
  if (/\bwin/i.test(hint)) return 'windows';
  if (/mac/i.test(hint)) return 'macos';
  if (/linux|x11/i.test(hint)) return 'linux';
  return null;
}

/** "Oct 1, 2026", as the release list has always shown it. */
export function formatReleaseDate(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
