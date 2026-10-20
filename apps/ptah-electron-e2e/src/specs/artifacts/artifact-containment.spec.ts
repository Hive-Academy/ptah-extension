import * as path from 'node:path';
import { test, expect } from '@playwright/test';
import { launchPtah } from '../../support/electron-launcher';

const ARTIFACT_URL = 'ptah-artifact://containment/index.html';
const ARTIFACT_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; font-src 'none'; media-src 'none'; worker-src 'none'; child-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'";

test('isolates hostile HTML in the real Electron shell', async () => {
  // The launch helper sets PTAH_E2E=1. Only with that flag does the main
  // process resolve this copied hostile fixture directory.
  const electronApp = await launchPtah({
    env: {
      PTAH_E2E_ARTIFACT_FIXTURE_DIR: path.join(__dirname, 'fixtures'),
    },
  });
  try {
    const mainWindow = await electronApp.firstWindow();
    const initialUrl = mainWindow.url();
    const remoteFinished: string[] = [];
    mainWindow.on('requestfinished', (request) => {
      if (/^https?:\/\/unauthorized-attacker\.example\.com/.test(request.url())) {
        remoteFinished.push(request.url());
      }
    });
    const responsePromise = mainWindow.waitForResponse(ARTIFACT_URL);
    await mainWindow.evaluate((url) => {
      const frame = document.createElement('iframe');
      frame.id = 'artifact-containment-test';
      frame.setAttribute('sandbox', 'allow-scripts');
      frame.src = url;
      document.body.append(frame);
    }, ARTIFACT_URL);
    const response = await responsePromise;
    expect(response.status()).toBe(200);
    expect((await response.allHeaders())['content-security-policy']).toBe(ARTIFACT_CSP);
    expect((await response.allHeaders())['content-type']).toBe('text/html; charset=utf-8');
    expect(await mainWindow.locator('#artifact-containment-test').getAttribute('sandbox')).toBe('allow-scripts');

    // The response can arrive before the frame commits its URL.
    const findFrame = () =>
      mainWindow.frames().find((f) => f.url().startsWith(ARTIFACT_URL));
    await expect
      .poll(() => findFrame()?.url() ?? mainWindow.frames().map((f) => f.url()).join(' | '), {
        timeout: 10_000,
      })
      .toBe(ARTIFACT_URL);
    const frame = findFrame();
    if (!frame) throw new Error('Artifact iframe did not load');
    await expect(frame.locator('#status')).toContainText('BLOCKED:');
    const checks = await frame.evaluate(async () => {
      const probe = (read: () => unknown) => {
        try { return read(); } catch { return 'blocked'; }
      };
      const parentAccess = probe(() => parent.document.title);
      const localStorageAccess = probe(() => localStorage.length);
      const cookie = probe(() => document.cookie);
      const indexedDbAccess = await new Promise<string>((resolve) => {
        try {
          const request = indexedDB.open('ptah-containment-probe');
          request.onerror = () => resolve('blocked');
          request.onsuccess = () => {
            request.result.close();
            resolve('available');
          };
        } catch { resolve('blocked'); }
      });
      const popup = probe(() => window.open('https://unauthorized-attacker.example.com'));
      const topNavigation = probe(() => {
        top!.location.href = 'https://unauthorized-attacker.example.com';
        return 'attempted';
      });
      return {
        parentAccess,
        localStorageAccess,
        cookie,
        indexedDbAccess,
        popup: popup === null ? null : String(popup),
        topNavigation,
        requireType: typeof (window as Window & { require?: unknown }).require,
        processType: typeof (window as Window & { process?: unknown }).process,
        preloadType: typeof (window as Window & { ptah?: unknown }).ptah,
        fixture: (window as Window & { __testResult?: { blocked: boolean; successfulEgress: string[] } }).__testResult,
      };
    });
    expect(checks.parentAccess).toBe('blocked');
    expect(checks.localStorageAccess).toBe('blocked');
    expect(checks.cookie === 'blocked' || checks.cookie === '').toBe(true);
    expect(checks.indexedDbAccess).toBe('blocked');
    expect(checks.popup).toBeNull();
    expect(checks.topNavigation).toBe('blocked');
    expect(checks.requireType).toBe('undefined');
    expect(checks.processType).toBe('undefined');
    expect(checks.preloadType).toBe('undefined');
    expect(checks.fixture?.blocked).toBe(true);
    expect(checks.fixture?.successfulEgress).toEqual([]);
    expect(remoteFinished).toEqual([]);
    expect(mainWindow.url()).toBe(initialUrl);
  } finally {
    await electronApp.close();
  }
});
