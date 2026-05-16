/**
 * Public barrel for the webview E2E harness.
 *
 * Spec authors should import from
 * `@ptah-extension/webview-e2e-harness` only — never reach into
 * subpaths.
 */
export {
  installPostMessageBridge,
  type PostMessageBridge,
  type WebviewToExtensionMessage,
  type ExtensionToWebviewMessage,
} from './lib/postmessage-bridge';
export { installCspStub, type CspStubOptions } from './lib/csp-stub';
export {
  startFixtureServer,
  type FixtureServerHandle,
  type FixtureServerOptions,
} from './lib/fixture-server';
export {
  test,
  expect,
  type WebviewFixtures,
  type WebviewWorkerFixtures,
} from './lib/test-fixtures';
