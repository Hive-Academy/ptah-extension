import { EventEmitter } from 'node:events';
import { test, expect, type Page } from '@playwright/test';
import { captureRendererConsoleErrors } from '../../support/renderer-console-errors';

test('captures navigation errors emitted during goto from the renderer console', async () => {
  // Only the Page event API is needed; no Electron or browser process is used.
  const page = new EventEmitter();
  const capture = captureRendererConsoleErrors(page as unknown as Page);
  const failure = '[SurfaceRouterService] Navigation to marketplace failed';
  const goto = async (): Promise<void> => {
    page.emit('console', { type: () => 'error', text: () => failure });
  };

  await goto();

  expect(capture.lines).toEqual([failure]);
  // The same assertion used by the route specs must reject this failure.
  expect(() =>
    expect(capture.lines).not.toEqual(
      expect.arrayContaining([
        expect.stringContaining('[SurfaceRouterService] Navigation to'),
      ]),
    ),
  ).toThrow();
  capture.dispose();
  expect(page.listenerCount('console')).toBe(0);
});

test('ignores other console levels and stops capturing after disposal', () => {
  const page = new EventEmitter();
  const capture = captureRendererConsoleErrors(page as unknown as Page);
  for (const level of ['log', 'info', 'warning', 'debug']) {
    page.emit('console', { type: () => level, text: () => 'not an error' });
  }
  expect(capture.lines).toEqual([]);

  capture.dispose();
  page.emit('console', { type: () => 'error', text: () => 'after disposal' });
  expect(capture.lines).toEqual([]);
});
