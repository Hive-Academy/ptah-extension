import type { ConsoleMessage, Page } from '@playwright/test';

/** Attach before navigation: renderer errors do not reach main-process output. */
export function captureRendererConsoleErrors(page: Page): {
  lines: string[];
  dispose: () => void;
} {
  const lines: string[] = [];
  const onConsole = (message: ConsoleMessage): void => {
    if (message.type() === 'error') lines.push(message.text());
  };
  page.on('console', onConsole);
  return { lines, dispose: () => page.off('console', onConsole) };
}
