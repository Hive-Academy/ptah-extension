import { test, expect } from '../../support/fixtures';

const MAIN_TS_PATH = 'C:\\ptah-e2e-ws\\src\\main.ts';
const MAIN_TS_CONTENT = 'export const x = 1;\n';

interface FileTreeNodeFixture {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileTreeNodeFixture[];
  expanded?: boolean;
  needsLoad?: boolean;
}

function fileTree(): { tree: FileTreeNodeFixture[] } {
  return {
    tree: [
      {
        name: 'src',
        type: 'directory',
        path: 'C:\\ptah-e2e-ws\\src',
        children: [
          {
            name: 'main.ts',
            type: 'file',
            path: MAIN_TS_PATH,
          },
        ],
      },
    ],
  };
}

test.describe('Editor — Monaco panel', () => {
  test('editor panel + file tree render', async ({ ui }) => {
    await ui.mockRpc({
      'editor:getFileTree': fileTree(),
    });

    await ui.goto('editor');

    const page = ui.page;

    await expect(
      page.locator(
        'ptah-editor-panel [role="main"][aria-label="Editor Panel"]',
      ),
    ).toBeVisible();

    await expect(
      page.locator('ptah-file-tree [role="tree"][aria-label="File Explorer"]'),
    ).toBeVisible();

    await expect(
      page.locator('ptah-file-tree').getByText('No files to display'),
    ).toHaveCount(0);

    const srcNode = page.locator('[data-testid="editor-file-node"]', {
      hasText: 'src',
    });
    await expect(srcNode).toBeVisible();
    await srcNode.click();

    await expect(
      page.locator('[data-testid="editor-file-node"]', { hasText: 'main.ts' }),
    ).toBeVisible();

    await expect(
      page.locator('[data-testid="editor-terminal-toggle"]'),
    ).toBeVisible();
  });

  test('open a file into Monaco', async ({ ui }) => {
    await ui.mockRpc({
      'editor:getFileTree': fileTree(),
      'editor:openFile': {
        content: MAIN_TS_CONTENT,
        language: 'typescript',
        path: MAIN_TS_PATH,
        filePath: MAIN_TS_PATH,
      },
    });

    await ui.goto('editor');

    const page = ui.page;

    const srcNode = page.locator('[data-testid="editor-file-node"]', {
      hasText: 'src',
    });
    await expect(srcNode).toBeVisible();
    await srcNode.click();

    const fileNode = page.locator('[data-testid="editor-file-node"]', {
      hasText: 'main.ts',
    });
    await expect(fileNode).toBeVisible();
    await fileNode.click();

    const editorTab = page.locator(
      'ptah-editor-panel [role="tab"][aria-label="Switch to main.ts"]',
    );
    await expect(editorTab).toBeVisible();

    const monacoHost = page.locator('[data-testid="editor-monaco"]');
    await expect(monacoHost).toBeVisible();

    const monacoInstance = page.locator('.monaco-editor').first();
    await expect(monacoInstance).toBeVisible({ timeout: 15_000 });
    await expect(monacoHost).toContainText('export const x = 1;', {
      timeout: 15_000,
    });
  });

  test('git status bar reflects pushed changes', async ({ ui }) => {
    await ui.mockRpc({
      'editor:getFileTree': fileTree(),
    });

    await ui.goto('editor');

    const page = ui.page;

    await ui.pushEvent({
      type: 'git:status-update',
      payload: {
        branch: {
          branch: 'main',
          upstream: 'origin/main',
          ahead: 0,
          behind: 0,
        },
        files: [
          {
            path: 'src/main.ts',
            status: 'M',
            staged: false,
          },
          {
            path: 'src/util.ts',
            status: 'A',
            staged: true,
          },
        ],
        isGitRepo: true,
      },
    });

    const statusBar = page.locator(
      'ptah-git-status-bar [role="status"][aria-label="Git status"]',
    );
    await expect(statusBar).toBeVisible();

    const changedCount = page.getByTitle('2 changed file(s)');
    await expect(changedCount).toBeVisible();
    await expect(changedCount).toContainText('2');
  });
});
