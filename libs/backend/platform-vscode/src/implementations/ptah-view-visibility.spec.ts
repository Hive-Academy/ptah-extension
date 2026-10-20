import 'reflect-metadata';
import * as vscode from 'vscode';
import type { DependencyContainer } from 'tsyringe';
import { TOKENS, type WebviewManager } from '@ptah-extension/vscode-core';
import { VscodePtahViewVisibility } from './ptah-view-visibility';

describe('VscodePtahViewVisibility', () => {
  it('resolves the manager only when used and observes panel/sidebar changes', () => {
    let publish: (() => void) | undefined;
    const metrics = { 'ptah.main': { isVisible: false }, 'ptah.panel.a': { isVisible: true } };
    const manager = {
      getWebviewMetrics: jest.fn(() => metrics),
      onDidChangeVisibility: jest.fn((listener: () => void) => {
        publish = listener;
        return { dispose: jest.fn() };
      }),
    };
    const container = { resolve: jest.fn(() => manager) } as Pick<DependencyContainer, 'resolve'>;
    const adapter = new VscodePtahViewVisibility(container as DependencyContainer);
    expect(container.resolve).not.toHaveBeenCalled();
    expect(adapter.anyPtahViewVisible()).toBe(true);
    expect(container.resolve).toHaveBeenCalledWith(TOKENS.WEBVIEW_MANAGER);
    const changes: boolean[] = [];
    Object.assign(vscode.window, {
      state: { focused: true },
      onDidChangeWindowState: jest.fn(() => ({ dispose: jest.fn() })),
    });
    const subscription = adapter.onDidChange((state) => changes.push(state.visible));
    metrics['ptah.panel.a'].isVisible = false;
    publish?.();
    expect(changes).toEqual([false]);
    subscription.dispose();
  });
});
