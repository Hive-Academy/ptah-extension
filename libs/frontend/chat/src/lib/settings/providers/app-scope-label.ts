import { inject } from '@angular/core';
import { VSCodeService } from '@ptah-extension/core';
import type { SettingScope } from '@ptah-extension/shared';

/** How the App scope is named in one host: as a label, and inside a sentence. */
export interface AppScopeName {
  readonly label: string;
  readonly inSentence: string;
}

/**
 * The App scope is the running host's own layer, not the desktop app's. Every host builds its scope
 * resolver with `app.<platform type>` (`resolveAppPrefix` in `platform-vscode`, `platform-electron`
 * and `platform-cli` settings registration), and `WorkspaceScopeResolver` reads and writes
 * `app.vscode.<key>` in VS Code and `app.electron.<key>` in the desktop app. So VS Code offers a real
 * App target; only its name was wrong ("Desktop app") in VS Code (TASK_2026_555 Batch 27b).
 */
export function appScopeName(isElectron: boolean): AppScopeName {
  return isElectron
    ? { label: 'Desktop app', inSentence: 'the Desktop app' }
    : { label: 'VS Code', inSentence: 'VS Code' };
}

/** The App scope name for the host this webview runs in. Call in an injection context. */
export function injectAppScopeName(): AppScopeName {
  return appScopeName(inject(VSCodeService).isElectron === true);
}

/** "Save to" labels for the running host (main-agent popover, setup wizard). */
export function saveTargetLabels(app: AppScopeName): Readonly<Record<SettingScope, string>> {
  return { global: 'Global · all apps', app: app.label, workspace: 'This workspace' };
}
