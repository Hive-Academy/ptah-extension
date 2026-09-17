import type { ElectronApplication, Locator } from '@playwright/test';
import type { RpcUserErrorCode } from '@ptah-extension/shared';
import { test, expect } from '../../support/fixtures';
import {
  makeSessionFixture,
  makeSparsePagingSessionFixture,
  prepareCanvasWithSessions,
  sessionRowButton,
  type SessionFixture,
} from '../../support/perf-session-fixture';

const LOAD_OLDER_EVENTS = 420;

type TestUi = Parameters<typeof prepareCanvasWithSessions>[0];

interface AnchorMeasurement {
  readonly scrollTopBefore: number;
  readonly scrollTopAfter: number;
  readonly scrollHeightBefore: number;
  readonly scrollHeightAfter: number;
  readonly distanceFromBottomBefore: number;
  readonly prependedHeight: number;
  readonly offsetDelta: number;
  readonly messageIds: readonly string[];
}

// The renderer's RpcResponse interface is private to ClaudeRpcService, so the
// e2e listener keeps this wire-only discriminator extension local and checked.
interface RendererRpcFailureEnvelope {
  readonly type: 'rpc:response';
  readonly correlationId: string;
  readonly success: false;
  readonly error: string;
  readonly errorCode: RpcUserErrorCode;
}

async function openSession(
  ui: TestUi,
  session: SessionFixture,
): Promise<Locator> {
  await sessionRowButton(ui.page, session.name).click();
  const tile = ui.page
    .locator('[data-testid="canvas-tile"]')
    .filter({ hasText: session.marker });
  await expect(tile).toBeVisible();
  return tile;
}

async function measureAnchorPrepend(
  ui: TestUi,
  label: string,
  requestedScrollTop: number,
): Promise<AnchorMeasurement> {
  const session = makeSessionFixture(label, LOAD_OLDER_EVENTS);
  const tailCursor = session.paging.tail.olderCursor;
  expect(tailCursor).not.toBeNull();
  expect(session.paging.olderPages[tailCursor ?? '']?.olderCursor).toBeNull();

  // Isolate the product's supported button-only fallback for these manual-path
  // anchor cases. Otherwise the armed IntersectionObserver sentinel can load
  // during the required stability wait, before the measured button activation.
  await ui.page.evaluate(() => {
    Object.defineProperty(window, 'IntersectionObserver', {
      configurable: true,
      value: undefined,
    });
  });
  await prepareCanvasWithSessions(ui, [session]);
  const tile = await openSession(ui, session);
  await expect(
    tile.getByRole('button', { name: 'Load earlier messages' }),
  ).toBeVisible();
  expect(await ui.getObservedCalls('chat:history-page')).toHaveLength(0);

  const measurement = await tile.evaluate(async (host, targetScrollTop) => {
    const container = host.querySelector(
      '.chat-scroll-container',
    ) as HTMLElement | null;
    const button = Array.from(host.querySelectorAll('button')).find(
      (candidate) => candidate.textContent?.trim() === 'Load earlier messages',
    );
    if (!container || !button) {
      throw new Error('load-older controls were not found');
    }

    const TARGET_TOLERANCE_PX = 1;
    const MAX_STEP_PX = 350;
    const REQUIRED_STABLE_FRAMES = 8;
    const MUTATION_QUIET_MS = 300;
    const MAX_CONVERGENCE_ATTEMPTS = 16;
    const ATTEMPT_SETTLE_TIMEOUT_MS = 2_000;
    const nextFrame = (): Promise<void> =>
      new Promise((resolve) => requestAnimationFrame(() => resolve()));

    let lastMutationAt = performance.now();
    const mutationObserver = new MutationObserver(() => {
      lastMutationAt = performance.now();
    });
    mutationObserver.observe(container, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });

    let settled = false;
    try {
      for (let attempt = 1; attempt <= MAX_CONVERGENCE_ATTEMPTS; attempt++) {
        while (
          Math.abs(container.scrollTop - targetScrollTop) > TARGET_TOLERANCE_PX
        ) {
          const remaining = targetScrollTop - container.scrollTop;
          container.scrollTop +=
            Math.sign(remaining) * Math.min(Math.abs(remaining), MAX_STEP_PX);
          container.dispatchEvent(new Event('scroll'));
          await nextFrame();
        }

        const settleDeadline = performance.now() + ATTEMPT_SETTLE_TIMEOUT_MS;
        let stableFrames = 0;
        while (performance.now() < settleDeadline) {
          await nextFrame();
          if (
            Math.abs(container.scrollTop - targetScrollTop) <=
            TARGET_TOLERANCE_PX
          ) {
            stableFrames++;
          } else {
            stableFrames = 0;
            break;
          }
          if (
            stableFrames >= REQUIRED_STABLE_FRAMES &&
            performance.now() - lastMutationAt >= MUTATION_QUIET_MS
          ) {
            settled = true;
            break;
          }
        }
        if (settled) break;
      }
    } finally {
      mutationObserver.disconnect();
    }
    if (!settled) {
      throw new Error(
        `stepped scroll did not settle at ${targetScrollTop}px after ${MAX_CONVERGENCE_ATTEMPTS} attempts; last scrollTop=${container.scrollTop.toFixed(2)}px`,
      );
    }
    const containerTop = container.getBoundingClientRect().top;
    const visible = Array.from(
      container.querySelectorAll<HTMLElement>('.chat-msg-slot'),
    ).find((slot) => slot.getBoundingClientRect().bottom > containerTop);
    if (!visible) throw new Error('no top-visible message slot was found');
    visible.dataset['e2ePagingAnchor'] = 'true';

    const beforeOffset = visible.getBoundingClientRect().top - containerTop;
    const scrollTopBefore = container.scrollTop;
    const scrollHeightBefore = container.scrollHeight;
    const distanceFromBottomBefore =
      scrollHeightBefore - scrollTopBefore - container.clientHeight;

    // These geometry-only checks run immediately before native button
    // activation, so the prepend cannot proceed on an unsettled or pinned tile.
    if (Math.abs(scrollTopBefore - targetScrollTop) > TARGET_TOLERANCE_PX) {
      throw new Error(
        `settled scroll precondition moved before activation: target=${targetScrollTop}px actual=${scrollTopBefore.toFixed(2)}px`,
      );
    }
    if (distanceFromBottomBefore <= 120) {
      throw new Error(
        `transcript remained pinned before activation: distanceFromBottom=${distanceFromBottomBefore.toFixed(2)}px`,
      );
    }
    if (!button.isConnected) {
      throw new Error(
        'load-earlier button detached before measured native activation',
      );
    }

    await new Promise<void>((resolve) => {
      let quietId: ReturnType<typeof setTimeout> | undefined;
      const finish = (): void => {
        observer.disconnect();
        resolve();
      };
      const resetQuiet = (): void => {
        if (quietId !== undefined) clearTimeout(quietId);
        quietId = setTimeout(finish, 1_000);
      };
      const observer = new MutationObserver(resetQuiet);
      observer.observe(container, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true,
      });
      container.dispatchEvent(new Event('scroll'));
      button.click();
      resetQuiet();
    });

    const anchored = host.querySelector(
      '[data-e2e-paging-anchor="true"]',
    ) as HTMLElement | null;
    const transcript = host.querySelector('ptah-chat-transcript');
    const angular = (
      window as unknown as {
        ng?: {
          getComponent(element: Element): {
            vm(): { messages: readonly { id: string }[] };
          };
        };
      }
    ).ng;
    if (!anchored || !transcript || !angular) {
      throw new Error('transcript anchor or Angular debug API unavailable');
    }

    const afterOffset =
      anchored.getBoundingClientRect().top -
      container.getBoundingClientRect().top;
    const scrollHeightAfter = container.scrollHeight;
    return {
      scrollTopBefore,
      scrollTopAfter: container.scrollTop,
      scrollHeightBefore,
      scrollHeightAfter,
      distanceFromBottomBefore,
      prependedHeight: scrollHeightAfter - scrollHeightBefore,
      offsetDelta: Math.abs(afterOffset - beforeOffset),
      messageIds: angular
        .getComponent(transcript)
        .vm()
        .messages.map((message) => message.id),
    };
  }, requestedScrollTop);

  await expect
    .poll(async () => (await ui.getObservedCalls('chat:history-page')).length)
    .toBe(1);
  await expect(
    tile.getByRole('button', { name: 'Load earlier messages' }),
  ).toHaveCount(0);
  return measurement;
}

function logAnchorMeasurement(
  caseName: string,
  targetScrollTop: number,
  measurement: AnchorMeasurement,
): void {
  console.log(
    `[load-older e2e][${caseName}][precondition] ` +
      `targetScrollTop=${targetScrollTop.toFixed(2)}px ` +
      `scrollTop=${measurement.scrollTopBefore.toFixed(2)}px ` +
      `distanceFromBottom=${measurement.distanceFromBottomBefore.toFixed(2)}px`,
  );
  console.log(
    `[load-older e2e][${caseName}] ` +
      `scrollTopBefore=${measurement.scrollTopBefore.toFixed(2)}px ` +
      `scrollTopAfter=${measurement.scrollTopAfter.toFixed(2)}px ` +
      `scrollHeightBefore=${measurement.scrollHeightBefore.toFixed(2)}px ` +
      `scrollHeightAfter=${measurement.scrollHeightAfter.toFixed(2)}px ` +
      `distanceFromBottomBefore=${measurement.distanceFromBottomBefore.toFixed(2)}px ` +
      `prependedHeight=${measurement.prependedHeight.toFixed(2)}px ` +
      `offsetDelta=${measurement.offsetDelta.toFixed(2)}px`,
  );
}

async function installStaleHistoryResponder(
  electronApp: ElectronApplication,
): Promise<void> {
  await electronApp.evaluate(({ ipcMain, BrowserWindow }) => {
    const originalListeners = ipcMain.listeners('rpc') as Array<
      (event: Electron.IpcMainEvent, message: unknown) => void
    >;
    ipcMain.removeAllListeners('rpc');
    ipcMain.on('rpc', (event: Electron.IpcMainEvent, message: unknown) => {
      const record = message as { payload?: Record<string, unknown> };
      const payload = record?.payload ?? {};
      if (payload['method'] !== 'chat:history-page') {
        for (const listener of originalListeners) {
          listener.call(ipcMain, event, message);
        }
        return;
      }

      ipcMain.removeAllListeners('rpc');
      for (const listener of originalListeners) ipcMain.on('rpc', listener);
      const target =
        BrowserWindow.fromWebContents(event.sender) ??
        BrowserWindow.getAllWindows()[0];
      if (!target) {
        throw new Error(
          '[load-older e2e] cannot send stale-cursor response: no BrowserWindow',
        );
      }
      const correlationId = payload['correlationId'];
      if (typeof correlationId !== 'string') {
        throw new Error(
          '[load-older e2e] cannot send stale-cursor response: correlationId missing',
        );
      }
      const response: RendererRpcFailureEnvelope = {
        type: 'rpc:response',
        correlationId,
        success: false,
        error: 'Session history changed',
        errorCode: 'HISTORY_CURSOR_STALE',
      };
      target.webContents.send('to-renderer', response);
    });
  });
}

async function activateLoadEarlierWithoutSentinelRace(
  button: Locator,
): Promise<void> {
  await expect(button).toBeVisible();
  await expect(button).toBeEnabled();
  await expect(button).toHaveAttribute('aria-busy', 'false');

  // Playwright's pointer click scrolls this off-screen control into view first.
  // That upward scroll intentionally arms the adjacent auto-load sentinel,
  // which can replace the button before Playwright dispatches the click. Native
  // activation on the role-located, enabled button isolates the manual path
  // without force-clicking through a real overlay or weakening the assertions.
  await button.evaluate((element) => {
    if (!(element instanceof HTMLButtonElement)) {
      throw new Error('load-earlier role did not resolve to a button');
    }
    element.click();
  });
}

test.describe('Canvas tile older-history paging (TASK_2026_453 C14)', () => {
  test('scrollTop === 0 prepend keeps the top-visible message within 2 px', async ({
    ui,
  }) => {
    const measurement = await measureAnchorPrepend(ui, 'ANCHOR_ZERO', 0);
    logAnchorMeasurement('scrollTop-zero', 0, measurement);
    expect(Math.abs(measurement.scrollTopBefore)).toBeLessThanOrEqual(1);
    expect(measurement.distanceFromBottomBefore).toBeGreaterThan(120);
    expect(measurement.scrollTopBefore).toBe(0);
    expect(measurement.prependedHeight).toBeGreaterThan(0);
    expect(new Set(measurement.messageIds).size).toBe(
      measurement.messageIds.length,
    );
    expect(measurement.offsetDelta).toBeLessThanOrEqual(2);
  });

  test('non-zero scrollTop prepend keeps the top-visible message within 2 px', async ({
    ui,
  }) => {
    const measurement = await measureAnchorPrepend(ui, 'ANCHOR_NONZERO', 300);
    logAnchorMeasurement('scrollTop-nonzero', 300, measurement);
    expect(Math.abs(measurement.scrollTopBefore - 300)).toBeLessThanOrEqual(1);
    expect(measurement.distanceFromBottomBefore).toBeGreaterThan(120);
    expect(measurement.scrollTopBefore).toBeGreaterThan(0);
    expect(measurement.prependedHeight).toBeGreaterThan(0);
    expect(new Set(measurement.messageIds).size).toBe(
      measurement.messageIds.length,
    );
    expect(measurement.offsetDelta).toBeLessThanOrEqual(2);
  });

  test('stale cursor hides the button and tells the user to reopen the session', async ({
    electronApp,
    ui,
  }) => {
    const session = makeSessionFixture('STALE_CURSOR', LOAD_OLDER_EVENTS);
    await prepareCanvasWithSessions(ui, [session]);
    const tile = await openSession(ui, session);
    const button = tile.getByRole('button', { name: 'Load earlier messages' });
    await expect(button).toBeVisible();

    await installStaleHistoryResponder(electronApp);
    await activateLoadEarlierWithoutSentinelRace(button);

    await expect(tile.getByRole('alert')).toContainText(/reopen the session/i);
    await expect(button).toHaveCount(0);
  });

  test('a resume response without historyPage preserves legacy full history and shows no button', async ({
    ui,
  }) => {
    const session = makeSessionFixture('LEGACY_BACKEND', LOAD_OLDER_EVENTS);
    await prepareCanvasWithSessions(ui, [session], { supportsPaging: false });
    const tile = await openSession(ui, session);

    await expect(
      tile.getByRole('button', { name: 'Load earlier messages' }),
    ).toHaveCount(0);
    const resume = (await ui.getObservedCalls('chat:resume')).find(
      (call) =>
        (call.params as { sessionId?: unknown }).sessionId === session.id,
    );
    expect(resume?.params).toEqual(
      expect.objectContaining({ historyPage: { maxEvents: 250 } }),
    );
    expect(await ui.getObservedCalls('chat:history-page')).toHaveLength(0);
  });

  test('a pinned non-scrollable tile stays near the bottom after prepending', async ({
    electronApp,
    ui,
  }) => {
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setBounds({
        x: 100,
        y: 50,
        width: 1200,
        height: 1100,
      });
    });
    const session = makeSparsePagingSessionFixture('PINNED');
    await prepareCanvasWithSessions(ui, [session]);
    const tile = await openSession(ui, session);
    await expect(
      tile.getByRole('button', { name: 'Load earlier messages' }),
    ).toBeVisible();
    expect(await ui.getObservedCalls('chat:history-page')).toHaveLength(0);

    const before = await tile.evaluate((host) => {
      const container = host.querySelector(
        '.chat-scroll-container',
      ) as HTMLElement | null;
      if (!container) throw new Error('chat scroll container not found');
      return {
        scrollHeight: container.scrollHeight,
        clientHeight: container.clientHeight,
        distanceFromBottom:
          container.scrollHeight - container.scrollTop - container.clientHeight,
      };
    });
    expect(before.scrollHeight).toBeLessThanOrEqual(before.clientHeight + 1);
    expect(before.distanceFromBottom).toBeLessThanOrEqual(1);

    const distanceFromBottom = await tile.evaluate(async (host) => {
      const container = host.querySelector(
        '.chat-scroll-container',
      ) as HTMLElement | null;
      const button = Array.from(host.querySelectorAll('button')).find(
        (candidate) =>
          candidate.textContent?.trim() === 'Load earlier messages',
      );
      if (!container || !button)
        throw new Error('load-older controls not found');

      await new Promise<void>((resolve) => {
        let quietId: ReturnType<typeof setTimeout> | undefined;
        const observer = new MutationObserver(() => {
          if (quietId !== undefined) clearTimeout(quietId);
          quietId = setTimeout(() => {
            observer.disconnect();
            resolve();
          }, 1_000);
        });
        observer.observe(container, {
          childList: true,
          subtree: true,
          attributes: true,
          characterData: true,
        });
        button.click();
        quietId = setTimeout(() => {
          observer.disconnect();
          resolve();
        }, 1_000);
      });
      return (
        container.scrollHeight - container.scrollTop - container.clientHeight
      );
    });

    console.log(
      `[load-older e2e] pinned-prepend distance-from-bottom=${distanceFromBottom.toFixed(2)}px`,
    );
    expect(distanceFromBottom).toBeLessThanOrEqual(120);
  });
});
