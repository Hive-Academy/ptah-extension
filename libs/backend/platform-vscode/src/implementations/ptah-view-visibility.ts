import * as vscode from 'vscode';
import { inject, injectable } from 'tsyringe';
import type { DependencyContainer } from 'tsyringe';
import { WebviewManager, TOKENS } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS, type IPtahViewVisibility, type PtahViewVisibility } from '@ptah-extension/platform-core';

/** Resolves the manager only when used: platform registration runs first. */
@injectable()
export class VscodePtahViewVisibility implements IPtahViewVisibility {
  constructor(@inject(PLATFORM_TOKENS.DI_CONTAINER) private readonly container: DependencyContainer) {}

  private get manager(): WebviewManager {
    return this.container.resolve<WebviewManager>(TOKENS.WEBVIEW_MANAGER);
  }

  anyPtahViewVisible(): boolean {
    const metrics = this.manager.getWebviewMetrics() as Record<string, { isVisible: boolean }>;
    return Object.values(metrics).some((metric) => metric.isVisible);
  }

  isPtahViewFocused(): boolean {
    return vscode.window.state.focused && this.anyPtahViewVisible();
  }

  onDidChange(listener: (visibility: PtahViewVisibility) => void): vscode.Disposable {
    const publish = () => listener({ visible: this.anyPtahViewVisible(), focused: this.isPtahViewFocused() });
    const subscriptions = [this.manager.onDidChangeVisibility(publish), vscode.window.onDidChangeWindowState(publish)];
    return { dispose: () => subscriptions.forEach((subscription) => subscription.dispose()) };
  }
}
