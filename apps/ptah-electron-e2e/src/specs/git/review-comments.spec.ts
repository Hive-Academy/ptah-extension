import type { Locator } from '@playwright/test';
import { test, expect } from '../../support/fixtures';
import { gitDiffFileMock } from '../../support/git-diff-mock';
import type { UiDriver } from '../../support/ui-driver';

/**
 * Review comments to the agent - TASK_2026_576 Batch 60, Requirement 6.7.
 *
 * A reviewer drafts a comment on lines of a changed file in the canvas, the
 * draft shows in the footer bar ("N draft comments"), and "Send to agent"
 * delivers ONE message - path, `Lstart-Lend`, the quoted lines and the comment -
 * through `AGENT_FEEDBACK_SENDER` (`ChatAgentFeedbackSender`), which routes it
 * as an ordinary chat turn into the active session tile. The send is observed
 * the way the other chat specs observe it: the main-process fake RPC listener
 * records the `chat:start` / `chat:continue` call and its `prompt`.
 *
 * The comment UI today is the file header's "Comment" action, which opens a
 * small composer (side, from/to line, text) - the keyboard-reachable form of
 * the gutter comment (the batch 38 accepted deviation). Drafts clear only on
 * `sent: true`; a failed send keeps them and shows the sender's sentence.
 */

const FILE_PATH = 'src/comments/target.ts';
const FILE_LINES = 30;
const CHANGED_LINE = 12;
const MODIFIED_LINE_TEXT = "export const target = 'reviewed';";
const COMMENT_BODY = 'PTAH_E2E_REVIEW_COMMENT: rename this constant';

function side(modified: boolean): string {
  const lines: string[] = [];
  for (let line = 1; line <= FILE_LINES; line++) {
    lines.push(
      line === CHANGED_LINE
        ? modified
          ? MODIFIED_LINE_TEXT
          : "export const target = 'original';"
        : `export const filler${line} = ${line};`,
    );
  }
  return lines.join('\n') + '\n';
}

async function openCanvasWithChatTile(ui: UiDriver): Promise<Locator> {
  await ui.mockRpc({
    'git:diffFile': gitDiffFileMock({
      path: FILE_PATH,
      comparison: 'worktree',
      original: side(false),
      modified: side(true),
      snapshotToken: 'comments-snapshot',
    }),
  });
  // A chat tile must exist: "Send to agent" goes to the active session.
  await ui.goto('chat');
  await ui.goto('git');
  await ui.pushEvent({
    type: 'git:status-update',
    payload: {
      branch: { branch: 'main', upstream: null, ahead: 0, behind: 0 },
      files: [
        { path: FILE_PATH, status: 'M', staged: false, isDirectory: false },
      ],
      isGitRepo: true,
    },
  });
  const section = ui.reviewFileSection(FILE_PATH);
  await expect(section.getByText(MODIFIED_LINE_TEXT)).toBeVisible({
    timeout: 60_000,
  });
  return section;
}

async function draftComment(
  ui: UiDriver,
  section: Locator,
  from: number,
  to: number,
): Promise<void> {
  await section.locator('[data-testid="file-section-comment"]').click();
  const composer = ui.page.locator('[data-testid="comment-composer"]');
  await expect(composer).toBeVisible();
  await composer.locator('[data-testid="comment-from"]').fill(String(from));
  await composer.locator('[data-testid="comment-to"]').fill(String(to));
  await composer.locator('[data-testid="comment-body"]').fill(COMMENT_BODY);
  await composer.locator('[data-testid="comment-add"]').click();
  await expect(composer).toHaveCount(0);
}

function promptOf(call: { params: unknown }): string {
  return (call.params as { prompt?: string } | null)?.prompt ?? '';
}

test.describe('review comments to the agent (Requirement 6.7)', () => {
  test.setTimeout(120_000);

  test('a line comment on the diff is sent to the active agent session and the draft clears', async ({
    ui,
  }) => {
    await ui.mockRpc({ 'chat:start': { success: true } });
    const section = await openCanvasWithChatTile(ui);
    const page = ui.page;

    // No drafts: no footer bar.
    await expect(
      page.locator('[data-testid="draft-comments-bar"]'),
    ).toHaveCount(0);

    await draftComment(ui, section, CHANGED_LINE, CHANGED_LINE + 1);

    const bar = page.locator('[data-testid="draft-comments-bar"]');
    await expect(bar).toBeVisible();
    await expect(bar).toContainText('1 draft comment');
    await bar.locator('[data-testid="draft-comments-toggle"]').click();
    const list = page.locator('[data-testid="draft-comments-list"]');
    await expect(list).toContainText(
      `${FILE_PATH} L${CHANGED_LINE}-L${CHANGED_LINE + 1}`,
    );
    await expect(list).toContainText(COMMENT_BODY);
    await page.keyboard.press('Escape');

    // Nothing is sent until the reviewer asks.
    expect(await ui.getObservedCalls('chat:start')).toHaveLength(0);

    await bar.locator('[data-testid="draft-comments-send"]').click();

    const call = await ui.waitForObservedCall('chat:start');
    const prompt = promptOf(call);
    expect(prompt).toContain(FILE_PATH);
    expect(prompt).toContain(`L${CHANGED_LINE}-L${CHANGED_LINE + 1}`);
    expect(prompt).toContain(MODIFIED_LINE_TEXT);
    expect(prompt).toContain(COMMENT_BODY);

    // `sent: true` clears the drafts and announces it.
    await expect(
      page.locator('[data-testid="draft-comments-bar"]'),
    ).toHaveCount(0);
    await expect(
      page.locator('[data-testid="draft-comments-status"]'),
    ).toHaveText('Sent 1 comment to the agent.');
    expect(await ui.getObservedCalls('chat:start')).toHaveLength(1);
  });

  test('a comment range outside the file is refused in the composer and no draft is created', async ({
    ui,
  }) => {
    const section = await openCanvasWithChatTile(ui);
    const page = ui.page;

    await section.locator('[data-testid="file-section-comment"]').click();
    const composer = page.locator('[data-testid="comment-composer"]');
    await composer.locator('[data-testid="comment-from"]').fill('1');
    await composer.locator('[data-testid="comment-to"]').fill('999');
    await composer.locator('[data-testid="comment-add"]').click();

    await expect(
      composer.locator('[data-testid="comment-error"]'),
    ).toContainText(`Choose lines between 1 and`);
    await expect(
      page.locator('[data-testid="draft-comments-bar"]'),
    ).toHaveCount(0);
  });

  test('a failed send keeps the draft and shows why', async ({ ui }) => {
    await ui.mockRpc({
      'chat:start': { success: false, error: 'PTAH_E2E_SEND_REFUSED' },
    });
    const section = await openCanvasWithChatTile(ui);
    const page = ui.page;

    await draftComment(ui, section, CHANGED_LINE, CHANGED_LINE);
    const bar = page.locator('[data-testid="draft-comments-bar"]');
    await bar.locator('[data-testid="draft-comments-send"]').click();
    await ui.waitForObservedCall('chat:start');

    await expect(
      page.locator('[data-testid="draft-comments-error"]'),
    ).toBeVisible();
    await expect(bar).toContainText('1 draft comment');
  });
});
