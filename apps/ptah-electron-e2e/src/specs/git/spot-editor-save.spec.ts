import * as fs from 'fs';
import * as path from 'path';
import type { Page } from '@playwright/test';
import { test, expect } from '../../support/real-rpc-fixtures';
import {
  MODIFIED_CONTENT,
  THREE_HUNK_FILE,
  type ScratchRepo,
} from '../../support/git-scratch-repo';
import {
  openFileInShell,
  spotEditor,
  spotEditorContent,
  spotEditorLines,
} from '../../support/spot-editor';
import { expectNoBlockingViolationsInBothThemes } from '../../support/axe';

/**
 * Editing and saving a file in the review shell's spot editor, end to end -
 * TASK_2026_576 Batch 61, Requirement 7.
 *
 * Nothing is mocked: the real renderer drives the real `file:viewContent` and
 * `file:saveContent` handlers against a real repository, and every outcome is
 * read back from the file on disk, never from a value the harness supplied.
 *
 *  1. Edit (the canvas section action) -> type -> Save writes the file.
 *  2. A CRLF file saves as CRLF; an LF file saves as LF.
 *  3. A change made on disk after the file was read is a conflict: the dialog
 *     names it, Keep editing loses nothing and writes nothing, and the
 *     explicit Overwrite then writes the edit.
 *  4. Back to review leaves focus on the page, not on the removed button, and
 *     asks before discarding unsaved edits.
 */

const TYPED = '// PTAH_E2E_EDIT';
const CONFLICT_TITLE = 'This file changed on disk since you opened it.';

async function saveButtonIdle(page: Page): Promise<void> {
  await expect(
    spotEditor(page).locator('[data-testid="spot-editor-save"]'),
  ).toBeDisabled();
}

/** Put the caret at the very end of the document and type `text`. */
async function typeAtEnd(page: Page, text: string): Promise<void> {
  await spotEditorContent(page).click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(text);
}

async function openEditable(
  page: Page,
  repo: ScratchRepo,
  relativePath: string,
): Promise<void> {
  await openFileInShell(page, relativePath, 1, {
    workspaceRoot: repo.root,
    editable: true,
  });
  await expect(
    spotEditor(page).locator('[data-testid="spot-editor-ro"]'),
  ).toHaveCount(0);
  await expect(spotEditorContent(page)).toHaveAttribute(
    'contenteditable',
    'true',
  );
}

test.describe('spot editor save, end to end in Electron (TASK_2026_576 Requirement 7)', () => {
  // A real boot into an empty home runs every SQLite migration from zero.
  test.setTimeout(240_000);

  test('canvas Edit -> change -> Save writes the file on disk, LF kept, and Back keeps focus', async ({
    ui,
    rpcBridge,
    repo,
  }) => {
    void rpcBridge;
    const page = ui.page;
    const onDisk = path.join(repo.root, THREE_HUNK_FILE);
    expect(fs.readFileSync(onDisk, 'utf8')).toBe(MODIFIED_CONTENT);

    await ui.goto('git');
    const section = ui.reviewFileSection(THREE_HUNK_FILE);
    await expect(section).toBeVisible({ timeout: 60_000 });

    // The canvas Edit action opens the same file editable.
    await section.locator('[data-testid="file-section-edit"]').click();
    const editor = spotEditor(page);
    await expect(editor.locator('[data-testid="spot-editor-path"]')).toHaveText(
      THREE_HUNK_FILE,
    );
    await expect(spotEditorContent(page)).toHaveAttribute(
      'contenteditable',
      'true',
    );
    await saveButtonIdle(page);

    await typeAtEnd(page, TYPED);
    const save = editor.locator('[data-testid="spot-editor-save"]');
    await expect(save).toBeEnabled();
    // Nothing reaches disk before Save.
    expect(fs.readFileSync(onDisk, 'utf8')).toBe(MODIFIED_CONTENT);

    await save.click();
    await saveButtonIdle(page);
    await expect
      .poll(() => fs.readFileSync(onDisk, 'utf8'))
      .toBe(MODIFIED_CONTENT + TYPED);
    expect(fs.readFileSync(onDisk, 'utf8')).not.toContain('\r');
    await expect(
      editor.locator('[data-testid="spot-editor-save-error"]'),
    ).toHaveCount(0);

    // Back to review: the editor goes, the canvas returns, focus is not lost.
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
  });

  test('the read-only spot editor has no critical or serious a11y violations in dark and light', async ({
    ui,
    rpcBridge,
    repo,
  }, testInfo) => {
    void rpcBridge;
    const page = ui.page;
    await ui.goto('git');
    await expect(ui.reviewFileSection(THREE_HUNK_FILE)).toBeVisible({
      timeout: 60_000,
    });
    // Read-only: the way a chat file link opens a file.
    await openFileInShell(page, THREE_HUNK_FILE, 1, {
      workspaceRoot: repo.root,
    });
    await expect(
      spotEditor(page).locator('[data-testid="spot-editor-ro"]'),
    ).toBeVisible({ timeout: 30_000 });
    await expect(spotEditorContent(page)).toBeVisible();
    await expectNoBlockingViolationsInBothThemes(
      page,
      'spot-editor-readonly',
      testInfo,
      { include: 'ptah-spot-editor', evidence: true },
    );
  });

  test('the editable spot editor has no critical or serious a11y violations in dark and light', async ({
    ui,
    rpcBridge,
    repo,
  }, testInfo) => {
    void rpcBridge;
    const page = ui.page;
    await ui.goto('git');
    await expect(ui.reviewFileSection(THREE_HUNK_FILE)).toBeVisible({
      timeout: 60_000,
    });
    await openEditable(page, repo, THREE_HUNK_FILE);
    await typeAtEnd(page, TYPED);
    await expect(
      spotEditor(page).locator('[data-testid="spot-editor-save"]'),
    ).toBeEnabled();
    await expectNoBlockingViolationsInBothThemes(
      page,
      'spot-editor-editable',
      testInfo,
      { include: 'ptah-spot-editor', evidence: true },
    );
  });

  test('a CRLF file saves as CRLF', async ({ ui, rpcBridge, repo }) => {
    void rpcBridge;
    const page = ui.page;
    const relative = 'notes/crlf.txt';
    const original = 'first line\r\nsecond line\r\nthird line\r\n';
    fs.mkdirSync(path.join(repo.root, 'notes'), { recursive: true });
    fs.writeFileSync(path.join(repo.root, relative), original, 'utf8');

    await ui.goto('git');
    await openEditable(page, repo, relative);
    await expect(spotEditorContent(page)).toContainText('second line');

    await typeAtEnd(page, 'tail');
    await spotEditor(page).locator('[data-testid="spot-editor-save"]').click();
    await saveButtonIdle(page);

    const target = path.join(repo.root, relative);
    await expect
      .poll(() => fs.readFileSync(target, 'utf8'))
      .toBe(original + 'tail');
    // Every line break on disk is still CRLF: no bare LF crept in.
    expect(fs.readFileSync(target, 'utf8').replace(/\r\n/g, '')).not.toContain(
      '\n',
    );
  });

  test('a conflicting change on disk shows the conflict, keeps the edit, and Overwrite then saves it', async ({
    ui,
    rpcBridge,
    repo,
  }) => {
    void rpcBridge;
    const page = ui.page;
    const target = path.join(repo.root, THREE_HUNK_FILE);
    const external = 'export const changedElsewhere = true;\n';

    await ui.goto('git');
    await openEditable(page, repo, THREE_HUNK_FILE);
    await expect(spotEditorContent(page)).toContainText('value10');
    await typeAtEnd(page, TYPED);

    // Another program rewrites the file after the editor read it.
    fs.writeFileSync(target, external, 'utf8');

    const editor = spotEditor(page);
    await editor.locator('[data-testid="spot-editor-save"]').click();

    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toContainText(CONFLICT_TITLE);
    // The conflicting save wrote nothing.
    expect(fs.readFileSync(target, 'utf8')).toBe(external);

    // Keep editing: the dialog closes, the edit stays, the file is marked stale.
    await dialog.locator('[data-testid="git-confirm-cancel"]').click();
    await expect(dialog).toHaveCount(0);
    expect((await spotEditorLines(page)).at(-1)).toBe(TYPED);
    await expect(
      editor.locator('[data-testid="spot-editor-stale"]'),
    ).toBeVisible();
    expect(fs.readFileSync(target, 'utf8')).toBe(external);

    // Save asks again; the explicit Overwrite writes the edit.
    await editor.locator('[data-testid="spot-editor-save"]').click();
    await expect(dialog).toContainText(CONFLICT_TITLE);
    await dialog.locator('[data-testid="git-confirm-confirm"]').click();
    await expect
      .poll(() => fs.readFileSync(target, 'utf8'))
      .toBe(MODIFIED_CONTENT + TYPED);
    await expect(
      editor.locator('[data-testid="spot-editor-stale"]'),
    ).toHaveCount(0);
  });

  test('Back to review with unsaved edits asks first, and Cancel keeps the editor and the edit', async ({
    ui,
    rpcBridge,
    repo,
  }) => {
    void rpcBridge;
    const page = ui.page;
    const target = path.join(repo.root, THREE_HUNK_FILE);

    await ui.goto('git');
    await openEditable(page, repo, THREE_HUNK_FILE);
    await typeAtEnd(page, TYPED);

    const editor = spotEditor(page);
    await editor.locator('[data-testid="spot-editor-back"]').click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toContainText('Discard unsaved changes?');
    await dialog.locator('[data-testid="git-confirm-cancel"]').click();
    await expect(dialog).toHaveCount(0);

    await expect(editor).toHaveCount(1);
    expect((await spotEditorLines(page)).at(-1)).toBe(TYPED);
    expect(fs.readFileSync(target, 'utf8')).toBe(MODIFIED_CONTENT);
  });
});
