/**
 * The host's `initialView` allow-list, which is now the SHARED one.
 *
 * Why this spec exists: `_getHtmlForWebview` used to carry a hand-written array
 * of six view ids, and `ptah.openOrchestraCanvas`
 * (`src/core/ptah-extension.ts`) passes `initialView: 'orchestra-canvas'`,
 * which that array rejected. The rejection is a `throw`, and the public
 * boundary `generateAngularWebviewContent` catches it and substitutes
 * `generateFallbackHtml` — so the command opened a panel that rendered
 * nothing, silently, and had done so before TASK_2026_524 touched anything
 * (revision 1, F4).
 *
 * **What is observable here.** Validation runs before the `index.html` read, so
 * in a test environment with no built webview every call ends in a caught
 * error and fallback HTML. The error MESSAGE is what separates the two
 * outcomes, and it is reachable through the public method:
 *
 *   - rejected view  → "Invalid initialView"
 *   - accepted view  → validation passed; the next failure is
 *                      "Angular index.html not found"
 *
 * That makes "the allow-list accepted this id" assertable without a packaged
 * extension, and it fails on the old six-entry array for seven of the eleven
 * accepted ids.
 */

import * as vscode from 'vscode';
import {
  ACCEPTED_INITIAL_VIEWS,
  LEGACY_SURFACE_ALIASES,
  SURFACE_ROUTE_IDS,
} from '@ptah-extension/shared';
import { WebviewHtmlGenerator } from './webview-html-generator';

function createGenerator(): WebviewHtmlGenerator {
  const context = {
    // A path with no `webview/browser/index.html` under it, on purpose: the
    // read failure is the marker that validation let the view through.
    extensionPath: '/nonexistent/ptah-extension',
    extensionUri: vscode.Uri.file('/nonexistent/ptah-extension'),
  } as unknown as vscode.ExtensionContext;
  return new WebviewHtmlGenerator(context);
}

function createWebview(): vscode.Webview {
  return {
    cspSource: 'vscode-webview:',
    asWebviewUri: (uri: vscode.Uri) => uri,
    options: {},
    html: '',
    onDidReceiveMessage: () => ({ dispose: () => undefined }),
    postMessage: async () => true,
  } as unknown as vscode.Webview;
}

/** The message the generator logged for `initialView`, via the caught error. */
function generateAndCaptureError(initialView: string | undefined): string {
  const errors: unknown[] = [];
  const consoleError = jest
    .spyOn(console, 'error')
    .mockImplementation((...args: unknown[]) => {
      errors.push(...args);
    });

  try {
    createGenerator().generateAngularWebviewContent(createWebview(), {
      initialView,
    });
  } finally {
    consoleError.mockRestore();
  }

  return errors
    .map((entry) => (entry instanceof Error ? entry.message : String(entry)))
    .join(' | ');
}

describe('WebviewHtmlGenerator initialView validation', () => {
  it.each([...ACCEPTED_INITIAL_VIEWS])('accepts %s', (initialView) => {
    const logged = generateAndCaptureError(initialView);

    expect(logged).not.toContain('Invalid initialView');
    // Validation passed; the next thing to fail is the missing built webview.
    expect(logged).toContain('Angular index.html not found');
  });

  it('accepts orchestra-canvas, which ptah.openOrchestraCanvas sends', () => {
    // The single id whose rejection was a live, reproducible defect. The
    // renderer rewrites it to chat + grid in `normalizeInitialView`; the host's
    // job is only to not reject it.
    expect(LEGACY_SURFACE_ALIASES).toContain('orchestra-canvas');
    expect(generateAndCaptureError('orchestra-canvas')).not.toContain(
      'Invalid initialView',
    );
  });

  it.each([
    'harness-builder',
    'setup-hub',
    'thoth',
    'marketplace',
    'tribunal',
    'tasks',
  ])('accepts %s, which the old six-entry list rejected', (initialView) => {
    expect(generateAndCaptureError(initialView)).not.toContain(
      'Invalid initialView',
    );
  });

  it.each([
    // Removed from the union: no render branch anywhere in the app.
    'command-builder',
    'context-tree',
    'not-a-view',
    '../settings',
    'https://evil.test',
  ])('rejects %s', (initialView) => {
    expect(generateAndCaptureError(initialView)).toContain(
      'Invalid initialView',
    );
  });

  it('skips validation entirely when no initialView is supplied', () => {
    const logged = generateAndCaptureError(undefined);

    expect(logged).not.toContain('Invalid initialView');
    expect(logged).toContain('Angular index.html not found');
  });

  it('names the accepted values in the rejection message', () => {
    const logged = generateAndCaptureError('command-builder');

    for (const accepted of ACCEPTED_INITIAL_VIEWS) {
      expect(logged).toContain(accepted);
    }
  });

  it('validates against the shared contract, not a local copy', () => {
    // The drift gate. If someone re-introduces a local array here, one of the
    // per-id cases above fails; if someone edits SURFACE_ROUTE_IDS without
    // touching this file, nothing has to change — which is the point.
    expect([...ACCEPTED_INITIAL_VIEWS]).toEqual([
      ...SURFACE_ROUTE_IDS,
      ...LEGACY_SURFACE_ALIASES,
    ]);
  });
});

describe('WebviewHtmlGenerator fallback document', () => {
  it('mounts the app"s real selector, ptah-root', () => {
    // With `app-root` this document loaded the bundle and rendered nothing,
    // which is how a rejected initialView surfaced as a blank panel instead of
    // an error (revision 1, F4).
    const consoleError = jest.spyOn(console, 'error').mockImplementation();
    const html = createGenerator().generateAngularWebviewContent(
      createWebview(),
      { initialView: 'chat' },
    );
    consoleError.mockRestore();

    expect(html).toContain('<ptah-root></ptah-root>');
    expect(html).not.toContain('<app-root>');
  });
});
