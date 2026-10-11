import * as vscode from 'vscode';
import { TOKENS } from '@ptah-extension/vscode-core';
import { DIContainer } from '../di/container';
import { PtahExtension } from './ptah-extension';

jest.mock('../di/container', () => ({ DIContainer: { resolve: jest.fn() } }));

describe('PtahExtension panel serializer registration', () => {
  afterEach(() => jest.restoreAllMocks());

  it('registers the editor panel serializer during initialization and disposes it', async () => {
    const serializerDisposable = { dispose: jest.fn() };
    const sidebarDisposable = { dispose: jest.fn() };
    const provider = { dispose: jest.fn(), createPanel: jest.fn() };
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const registerSerializer = jest.fn().mockReturnValue(serializerDisposable);
    const registerSidebar = jest.fn().mockReturnValue(sidebarDisposable);
    Object.assign(vscode.window, {
      registerWebviewPanelSerializer: registerSerializer,
      registerWebviewViewProvider: registerSidebar,
    });
    jest
      .spyOn(vscode.commands, 'registerCommand')
      .mockImplementation(() => ({ dispose: jest.fn() }));
    (DIContainer.resolve as jest.Mock).mockImplementation((token: symbol) => {
      if (token === TOKENS.ANGULAR_WEBVIEW_PROVIDER) return provider;
      if (token === TOKENS.LOGGER) return logger;
      return {};
    });
    const extension = new PtahExtension({
      subscriptions: [],
    } as unknown as vscode.ExtensionContext);

    await extension.initialize();
    expect(registerSerializer).toHaveBeenCalledWith(
      'ptah-angular-spa',
      provider,
    );
    expect(registerSidebar).toHaveBeenCalledWith(
      'ptah.main',
      provider,
      expect.any(Object),
    );
    extension.dispose();
    expect(serializerDisposable.dispose).toHaveBeenCalledTimes(1);
    expect(sidebarDisposable.dispose).toHaveBeenCalledTimes(1);
  });
});
