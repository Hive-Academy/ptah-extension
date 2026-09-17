import { detectMonacoTheme, observeMonacoTheme } from './monaco-theme';

describe('monaco theme helpers', () => {
  afterEach(() => {
    for (const element of [document.body, document.documentElement]) {
      element.removeAttribute('data-vscode-theme-kind');
      element.removeAttribute('data-theme');
      element.removeAttribute('data-theme-mode');
    }
  });

  it('prefers VS Code theme kind and otherwise follows the root theme mode', () => {
    document.documentElement.setAttribute('data-theme-mode', 'light');
    expect(detectMonacoTheme()).toBe('vs');
    document.body.setAttribute(
      'data-vscode-theme-kind',
      'vscode-high-contrast',
    );
    expect(detectMonacoTheme()).toBe('hc-black');
  });

  it('observes both host theme owners and disconnects cleanly', async () => {
    const setTheme = jest.fn();
    const stop = observeMonacoTheme({
      editor: { setTheme },
    } as never);
    document.documentElement.setAttribute('data-theme-mode', 'light');
    await Promise.resolve();
    expect(setTheme).toHaveBeenLastCalledWith('vs');
    stop();
    setTheme.mockClear();
    document.body.setAttribute('data-vscode-theme-kind', 'vscode-dark');
    await Promise.resolve();
    expect(setTheme).not.toHaveBeenCalled();
  });
});
