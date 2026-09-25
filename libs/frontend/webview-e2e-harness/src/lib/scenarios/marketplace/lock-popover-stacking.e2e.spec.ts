/**
 * E2E regression: the lock-badge popover of a blocked MCP-server row must sit
 * above the rows that follow it (TASK_2026_533 Batch 25a, defect found by
 * Batch 25).
 *
 * The defect: the table's action cell was `relative z-10`, which made every
 * action cell its own stacking context. The popover panel (`position: fixed;
 * z-index: 50`, rendered in place by `NativePopoverComponent`) could only
 * rank inside its own cell, so the following rows' action cells — also
 * `z-10`, later in tree order — painted over the panel and took its clicks
 * (the next row's "Blocked" pill, and the Copy button under a later row's
 * Remove button). The compact card list had the same wrapper, plus a hover
 * lift (`transform`) that the popover's own backdrop keeps active, which made
 * the card a stacking context and the `fixed` containing block.
 *
 * Self-contained on purpose: the host config and the `rpc:response`
 * auto-responder follow `../thoth/skills-lane-pickers.e2e.spec.ts`'s pattern,
 * and the installed-server data is the minimal slice of the Batch 25
 * marketplace fixture (`prototype-brief.md:42-69`) this scenario needs —
 * `sentry` blocked and NOT the last row, `sonarqube` blocked after it, and two
 * removable rows after those so the panel's Copy button lands on a later row.
 */
import type { Page } from '@playwright/test';
import { test, expect } from '../../test-fixtures';
import { installPostMessageBridge } from '../../postmessage-bridge';
import { installCspStub } from '../../csp-stub';

test.use({ useAppBuild: true });

/** One `InstalledMcpServer` row (`mcp-directory.types.ts`). */
function installedServer(
  serverKey: string,
  blocked: boolean,
): Record<string, unknown> {
  return {
    serverKey,
    target: 'claude',
    configPath: blocked
      ? 'C:\\Users\\dev\\.claude.json'
      : `C:\\Users\\dev\\.ptah\\mcp\\${serverKey}.json`,
    config: { type: 'stdio', command: 'npx', args: ['-y', serverKey] },
    managedByPtah: !blocked,
    origin: blocked ? 'claude-user' : 'harness-config',
    originLabel: blocked ? 'Claude CLI' : 'Config file',
    removal: blocked ? 'none' : 'ptah-managed',
    ...(blocked
      ? {
          removalBlockedReason:
            `"${serverKey}" is declared in ~/.claude.json, which belongs to ` +
            'the Claude CLI — Ptah reads it and never writes it.',
          removalFixCommand: `claude mcp remove ${serverKey}`,
        }
      : {}),
  };
}

const RPC_FIXTURES: Record<string, unknown> = {
  'workspace:getInfo': {
    folders: ['C:\\ptah-e2e-ws-a'],
    activeFolder: 'C:\\ptah-e2e-ws-a',
  },
  'mcpDirectory:listInstalled': {
    servers: [
      installedServer('firecrawl', false),
      installedServer('sentry', true),
      installedServer('sonarqube', true),
      installedServer('tavily', false),
      installedServer('zapier', false),
    ],
  },
  'mcpDirectory:listOAuthConnected': { servers: [] },
  'mcpDirectory:listSmitheryConnections': { connections: [], namespace: null },
};

/** Real VS Code webview host config, booting straight into the Marketplace. */
async function installVSCodeMarketplaceHost(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as { ptahConfig?: unknown }).ptahConfig = {
      isVSCode: true,
      theme: 'dark',
      extensionUri: '',
      baseUri: '',
      iconUri: '',
      userIconUri: '',
      panelId: 'e2e-harness',
      platform: 'win32',
      initialView: 'marketplace',
    };
  });
}

/**
 * Answer every `rpc:call` whose method has a fixture; leave the rest
 * unanswered (their own loading state covers them). MUST run after
 * `installPostMessageBridge` and before `page.goto`.
 */
async function installRpcAutoResponder(
  page: Page,
  fixtures: Record<string, unknown>,
): Promise<void> {
  await page.addInitScript((serialized: string) => {
    const answers = JSON.parse(serialized) as Record<string, unknown>;
    const w = window as unknown as {
      acquireVsCodeApi?: () => { postMessage: (msg: unknown) => void };
      vscode?: unknown;
    };
    if (typeof w.acquireVsCodeApi !== 'function') {
      return;
    }
    const api = w.acquireVsCodeApi();
    const originalPostMessage = api.postMessage.bind(api);
    api.postMessage = (msg: unknown): void => {
      originalPostMessage(msg);
      const envelope = msg as {
        type?: string;
        payload?: { method?: string; correlationId?: string };
      };
      const method = envelope?.payload?.method;
      if (
        envelope?.type !== 'rpc:call' ||
        !method ||
        !Object.prototype.hasOwnProperty.call(answers, method)
      ) {
        return;
      }
      const correlationId = envelope.payload?.correlationId;
      queueMicrotask(() => {
        window.dispatchEvent(
          new MessageEvent('message', {
            data: {
              type: 'rpc:response',
              correlationId,
              success: true,
              data: answers[method],
            },
          }),
        );
      });
    };
    w.vscode = api;
  }, JSON.stringify(fixtures));
}

/**
 * Boot the Marketplace at `width` (with a working clipboard stub), open
 * `sentry`'s lock popover and check the panel overlaps the next row.
 * `rowSelector` maps a row ref to the table row or the card.
 */
async function openSentryPopover(
  page: Page,
  baseUrl: string,
  width: number,
  rowSelector: (ref: string) => string,
): Promise<void> {
  await installCspStub(page);
  await installPostMessageBridge(page);
  await installVSCodeMarketplaceHost(page);
  await installRpcAutoResponder(page, RPC_FIXTURES);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: (text: string) => {
          (window as unknown as { __copied?: string }).__copied = text;
          return Promise.resolve();
        },
      },
    });
  });
  await page.goto(baseUrl);
  await page.setViewportSize({ width, height: 900 });
  await page.locator('a[data-nav-id="servers"]').click();

  const sentry = page.locator(rowSelector('claude-user:sentry'));
  const next = page.locator(rowSelector('claude-user:sonarqube'));
  await expect(sentry).toBeVisible();
  await expect(next).toBeVisible();
  // The scenario only means something while `sentry` is followed by a row.
  const [sentryIndex, nextIndex] = await Promise.all(
    [sentry, next].map((row) =>
      row.evaluate((el) =>
        Array.from(el.parentElement?.children ?? []).indexOf(el),
      ),
    ),
  );
  expect(nextIndex).toBeGreaterThan(sentryIndex);

  await sentry.locator('[data-testid="removal-lock-button"]').click();
  const details = page.locator('[data-testid="removal-lock-details"]');
  await expect(details).toBeVisible();
  await expect(page.locator('[data-testid="removal-fix-command"]')).toHaveText(
    'claude mcp remove sentry',
  );

  // The panel overlaps the next row — otherwise this proves nothing.
  const panelBox = await details.boundingBox();
  const nextBox = await next.boundingBox();
  if (!panelBox || !nextBox) {
    throw new Error('popover panel or next row has no layout box');
  }
  expect(panelBox.y).toBeLessThan(nextBox.y + nextBox.height);
  expect(panelBox.y + panelBox.height).toBeGreaterThan(nextBox.y);
}

/**
 * Hit-test a 5x5 grid across the popover panel; every point must land inside
 * it. Returns the points that did not, with the element that took each.
 */
async function pointsNotOnPanel(page: Page): Promise<string[]> {
  return page
    .locator('[data-testid="removal-lock-details"]')
    .evaluate((details) => {
      const panel = details.closest('.popover-panel') ?? details;
      const box = panel.getBoundingClientRect();
      const misses: string[] = [];
      for (let i = 0; i < 5; i++) {
        for (let j = 0; j < 5; j++) {
          const x = box.left + 4 + ((box.width - 8) * i) / 4;
          const y = box.top + 4 + ((box.height - 8) * j) / 4;
          const hit = document.elementFromPoint(x, y);
          if (!hit || !panel.contains(hit)) {
            const taker = hit ? hit.outerHTML.slice(0, 80) : 'nothing';
            misses.push(`(${Math.round(x)},${Math.round(y)}) -> ${taker}`);
          }
        }
      }
      return misses;
    });
}

/** Hit-test the Copy button's centre, then click it for real and check the copy. */
async function expectCopyButtonTakesTheClick(page: Page): Promise<void> {
  const copyButton = page.locator('[data-testid="copy-command-button"]');
  const hitIsCopyButton = await copyButton.evaluate((button) => {
    const box = button.getBoundingClientRect();
    const hit = document.elementFromPoint(
      box.left + box.width / 2,
      box.top + box.height / 2,
    );
    return hit !== null && button.contains(hit);
  });
  expect(hitIsCopyButton).toBe(true);

  // A real click: Playwright's actionability check fails when another element
  // would receive it.
  await copyButton.click();
  const copied = await page.evaluate(
    () => (window as unknown as { __copied?: string }).__copied ?? '',
  );
  expect(copied).toBe('claude mcp remove sentry');
  await expect(page.locator('[data-testid="copy-command-status"]')).toHaveText(
    'Copied',
  );
}

test.describe('webview > marketplace > lock-badge popover stacking', () => {
  test('table (regular tier): the popover of a non-last blocked row paints above the following rows, and its Copy button takes the click', async ({
    page,
    fixtureServer,
  }) => {
    await openSentryPopover(
      page,
      fixtureServer.url,
      1100,
      (ref) => `[data-testid="provider-table"] tr[data-ref="${ref}"]`,
    );
    expect(await pointsNotOnPanel(page)).toEqual([]);
    await expectCopyButtonTakesTheClick(page);
  });

  test('cards (compact tier): the popover of a non-last blocked card paints above the following cards, and its Copy button takes the click', async ({
    page,
    fixtureServer,
  }) => {
    await openSentryPopover(
      page,
      fixtureServer.url,
      400,
      (ref) => `[data-testid="provider-card"][data-ref="${ref}"]`,
    );
    // The backdrop must cover the viewport, not only the hovered card.
    const backdrop = await page
      .locator('[data-testid="removal-lock-details"]')
      .evaluate((details) => {
        const panel = details.closest('.popover-panel');
        const box = panel?.previousElementSibling?.getBoundingClientRect();
        return box ? { width: box.width, height: box.height } : null;
      });
    expect(backdrop).toEqual(page.viewportSize());
    expect(await pointsNotOnPanel(page)).toEqual([]);
    await expectCopyButtonTakesTheClick(page);
  });
});
