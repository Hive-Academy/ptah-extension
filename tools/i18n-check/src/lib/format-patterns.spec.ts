import * as ts from 'typescript';
import { formatTemplateFindings, formatTsFindings } from './format-patterns';
import { fileTemplateSource, parseTemplateSource } from './template-keys';

const findings = (text: string) => {
  const source = fileTemplateSource(text, 'x.html');
  const { tree } = parseTemplateSource(source);
  if (!tree) throw new Error('template did not parse');
  return formatTemplateFindings(source, tree);
};
const template = (text: string) =>
  findings(text).map((v) => `${v.line}:${v.kind}:${v.key}`);
const typescript = (text: string) =>
  formatTsFindings(
    ts.createSourceFile('c.ts', text, ts.ScriptTarget.ESNext, true),
    'c.ts',
  ).map((v) => `${v.line}:${v.kind}:${v.key}`);

describe('formatTemplateFindings', () => {
  it('fails the locale pipes wherever an expression sits', () => {
    expect(
      template(
        [
          "<p>{{ d | date: 'medium' }}</p>",
          '<p [title]="n | number: \'1.0-1\'">{{ p | currency }}</p>',
          '@if (x | percent) { <b>{{ y | decimal }}</b> }',
        ].join('\n'),
      ),
    ).toEqual([
      '1:locale-format-pipe:date',
      '2:locale-format-pipe:number',
      '2:locale-format-pipe:currency',
      '3:locale-format-pipe:percent',
      '3:locale-format-pipe:decimal',
    ]);
  });

  it('passes the i18n pipes and unrelated pipes', () => {
    expect(
      template(
        "<p>{{ d | i18nDate: 'medium' }} {{ n | i18nNumber }} {{ k | transloco }} {{ s | uppercase }}</p>",
      ),
    ).toEqual([]);
  });

  it('fails toLocale*String() calls in expressions', () => {
    expect(
      template(
        '<p>{{ d.toLocaleDateString() }} {{ d?.toLocaleTimeString() }} {{ n.toLocaleString() }}</p>',
      ),
    ).toEqual([
      '1:locale-format-call:toLocaleDateString',
      '1:locale-format-call:toLocaleTimeString',
      '1:locale-format-call:toLocaleString',
    ]);
  });

  it('reports the pipe name position as a file offset in wrapped text', () => {
    const text = '<p>\n  Updated\n    {{ when | date }}\n</p>';
    const [v] = findings(text);
    expect(v.offset).toBe(text.indexOf('| date') + 2);
    expect(v.line).toBe(3);
    expect(v.exemptBy).toBe('format-exempt');
  });
});

describe('formatTsFindings', () => {
  it('never matches a type union (N3)', () => {
    expect(
      typescript(
        [
          'type V = number | Date;',
          'let v: string | number | Date = 1;',
          'function f(x: Date | number): number | Date { return x; }',
          'const o: Intl.DateTimeFormatOptions = {};',
        ].join('\n'),
      ),
    ).toEqual([]);
  });

  it('fails toLocale*String calls in every call form', () => {
    expect(
      typescript(
        [
          'd.toLocaleDateString();',
          "d?.toLocaleTimeString('en');",
          '(1).toLocaleString();',
          "d['toLocaleDateString']();",
          'const ref = d.toLocaleDateString;',
        ].join('\n'),
      ),
    ).toEqual([
      '1:locale-format-call:toLocaleDateString',
      '2:locale-format-call:toLocaleTimeString',
      '3:locale-format-call:toLocaleString',
      '4:locale-format-call:toLocaleDateString',
    ]);
  });

  it('passes Intl formatters built with intlLocale() only', () => {
    expect(
      typescript(
        [
          'new Intl.DateTimeFormat(intlLocale(), { month: "short" });',
          'new Intl.NumberFormat(this.i18n.intlLocale());',
          'Intl.RelativeTimeFormat(i18n?.intlLocale()!);',
          "new Intl.RelativeTimeFormat('en');",
          'new Intl.NumberFormat();',
          'Intl.DateTimeFormat().resolvedOptions().timeZone;',
          'new Intl.PluralRules(locale);',
          "Intl.getCanonicalLocales('ar');",
          "Intl.NumberFormat.supportedLocalesOf('ar');",
        ].join('\n'),
      ),
    ).toEqual([
      '4:intl-without-locale:Intl.RelativeTimeFormat',
      '5:intl-without-locale:Intl.NumberFormat',
      '6:intl-without-locale:Intl.DateTimeFormat',
      '7:intl-without-locale:Intl.PluralRules',
    ]);
  });
});
