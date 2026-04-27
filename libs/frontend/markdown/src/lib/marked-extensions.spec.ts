import type { MarkedExtension, Tokens } from 'marked';
import { getMarkedExtensions } from './marked-extensions';

/**
 * Extension order in the array (mirrors implementation):
 *   0 — Callout cards
 *   1 — Code block header
 *   2 — Decorative dividers
 *   3 — Enhanced headings
 *   4 — List cards
 */
const EXTENSIONS_LENGTH = 5;
const EXT_INDEX = {
  callout: 0,
  code: 1,
  divider: 2,
  heading: 3,
  list: 4,
} as const;

/** Build a fake parser context (`this`) for renderer hooks that call back
 *  into `parser.parse(...)` / `parser.parseInline(...)`. */
const makeParserCtx = () => ({
  parser: {
    parse: (tokens: Tokens.Generic[]) =>
      tokens.map((t) => `[${t.type}]`).join(''),
    parseInline: (tokens: Tokens.Generic[]) =>
      tokens.map((t) => `<${t.type}>`).join(''),
  },
});

/** Helper to pluck typed renderer hooks from the marked extension object. */
type AnyRenderer = NonNullable<MarkedExtension['renderer']>;
const rendererOf = (ext: MarkedExtension): AnyRenderer =>
  ext.renderer as AnyRenderer;

describe('getMarkedExtensions — public shape', () => {
  it('returns a non-empty array of marked extensions', () => {
    const extensions = getMarkedExtensions();
    expect(Array.isArray(extensions)).toBe(true);
    expect(extensions.length).toBeGreaterThan(0);
  });

  it(`returns ${EXTENSIONS_LENGTH} extensions`, () => {
    expect(getMarkedExtensions()).toHaveLength(EXTENSIONS_LENGTH);
  });

  it('each extension declares at least one of renderer / walkTokens', () => {
    for (const ext of getMarkedExtensions()) {
      expect(typeof ext).toBe('object');
      expect(ext).not.toBeNull();
      const hasRenderer = 'renderer' in ext;
      const hasWalkTokens = 'walkTokens' in ext;
      expect(hasRenderer || hasWalkTokens).toBe(true);
    }
  });

  it('returns fresh instances on every call (no shared mutable state)', () => {
    const a = getMarkedExtensions();
    const b = getMarkedExtensions();
    expect(a).not.toBe(b);
    expect(a[0]).not.toBe(b[0]);
  });
});

describe('callout extension', () => {
  const ext = () => getMarkedExtensions()[EXT_INDEX.callout];

  it('walkTokens ignores non-blockquote tokens', () => {
    const tok = { type: 'paragraph' } as unknown as Tokens.Generic;
    const walk = ext().walkTokens as (t: Tokens.Generic) => void;
    expect(() => walk(tok)).not.toThrow();
  });

  it('walkTokens ignores blockquotes whose first child is not a paragraph', () => {
    const bq = {
      type: 'blockquote',
      tokens: [{ type: 'list' }],
    } as unknown as Tokens.Generic;
    const walk = ext().walkTokens as (t: Tokens.Generic) => void;
    expect(() => walk(bq)).not.toThrow();
    expect((bq as Record<string, unknown>)['calloutType']).toBeUndefined();
  });

  it('walkTokens ignores blockquotes without a [!TYPE] prefix', () => {
    const bq: Tokens.Generic = {
      type: 'blockquote',
      tokens: [
        {
          type: 'paragraph',
          raw: 'Just a quote',
          text: 'Just a quote',
          tokens: [{ type: 'text', text: 'Just a quote', raw: 'Just a quote' }],
        },
      ],
    } as unknown as Tokens.Generic;
    const walk = ext().walkTokens as (t: Tokens.Generic) => void;
    walk(bq);
    expect((bq as Record<string, unknown>)['calloutType']).toBeUndefined();
  });

  it('walkTokens tags valid [!NOTE] blockquotes and strips the prefix', () => {
    const bq: Tokens.Generic = {
      type: 'blockquote',
      tokens: [
        {
          type: 'paragraph',
          raw: '[!NOTE] hello',
          text: '[!NOTE] hello',
          tokens: [
            { type: 'text', text: '[!NOTE] hello', raw: '[!NOTE] hello' },
          ],
        },
      ],
    } as unknown as Tokens.Generic;
    const walk = ext().walkTokens as (t: Tokens.Generic) => void;
    walk(bq);
    expect((bq as Record<string, unknown>)['calloutType']).toBe('NOTE');
    const para = (bq as unknown as Tokens.Blockquote)
      .tokens[0] as Tokens.Paragraph;
    expect(para.text).toBe('hello');
    expect(para.raw).toBe('hello');
    const inline = para.tokens?.[0] as Tokens.Text;
    expect(inline.text).toBe('hello');
    expect(inline.raw).toBe('hello');
  });

  it('renderer.blockquote returns false when no calloutType is tagged', () => {
    const out = (
      rendererOf(ext()).blockquote as (
        this: unknown,
        token: Tokens.Blockquote,
      ) => string | false
    ).call(makeParserCtx(), {
      type: 'blockquote',
      tokens: [],
    } as Tokens.Blockquote);
    expect(out).toBe(false);
  });

  it('renderer.blockquote returns false for unknown callout types', () => {
    const tok = {
      type: 'blockquote',
      tokens: [],
      calloutType: 'NOPE',
    } as unknown as Tokens.Blockquote;
    const out = (
      rendererOf(ext()).blockquote as (
        this: unknown,
        token: Tokens.Blockquote,
      ) => string | false
    ).call(makeParserCtx(), tok);
    expect(out).toBe(false);
  });

  it('renderer.blockquote wraps tagged blockquotes in a callout card', () => {
    const tok = {
      type: 'blockquote',
      tokens: [{ type: 'paragraph' } as Tokens.Generic],
      calloutType: 'TIP',
    } as unknown as Tokens.Blockquote;
    const out = (
      rendererOf(ext()).blockquote as (
        this: unknown,
        token: Tokens.Blockquote,
      ) => string | false
    ).call(makeParserCtx(), tok);
    expect(typeof out).toBe('string');
    expect(out as string).toContain('callout-tip');
    expect(out as string).toContain('Tip');
  });
});

describe('code block header extension', () => {
  const ext = () => getMarkedExtensions()[EXT_INDEX.code];

  it('renders short blocks without a <details> wrapper', () => {
    const out = (
      rendererOf(ext()).code as (
        this: unknown,
        token: Tokens.Code,
      ) => string | false
    ).call(makeParserCtx(), {
      type: 'code',
      raw: '',
      text: 'console.log(1)',
      lang: 'ts',
    } as Tokens.Code);
    expect(typeof out).toBe('string');
    expect(out as string).toContain('TypeScript');
    expect(out as string).not.toContain('<details');
  });

  it('renders long blocks (>=15 lines) inside <details>', () => {
    const longCode = Array.from({ length: 20 }, (_, i) => `line ${i}`).join(
      '\n',
    );
    const out = (
      rendererOf(ext()).code as (
        this: unknown,
        token: Tokens.Code,
      ) => string | false
    ).call(makeParserCtx(), {
      type: 'code',
      raw: '',
      text: longCode,
      lang: '',
    } as Tokens.Code);
    expect(out as string).toContain('<details');
    expect(out as string).toContain('20 lines');
  });

  it('omits the language badge when no language is given', () => {
    const out = (
      rendererOf(ext()).code as (
        this: unknown,
        token: Tokens.Code,
      ) => string | false
    ).call(makeParserCtx(), {
      type: 'code',
      raw: '',
      text: 'x',
      lang: '',
    } as Tokens.Code);
    expect(out as string).not.toContain('code-lang-badge');
  });

  it('falls back to the raw lang label for unknown languages', () => {
    const out = (
      rendererOf(ext()).code as (
        this: unknown,
        token: Tokens.Code,
      ) => string | false
    ).call(makeParserCtx(), {
      type: 'code',
      raw: '',
      text: 'x',
      lang: 'mystery',
    } as Tokens.Code);
    expect(out as string).toContain('mystery');
  });

  it('escapes HTML inside code text', () => {
    const out = (
      rendererOf(ext()).code as (
        this: unknown,
        token: Tokens.Code,
      ) => string | false
    ).call(makeParserCtx(), {
      type: 'code',
      raw: '',
      text: '<script>"&\'</script>',
      lang: 'js',
    } as Tokens.Code);
    expect(out as string).toContain('&lt;script&gt;');
    expect(out as string).toContain('&amp;');
    expect(out as string).toContain('&quot;');
    expect(out as string).not.toContain('<script>');
  });
});

describe('decorative divider extension', () => {
  it('renders a custom divider element for hr', () => {
    const ext = getMarkedExtensions()[EXT_INDEX.divider];
    const out = (rendererOf(ext).hr as () => string)();
    expect(out).toContain('prose-divider');
    expect(out).toContain('prose-divider-ornament');
  });
});

describe('enhanced headings extension', () => {
  const ext = () => getMarkedExtensions()[EXT_INDEX.heading];

  it('renders H1 with accented heading wrapper', () => {
    const out = (
      rendererOf(ext()).heading as (
        this: unknown,
        token: Tokens.Heading,
      ) => string | false
    ).call(makeParserCtx(), {
      type: 'heading',
      depth: 1,
      tokens: [{ type: 'text' } as Tokens.Generic],
    } as Tokens.Heading);
    expect(out as string).toContain('<h1');
    expect(out as string).toContain('prose-heading-accented');
    expect(out as string).toContain('prose-heading-dot');
  });

  it('renders H2 with accented heading wrapper', () => {
    const out = (
      rendererOf(ext()).heading as (
        this: unknown,
        token: Tokens.Heading,
      ) => string | false
    ).call(makeParserCtx(), {
      type: 'heading',
      depth: 2,
      tokens: [{ type: 'text' } as Tokens.Generic],
    } as Tokens.Heading);
    expect(out as string).toContain('<h2');
    expect(out as string).toContain('prose-heading-accented');
  });

  it('renders H3 with bordered heading wrapper', () => {
    const out = (
      rendererOf(ext()).heading as (
        this: unknown,
        token: Tokens.Heading,
      ) => string | false
    ).call(makeParserCtx(), {
      type: 'heading',
      depth: 3,
      tokens: [{ type: 'text' } as Tokens.Generic],
    } as Tokens.Heading);
    expect(out as string).toContain('<h3');
    expect(out as string).toContain('prose-heading-bordered');
  });

  it('returns false for H4-H6 (defer to default renderer)', () => {
    for (const depth of [4, 5, 6] as const) {
      const out = (
        rendererOf(ext()).heading as (
          this: unknown,
          token: Tokens.Heading,
        ) => string | false
      ).call(makeParserCtx(), {
        type: 'heading',
        depth,
        tokens: [{ type: 'text' } as Tokens.Generic],
      } as Tokens.Heading);
      expect(out).toBe(false);
    }
  });
});

describe('list card extension', () => {
  const ext = () => getMarkedExtensions()[EXT_INDEX.list];

  it('wraps unordered lists in prose-list-card with <ul>', () => {
    const out = (
      rendererOf(ext()).list as (
        this: unknown,
        token: Tokens.List,
      ) => string | false
    ).call(makeParserCtx(), {
      type: 'list',
      ordered: false,
      start: 1,
      items: [
        { tokens: [{ type: 'text' } as Tokens.Generic] } as Tokens.ListItem,
      ],
    } as Tokens.List);
    expect(out as string).toContain('prose-list-card');
    expect(out as string).toContain('<ul>');
  });

  it('wraps ordered lists in prose-list-card with <ol>', () => {
    const out = (
      rendererOf(ext()).list as (
        this: unknown,
        token: Tokens.List,
      ) => string | false
    ).call(makeParserCtx(), {
      type: 'list',
      ordered: true,
      start: 1,
      items: [
        { tokens: [{ type: 'text' } as Tokens.Generic] } as Tokens.ListItem,
      ],
    } as Tokens.List);
    expect(out as string).toContain('<ol>');
  });

  it('emits a start attribute when ordered list does not start at 1', () => {
    const out = (
      rendererOf(ext()).list as (
        this: unknown,
        token: Tokens.List,
      ) => string | false
    ).call(makeParserCtx(), {
      type: 'list',
      ordered: true,
      start: 5,
      items: [
        { tokens: [{ type: 'text' } as Tokens.Generic] } as Tokens.ListItem,
      ],
    } as Tokens.List);
    expect(out as string).toContain('start="5"');
  });
});
