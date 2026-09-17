import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';
import { test, expect } from '../../support/fixtures';
import { launchPtah } from '../../support/electron-launcher';
import { gitDiffFileMock } from '../../support/git-diff-mock';
import { RpcBridge } from '../../support/rpc-bridge';
import { UiDriver } from '../../support/ui-driver';

const WORKSPACE = 'C:\\ptah-e2e-ws';

async function prepareApp(
  userDataDir: string,
  dbPath: string,
): Promise<{
  app: ElectronApplication;
  page: Page;
  ui: UiDriver;
  rpc: RpcBridge;
}> {
  const app = await launchPtah({
    userDataDir,
    env: { PTAH_DB_PATH: dbPath },
  });
  const page = await app.firstWindow();
  const ui = new UiDriver(app, page);
  await ui.installFakeRpcListener();
  await ui.mockRpc({
    'workspace:getInfo': {
      folders: [WORKSPACE],
      activeFolder: WORKSPACE,
    },
    'workspace:switch': { success: true },
    'auth:getAuthStatus': {
      authMethod: 'apiKey',
      hasApiKey: true,
      availableProviders: [],
      anthropicProviderId: null,
    },
    'config:get': {},
    'editor:detectTargets': {},
    'git:info': {
      isGitRepo: true,
      branch: { branch: 'main', upstream: null, ahead: 0, behind: 0 },
      files: [
        { path: 'alpha.ts', status: 'M', staged: false, isDirectory: false },
        { path: 'beta.ts', status: 'A', staged: false, isDirectory: false },
      ],
    },
    'git:branches': {
      current: 'main',
      local: [{ name: 'main', isCurrent: true }],
      remote: [],
    },
    'git:stashList': { success: true, entries: [], count: 0 },
    'git:lastCommit': { success: false },
    'git:diffFile': gitDiffFileMock({
      path: 'alpha.ts',
      comparison: 'worktree',
      original: 'old\n',
      modified: 'new\n',
      snapshotToken: 'rail-snapshot',
    }),
  });
  await ui.prepare();
  await ui.goto('git');
  return { app, page, ui, rpc: new RpcBridge(app) };
}

test.describe('git source-control rail', () => {
  test('collapses, resizes, and restores both states after app restart', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-rail-e2e-'));
    const userDataDir = path.join(tempRoot, 'profile');
    const dbPath = path.join(tempRoot, 'ptah.sqlite');
    fs.mkdirSync(userDataDir);
    let first: ElectronApplication | null = null;
    let second: ElectronApplication | null = null;

    try {
      const initial = await prepareApp(userDataDir, dbPath);
      first = initial.app;
      const size = await first.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]?.getSize(),
      );
      expect(size).toEqual([1200, 800]);

      await initial.page
        .getByRole('button', { name: 'Toggle Workspaces panel' })
        .click();
      const dock = initial.page.locator('ptah-git-dock');
      await expect(dock).toBeVisible();
      const dockBox = await dock.boundingBox();
      expect(dockBox?.width).toBeGreaterThanOrEqual(699);
      expect(dockBox?.width).toBeLessThanOrEqual(701);

      await expect(
        initial.page.locator('ptah-source-control-file'),
      ).toHaveCount(2);
      await initial.page
        .getByRole('button', { name: 'Open diff for alpha.ts', exact: true })
        .click();
      const content = initial.page.locator('[data-testid="git-dock-content"]');
      await expect(content).toBeVisible();
      const initialContentWidth = (await content.boundingBox())?.width ?? 0;

      const toggle = initial.page.locator('[data-testid="git-rail-toggle"]');
      await toggle.click();
      await expect(
        initial.page.locator('#git-source-control-rail'),
      ).toHaveCount(0);
      expect((await content.boundingBox())?.width ?? 0).toBeGreaterThan(
        initialContentWidth + 250,
      );
      await toggle.click();

      const rail = initial.page.locator('#git-source-control-rail');
      await expect(rail).toBeVisible();
      const separator = initial.page.getByRole('separator', {
        name: 'Resize source control',
      });
      const separatorBox = await separator.boundingBox();
      if (!separatorBox) throw new Error('Rail separator has no bounding box.');
      const dragStartX = separatorBox.x + separatorBox.width / 2;
      const dragY = separatorBox.y + separatorBox.height / 2;
      await initial.page.mouse.move(dragStartX, dragY);
      await initial.page.mouse.down();
      await initial.page.mouse.move(dragStartX - 56, dragY);
      await initial.page.mouse.up();
      await expect
        .poll(async () => (await rail.boundingBox())?.width)
        .toBe(200);

      await toggle.click();
      await expect
        .poll(async () => {
          const state = (await initial.rpc.getState()) as Record<
            string,
            unknown
          >;
          return state['electron-layout'];
        })
        .toEqual(
          expect.objectContaining({
            gitRailWidth: 200,
            gitRailCollapsed: true,
          }),
        );

      await first.close();
      first = null;

      const restarted = await prepareApp(userDataDir, dbPath);
      second = restarted.app;
      const restartedToggle = restarted.page.locator(
        '[data-testid="git-rail-toggle"]',
      );
      await expect(restartedToggle).toHaveAttribute('aria-expanded', 'false');
      await expect(
        restarted.page.locator('#git-source-control-rail'),
      ).toHaveCount(0);

      await restartedToggle.click();
      const restoredRail = restarted.page.locator('#git-source-control-rail');
      await expect(restoredRail).toBeVisible();
      await expect
        .poll(async () => (await restoredRail.boundingBox())?.width)
        .toBe(200);
    } finally {
      await first?.close().catch(() => undefined);
      await second?.close().catch(() => undefined);
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
