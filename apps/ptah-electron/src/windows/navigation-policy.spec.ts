import {
  isSafeExternalUrl,
  isSameDocumentNavigation,
} from './navigation-policy';

const RENDERER = 'file:///C:/app/renderer/index.html';

describe('isSameDocumentNavigation', () => {
  it('allows a same-document hash navigation', () => {
    expect(isSameDocumentNavigation(RENDERER, `${RENDERER}#section`)).toBe(
      true,
    );
  });

  it('allows the identical URL (a plain reload)', () => {
    expect(isSameDocumentNavigation(RENDERER, RENDERER)).toBe(true);
  });

  /**
   * R9, pinned deliberately. Electron treats a query-only change as a
   * same-document navigation, so an agent `href="index.html?x"` reloads the
   * renderer. That is accepted: it re-mounts the app the user is already in
   * and exposes no file the renderer could not already reach. What matters is
   * that it cannot become a navigation to DIFFERENT content, which the
   * pathname comparison below enforces.
   */
  it('allows a query-only difference on the renderer document (R9)', () => {
    expect(isSameDocumentNavigation(RENDERER, `${RENDERER}?x=1`)).toBe(true);
  });

  it.each([
    ['a sibling file in the same directory', 'file:///C:/app/renderer/a.ts'],
    ['a relative-resolved source file', 'file:///C:/app/renderer/src/a.ts'],
    ['a parent-directory escape', 'file:///C:/app/secrets.env'],
    ['an unrelated absolute path', 'file:///C:/Users/me/.ssh/id_ed25519'],
    ['a UNC share', 'file://server/share/x'],
  ])('blocks %s', (_label, target) => {
    expect(isSameDocumentNavigation(RENDERER, target)).toBe(false);
  });

  it.each([
    ['an http target', 'https://example.com/'],
    ['a javascript: target', 'javascript:alert(1)'],
    ['a mailto target', 'mailto:a@b.c'],
  ])('blocks %s because it is not a file: document', (_label, target) => {
    expect(isSameDocumentNavigation(RENDERER, target)).toBe(false);
  });

  it('fails closed on an empty current URL', () => {
    expect(isSameDocumentNavigation('', RENDERER)).toBe(false);
  });

  it.each([
    ['malformed target', RENDERER, 'not a url'],
    ['malformed current', 'also not a url', RENDERER],
    ['both malformed', '::::', '????'],
  ])('fails closed on %s', (_label, current, target) => {
    expect(isSameDocumentNavigation(current, target)).toBe(false);
  });
});

describe('isSafeExternalUrl', () => {
  it.each([
    ['https', 'https://example.com/'],
    ['http', 'http://example.com/'],
    ['mailto', 'mailto:someone@example.com'],
  ])('accepts %s', (_label, url) => {
    expect(isSafeExternalUrl(url)).toBe(true);
  });

  /**
   * The important one: a `file:` navigation the guard just CANCELLED must not
   * be laundered into `shell.openExternal`, which would open it through the
   * OS instead of the window.
   */
  it.each([
    ['file', 'file:///C:/app/renderer/a.ts'],
    ['javascript', 'javascript:alert(1)'],
    ['a custom protocol handler', 'ptah-evil://run'],
    ['data', 'data:text/html,<script>alert(1)</script>'],
    ['vscode', 'vscode://file/C:/x'],
  ])('refuses %s', (_label, url) => {
    expect(isSafeExternalUrl(url)).toBe(false);
  });

  it('refuses a malformed URL', () => {
    expect(isSafeExternalUrl('not a url')).toBe(false);
  });
});
