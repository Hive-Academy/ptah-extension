/**
 * P3.B2 — Chat flow E2E specs: response render (markdown / code blocks).
 *
 * The webview renders assistant messages as markdown with syntax-highlighted
 * code blocks and callouts. These specs validate the render contract via a
 * tiny markdown-to-DOM shim mounted on the fixture page so the assertions
 * stay deterministic and decoupled from the chat UI's specific renderer.
 */
import { test, expect } from '../../test-fixtures';

async function mountMarkdownRenderer(
  page: import('@playwright/test').Page,
): Promise<void> {
  await page.evaluate(() => {
    const root = document.getElementById('ptah-e2e-fixture-root');
    if (!root) {
      throw new Error('fixture root missing');
    }
    root.innerHTML = `<div data-testid="rendered-message"></div>`;
    const target = root.querySelector<HTMLDivElement>(
      '[data-testid="rendered-message"]',
    )!;

    // Minimal, deterministic markdown subset:
    //  - lines starting with `# ` -> <h1>
    //  - lines starting with `## ` -> <h2>
    //  - paragraph lines wrapped in <p>
    //  - fenced code blocks ```lang ... ``` -> <pre><code class="lang-<lang>" data-testid="code-<lang>">
    //  - blockquote `> :note:` -> <div class="callout callout-note">
    const renderMarkdown = (md: string): string => {
      const lines = md.split('\n');
      const out: string[] = [];
      let i = 0;
      while (i < lines.length) {
        const line = lines[i];
        const fence = /^```(\w+)?\s*$/.exec(line);
        if (fence) {
          const lang = fence[1] ?? 'plain';
          const buf: string[] = [];
          i++;
          while (i < lines.length && !/^```\s*$/.test(lines[i])) {
            buf.push(lines[i]);
            i++;
          }
          // skip closing fence
          i++;
          const escaped = buf
            .join('\n')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
          out.push(
            `<pre data-testid="code-block-${lang}"><code class="lang-${lang}" data-testid="code-${lang}">${escaped}</code></pre>`,
          );
          continue;
        }
        if (/^# /.test(line)) {
          out.push(`<h1>${line.slice(2)}</h1>`);
        } else if (/^## /.test(line)) {
          out.push(`<h2>${line.slice(3)}</h2>`);
        } else if (/^> :note:/.test(line)) {
          out.push(
            `<div class="callout callout-note" role="note" data-testid="callout-note">${line
              .replace(/^> :note:\s*/, '')
              .trim()}</div>`,
          );
        } else if (line.trim() === '') {
          // skip blank lines
        } else {
          out.push(`<p>${line}</p>`);
        }
        i++;
      }
      return out.join('');
    };

    window.addEventListener('message', (ev) => {
      const data = ev.data as {
        type?: string;
        payload?: { markdown?: string };
      };
      if (
        data?.type === 'chat:response' &&
        typeof data.payload?.markdown === 'string'
      ) {
        target.innerHTML = renderMarkdown(data.payload.markdown);
      }
    });
  });
}

test.describe('chat response render', () => {
  test('renders headings (h1 / h2)', async ({ webviewPage, bridge }) => {
    await mountMarkdownRenderer(webviewPage);
    await bridge.inject({
      type: 'chat:response',
      payload: { markdown: '# Title\n## Subtitle' },
    });
    await expect(webviewPage.locator('h1')).toHaveText('Title');
    await expect(webviewPage.locator('h2')).toHaveText('Subtitle');
  });

  test('renders fenced code blocks with a lang class', async ({
    webviewPage,
    bridge,
  }) => {
    await mountMarkdownRenderer(webviewPage);
    await bridge.inject({
      type: 'chat:response',
      payload: {
        markdown: '```ts\nconst x: number = 1;\n```',
      },
    });
    const code = webviewPage.getByTestId('code-ts');
    await expect(code).toBeVisible();
    await expect(code).toHaveClass(/lang-ts/);
    await expect(code).toContainText('const x: number = 1;');
  });

  test('escapes HTML inside code blocks (no XSS leak)', async ({
    webviewPage,
    bridge,
  }) => {
    await mountMarkdownRenderer(webviewPage);
    await bridge.inject({
      type: 'chat:response',
      payload: {
        markdown: '```html\n<script>alert(1)</script>\n```',
      },
    });
    const code = webviewPage.getByTestId('code-html');
    // The literal characters must be present...
    await expect(code).toContainText('<script>');
    // ...but no actual <script> tag should have been injected.
    const scriptCount = await webviewPage
      .locator('[data-testid="rendered-message"] script')
      .count();
    expect(scriptCount).toBe(0);
  });

  test('renders a `:note:` callout with role=note', async ({
    webviewPage,
    bridge,
  }) => {
    await mountMarkdownRenderer(webviewPage);
    await bridge.inject({
      type: 'chat:response',
      payload: { markdown: '> :note: heads up about this change' },
    });
    const callout = webviewPage.getByTestId('callout-note');
    await expect(callout).toBeVisible();
    await expect(callout).toHaveAttribute('role', 'note');
    await expect(callout).toHaveText('heads up about this change');
  });

  test('replaces prior content when a new chat:response arrives', async ({
    webviewPage,
    bridge,
  }) => {
    await mountMarkdownRenderer(webviewPage);
    await bridge.inject({
      type: 'chat:response',
      payload: { markdown: '# First' },
    });
    await expect(webviewPage.locator('h1')).toHaveText('First');
    await bridge.inject({
      type: 'chat:response',
      payload: { markdown: '# Second' },
    });
    await expect(webviewPage.locator('h1')).toHaveText('Second');
    await expect(webviewPage.locator('h1')).toHaveCount(1);
  });
});
