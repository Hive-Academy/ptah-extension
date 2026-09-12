import type { Page } from '@playwright/test';
import { test, expect } from '../../support/fixtures';

const WORKSPACE = 'C:\\ptah-e2e-ws';

async function openFileView(
  page: Page,
  request: {
    path: string;
    workspaceRoot: string;
    line?: number;
    column?: number;
  },
): Promise<void> {
  await page.evaluate(async (value) => {
    const dock = document.querySelector('ptah-git-dock');
    const angular = (
      window as unknown as {
        ng?: {
          getComponent(element: Element): {
            diffTabs: { openFileView(input: typeof value): Promise<void> };
          };
        };
      }
    ).ng;
    if (!dock || !angular) {
      throw new Error('Angular dock debug context is unavailable.');
    }
    await angular.getComponent(dock).diffTabs.openFileView(value);
  }, request);
}

test.describe('read-only file tabs', () => {
  test('opens text and markdown, toggles source, closes, and renders refusal', async ({
    electronApp,
    mainWindow,
    ui,
  }) => {
    await ui.mockRpc({
      'git:info': {
        isGitRepo: true,
        branch: { branch: 'main', upstream: null, ahead: 0, behind: 0 },
        files: [],
      },
      'git:branches': {
        current: 'main',
        local: [{ name: 'main', isCurrent: true }],
        remote: [],
      },
      'git:stashList': { success: true, entries: [], count: 0 },
      'git:lastCommit': { success: false },
      'editor:detectTargets': {
        success: true,
        targets: [{ id: 'kiro', displayName: 'Kiro' }],
      },
      'editor:openFile': { success: true },
      'file:viewContent': `(params) => {
        if (params.path.includes('outside')) return {
          success: false,
          reason: 'outside-roots',
          error: 'This file is outside the open workspaces.',
          absolutePath: 'C:\\\\outside\\\\blocked.ts',
          externalOpenAllowed: true
        };
        if (params.path.endsWith('.md')) return {
          success: true,
          absolutePath: 'C:\\\\ptah-e2e-ws\\\\docs\\\\readme.md',
          workspaceRoot: 'C:\\\\ptah-e2e-ws',
          relativePath: 'docs/readme.md',
          content: '# Rendered preview\\n\\nSafe markdown body.',
          sizeBytes: 39,
          encoding: 'utf-8'
        };
        return {
          success: true,
          absolutePath: 'C:\\\\ptah-e2e-ws\\\\src\\\\alpha.ts',
          workspaceRoot: 'C:\\\\ptah-e2e-ws',
          relativePath: 'src/alpha.ts',
          content: 'const one = 1;\\nconst two = 2;\\nconst three = 3;',
          sizeBytes: 50,
          encoding: 'utf-8'
        };
      }`,
    });
    await ui.goto('git');
    const size = await electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.getSize(),
    );
    expect(size).toEqual([1200, 800]);
    await mainWindow
      .getByRole('button', { name: 'Toggle Workspaces panel' })
      .click();
    const dock = mainWindow.locator('ptah-git-dock');
    const dockBox = await dock.boundingBox();
    expect(dockBox?.width).toBeGreaterThanOrEqual(699);
    expect(dockBox?.width).toBeLessThanOrEqual(701);

    await openFileView(mainWindow, {
      path: 'src/alpha.ts',
      workspaceRoot: WORKSPACE,
      line: 2,
      column: 7,
    });
    await expect(
      mainWindow.getByRole('tab', { name: 'alpha.ts' }),
    ).toBeVisible();
    await expect(mainWindow.locator('.view-lines')).toBeVisible();
    await expect
      .poll(() =>
        mainWindow.evaluate(() => {
          const host = document.querySelector('ptah-file-view');
          const angular = (
            window as unknown as {
              ng?: {
                getComponent(element: Element): {
                  editor?: { getPosition(): unknown };
                };
              };
            }
          ).ng;
          return host && angular
            ? angular.getComponent(host).editor?.getPosition()
            : null;
        }),
      )
      .toEqual({ lineNumber: 2, column: 7 });

    await openFileView(mainWindow, {
      path: 'docs/readme.md',
      workspaceRoot: WORKSPACE,
    });
    await expect(
      mainWindow.locator('[data-testid="file-view-preview"]'),
    ).toContainText('Rendered preview');
    const previewToggle = mainWindow.locator(
      '[data-testid="file-view-preview-toggle"]',
    );
    await expect(previewToggle).toHaveAttribute('aria-pressed', 'true');
    await previewToggle.click();
    await expect(previewToggle).toHaveAttribute('aria-pressed', 'false');
    await expect(
      mainWindow.locator('[data-testid="file-view-editor"]'),
    ).not.toHaveClass(/invisible/);
    await mainWindow.getByRole('button', { name: 'Close readme.md' }).click();
    await expect(
      mainWindow.getByRole('tab', { name: 'alpha.ts' }),
    ).toHaveAttribute('aria-selected', 'true');

    await openFileView(mainWindow, {
      path: 'C:\\outside\\blocked.ts',
      workspaceRoot: WORKSPACE,
    });
    await expect(
      mainWindow.locator('ptah-file-view p[role="alert"]'),
    ).toContainText('This file is outside the open workspaces.');
    await mainWindow
      .locator(
        '[data-testid="git-dock-content"] [data-testid="open-in-primary"]',
      )
      .click();
    const confirm = mainWindow.getByRole('alertdialog');
    await expect(confirm).toContainText('C:\\outside\\blocked.ts');
    await expect(confirm).toContainText('Kiro');
    expect(await ui.getObservedCalls('editor:openFile')).toHaveLength(0);
    await confirm.getByRole('button', { name: 'Open', exact: true }).click();
    await expect
      .poll(async () => ui.getObservedCalls('editor:openFile'))
      .toEqual([
        expect.objectContaining({
          params: {
            target: 'kiro',
            path: 'C:\\outside\\blocked.ts',
            scope: 'external-link',
          },
        }),
      ]);
  });
});
