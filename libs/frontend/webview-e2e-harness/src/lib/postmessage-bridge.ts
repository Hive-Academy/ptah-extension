import type { Page } from '@playwright/test';

/**
 * Generic shape of a webview -> extension RPC message. The harness does not
 * import the real `@ptah-extension/shared` protocol types to keep the test
 * graph independent of webview source — spec authors can refine these
 * generics at the call site if they want stronger typing.
 */
export interface WebviewToExtensionMessage<TPayload = unknown> {
  readonly type: string;
  readonly id?: string;
  readonly payload?: TPayload;
}

/**
 * Generic shape of an extension -> webview message that gets posted back
 * into `window` so the Angular app's listeners receive it.
 */
export interface ExtensionToWebviewMessage<TPayload = unknown> {
  readonly type: string;
  readonly id?: string;
  readonly payload?: TPayload;
}

/**
 * Public API returned by `installPostMessageBridge`. Lets the test author
 * observe messages the SPA posts to the (stubbed) extension host and inject
 * messages going the other direction.
 */
export interface PostMessageBridge {
  /** All messages the webview has posted to the host since install. */
  outbound(): Promise<readonly WebviewToExtensionMessage[]>;

  /** Wait until a webview->host message matching `predicate` is observed. */
  waitForOutbound(
    predicate: (msg: WebviewToExtensionMessage) => boolean,
    options?: { readonly timeoutMs?: number },
  ): Promise<WebviewToExtensionMessage>;

  /** Inject a host->webview message into the page (dispatched as `MessageEvent`). */
  inject(message: ExtensionToWebviewMessage): Promise<void>;

  /** Reset the captured outbound buffer. */
  reset(): Promise<void>;
}

const BRIDGE_GLOBAL = '__ptahE2EBridge__';

/**
 * Install a stub of `acquireVsCodeApi()` and the inbound `message` channel
 * on the given Playwright `Page`. Must be called BEFORE `page.goto(...)`.
 *
 * The injection runs via `page.addInitScript` so it is present in every
 * frame/navigation. Outbound messages are buffered on the page in a global
 * keyed by `BRIDGE_GLOBAL`; the returned helpers read/write it via
 * `page.evaluate`.
 */
export async function installPostMessageBridge(
  page: Page,
): Promise<PostMessageBridge> {
  await page.addInitScript((globalKey: string) => {
    const w = window as unknown as Record<string, unknown>;
    if (w[globalKey]) {
      return;
    }

    const outbound: WebviewToExtensionMessage[] = [];
    const state = { outbound, nextStateValue: undefined as unknown };
    w[globalKey] = state;

    // Stub the VS Code webview API: `acquireVsCodeApi()` is a singleton in
    // real webviews, so we replicate that contract here.
    let acquired = false;
    (w as { acquireVsCodeApi?: () => unknown }).acquireVsCodeApi = () => {
      if (acquired) {
        throw new Error(
          '[ptah-e2e-harness] acquireVsCodeApi() can only be called once per page',
        );
      }
      acquired = true;
      return {
        postMessage(msg: unknown): void {
          outbound.push(msg as WebviewToExtensionMessage);
        },
        getState(): unknown {
          return state.nextStateValue;
        },
        setState(value: unknown): void {
          state.nextStateValue = value;
        },
      };
    };
  }, BRIDGE_GLOBAL);

  const outbound = async (): Promise<readonly WebviewToExtensionMessage[]> => {
    return page.evaluate((globalKey: string) => {
      const w = window as unknown as Record<string, { outbound: unknown[] }>;
      const bag = w[globalKey];
      // Return a defensive copy so Playwright serializes a snapshot.
      return bag ? [...bag.outbound] : [];
    }, BRIDGE_GLOBAL) as Promise<readonly WebviewToExtensionMessage[]>;
  };

  const waitForOutbound = async (
    predicate: (msg: WebviewToExtensionMessage) => boolean,
    options?: { readonly timeoutMs?: number },
  ): Promise<WebviewToExtensionMessage> => {
    const timeoutMs = options?.timeoutMs ?? 5_000;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const all = await outbound();
      const hit = all.find(predicate);
      if (hit) {
        return hit;
      }
      await page.waitForTimeout(50);
    }
    throw new Error(
      `[ptah-e2e-harness] waitForOutbound timed out after ${timeoutMs}ms`,
    );
  };

  const inject = async (message: ExtensionToWebviewMessage): Promise<void> => {
    await page.evaluate((msg: unknown) => {
      window.dispatchEvent(new MessageEvent('message', { data: msg }));
    }, message as unknown);
  };

  const reset = async (): Promise<void> => {
    await page.evaluate((globalKey: string) => {
      const w = window as unknown as Record<string, { outbound: unknown[] }>;
      const bag = w[globalKey];
      if (bag) {
        bag.outbound.length = 0;
      }
    }, BRIDGE_GLOBAL);
  };

  return { outbound, waitForOutbound, inject, reset };
}
