import type { Page } from '@playwright/test';

/**
 * Boots a page as a real VS Code webview host for the `vscode-shell`
 * scenarios: injects the exact `ptahConfig` shape
 * `webview-html-generator.ts` writes into the webview HTML.
 *
 * HOST CONFIG NOTE. `ptahConfig.isElectron` is deliberately LEFT OUT,
 * matching the "HOST CONFIG NOTE" in `../thoth/skills-lane-pickers.e2e.spec.ts`:
 * a real VS Code webview host never sets it, and `vscode.service.ts`'s
 * default config has `isElectron: false` (`:82`). With that, `app.html`'s
 * `@if (isElectron()) { <ptah-electron-shell /> } @else { <ptah-app-shell /> }`
 * (`:54-58`) takes the VS Code branch.
 *
 * Must be installed AFTER `installPostMessageBridge` — the init script only
 * injects `ptahConfig` once `acquireVsCodeApi` is stubbed — and, like every
 * `addInitScript`, before `page.goto(...)`.
 */
export async function installVSCodeHost(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as {
      acquireVsCodeApi?: () => {
        postMessage: (msg: unknown) => void;
        getState: () => unknown;
        setState: (s: unknown) => void;
      };
      ptahConfig?: unknown;
    };
    if (typeof w.acquireVsCodeApi !== 'function') {
      return;
    }
    // Exact shape a real VS Code webview host injects: no `isElectron`.
    w.ptahConfig = {
      isVSCode: true,
      theme: 'dark',
      extensionUri: '',
      baseUri: '',
      iconUri: '',
      userIconUri: '',
      panelId: 'e2e-harness',
      platform: 'win32',
      initialView: 'chat',
    };
  });
}
