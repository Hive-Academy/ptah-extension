import type { Locator, Page } from '@playwright/test';

/**
 * Helpers for the review shell's spot editor (`ptah-spot-editor`, CodeMirror 6)
 * - TASK_2026_576 Batch 61. Shared by `file-view-tab`, `agent-file-links` and
 *   `spot-editor-save`.
 *
 * The editor is reached the way a user reaches it: a chat file link, or the
 * canvas "Edit" action. The two helpers that look through Angular's debug
 * context (`ng`, present in the dev build the e2e launches) only read a value
 * the DOM does not expose: the caret column.
 */

/** The spot editor host inside the review shell. */
export function spotEditor(page: Page): Locator {
  return page.locator('ptah-review-shell ptah-spot-editor');
}

/** The CodeMirror editable surface of the spot editor. */
export function spotEditorContent(page: Page): Locator {
  return spotEditor(page).locator('.cm-content');
}

/** The editor's document text, lines joined with `\n` (display text). */
export async function spotEditorLines(page: Page): Promise<string[]> {
  return spotEditorContent(page)
    .locator('.cm-line')
    .evaluateAll((lines) => lines.map((line) => line.textContent ?? ''));
}

interface SpotEditorDebug {
  handle?: { cursor(): { line: number; column: number } };
}

/** The 1-based caret position, or `null` while no document is mounted. */
export async function spotEditorCursor(
  page: Page,
): Promise<{ line: number; column: number } | null> {
  return page.evaluate(() => {
    const host = document.querySelector('ptah-spot-editor');
    const angular = (
      window as unknown as {
        ng?: { getComponent(element: Element): SpotEditorDebug };
      }
    ).ng;
    if (!host || !angular) return null;
    return angular.getComponent(host).handle?.cursor() ?? null;
  });
}

/**
 * Open a file in the review shell the way the file-link router does:
 * `ReviewNavigationService.openFile`, reached through the shell component's
 * injected service. Used where a spec needs the open options (workspace root,
 * document path, editable) without composing chat markdown first.
 */
export async function openFileInShell(
  page: Page,
  path: string,
  line: number | undefined,
  options: {
    column?: number;
    workspaceRoot?: string;
    documentPath?: string;
    editable?: boolean;
  } = {},
): Promise<void> {
  await page.evaluate(
    ({ path: filePath, line: lineNumber, options: openOptions }) => {
      const shell = document.querySelector('ptah-review-shell');
      const angular = (
        window as unknown as {
          ng?: {
            getComponent(element: Element): {
              navigation: {
                openFile(
                  path: string,
                  line?: number,
                  options?: Record<string, unknown>,
                ): void;
              };
            };
          };
        }
      ).ng;
      if (!shell || !angular) {
        throw new Error('Angular review shell debug context is unavailable.');
      }
      angular
        .getComponent(shell)
        .navigation.openFile(filePath, lineNumber, openOptions);
    },
    { path, line, options },
  );
}
