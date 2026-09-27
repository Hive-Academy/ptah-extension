import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  LANG_DIRECTION,
  resolveInitialLang,
  SUPPORTED_LANGS,
  type SupportedLang,
} from '@ptah-extension/i18n';
import {
  ARABIC_FONT_HREF,
  ARABIC_FONT_LINK_ID,
  LANDING_LANG_STORAGE_KEY,
} from './landing-i18n.constants';

/**
 * The `#ptah-i18n-prepaint` inline script in `src/index.html` repeats the
 * library's detection rule in plain ES5, because it runs before any bundle.
 * This spec keeps the two in sync: it runs the real script from the real file
 * against every stored value x browser language combination and requires the
 * same result as `resolveInitialLang`, then checks the constants it repeats.
 */
const indexHtml = readFileSync(
  join(__dirname, '..', '..', 'index.html'),
  'utf8',
);

const parsedIndex = new DOMParser().parseFromString(indexHtml, 'text/html');
const scriptElement = parsedIndex.getElementById('ptah-i18n-prepaint');
const script = scriptElement?.textContent ?? '';

/** What `localStorage` holds, or `'throws'` for blocked storage. */
type StoredCase = string | null | 'throws';

const STORED_CASES: readonly StoredCase[] = ['en', 'ar', 'xx', null, 'throws'];
const LANGUAGE_CASES: readonly (readonly string[] | undefined)[] = [
  ['ar'],
  ['ar-EG', 'en'],
  ['AR'],
  ['en-US'],
  ['fr'],
  [],
  undefined,
];

/**
 * Runs the script as a real inline `<script>` in a fresh iframe (its own
 * window and document), with that window's `localStorage` and
 * `navigator.languages` replaced for the case, and returns its document.
 */
function runPrePaint(
  stored: StoredCase,
  languages: readonly string[] | undefined,
  prepare?: (doc: Document) => void,
): Document {
  const frame = document.createElement('iframe');
  document.body.appendChild(frame);
  frames.push(frame);
  const win = frame.contentWindow as Window;
  const doc = win.document;

  Object.defineProperty(win, 'localStorage', {
    configurable: true,
    get: () => {
      if (stored === 'throws') {
        // Blocked storage (Safari private mode, disabled cookies).
        throw new DOMException('The operation is insecure.', 'SecurityError');
      }
      return {
        getItem: (key: string) =>
          key === LANDING_LANG_STORAGE_KEY ? stored : null,
      };
    },
  });
  Object.defineProperty(win.navigator, 'languages', {
    configurable: true,
    get: () => languages,
  });
  prepare?.(doc);

  const element = doc.createElement('script');
  element.textContent = script;
  doc.head.appendChild(element);
  element.remove();
  return doc;
}

const frames: HTMLIFrameElement[] = [];
afterEach(() => frames.splice(0).forEach((frame) => frame.remove()));

function linksIn(doc: Document, rel: string): HTMLLinkElement[] {
  return Array.from(doc.head.querySelectorAll<HTMLLinkElement>('link')).filter(
    (link) => link.rel === rel,
  );
}

describe('#ptah-i18n-prepaint in index.html', () => {
  it('exists as an inline script (tripwire for a vacuous pass)', () => {
    expect(scriptElement).not.toBeNull();
    expect(scriptElement?.hasAttribute('src')).toBe(false);
    expect(script).toContain('documentElement');
  });

  it('is the first element after <meta charset>', () => {
    const first = parsedIndex.head.firstElementChild;
    expect(first?.tagName).toBe('META');
    expect(first?.hasAttribute('charset')).toBe(true);
    expect(first?.nextElementSibling).toBe(scriptElement);
  });

  it('stays under 1 KB', () => {
    expect(new TextEncoder().encode(script).length).toBeLessThan(1024);
  });

  it('leaves static English attributes on <html> for visitors without JS', () => {
    const html = parsedIndex.documentElement;
    expect(html.getAttribute('lang')).toBe('en');
    expect(html.getAttribute('dir')).toBe('ltr');
  });

  it('repeats the app and library constants verbatim', () => {
    expect(script).toContain(`'${LANDING_LANG_STORAGE_KEY}'`);
    expect(script).toContain(`'${ARABIC_FONT_LINK_ID}'`);
    expect(script).toContain(`'${ARABIC_FONT_HREF}'`);
    expect(script).toContain(
      `[${SUPPORTED_LANGS.map((lang) => `'${lang}'`).join(', ')}]`,
    );
    const directions = Object.entries(LANG_DIRECTION)
      .map(([lang, dir]) => `${lang}: '${dir}'`)
      .join(', ');
    expect(script).toContain(`{ ${directions} }`);
  });

  describe.each(STORED_CASES.map((stored) => [String(stored), stored]))(
    'stored %s',
    (_label, stored) => {
      it.each(
        LANGUAGE_CASES.map((languages) => [String(languages), languages]),
      )(
        'languages [%s] match resolveInitialLang',
        (_languagesLabel, languages) => {
          const expected: SupportedLang = resolveInitialLang({
            // LangPreferenceStore reads blocked storage as null.
            stored: stored === 'throws' ? null : stored,
            languages,
          });

          const doc = runPrePaint(stored, languages);

          expect(doc.documentElement.lang).toBe(expected);
          expect(doc.documentElement.dir).toBe(LANG_DIRECTION[expected]);
          const font = doc.getElementById(ARABIC_FONT_LINK_ID);
          if (expected === 'ar') {
            // The iframe is another realm: compare tag names, not classes.
            expect(font?.tagName).toBe('LINK');
            expect(font?.getAttribute('rel')).toBe('stylesheet');
            expect(font?.getAttribute('href')).toBe(ARABIC_FONT_HREF);
            expect(linksIn(doc, 'preconnect')).toHaveLength(1);
          } else {
            expect(font).toBeNull();
            expect(doc.head.querySelectorAll('link')).toHaveLength(0);
          }
        },
      );
    },
  );

  it('does not add a second font link when one is already present', () => {
    const doc = runPrePaint('ar', undefined, (d) => {
      const existing = d.createElement('link');
      existing.id = ARABIC_FONT_LINK_ID;
      d.head.appendChild(existing);
    });

    expect(doc.documentElement.dir).toBe('rtl');
    expect(doc.querySelectorAll(`#${ARABIC_FONT_LINK_ID}`)).toHaveLength(1);
    expect(linksIn(doc, 'preconnect')).toHaveLength(0);
  });
});
