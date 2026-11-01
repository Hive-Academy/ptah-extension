import type { ReplayMessage } from './types';

export interface HostApi {
  postMessage(message: ReplayMessage): void;
  getState(): Record<string, unknown>;
  setState(value: Record<string, unknown>): void;
}

export function installHostGlobals(postMessage: (message: ReplayMessage) => void, config: Record<string, unknown> = {}): HostApi {
  let savedState: Record<string, unknown> = { 'theme-v2': 'ptah-glass' };
  const api: HostApi = {
    postMessage,
    getState: () => savedState,
    setState: (value) => { savedState = value ?? {}; },
  };
  let acquired = false;
  const host = window as Window & { vscode?: HostApi; acquireVsCodeApi?: () => HostApi; ptahConfig?: Record<string, unknown>; ptahClipboard?: object };
  host.vscode = api;
  host.acquireVsCodeApi = () => {
    if (acquired) throw new Error('acquireVsCodeApi may only be called once');
    acquired = true;
    return api;
  };
  const safeConfig = { ...config };
  delete safeConfig['initialSessionId'];
  host.ptahConfig = {
    isVSCode: false, isElectron: true, theme: 'dark',
    workspaceRoot: '/workspace/acme-app', workspaceName: 'acme-app',
    extensionUri: '', baseUri: '', iconUri: './images/ptah-icon.webp',
    userIconUri: './images/user-icon.png', panelId: 'electron-main',
    platform: 'linux', initialView: 'chat', zoneChangeDetectionFallback: false,
    ...safeConfig,
  };
  host.ptahClipboard = { readText: async () => '', writeText: (_value: string) => undefined,
    hasImage: async () => false, readImageBase64: async () => null };
  return api;
}
