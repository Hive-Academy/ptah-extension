import {
  evaluateClassTokens,
  parseClassToken,
  RTL_UTILITY_PATTERNS,
  rtlCssFindings,
} from './rtl-patterns';
import { fileTemplateSource } from './template-keys';

const tokensOf = (text: string) =>
  [...text.matchAll(/\S+/g)].map((t) => ({
    token: t[0],
    offset: t.index,
    line: 1,
  }));
const judge = (text: string, island = false) =>
  evaluateClassTokens(tokensOf(text), island, 'x.html').map(
    (v) => `${v.kind} ${v.key}`,
  );
const css = (text: string) => rtlCssFindings(fileTemplateSource(text, 'x.css'));

describe('RTL_UTILITY_PATTERNS', () => {
  const matches = (utility: string) =>
    RTL_UTILITY_PATTERNS.some((p) => p.re.test(utility));

  it.each([
    'ml-4',
    '-ml-2',
    'mr-auto',
    'ml-px',
    'mr-[3px]',
    'pl-3',
    'pr-0.5',
    'left-0',
    '-left-2',
    'right-1/2',
    'left-[38%]',
    'right-full',
    'text-left',
    'text-right',
    'rounded-l',
    'rounded-r-lg',
    'rounded-tl-md',
    'rounded-br',
    'border-l',
    'border-r-2',
    'border-l-primary/20',
    'space-x-4',
    '-space-x-2',
    'space-x-reverse',
    'translate-x-4',
    '-translate-x-1/2',
    'translate-x-full',
    'bg-gradient-to-l',
    'bg-gradient-to-r',
    'origin-left',
    'origin-right',
    'float-left',
    'float-right',
  ])('matches the 4.1 utility %s', (utility) => {
    expect(matches(utility)).toBe(true);
  });

  it.each([
    'ms-4',
    'me-2',
    'ps-3',
    'start-0',
    'end-2',
    'text-start',
    'text-center',
    'rounded-s',
    'rounded-lg',
    'border-s',
    'border-t',
    'border-left',
    'bg-gradient-to-b',
    'origin-center',
    'float-start',
    'translate-y-2',
    'mx-auto',
    'px-4',
    'right-click',
    'left',
  ])('does not match %s', (utility) => {
    expect(matches(utility)).toBe(false);
  });
});

describe('parseClassToken', () => {
  it('splits variants, ignoring colons inside brackets', () => {
    expect(parseClassToken('md:rtl:!ml-4')).toEqual({
      variants: ['md', 'rtl'],
      utility: 'ml-4',
    });
    expect(parseClassToken('[&>*]:ml-2')).toEqual({
      variants: ['[&>*]'],
      utility: 'ml-2',
    });
    expect(parseClassToken('rtl:[transform:scaleX(-1)]')).toEqual({
      variants: ['rtl'],
      utility: '[transform:scaleX(-1)]',
    });
  });
});

describe('evaluateClassTokens', () => {
  it('fails physical utilities, with any responsive variant', () => {
    expect(judge('flex ml-4 md:pr-2 hover:text-right')).toEqual([
      'rtl-physical ml-4',
      'rtl-physical md:pr-2',
      'rtl-physical hover:text-right',
    ]);
  });

  it('passes a centring pair on the same element, in either order', () => {
    expect(judge('absolute left-1/2 -translate-x-1/2')).toEqual([]);
    expect(judge('translate-x-1/2 right-1/2')).toEqual([]);
  });

  it('fails either half of a centring pair alone', () => {
    expect(judge('left-1/2')).toEqual(['rtl-physical left-1/2']);
    expect(judge('-translate-x-1/2')).toEqual([
      'rtl-physical -translate-x-1/2',
    ]);
  });

  it('keeps the other physical utilities of a centring element failing', () => {
    expect(judge('left-1/2 -translate-x-1/2 ml-2')).toEqual([
      'rtl-physical ml-2',
    ]);
  });

  it('passes translate-x, gradient and origin paired with an rtl: variant', () => {
    expect(judge('translate-x-1 rtl:-translate-x-1')).toEqual([]);
    expect(judge('translate-x-4 rtl:-translate-x-4')).toEqual([]);
    expect(judge('bg-gradient-to-r rtl:bg-gradient-to-l')).toEqual([]);
    expect(judge('origin-left ltr:origin-right')).toEqual([]);
  });

  it('passes space-x only with rtl:space-x-reverse', () => {
    expect(judge('space-x-2 rtl:space-x-reverse')).toEqual([]);
    expect(judge('space-x-2 rtl:space-x-4')).toEqual([
      'rtl-physical space-x-2',
    ]);
  });

  it.each([
    ['ml-4 rtl:mr-8', 'ml-4'],
    ['pl-2 rtl:pr-2', 'pl-2'],
    ['left-0 rtl:right-0', 'left-0'],
    ['rounded-l rtl:rounded-r', 'rounded-l'],
    ['text-left rtl:text-right', 'text-left'],
    ['border-l rtl:border-r', 'border-l'],
    ['float-left rtl:float-right', 'float-left'],
  ])(
    'fails %s: an rtl: variant does not mirror a family with a logical form',
    (classes, physical) => {
      expect(judge(classes)).toEqual([`rtl-physical ${physical}`]);
    },
  );

  it('does not pair across families', () => {
    expect(judge('translate-x-2 rtl:origin-right')).toEqual([
      'rtl-physical translate-x-2',
    ]);
  });

  it('passes rtl: and ltr: variants outside an island', () => {
    expect(judge('rtl:rotate-180 ltr:ml-2 rtl:scale-x-[-1]')).toEqual([]);
  });

  describe('inside an LTR island', () => {
    it('passes physical utilities', () => {
      expect(
        judge('left-0 left-[38%] bg-gradient-to-r ml-1 justify-between', true),
      ).toEqual([]);
    });

    it('fails every rtl: or ltr: variant, physical or not', () => {
      expect(
        judge('rtl:rotate-180 md:ltr:ml-2 rtl:-translate-x-4', true),
      ).toEqual([
        'rtl-variant-in-island rtl:rotate-180',
        'rtl-variant-in-island md:ltr:ml-2',
        'rtl-variant-in-island rtl:-translate-x-4',
      ]);
    });

    it('marks island variants as not exemptable', () => {
      const [v] = evaluateClassTokens(tokensOf('rtl:ml-2'), true, 'x.html');
      expect(v.exemptBy).toBeNull();
      const [p] = evaluateClassTokens(tokensOf('ml-2'), false, 'x.html');
      expect(p.exemptBy).toBe('rtl-exempt');
    });
  });
});

describe('rtlCssFindings', () => {
  const keys = (text: string) =>
    css(text).violations.map((v) => `${v.line}:${v.key}`);

  it('fails the physical properties with their line', () => {
    expect(
      keys(
        [
          '.a {',
          '  left: 0;',
          '  right: 2px;',
          '  margin-left: 4px;',
          '  margin-right: auto;',
          '  padding-left: 1rem;',
          '  padding-right: 0 !important;',
          '  text-align: right;',
          '}',
        ].join('\n'),
      ),
    ).toEqual([
      '2:left',
      '3:right',
      '4:margin-left',
      '5:margin-right',
      '6:padding-left',
      '7:padding-right',
      '8:text-align',
    ]);
  });

  it('ignores logical properties, other text-align values and selectors', () => {
    expect(
      keys(
        [
          '.left:hover, .x .right { color: red; }',
          '.a { inset-inline-start: 0; margin-inline-end: 2px; }',
          '.b { border-left: 1px solid; scroll-margin-left: 2px; }',
          '.c { text-align: center; text-align: start }',
        ].join('\n'),
      ),
    ).toEqual([]);
  });

  it('passes a CSS centring pair in the same block only', () => {
    expect(
      keys(
        [
          '.c { left: 50%; transform: translateX(-50%); }',
          '.d { right: 50%; transform: translate(-50%, 0); }',
          '.e { left: 50%; }',
        ].join('\n'),
      ),
    ).toEqual(['3:left']);
  });

  it('fails a declaration without a trailing semicolon (style attribute)', () => {
    expect(keys('color: red; left: 0')).toEqual(['1:left']);
  });

  describe('four-value shorthands', () => {
    it('fail when the right (2nd) and left (4th) values differ', () => {
      expect(
        keys(
          [
            '.a { padding: 0 8px 0 16px; }',
            '.b { margin: 1px 2px 3px auto !important; }',
            '.c { inset: 0 calc(1rem + 2px) 0 0; }',
          ].join('\n'),
        ),
      ).toEqual(['1:padding', '2:margin', '3:inset']);
    });

    it('pass in one-, two-, three-value and symmetric four-value forms', () => {
      expect(
        keys(
          [
            '.a { margin: 0; padding: 0 auto; inset: 0 1rem 2rem; }',
            '.b { padding: 1px 4px 2px 4px; margin: 0 calc(1px + 2px) 0 calc(1px + 2px); }',
            '.c { margin-block: 0 1px 2px 3px; inset-inline: 0 1px; }',
          ].join('\n'),
        ),
      ).toEqual([]);
    });

    it('are exempted by a preceding rtl-exempt marker', () => {
      const text =
        '.a {\n  /* rtl-exempt: offset card */\n  padding: 0 8px 0 16px;\n}';
      const { violations, markers } = css(text);
      expect(violations.map((v) => v.key)).toEqual(['padding']);
      expect(markers[0].covers).toEqual({
        start: text.indexOf('padding'),
        end: text.indexOf('16px;') + 5,
      });
    });
  });

  it('judges @apply utility lists', () => {
    expect(keys('.a { @apply flex ml-2 left-1/2 -translate-x-1/2; }')).toEqual([
      '1:ml-2',
    ]);
  });

  it('ignores matches inside comments', () => {
    expect(keys('.a { /* left: 0; */ color: red; }')).toEqual([]);
  });

  describe('rtl-exempt markers', () => {
    it('cover the next declaration', () => {
      const text =
        '.a {\n  /* rtl-exempt: seam */\n  left: 38%;\n  right: 0;\n}';
      const { markers } = css(text);
      expect(markers).toEqual([
        expect.objectContaining({
          kind: 'rtl-exempt',
          reason: 'seam',
          line: 2,
          covers: {
            start: text.indexOf('left'),
            end: text.indexOf('38%;') + 4,
          },
        }),
      ]);
    });

    it('cover a whole rule when they precede it', () => {
      const text =
        '/* rtl-exempt: decorative */\n.a { left: 0; }\n.b { left: 0; }';
      const [marker] = css(text).markers;
      expect(marker.covers).toEqual({
        start: text.indexOf('.a'),
        end: text.indexOf('}') + 1,
      });
    });

    it('cover nothing at the end of a block, and keep an empty reason', () => {
      const [marker] = css('.a { left: 0; /* rtl-exempt: */ }').markers;
      expect(marker.covers).toBeNull();
      expect(marker.reason).toBe('');
    });

    it('ignore other marker kinds', () => {
      expect(css('/* i18n-ignore: x */ .a {}').markers).toEqual([]);
    });
  });
});
