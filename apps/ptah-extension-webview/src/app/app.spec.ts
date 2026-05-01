import { App } from './app';

describe('App', () => {
  // The original scaffolded spec imported `./nx-welcome`, which was removed
  // once the webview started rendering real chat/electron shells. Until a
  // proper harness that mocks AppStateManager / VSCodeService /
  // WebviewNavigationService is in place, keep a smoke assertion that the
  // bootstrap component is still exported. The real integration coverage
  // lives in the @ptah-extension/chat and @ptah-extension/core specs.
  it('exports the root App component', () => {
    expect(App).toBeDefined();
    expect(App.name).toBe('App');
  });
});
