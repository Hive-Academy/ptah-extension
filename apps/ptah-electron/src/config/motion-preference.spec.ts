import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installMotionEmulation, type MotionWebContents } from './motion-emulation';
import { motionMediaValue, parseMotionPreference, readMotionPreference } from './motion-preference';

const appSession = {};

function createWebContents(contentsSession: unknown = appSession) {
  const listeners: {
    navigation?: (details: { isMainFrame: boolean; isSameDocument: boolean }) => void;
    loaded?: () => void;
    devtoolsClosed?: () => void;
    detach?: (event: unknown, reason: string) => void;
  } = {};
  let attached = false;
  const debuggerApi = {
    isAttached: jest.fn(() => attached),
    attach: jest.fn(() => { attached = true; }),
    sendCommand: jest.fn(async (_method: string, _params?: Record<string, unknown>) => undefined),
    on: jest.fn((_event: 'detach', listener: (_event: unknown, reason: string) => void) => {
      listeners.detach = listener;
    }),
  };
  function on(event: 'did-start-navigation', listener: (details: { isMainFrame: boolean; isSameDocument: boolean }) => void): void;
  function on(event: 'did-finish-load' | 'devtools-closed', listener: () => void): void;
  function on(event: 'did-start-navigation' | 'did-finish-load' | 'devtools-closed', listener: (details: { isMainFrame: boolean; isSameDocument: boolean }) => void): void {
    if (event === 'did-start-navigation') {
      listeners.navigation = (details) => listener(details);
    } else if (event === 'did-finish-load') {
      listeners.loaded = () => listener({ isMainFrame: true, isSameDocument: false });
    } else {
      listeners.devtoolsClosed = () => listener({ isMainFrame: true, isSameDocument: false });
    }
  }
  const contents: MotionWebContents = {
    session: contentsSession,
    debugger: debuggerApi,
    isDestroyed: jest.fn(() => false),
    on,
  };
  return {
    contents,
    debuggerApi,
    listeners,
    detach: (reason: string): void => {
      attached = false;
      listeners.detach?.({}, reason);
    },
  };
}

describe('Electron Motion preference', () => {
  it.each([
    ['always', 'no-preference'],
    ['system', null],
    ['reduce', 'reduce'],
  ] as const)('selects the emulated media value for %s', (preference, expected) => {
    expect(motionMediaValue(preference)).toBe(expected);
  });

  it('defaults missing and invalid values to always', () => {
    expect(parseMotionPreference({})).toBe('always');
    expect(parseMotionPreference({ ptah: { motionPreference: 'bogus' } })).toBe('always');
    expect(parseMotionPreference({ ptah: { motionPreference: 'reduce' } })).toBe('reduce');
  });

  it('survives a malformed config file at startup', () => {
    const directory = mkdtempSync(join(tmpdir(), 'ptah-motion-'));
    try {
      writeFileSync(join(directory, 'config.json'), '{');
      expect(readMotionPreference(directory)).toBe('always');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it.each([
    ['always', 'no-preference'],
    ['reduce', 'reduce'],
  ] as const)('applies %s before load and after navigation', (preference, value) => {
    const { contents, debuggerApi, listeners } = createWebContents();
    const reportError = jest.fn();

    installMotionEmulation(contents, preference, reportError, jest.fn(), appSession);
    expect(debuggerApi.attach).toHaveBeenCalledTimes(1);
    expect(debuggerApi.sendCommand).toHaveBeenCalledWith('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value }],
    });

    listeners.navigation?.({ isMainFrame: true, isSameDocument: false });
    listeners.loaded?.();
    listeners.devtoolsClosed?.();
    expect(debuggerApi.sendCommand).toHaveBeenCalledTimes(4);
    expect(reportError).not.toHaveBeenCalled();
  });

  it('leaves Follow system untouched', () => {
    const { contents, debuggerApi } = createWebContents();
    installMotionEmulation(contents, 'system', jest.fn(), jest.fn(), appSession);
    expect(debuggerApi.attach).not.toHaveBeenCalled();
    expect(debuggerApi.sendCommand).not.toHaveBeenCalled();
  });

  it('does not attach to the browser tool session', () => {
    const { contents, debuggerApi, listeners } = createWebContents({ partition: 'ptah-browser-tool' });
    installMotionEmulation(contents, 'always', jest.fn(), jest.fn(), appSession);
    expect(debuggerApi.attach).not.toHaveBeenCalled();
    expect(debuggerApi.sendCommand).not.toHaveBeenCalled();
    expect(listeners.navigation).toBeUndefined();
  });

  it('only reapplies for main-frame document navigation', () => {
    const { contents, debuggerApi, listeners } = createWebContents();
    installMotionEmulation(contents, 'reduce', jest.fn(), jest.fn(), appSession);
    listeners.navigation?.({ isMainFrame: false, isSameDocument: false });
    listeners.navigation?.({ isMainFrame: true, isSameDocument: true });
    expect(debuggerApi.sendCommand).toHaveBeenCalledTimes(1);
    listeners.navigation?.({ isMainFrame: true, isSameDocument: false });
    expect(debuggerApi.sendCommand).toHaveBeenCalledTimes(2);
  });

  it('ignores expected detach reasons, warns for unexpected ones, and restores after DevTools closes', () => {
    const { contents, debuggerApi, listeners, detach } = createWebContents();
    const reportWarning = jest.fn();
    installMotionEmulation(contents, 'reduce', jest.fn(), reportWarning, appSession);
    detach('replaced_with_devtools');
    detach('target closed');
    expect(reportWarning).not.toHaveBeenCalled();
    listeners.devtoolsClosed?.();
    expect(debuggerApi.attach).toHaveBeenCalledTimes(2);
    expect(debuggerApi.sendCommand).toHaveBeenCalledTimes(2);
    detach('canceled_by_user');
    expect(reportWarning).toHaveBeenCalledWith(expect.any(Error));
    expect(reportWarning.mock.calls[0]?.[0].message).toContain('canceled_by_user');
  });

  it('reports attach and command failures as Errors', async () => {
    const { contents, debuggerApi, listeners } = createWebContents();
    const reportError = jest.fn();
    debuggerApi.attach.mockImplementationOnce(() => { throw new Error('attach failed'); });
    installMotionEmulation(contents, 'reduce', reportError, jest.fn(), appSession);
    expect(reportError).toHaveBeenCalledWith(expect.any(Error));

    debuggerApi.sendCommand.mockRejectedValueOnce(new Error('command failed'));
    listeners.navigation?.({ isMainFrame: true, isSameDocument: false });
    await Promise.resolve();
    expect(reportError).toHaveBeenCalledTimes(2);
    expect(reportError.mock.calls[1]?.[0]).toBeInstanceOf(Error);
  });

  it('deduplicates repeated identical command failures', async () => {
    const { contents, debuggerApi, listeners } = createWebContents();
    const reportError = jest.fn();
    debuggerApi.sendCommand.mockRejectedValue(new Error('CDP unavailable'));
    installMotionEmulation(contents, 'reduce', reportError, jest.fn(), appSession);
    listeners.navigation?.({ isMainFrame: true, isSameDocument: false });
    listeners.loaded?.();
    await Promise.resolve();
    expect(reportError).toHaveBeenCalledTimes(1);
  });
});
