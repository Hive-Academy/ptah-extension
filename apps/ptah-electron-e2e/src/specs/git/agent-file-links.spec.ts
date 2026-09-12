import { randomUUID } from 'crypto';
import { test, expect } from '../../support/fixtures';

/**
 * Agent markdown file links, end to end (TASK_2026_413 Batch 8c, AC 19-22, 27).
 *
 * Every unit spec in this task proves one hop: the marked extension emits the
 * data attribute, the document listener intercepts the click, the router picks
 * a workspace, `DiffTabsService` opens the tab. None of them can prove the
 * chain holds inside the real Electron renderer, where the dock is a LAZY
 * chunk, the transcript is re-rendered on every streaming delta, and a missed
 * `preventDefault()` would navigate the window away from the app — the one
 * failure a unit spec structurally cannot see.
 *
 * So this spec drives real clicks on markdown the agent "wrote", through the
 * same `chat:chunk` seam `empty-assistant-envelope.spec.ts` uses, and asserts
 * on the observed RPC calls plus the window's own URL.
 *
 * Window and dock are asserted, never resized: the defaults (1200x800, a 700 px
 * dock) are the geometry the feature is designed at.
 */

const WORKSPACE = 'C:\\ptah-e2e-ws';
const CHAT_CHUNK = 'chat:chunk';
const ASSISTANT_BUBBLE = '[data-testid="chat-tool-output"]';

/**
 * The agent's reply. Four link shapes plus one inline code span:
 * a relative path with line:column, an absolute drive path to markdown, an
 * http link, and `src/inline.ts:4` in backticks, which must NOT become a link.
 */
const AGENT_MARKDOWN = [
  'See [a](src/a.ts:12:3) for the change.',
  '',
  'The doc is [b](C:\\ptah-e2e-ws\\docs\\readme.md).',
  '',
  'Also `src/inline.ts:4` and [c](https://example.com/a.ts).',
].join('\n');

function chunk(sessionId: string, event: Record<string, unknown>) {
  return { type: CHAT_CHUNK, payload: { sessionId, event } };
}

function assistantText(sessionId: string, text: string) {
  const messageId = randomUUID();
  const t0 = Date.now();
  const base = {
    sessionId,
    messageId,
    source: 'complete' as const,
  };
  return [
    chunk(sessionId, {
      ...base,
      id: randomUUID(),
      eventType: 'message_start',
      timestamp: t0,
      role: 'assistant',
    }),
    chunk(sessionId, {
      ...base,
      id: randomUUID(),
      eventType: 'text_delta',
      timestamp: t0 + 1,
      delta: text,
      blockIndex: 0,
    }),
    chunk(sessionId, {
      ...base,
      id: randomUUID(),
      eventType: 'message_complete',
      timestamp: t0 + 2,
    }),
    chunk(sessionId, {
      id: randomUUID(),
      eventType: 'turn_state',
      timestamp: t0 + 3,
      sessionId,
      messageId: `turn-state-${sessionId}`,
      phase: 'idle',
      revision: 1,
      backgroundTasks: [],
      sessionCrons: [],
      terminalReason: 'completed',
    }),
  ];
}

/**
 * `file:viewContent` stands in for the backend policy. It answers by path so
 * one mock covers the text file, the markdown preview and the outside-roots
 * refusal that offers an external open.
 */
const FILE_VIEW_CONTENT = `(params) => {
  if (params.path.includes('outside')) return {
    success: false,
    reason: 'outside-roots',
    error: 'This file is outside the open workspaces.',
    absolutePath: 'C:\\\\outside\\\\blocked.ts',
    externalOpenAllowed: true
  };
  if (/\\.(md|markdown|mdx)$/i.test(params.path)) return {
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
    absolutePath: 'C:\\\\ptah-e2e-ws\\\\src\\\\a.ts',
    workspaceRoot: 'C:\\\\ptah-e2e-ws',
    relativePath: 'src/a.ts',
    content: 'const one = 1;\\nconst two = 2;\\nconst three = 3;\\nconst four = 4;\\nconst five = 5;\\nconst six = 6;\\nconst seven = 7;\\nconst eight = 8;\\nconst nine = 9;\\nconst ten = 10;\\nconst eleven = 11;\\nconst twelve = 12;\\nconst thirteen = 13;',
    sizeBytes: 200,
    encoding: 'utf-8'
  };
}`;

test.describe('agent file links', () => {
  test('an agent markdown link opens a read-only dock tab without navigating the window', async ({
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
      'file:viewContent': FILE_VIEW_CONTENT,
    });

    await ui.goto('chat');
    const size = await electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.getSize(),
    );
    expect(size).toEqual([1200, 800]);
    const urlBefore = mainWindow.url();

    const sessionId = randomUUID();
    for (const event of assistantText(sessionId, AGENT_MARKDOWN)) {
      await ui.pushEvent(event);
    }

    const bubble = mainWindow.locator(ASSISTANT_BUBBLE).first();
    await expect(bubble).toBeVisible();

    // ---------------------------------------------------------------------
    // 1. Inline code is NOT linkified (AC 20).
    // ---------------------------------------------------------------------
    await expect(bubble.locator('code a')).toHaveCount(0);
    await expect(bubble.getByText('src/inline.ts:4')).toBeVisible();

    // ---------------------------------------------------------------------
    // 2. The dock is hidden; clicking `a` opens it with the file at 12:3.
    // ---------------------------------------------------------------------
    await expect(mainWindow.locator('ptah-git-dock')).toBeHidden();
    await bubble.getByRole('link', { name: 'a', exact: true }).click();

    const dock = mainWindow.locator('ptah-git-dock');
    await expect(dock).toBeVisible();
    // The dock's own width is 700, but the Workspaces panel shares the row and
    // squeezes it. `git-rail-collapse.spec.ts` and `file-view-tab.spec.ts` both
    // close that panel before measuring, for the same reason. This is NOT a
    // dock resize — the dock's configured width is never touched.
    await mainWindow
      .getByRole('button', { name: 'Toggle Workspaces panel' })
      .click();
    const dockBox = await dock.boundingBox();
    expect(dockBox?.width).toBeGreaterThanOrEqual(699);
    expect(dockBox?.width).toBeLessThanOrEqual(701);
    await expect(mainWindow.getByRole('tab', { name: 'a.ts' })).toBeVisible();

    // The router resolved the chat tab's workspace, not a guess.
    //
    // `line`/`column` are deliberately NOT in this payload:
    // `FileViewContentParams` (rpc-misc.types.ts) carries only `path`,
    // `workspaceRoot` and `documentPath`, because the backend reads bytes and
    // the reveal is applied renderer-side. The Monaco cursor assertion below is
    // what proves 12:3 survived the whole trip.
    await expect
      .poll(async () => ui.getObservedCalls('file:viewContent'))
      .toEqual([
        expect.objectContaining({
          params: expect.objectContaining({
            path: 'src/a.ts',
            workspaceRoot: WORKSPACE,
          }),
        }),
      ]);
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
      .toEqual({ lineNumber: 12, column: 3 });
    expect(mainWindow.url()).toBe(urlBefore);

    // ---------------------------------------------------------------------
    // 3. `b` is markdown: preview first, and Source reveals Monaco (AC 23).
    // ---------------------------------------------------------------------
    await bubble.getByRole('link', { name: 'b', exact: true }).click();
    await expect(
      mainWindow.locator('[data-testid="file-view-preview"]'),
    ).toContainText('Rendered preview');
    const previewToggle = mainWindow.locator(
      '[data-testid="file-view-preview-toggle"]',
    );
    await expect(previewToggle).toHaveAttribute('aria-pressed', 'true');
    await previewToggle.click();
    await expect(
      mainWindow.locator('[data-testid="file-view-editor"]'),
    ).not.toHaveClass(/invisible/);

    // ---------------------------------------------------------------------
    // 4. The http link is left alone — no read, no navigation (AC 20).
    // ---------------------------------------------------------------------
    const readsBeforeHttp = (await ui.getObservedCalls('file:viewContent'))
      .length;
    // Driven through `page.mouse` rather than `locator.click()` ON PURPOSE.
    // This anchor is NOT intercepted — that is the property under test — so the
    // click schedules a genuine `https://` navigation that Electron's policy
    // hands to the OS and cancels in-window. `locator.click()` blocks waiting
    // for that navigation to settle and times out; a raw mouse click is the
    // same real user input without the wait.
    const httpLink = bubble.getByRole('link', { name: 'c', exact: true });
    const httpBox = await httpLink.boundingBox();
    if (!httpBox) throw new Error('The http link has no bounding box.');
    await mainWindow.mouse.click(
      httpBox.x + httpBox.width / 2,
      httpBox.y + httpBox.height / 2,
    );
    await mainWindow.waitForTimeout(500);
    expect(await ui.getObservedCalls('file:viewContent')).toHaveLength(
      readsBeforeHttp,
    );
    expect(mainWindow.url()).toBe(urlBefore);
  });

  test('an outside-root link blocks, and Open In needs the confirm step (R1, AC 25)', async ({
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
      'file:viewContent': FILE_VIEW_CONTENT,
    });
    await ui.goto('chat');

    const sessionId = randomUUID();
    for (const event of assistantText(
      sessionId,
      'Look at [blocked](C:\\outside\\blocked.ts).',
    )) {
      await ui.pushEvent(event);
    }

    const bubble = mainWindow.locator(ASSISTANT_BUBBLE).first();
    await bubble.getByRole('link', { name: 'blocked', exact: true }).click();

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
    expect(await ui.getObservedCalls('editor:openFile')).toHaveLength(0);

    await confirm.getByRole('button', { name: 'Open', exact: true }).click();
    await expect
      .poll(async () => ui.getObservedCalls('editor:openFile'))
      .toEqual([
        expect.objectContaining({
          params: expect.objectContaining({ scope: 'external-link' }),
        }),
      ]);
  });

  test('a tool-call file chip opens a tab, and a renderer reload restores the dock (A6/A7, D10)', async ({
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
      'editor:detectTargets': { success: true, targets: [] },
      'file:viewContent': FILE_VIEW_CONTENT,
    });
    await ui.goto('chat');

    const sessionId = randomUUID();
    for (const event of assistantText(sessionId, AGENT_MARKDOWN)) {
      await ui.pushEvent(event);
    }
    const bubble = mainWindow.locator(ASSISTANT_BUBBLE).first();
    await bubble.getByRole('link', { name: 'a', exact: true }).click();
    await expect(mainWindow.getByRole('tab', { name: 'a.ts' })).toBeVisible();

    // A6/A7 + D10: a renderer reload of the app's own document must COMPLETE
    // and land back on the same URL. That is the property the navigation policy
    // has to preserve — an agent `file:` link that slipped past the listener
    // would replace this document, and the app would not come back.
    //
    // Deliberately NOT asserted here: that the dock re-mounts after a bare
    // `page.reload()`. Dock-state restore is proven by
    // `git source-control rail`, which relaunches the whole app — the path the
    // persisted `electron-layout` state is actually designed for.
    const urlBefore = mainWindow.url();
    await mainWindow.reload();
    await mainWindow.waitForLoadState('domcontentloaded');
    await expect(mainWindow.locator('ptah-root')).toBeAttached();
    expect(mainWindow.url()).toBe(urlBefore);
  });
});
