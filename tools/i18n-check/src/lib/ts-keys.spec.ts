import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as ts from 'typescript';
import { extractTsKeys, parseTypeScriptFiles } from './ts-keys';

const scanOf = (text: string) =>
  extractTsKeys(
    ts.createSourceFile('c.ts', text, ts.ScriptTarget.ESNext, true),
    'c.ts',
  );

describe('extractTsKeys', () => {
  it('collects the first argument of translate calls', () => {
    const scan = scanOf(
      [
        "translate('a.b.c');",
        "svc.translate('a.b.d', { n: 1 });",
        "translateSignal('a.b.e');",
        "translateObjectSignal('a.b');",
        'translate(STATUS_I18N_KEYS[s]);',
        'this.i18n.translate(this.key);',
        'translate();',
        "other('a.b.f');",
      ].join('\n'),
    );
    expect(
      scan.uses.map((u) => [u.line, u.form, u.key, u.receiver, u.target]),
    ).toEqual([
      [1, 'literal', 'a.b.c', null, 'leaf'],
      [2, 'literal', 'a.b.d', null, 'leaf'],
      [3, 'literal', 'a.b.e', null, 'leaf'],
      [4, 'literal', 'a.b', null, 'object'],
      [5, 'computed', 'STATUS_I18N_KEYS[s]', 'STATUS_I18N_KEYS', 'leaf'],
      [6, 'computed', 'this.key', null, 'leaf'],
    ]);
  });

  it('collects every string literal for the literal scan', () => {
    const scan = scanOf("const a = 'x.y.z';\nconst b = `p.q.r`;");
    expect(scan.strings.map((s) => [s.line, s.value])).toEqual([
      [1, 'x.y.z'],
      [2, 'p.q.r'],
    ]);
  });

  it('extracts inline component templates with their first line', () => {
    const text =
      "@Component({\n  selector: 'x',\n  template: `\n<p></p>`,\n})\nclass X {}";
    const scan = scanOf(text);
    expect(scan.templates).toEqual([
      { text: '\n<p></p>', firstLine: 3, firstOffset: text.indexOf('`') + 1 },
    ]);
  });

  it('rejects an inline template with substitutions', () => {
    const scan = scanOf('@Component({ template: `<p>${x}</p>` })\nclass X {}');
    expect(scan.violations).toEqual([
      expect.objectContaining({ kind: 'parse-error' }),
    ]);
  });

  it('collects key constants, aliases and invalid constants', () => {
    const scan = scanOf(
      [
        "const STATUS_I18N_KEYS = { a: 'x.s.a', nested: { b: 'x.s.b' } } as const;",
        "const LIST_I18N_KEYS = ['x.l.a'] as const;",
        'class C { readonly statusI18nKeys = STATUS_I18N_KEYS; }',
        "const LOOSE_I18N_KEYS = { a: 'x.s.a' };",
        "const MIXED_I18N_KEYS = { a: 'x.s.a', b: compute() } as const;",
      ].join('\n'),
    );
    expect(
      scan.keyConsts.map((k) => [
        k.name,
        k.keys.map((s) => s.value),
        k.problem !== null,
      ]),
    ).toEqual([
      ['STATUS_I18N_KEYS', ['x.s.a', 'x.s.b'], false],
      ['LIST_I18N_KEYS', ['x.l.a'], false],
      ['LOOSE_I18N_KEYS', [], true],
      ['MIXED_I18N_KEYS', ['x.s.a'], true],
    ]);
    expect(scan.aliases).toEqual([
      { name: 'statusI18nKeys', target: 'STATUS_I18N_KEYS' },
    ]);
  });
});

describe('parseTypeScriptFiles', () => {
  it('reports syntactic diagnostics for a file that does not parse', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-check-'));
    try {
      const good = path.join(dir, 'good.ts');
      const bad = path.join(dir, 'bad.ts');
      fs.writeFileSync(good, "export const a = 'x';\n");
      fs.writeFileSync(bad, 'export const a = {\n');
      const parsed = parseTypeScriptFiles([good, bad]);
      expect(parsed.get(good)?.diagnostics).toHaveLength(0);
      expect(parsed.get(bad)?.diagnostics.length).toBeGreaterThan(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
