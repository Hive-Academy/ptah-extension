import * as ts from 'typescript';
import { rtlTemplateFindings, rtlTsFindings } from './rtl-sources';
import { fileTemplateSource, parseTemplateSource } from './template-keys';

const findings = (text: string) => {
  const source = fileTemplateSource(text, 'x.html');
  const { tree } = parseTemplateSource(source);
  if (!tree) throw new Error('template did not parse');
  return rtlTemplateFindings(source, tree);
};
const template = (text: string) =>
  findings(text).map((v) => `${v.line}:${v.kind}:${v.key}`);
const typescript = (text: string) =>
  rtlTsFindings(
    ts.createSourceFile('c.ts', text, ts.ScriptTarget.ESNext, true),
    'c.ts',
  );
const tsKeys = (text: string) =>
  typescript(text).violations.map((v) => `${v.line}:${v.kind}:${v.key}`);

describe('rtlTemplateFindings', () => {
  it('reads static classes, *Class attributes and [class.x] bindings', () => {
    expect(
      template(
        [
          '<div class="flex ml-4" iconClass="pr-2" [class.text-left]="a"></div>',
          '<p class="ms-4 text-start"></p>',
        ].join('\n'),
      ),
    ).toEqual([
      '1:rtl-physical:ml-4',
      '1:rtl-physical:pr-2',
      '1:rtl-physical:text-left',
    ]);
  });

  it('reads string literals and [ngClass] map keys of bindings', () => {
    expect(
      template(
        [
          "<div [class]=\"open ? 'ml-2' : 'ms-2'\"></div>",
          "<div [ngClass]=\"{ 'pl-3 border-l-2': a, 'px-2': b }\"></div>",
          '<div class="x {{ y }} rounded-r"></div>',
        ].join('\n'),
      ),
    ).toEqual([
      '1:rtl-physical:ml-2',
      '2:rtl-physical:pl-3',
      '2:rtl-physical:border-l-2',
      '3:rtl-physical:rounded-r',
    ]);
  });

  it('checks style attributes, [style.x] bindings and [ngStyle] keys', () => {
    expect(
      template(
        [
          '<div style="margin-left: 4px; text-align: center"></div>',
          '<div [style.left.px]="x" [style.marginRight]="y" [style.top]="z"></div>',
          '<div [style.text-align]="\'right\'" [style.text-align]="dynamic"></div>',
          "<div [ngStyle]=\"{ 'right.px': a, top: b, textAlign: 'left' }\"></div>",
        ].join('\n'),
      ),
    ).toEqual([
      '1:rtl-physical:margin-left',
      '2:rtl-physical:style.left',
      '2:rtl-physical:style.marginRight',
      '3:rtl-physical:style.text-align',
      '4:rtl-physical:style.right.px',
      '4:rtl-physical:style.textAlign',
    ]);
  });

  it('passes a centring pair on one element, not across elements', () => {
    expect(
      template(
        [
          '<div class="absolute left-1/2 -translate-x-1/2"></div>',
          '<div class="left-1/2"><span class="-translate-x-1/2"></span></div>',
        ].join('\n'),
      ),
    ).toEqual(['2:rtl-physical:left-1/2', '2:rtl-physical:-translate-x-1/2']);
  });

  describe('LTR islands', () => {
    it('passes physical styling on and under dir="ltr" and ltr-island', () => {
      expect(
        template(
          [
            '<div dir="ltr" class="left-0 justify-between">',
            '  <span class="left-[38%] bg-gradient-to-r" style="left: 0"></span>',
            '  @if (a) { <i class="ml-1" [style.left.%]="p"></i> }',
            '</div>',
            '<code class="font-mono ltr-island ml-1"><b class="pl-2"></b></code>',
          ].join('\n'),
        ),
      ).toEqual([]);
    });

    it('fails rtl: and ltr: variants on and under an island', () => {
      expect(
        template(
          [
            '<div dir="ltr" class="rtl:rotate-180">',
            '  <ng-template><i [class.rtl:-scale-x-100]="a"></i></ng-template>',
            '  <span class="ltr-island md:ltr:ml-2"></span>',
            '</div>',
          ].join('\n'),
        ),
      ).toEqual([
        '1:rtl-variant-in-island:rtl:rotate-180',
        '2:rtl-variant-in-island:rtl:-scale-x-100',
        '3:rtl-variant-in-island:md:ltr:ml-2',
      ]);
    });

    it('ends at a nested dir of another value or a bound dir', () => {
      expect(
        template(
          [
            '<div dir="ltr">',
            '  <p dir="rtl" class="ml-2 rtl:rotate-180"></p>',
            '  <p [dir]="d" class="pr-2"></p>',
            '  <p dir="auto" class="text-left"></p>',
            '</div>',
          ].join('\n'),
        ),
      ).toEqual([
        '2:rtl-physical:ml-2',
        '3:rtl-physical:pr-2',
        '4:rtl-physical:text-left',
      ]);
    });

    it('lets dir decide over the ltr-island class', () => {
      expect(template('<p dir="rtl" class="ltr-island ml-2"></p>')).toEqual([
        '1:rtl-physical:ml-2',
      ]);
    });
  });

  it('reports file offsets for markers to cover', () => {
    const text = '<p>\n  <b class="flex  ml-4"></b>\n</p>';
    const [v] = findings(text);
    expect(v.offset).toBe(text.indexOf('ml-4'));
    expect(v.line).toBe(2);
  });
});

describe('rtlTsFindings', () => {
  it('fails class strings, judged per line', () => {
    expect(
      tsKeys(
        [
          "const a = 'flex ml-4';",
          "const b = 'left-1/2', c = '-translate-x-1/2';",
          "const d = 'left-1/2';",
          'const e = `mr-2 ${x} pl-2`;',
        ].join('\n'),
      ),
    ).toEqual([
      '1:rtl-physical:ml-4',
      '3:rtl-physical:left-1/2',
      '4:rtl-physical:mr-2',
      '4:rtl-physical:pl-2',
    ]);
  });

  it('never matches types, imports or type unions', () => {
    expect(
      tsKeys(
        [
          "import x from './ml-4';",
          "type Side = 'ml-4' | 'left-0';",
          'type V = number | Date;',
          'interface P { left: number; right?: number }',
          'let p: { left: number };',
        ].join('\n'),
      ),
    ).toEqual([]);
  });

  it('fails object-literal positions and style objects', () => {
    expect(
      tsKeys(
        [
          'const stages = [{ left: 50, top: 2 }, { right: -4 }];',
          "const s = { marginLeft: '4px', 'padding-right': `${p}px` };",
          "const t = { textAlign: 'right' };",
          "const u = { textAlign: 'center', left: someValue, top: 3 };",
        ].join('\n'),
      ),
    ).toEqual([
      '1:rtl-physical:left',
      '1:rtl-physical:right',
      '2:rtl-physical:marginLeft',
      '2:rtl-physical:padding-right',
      '3:rtl-physical:textAlign',
    ]);
  });

  it('reads host [class.x] and [style.x] keys', () => {
    expect(
      tsKeys(
        "const host = { '[class.ml-2]': 'a', '[style.left.px]': 'b', '[class.ms-2]': 'c' };",
      ),
    ).toEqual(['1:rtl-physical:style.left', '1:rtl-physical:ml-2']);
  });

  it('scans inline styles as CSS at file positions, and leaves the template alone', () => {
    const text = [
      '@Component({',
      "  selector: 'x',",
      '  template: \'<p class="ml-4"></p>\',',
      '  styles: [',
      '    `.a { left: 0; }',
      '     /* rtl-exempt: decorative */',
      '     .b { right: 0; }`,',
      "    '.c { margin-left: 1px; }',",
      '  ],',
      '})',
      'class X {}',
      '@Component({ styles: `.d { padding-right: 2px; }` })',
      'class Y {}',
    ].join('\n');
    const scan = typescript(text);
    expect(scan.violations.map((v) => [v.line, v.key, v.offset])).toEqual([
      [5, 'left', text.indexOf('left: 0')],
      // Reported here; main.ts drops it through the marker below.
      [7, 'right', text.indexOf('right: 0')],
      [8, 'margin-left', text.indexOf('margin-left')],
      [12, 'padding-right', text.indexOf('padding-right')],
    ]);
    expect(scan.markers).toEqual([
      expect.objectContaining({
        kind: 'rtl-exempt',
        line: 6,
        covers: {
          start: text.indexOf('.b {'),
          end: text.indexOf('right: 0; }') + 'right: 0; }'.length,
        },
      }),
    ]);
  });
});
