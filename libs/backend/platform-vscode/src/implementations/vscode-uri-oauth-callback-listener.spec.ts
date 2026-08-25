/**
 * `VscodeUriOAuthCallbackListener` — verifies the native URI-handler OAuth
 * capture: redirect URI shape (through `asExternalUri`), happy-path resolve,
 * state-mismatch no-op, and error-param rejection.
 *
 * Jest resolves `import * as vscode from 'vscode'` to `__mocks__/vscode.ts`.
 */

import 'reflect-metadata';
import { VscodeUriOAuthCallbackListener } from './vscode-uri-oauth-callback-listener';
import {
  __resetVscodeTestDouble,
  __vscodeState,
  env as vscodeEnv,
} from '../../__mocks__/vscode';

const AUTHORITY = 'ptah-extensions.ptah-coding-orchestra';

describe('VscodeUriOAuthCallbackListener', () => {
  beforeEach(() => __resetVscodeTestDouble());

  it('registers a single shared URI handler on construction', () => {
    const listener = new VscodeUriOAuthCallbackListener();
    expect(__vscodeState.getUriHandler()).toBeDefined();
    listener.dispose();
    expect(__vscodeState.getUriHandler()).toBeUndefined();
  });

  it('start() produces the vscode://…/oauth-callback redirect URI', async () => {
    const listener = new VscodeUriOAuthCallbackListener();
    const handle = await listener.start('state-1');
    expect(handle.redirectUri).toBe(`vscode://${AUTHORITY}/oauth-callback`);
    listener.dispose();
  });

  it('start() resolves the redirect URI through asExternalUri (remote host)', async () => {
    (vscodeEnv.asExternalUri as jest.Mock).mockImplementationOnce(
      async (_uri: unknown) => ({
        toString: () => 'https://vscode.dev/tunnel/box/oauth-callback',
      }),
    );
    const listener = new VscodeUriOAuthCallbackListener();
    const handle = await listener.start('state-remote');
    expect(handle.redirectUri).toBe(
      'https://vscode.dev/tunnel/box/oauth-callback',
    );
    expect(vscodeEnv.asExternalUri).toHaveBeenCalledTimes(1);
    listener.dispose();
  });

  it('handleUri with a matching state resolves waitForCode with the code', async () => {
    const listener = new VscodeUriOAuthCallbackListener();
    const handle = await listener.start('state-abc');

    const pending = handle.waitForCode(1000);
    __vscodeState.fireUri('state=state-abc&code=THE_CODE');

    await expect(pending).resolves.toBe('THE_CODE');
    listener.dispose();
  });

  it('handleUri with a non-matching state is a no-op (waiter stays pending)', async () => {
    const listener = new VscodeUriOAuthCallbackListener();
    const handle = await listener.start('state-expected');

    const pending = handle.waitForCode(50);
    // Unknown state must not settle the pending waiter.
    __vscodeState.fireUri('state=some-other-state&code=NOPE');

    await expect(pending).rejects.toThrow(/timed out/i);
    listener.dispose();
  });

  it('handleUri with an error param rejects waitForCode', async () => {
    const listener = new VscodeUriOAuthCallbackListener();
    const handle = await listener.start('state-err');

    const pending = handle.waitForCode(1000);
    __vscodeState.fireUri('state=state-err&error=access_denied');

    await expect(pending).rejects.toThrow(/access_denied/i);
    listener.dispose();
  });

  it('close() drops the flow waiter without disposing the shared handler', async () => {
    const listener = new VscodeUriOAuthCallbackListener();
    const handle = await listener.start('state-close');
    await handle.close();

    // The shared URI handler is still registered after a per-flow close.
    expect(__vscodeState.getUriHandler()).toBeDefined();

    // A late redirect for the closed flow is ignored (no throw).
    expect(() =>
      __vscodeState.fireUri('state=state-close&code=LATE'),
    ).not.toThrow();
    listener.dispose();
  });
});
