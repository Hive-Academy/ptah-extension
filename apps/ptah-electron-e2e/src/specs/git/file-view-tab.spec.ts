import { test, expect } from '../../support/fixtures';
import {
  openFileInShell,
  spotEditor,
  spotEditorContent,
  spotEditorCursor,
} from '../../support/spot-editor';

/**
 * The read-only file view, now the review shell's spot editor - TASK_2026_576
 * Batch 61 (successor of the `ptah-file-view` Monaco tab spec).
 *
 * A file opened from a link lives in the Changes tab as ONE editor (there are
 * no file tabs any more): read-only until the Edit button is pressed, with a
 * "Back to review" button that returns to the canvas. Mapping from the old spec:
 *   - "opens a text file at line:column"  -> caret at 2:7, content read-only
 *   - "opens markdown, toggles source"    -> Preview / Source buttons
 *   - "closes the tab"                    -> Back to review (no tabs remain)
 *   - "renders the refusal and confirms"  -> blocked state + Open-in confirm
 */

const WORKSPACE = 'C:\\ptah-e2e-ws';

const ALPHA_CONTENT =
  'const one = 1;\nconst two = 2;\nconst three = 3;\nconst four = 4;';

test.describe('read-only file view in the review shell', () => {
  test('opens text and markdown, toggles source, goes back, and renders refusal', async ({
    electronApp,
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
          encoding: 'utf-8',
          sha256: 'a'.repeat(64),
          bom: false
        };
        return {
          success: true,
          absolutePath: 'C:\\\\ptah-e2e-ws\\\\src\\\\alpha.ts',
          workspaceRoot: 'C:\\\\ptah-e2e-ws',
          relativePath: 'src/alpha.ts',
          content: ${JSON.stringify(ALPHA_CONTENT)},
          sizeBytes: 66,
          encoding: 'utf-8',
          sha256: 'b'.repeat(64),
          bom: false
        };
      }`,
    });
    await ui.goto('git');
    const size = await electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.getSize(),
    );
    expect(size).toEqual([1200, 800]);
    const page = ui.page;
    const editor = spotEditor(page);

    // --- text file at line:column, read-only --------------------------------
    await openFileInShell(page, 'src/alpha.ts', 2, {
      column: 7,
      workspaceRoot: WORKSPACE,
    });
    await expect(editor.locator('[data-testid="spot-editor-path"]')).toHaveText(
      'src/alpha.ts',
    );
    await expect(editor.locator('[data-testid="spot-editor-ro"]')).toHaveText(
      'Read only',
    );
    await expect(spotEditorContent(page)).toContainText('const two = 2;');
    await expect(spotEditorContent(page)).toHaveAttribute(
      'contenteditable',
      'false',
    );
    await expect(
      editor.locator('[data-testid="spot-editor-save"]'),
    ).toBeDisabled();
    await expect
      .poll(() => spotEditorCursor(page))
      .toEqual({ line: 2, column: 7 });
    await expect(editor.locator('.cm-activeLineGutter')).toHaveText('2');

    // --- markdown opens as a preview; Source reveals the editor --------------
    await openFileInShell(page, 'docs/readme.md', undefined, {
      workspaceRoot: WORKSPACE,
    });
    await expect(
      editor.locator('[data-testid="spot-editor-preview-body"]'),
    ).toContainText('Rendered preview');
    const previewButton = editor.locator('[data-testid="spot-editor-preview"]');
    const sourceButton = editor.locator('[data-testid="spot-editor-source"]');
    await expect(previewButton).toHaveAttribute('aria-pressed', 'true');
    await expect(sourceButton).toHaveAttribute('aria-pressed', 'false');
    await sourceButton.click();
    await expect(sourceButton).toHaveAttribute('aria-pressed', 'true');
    await expect(
      editor.locator('[data-testid="spot-editor-preview-body"]'),
    ).toHaveCount(0);
    await expect(spotEditorContent(page)).toContainText('# Rendered preview');
    await expect(
      editor.locator('[data-testid="spot-editor-body"]'),
    ).not.toHaveClass(/invisible/);

    // --- Back to review: the canvas returns and focus is not lost -----------
    await editor.locator('[data-testid="spot-editor-back"]').click();
    await expect(editor).toHaveCount(0);
    await expect(
      ui.reviewShell().locator('[data-testid="review-shell-changes-body"]'),
    ).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const active = document.activeElement;
          return !!active && active !== document.body && active.isConnected;
        }),
      )
      .toBe(true);

    // --- outside the open workspaces: blocked, external open needs a confirm -
    await openFileInShell(page, 'C:\\outside\\blocked.ts', undefined, {
      workspaceRoot: WORKSPACE,
    });
    await expect(
      editor.locator('[data-testid="spot-editor-blocked"]'),
    ).toContainText('This file is outside the open workspaces.');
    await editor.locator('[data-testid="open-in-primary"]').click();
    const confirm = page.getByRole('alertdialog');
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
